import type { ResolvedPrison } from "@/models/prison";
import { resolveTarget, type ResolvedTarget } from "@/adapters/registry";
import { resolveTaskProfile } from "@/core/task-types/registry";

/** The target the compiler will use for this prison (same pure resolver as the server). */
export function previewTarget(prison: ResolvedPrison): ResolvedTarget {
  return resolveTarget(prison.targetAI, prison.spec, resolveTaskProfile(prison.spec.taskType));
}
