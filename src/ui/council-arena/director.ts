import type { CouncilEvent } from "@/models/council";
import type { CouncilMode } from "@/models/options";

/**
 * The camera's shot list. Each moment of the council gets the shot that tells it best:
 * - wide: the whole stage, slowly orbiting (arrivals, weapon drops, memory).
 * - speaker: close on whoever has the floor; over the shoulder of the one it addresses.
 * - duel: side-on two-shot of an attacker and its target.
 * - drama: low, slow push-in on an elimination.
 * - hero: low angle circling the winner on the podium.
 * - overview: high over the table for an agreement.
 */
export type ShotKind = "wide" | "speaker" | "duel" | "drama" | "hero" | "overview";

export interface Shot {
  kind: ShotKind;
  /** Who the shot is about. */
  subject: string | null;
  /** The other party (addressee or target), if any. */
  other: string | null;
}

export const WIDE: Shot = { kind: "wide", subject: null, other: null };

const QUIET = new Set<CouncilEvent["kind"]>(["seat", "replace", "memory", "weapon"]);

/** The shot for a moment; thinking blips keep whatever is on screen so the camera never twitches. */
export function shotFor(event: CouncilEvent | null, mode: CouncilMode, previous: Shot | null): Shot {
  if (!event) return WIDE;
  if (event.kind === "thinking") return previous ?? WIDE;
  if (event.actorId === "system" || QUIET.has(event.kind)) return WIDE;
  switch (event.kind) {
    case "eliminated":
      return { kind: "drama", subject: event.actorId, other: null };
    case "winner":
      return mode === "competition" ? { kind: "hero", subject: event.actorId, other: null } : { kind: "overview", subject: event.actorId, other: null };
    case "critique":
      if (mode === "competition" && event.targetId) return { kind: "duel", subject: event.actorId, other: event.targetId };
      return { kind: "speaker", subject: event.actorId, other: event.targetId };
    default:
      return { kind: "speaker", subject: event.actorId, other: event.targetId };
  }
}
