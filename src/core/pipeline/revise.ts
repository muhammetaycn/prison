import type { ClarificationAnswer, ResolvedPrison, RevisionRecord } from "@/models/prison";
import type { CouncilMode, ExecutionContext, ModifierAction } from "@/models/options";
import type { TargetAI } from "@/models/common";
import { newRecordId } from "@/core/prison-engine/ids";
import { ownerRevisionIdsForVersion } from "@/core/context-engine";
import { applyModifier } from "@/core/prison-engine/modifiers";
import { applyPatch, REVISION_POLICY } from "@/core/prison-engine/patch";
import { transition } from "@/core/prison-engine/state-machine";
import { interpretRevision } from "@/core/revision-engine";
import { refreshExecutionPlan } from "@/core/intent-engine/planning";
import { toTaskPlan } from "@/core/requirement-resolver";
import { MODIFIER_LABELS, TARGET_LABELS } from "@/templates/ui-labels";
import { runCompilePipeline, type PipelineDeps } from "./compile";
import { CouncilCheckpointWorkingPrisonSchema, councilSourceFingerprint, revisionRequestFingerprint, type CouncilCheckpoint, type CouncilCheckpointRevisionOrigin } from "@/models/council-checkpoint";

/** One prepared revision belongs to one exact persisted base and actual owner request. */
function matchingRevisionOrigin(
  checkpoint: CouncilCheckpoint, prison: ResolvedPrison, message: string,
  clarifications: ClarificationAnswer[] | undefined, deps: PipelineDeps,
): CouncilCheckpointRevisionOrigin | null {
  const origin = checkpoint.revisionOrigin;
  if (!origin || !deps.council || origin.baseFingerprint !== councilSourceFingerprint(prison, deps.council, deps.provider)
    || origin.requestFingerprint !== revisionRequestFingerprint(message, clarifications) || !origin.changes.length) return null;
  const current = CouncilCheckpointWorkingPrisonSchema.parse(prison);
  const prepared = origin.preparedPrison;
  const pending = prepared.revisions.at(-1);
  if (!pending || pending.id !== origin.pendingRevisionId || pending.message !== message || pending.resultVersion !== null
    || pending.summary !== origin.summary || pending.engine !== origin.engine
    || revisionRequestFingerprint(pending.message, pending.clarifications) !== origin.requestFingerprint
    || prepared.id !== current.id || prepared.rawRequest !== current.rawRequest || prepared.language !== current.language
    || prepared.executionMode !== current.executionMode || prepared.activeVersion !== current.activeVersion
    || prepared.status !== "PRISON_UPDATED" || prepared.itemSeq < current.itemSeq
    || JSON.stringify(prepared.intent) !== JSON.stringify(current.intent)
    || JSON.stringify(prepared.promptVersions) !== JSON.stringify(current.promptVersions)
    || JSON.stringify(prepared.inactiveOwnerRevisionIds) !== JSON.stringify(current.inactiveOwnerRevisionIds)
    || prepared.revisions.length !== current.revisions.length + 1
    || JSON.stringify(prepared.revisions.slice(0, -1)) !== JSON.stringify(current.revisions)
    || checkpoint.sourceFingerprint !== councilSourceFingerprint(prepared, deps.council, deps.provider)) return null;
  return origin;
}

function finishRevision(
  working: ResolvedPrison, pendingRecord: RevisionRecord, changes: string[], blocked: string[], changed: boolean,
): ResolvedPrison {
  const record: RevisionRecord = {
    ...pendingRecord,
    summary: changed ? pendingRecord.summary : "Bu mesaj prison'da değişiklik gerektirmedi.",
    changes: [...changes, ...blocked],
    resultVersion: changed && working.promptVersions.length ? working.activeVersion : null,
  };
  return { ...working, revisions: working.revisions.map((entry) => entry.id === record.id ? record : entry) };
}

