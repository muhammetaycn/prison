import OpenAI from "openai";
import { Stream } from "openai/core/streaming";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resolveEngineStatus, createProvider } from "@/services/ai/config";
import {
  DEFAULT_DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_MODEL, DEFAULT_NVIDIA_BASE_URL, DEFAULT_NVIDIA_MODEL,
  DeepSeekProvider, NvidiaProvider,
} from "@/services/ai/deepseek";
import { buildIntentSchema } from "@/models/intent";
import type { JsonGenerationRequest } from "@/services/ai/types";
import { generateStructured } from "@/services/ai/structured";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("provider environment configuration", () => {
  it("uses the official DeepSeek model for a DeepSeek key", () => {
    expect(resolveEngineStatus({ DEEPSEEK_API_KEY: "test" })).toEqual({ mode: "ai", provider: "deepseek", model: DEFAULT_DEEPSEEK_MODEL });
  });

  it("uses NVIDIA for NVIDIA settings, including the earlier deepseek alias", () => {
    expect(resolveEngineStatus({ NVIDIA_API_KEY: "test" })).toEqual({ mode: "ai", provider: "nvidia", model: DEFAULT_NVIDIA_MODEL });
    expect(resolveEngineStatus({ DEEPSEEK_API_KEY: "test", PRISON_MODEL: DEFAULT_NVIDIA_MODEL, PRISON_PROVIDER: "deepseek" })).toMatchObject({ provider: "nvidia", model: DEFAULT_NVIDIA_MODEL });
    expect(resolveEngineStatus({ DEEPSEEK_API_KEY: "test", NVIDIA_API_KEY: "test", PRISON_MODEL: DEFAULT_NVIDIA_MODEL })).toMatchObject({ provider: "nvidia" });
  });

  it("honors an explicit DeepSeek choice when both keys exist", () => {
    expect(resolveEngineStatus({ PRISON_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "test", NVIDIA_API_KEY: "test" })).toMatchObject({ provider: "deepseek", model: DEFAULT_DEEPSEEK_MODEL });
  });

  it("reports invalid forced settings instead of silently running locally", () => {
    expect(() => resolveEngineStatus({ PRISON_PROVIDER: "nvidia" })).toThrow(/yapılandırması/);
    expect(() => resolveEngineStatus({ PRISON_PROVIDER: "typo" })).toThrow(/yapılandırması/);
    expect(resolveEngineStatus({ NVIDIA_API_KEY: "  " })).toMatchObject({ mode: "local", reason: "no_key" });
    expect(resolveEngineStatus({ PRISON_PROVIDER: "local", NVIDIA_API_KEY: "test" })).toMatchObject({ mode: "local", reason: "forced" });
  });

  it.each([
    ["nvidia", "NVIDIA_API_KEY", DEFAULT_NVIDIA_BASE_URL],
    ["deepseek", "DEEPSEEK_API_KEY", DEFAULT_DEEPSEEK_BASE_URL],
  ] as const)("creates %s with its own key and endpoint", (provider, keyName, baseURL) => {
    const env = { PRISON_PROVIDER: provider, [keyName]: "test" };
    const instance = createProvider(resolveEngineStatus(env), env)!;
    expect(instance.info.provider).toBe(provider);
    const client = (instance as unknown as { client: OpenAI }).client;
    expect(client.baseURL).toBe(baseURL);
    expect(client.timeout).toBe(provider === "nvidia" ? 180000 : 90000);
    expect(client.maxRetries).toBe(provider === "nvidia" ? 0 : 1);
  });

  it("honors explicit NVIDIA endpoint over the legacy endpoint", () => {
    const env = { NVIDIA_API_KEY: "test", PRISON_MODEL: DEFAULT_NVIDIA_MODEL, NVIDIA_BASE_URL: "https://gateway.example/v1", DEEPSEEK_BASE_URL: DEFAULT_NVIDIA_BASE_URL };
    const instance = createProvider(resolveEngineStatus(env), env)!;
    expect((instance as unknown as { client: OpenAI }).client.baseURL).toBe(env.NVIDIA_BASE_URL);
  });
});

const request: JsonGenerationRequest = {
  system: "Understand the task", messages: [{ role: "user", content: "Write a report" }],
  schema: z.object({ answer: z.string() }), schemaName: "test_output", maxTokens: 1000, effort: "low",
};

function mockClient(content: string | null, finishReason: string = "stop", refusal?: string) {
  const client = new OpenAI({ apiKey: "test", maxRetries: 0 });
  const create = vi.spyOn(client.chat.completions, "create").mockResolvedValue({
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content, refusal } }],
  } as OpenAI.Chat.Completions.ChatCompletion);
  return { client, create };
}

