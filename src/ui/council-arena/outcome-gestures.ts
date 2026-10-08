import type { CouncilEvent } from "@/models/council";
import type { GestureId } from "./gesture-library";

/**
 * How the other birds take what just happened. Every reaction comes from a recorded event and its real score;
 * nobody on the page picks them, and they never change a vote, score or answer.
 */
export type OutcomeMood = "pleased" | "stung" | "weighing" | "takenAback" | "congratulate";

/** Library clips that read as each mood. */
export const MOOD_CLIPS: Readonly<Record<OutcomeMood, readonly GestureId[]>> = {
  pleased: ["pleased-bounce", "nod-twice", "acknowledge-wing"],
  stung: ["surprised-back", "regroup", "cautious-peek"],
  weighing: ["consider-again", "slow-nod", "acknowledge-wing", "head-tilt"],
  takenAback: ["surprised-back", "cautious-peek", "curious-tilt"],
  congratulate: ["encourage", "wing-salute", "nod-twice", "pleased-bounce"],
};

/** The same bands the hit feel uses: a 0.8+ review is shrugged off, one below 0.5 lands hard. */
export const SHRUG_SCORE = 0.8;
export const STING_SCORE = 0.5;
/** Seconds between neighbours when several birds react to the same moment. */
export const REACTION_STAGGER = 0.18;

export interface ReactingSeat {
  id: string;
  eliminated: boolean;
  failed: boolean;
}

export interface OutcomeReaction {
  seat: string;
  mood: OutcomeMood;
  /** Seconds after the moment's own moves end. */
  delay: number;
}

/** Who reacts to an event, and how. Seats that dropped out of the work stay still. */
export function outcomeReactions(event: CouncilEvent, seats: readonly ReactingSeat[]): OutcomeReaction[] {
  const present = seats.filter((seat) => !seat.failed);
  const target = event.targetId ? present.find((seat) => seat.id === event.targetId) : undefined;
  const others = (keep: (seat: ReactingSeat) => boolean) => present
    .filter((seat) => seat.id !== event.actorId && keep(seat))
    .map((seat, index) => ({ seat: seat.id, delay: index * REACTION_STAGGER }));
  switch (event.kind) {
    case "critique": {
      if (!target || target.id === event.actorId || event.score === null) return [];
      const mood: OutcomeMood = event.score >= SHRUG_SCORE ? "pleased" : event.score < STING_SCORE ? "stung" : "weighing";
      return [{ seat: target.id, mood, delay: 0 }];
    }
    case "approval":
    case "objection":
      if (!target || target.id === event.actorId) return [];
      return [{ seat: target.id, mood: event.kind === "approval" ? "pleased" : "weighing", delay: 0 }];
    case "eliminated":
      return others((seat) => !seat.eliminated).map((reaction) => ({ ...reaction, mood: "takenAback" }));
    case "winner":
      // Benched birds join in from the jury bench.
      return others(() => true).map((reaction) => ({ ...reaction, mood: "congratulate" }));
    default:
      return [];
  }
}

function hash(value: string): number {
  let state = 2166136261;
  for (let index = 0; index < value.length; index++) state = Math.imul(state ^ value.charCodeAt(index), 16777619);
  state ^= state >>> 16;
  return state >>> 0;
}

/** A replay picks the same clip; seats and events vary it, and a bird does not repeat its last clip. */
export function chooseMoodGesture(previous: GestureId | null, seat: string, event: number, mood: OutcomeMood): GestureId {
  const clips = MOOD_CLIPS[mood].filter((id) => id !== previous);
  return clips[hash(`${seat}|${event}|${mood}`) % clips.length];
}
