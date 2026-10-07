import type { z } from "zod";
import type { EngineInfo } from "@/models/intent";

export type Effort = "low" | "medium" | "high";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface JsonGenerationRequest {
  system: string;
  messages: ChatMessage[];
  /** Wire schema. The provider uses it for native structured output; callers still validate. */
  schema: z.ZodType;
  schemaName: string;
  maxTokens: number;
  effort: Effort;
  /** Optional tighter per-call budget for bounded council work. */
  timeoutMs?: number;
}

/**
 * A provider produces raw JSON text for a schema. It never returns "trusted" data:
 * parsing and validation happen in generateStructured().
 */
export interface LLMProvider {
  readonly info: EngineInfo;
  generateJson(request: JsonGenerationRequest): Promise<string>;
}
