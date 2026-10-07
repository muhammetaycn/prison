import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { EngineInfo } from "@/models/intent";
import { AIProviderError, kindFromStatus } from "./errors";
import type { JsonGenerationRequest, LLMProvider } from "./types";

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";

/** OpenAI provider via the Responses API with strict JSON-schema text format. */
export class OpenAIProvider implements LLMProvider {
  readonly info: EngineInfo;
  private readonly client: OpenAI;

  constructor(model: string = DEFAULT_OPENAI_MODEL, client?: OpenAI) {
    this.client = client ?? new OpenAI();
    this.info = { mode: "ai", provider: "openai", model };
  }

  async generateJson(request: JsonGenerationRequest): Promise<string> {
    const model = this.info.model ?? DEFAULT_OPENAI_MODEL;
    const reasoningModel = /^(gpt-5|gpt-6|o\d)/.test(model);
    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create({
        model,
        instructions: request.system,
        input: request.messages.map((m) => ({ role: m.role, content: m.content })),
        max_output_tokens: request.maxTokens,
        text: { format: zodTextFormat(request.schema, request.schemaName) },
        ...(reasoningModel ? { reasoning: { effort: request.effort } } : {}),
      }, { timeout: request.timeoutMs ?? 90000, maxRetries: 0 });
    } catch (error) {
      throw toProviderError(error);
    }

    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason ?? "unknown";
      if (reason === "content_filter") throw new AIProviderError("refusal", "OpenAI content filter stopped the response.");
      throw new AIProviderError("truncated", "OpenAI response was incomplete.");
    }
    const text = response.output_text;
    if (!text?.trim()) throw new AIProviderError("invalid_output", "OpenAI returned no text output.");
    return text;
  }
}

function toProviderError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new AIProviderError("timeout", "Provider request timed out.");
  if (error instanceof OpenAI.APIConnectionError) return new AIProviderError("network", "Provider connection failed.");
  if (error instanceof OpenAI.APIError) return new AIProviderError(kindFromStatus(error.status), `Provider request failed (HTTP ${error.status ?? "unknown"}).`);
  return new AIProviderError("unknown", "Provider invocation failed.");
}
