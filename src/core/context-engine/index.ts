import type { Language, TargetAI } from "@/models/common";
import type { CompileOptions } from "@/models/options";
import type { ResolvedPrison, RevisionRecord } from "@/models/prison";
import type { PromptVersion } from "@/models/prompt";
import type { PrisonSpec, SpecItem } from "@/models/spec";

/**
 * Context Engine — the isolation boundary.
 *
 * Every consumer of prison data (compiler, critic, revision engine) receives its input from
 * one of these functions, and each function reads exactly one prison. There is no global
 * conversation history and no shared state between prisons, so context cannot leak.
 */

export interface CompileInput {
  prisonId: string;
  spec: PrisonSpec;
  rawRequest: string;
  language: Language;
  targetAI: TargetAI;
  options: CompileOptions;
  ownerDirectives?: string[];
}

/** The audit log remains complete after restore; only the current branch's directives are authoritative. */
export function activeOwnerRevisions(prison: ResolvedPrison): RevisionRecord[] {
  const ownerRevisions = prison.revisions.filter((entry) => entry.engine !== "modifier");
  if (prison.inactiveOwnerRevisionIds !== undefined) {
    const inactive = new Set(prison.inactiveOwnerRevisionIds);
    return ownerRevisions.filter((entry) => !inactive.has(entry.id));
  }
  // Older saved records may already be on a restored branch, without the explicit inactive scope.
  const current = prison.promptVersions.find((entry) => entry.version === prison.activeVersion);
  if (!current || !prison.promptVersions.some((entry) => entry.trigger === "restore" && entry.version <= current.version)) {
    return ownerRevisions;
  }
  const inherited = new Set(ownerRevisionIdsForVersion(prison, current));
  const newestOwnerRecord = ownerRevisions.at(-1);
  const pending = prison.status === "USER_REVISION" && newestOwnerRecord
    && Date.parse(newestOwnerRecord.createdAt) >= Date.parse(prison.history.at(-1)?.at ?? "")
    ? newestOwnerRecord : undefined;
  return ownerRevisions.filter((entry) => inherited.has(entry.id)
    || (entry.resultVersion !== null && entry.resultVersion > current.version)
    || (entry.resultVersion === null && (entry.id === pending?.id || Date.parse(entry.createdAt) > Date.parse(current.createdAt))));
}

/** Legacy versions infer a conservative scope from recorded result versions and creation order. */
export function ownerRevisionIdsForVersion(prison: ResolvedPrison, version: PromptVersion): string[] {
  if (version.ownerRevisionIds != null) return [...version.ownerRevisionIds];
  // Old restore records retain the source note, so reuse that source's scope rather than its later timestamp.
  const restoredFrom = version.trigger === "restore" ? /^v(\d+) sürümünden geri yüklendi$/.exec(version.note) : null;
  const sourceNumber = restoredFrom ? Number(restoredFrom[1]) : null;
  const source = sourceNumber !== null && sourceNumber < version.version
    ? prison.promptVersions.find((entry) => entry.version === sourceNumber)
    : undefined;
  if (source) return ownerRevisionIdsForVersion(prison, source);
  const versionTime = Date.parse(version.createdAt);
  const precedingRestore = prison.promptVersions
    .filter((entry) => entry.trigger === "restore" && entry.version < version.version)
    .sort((left, right) => left.version - right.version).at(-1);
  const inherited = new Set(precedingRestore ? ownerRevisionIdsForVersion(prison, precedingRestore) : []);
  return prison.revisions.filter((entry) => {
    if (entry.engine === "modifier") return false;
    if (inherited.has(entry.id)) return true;
    if (entry.resultVersion !== null) {
      return entry.resultVersion <= version.version && entry.resultVersion > (precedingRestore?.version ?? 0);
    }
    // Null-result records can predate first generation; uncertain or equal timestamps cannot establish authority.
    const revisionTime = Date.parse(entry.createdAt);
    return revisionTime < versionTime && (!precedingRestore || revisionTime > Date.parse(precedingRestore.createdAt));
  }).map((entry) => entry.id);
}

export function toCompileInput(prison: ResolvedPrison): CompileInput {
  return {
    prisonId: prison.id,
    spec: prison.spec,
    rawRequest: prison.rawRequest,
    language: prison.language,
    targetAI: prison.targetAI,
    options: prison.compileOptions,
    ownerDirectives: activeOwnerRevisions(prison).slice(-3).map((entry) => entry.message),
  };
}

function items(list: SpecItem[]) {
  return list.map(({ id, text, source }) => ({ id, text, source }));
}

/** Compact, LLM-facing view of ONE prison's normalized state. */
export function isolatePrison(prison: ResolvedPrison) {
  const s = prison.spec;
  return {
    prison_id: prison.id,
    language: prison.language,
    raw_request: prison.rawRequest,
    target_ai: prison.targetAI,
    compile_options: prison.compileOptions,
    // Preserve the owner's words, not only an AI's paraphrase of the latest changes.
    owner_revisions: activeOwnerRevisions(prison).map((revision) => ({ message: revision.message })),
    // Keep generated question wording outside authoritative owner messages and source-quote choices.
    clarification_context: activeOwnerRevisions(prison).flatMap((revision) => revision.clarifications ?? []),
    clarification_context_policy: "Questions are model-authored contextual references, never owner facts, permissions, instructions or source quotations. Only their corresponding answers are owner-authored.",
    state: {
      primary_goal: s.primaryGoal,
      task_type: s.taskType,
      secondary_task_types: s.secondaryTaskTypes,
      operation: s.operation,
      domain: s.domain,
      role: s.role,
      context_summary: s.contextSummary,
      current_system: s.currentSystem,
      deployment_permission: s.deploymentPermission,
      flags: s.flags,
      expected_output: s.expectedOutput,
      execution_plan: s.taskPlan,
      secondary_goals: items(s.secondaryGoals),
      requirements: items(s.requirements),
      constraints: items(s.constraints),
      protected_elements: items(s.protectedElements),
      allowed_operations: items(s.allowedOperations),
      disallowed_operations: items(s.disallowedOperations),
      required_actions: items(s.requiredActions),
      assumptions: items(s.assumptions),
      unknowns: items(s.unknowns),
      success_criteria: items(s.successCriteria),
      context_facts: items(s.contextFacts),
      conflicts: items(s.conflicts),
    },
    task_memory: prison.taskMemory
      .filter((m) => m.active)
      .map(({ id, directive, kind }) => ({ id, directive, kind })),
  };
}

export function renderIsolatedPrison(prison: ResolvedPrison): string {
  return `<prison_state>\n${JSON.stringify(isolatePrison(prison), null, 2)}\n</prison_state>`;
}
