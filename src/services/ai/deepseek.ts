import OpenAI from "openai";
import type { Stream } from "openai/core/streaming";
import { z } from "zod";
import type { EngineInfo } from "@/models/intent";
import { AIProviderError, kindFromStatus } from "./errors";
import { effectiveMaxTokens } from "./generation-budget";
import { nvidiaModelSettings } from "./nvidia-model-settings";
import type { JsonGenerationRequest, LLMProvider } from "./types";

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
export const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_TIMEOUT_MS = 180000;
const NVIDIA_RETRY_DELAY_MS = 500;

/** OpenAI-compatible chat API. JSON mode controls syntax; PRISON validates the schema separately. */
class CompatibleJsonProvider implements LLMProvider {
  readonly info: EngineInfo;
  private readonly client: OpenAI;

  constructor(provider: "deepseek" | "nvidia" | "compatible", model: string, apiKey: string | undefined, baseURL: string, client?: OpenAI) {
    if (!client && !apiKey?.trim()) {
      throw new AIProviderError("configuration", `${provider} API key is missing.`);
    }
    // Long schema-based NVIDIA reviews can exceed 90 seconds. Avoid overlapping SDK resubmissions.
    this.client = client ?? new OpenAI({ apiKey, baseURL, organization: null, project: null, timeout: provider === "nvidia" ? NVIDIA_TIMEOUT_MS : 90000, maxRetries: provider === "nvidia" ? 0 : 1 });
    this.info = { mode: "ai", provider, model };
  }