/** A user-selected target supersedes the plan's earlier recommendation. AUTO needs a fresh recommendation. */
async function alignTargetPlan(prison: ResolvedPrison, deps: PipelineDeps): Promise<ResolvedPrison> {
  if (!prison.spec.taskPlan) return prison;
  if (prison.targetAI === "auto") {
    return { ...prison, spec: { ...prison.spec, taskPlan: toTaskPlan(await refreshExecutionPlan(prison, deps.provider)) } };
  }
  const target = TARGET_LABELS[prison.targetAI];
  return { ...prison, spec: { ...prison.spec, taskPlan: {
    ...prison.spec.taskPlan,
    recommendedTarget: prison.targetAI,
    targetRationale: prison.language === "tr"
      ? `Kullanıcı ${target} hedefini seçti; görev, çıktı ve koruma koşulları bu hedefe göre korunur.`
      : `The owner selected ${target}; preserve the task, deliverable and protected constraints for this target.`,
  } } };
}

/**
 * READY → USER_REVISION → PRISON_UPDATED → PROMPT_RECOMPILED → PROMPT_VALIDATED → READY
 *
 * Updates the ACTIVE prison in place (no new prison) and recompiles. If nothing changed,
 * no new version is created.
 */
export async function runRevisionPipeline(
  prison: ResolvedPrison,
  message: string,
  deps: PipelineDeps,
  clarifications?: ClarificationAnswer[],
): Promise<ResolvedPrison> {
  const now = deps.now ?? (() => new Date());
  if (deps.checkpoints && deps.council) {
    const checkpoint = await deps.checkpoints.get(prison.id);
    if (checkpoint) {
      const origin = matchingRevisionOrigin(checkpoint, prison, message, clarifications, deps);
      if (origin) {
        // Preserve the original real pending ID; never hide it from the source fingerprint.
        const prepared = structuredClone(origin.preparedPrison);
        const pending = prepared.revisions.at(-1)!;
        const completed = await runCompilePipeline(prepared, { trigger: "revision", note: origin.summary, llmReview: true }, { ...deps, revisionOrigin: origin });
        return finishRevision(completed, pending, origin.changes, origin.blocked, true);
      }
      await deps.checkpoints.delete(prison.id);
    }
  }
  let working = transition(prison, "USER_REVISION", message.slice(0, 120), now());

  const interpretation = await interpretRevision(message, working, deps.provider, clarifications);
  const result = applyPatch(working, interpretation.patch, REVISION_POLICY, now());
  const pendingRecord: RevisionRecord = {
    id: newRecordId("rev"), createdAt: now().toISOString(), message,
    summary: interpretation.summary, changes: [], resultVersion: null, engine: interpretation.engine,
    ...(clarifications ? { clarifications } : {}),
  };
  // Plan/generation/critic must see the owner's actual latest directive before accepting changes.
  working = { ...result.prison, revisions: [...result.prison.revisions, pendingRecord] };
  // Changes to the task must refresh its plan; packaging-only changes keep the existing plan.
  if (result.changes.length && (working.spec !== prison.spec || working.taskMemory !== prison.taskMemory)) {
    const plan = await refreshExecutionPlan(working, deps.provider, message);
    working = { ...working, spec: { ...working.spec, taskPlan: toTaskPlan(plan) } };
    result.changes.push("Çözüm planı güncellendi");
  } else if (working.targetAI !== prison.targetAI) {
    working = await alignTargetPlan(working, deps);
  }
  working = transition(working, "PRISON_UPDATED", interpretation.summary, now());

  const changed = result.changes.length > 0;
  if (changed && working.promptVersions.length > 0) {
    const origin: CouncilCheckpointRevisionOrigin | undefined = deps.checkpoints && deps.council ? {
      baseFingerprint: councilSourceFingerprint(prison, deps.council, deps.provider),
      requestFingerprint: revisionRequestFingerprint(message, clarifications),
      preparedPrison: structuredClone(working), pendingRevisionId: pendingRecord.id,
      summary: interpretation.summary, changes: [...result.changes], blocked: [...result.blocked], engine: interpretation.engine,
    } : undefined;
    working = await runCompilePipeline(working, { trigger: "revision", note: interpretation.summary, llmReview: true }, { ...deps, ...(origin ? { revisionOrigin: origin } : {}) });
  } else {
    working = transition(working, working.promptVersions.length ? "READY" : "READY_FOR_COMPILE", "", now());
  }

  return finishRevision(working, pendingRecord, result.changes, result.blocked, changed);
}

