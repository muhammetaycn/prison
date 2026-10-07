import type { Language } from "@/models/common";
import type { ExecutionPlan, IntentAnalysis } from "@/models/intent";
import type { ItemListKey, ItemSource, PrisonSpec, SpecFlags, TaskPlan } from "@/models/spec";
import { renderLines, resolveTaskProfile } from "@/core/task-types/registry";
import { adaptTaskBehavior, isAdvisoryTask } from "@/core/task-types/behavior";
import type { ResolvedTaskProfile } from "@/core/task-types/types";
import { cleanText, ensureSentence, fold } from "@/core/text/normalize";
import { addItems, ItemAllocator } from "@/core/prison-engine/items";
import { phrase, type PhraseKey } from "@/templates/phrases";

export interface ResolveInput {
  intent: IntentAnalysis;
  language: Language;
  itemSeq: number;
}

export interface ResolveResult {
  spec: PrisonSpec;
  itemSeq: number;
}

export function toTaskPlan(plan: ExecutionPlan | null): TaskPlan | null {
  return plan ? {
    approach: plan.approach,
    steps: plan.steps,
    clarifyingQuestions: plan.clarifying_questions,
    recommendedTarget: plan.recommended_target,
    targetRationale: plan.target_rationale,
  } : null;
}

/** Topic detectors used to avoid adding a default that the intent already covers in other words. */
const TOPICS = {
  deploy: /(deploy|publish|production|release|yayin|canli|prod)/,
  architecture: /(architect|mimari|framework|stack)/,
  features: /(feature|ozellik|islev|function|flow|akis|behavio|davranis)/,
  interfaces: /(interface|arayuz|route|url|api|contract|sozlesme)/,
  rewrite: /(rewrite|scratch|sifirdan|yeniden yaz)/,
  switchStack: /(switch|degistir|replace).*(framework|library|kutuphane|language|dil|stack)|(framework|library|kutuphane|stack).*(switch|degistir|replace)/,
  refactor: /(refactor|formatting|bicimlendir)/,
  minimal: /(minim|smallest|en kucuk|gerekli olan en az)/,
  directChanges: /(directly|dogrudan|apply changes|uygulama)/,
};

function mentions(spec: PrisonSpec, list: ItemListKey, topic: RegExp): boolean {
  return spec[list].some((item) => topic.test(fold(item.text)));
}

export function specFlagsFromIntent(intent: IntentAnalysis): SpecFlags {
  return {
    existingSystem: intent.existing_system,
    newSystem: intent.new_system,
    preserveArchitecture: intent.preserve_architecture,
    executionRequired: intent.execution_required,
    analysisRequired: intent.analysis_required,
    researchRequired: intent.research_required,
    codingRequired: intent.coding_required,
    deploymentRequired: intent.deployment_required,
    visualGenerationRequired: intent.visual_generation_required,
    adviceOnly: intent.advice_only,
  };
}

export function emptySpec(intent: IntentAnalysis, profile: ResolvedTaskProfile, language: Language): PrisonSpec {
  return {
    primaryGoal: ensureSentence(intent.primary_goal),
    taskType: profile.id,
    secondaryTaskTypes: intent.secondary_task_types,
    operation: intent.operation,
    domain: intent.domain,
    role: cleanText(intent.role) || profile.role[language],
    contextSummary: intent.context_summary,
    currentSystem: intent.current_system,
    requestedTarget: intent.target_ai_mentioned,
    taskPlan: toTaskPlan(intent.execution_plan),
    deploymentPermission: intent.deployment_permission,
    flags: specFlagsFromIntent(intent),
    expectedOutput: {
      format: intent.expected_output.format || profile.expectedFormat[language],
      description: intent.expected_output.description,
      deliverables: intent.expected_output.deliverables,
    },
    secondaryGoals: [],
    requirements: [],
    constraints: [],
    protectedElements: [],
    allowedOperations: [],
    disallowedOperations: [],
    requiredActions: [],
    assumptions: [],
    unknowns: [],
    successCriteria: [],
    contextFacts: [],
    conflicts: [],
  };
}

/**
 * Requirement Resolver: maps a validated intent onto the prison spec and applies the
 * task-profile and safety defaults (existing-system protections, no deployment unless asked,
 * advice-only guards, success criteria). Never invents task facts: defaults come from templates
 * and are tagged with source "default" so they stay distinguishable from what the user said.
 */
