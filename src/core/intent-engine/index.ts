import { buildIntentSchema, type EngineInfo, type IntentAnalysis } from "@/models/intent";
import { FALLBACK_TASK_TYPE, isTaskType, taskTypeCatalog, taskTypeIds } from "@/core/task-types/registry";
import { cleanText, dedupeTexts, fold } from "@/core/text/normalize";
import { checkOwnerPolarity } from "@/core/text/owner-directives";
import { generateStructured } from "@/services/ai/structured";
import type { LLMProvider } from "@/services/ai/types";
import { intentSystemPrompt, intentUserMessage } from "@/templates/engine-prompts";
import { analyzeIntentLocally } from "./local/analyzer";
import { checkExecutionPlan, normalizeExecutionPlan } from "./planning";
import type { IntentInput, IntentResult } from "./types";

export type { IntentInput, IntentResult } from "./types";

export const LOCAL_ENGINE_INFO: EngineInfo = { mode: "local", provider: "local", model: null };

const MAX_ITEMS_PER_LIST = 20;

/**
 * Intent Engine: natural-language request → validated IntentAnalysis.
 * With a provider it performs semantic analysis through structured output. Local analysis
 * is used only when no provider is configured; provider failures remain visible to the caller.
 */
export async function analyzeIntent(input: IntentInput, provider: LLMProvider | null): Promise<IntentResult> {
  if (!provider) {
    return { intent: normalizeIntent(analyzeIntentLocally(input)), engine: LOCAL_ENGINE_INFO };
  }

  const intent = await generateStructured(provider, {
    system: intentSystemPrompt(input.language, taskTypeCatalog()),
    user: intentUserMessage(input.rawRequest, input.targetAI, input.language),
    schema: buildIntentSchema(taskTypeIds(), input.rawRequest),
    schemaName: "prison_intent",
    effort: "medium",
    maxTokens: 8000,
    check: (value) => checkIntent(value, input),
  });
  return { intent: normalizeIntent(intent), engine: provider.info };
}

/** Semantic checks the JSON schema cannot express. Failures trigger one corrective retry. */
export function checkIntent(intent: IntentAnalysis, input?: IntentInput): string | null {
  const problems: string[] = [];
  if (!intent.primary_goal.trim()) problems.push("primary_goal must not be empty.");
  if (/^(?:write|create|generate|make|produce|craft)\s+(?:me\s+)?(?:(?:a|an|the)\s+)?(?:(?:codex|claude|gpt|chatgpt|gemini)\s+)?prompt\s+(?:that|which|to|for)\b/.test(fold(cleanText(intent.primary_goal)))) {
    problems.push("primary_goal must describe the underlying target-AI task, not the request to write a prompt for that task.");
  }
  if (!intent.title.trim()) problems.push("title must not be empty.");
  if (!intent.role.trim()) problems.push("role must not be empty.");
  if (!intent.required_actions.some((action) => action.trim())) problems.push("required_actions must include concrete steps for the underlying task.");
  if (!intent.success_conditions.some((condition) => condition.trim())) problems.push("success_conditions must include observable completion criteria.");
  if (!intent.expected_output.deliverables.some((deliverable) => deliverable.trim())) problems.push("expected_output.deliverables must state what the target AI should hand back.");
  if (!intent.execution_plan) problems.push("execution_plan must describe the actionable task method.");
  else {
    const selected = input?.targetAI && input.targetAI !== "auto" ? input.targetAI : intent.target_ai_mentioned ?? "auto";
    const planProblems = checkExecutionPlan(intent.execution_plan, selected);
    if (planProblems) problems.push(planProblems);
    if (intent.unknowns.some((unknown) => unknown.trim())
      && !(intent.existing_system && intent.coding_required)
      && !intent.execution_plan.clarifying_questions.some((question) => question.trim())) {
      problems.push("execution_plan.clarifying_questions must include at least one question for unresolved unknowns in a planning, content, advice or other non-repository task; do not invent the missing facts.");
    }
  }
  if (intent.advice_only && intent.deployment_required) {
    problems.push("advice_only and deployment_required cannot both be true; record the contradiction in conflicts instead.");
  }
  if (input) {
    const polarity = checkOwnerPolarity([
      ...intent.secondary_goals, ...intent.explicit_requirements, ...intent.implicit_requirements,
      ...intent.constraints, ...intent.protected_elements, ...intent.required_actions,
      ...intent.assumptions, ...intent.known_facts, ...intent.success_conditions,
      ...(intent.execution_plan?.steps.flatMap((step) => [step.action, step.purpose, step.verification]) ?? []),
    ], [input.rawRequest]);
    if (polarity) problems.push(polarity);
  }
  return problems.length ? problems.join("\n") : null;
}

function list(values: string[]): string[] {
  return dedupeTexts(values).slice(0, MAX_ITEMS_PER_LIST);
}

function sourceList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.replace(/\s+/gu, " ").trim()).filter(Boolean))].slice(0, MAX_ITEMS_PER_LIST);
}

/** Trims, deduplicates and bounds every field. Never trusts raw model output shape beyond the schema. */
export function normalizeIntent(intent: IntentAnalysis): IntentAnalysis {
  const taskType = isTaskType(intent.task_type) ? intent.task_type : FALLBACK_TASK_TYPE;
  return {
    ...intent,
    title: cleanText(intent.title).slice(0, 80),
    primary_goal: cleanText(intent.primary_goal),
    secondary_goals: list(intent.secondary_goals),
    task_type: taskType,
    secondary_task_types: [...new Set(intent.secondary_task_types)].filter((t) => t !== taskType && isTaskType(t)),
    domain: cleanText(intent.domain),
    expected_output: {
      format: cleanText(intent.expected_output.format),
      description: cleanText(intent.expected_output.description),
      deliverables: list(intent.expected_output.deliverables),
    },
    role: cleanText(intent.role).replace(/[.]+$/, ""),
    context_summary: cleanText(intent.context_summary),
    current_system: cleanText(intent.current_system),
    known_facts: sourceList(intent.known_facts),
    explicit_requirements: sourceList(intent.explicit_requirements),
    implicit_requirements: list(intent.implicit_requirements),
    constraints: list(intent.constraints),
    protected_elements: list(intent.protected_elements),
    allowed_operations: list(intent.allowed_operations),
    disallowed_operations: list(intent.disallowed_operations),
    required_actions: list(intent.required_actions),
    assumptions: list(intent.assumptions),
    unknowns: list(intent.unknowns),
    conflicts: list(intent.conflicts),
    success_conditions: list(intent.success_conditions),
    execution_plan: intent.execution_plan ? normalizeExecutionPlan(intent.execution_plan) : null,
  };
}