  private async complete(parameters: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, timeoutMs: number): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    let timeout: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        const error = new OpenAI.APIConnectionTimeoutError();
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });
    const collect = async (): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
      if (this.info.provider !== "nvidia") {
        return this.client.chat.completions.create(parameters, { timeout: timeoutMs, signal: controller.signal });
      }
      // Only completed 429/503 responses get one sequential retry, within the same deadline.
      for (let attempt = 0; ; attempt++) {
        const remaining = deadline - Date.now();
        if (controller.signal.aborted || remaining <= 0) throw new OpenAI.APIConnectionTimeoutError();
        try {
          return await this.client.chat.completions.create(parameters, { timeout: remaining, signal: controller.signal, maxRetries: 0 });
        } catch (error) {
          if (controller.signal.aborted) throw new OpenAI.APIConnectionTimeoutError();
          if (attempt !== 0 || !(error instanceof OpenAI.APIError)
            || (error.status !== 429 && error.status !== 503)
            || deadline - Date.now() <= NVIDIA_RETRY_DELAY_MS) throw error;
          await new Promise<void>((resolve) => setTimeout(resolve, NVIDIA_RETRY_DELAY_MS));
        }
      }
    };
    try {
      return await Promise.race([collect(), expired]);
    } catch (error) {
      if (controller.signal.aborted) throw new OpenAI.APIConnectionTimeoutError();
      throw error;
    } finally {
      clearTimeout(timeout!);
      controller.abort();
    }
  }

  /** Reasoning and final text arrive as separate SSE deltas; only final content is task output. */
  private async streamFinalContent(parameters: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    const opened: { stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> | null } = { stream: null };
    let timeout: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        const error = new OpenAI.APIConnectionTimeoutError();
        controller.abort(error);
        opened.stream?.controller.abort(error);
        reject(error);
      }, timeoutMs);
    });

    const collect = async (): Promise<string> => {
      // Retrying ends as soon as a stream opens, even if it has not emitted content yet.
      for (let attempt = 0; ; attempt++) {
        const remaining = deadline - Date.now();
        if (controller.signal.aborted || remaining <= 0) throw new OpenAI.APIConnectionTimeoutError();
        try {
          opened.stream = await this.client.chat.completions.create(parameters, { timeout: remaining, signal: controller.signal, maxRetries: 0 });
          break;
        } catch (error) {
          if (controller.signal.aborted) throw new OpenAI.APIConnectionTimeoutError();
          if (attempt !== 0 || !(error instanceof OpenAI.APIError)
            || (error.status !== 429 && error.status !== 503)
            || deadline - Date.now() <= NVIDIA_RETRY_DELAY_MS) throw error;
          await new Promise<void>((resolve) => setTimeout(resolve, NVIDIA_RETRY_DELAY_MS));
        }
      }
      const stream = opened.stream;
      if (controller.signal.aborted) {
        stream.controller.abort();
        throw new OpenAI.APIConnectionTimeoutError();
      }

      let content = "";
      let finishReason: OpenAI.Chat.Completions.ChatCompletionChunk.Choice["finish_reason"] = null;
      for await (const chunk of stream) {
        if (controller.signal.aborted) throw new OpenAI.APIConnectionTimeoutError();
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.finish_reason === "content_filter" || choice.delta.refusal) {
          throw new AIProviderError("refusal", "The provider declined the request.");
        }
        if (choice.finish_reason === "length") {
          throw new AIProviderError("truncated", "The provider stopped at the output token limit.");
        }
        if (typeof choice.delta.content === "string") content += choice.delta.content;
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      // The SDK can end an aborted stream without throwing. Never accept that partial text.
      if (controller.signal.aborted || Date.now() >= deadline) throw new OpenAI.APIConnectionTimeoutError();
      if (finishReason !== "stop") throw new AIProviderError("invalid_output", "The provider stream ended without a completed final text response.");
      if (!content.trim()) throw new AIProviderError("invalid_output", "The provider returned no final text output.");
      return content;
    };

    try {
      // Abort closes the transport; the race also bounds an iterator that does not honor cancellation.
      return await Promise.race([collect(), expired]);
    } catch (error) {
      if (controller.signal.aborted) throw new OpenAI.APIConnectionTimeoutError();
      throw error;
    } finally {
      clearTimeout(timeout!);
      controller.abort();
      opened.stream?.controller.abort();
    }
  }

  async generateJson(request: JsonGenerationRequest): Promise<string> {
    try {
      const limit = this.info.provider === "nvidia" ? NVIDIA_TIMEOUT_MS : 90000;
      const timeoutMs = Number.isFinite(request.timeoutMs) ? Math.min(limit, Math.max(1000, request.timeoutMs!)) : limit;
      const { stream: streaming, ...sampling } = this.info.provider === "nvidia"
        ? nvidiaModelSettings(this.info.model!, request.effort)
        : { stream: false, temperature: 0.2, reasoning_effort: "none" as const };
      // Preprocessors accept loose input locally; tell the model the actual required output types.
      const schema = z.toJSONSchema(request.schema, { io: "output", target: "draft-7" });
      const systemMessage = [
        request.system,
        "Return only a complete JSON object matching the following JSON Schema. Include every required field. Do not include markdown, prose or reasoning outside the object.",
        `Schema name: ${request.schemaName}`,
        JSON.stringify(schema),
      ].join("\n\n");

      const parameters: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: this.info.model!,
        messages: [
          { role: "system", content: systemMessage },
          ...request.messages.map((message) => ({ role: message.role, content: message.content })),
        ],
        response_format: { type: "json_object" },
        stream: false as const,
        max_tokens: effectiveMaxTokens(this.info, request.maxTokens),
        ...sampling,
      };

      if (streaming) return await this.streamFinalContent({ ...parameters, stream: true }, timeoutMs);
      const response = await this.complete(parameters, timeoutMs);

      const choice = response.choices[0];
      if (choice?.finish_reason === "content_filter" || choice?.message?.refusal) {
        throw new AIProviderError("refusal", "The provider declined the request.");
      }
      if (choice?.finish_reason === "length") {
        throw new AIProviderError("truncated", "The provider stopped at the output token limit.");
      }
      if (!choice?.message?.content?.trim()) {
        throw new AIProviderError("invalid_output", "The provider returned no final text output.");
      }
      // Preserve the complete raw response. The common parser owns any tolerant JSON extraction.
      return choice.message.content;
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

export class DeepSeekProvider extends CompatibleJsonProvider {
  constructor(
    model: string = DEFAULT_DEEPSEEK_MODEL,
    apiKey: string | undefined = process.env.DEEPSEEK_API_KEY,
    baseURL: string = process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
    client?: OpenAI,
  ) {
    super("deepseek", model, apiKey, baseURL, client);
  }
}

export class NvidiaProvider extends CompatibleJsonProvider {
  constructor(
    model: string = DEFAULT_NVIDIA_MODEL,
    apiKey: string | undefined = process.env.NVIDIA_API_KEY,
    baseURL: string = process.env.NVIDIA_BASE_URL?.trim() || DEFAULT_NVIDIA_BASE_URL,
    client?: OpenAI,
  ) {
    super("nvidia", model, apiKey, baseURL, client);
  }
}

/** User-selected chat-completions gateway. Native OpenAI remains on its Responses adapter. */
export class OpenAICompatibleProvider extends CompatibleJsonProvider {
  constructor(model: string, apiKey: string, baseURL: string, client?: OpenAI) {
    super("compatible", model, apiKey, baseURL, client);
  }
}

function toProviderError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new AIProviderError("timeout", "Provider request timed out.");
  if (error instanceof OpenAI.APIConnectionError) return new AIProviderError("network", "Provider connection failed.");
  if (error instanceof OpenAI.APIError) {
    // HTTP-200 SSE error events carry no HTTP failure status. The provider explicitly
    // reported an invocation failure; do not mislabel it as a connection problem.
    return new AIProviderError(error.status === undefined ? "unavailable" : kindFromStatus(error.status), `Provider request failed (HTTP ${error.status ?? "stream"}).`);
  }
  return new AIProviderError("unknown", "Provider invocation failed.");
}
