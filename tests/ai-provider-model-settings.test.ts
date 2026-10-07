import OpenAI from "openai";
import { Stream } from "openai/core/streaming";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DeepSeekProvider, DEFAULT_DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_MODEL, DEFAULT_NVIDIA_BASE_URL, NvidiaProvider } from "@/services/ai/deepseek";
import type { Effort, JsonGenerationRequest } from "@/services/ai/types";

const ULTRA = "nvidia/nemotron-3-ultra-550b-a55b";
const request: JsonGenerationRequest = {
  system: "Understand the task", messages: [{ role: "user", content: "Write a report" }],
  schema: z.object({ answer: z.string() }), schemaName: "model_settings", maxTokens: 4096, effort: "medium",
};
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;

function streamClient(model: string) {
  const client = new OpenAI({ apiKey: "test", maxRetries: 0 });
  const stream = new Stream<Chunk>(async function* () {
    yield { id: "test", object: "chat.completion.chunk", model, created: 0, choices: [{ index: 0, finish_reason: null,
      delta: { reasoning_content: "Private trace is not task output" } as Chunk["choices"][number]["delta"] }] };
    yield { id: "test", object: "chat.completion.chunk", model, created: 0, choices: [{ index: 0, finish_reason: "stop", delta: { content: '{"answer":"ok"}' } }] };
  }, new AbortController());
  const create = vi.spyOn(client.chat.completions, "create").mockResolvedValue(stream);
  return { provider: new NvidiaProvider(model, "test", DEFAULT_NVIDIA_BASE_URL, client), create };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("NVIDIA hosted model-specific controls", () => {
  it.each([
    ["deepseek-ai/deepseek-v4.1-flash", { temperature: 1, top_p: 0.95 }],
    ["z-ai/glm-5.3", { temperature: 0.5, top_p: 1, reasoning_effort: "low", chat_template_kwargs: { clear_thinking: true, reasoning_effort: "low" } }],
    ["z-ai/glm-5.3-flash", { temperature: 0.5, top_p: 1, reasoning_effort: "low", chat_template_kwargs: { clear_thinking: true, reasoning_effort: "low" } }],
    ["moonshotai/kimi-k3", { temperature: 1, reasoning_effort: "low" }],
    ["meta/muse-glimmer-30b", { temperature: 0.95, top_p: 1, reasoning_effort: "medium", chat_template_kwargs: { reasoning_strength: "medium" } }],
    [ULTRA, { temperature: 1, top_p: 0.95, reasoning_effort: "medium", chat_template_kwargs: { enable_thinking: true, medium_effort: true } }],
    ["nvidia/nemotron-3-super-120b-a12b", { temperature: 1, top_p: 0.95, reasoning_effort: "low", chat_template_kwargs: { enable_thinking: true, low_effort: true } }],
    ["openai/gpt-oss-20b", { temperature: 0.6, top_p: 0.7, reasoning_effort: "medium" }],
  ] as const)("uses %s's own wire contract and a 60-second whole-response deadline", async (model, settings) => {
    const { provider, create } = streamClient(model);
    await expect(provider.generateJson({ ...request, timeoutMs: 60000 })).resolves.toBe('{"answer":"ok"}');
    expect(provider.info).toMatchObject({ provider: "nvidia", model });
    expect(create.mock.calls[0]![0]).toMatchObject({ model, stream: true, max_tokens: model === ULTRA ? 8000 : 4096, ...settings });
    expect(create.mock.calls[0]![1]).toMatchObject({ timeout: 60000, maxRetries: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["z-ai/glm-5.3", "z-ai/glm-5.3-flash", "moonshotai/kimi-k3"])("never sends unsupported medium or default max effort to %s", async (model) => {
    const { provider, create } = streamClient(model);
    await provider.generateJson({ ...request, effort: "high" });
    expect(create.mock.calls[0]![0]).toHaveProperty("reasoning_effort", "high");
    if (model.startsWith("z-ai/")) expect(create.mock.calls[0]![0]).toHaveProperty("chat_template_kwargs.reasoning_effort", "high");
  });

  it("does not send Kimi's fixed sampling knobs or another model's thinking template", async () => {
    const { provider, create } = streamClient("moonshotai/kimi-k3");
    await provider.generateJson(request);
    for (const field of ["top_p", "frequency_penalty", "presence_penalty", "n", "chat_template_kwargs"]) {
      expect(create.mock.calls[0]![0]).not.toHaveProperty(field);
    }
  });

  it("does not invent hosted DeepSeek V4.1 numeric or generic thinking parameters", async () => {
    const { provider, create } = streamClient("deepseek-ai/deepseek-v4.1-flash");
    await provider.generateJson(request);
    expect(create.mock.calls[0]![0]).not.toHaveProperty("reasoning_effort");
    expect(create.mock.calls[0]![0]).not.toHaveProperty("reasoning_budget");
    expect(create.mock.calls[0]![0]).not.toHaveProperty("chat_template_kwargs");
  });

  it.each(["low", "medium", "high"] as Effort[])("keeps Ultra's %s call in hosted-compatible medium thinking without a rejected budget", async (effort) => {
    const { provider, create } = streamClient(ULTRA);
    await provider.generateJson({ ...request, effort });
    expect(create.mock.calls[0]![0]).toHaveProperty("chat_template_kwargs", {
      enable_thinking: true, medium_effort: true,
    });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("reasoning_budget");
    expect(create.mock.calls[0]![0]).not.toHaveProperty("chat_template_kwargs.reasoning_budget");
  });

  it("keeps Super high effort explicit without an Ultra template or rejected budget", async () => {
    const { provider, create } = streamClient("nvidia/nemotron-3-super-120b-a12b");
    await provider.generateJson({ ...request, effort: "high" });
    expect(create.mock.calls[0]![0]).toMatchObject({ reasoning_effort: "high", chat_template_kwargs: { enable_thinking: true, low_effort: false } });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("chat_template_kwargs.medium_effort");
    expect(create.mock.calls[0]![0]).not.toHaveProperty("reasoning_budget");
  });

  it("never exceeds GPT-OSS 20B's hosted output ceiling on a large request", async () => {
    const { provider, create } = streamClient("openai/gpt-oss-20b");
    await provider.generateJson({ ...request, maxTokens: 16000 });
    expect(create.mock.calls[0]![0]).toHaveProperty("max_tokens", 4096);
    expect(create.mock.calls[0]![0]).not.toHaveProperty("chat_template_kwargs");
  });

  it("leaves GPT-OSS 20B room for complete JSON when a task asks for high effort", async () => {
    const { provider, create } = streamClient("openai/gpt-oss-20b");
    await provider.generateJson({ ...request, effort: "high", maxTokens: 16000 });
    expect(create.mock.calls[0]![0]).toMatchObject({ max_tokens: 4096, reasoning_effort: "medium" });
  });
});

describe("whole-response timeout bounds", () => {
  it.each([
    [60000, 60000], [500, 1000], [300000, 180000],
  ])("clamps NVIDIA timeout %i to %i and aborts an unfinished stream", async (requested, actual) => {
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const client = new OpenAI({ apiKey: "test", maxRetries: 0 });
    const stream = new Stream<Chunk>(async function* () { await paused; }, new AbortController());
    const create = vi.spyOn(client.chat.completions, "create").mockResolvedValue(stream);
    const provider = new NvidiaProvider("z-ai/glm-5.3-flash", "test", DEFAULT_NVIDIA_BASE_URL, client);
    const result = expect(provider.generateJson({ ...request, timeoutMs: requested })).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(actual - 1);
    expect(create.mock.calls[0]![1]).toHaveProperty("timeout", actual);
    expect(create.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(create).toHaveBeenCalledTimes(1);
    expect(stream.controller.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each([
    [60000, 60000], [300000, 90000],
  ])("bounds DeepSeek's entire non-streaming response from requested %i to %i", async (requested, actual) => {
    let transportSignal: AbortSignal | undefined;
    const fakeFetch = vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
      transportSignal = init?.signal ?? undefined;
      transportSignal?.addEventListener("abort", () => reject(transportSignal!.reason), { once: true });
    }));
    const client = new OpenAI({ apiKey: "test", baseURL: DEFAULT_DEEPSEEK_BASE_URL, maxRetries: 1, fetch: fakeFetch });
    const provider = new DeepSeekProvider(DEFAULT_DEEPSEEK_MODEL, "test", DEFAULT_DEEPSEEK_BASE_URL, client);
    const result = expect(provider.generateJson({ ...request, timeoutMs: requested })).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(actual - 1);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(transportSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(transportSignal?.aborted).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
