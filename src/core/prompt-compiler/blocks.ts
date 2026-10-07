import type { BlockId, PromptBlock } from "@/models/prompt";
import type { SpecItem } from "@/models/spec";
import type { CompileContext } from "@/adapters/types";
import { renderLines } from "@/core/task-types/registry";
import { isAdvisoryTask, taskBehaviorTexts } from "@/core/task-types/behavior";
import { dedupeTexts, ensureSentence, fill } from "@/core/text/normalize";
import { FAMILY_TEMPLATES } from "@/templates/families";
import { phrase, type PhraseKey } from "@/templates/phrases";
import { isBoundaryDirective } from "./boundaries";
import { executionContextDirective } from "./execution-context";

/**
 * Block builders. Each one reads ONLY the compile context (one prison's normalized state,
 * its options and the central templates) and returns a block or null when it has nothing to say.
 */
type BlockBuilder = (ctx: CompileContext) => PromptBlock | null;

const texts = (items: SpecItem[]) => items.map((item) => item.text);
const p = (ctx: CompileContext, key: PhraseKey) => phrase(key, ctx.language);
const isTechnical = (ctx: CompileContext) => ctx.input.options.technicality === "technical";
const isDetailed = (ctx: CompileContext) => ctx.input.options.verbosity === "detailed";
const isEngineering = (ctx: CompileContext) =>
  ctx.profile.family === "engineering" || ctx.input.spec.flags.codingRequired;

/** Older saved tasks may still contain implementation defaults; retain every non-default item. */
function behaviorItems(ctx: CompileContext, items: SpecItem[], defaults: "defaultActions" | "successCriteria"): string[] {
  return taskBehaviorTexts(ctx.input.spec, items, ctx.profile[defaults], ctx.language);
}

function hasBoundaries(ctx: CompileContext): boolean {
  const s = ctx.input.spec;
  return s.constraints.length + s.protectedElements.length + s.disallowedOperations.length > 0;
}

