import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { EngineInfo } from "@/models/intent";
import { AIProviderError, kindFromStatus } from "./errors";
import type { JsonGenerationRequest, LLMProvider } from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** Native structured outputs from the selected Claude model; refusals never substitute another model. */
export class AnthropicProvider implements LLMProvider {
  readonly info: EngineInfo;
  private readonly client: Anthropic;

  constructor(model: string = DEFAULT_ANTHROPIC_MODEL, client?: Anthropic) {
    this.client = client ?? new Anthropic();
    this.info = { mode: "ai", provider: "anthropic", model };
  }

  async generateJson(request: JsonGenerationRequest): Promise<string> {
    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.info.model ?? DEFAULT_ANTHROPIC_MODEL,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
        output_config: {
          effort: request.effort,
          format: betaZodOutputFormat(request.schema),
        },
      }, { timeout: request.timeoutMs ?? 90000, maxRetries: 0 });
    } catch (error) {
      throw toProviderError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new AIProviderError("refusal", "Claude declined the request.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new AIProviderError("truncated", "Claude stopped at max_tokens before finishing the JSON output.");
    }

    const text = response.content
      .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (!text.trim()) throw new AIProviderError("invalid_output", "Claude returned no text content.");
    return text;
  }
}

function toProviderError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AIProviderError("timeout", "Provider request timed out.");
  if (error instanceof Anthropic.APIConnectionError) {
    return new AIProviderError("network", "Provider connection failed.");
  }
  if (error instanceof Anthropic.APIError) {
    return new AIProviderError(kindFromStatus(error.status), `Provider request failed (HTTP ${error.status ?? "unknown"}).`);
  }
  return new AIProviderError("unknown", "Provider invocation failed.");
}
