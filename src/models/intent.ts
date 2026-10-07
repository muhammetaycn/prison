import { z } from "zod";
import { DEPLOYMENT_PERMISSIONS, OPERATIONS } from "./spec";
import { CONCRETE_TARGETS } from "./common";

/** Helper for resilient string array parsing from LLMs */
const strListResilient = z.preprocess((val) => {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string" && val.trim()) return [val.trim()];
  return [];
}, z.array(z.string()));

/** Helper for resilient boolean parsing */
const boolResilient = z.preprocess((val) => {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return /^(true|yes|1|allow|allowed)$/i.test(val.trim());
  return Boolean(val);
}, z.boolean());

/** Helper for resilient string parsing */
const strResilient = z.preprocess((val) => (val === null || val === undefined ? "" : String(val)), z.string());

/** Helper for expected_output */
const expectedOutputResilient = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    return {
      format: String(obj.format || "text"),
      description: String(obj.description || ""),
      deliverables: Array.isArray(obj.deliverables) ? obj.deliverables.map(String) : [],
    };
  }
  if (typeof val === "string" && val.trim()) {
    return { format: val.trim(), description: "", deliverables: [] };
  }
  return { format: "text", description: "", deliverables: [] };
}, z.object({
  format: z.string(),
  description: z.string(),
  deliverables: z.array(z.string()),
}));

/** A concise, actionable method for the target AI; never a transcript of hidden reasoning. */
export const ExecutionPlanSchema = z.object({
  approach: z.string().min(1),
  steps: z.array(z.object({
    action: z.string().min(1),
    purpose: z.string().min(1),
    verification: z.string().min(1),
  })).min(2).max(8),
  clarifying_questions: z.array(z.string().min(1)).max(6),
  recommended_target: z.enum(CONCRETE_TARGETS),
  target_rationale: z.string().min(1),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

/**
 * Structured output of the Intent Engine.
 *
 * snake_case on purpose: this is the wire format exchanged with LLMs (structured outputs).
 * Every field is required and nullable instead of optional so the schema is valid for
 * strict structured-output modes. The requirement resolver maps it to the camelCase PrisonSpec.
 */
function intentShape<T extends z.ZodType<string>>(taskType: T) {
  return z.object({
    title: strResilient,
    primary_goal: strResilient,
    secondary_goals: strListResilient,
    task_type: z.preprocess((val) => (typeof val === "string" ? val : "general_reasoning"), taskType),
    secondary_task_types: strListResilient,
    domain: strResilient,
    operation: z.preprocess((val) => (typeof val === "string" && (OPERATIONS as readonly string[]).includes(val) ? val : "other"), z.enum(OPERATIONS)),
    target_ai_mentioned: z.preprocess(
      (val) => (typeof val === "string" && (CONCRETE_TARGETS as readonly string[]).includes(val) ? val : null),
      z.enum(CONCRETE_TARGETS).nullable(),
    ),
    expected_output: expectedOutputResilient,
    existing_system: boolResilient,
    new_system: boolResilient,
    preserve_architecture: boolResilient,
    execution_required: boolResilient,
    analysis_required: boolResilient,
    research_required: boolResilient,
    coding_required: boolResilient,
    deployment_required: boolResilient,
    deployment_permission: z.preprocess(
      (val) => (typeof val === "string" && (DEPLOYMENT_PERMISSIONS as readonly string[]).includes(val) ? val : "unspecified"),
      z.enum(DEPLOYMENT_PERMISSIONS),
    ),
    visual_generation_required: boolResilient,
    advice_only: boolResilient,
    role: strResilient,
    context_summary: strResilient,
    current_system: strResilient,
    known_facts: strListResilient,
    explicit_requirements: strListResilient,
    implicit_requirements: strListResilient,
    constraints: strListResilient,
    protected_elements: strListResilient,
    allowed_operations: strListResilient,
    disallowed_operations: strListResilient,
    required_actions: strListResilient,
    assumptions: strListResilient,
    unknowns: strListResilient,
    conflicts: strListResilient,
    success_conditions: strListResilient,
    // Old saved intents predate the planning contract. New provider output must include a complete plan.
    execution_plan: ExecutionPlanSchema.nullable().default(null),
  });
}

/** Source choices preserve the owner's words; model paraphrases belong in semantic fields. */
function ownerSourceQuotes(rawRequest?: string): string[] {
  const text = rawRequest?.replace(/\s+/gu, " ").trim() ?? "";
  const candidates = [text, ...text.split(/(?<=[.!?;])\s+/gu), ...(rawRequest?.split(/[\r\n]+/gu) ?? [])];
  const choices = new Set<string>();
  let totalCharacters = 0;
  for (const candidate of candidates) {
    const quote = candidate.replace(/\s+/gu, " ").trim();
    if (!quote || quote.length > 2000 || choices.has(quote)) continue;
    if (choices.size >= 96) break;
    if (totalCharacters + quote.length > 24000) continue;
    choices.add(quote);
    totalCharacters += quote.length;
  }
  return [...choices];
}

/** Strict new provider output; saved intents keep the resilient schema below. */
export function buildIntentSchema(taskTypeIds: readonly string[], rawRequest?: string) {
  if (taskTypeIds.length === 0) throw new Error("At least one task type must be registered");
  const nonblank = z.string().trim().min(1);
  const quoteChoices = ownerSourceQuotes(rawRequest);
  const ownerSources = quoteChoices.length ? z.array(z.enum(quoteChoices)).max(20) : z.array(z.string()).max(0);
  const sourceNarrative = z.enum(["", ...quoteChoices]);
  return intentShape(z.enum(taskTypeIds as [string, ...string[]])).extend({
    title: nonblank,
    primary_goal: nonblank,
    role: nonblank,
    required_actions: z.array(nonblank).min(2).max(8),
    success_conditions: z.array(nonblank).min(1).max(12),
    expected_output: z.object({
      format: z.string(),
      description: z.string(),
      deliverables: z.array(nonblank).min(1).max(12),
    }),
    known_facts: ownerSources,
    explicit_requirements: ownerSources,
    context_summary: sourceNarrative,
    current_system: sourceNarrative,
    execution_plan: ExecutionPlanSchema,
  });
}

/** Schema used when reading a stored intent back (task types may have been added or removed since). */
export const IntentAnalysisSchema = intentShape(z.string());
export type IntentAnalysis = z.infer<typeof IntentAnalysisSchema>;

export const ENGINE_MODES = ["ai", "local"] as const;
export const EngineInfoSchema = z.object({
  mode: z.enum(ENGINE_MODES),
  provider: z.string(),
  model: z.string().nullable(),
});
export type EngineInfo = z.infer<typeof EngineInfoSchema>;
