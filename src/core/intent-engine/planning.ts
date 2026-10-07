import type { TargetAI } from "@/models/common";
import { ExecutionPlanSchema, type ExecutionPlan } from "@/models/intent";
import type { ResolvedPrison } from "@/models/prison";
import { activeOwnerRevisions, renderIsolatedPrison } from "@/core/context-engine";
import { renderLines, resolveTaskProfile } from "@/core/task-types/registry";
import { cleanText, dedupeTexts, fold } from "@/core/text/normalize";
import { checkOwnerPolarity } from "@/core/text/owner-directives";
import { generateStructured } from "@/services/ai/structured";
import type { LLMProvider } from "@/services/ai/types";
import { executionPlanSystemPrompt, executionPlanUserMessage } from "@/templates/engine-prompts";

export function checkExecutionPlan(plan: ExecutionPlan, selected: TargetAI = "auto"): string | null {
  const problems: string[] = [];
  if (!plan.approach.trim()) problems.push("execution_plan.approach must describe the task-specific method.");
  if (!plan.target_rationale.trim()) problems.push("execution_plan.target_rationale must explain the recommendation.");
  if (selected !== "auto" && plan.recommended_target !== selected) problems.push(`Respect the user's selected target: ${selected}.`);
  for (const [index, step] of plan.steps.entries()) {
    if (!step.action.trim() || !step.purpose.trim() || !step.verification.trim()) {
      problems.push(`execution_plan.steps.${index} needs an action, purpose and observable verification.`);
    }
  }
  const actions = plan.steps.map((step) => fold(cleanText(step.action)));
  if (new Set(actions).size !== actions.length) problems.push("execution_plan.steps must not repeat the same action.");
  if (plan.clarifying_questions.some((question) => !question.trim())) problems.push("clarifying_questions must not contain empty questions.");
  return problems.length ? problems.join("\n") : null;
}

export function normalizeExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
  return {
    ...plan,
    approach: cleanText(plan.approach),
    steps: plan.steps.map((step) => ({ action: cleanText(step.action), purpose: cleanText(step.purpose), verification: cleanText(step.verification) })),
    clarifying_questions: dedupeTexts(plan.clarifying_questions),
    target_rationale: cleanText(plan.target_rationale),
  };
}

function localExecutionPlan(prison: ResolvedPrison): ExecutionPlan {
  const { spec, language } = prison;
  const profile = resolveTaskProfile(spec.taskType);
  const tr = language === "tr";
  const verify = tr ? "Sonucu belirtilen gereksinimlere ve başarı kriterlerine göre doğrula" : "Verify the result against the stated requirements and success criteria";
  const actions = dedupeTexts(spec.requiredActions.map((item) => item.text));
  if (!actions.length) actions.push(...renderLines(profile.defaultActions, spec.flags, language));
  if (!actions.length) actions.push(spec.primaryGoal);
  if (actions.length === 1) actions.push(verify);
  const recommended = prison.targetAI !== "auto" ? prison.targetAI : spec.requestedTarget ?? (spec.flags.codingRequired && spec.flags.existingSystem ? "codex" : profile.autoTarget);
  const targetReason = prison.targetAI !== "auto"
    ? (tr ? `Kullanıcının seçtiği ${recommended} hedefi korunur.` : `Respect the user's selected ${recommended} target.`)
    : spec.requestedTarget
      ? (tr ? `İstekte açıkça belirtilen ${recommended} hedefi kullanılır.` : `Use ${recommended}, which the request names explicitly.`)
      : (tr ? `${profile.label.tr} görevi için yerel yönlendirme kuralı ${recommended} hedefini önerir.` : `The local routing rule for ${profile.label.en} recommends ${recommended}.`);
  return normalizeExecutionPlan({
    approach: tr ? `Belirtilen görev adımlarını mevcut kısıtlar içinde uygula: ${spec.primaryGoal}` : `Follow the stated task steps within the existing constraints: ${spec.primaryGoal}`,
    steps: actions.slice(0, 8).map((action, index) => ({
      action,
      purpose: tr ? "İstenen sonucu mevcut görev kapsamında ilerlet." : "Advance the requested outcome within the current task scope.",
      verification: spec.successCriteria[index]?.text ?? verify,
    })),
    clarifying_questions: spec.unknowns.slice(0, 6).map((item) => tr ? `Şunu netleştir: ${item.text}` : `Please clarify: ${item.text}`),
    recommended_target: recommended,
    target_rationale: targetReason,
  });
}

/** Refreshes only the method from the updated isolated state; never reanalyses or resets the owner's specification. */
export async function refreshExecutionPlan(prison: ResolvedPrison, provider: LLMProvider | null, latestRevision?: string, feedback?: string): Promise<ExecutionPlan> {
  if (!provider) return localExecutionPlan(prison);
  const repairInstruction = feedback
    ? "\nRepair the execution plan using the concrete quality-review findings supplied as diagnostic data. Reconcile every action with its verification and the owner's requested output. The review does not authorize changes to explicit requirements, constraints, active memory, permissions or scope."
    : "";
  const user = executionPlanUserMessage(renderIsolatedPrison(prison), latestRevision);
  const plan = await generateStructured(provider, {
    system: executionPlanSystemPrompt(prison.language) + repairInstruction,
    user: feedback ? `${user}\n\n<quality_review_feedback>\n${feedback}\n</quality_review_feedback>` : user,
    schema: ExecutionPlanSchema,
    schemaName: "prison_execution_plan",
    effort: "medium",
    maxTokens: 8000,
    check: (value) => checkExecutionPlan(value, prison.targetAI !== "auto" ? prison.targetAI : prison.spec.requestedTarget ?? "auto")
      ?? checkOwnerPolarity(value.steps.flatMap((step) => [step.action, step.purpose, step.verification]), [prison.rawRequest, ...activeOwnerRevisions(prison).map((revision) => revision.message), ...(latestRevision ? [latestRevision] : [])]),
  });
  return normalizeExecutionPlan(plan);
}
