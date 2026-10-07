import { z } from "zod";
import { CouncilModeSchema, ExecutionContextSchema } from "./options";

/** Public editorial evidence only. Private model reasoning and credentials are never stored. */
export const CouncilScoresSchema = z.object({
  intent_alignment: z.number().min(0).max(1),
  context_completeness: z.number().min(0).max(1),
  constraint_clarity: z.number().min(0).max(1),
  execution_clarity: z.number().min(0).max(1),
  output_clarity: z.number().min(0).max(1),
  target_ai_compatibility: z.number().min(0).max(1),
});
export const COUNCIL_DIMENSIONS = Object.keys(CouncilScoresSchema.shape) as Array<keyof CouncilScores>;
export const CouncilDimensionSchema = z.enum(COUNCIL_DIMENSIONS as [keyof CouncilScores, ...Array<keyof CouncilScores>]);
export const CouncilIssueSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  message: z.string().trim().min(1).max(700),
});

/** Fight mode drops one weapon per review dimension; the round's best candidate on it picks it up. */
export const COUNCIL_WEAPONS: Record<keyof CouncilScores, { weapon: "sword" | "bow" | "shield" | "hammer" | "spear" | "staff"; name: string; meaning: string }> = {
  intent_alignment: { weapon: "sword", name: "Kılıç", meaning: "amaç uyumu" },
  context_completeness: { weapon: "bow", name: "Yay", meaning: "bağlam bütünlüğü" },
  constraint_clarity: { weapon: "shield", name: "Kalkan", meaning: "sınırların netliği" },
  execution_clarity: { weapon: "hammer", name: "Çekiç", meaning: "uygulama netliği" },
  output_clarity: { weapon: "spear", name: "Mızrak", meaning: "çıktı netliği" },
  target_ai_compatibility: { weapon: "staff", name: "Asa", meaning: "hedef AI uyumu" },
};

export const COUNCIL_EVENT_TEXT_LIMIT = 280;
export const COUNCIL_EVENT_LIMIT = 600;

/**
 * One visible step of a council: who is working, what they said publicly and what the rules decided.
 * Text is an excerpt of editorial output (drafts, critiques, decisions), never a private reasoning trace.
 */
export const CouncilEventSchema = z.object({
  seq: z.number().int().min(0),
  at: z.string(),
  round: z.number().int().min(0).max(12),
  kind: z.enum([
    "seat", "replace", "memory", "thinking", "research", "proposal", "critique", "weapon", "eliminated",
    "revision", "draft", "approval", "objection", "winner", "finalist", "failed",
    /** A juror could not complete a review; its own candidacy is unaffected. */
    "abstained",
  ]),
  actorId: z.string(),
  model: z.string().nullable(),
  targetId: z.string().nullable(),
  dimension: CouncilDimensionSchema.nullable(),
  score: z.number().min(0).max(1).nullable(),
  text: z.string().max(COUNCIL_EVENT_TEXT_LIMIT),
});

export const CouncilReviewSchema = z.object({
  mode: CouncilModeSchema,
  executionContext: ExecutionContextSchema,
  startedAt: z.string(),
  completedAt: z.string(),
  /** Review rounds including the final one. Records before elimination rounds always have 2. */
  rounds: z.number().int().min(1).max(12),
  participants: z.array(z.object({
    id: z.string(),
    provider: z.string(),
    model: z.string(),
    role: z.string(),
    status: z.enum(["failed", "reviewed", "eliminated", "winner"]),
    error: z.string().nullable(),
    initialPrompt: z.string().nullable(),
    revisedPrompt: z.string().nullable(),
    strategies: z.array(z.string()),
    findings: z.array(z.string()),
    score: z.number().min(0).max(1).nullable(),
  })).min(3).max(6),
  reviews: z.array(z.object({
    stage: z.enum(["peer", "final"]),
    round: z.number().int().min(1).max(12).optional(),
    reviewerId: z.string(),
    candidateId: z.string(),
    scores: CouncilScoresSchema,
    issues: z.array(CouncilIssueSchema),
    suggestions: z.array(z.string()),
  })),
  winnerId: z.string(),
  winnerModel: z.string(),
  decision: z.string(),
  finalReviewerModel: z.string(),
  /** Actual author of the one successful exact-text repair; jury selection remains unchanged. */
  repairerModel: z.string().optional(),
  /** A stalled jury selected a candidate for exact-text review, without claiming consensus. */
  selectionBasis: z.literal("finalist").optional(),
  /** Members that failed the pre-council probe; older records have no probe. */
  replacements: z.array(z.object({
    model: z.string(),
    reason: z.string(),
    replacement: z.string().nullable(),
  })).optional(),
  /** Replayable timeline. Older records have none and are replayed from participants/reviews. */
  events: z.array(CouncilEventSchema).max(COUNCIL_EVENT_LIMIT).optional(),
});
export type CouncilReview = z.infer<typeof CouncilReviewSchema>;
export type CouncilScores = z.infer<typeof CouncilScoresSchema>;
export type CouncilDimension = keyof CouncilScores;
export type CouncilIssue = z.infer<typeof CouncilIssueSchema>;
export type CouncilEvent = z.infer<typeof CouncilEventSchema>;
