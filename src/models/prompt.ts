import { z } from "zod";
import { ConcreteTargetSchema, TargetAISchema } from "./common";
import { CompileOptionsSchema } from "./options";
import { PrisonSpecSchema } from "./spec";
import { CouncilReviewSchema } from "./council";

export const BLOCK_IDS = [
  "ROLE",
  "OBJECTIVE",
  "CONTEXT",
  "CURRENT_SYSTEM",
  "USER_INTENT",
  "TASK",
  "REQUIREMENTS",
  "CONSTRAINTS",
  "PROTECTED_ELEMENTS",
  "ALLOWED_OPERATIONS",
  "DO_NOT_DO",
  "ASSUMPTIONS",
  "UNKNOWNS",
  "EXECUTION_PROTOCOL",
  "RESEARCH_PROTOCOL",
  "TEST_PROTOCOL",
  "VALIDATION_PROTOCOL",
  "OUTPUT_CONTRACT",
  "SUCCESS_CRITERIA",
] as const;
export const BlockIdSchema = z.enum(BLOCK_IDS);
export type BlockId = z.infer<typeof BlockIdSchema>;

/**
 * One compiled section of a prompt, before an adapter renders it into target-specific text.
 * Render order inside a block: intro, text, itemsLabel + items, notes.
 */
export interface PromptBlock {
  id: BlockId;
  intro?: string;
  text?: string;
  /** Render text as a quotation (used for the original request). */
  quote?: boolean;
  itemsLabel?: string;
  items?: string[];
  ordered?: boolean;
  notes?: string[];
}

export const QUALITY_DIMENSIONS = [
  "intent_alignment",
  "context_completeness",
  "constraint_clarity",
  "execution_clarity",
  "output_clarity",
  "target_ai_compatibility",
] as const;
export const QualityDimensionSchema = z.enum(QUALITY_DIMENSIONS);
export type QualityDimension = z.infer<typeof QualityDimensionSchema>;

export const SEVERITIES = ["low", "medium", "high"] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

export const CriticIssueSchema = z.object({
  dimension: QualityDimensionSchema,
  severity: SeveritySchema,
  message: z.string(),
  source: z.enum(["rules", "llm"]),
  fixed: z.boolean(),
});
export type CriticIssue = z.infer<typeof CriticIssueSchema>;

/** Internal quality scores (0..1). Stored for diagnostics, never shown to the user as numbers. */
export const QualityScoresSchema = z.record(QualityDimensionSchema, z.number());
export type QualityScores = z.infer<typeof QualityScoresSchema>;

export const CriticReportSchema = z.object({
  issues: z.array(CriticIssueSchema),
  scores: QualityScoresSchema,
  refined: z.boolean(),
  compilePasses: z.number(),
  llmReviewed: z.boolean(),
  llmError: z.string().nullable(),
  appliedFixes: z.array(z.string()),
});
export type CriticReport = z.infer<typeof CriticReportSchema>;

export const VERSION_TRIGGERS = ["initial", "regenerate", "modifier", "revision", "target_change", "restore"] as const;
export const VersionTriggerSchema = z.enum(VERSION_TRIGGERS);
export type VersionTrigger = z.infer<typeof VersionTriggerSchema>;

export const TARGET_REASONS = ["user_selected", "request_mentioned", "coding_existing", "ai_recommendation", "task_profile"] as const;
export const TargetReasonSchema = z.enum(TARGET_REASONS);
export type TargetReason = z.infer<typeof TargetReasonSchema>;

export const MEMORY_KINDS = ["constraint", "protection", "prohibition", "requirement", "preference", "target", "style"] as const;

export const MemoryEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  directive: z.string(),
  kind: z.enum(MEMORY_KINDS),
  itemRefs: z.array(z.string()),
  active: z.boolean(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
export type MemoryKind = MemoryEntry["kind"];

/** The engine that actually generated this version, independent of the analysis engine. */
export const PromptGenerationSchema = z.object({
  source: z.enum(["compiler", "local", "ai"]),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  strategies: z.array(z.string()),
});
export type PromptGeneration = z.infer<typeof PromptGenerationSchema>;

export const PromptVersionSchema = z.object({
  version: z.number(),
  createdAt: z.string(),
  trigger: VersionTriggerSchema,
  note: z.string(),
  targetAI: TargetAISchema,
  resolvedTarget: ConcreteTargetSchema,
  targetReason: TargetReasonSchema,
  options: CompileOptionsSchema,
  /** Older saved versions do not record which engine generated the prompt. */
  generation: PromptGenerationSchema.nullable().default(null),
  /** Absent on versions produced before the multi-model council was introduced. */
  councilReview: CouncilReviewSchema.nullable().optional(),
  text: z.string(),
  blockIds: z.array(BlockIdSchema),
  critic: CriticReportSchema,
  specSnapshot: PrisonSpecSchema,
  memorySnapshot: z.array(MemoryEntrySchema),
  /** Exact directive scope; null denotes a legacy version recorded before this snapshot existed. */
  ownerRevisionIds: z.array(z.string()).nullable().default(null),
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;
