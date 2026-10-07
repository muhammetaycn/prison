import { createHash } from "node:crypto";
import { z } from "zod";
import { activeOwnerRevisions } from "@/core/context-engine";
import { CouncilReviewSchema } from "./council";
import { IntentAnalysisSchema } from "./intent";
import { ClarificationAnswerSchema, PrisonSchema, type ClarificationAnswer, type ResolvedPrison } from "./prison";
import { QualityDimensionSchema, SeveritySchema } from "./prompt";
import { PrisonSpecSchema } from "./spec";
import { QUICK_DEPTH, type CouncilDeps, type CouncilMember } from "@/services/ai/council-config";
import type { LLMProvider } from "@/services/ai/types";

const PrisonIdSchema = z.string().regex(/^pr_[a-z0-9]{8}$/);
const nonblank = z.string().trim().min(1);

/** Serializable identity only. Provider clients, credentials and reasoning are never a checkpoint. */
export const CouncilCheckpointModelRefSchema = z.object({
  id: nonblank.max(160),
  role: nonblank.max(1000),
  provider: nonblank.max(160),
  model: nonblank.max(200),
}).strict();
export type CouncilCheckpointModelRef = z.infer<typeof CouncilCheckpointModelRefSchema>;

export function councilCheckpointModelRef(member: CouncilMember): CouncilCheckpointModelRef {
  return CouncilCheckpointModelRefSchema.parse({
    id: member.id, role: member.role, provider: member.provider.info.provider, model: member.provider.info.model,
  });
}

/** Public findings preserve the validation history without serializing executable state patches. */
export const CouncilCheckpointFindingSchema = z.object({
  rule: nonblank,
  dimension: QualityDimensionSchema,
  severity: SeveritySchema,
  message: nonblank,
}).strict();
export type CouncilCheckpointFinding = z.infer<typeof CouncilCheckpointFindingSchema>;

export const CouncilCheckpointDiagnosticsSchema = z.object({
  initialFindings: z.array(CouncilCheckpointFindingSchema),
  sourceRepairFindings: z.array(CouncilCheckpointFindingSchema),
  repairFindings: z.array(CouncilCheckpointFindingSchema),
}).strict();

/** Existing task schemas recursively whitelist task fields; the resolved state must remain complete. */
export const CouncilCheckpointWorkingPrisonSchema = PrisonSchema.extend({
  id: PrisonIdSchema,
  intent: IntentAnalysisSchema,
  spec: PrisonSpecSchema,
}).strict();

/** Exact base/request attestation retains one real pending owner revision across retry. */
export const CouncilCheckpointRevisionOriginSchema = z.object({
  baseFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  preparedPrison: CouncilCheckpointWorkingPrisonSchema,
  pendingRevisionId: nonblank,
  summary: z.string(),
  changes: z.array(z.string()),
  blocked: z.array(z.string()),
  engine: z.enum(["ai", "local"]),
}).strict();
export type CouncilCheckpointRevisionOrigin = z.infer<typeof CouncilCheckpointRevisionOriginSchema>;

