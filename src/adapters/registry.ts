import type { ConcreteTarget, TargetAI } from "@/models/common";
import type { TargetReason } from "@/models/prompt";
import type { PrisonSpec } from "@/models/spec";
import type { ResolvedTaskProfile } from "@/core/task-types/types";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { geminiAdapter } from "./gemini";
import { gptAdapter } from "./gpt";
import type { TargetAdapter } from "./types";

const adapters = new Map<ConcreteTarget, TargetAdapter>();

export function registerAdapter(adapter: TargetAdapter): void {
  adapters.set(adapter.id, adapter);
}

for (const adapter of [gptAdapter, claudeAdapter, geminiAdapter, codexAdapter]) registerAdapter(adapter);

export function getAdapter(target: ConcreteTarget): TargetAdapter {
  const adapter = adapters.get(target);
  if (!adapter) throw new Error(`No adapter registered for target "${target}"`);
  return adapter;
}

export interface ResolvedTarget {
  target: ConcreteTarget;
  reason: TargetReason;
}

/**
 * AUTO resolution. An explicit selector choice always wins; then a target named in the
 * request; then the analysed task plan. Older records use the existing-code and task-profile rules.
 */
export function resolveTarget(selected: TargetAI, spec: PrisonSpec, profile: ResolvedTaskProfile): ResolvedTarget {
  if (selected !== "auto") return { target: selected, reason: "user_selected" };
  if (spec.requestedTarget) return { target: spec.requestedTarget, reason: "request_mentioned" };
  if (spec.taskPlan) return { target: spec.taskPlan.recommendedTarget, reason: "ai_recommendation" };
  if (spec.flags.codingRequired && spec.flags.existingSystem) return { target: "codex", reason: "coding_existing" };
  return { target: profile.autoTarget, reason: "task_profile" };
}
