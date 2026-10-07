import type { QualityDimension, Severity } from "@/models/prompt";
import type { ResolvedPrison } from "@/models/prison";
import { ITEM_LIST_KEYS, type SpecItem } from "@/models/spec";
import type { CompiledPrompt } from "@/core/prompt-compiler";
import type { OutputValidation } from "@/core/output-validator";
import type { StatePatch } from "@/core/prison-engine/patch";
import type { ResolvedTaskProfile } from "@/core/task-types/types";
import { renderLines } from "@/core/task-types/registry";
import { adaptTaskBehavior, isAdvisoryTask } from "@/core/task-types/behavior";
import { isNearDuplicate } from "@/core/text/normalize";
import { FAMILY_TEMPLATES } from "@/templates/families";
import { phrase } from "@/templates/phrases";

export interface CriticFinding {
  rule: string;
  dimension: QualityDimension;
  severity: Severity;
  message: string;
  /** A state patch that resolves the finding, applied through the critic policy. */
  fix?: StatePatch;
}

export interface RuleContext {
  prison: ResolvedPrison;
  compiled: CompiledPrompt;
  validation: OutputValidation;
  profile: ResolvedTaskProfile;
}

export interface CriticRule {
  id: string;
  check(ctx: RuleContext): CriticFinding[];
}

const USER_SOURCES = new Set(["explicit", "revision"]);

/**
 * Deterministic critic rules. Each rule inspects the prison state and/or the compiled prompt.
 * Fixes never rewrite prompt text; they patch the prison state so the compiler stays the
 * single author of the prompt.
 */
