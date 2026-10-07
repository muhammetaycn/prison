import type { ConcreteTarget } from "@/models/common";
import type { IntentAnalysis } from "@/models/intent";
import type { Operation, SpecFlags } from "@/models/spec";
import { FALLBACK_TASK_TYPE, listTaskTypes, resolveTaskProfile } from "@/core/task-types/registry";
import { fill, fold } from "@/core/text/normalize";
import { DOMAIN_HINTS, LOCAL_TEXT, PROTECTED_SIGNALS, STACK_PATTERN } from "@/templates/local-engine";
import { phrase } from "@/templates/phrases";
import { extractGoal, titleFromGoal } from "./goal";
import type { IntentInput } from "../types";

/**
 * Rule-based fallback analyzer, used only when no AI provider is configured.
 * It produces the same IntentAnalysis shape as the LLM path, so every downstream engine
 * (resolver, compiler, critic) behaves identically. Its understanding is shallower and the UI says so.
 */

const SIGNALS = {
  existing: /(mevcut|var olan|varolan|halihazirda|su anki|suanki|existing|current|my (site|app|project|repo|website|code|store))/,
  possessive: /(?<![a-z])(proje|site|websitesi|web sitesi|uygulama|app|kod|repo|sistem|sayfa|magaza|hesab|blog)[a-z]*?(m|im|um)(i|u|e|a|de|da|deki|daki|in|un)?(?![a-z])/,
  newSystem: /(sifirdan|yeni bir|yeni (proje|site|uygulama|sistem)|from scratch|new (app|project|site|website|system)|build (a|an) )/,
  preserve: /(bozmadan|bozma\b|bozulmadan|degistirmeden|dokunmadan|koru|without breaking|don'?t break|preserve|keep (the )?existing)/,
  codingHint: /(?<![a-z])(kod|code|implement|entegr|integrat|api|endpoint|repo|component|fonksiyon|function|script)/,
  deployPositive: /(deploy|canliya al|yayina al|production'?a|prod'?a|yayinla|publish)/,
  deployNegative:
    /((deploy|canli|yayin|production|prod)\S*\s+(etme|yapma|alma|etmesin|yapmasin|olmasin|izin verme)|(don'?t|do not|never|no) (deploy|publish|push))/,
  advice: /((sadece|yalnizca)\s+(oneri|tavsiye|analiz|incele|rapor)|only (suggest|recommend|advise|analy|review)|degisiklik yapma|(oneri|tavsiye)\s+(ver|sun))/,
  analysis: /(analiz|incele|degerlendir|analy|review|audit|denetle)/,
  research: /(arastir|research|kaynak|literatur)/,
  rewrite: /(sifirdan|from scratch|yeniden yaz|rewrite)/,
  implement: /(uygula|implement|degistir|apply)/,
};

const TARGET_SIGNALS: Array<[RegExp, ConcreteTarget]> = [
  [/(?<![a-z])codex/, "codex"],
  [/(?<![a-z])claude/, "claude"],
  [/(?<![a-z])(chat ?gpt|gpt)/, "gpt"],
  [/(?<![a-z])gemini/, "gemini"],
];

const stemCache = new Map<string, RegExp>();
function stemRegex(stem: string): RegExp {
  let re = stemCache.get(stem);
  if (!re) {
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![a-z0-9])${escaped}`);
    stemCache.set(stem, re);
  }
  return re;
}

export function detectTargetMention(folded: string): ConcreteTarget | null {
  for (const [pattern, target] of TARGET_SIGNALS) if (pattern.test(folded)) return target;
  return null;
}

export function scoreTaskTypes(folded: string, mentioned: ConcreteTarget | null): Array<{ id: string; score: number }> {
  return listTaskTypes().map((profile) => {
    let score = 0;
    for (const signal of profile.localSignals) {
      const [stem, weight] = typeof signal === "string" ? [signal, 1] : signal;
      if (stemRegex(stem).test(folded)) score += weight;
    }
    if (mentioned === "codex" && profile.id === "coding") score += 2;
    return { id: profile.id, score };
  });
}

function pickTaskTypes(scores: Array<{ id: string; score: number }>): { primary: string; secondary: string[] } {
  const max = Math.max(0, ...scores.map((s) => s.score));
  if (max === 0) return { primary: FALLBACK_TASK_TYPE, secondary: [] };
  const primary = scores.find((s) => s.score === max)!.id;
  const threshold = Math.max(2, max * 0.5);
  const secondary = scores
    .filter((s) => s.id !== primary && s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.id);
  return { primary, secondary };
}

function operationFor(flags: SpecFlags, family: string, fallback: Operation, primary: string): Operation {
  if (flags.adviceOnly) return "advise";
  if (flags.codingRequired && flags.existingSystem) return "modify_existing";
  if (flags.codingRequired && flags.newSystem) return "create_new";
  if (primary === "automation") return "automate";
  if (family === "analysis") return flags.researchRequired ? "research" : "analyze";
  return fallback;
}

export function analyzeIntentLocally(input: IntentInput): IntentAnalysis {
  const { rawRequest, language } = input;
  const folded = fold(rawRequest);
  const mentioned = detectTargetMention(folded);
  const { primary, secondary } = pickTaskTypes(scoreTaskTypes(folded, mentioned));
  const profile = resolveTaskProfile(primary);

  const existing = SIGNALS.existing.test(folded) || SIGNALS.possessive.test(folded);
  const isNew = !existing && SIGNALS.newSystem.test(folded);
  const deployNegated = SIGNALS.deployNegative.test(folded);
  const deployPositive = !deployNegated && SIGNALS.deployPositive.test(folded);
  const adviceOnly = SIGNALS.advice.test(folded);
  const engineeringBuild =
    profile.family === "engineering" && primary !== "security_analysis" && primary !== "ui_ux";
  const coding =
    !adviceOnly && (engineeringBuild || SIGNALS.codingHint.test(folded) || mentioned === "codex");

  const flags: SpecFlags = {
    existingSystem: existing,
    newSystem: isNew,
    preserveArchitecture: existing && SIGNALS.preserve.test(folded),
    executionRequired: coding || primary === "automation" || primary === "agent_task",
    analysisRequired: adviceOnly || profile.family === "analysis" || SIGNALS.analysis.test(folded),
    researchRequired: profile.family === "analysis" || SIGNALS.research.test(folded),
    codingRequired: coding,
    deploymentRequired: deployPositive,
    visualGenerationRequired: profile.family === "visual",
    adviceOnly,
  };

  const { goal, clauses } = extractGoal(rawRequest);
  const hints = DOMAIN_HINTS.filter((hint) => hint.pattern.test(folded));
  const domain = hints[0]?.domain[language] ?? profile.label[language].toLocaleLowerCase(language);
  const stack = [...new Set([...folded.matchAll(STACK_PATTERN)].map((m) => m[1]!))];

  const conflicts: string[] = [];
  if (flags.preserveArchitecture && SIGNALS.rewrite.test(folded)) conflicts.push(LOCAL_TEXT.conflictRewrite[language]);
  if (adviceOnly && (deployPositive || SIGNALS.implement.test(folded.replace(SIGNALS.advice, "")))) {
    conflicts.push(phrase("conflictAdviceExecution", language));
  }

  const contextSummary = existing
    ? fill(LOCAL_TEXT.contextExisting[language], { domain })
    : isNew
      ? fill(LOCAL_TEXT.contextNew[language], { domain })
      : "";

  return {
    title: titleFromGoal(goal),
    primary_goal: goal,
    secondary_goals: [],
    task_type: primary,
    secondary_task_types: secondary,
    domain,
    operation: operationFor(flags, profile.family, profile.defaultOperation, primary),
    target_ai_mentioned: mentioned,
    expected_output: { format: profile.expectedFormat[language], description: "", deliverables: [] },
    existing_system: flags.existingSystem,
    new_system: flags.newSystem,
    preserve_architecture: flags.preserveArchitecture,
    execution_required: flags.executionRequired,
    analysis_required: flags.analysisRequired,
    research_required: flags.researchRequired,
    coding_required: flags.codingRequired,
    deployment_required: flags.deploymentRequired,
    deployment_permission: deployNegated ? "forbidden" : deployPositive ? "allowed" : "unspecified",
    visual_generation_required: flags.visualGenerationRequired,
    advice_only: adviceOnly,
    role: profile.role[language],
    context_summary: contextSummary,
    current_system: "",
    known_facts: stack.map((tech) => fill(LOCAL_TEXT.mentionedTech[language], { tech })),
    explicit_requirements: clauses.length > 1 ? clauses : [],
    implicit_requirements: [
      ...hints.flatMap((hint) => hint.implicitRequirements.map((t) => t[language])),
    ],
    constraints: adviceOnly ? [phrase("adviceOnly", language)] : [],
    protected_elements: PROTECTED_SIGNALS.filter((s) => s.pattern.test(folded)).map((s) => s.text[language]),
    allowed_operations: [],
    disallowed_operations: [
      ...(deployNegated ? [phrase("denyDeploy", language)] : []),
      ...(adviceOnly ? [phrase("denyDirectChanges", language)] : []),
    ],
    required_actions: [],
    assumptions: existing && coding ? [phrase("assumeRepoAccess", language)] : [],
    unknowns: [
      ...hints.flatMap((hint) => hint.unknowns.map((t) => t[language])),
      ...(existing && coding && stack.length === 0 ? [phrase("unknownStack", language)] : []),
    ],
    conflicts,
    success_conditions: [],
    execution_plan: null,
  };
}