export type Adjustment = { kind: "modifier"; action: ModifierAction } | { kind: "target"; target: TargetAI }
  | { kind: "context"; executionContext: ExecutionContext } | { kind: "council_mode"; councilMode: CouncilMode };

/** READY → PRISON_UPDATED → PROMPT_RECOMPILED → … Toolbar modifiers and target switches. */
export async function runAdjustmentPipeline(
  prison: ResolvedPrison,
  adjustment: Adjustment,
  deps: PipelineDeps,
): Promise<ResolvedPrison> {
  const now = deps.now ?? (() => new Date());
  const label =
    adjustment.kind === "modifier" ? MODIFIER_LABELS[adjustment.action]
      : adjustment.kind === "target" ? `Hedef AI: ${TARGET_LABELS[adjustment.target]}`
        : adjustment.kind === "context" ? `Kullanım ortamı: ${adjustment.executionContext}`
          : `Konsey yöntemi: ${adjustment.councilMode}`;

  let working: ResolvedPrison =
    adjustment.kind === "modifier"
      ? { ...prison, compileOptions: applyModifier(prison.compileOptions, adjustment.action) }
      : adjustment.kind === "target" ? { ...prison, targetAI: adjustment.target }
        : adjustment.kind === "context" ? { ...prison, compileOptions: { ...prison.compileOptions, executionContext: adjustment.executionContext, agentMode: adjustment.executionContext === "agent" } }
          : { ...prison, compileOptions: { ...prison.compileOptions, councilMode: adjustment.councilMode } };
  if (adjustment.kind === "target" && working.targetAI !== prison.targetAI) {
    working = await alignTargetPlan(working, deps);
  }
  working = transition(working, "PRISON_UPDATED", label, now());
  working = await runCompilePipeline(
    working,
    { trigger: adjustment.kind === "target" ? "target_change" : "modifier", note: label, llmReview: false },
    deps,
  );
  const record: RevisionRecord = {
    id: newRecordId("rev"),
    createdAt: now().toISOString(),
    message: label,
    summary: `${label} uygulandı.`,
    changes: [],
    resultVersion: working.activeVersion,
    engine: "modifier",
  };
  return { ...working, revisions: [...working.revisions, record] };
}

/** READY → PRISON_UPDATED → READY. Restores a version's state and text as a new version. */
export function restoreVersion(prison: ResolvedPrison, versionNumber: number, now: Date = new Date()): ResolvedPrison | null {
  const source = prison.promptVersions.find((v) => v.version === versionNumber);
  if (!source) return null;
  const ownerRevisionIds = ownerRevisionIdsForVersion(prison, source);
  const activeIds = new Set(ownerRevisionIds);
  let working: ResolvedPrison = {
    ...prison,
    spec: source.specSnapshot,
    taskMemory: source.memorySnapshot,
    compileOptions: source.options,
    targetAI: source.targetAI,
    inactiveOwnerRevisionIds: prison.revisions
      .filter((entry) => entry.engine !== "modifier" && !activeIds.has(entry.id))
      .map((entry) => entry.id),
  };
  working = transition(working, "PRISON_UPDATED", `v${versionNumber} geri yüklendi`, now);
  working = transition(working, "READY", "", now);
  const version = {
    ...source,
    version: (prison.promptVersions.at(-1)?.version ?? 0) + 1,
    createdAt: now.toISOString(),
    trigger: "restore" as const,
    note: `v${versionNumber} sürümünden geri yüklendi`,
    ownerRevisionIds,
  };
  return { ...working, promptVersions: [...working.promptVersions, version], activeVersion: version.version };
}
