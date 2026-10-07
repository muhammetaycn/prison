import type { TargetAI } from "@/models/common";
import type { CompileOptions } from "@/models/options";
import type { ResolvedPrison } from "@/models/prison";
import type { MemoryEntry, MemoryKind } from "@/models/prompt";
import type { DeploymentPermission, ItemListKey, ItemSource, Operation, PrisonSpec, SpecFlags, SpecItem } from "@/models/spec";
import { ITEM_LIST_KEYS } from "@/models/spec";
import { activeOwnerRevisions } from "@/core/context-engine";
import { isTaskType, getTaskType } from "@/core/task-types/registry";
import { cleanItem, cleanText, ensureSentence, fold } from "@/core/text/normalize";
import { isExplicitNegativeDirective, isPermissionExpansionClaim } from "@/core/text/owner-directives";
import {
  DEPLOYMENT_LABELS,
  LIST_LABELS,
  MEMORY_KIND_LABELS,
  OPERATION_LABELS,
  OPTION_VALUE_LABELS,
  TARGET_LABELS,
} from "@/templates/ui-labels";
import { phrase } from "@/templates/phrases";
import { addItems, findItem, ItemAllocator, promoteItems, removeItems } from "./items";
import { newRecordId } from "./ids";

/** Provider-independent change set for a prison. Revisions and critic fixes are both expressed as patches. */
export interface StatePatch {
  set?: {
    primaryGoal?: string;
    taskType?: string;
    operation?: Operation;
    deploymentPermission?: DeploymentPermission;
    expectedOutputFormat?: string;
    expectedOutputDescription?: string;
    flags?: Partial<SpecFlags>;
    targetAI?: TargetAI;
    options?: Partial<CompileOptions>;
  };
  add?: Partial<Record<ItemListKey, string[]>>;
  removeIds?: string[];
  resolvedUnknowns?: Array<{ unknownId: string; fact: string }>;
  memory?: Array<{ directive: string; kind: MemoryKind; relatedItemTexts?: string[] }>;
  revokeMemoryIds?: string[];
  /** Repair an AI paraphrase using only a verbatim instruction already supplied by the owner. */
  restoreOwnerQuotes?: Array<{ itemId: string; ownerQuote: string }>;
}

export interface PatchPolicy {
  /** Source tag for items this patch adds. */
  source: ItemSource;
  /** Items with these sources cannot be removed by this patch. */
  protectSources: ItemSource[];
  /** Whether scalar fields, target and options may change (false for critic fixes). */
  allowSet: boolean;
  /** Whether task memory may be written (false for critic fixes). */
  allowMemory: boolean;
  /** Only model hypotheses in these lists may be removed despite the implicit-source guard. */
  removeImplicitFrom?: ItemListKey[];
}

export const REVISION_POLICY: PatchPolicy = { source: "revision", protectSources: [], allowSet: true, allowMemory: true };
export const CRITIC_POLICY: PatchPolicy = {
  source: "critic",
  protectSources: ["explicit", "implicit", "revision"],
  allowSet: false,
  allowMemory: false,
  removeImplicitFrom: ["assumptions"],
};

export interface PatchResult {
  prison: ResolvedPrison;
  /** Human-readable (Turkish) change log. */
  changes: string[];
  /** Changes refused by policy or by task memory. */
  blocked: string[];
}

const DEPLOY_TOPIC = /(deploy|publish|production|release|yayin|canli|prod)/;

/** Exact wording comparison for memory links; never infer a relationship from a paraphrase. */
export const memoryItemTextKey = (text: string): string => fold(cleanItem(text));

function describeOptions(options: Partial<CompileOptions>): string[] {
  const out: string[] = [];
  if (options.verbosity) out.push(OPTION_VALUE_LABELS.verbosity[options.verbosity]);
  if (options.technicality) out.push(OPTION_VALUE_LABELS.technicality[options.technicality]);
  if (options.scope) out.push(OPTION_VALUE_LABELS.scope[options.scope]);
  if (options.agentMode !== undefined) out.push(options.agentMode ? "Agent modu açık" : "Agent modu kapalı");
  if (options.jailbreakMode !== undefined) out.push(options.jailbreakMode ? "JB modu açık" : "JB modu kapalı");
  return out;
}

