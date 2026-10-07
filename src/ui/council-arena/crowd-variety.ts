/** Small, stable differences keep the stands readable without a separate model for every spectator. */
export interface CrowdProfile {
  size: number;
  bodyWidth: number;
  bodyHeight: number;
  bodyDepth: number;
  head: number;
  wing: number;
  crest: number;
  tail: number;
  pace: number;
  delay: number;
  seed: number;
}

const SHAPES = [
  { bodyWidth: 1.15, bodyHeight: 0.9, bodyDepth: 1.08, head: 1.02, wing: 0.88, crest: 0.8, tail: 0.88 },
  { bodyWidth: 0.9, bodyHeight: 1.17, bodyDepth: 0.95, head: 0.96, wing: 1.14, crest: 1.12, tail: 1.17 },
  { bodyWidth: 0.85, bodyHeight: 0.94, bodyDepth: 0.9, head: 0.94, wing: 0.84, crest: 1.28, tail: 1.06 },
  { bodyWidth: 1.08, bodyHeight: 1.04, bodyDepth: 1.05, head: 1.06, wing: 1.04, crest: 0.98, tail: 1.12 },
] as const;

const sample = (random: () => number) => {
  const value = random();
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
};

export function crowdProfile(index: number, random: () => number): CrowdProfile {
  const shape = SHAPES[(index + Math.floor(sample(random) * SHAPES.length)) % SHAPES.length];
  return {
    ...shape,
    size: 0.88 + sample(random) * 0.22,
    pace: 0.84 + sample(random) * 0.33,
    delay: sample(random) * 0.38,
    seed: (Math.floor(sample(random) * 0x1000000) ^ Math.imul(index + 1, 2654435761)) >>> 0,
  };
}

export type CrowdReaction = "hop" | "flutter" | "clap" | "lean" | "reach";
export const CROWD_REACTIONS: readonly CrowdReaction[] = ["hop", "flutter", "clap", "lean", "reach"];

/** Deterministic event variation, excluding the previous pose even with a constant random source. */
export function nextCrowdReaction(previous: CrowdReaction | null, seed: number, event: number): CrowdReaction {
  let mix = (seed ^ Math.imul(event + 1, 2246822519)) >>> 0;
  mix = Math.imul(mix ^ (mix >>> 16), 3266489917) >>> 0;
  mix ^= mix >>> 13;
  const previousIndex = previous === null ? -1 : CROWD_REACTIONS.indexOf(previous);
  const available = CROWD_REACTIONS.length - (previousIndex >= 0 ? 1 : 0);
  let selected = (mix >>> 0) % available;
  if (previousIndex >= 0 && selected >= previousIndex) selected++;
  return CROWD_REACTIONS[selected];
}
