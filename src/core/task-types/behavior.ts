import type { Language } from "@/models/common";
import type { PrisonSpec, SpecItem } from "@/models/spec";
import { ADVISORY_TEMPLATES } from "@/templates/advisory";
import { FAMILY_TEMPLATES } from "@/templates/families";
import { dedupeTexts } from "@/core/text/normalize";
import { renderLines } from "./registry";
import type { ResolvedTaskProfile, TemplateLine } from "./types";

type TaskBehavior = Pick<PrisonSpec, "operation" | "flags">;

/** A task's subject and selected AI do not turn an analysis request into implementation. */
export function isAdvisoryTask(spec: TaskBehavior): boolean {
  return spec.flags.adviceOnly || spec.operation === "advise" || spec.operation === "analyze";
}

/** Old defaults may describe implementation; every non-default owner or model item remains intact. */
export function taskBehaviorTexts(spec: TaskBehavior, items: SpecItem[], defaults: TemplateLine[], language: Language): string[] {
  if (!isAdvisoryTask(spec) || !items.some((item) => item.source === "default")) return items.map((item) => item.text);
  return dedupeTexts([
    ...items.filter((item) => item.source !== "default").map((item) => item.text),
    ...renderLines(defaults, spec.flags, language),
  ]);
}

export function adaptTaskBehavior(profile: ResolvedTaskProfile, spec: TaskBehavior): ResolvedTaskProfile {
  if (!isAdvisoryTask(spec)) return profile;
  // These families already evaluate and recommend; preserve their research/domain rigor.
  if (profile.family === "analysis" || profile.family === "strategy") return profile;
  const family = FAMILY_TEMPLATES[profile.family];
  const execution = profile.advisoryAware && profile.protocols.EXECUTION_PROTOCOL
    && profile.protocols.EXECUTION_PROTOCOL !== family.protocols.EXECUTION_PROTOCOL
    ? profile.protocols.EXECUTION_PROTOCOL : ADVISORY_TEMPLATES.protocol;
  const validation = profile.advisoryAware && profile.protocols.VALIDATION_PROTOCOL
    && profile.protocols.VALIDATION_PROTOCOL !== family.protocols.VALIDATION_PROTOCOL
    ? profile.protocols.VALIDATION_PROTOCOL : ADVISORY_TEMPLATES.validation;
  const keepCustom = (key: "defaultActions" | "outputContract" | "successCriteria") =>
    profile.advisoryAware && profile[key] !== family[key] ? profile[key] : ADVISORY_TEMPLATES[key];
  return {
    ...profile,
    blocks: ["EXECUTION_PROTOCOL", "VALIDATION_PROTOCOL", ...(spec.flags.researchRequired ? ["RESEARCH_PROTOCOL" as const] : [])],
    protocols: {
      ...profile.protocols,
      EXECUTION_PROTOCOL: execution,
      TEST_PROTOCOL: [],
      VALIDATION_PROTOCOL: validation,
    },
    agentProtocol: execution,
    defaultActions: keepCustom("defaultActions"),
    outputContract: keepCustom("outputContract"),
    successCriteria: keepCustom("successCriteria"),
    expectedFormat: ADVISORY_TEMPLATES.expectedFormat,
  };
}