function finalStream(content: string | null, finishReason: OpenAI.Chat.Completions.ChatCompletionChunk.Choice["finish_reason"] = "stop") {
  return new Stream<OpenAI.Chat.Completions.ChatCompletionChunk>(async function* () {
    yield { id: "test", object: "chat.completion.chunk", created: 0, model: "nvidia/nemotron-3-ultra-550b-a55b",
      choices: [{ index: 0, finish_reason: finishReason, delta: { content } }] };
  }, new AbortController());
}

function mockStreamingClient(content: string | null) {
  const client = new OpenAI({ apiKey: "test", maxRetries: 0 });
  const create = vi.spyOn(client.chat.completions, "create").mockResolvedValue(finalStream(content));
  return { client, create };
}

describe("OpenAI-compatible JSON providers", () => {
  it("uses Ultra's explicit medium template and bounded nested budget without a top-level budget", async () => {
    const { client, create } = mockStreamingClient('{"answer":"ok"}');
    const provider = new NvidiaProvider("nvidia/nemotron-3-ultra-550b-a55b", "test", DEFAULT_NVIDIA_BASE_URL, client);
    await provider.generateJson(request);
    const body = create.mock.calls[0]![0];
    expect(body).toMatchObject({ reasoning_effort: "medium", temperature: 1, top_p: 0.95, max_tokens: 8000, stream: true, response_format: { type: "json_object" } });
    expect(body).not.toHaveProperty("reasoning_budget");
    expect(body).toHaveProperty("chat_template_kwargs", { enable_thinking: true, medium_effort: true });
    expect(body).not.toHaveProperty("chat_template_kwargs.reasoning_budget");
  });
  it("sends the real output schema and explicitly requests a non-streaming JSON response", async () => {
    const { client, create } = mockClient('{"answer":"ok"}');
    const provider = new NvidiaProvider(DEFAULT_NVIDIA_MODEL, "test", DEFAULT_NVIDIA_BASE_URL, client);
    await expect(provider.generateJson({ ...request, schema: buildIntentSchema(["coding", "analysis"]) })).resolves.toBe('{"answer":"ok"}');
    const body = create.mock.calls[0]![0];
    expect(body).toMatchObject({ model: DEFAULT_NVIDIA_MODEL, response_format: { type: "json_object" }, stream: false, max_tokens: 1000, chat_template_kwargs: { enable_thinking: false } });
    const system = body.messages[0]!.content as string;
    const schema = JSON.parse(system.slice(system.lastIndexOf("\n\n") + 2));
    expect(schema.required).toContain("primary_goal");
    expect(schema.required).toContain("required_actions");
    expect(schema.required).toContain("success_conditions");
    expect(schema.properties.primary_goal.type).toBe("string");
    expect(schema.properties.coding_required.type).toBe("boolean");
    expect(schema.properties.required_actions.type).toBe("array");
    expect(schema.properties.task_type.enum).toEqual(["coding", "analysis"]);
  });

  it("omits Nemotron-specific thinking options for other NVIDIA models", async () => {
    const { client, create } = mockClient('{"answer":"ok"}');
    const provider = new NvidiaProvider("meta/llama-3.3-70b-instruct", "test", DEFAULT_NVIDIA_BASE_URL, client);
    await provider.generateJson(request);
    expect(create.mock.calls[0]![0]).toMatchObject({ model: "meta/llama-3.3-70b-instruct", response_format: { type: "json_object" } });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("chat_template_kwargs");
  });

  it("keeps text containing literal thinking tags untouched", async () => {
    const text = '{"answer":"Keep <think>literal</think> markers"}';
    const { client } = mockClient(text);
    expect(await new DeepSeekProvider(DEFAULT_DEEPSEEK_MODEL, "test", DEFAULT_DEEPSEEK_BASE_URL, client).generateJson(request)).toBe(text);
  });

  it.each([
    ["length", "truncated"], ["content_filter", "refusal"],
  ])("classifies %s instead of accepting partial output", async (finishReason, kind) => {
    const { client } = mockClient('{"answer":"partial"}', finishReason);
    await expect(new NvidiaProvider(DEFAULT_NVIDIA_MODEL, "test", DEFAULT_NVIDIA_BASE_URL, client).generateJson(request)).rejects.toMatchObject({ kind });
  });

  it("classifies an explicit refusal and empty final content", async () => {
    const refusal = mockClient(null, "stop", "Declined");
    await expect(new NvidiaProvider(DEFAULT_NVIDIA_MODEL, "test", DEFAULT_NVIDIA_BASE_URL, refusal.client).generateJson(request)).rejects.toMatchObject({ kind: "refusal" });
    const empty = mockClient(" ");
    await expect(new NvidiaProvider(DEFAULT_NVIDIA_MODEL, "test", DEFAULT_NVIDIA_BASE_URL, empty.client).generateJson(request)).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("preserves unsupported JSON-mode errors without making a silent fallback request", async () => {
    const { client, create } = mockClient(null);
    create.mockRejectedValue(new OpenAI.BadRequestError(400, { message: "Unsupported response_format" }, "Unsupported response_format", new Headers()));
    await expect(new NvidiaProvider(DEFAULT_NVIDIA_MODEL, "test", DEFAULT_NVIDIA_BASE_URL, client).generateJson(request)).rejects.toMatchObject({ kind: "bad_request" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [4096, 8000, 16000],
    [20000, 20000, 32768],
  ])("grows Ultra's effective %i-token budget on truncation within the NVIDIA ceiling", async (requested, firstBudget, retryBudget) => {
    const { client, create } = mockStreamingClient('{"answer":"ok"}');
    create.mockResolvedValueOnce(finalStream("partial", "length"));
    const provider = new NvidiaProvider("nvidia/nemotron-3-ultra-550b-a55b", "test", DEFAULT_NVIDIA_BASE_URL, client);
    await expect(generateStructured(provider, {
      system: request.system, user: "Write a report", schema: request.schema, schemaName: request.schemaName,
      effort: request.effort, maxTokens: requested,
    })).resolves.toEqual({ answer: "ok" });
    expect(create.mock.calls.map(([body]) => body.max_tokens)).toEqual([firstBudget, retryBudget]);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("NVIDIA bounded HTTP retries", () => {
  it.each([429, 503])("retries a completed HTTP %i once after 500ms, using the remaining deadline", async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { client, create } = mockClient('{"answer":"ok"}');
    create.mockImplementationOnce(() => {
      vi.setSystemTime(2500);
      throw OpenAI.APIError.generate(status, { message: "Temporarily busy" }, "Temporarily busy", new Headers());
    });
    const provider = new NvidiaProvider(DEFAULT_NVIDIA_MODEL, "test", DEFAULT_NVIDIA_BASE_URL, client);
    const output = provider.generateJson(request);
    await vi.advanceTimersByTimeAsync(499);
    expect(create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(output).resolves.toBe('{"answer":"ok"}');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![1]).toMatchObject({ timeout: 180000, maxRetries: 0 });
    expect(create.mock.calls[1]![1]).toMatchObject({ timeout: 177000, maxRetries: 0 });
    expect(create.mock.calls[1]![0]).toEqual(create.mock.calls[0]![0]);
  });

  it.each([
    [429, "rate_limit"], [503, "unavailable"],
  ])("stops after two HTTP %i failures instead of retrying indefinitely", async (status, kind) => {
    vi.useFakeTimers();
    const { client, create } = mockClient(null);
    create.mockRejectedValue(OpenAI.APIError.generate(status as number, { message: "Still busy" }, "Still busy", new Headers()));
    const result = expect(new NvidiaProvider(DEFAULT_NVIDIA_MODEL, "test", DEFAULT_NVIDIA_BASE_URL, client).generateJson(request))
      .rejects.toMatchObject({ kind });
    await vi.advanceTimersByTimeAsync(500);
    await result;
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["network", () => new OpenAI.APIConnectionError({ message: "Connection failed" })],
    ["timeout", () => new OpenAI.APIConnectionTimeoutError()],
    ["HTTP 502", () => OpenAI.APIError.generate(502, { message: "Bad gateway" }, "Bad gateway", new Headers())],
    ["HTTP 504", () => OpenAI.APIError.generate(504, { message: "Gateway timeout" }, "Gateway timeout", new Headers())],
  ])("does not resubmit after %s", async (_label, makeError) => {
    const { client, create } = mockClient(null);
    create.mockRejectedValue(makeError());
    await expect(new NvidiaProvider(DEFAULT_NVIDIA_MODEL, "test", DEFAULT_NVIDIA_BASE_URL, client).generateJson(request))
      .rejects.toMatchObject({ kind: _label.startsWith("HTTP") ? "unavailable" : _label === "timeout" ? "timeout" : "network" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not spend beyond the total deadline to retry a late 503", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { client, create } = mockClient(null);
    create.mockImplementationOnce(() => {
      vi.setSystemTime(179500);
      throw OpenAI.APIError.generate(503, { message: "Too late to retry" }, "Too late to retry", new Headers());
    });
    await expect(new NvidiaProvider(DEFAULT_NVIDIA_MODEL, "test", DEFAULT_NVIDIA_BASE_URL, client).generateJson(request))
      .rejects.toMatchObject({ kind: "unavailable" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
