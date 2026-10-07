import type { Prison, PrisonStatus } from "@/models/prison";

/**
 * Prison lifecycle.
 *
 *   RAW_REQUEST → INTENT_PARSED → PRISON_CREATED → REQUIREMENTS_RESOLVED → READY_FOR_COMPILE
 *   READY_FOR_COMPILE → PROMPT_COMPILED → PROMPT_VALIDATED → READY
 *   READY → USER_REVISION → PRISON_UPDATED → PROMPT_RECOMPILED → PROMPT_VALIDATED → READY
 *   READY → PRISON_UPDATED (toolbar modifier / version restore)
 *   READY → READY_FOR_COMPILE (regenerate)
 */
const TRANSITIONS: Record<PrisonStatus, readonly PrisonStatus[]> = {
  RAW_REQUEST: ["INTENT_PARSED"],
  INTENT_PARSED: ["PRISON_CREATED"],
  PRISON_CREATED: ["REQUIREMENTS_RESOLVED"],
  REQUIREMENTS_RESOLVED: ["READY_FOR_COMPILE"],
  READY_FOR_COMPILE: ["PROMPT_COMPILED", "USER_REVISION", "PRISON_UPDATED"],
  PROMPT_COMPILED: ["PROMPT_VALIDATED"],
  PROMPT_RECOMPILED: ["PROMPT_VALIDATED"],
  PROMPT_VALIDATED: ["READY"],
  READY: ["USER_REVISION", "PRISON_UPDATED", "READY_FOR_COMPILE"],
  USER_REVISION: ["PRISON_UPDATED"],
  PRISON_UPDATED: ["PROMPT_RECOMPILED", "READY_FOR_COMPILE", "READY"],
};

export class InvalidTransitionError extends Error {
  constructor(from: PrisonStatus, to: PrisonStatus) {
    super(`Invalid prison transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: PrisonStatus, to: PrisonStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Returns a new prison in the target status with the transition recorded in its history. */
export function transition<P extends Prison>(prison: P, to: PrisonStatus, note = "", now: Date = new Date()): P {
  if (!canTransition(prison.status, to)) throw new InvalidTransitionError(prison.status, to);
  const at = now.toISOString();
  return {
    ...prison,
    status: to,
    updatedAt: at,
    history: [...prison.history, { at, from: prison.status, to, note }],
  };
}

/** Statuses from which the user may start a new operation (compile, revise, adjust). */
export const IDLE_STATUSES: readonly PrisonStatus[] = ["READY_FOR_COMPILE", "READY"];

export function isIdle(status: PrisonStatus): boolean {
  return IDLE_STATUSES.includes(status);
}