/** A private, durable final-review checkpoint. It is never exposed through the public prison API. */
export const CouncilCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  prisonId: PrisonIdSchema,
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  phase: z.enum(["selected", "needs_repair", "repaired", "rejected"]),
  /** An interrupted RPC may have returned a usable correction before durable storage completed. */
  repairInFlight: z.boolean().default(false),
  workingPrison: CouncilCheckpointWorkingPrisonSchema,
  // Preserve the exact candidate bytes: whitespace may be part of the mandatory final-text review.
  selectedPrompt: z.string().min(1).max(200000).refine((text) => text.trim().length > 0),
  strategies: z.array(z.string().max(4000)).max(100),
  review: CouncilReviewSchema.strict(),
  winner: CouncilCheckpointModelRefSchema,
  writer: CouncilCheckpointModelRefSchema.nullable(),
  finalReviewers: z.array(CouncilCheckpointModelRefSchema).min(1).max(6),
  reviewBudgetMs: z.number().int().min(1000).max(900000),
  feedback: z.string().max(200000).nullable(),
  diagnostics: CouncilCheckpointDiagnosticsSchema,
  appliedFixes: z.array(z.string()),
  sourceRepaired: z.boolean(),
  revisionOrigin: CouncilCheckpointRevisionOriginSchema.optional(),
}).strict().superRefine((checkpoint, context) => {
  if (checkpoint.workingPrison.id !== checkpoint.prisonId) {
    context.addIssue({ code: "custom", path: ["workingPrison", "id"], message: "Checkpoint task identity must match its working state." });
  }
  if (checkpoint.revisionOrigin) {
    const origin = checkpoint.revisionOrigin;
    const pending = origin.preparedPrison.revisions.find((record) => record.id === origin.pendingRevisionId);
    if (origin.preparedPrison.id !== checkpoint.prisonId || !pending || pending.resultVersion !== null
      || pending.engine !== origin.engine || pending.summary !== origin.summary) {
      context.addIssue({ code: "custom", path: ["revisionOrigin"], message: "Revision origin must identify the exact unresolved owner record in this task." });
    }
  }
  const knownMember = (member: CouncilCheckpointModelRef) => checkpoint.review.participants.some(
    (participant) => participant.id === member.id && participant.provider === member.provider && participant.model === member.model,
  );
  if (checkpoint.winner.id !== checkpoint.review.winnerId || checkpoint.winner.model !== checkpoint.review.winnerModel || !knownMember(checkpoint.winner)) {
    context.addIssue({ code: "custom", path: ["winner"], message: "Winner identity must match actual council evidence." });
  }
  if (checkpoint.writer && !knownMember(checkpoint.writer)) {
    context.addIssue({ code: "custom", path: ["writer"], message: "Writer identity must match actual council evidence." });
  }
  const writer = checkpoint.writer ?? checkpoint.winner;
  const seen = new Set<string>();
  for (const [index, reviewer] of checkpoint.finalReviewers.entries()) {
    const key = `${reviewer.provider}:${reviewer.model}`.toLowerCase();
    if (!knownMember(reviewer) || seen.has(key) || (reviewer.provider === writer.provider && reviewer.model === writer.model)) {
      context.addIssue({ code: "custom", path: ["finalReviewers", index], message: "Final reviewers must be distinct actual models independent of the prompt writer." });
    }
    seen.add(key);
  }
});
export type CouncilCheckpoint = z.infer<typeof CouncilCheckpointSchema>;

/** Canonical key order makes the signature insensitive to JSON object property insertion order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Questions are contextual inputs; only their supplied answers remain actual owner instructions. */
export function revisionRequestFingerprint(message: string, clarifications?: ClarificationAnswer[]): string {
  const pairs = ClarificationAnswerSchema.array().parse(clarifications ?? []);
  return createHash("sha256").update(canonical({ message, clarifications: pairs })).digest("hex");
}

/** The effective owner task and actual configured endpoints must be identical before resuming. */
export function councilSourceFingerprint(prison: ResolvedPrison, council: CouncilDeps, primary: LLMProvider | null = null): string {
  const source = CouncilCheckpointWorkingPrisonSchema.parse(prison);
  const activeVersion = source.promptVersions.find((version) => version.version === source.activeVersion);
  const providerIdentity = (provider: LLMProvider) => ({ mode: provider.info.mode, provider: provider.info.provider, model: provider.info.model });
  const depth = council.depth ?? QUICK_DEPTH;
  const input = {
    prisonId: source.id,
    rawRequest: source.rawRequest,
    language: source.language,
    targetAI: source.targetAI,
    executionMode: source.executionMode,
    intent: source.intent,
    spec: source.spec,
    compileOptions: source.compileOptions,
    activeVersion: source.activeVersion,
    activePrompt: activeVersion ? { version: activeVersion.version, text: activeVersion.text } : null,
    ownerRevisions: activeOwnerRevisions(source).map(({ id, message, clarifications }) => ({ id, message, clarifications: clarifications ?? [] })),
    activeMemory: source.taskMemory.filter((memory) => memory.active).map(({ id, directive, kind, itemRefs }) => ({ id, directive, kind, itemRefs })),
    council: {
      mode: source.compileOptions.councilMode,
      primary: primary ? providerIdentity(primary) : null,
      members: council.members.map((member) => ({ id: member.id, role: member.role, ...providerIdentity(member.provider) })),
      reserves: (council.reserves ?? []).map(providerIdentity),
      verifySource: Boolean(council.verifySource),
      depth: {
        research: depth.research, minBattleRounds: depth.minBattleRounds, maxBattleRounds: depth.maxBattleRounds,
        learning: depth.learning, minConsensusRounds: depth.minConsensusRounds, maxConsensusRounds: depth.maxConsensusRounds,
        polish: depth.polish, callTimeoutMs: depth.callTimeoutMs, retryDrafts: depth.retryDrafts,
      },
    },
  };
  return createHash("sha256").update(canonical(input), "utf8").digest("hex");
}