export function resolveRequirements({ intent, language, itemSeq }: ResolveInput): ResolveResult {
  const profile = adaptTaskBehavior(resolveTaskProfile(intent.task_type), { operation: intent.operation, flags: specFlagsFromIntent(intent) });
  const ids = new ItemAllocator(itemSeq);
  let spec = emptySpec(intent, profile, language);

  const add = (list: ItemListKey, texts: string[], source: ItemSource) => {
    spec = addItems(spec, list, texts, source, ids).spec;
  };

  // Only the literal-source fields prove owner provenance; semantic subgoals are model interpretations.
  add("secondaryGoals", intent.secondary_goals, "implicit");
  add("requirements", intent.explicit_requirements, "explicit");
  add("requirements", intent.implicit_requirements, "implicit");
  add("constraints", intent.constraints, "implicit");
  add("protectedElements", intent.protected_elements, "implicit");
  add("allowedOperations", intent.allowed_operations, "implicit");
  add("disallowedOperations", intent.disallowed_operations, "implicit");
  add("requiredActions", intent.required_actions, "implicit");
  add("assumptions", intent.assumptions, "assumed");
  add("unknowns", intent.unknowns, "implicit");
  add("successCriteria", intent.success_conditions, "implicit");
  add("contextFacts", intent.known_facts, "explicit");
  add("conflicts", intent.conflicts, "implicit");

  spec = applyDefaults(spec, profile, language, ids);
  return { spec, itemSeq: ids.value };
}

/** Safety and profile defaults. Exported so the critic can re-apply the relevant parts. */
export function applyDefaults(
  input: PrisonSpec,
  profile: ResolvedTaskProfile,
  language: Language,
  ids: ItemAllocator,
): PrisonSpec {
  let spec = input;
  const flags = spec.flags;
  profile = adaptTaskBehavior(profile, spec);
  const advisory = isAdvisoryTask(spec);
  const p = (key: PhraseKey) => phrase(key, language);
  const addDefault = (list: ItemListKey, key: PhraseKey, unlessTopic?: RegExp) => {
    if (unlessTopic && mentions(spec, list, unlessTopic)) return;
    spec = addItems(spec, list, [p(key)], "default", ids).spec;
  };
  const addLines = (list: ItemListKey, texts: string[]) => {
    spec = addItems(spec, list, texts, "default", ids).spec;
  };

  const engineeringLike = profile.family === "engineering" || flags.codingRequired;

  if (flags.existingSystem && engineeringLike) {
    addDefault("protectedElements", "protectArchitecture", TOPICS.architecture);
    addDefault("protectedElements", "protectFeatures", TOPICS.features);
    addDefault("protectedElements", "protectInterfaces", TOPICS.interfaces);
    if (!advisory) {
      addDefault("disallowedOperations", "denyRewrite", TOPICS.rewrite);
      addDefault("disallowedOperations", "denySwitchStack", TOPICS.switchStack);
      addDefault("disallowedOperations", "denyUnrelatedRefactor", TOPICS.refactor);
      addDefault("constraints", "minimalChange", TOPICS.minimal);
    }
  } else if (flags.preserveArchitecture) {
    addDefault("protectedElements", "protectArchitecture", TOPICS.architecture);
  }

  let permission = spec.deploymentPermission;
  const touchesSystems = flags.codingRequired || flags.executionRequired;
  if (permission === "unspecified" && touchesSystems && !flags.deploymentRequired) permission = "forbidden";
  spec = { ...spec, deploymentPermission: permission };
  if (permission === "forbidden" && touchesSystems) {
    addDefault("disallowedOperations", "denyDeploy", TOPICS.deploy);
  }
  if ((permission === "allowed" || flags.deploymentRequired) && touchesSystems) {
    addDefault("constraints", "deployOnlyAfterChecks", TOPICS.deploy);
  }
  if (flags.deploymentRequired && permission === "forbidden") addDefault("conflicts", "conflictDeploy", TOPICS.deploy);

  if (flags.adviceOnly) {
    addDefault("constraints", "adviceOnly", TOPICS.directChanges);
    addDefault("disallowedOperations", "denyDirectChanges", TOPICS.directChanges);
    if (flags.executionRequired) addDefault("conflicts", "conflictAdviceExecution");
  }

  addLines("requirements", renderLines(profile.implicitRequirements, flags, language));
  addLines("constraints", renderLines(profile.constraints, flags, language));
  addLines("disallowedOperations", renderLines(profile.disallowed, flags, language));

  if (spec.requiredActions.length === 0) {
    addLines("requiredActions", renderLines(profile.defaultActions, flags, language));
  }
  if (spec.successCriteria.length === 0) {
    addLines("successCriteria", renderLines(profile.successCriteria, flags, language));
  }
  return spec;
}
