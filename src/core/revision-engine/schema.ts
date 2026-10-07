import { z } from "zod";
import { TARGET_AIS } from "@/models/common";
import { SCOPE_MODES, TECHNICALITY_LEVELS, VERBOSITY_LEVELS } from "@/models/options";
import { MEMORY_KINDS } from "@/models/prompt";
import { DEPLOYMENT_PERMISSIONS, OPERATIONS } from "@/models/spec";
import { memoryItemTextKey, type StatePatch } from "@/core/prison-engine/patch";

const strListResilient = z.preprocess((val) => {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string" && val.trim()) return [val.trim()];
  return [];
}, z.array(z.string()));

const boolNullResilient = z.preprocess((val) => {
  if (val === null || val === undefined) return null;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return /^(true|yes|1|allow|allowed)$/i.test(val.trim());
  return Boolean(val);
}, z.boolean().nullable());

const strNullResilient = z.preprocess(
  (val) => (val === null || val === undefined ? null : String(val)),
  z.string().nullable()
);

/** Wire schema for the revision engine (snake_case, every field required, nullable where unchanged). */
export function buildRevisionSchema(taskTypeIds: readonly string[]) {
  return z.object({
    summary: z.preprocess((val) => (val === null || val === undefined ? "" : String(val)), z.string()),
    set: z.object({
      primary_goal: strNullResilient,
      task_type: z.preprocess((val) => (typeof val === "string" && taskTypeIds.includes(val) ? val : null), z.enum(taskTypeIds as [string, ...string[]]).nullable()),
      target_ai: z.preprocess((val) => (typeof val === "string" && (TARGET_AIS as readonly string[]).includes(val.toLowerCase()) ? val.toLowerCase() : null), z.enum(TARGET_AIS).nullable()),
      operation: z.preprocess((val) => (typeof val === "string" && (OPERATIONS as readonly string[]).includes(val) ? val : null), z.enum(OPERATIONS).nullable()),
      deployment_permission: z.preprocess((val) => (typeof val === "string" && (DEPLOYMENT_PERMISSIONS as readonly string[]).includes(val) ? val : null), z.enum(DEPLOYMENT_PERMISSIONS).nullable()),
      existing_system: boolNullResilient,
      preserve_architecture: boolNullResilient,
      coding_required: boolNullResilient,
      advice_only: boolNullResilient,
      expected_output_format: strNullResilient,
      expected_output_description: strNullResilient,
      verbosity: z.preprocess((val) => (typeof val === "string" && (VERBOSITY_LEVELS as readonly string[]).includes(val) ? val : null), z.enum(VERBOSITY_LEVELS).nullable()),
      technicality: z.preprocess((val) => (typeof val === "string" && (TECHNICALITY_LEVELS as readonly string[]).includes(val) ? val : null), z.enum(TECHNICALITY_LEVELS).nullable()),
      scope: z.preprocess((val) => (typeof val === "string" && (SCOPE_MODES as readonly string[]).includes(val) ? val : null), z.enum(SCOPE_MODES).nullable()),
      agent_mode: boolNullResilient,
      jailbreak_mode: boolNullResilient,
    }),
    add: z.object({
      secondary_goals: strListResilient,
      requirements: strListResilient,
      constraints: strListResilient,
      protected_elements: strListResilient,
      allowed_operations: strListResilient,
      disallowed_operations: strListResilient,
      required_actions: strListResilient,
      assumptions: strListResilient,
      unknowns: strListResilient,
      success_criteria: strListResilient,
      context_facts: strListResilient,
    }),
    remove_item_ids: strListResilient,
    resolved_unknowns: z.preprocess((val) => Array.isArray(val) ? val : [], z.array(z.object({ unknown_id: z.string(), fact: z.string() }))),
    memory: z.preprocess((val) => Array.isArray(val) ? val : [], z.array(z.object({
      directive: z.string(),
      kind: z.enum(MEMORY_KINDS),
      related_item_texts: z.array(z.string().trim().min(1).max(1400)).max(40).default([]),
    }))),
    revoke_memory_ids: strListResilient,
  });
}

export type RevisionOutput = z.infer<ReturnType<typeof buildRevisionSchema>>;

/** A generated memory may name only exact additions or answers in this revision, not unrelated existing state. */
export function checkRevisionMemoryReferences(output: RevisionOutput): string | null {
  const allowed = new Set([
    ...Object.values(output.add).flat(),
    ...output.resolved_unknowns.map((entry) => entry.fact),
  ].map(memoryItemTextKey).filter(Boolean));
  for (const [index, entry] of output.memory.entries()) {
    for (const [relatedIndex, text] of entry.related_item_texts.entries()) {
      if (!allowed.has(memoryItemTextKey(text))) {
        return `memory.${index}.related_item_texts.${relatedIndex} must exactly name an item in this revision's add lists or a resolved_unknowns fact. Do not reference an arbitrary existing item or paraphrase a supplied addition.`;
      }
    }
  }
  return null;
}

type Defined<T> = { [K in keyof T]?: Exclude<T[K], null | undefined> };

/** Drops null/undefined fields ("unchanged" on the wire). */
function defined<T extends object>(value: T): Defined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined)) as Defined<T>;
}

/** Maps the wire format to a provider-independent StatePatch. */
export function revisionToPatch(output: RevisionOutput): StatePatch {
  const s = output.set;
  const flags = defined({
    existingSystem: s.existing_system,
    preserveArchitecture: s.preserve_architecture,
    codingRequired: s.coding_required,
    adviceOnly: s.advice_only,
  });
  const options = defined({
    verbosity: s.verbosity,
    technicality: s.technicality,
    scope: s.scope,
    agentMode: s.agent_mode,
    jailbreakMode: s.jailbreak_mode,
  });
  return {
    set: defined({
      primaryGoal: s.primary_goal,
      taskType: s.task_type,
      targetAI: s.target_ai,
      operation: s.operation,
      deploymentPermission: s.deployment_permission,
      expectedOutputFormat: s.expected_output_format,
      expectedOutputDescription: s.expected_output_description,
      ...(Object.keys(flags).length ? { flags } : {}),
      ...(Object.keys(options).length ? { options } : {}),
    }),
    add: {
      secondaryGoals: output.add.secondary_goals,
      requirements: output.add.requirements,
      constraints: output.add.constraints,
      protectedElements: output.add.protected_elements,
      allowedOperations: output.add.allowed_operations,
      disallowedOperations: output.add.disallowed_operations,
      requiredActions: output.add.required_actions,
      assumptions: output.add.assumptions,
      unknowns: output.add.unknowns,
      successCriteria: output.add.success_criteria,
      contextFacts: output.add.context_facts,
    },
    removeIds: output.remove_item_ids,
    resolvedUnknowns: output.resolved_unknowns.map((r) => ({ unknownId: r.unknown_id, fact: r.fact })),
    memory: output.memory.map((entry) => ({ directive: entry.directive, kind: entry.kind, relatedItemTexts: entry.related_item_texts })),
    revokeMemoryIds: output.revoke_memory_ids,
  };
}