/**
 * Applies a patch to ONE prison. Pure: returns a new prison. Task memory protects the items
 * it created: they cannot be removed unless that memory entry is revoked in the same or an
 * earlier patch — this is how a prison "remembers" directives across revisions.
 */
export function applyPatch(prison: ResolvedPrison, patch: StatePatch, policy: PatchPolicy, now = new Date()): PatchResult {
  const changes: string[] = [];
  const blocked: string[] = [];
  const ids = new ItemAllocator(prison.itemSeq);
  const language = prison.language;
  let spec: PrisonSpec = prison.spec;
  let memory: MemoryEntry[] = prison.taskMemory;
  let targetAI = prison.targetAI;
  let compileOptions = prison.compileOptions;
  const addedThisPatch: SpecItem[] = [];
  const relatedItemIds = new Map<string, Set<string>>();
  const rememberItemIds = (text: string, items: SpecItem[]) => {
    const key = memoryItemTextKey(text);
    if (!key) return;
    const related = relatedItemIds.get(key) ?? new Set<string>();
    for (const item of items) related.add(item.id);
    relatedItemIds.set(key, related);
  };

  // 1. Revoke memory (only when explicitly requested).
  if (policy.allowMemory && patch.revokeMemoryIds?.length) {
    const revoke = new Set(patch.revokeMemoryIds);
    memory = memory.map((entry) => {
      if (entry.active && revoke.has(entry.id)) {
        changes.push(`Görev hafızasından kaldırıldı: ${entry.directive}`);
        return { ...entry, active: false };
      }
      return entry;
    });
  }
  const memoryProtected = new Set(memory.filter((m) => m.active).flatMap((m) => m.itemRefs));

  // A critic may repair inferred wording only by restoring verifiable owner text, never by inventing a replacement.
  const ownerTexts = [prison.rawRequest, ...activeOwnerRevisions(prison).map((entry) => entry.message)].map(cleanText);
  for (const correction of patch.restoreOwnerQuotes ?? []) {
    const found = findItem(spec, correction.itemId);
    const quote = cleanText(correction.ownerQuote);
    if (!found || !quote || !ownerTexts.some((text) => text.includes(quote)) || memoryProtected.has(correction.itemId)
      || (found.item.source !== "implicit" && found.item.source !== "revision")) {
      blocked.push("Düzeltme doğrulanmış kullanıcı talimatıyla eşleşmedi veya korunan öğeye dokunuyor.");
      continue;
    }
    const source = cleanText(prison.rawRequest).includes(quote) ? "explicit" as const : "revision" as const;
    if (found.list === "unknowns") {
      spec = removeItems(spec, new Set([found.item.id])).spec;
      const known = addItems(spec, "contextFacts", [quote], source, ids);
      spec = known.spec;
      addedThisPatch.push(...known.added);
      changes.push(`Kullanıcı yanıtıyla netleşti: ${quote}`);
    } else if (found.item.text !== quote) {
      const restored = { ...found.item, text: quote, source };
      if (found.list === "disallowedOperations" || (found.list !== "constraints" && isExplicitNegativeDirective(quote))) {
        // A full owner's negative sentence belongs in constraints to avoid a second negation.
        spec = removeItems(spec, new Set([found.item.id])).spec;
        spec = { ...spec, constraints: [...spec.constraints, restored] };
      } else {
        spec = { ...spec, [found.list]: spec[found.list].map((item) => item.id === restored.id ? restored : item) };
      }
      changes.push(`Kullanıcı talimatı aynen korundu: ${quote}`);
    }
  }

  // 2. Removals.
  const toRemove = new Set<string>();
  for (const id of patch.removeIds ?? []) {
    const found = findItem(spec, id);
    if (!found) continue;
    if (memoryProtected.has(id)) {
      blocked.push(`Görev hafızası nedeniyle korunuyor: ${found.item.text}`);
      continue;
    }
    if (policy.protectSources.includes(found.item.source)
      && !(found.item.source === "implicit" && policy.removeImplicitFrom?.includes(found.list))) {
      blocked.push(`Kullanıcı tarafından belirtildiği için korunuyor: ${found.item.text}`);
      continue;
    }
    toRemove.add(id);
  }

  // 3. Resolved unknowns become known facts.
  for (const resolved of patch.resolvedUnknowns ?? []) {
    const found = findItem(spec, resolved.unknownId);
    const fact = cleanText(resolved.fact);
    if (!fact) continue;
    if (found?.list === "unknowns") toRemove.add(resolved.unknownId);
    const result = addItems(spec, "contextFacts", [fact], policy.source, ids);
    spec = result.spec;
    addedThisPatch.push(...result.added);
    rememberItemIds(fact, [...result.added, ...result.matched]);
    if (result.added.length) changes.push(`Netleşti: ${fact}`);
  }

  if (toRemove.size) {
    const result = removeItems(spec, toRemove);
    spec = result.spec;
    for (const item of result.removed) changes.push(`Kaldırıldı: ${item.text}`);
  }

  // 4. Additions. A text that matches an existing item re-uses it (and, for user revisions,
  //    promotes it to "revision" so the owner's statement is visible and protected).
  for (const list of ITEM_LIST_KEYS) {
    const texts = patch.add?.[list]?.filter((text) => {
      if (policy.source !== "critic" || !isPermissionExpansionClaim(text)) return true;
      const normalizeClause = (value: string) => fold(cleanText(value)).replace(/[.!?;]+$/u, "");
      const verifiedOwnerClause = ownerTexts.some((ownerText) => [ownerText, ...ownerText.split(/(?<=[.!?;])\s+|\n+/u)]
        .some((clause) => normalizeClause(clause) === normalizeClause(text)));
      if (verifiedOwnerClause) return true;
      blocked.push(`Kullanıcının vermediği izin denetçi tarafından eklenemez: ${cleanText(text)}`);
      return false;
    });
    if (!texts?.length) continue;
    // Resolve each requested text separately, retaining its actual new or duplicate-match IDs.
    const added: SpecItem[] = [];
    const matched: SpecItem[] = [];
    for (const text of texts) {
      const result = addItems(spec, list, [text], policy.source, ids);
      spec = result.spec;
      added.push(...result.added);
      matched.push(...result.matched.filter((item) => !matched.some((entry) => entry.id === item.id)));
      rememberItemIds(text, [...result.added, ...result.matched]);
    }
    addedThisPatch.push(...added, ...matched);
    for (const item of added) changes.push(`${LIST_LABELS[list].singular} eklendi: ${item.text}`);
    if (policy.source === "revision") {
      const promote = matched.filter((item) => item.source !== "explicit" && item.source !== "revision");
      if (promote.length) {
        spec = promoteItems(spec, list, new Set(promote.map((item) => item.id)), "revision");
        for (const item of promote) changes.push(`${LIST_LABELS[list].singular} teyit edildi: ${item.text}`);
      }
    }
  }

  // 5. Scalar fields, target and options.
  const set = patch.set;
  if (set && policy.allowSet) {
    if (set.primaryGoal && cleanText(set.primaryGoal) && cleanText(set.primaryGoal) !== spec.primaryGoal) {
      spec = { ...spec, primaryGoal: ensureSentence(set.primaryGoal) };
      changes.push(`Amaç güncellendi: ${spec.primaryGoal}`);
    }
    if (set.taskType && isTaskType(set.taskType) && set.taskType !== spec.taskType) {
      spec = { ...spec, taskType: set.taskType };
      changes.push(`Görev türü: ${getTaskType(set.taskType).label.tr}`);
    }
    if (set.operation && set.operation !== spec.operation) {
      spec = { ...spec, operation: set.operation };
      changes.push(`Operasyon: ${OPERATION_LABELS[set.operation]}`);
    }
    if (set.flags) {
      const nextFlags = { ...spec.flags, ...set.flags };
      if (Object.keys(nextFlags).some((key) => nextFlags[key as keyof SpecFlags] !== spec.flags[key as keyof SpecFlags])) {
        spec = { ...spec, flags: nextFlags };
        changes.push("Görevin uygulama koşulları güncellendi");
      }
    }
    if (set.expectedOutputFormat?.trim()) {
      spec = { ...spec, expectedOutput: { ...spec.expectedOutput, format: cleanText(set.expectedOutputFormat) } };
      changes.push(`Çıktı formatı: ${spec.expectedOutput.format}`);
    }
    if (set.expectedOutputDescription?.trim()) {
      spec = {
        ...spec,
        expectedOutput: { ...spec.expectedOutput, description: cleanText(set.expectedOutputDescription) },
      };
      changes.push("Beklenen çıktı güncellendi");
    }
    if (set.deploymentPermission && set.deploymentPermission !== spec.deploymentPermission) {
      spec = { ...spec, deploymentPermission: set.deploymentPermission };
      changes.push(`Deploy izni: ${DEPLOYMENT_LABELS[set.deploymentPermission]}`);
      if (set.deploymentPermission === "allowed") {
        const denyIds = spec.disallowedOperations
          .filter((item) => DEPLOY_TOPIC.test(fold(item.text)) && !memoryProtected.has(item.id))
          .map((item) => item.id);
        if (denyIds.length) {
          const result = removeItems(spec, new Set(denyIds));
          spec = result.spec;
          for (const item of result.removed) changes.push(`Kaldırıldı: ${item.text}`);
        }
      }
    }
    if (spec.deploymentPermission === "forbidden" && !spec.disallowedOperations.some((i) => DEPLOY_TOPIC.test(fold(i.text)))) {
      const result = addItems(spec, "disallowedOperations", [phrase("denyDeploy", language)], policy.source, ids);
      spec = result.spec;
      addedThisPatch.push(...result.added, ...result.matched);
      for (const item of result.added) changes.push(`${LIST_LABELS.disallowedOperations.singular} eklendi: ${item.text}`);
    }
    if (set.targetAI && set.targetAI !== targetAI) {
      targetAI = set.targetAI;
      changes.push(`Hedef AI: ${TARGET_LABELS[targetAI]}`);
    }
    if (set.options) {
      const next = { ...compileOptions, ...set.options,
        ...(set.options.executionContext !== undefined ? { agentMode: set.options.executionContext === "agent" }
          : set.options.agentMode !== undefined ? { executionContext: set.options.agentMode ? "agent" as const : "chat" as const } : {}) };
      const diff: Partial<CompileOptions> = {};
      if (next.verbosity !== compileOptions.verbosity) diff.verbosity = next.verbosity;
      if (next.technicality !== compileOptions.technicality) diff.technicality = next.technicality;
      if (next.scope !== compileOptions.scope) diff.scope = next.scope;
      if (next.agentMode !== compileOptions.agentMode) diff.agentMode = next.agentMode;
      if (next.jailbreakMode !== compileOptions.jailbreakMode) diff.jailbreakMode = next.jailbreakMode;
      if (next.executionContext !== compileOptions.executionContext) diff.executionContext = next.executionContext;
      if (next.councilMode !== compileOptions.councilMode) diff.councilMode = next.councilMode;
      compileOptions = next;
      const described = describeOptions(diff);
      if (described.length) changes.push(`Ayarlar: ${described.join(", ")}`);
    }
  } else if (set && !policy.allowSet) {
    blocked.push("Bu kaynak alanları değiştiremez (yalnızca öğe ekleyip çıkarabilir).");
  }

  // 6. Model-authored memories protect only their named items. Direct legacy/local patches keep their former scope.
  if (policy.allowMemory && patch.memory?.length) {
    const at = now.toISOString();
    for (const entry of patch.memory) {
      const directive = cleanText(entry.directive);
      if (!directive) continue;
      if (memory.some((m) => m.active && fold(m.directive) === fold(directive))) continue;
      const relatedTexts = entry.relatedItemTexts;
      if (relatedTexts?.some((text) => !relatedItemIds.has(memoryItemTextKey(text)))) {
        blocked.push(`Görev hafızası bağlantısı bu revizyonun eklediği veya netleştirdiği öğeyle eşleşmiyor: ${directive}`);
        continue;
      }
      const itemRefs = relatedTexts === undefined
        ? [...new Set(addedThisPatch.map((item) => item.id))]
        : [...new Set(relatedTexts.flatMap((text) => [...(relatedItemIds.get(memoryItemTextKey(text)) ?? [])]))]
          .filter((id) => findItem(spec, id) !== null);
      memory = [
        ...memory,
        {
          id: newRecordId("mem"),
          createdAt: at,
          directive,
          kind: entry.kind,
          itemRefs,
          active: true,
        },
      ];
      changes.push(`Görev hafızasına eklendi (${MEMORY_KIND_LABELS[entry.kind]}): ${directive}`);
    }
  }

  return {
    prison: {
      ...prison,
      spec,
      taskMemory: memory,
      targetAI,
      compileOptions,
      itemSeq: ids.value,
      updatedAt: now.toISOString(),
    },
    changes,
    blocked,
  };
}
