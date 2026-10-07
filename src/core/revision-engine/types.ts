import type { StatePatch } from "@/core/prison-engine/patch";

export interface RevisionInterpretation {
  patch: StatePatch;
  /** Short Turkish sentence for the revision chat. */
  summary: string;
  engine: "ai" | "local";
}
