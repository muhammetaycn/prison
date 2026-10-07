import { z } from "zod";
import { OperationProgressSchema } from "./operation-progress";
import { CouncilModeSchema, ExecutionContextSchema, ModifierActionSchema } from "./options";
import { TargetAISchema } from "./common";
import { ClarificationAnswerSchema } from "./prison";

export const CompileOperationInputSchema = z.object({ executionContext: ExecutionContextSchema.optional(), councilMode: CouncilModeSchema.optional() }).strict();
export const AdjustOperationInputSchema = z.union([
  z.object({ action: ModifierActionSchema }).strict(),
  z.object({ target: TargetAISchema }).strict(),
  z.object({ executionContext: ExecutionContextSchema }).strict(),
  z.object({ councilMode: CouncilModeSchema }).strict(),
]);
export const ReviseOperationInputSchema = z.object({ message: z.string().trim().min(2).max(2000) }).strict();
export const ClarifyOperationInputSchema = z.object({ clarifications: z.array(ClarificationAnswerSchema.strict()).min(1).max(3) }).strict();
/** Only validated user choices are retained; provider configuration and credentials cannot enter this record. */
export const OperationRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("compile"), input: CompileOperationInputSchema }).strict(),
  z.object({ kind: z.literal("adjust"), input: AdjustOperationInputSchema }).strict(),
  z.object({ kind: z.literal("revise"), input: ReviseOperationInputSchema }).strict(),
  z.object({ kind: z.literal("clarify"), input: ClarifyOperationInputSchema }).strict(),
]);
export type OperationRequest = z.infer<typeof OperationRequestSchema>;
export const OperationRetrySchema = z.object({ request: OperationRequestSchema, sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export const OperationStatusSchema = z.enum(["queued", "running", "completed", "failed", "interrupted"]);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;
export const PrisonOperationSchema = z.object({
  id: z.string().regex(/^op_[a-f0-9]{32}$/),
  prisonId: z.string().regex(/^pr_[a-z0-9]{8}$/),
  kind: z.enum(["compile", "adjust", "revise", "clarify"]),
  status: OperationStatusSchema,
  startedAt: z.string(),
  updatedAt: z.string(),
  progress: OperationProgressSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  resultVersion: z.number().int().min(0).nullable(),
  // Optional for older saved jobs which did not retain their submitted action.
  retry: OperationRetrySchema.optional(),
}).superRefine((operation, context) => {
  if (operation.retry && operation.retry.request.kind !== operation.kind) context.addIssue({ code: "custom", path: ["retry", "request", "kind"], message: "Retry action must match the operation." });
});
export type PrisonOperation = z.infer<typeof PrisonOperationSchema>;
export const operationIsActive = (operation: Pick<PrisonOperation, "status">) => operation.status === "queued" || operation.status === "running";