export const BLOCK_BUILDERS: Record<BlockId, BlockBuilder> = {
  ROLE: (ctx) => ({
    id: "ROLE",
    text: fill(p(ctx, "roleLine"), { role: ctx.input.spec.role || ctx.profile.role[ctx.language] }),
    notes: [executionContextDirective(ctx.input.options.executionContext, ctx.language)],
  }),

  OBJECTIVE: (ctx) => {
    const goals = texts(ctx.input.spec.secondaryGoals);
    const notes: string[] = [];
    if (isDetailed(ctx)) notes.push(p(ctx, "detailedObjectiveNote"));
    return {
      id: "OBJECTIVE",
      text: ensureSentence(ctx.input.spec.primaryGoal),
      ...(goals.length ? { itemsLabel: p(ctx, "secondaryGoalsIntro"), items: goals } : {}),
      ...(notes.length ? { notes } : {}),
    };
  },

  CONTEXT: (ctx) => {
    const s = ctx.input.spec;
    const facts = texts(s.contextFacts);
    if (!s.contextSummary && facts.length === 0) return null;
    const notes: string[] = [];
    if (isDetailed(ctx)) notes.push(p(ctx, "detailedContextNote"));
    return {
      id: "CONTEXT",
      ...(s.contextSummary ? { text: ensureSentence(s.contextSummary) } : {}),
      ...(facts.length ? { itemsLabel: s.contextSummary ? p(ctx, "contextFactsIntro") : undefined, items: facts } : {}),
      ...(notes.length ? { notes } : {}),
    };
  },

  CURRENT_SYSTEM: (ctx) => {
    const s = ctx.input.spec;
    if (!s.flags.existingSystem) return null;
    return {
      id: "CURRENT_SYSTEM",
      text: s.currentSystem ? ensureSentence(s.currentSystem) : p(ctx, "currentSystemUnknown"),
      notes: [p(ctx, "currentSystemGuard")],
    };
  },

  USER_INTENT: (ctx) => ({
    id: "USER_INTENT",
    intro: p(ctx, "userIntentIntro"),
    text: ctx.input.rawRequest.trim(),
    quote: true,
    ...(ctx.input.ownerDirectives?.length ? {
      itemsLabel: {
        en: "Latest owner instructions (chronological):",
        tr: "Kullanıcının son talimatları (kronolojik):",
        zh: "用户的最新指示（按时间顺序）：",
      }[ctx.language],
      items: ctx.input.ownerDirectives,
      notes: [{
        en: "Explicit numbers, limits and answers in these instructions take precedence over inferred summaries. A later explicit change supersedes the earlier preference; clarify any genuine unresolved conflict.",
        tr: "Bu talimatlardaki açık sayılar, sınırlar ve yanıtlar çıkarımlardan önceliklidir. Sonraki talimat önceki tercihi açıkça değiştirirse güncel tercihi uygula; çözülemeyen gerçek bir çelişkiyi netleştir.",
        zh: "这些指示中明确的数字、限制和回答优先于推断出的摘要。后来的明确修改取代先前的偏好；对确实无法调和的冲突要加以澄清。",
      }[ctx.language]],
    } : {}),
  }),

  TASK: (ctx) => {
    const plan = ctx.input.spec.taskPlan;
    const steps = plan?.steps.map((step) => ({
      en: `${step.action} Purpose: ${step.purpose} Verify: ${step.verification}`,
      tr: `${step.action} Amaç: ${step.purpose} Kontrol: ${step.verification}`,
      zh: `${step.action} 目的：${step.purpose} 验证：${step.verification}`,
    })[ctx.language]) ?? [];
    const actions = dedupeTexts(steps.length ? steps : behaviorItems(ctx, ctx.input.spec.requiredActions, "defaultActions"));
    if (!actions.length) return null;
    return { id: "TASK", intro: p(ctx, "taskIntro"), ...(plan?.approach ? { text: plan.approach } : {}), items: actions, ordered: true };
  },

  REQUIREMENTS: (ctx) => {
    const items = texts(ctx.input.spec.requirements);
    return items.length ? { id: "REQUIREMENTS", items } : null;
  },

  CONSTRAINTS: (ctx) => {
    const items = dedupeTexts([
      ...texts(ctx.input.spec.constraints),
      ...texts(ctx.input.spec.disallowedOperations).filter(isBoundaryDirective),
    ]);
    if (isTechnical(ctx)) {
      items.push(isEngineering(ctx) ? p(ctx, "technicalPrecision") : p(ctx, "technicalPrecisionGeneral"));
    }
    const notes: string[] = [];
    if (hasBoundaries(ctx)) notes.push(p(ctx, "scopePrinciple"));
    if (ctx.input.options.scope === "strict") notes.push(p(ctx, "scopeStrict"));
    if (ctx.input.options.scope === "open") notes.push(p(ctx, "scopeOpen"));
    if (isDetailed(ctx)) notes.push(p(ctx, "detailedConstraintsNote"));
    if (!items.length && !notes.length) return null;
    return { id: "CONSTRAINTS", items, notes };
  },

  PROTECTED_ELEMENTS: (ctx) => {
    const items = texts(ctx.input.spec.protectedElements);
    return items.length ? { id: "PROTECTED_ELEMENTS", intro: p(ctx, "protectedIntro"), items } : null;
  },

  ALLOWED_OPERATIONS: (ctx) => {
    const items = texts(ctx.input.spec.allowedOperations);
    if (!items.length) return null;
    const strict = ctx.input.options.scope === "strict";
    return { id: "ALLOWED_OPERATIONS", intro: p(ctx, strict ? "allowedIntroStrict" : "allowedIntro"), items };
  },

  DO_NOT_DO: (ctx) => {
    const items = texts(ctx.input.spec.disallowedOperations).filter((item) => !isBoundaryDirective(item));
    if (ctx.input.options.scope === "strict" && isEngineering(ctx)) {
      items.push(p(ctx, "strictNoExtras"), p(ctx, "strictNoUnrelated"));
    }
    const unique = dedupeTexts(items);
    return unique.length ? { id: "DO_NOT_DO", intro: p(ctx, "doNotIntro"), items: unique } : null;
  },

  ASSUMPTIONS: (ctx) => {
    const items = texts(ctx.input.spec.assumptions);
    return items.length ? { id: "ASSUMPTIONS", intro: p(ctx, "assumptionsIntro"), items } : null;
  },

  UNKNOWNS: (ctx) => {
    const s = ctx.input.spec;
    const conflicts = texts(s.conflicts).map((c) => `${p(ctx, "conflictPrefix")}${c}`);
    const items = dedupeTexts([...texts(s.unknowns), ...(s.taskPlan?.clarifyingQuestions ?? []), ...conflicts]);
    if (!items.length) return null;
    return {
      id: "UNKNOWNS",
      intro: p(ctx, "unknownsIntro"),
      items,
      notes: conflicts.length ? [p(ctx, "conflictGuidance")] : [],
    };
  },

  EXECUTION_PROTOCOL: (ctx) => {
    const { flags } = ctx.input.spec;
    if (ctx.input.options.agentMode) {
      const items = renderLines(ctx.profile.agentProtocol, flags, ctx.language);
      if (!items.length) return null;
      return {
        id: "EXECUTION_PROTOCOL",
        intro: p(ctx, "agentIntro"),
        items,
        ordered: true,
        notes: [p(ctx, "agentStop")],
      };
    }
    const items = renderLines(ctx.profile.protocols.EXECUTION_PROTOCOL ?? [], flags, ctx.language);
    if (isDetailed(ctx)) items.push(p(ctx, "detailedExplanationNote"));
    return items.length ? { id: "EXECUTION_PROTOCOL", items, ordered: true } : null;
  },

  RESEARCH_PROTOCOL: (ctx) => {
    const lines = ctx.profile.protocols.RESEARCH_PROTOCOL ?? FAMILY_TEMPLATES.analysis.protocols.RESEARCH_PROTOCOL ?? [];
    const items = renderLines(lines, ctx.input.spec.flags, ctx.language);
    return items.length ? { id: "RESEARCH_PROTOCOL", items, ordered: true } : null;
  },

  TEST_PROTOCOL: (ctx) => {
    if (isAdvisoryTask(ctx.input.spec)) return null;
    const lines = ctx.profile.protocols.TEST_PROTOCOL ?? FAMILY_TEMPLATES.engineering.protocols.TEST_PROTOCOL ?? [];
    const items = renderLines(lines, ctx.input.spec.flags, ctx.language);
    if (isTechnical(ctx)) items.push(p(ctx, "technicalTestReport"));
    return items.length ? { id: "TEST_PROTOCOL", items } : null;
  },

  VALIDATION_PROTOCOL: (ctx) => {
    const items = renderLines(ctx.profile.protocols.VALIDATION_PROTOCOL ?? [], ctx.input.spec.flags, ctx.language);
    if (isTechnical(ctx)) items.push(p(ctx, "technicalValidation"));
    if (isDetailed(ctx)) items.push(p(ctx, "detailedVerificationNote"));
    return items.length ? { id: "VALIDATION_PROTOCOL", items } : null;
  },

  OUTPUT_CONTRACT: (ctx) => {
    const { expectedOutput, flags } = ctx.input.spec;
    const defaults = renderLines(ctx.profile.outputContract, flags, ctx.language);
    const deliverables = expectedOutput.deliverables;
    // Detail changes explanation depth; it must not append unrelated family artifacts
    // (for example exercises and solved examples to a requested weekly schedule table).
    const useDefaults = deliverables.length === 0;
    const items = dedupeTexts([
      ...(expectedOutput.format ? [fill(p(ctx, "outputFormat"), { format: expectedOutput.format })] : []),
      ...deliverables,
      ...(useDefaults ? defaults : []),
    ]);
    if (!expectedOutput.description && !items.length) return null;
    return {
      id: "OUTPUT_CONTRACT",
      ...(expectedOutput.description ? { text: ensureSentence(expectedOutput.description) } : {}),
      items,
      notes: [p(ctx, "outputFormatPriority")],
    };
  },

  SUCCESS_CRITERIA: (ctx) => {
    const items = behaviorItems(ctx, ctx.input.spec.successCriteria, "successCriteria");
    return items.length ? { id: "SUCCESS_CRITERIA", items } : null;
  },
};