export const CRITIC_RULES: CriticRule[] = [
  {
    id: "output-structure",
    check: ({ validation }) =>
      validation.problems.map((message) => ({
        rule: "output-structure",
        dimension: "output_clarity" as const,
        severity: "high" as const,
        message,
      })),
  },
  {
    id: "goal-present",
    check: ({ prison }) =>
      prison.spec.primaryGoal.trim()
        ? []
        : [{ rule: "goal-present", dimension: "intent_alignment", severity: "high", message: "Amaç boş; prompt neyi başaracağını söylemiyor." }],
  },
  {
    id: "success-criteria",
    check: ({ prison, profile }) => {
      if (prison.spec.successCriteria.length) return [];
      const defaults = renderLines(profile.successCriteria, prison.spec.flags, prison.language);
      return [
        {
          rule: "success-criteria",
          dimension: "output_clarity",
          severity: "medium",
          message: "Başarı kriteri tanımlı değil.",
          ...(defaults.length ? { fix: { add: { successCriteria: defaults } } } : {}),
        },
      ];
    },
  },
  {
    id: "execution-steps",
    check: ({ prison, profile }) => {
      const { flags, requiredActions } = prison.spec;
      if (isAdvisoryTask(prison.spec) || requiredActions.length || !(flags.codingRequired || flags.executionRequired)) return [];
      const lines = profile.defaultActions.length ? profile.defaultActions : FAMILY_TEMPLATES.engineering.defaultActions;
      return [
        {
          rule: "execution-steps",
          dimension: "execution_clarity",
          severity: "medium",
          message: "Uygulama gerektiren görevde adım tanımı yok.",
          fix: { add: { requiredActions: renderLines(lines, flags, prison.language) } },
        },
      ];
    },
  },
  {
    id: "existing-protections",
    check: ({ prison }) => {
      const { flags, protectedElements } = prison.spec;
      if (!flags.existingSystem || protectedElements.length) return [];
      return [
        {
          rule: "existing-protections",
          dimension: "constraint_clarity",
          severity: "medium",
          message: "Mevcut sistem üzerinde çalışılıyor ama korunacak unsur tanımlı değil.",
          fix: {
            add: {
              protectedElements: [phrase("protectFeatures", prison.language), phrase("protectArchitecture", prison.language)],
            },
          },
        },
      ];
    },
  },
  {
    id: "allow-deny-overlap",
    check: ({ prison }) => {
      const { allowedOperations, disallowedOperations } = prison.spec;
      return allowedOperations
        .filter((allowed) => disallowedOperations.some((denied) => isNearDuplicate(allowed.text, denied.text, 0.6)))
        .map((allowed) => ({
          rule: "allow-deny-overlap",
          dimension: "constraint_clarity" as const,
          severity: "high" as const,
          message: `Aynı işlem hem izinli hem yasak görünüyor: "${allowed.text}".`,
          fix: { removeIds: [allowed.id] },
        }));
    },
  },
  {
    id: "duplicates",
    check: ({ prison }) => {
      const seen: SpecItem[] = [];
      const removeIds: string[] = [];
      for (const list of ITEM_LIST_KEYS) {
        for (const item of prison.spec[list]) {
          const twin = seen.find((other) => isNearDuplicate(other.text, item.text, 0.85));
          if (twin && !USER_SOURCES.has(item.source)) removeIds.push(item.id);
          else seen.push(item);
        }
      }
      if (!removeIds.length) return [];
      return [
        {
          rule: "duplicates",
          dimension: "constraint_clarity",
          severity: "low",
          message: "Tekrarlanan maddeler var.",
          fix: { removeIds },
        },
      ];
    },
  },
  {
    id: "deploy-conflict",
    check: ({ prison }) =>
      prison.spec.flags.deploymentRequired && prison.spec.deploymentPermission === "forbidden"
        ? [
            {
              rule: "deploy-conflict",
              dimension: "constraint_clarity",
              severity: "high",
              message: "Deploy hem isteniyor hem yasak. Revizyonla hangisinin geçerli olduğunu belirt.",
            },
          ]
        : [],
  },
  {
    id: "request-conflicts",
    check: ({ prison }) =>
      prison.spec.conflicts.length
        ? [
            {
              rule: "request-conflicts",
              dimension: "intent_alignment",
              severity: "medium",
              message: "İstekte çelişki var; prompt bunu hedef AI'a açıkça bildiriyor. Revizyonla netleştirmek sonucu güçlendirir.",
            },
          ]
        : [],
  },
  {
    id: "target-fit",
    check: ({ prison, compiled, profile }) => {
      const findings: CriticFinding[] = [];
      const { flags } = prison.spec;
      if (compiled.target === "codex" && !flags.codingRequired && !flags.existingSystem && profile.family !== "engineering") {
        findings.push({
          rule: "target-fit",
          dimension: "target_ai_compatibility",
          severity: "medium",
          message: "Codex repository ve kod işleri için optimize; bu görev için GPT veya Claude daha uygun olabilir.",
        });
      }
      if (profile.family === "visual" && (compiled.target === "claude" || compiled.target === "codex")) {
        findings.push({
          rule: "target-fit",
          dimension: "target_ai_compatibility",
          severity: "medium",
          message: "Seçilen hedef görsel üretmiyor; bu promptu görsel üretebilen bir modele (ör. GPT veya Gemini) vermen gerekebilir.",
        });
      }
      return findings;
    },
  },
  {
    id: "length",
    check: ({ prison, compiled }) => {
      const { verbosity } = prison.compileOptions;
      const limit = verbosity === "concise" ? 4000 : verbosity === "standard" ? 12000 : Infinity;
      return compiled.text.length > limit
        ? [
            {
              rule: "length",
              dimension: "execution_clarity",
              severity: "low",
              message: "Prompt seçilen uzunluk için fazla uzun; gereksiz maddeleri revizyonla çıkarabilirsin.",
            },
          ]
        : [];
    },
  },
  {
    id: "many-unknowns",
    check: ({ prison }) =>
      prison.spec.unknowns.length > 6
        ? [
            {
              rule: "many-unknowns",
              dimension: "context_completeness",
              severity: "low",
              message: "Çok sayıda bilinmeyen var; birkaçını revizyonda cevaplamak promptu belirgin şekilde güçlendirir.",
            },
          ]
        : [],
  },
];

export function runRules(ctx: RuleContext): CriticFinding[] {
  const resolved = { ...ctx, profile: adaptTaskBehavior(ctx.profile, ctx.prison.spec) };
  return CRITIC_RULES.flatMap((rule) => rule.check(resolved));
}
