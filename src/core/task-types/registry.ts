import { FAMILY_TEMPLATES } from "@/templates/families";
import { BUILTIN_TASK_TYPES } from "@/templates/task-types";
import type { SpecFlags } from "@/models/spec";
import type { Language } from "@/models/common";
import type { ResolvedTaskProfile, TaskTypeProfile, TemplateLine } from "./types";

export const FALLBACK_TASK_TYPE = "general_reasoning";

const registry = new Map<string, TaskTypeProfile>();

export function registerTaskType(profile: TaskTypeProfile): void {
  if (!/^[a-z][a-z0-9_]*$/.test(profile.id)) {
    throw new Error(`Invalid task type id "${profile.id}"`);
  }
  registry.set(profile.id, profile);
}

for (const profile of BUILTIN_TASK_TYPES) registerTaskType(profile);

export function listTaskTypes(): TaskTypeProfile[] {
  return [...registry.values()];
}

export function taskTypeIds(): string[] {
  return [...registry.keys()];
}

export function isTaskType(id: string): boolean {
  return registry.has(id);
}

export function getTaskType(id: string): TaskTypeProfile {
  return registry.get(id) ?? registry.get(FALLBACK_TASK_TYPE)!;
}

/** Merges a profile with its family template. Profile fields override family defaults. */
export function resolveTaskProfile(id: string): ResolvedTaskProfile {
  const profile = getTaskType(id);
  const family = FAMILY_TEMPLATES[profile.family];
  return {
    id: profile.id,
    family: profile.family,
    label: profile.label,
    description: profile.description,
    role: profile.role,
    autoTarget: profile.autoTarget,
    advisoryAware: profile.advisoryAware,
    blocks: [...new Set([...family.blocks, ...(profile.blocks ?? [])])],
    protocols: { ...family.protocols, ...profile.protocols },
    agentProtocol: family.agentProtocol,
    defaultActions: profile.defaultActions ?? family.defaultActions,
    implicitRequirements: profile.implicitRequirements ?? [],
    constraints: profile.constraints ?? [],
    disallowed: profile.disallowed ?? [],
    outputContract: profile.outputContract ?? family.outputContract,
    successCriteria: profile.successCriteria ?? family.successCriteria,
    expectedFormat: family.expectedFormat,
    defaultOperation: family.defaultOperation,
    localSignals: profile.localSignals,
  };
}

/** Catalog text for the Intent Engine's system prompt. */
export function taskTypeCatalog(): string {
  return listTaskTypes()
    .map((p) => `- ${p.id}: ${p.description}`)
    .join("\n");
}

export function lineApplies(line: TemplateLine, flags: SpecFlags): boolean {
  if (!line.when) return true;
  return Object.entries(line.when).every(([key, value]) => flags[key as keyof SpecFlags] === value);
}

/** Renders the template lines that apply to the given flags. */
export function renderLines(lines: TemplateLine[], flags: SpecFlags, language: Language): string[] {
  return lines.filter((line) => lineApplies(line, flags)).map((line) => line.text[language]);
}
