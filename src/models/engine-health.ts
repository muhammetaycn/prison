import type { AIErrorKind } from "@/services/ai/errors";

export type EngineHealthStatus = "connected" | "local" | "error";

/** Safe, user-visible result of a manually requested engine connectivity check. */
export interface EngineHealthResult {
  status: EngineHealthStatus;
  provider: string;
  model: string | null;
  checkedAt: string;
  latencyMs: number;
  message: string;
  errorKind?: AIErrorKind;
}
