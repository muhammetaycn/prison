import { z } from "zod";
import { LanguageSchema, TargetAISchema } from "./common";
import { EngineInfoSchema, IntentAnalysisSchema } from "./intent";
import { CompileOptionsSchema } from "./options";
import { MemoryEntrySchema, PromptVersionSchema } from "./prompt";
import { PrisonSpecSchema } from "./spec";

export const PRISON_STATUSES = [
  "RAW_REQUEST",
  "INTENT_PARSED",
  "PRISON_CREATED",
  "REQUIREMENTS_RESOLVED",
  "READY_FOR_COMPILE",
  "PROMPT_COMPILED",
  "PROMPT_RECOMPILED",
  "PROMPT_VALIDATED",
  "READY",
  "USER_REVISION",
  "PRISON_UPDATED",
] as const;
export const PrisonStatusSchema = z.enum(PRISON_STATUSES);
export type PrisonStatus = z.infer<typeof PrisonStatusSchema>;

export const StatusEventSchema = z.object({
  at: z.string(),
  from: PrisonStatusSchema.nullable(),
  to: PrisonStatusSchema,
  note: z.string(),
});
export type StatusEvent = z.infer<typeof StatusEventSchema>;

/** Questions are model-authored context; only answers are owner-authored directives. */
export const ClarificationAnswerSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(1000),
});
export type ClarificationAnswer = z.infer<typeof ClarificationAnswerSchema>;

export const RevisionRecordSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  message: z.string(),
  summary: z.string(),
  changes: z.array(z.string()),
  resultVersion: z.number().nullable(),
  engine: z.enum(["ai", "local", "modifier"]),
  /** Optional so existing saved revisions remain readable. Never part of owner-source quotations. */
  clarifications: z.array(ClarificationAnswerSchema).max(3).optional(),
});
export type RevisionRecord = z.infer<typeof RevisionRecordSchema>;

/** A prison: one fully isolated task instance. Nothing in it references another prison. */
export const PrisonSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: PrisonStatusSchema,
  language: LanguageSchema,
  rawRequest: z.string(),
  targetAI: TargetAISchema,
  executionMode: z.literal("prompt_generation"),
  engine: EngineInfoSchema,
  intent: IntentAnalysisSchema.nullable(),
  spec: PrisonSpecSchema.nullable(),
  compileOptions: CompileOptionsSchema,
  taskMemory: z.array(MemoryEntrySchema),
  revisions: z.array(RevisionRecordSchema),
  /** Restoring state preserves the audit log but deactivates directives absent from that version. */
  inactiveOwnerRevisionIds: z.array(z.string()).optional(),
  promptVersions: z.array(PromptVersionSchema),
  activeVersion: z.number().nullable(),
  history: z.array(StatusEventSchema),
  itemSeq: z.number(),
});
export type Prison = z.infer<typeof PrisonSchema>;

/** A prison whose requirements are resolved, i.e. it has an intent and a spec. */
export type ResolvedPrison = Prison & {
  intent: NonNullable<Prison["intent"]>;
  spec: NonNullable<Prison["spec"]>;
};

export function isResolved(prison: Prison): prison is ResolvedPrison {
  return prison.intent !== null && prison.spec !== null;
}

export interface PrisonSummary {
  id: string;
  title: string;
  taskType: string | null;
  targetAI: Prison["targetAI"];
  status: PrisonStatus;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

export function summarizePrison(prison: Prison): PrisonSummary {
  return {
    id: prison.id,
    title: prison.title,
    taskType: prison.spec?.taskType ?? null,
    targetAI: prison.targetAI,
    status: prison.status,
    versionCount: prison.promptVersions.length,
    createdAt: prison.createdAt,
    updatedAt: prison.updatedAt,
  };
}
