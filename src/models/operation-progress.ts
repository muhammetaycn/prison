import { z } from "zod";
import { COUNCIL_EVENT_LIMIT, CouncilEventSchema } from "./council";
import { CouncilModeSchema } from "./options";

export const OperationProgressSchema = z.object({
  stage: z.enum(["preflight", "research", "proposals", "peer_review", "revision", "voting", "validation"]),
  completed: z.number().int().min(0),
  total: z.number().int().min(1).max(6),
  message: z.string(),
  startedAt: z.string(),
  /** Set by council stages so the live arena knows which stage to build. */
  councilMode: CouncilModeSchema.optional(),
  /** Live council timeline for the arena view; renumbered by the service across repair runs. */
  events: z.array(CouncilEventSchema).max(COUNCIL_EVENT_LIMIT).optional(),
});
export type OperationProgress = z.infer<typeof OperationProgressSchema>;
export type ProgressUpdate = Omit<OperationProgress, "startedAt" | "events">;
