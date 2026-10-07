import type { CouncilEvent } from "@/models/council";
import { dwellMs, type SceneState } from "./timeline";

/** Presentation variation never changes the event, its verdict or its score. */
export function entranceFor(event: CouncilEvent): "lift" | "slide" | "settle" {
  const variants = ["lift", "slide", "settle"] as const;
  return variants[Math.abs(event.seq + event.round) % variants.length];
}

/** A viewer can allow more reading time without skipping or inventing any discussion. */
export function viewingDwellMs(event: CouncilEvent, reading: boolean): number {
  const base = dwellMs(event);
  if (!reading || event.kind === "thinking" || event.kind === "seat" || event.kind === "weapon") return base;
  const words = event.text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(base, Math.min(14000, 1200 + words * 270));
}

/** A review is a score, not health removed from the running jury average. */
export function juryScoreText(score: number | null): string | null {
  return score !== null && Number.isFinite(score) && score >= 0 && score <= 1 ? `${Math.round(score * 100)}/100` : null;
}

/** Repeated polling and compacted list positions must not restart the same animation. */
export function sceneUpdateKey(state: SceneState, event: CouncilEvent | null, seats: string): string {
  return JSON.stringify([seats, { ...state, index: 0 }, event]);
}
