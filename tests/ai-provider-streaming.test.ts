import OpenAI from "openai";
import { Stream } from "openai/core/streaming";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_NVIDIA_BASE_URL, NvidiaProvider } from "@/services/ai/deepseek";
import type { JsonGenerationRequest } from "@/services/ai/types";

const ULTRA = "nvidia/nemotron-3-ultra-550b-a55b";
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;
type Delta = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & { reasoning_content?: string };
const request: JsonGenerationRequest = {
  system: "Understand the task", messages: [{ role: "user", content: "Write a report" }],
  schema: z.object({ answer: z.string() }), schemaName: "stream_output", maxTokens: 4096, effort: "medium",
};

function chunk(delta: Delta = {}, finishReason: Chunk["choices"][number]["finish_reason"] = null): Chunk {
  return { id: "stream-test", object: "chat.completion.chunk", created: 0, model: ULTRA,
    choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

function fromChunks(...chunks: Chunk[]): Stream<Chunk> {
  return new Stream<Chunk>(async function* () { for (const entry of chunks) yield entry; }, new AbortController());
}

function mockProvider(stream: Stream<Chunk>) {
  const client = new OpenAI({ apiKey: "test", maxRetries: 0 });
  const create = vi.spyOn(client.chat.completions, "create").mockResolvedValue(stream);
  return { provider: new NvidiaProvider(ULTRA, "test", DEFAULT_NVIDIA_BASE_URL, client), create };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Ultra final-content streaming", () => {
  it("joins only content deltas, ignoring reasoning, roles and empty usage chunks", async () => {
    const stream = fromChunks(
      chunk({ role: "assistant", reasoning_content: "Hidden reasoning must not become task output" }),
      { ...chunk(), choices: [] },
      chunk({ content: null, reasoning_content: "More hidden reasoning" }),
      chunk({ content: '{"answer":' }), chunk({ content: '"ok"}' }), chunk({}, "stop"),
    );
    const { provider, create } = mockProvider(stream);
    await expect(provider.generateJson(request)).resolves.toBe('{"answer":"ok"}');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ stream: true, max_tokens: 8000, reasoning_effort: "medium", temperature: 1, top_p: 0.95 });
    expect(create.mock.calls[0]![1]).toMatchObject({ timeout: 180000, maxRetries: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits until the entire stream ends before returning even complete JSON and a stop marker", async () => {
    let release!: () => void;
    const ending = new Promise<void>((resolve) => { release = resolve; });
    const stream = new Stream<Chunk>(async function* () {
      yield chunk({ content: '{"answer":"ok"}' }, "stop");
      await ending;
    }, new AbortController());
    const { provider } = mockProvider(stream);
    let finished = false;
    const output = provider.generateJson(request).then((value) => { finished = true; return value; });
    await vi.advanceTimersByTimeAsync(1);
    expect(finished).toBe(false);
    release();
    await expect(output).resolves.toBe('{"answer":"ok"}');
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a length finish even when the collected text happens to be valid JSON", async () => {
    const { provider, create } = mockProvider(fromChunks(chunk({ content: '{"answer":"partial"}' }), chunk({}, "length")));
    await expect(provider.generateJson(request)).rejects.toMatchObject({ kind: "truncated" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["content filter", chunk({}, "content_filter")],
    ["refusal delta", chunk({ refusal: "Declined" })],
  ])("rejects a %s without returning preceding partial text", async (_label, refused) => {
    const { provider, create } = mockProvider(fromChunks(chunk({ content: '{"answer":"partial"}' }), refused));
    await expect(provider.generateJson(request)).rejects.toMatchObject({ kind: "refusal" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an empty final response despite receiving reasoning deltas", async () => {
    const { provider } = mockProvider(fromChunks(chunk({ reasoning_content: "Only reasoning", content: " " }), chunk({}, "stop")));
    await expect(provider.generateJson(request)).rejects.toMatchObject({ kind: "invalid_output" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects JSON from a stream that ends without a finish marker", async () => {
    const { provider } = mockProvider(fromChunks(chunk({ content: '{"answer":"partial"}' })));
    await expect(provider.generateJson(request)).rejects.toMatchObject({ kind: "invalid_output" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([429, 503])("does not retry HTTP %i raised by an already-open stream, even before its first chunk", async (status) => {
    const stream = new Stream<Chunk>(async function* () {
      throw OpenAI.APIError.generate(status, { message: "Stream failed" }, "Stream failed", new Headers());
    }, new AbortController());
    const { provider, create } = mockProvider(stream);
    await expect(provider.generateJson(request)).rejects.toMatchObject({ kind: status === 429 ? "rate_limit" : "unavailable" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("classifies a real SDK SSE provider error as unavailable without retrying or returning partial output (partial: %s)", async (withPartial) => {
    const partial = withPartial ? `data: ${JSON.stringify(chunk({ content: '{"answer":"partial"}' }))}\n\n` : "";
    const response = new Response(`${partial}event: error\ndata: {"error":{"message":"Internal server error"}}\n\n`, {
      status: 200, headers: { "content-type": "text/event-stream" },
    });
    const stream = Stream.fromSSEResponse<Chunk>(response, new AbortController());
    const { provider, create } = mockProvider(stream);
    await expect(provider.generateJson(request)).rejects.toMatchObject({ kind: "unavailable" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).not.toHaveProperty("chat_template_kwargs.reasoning_budget");
    expect(stream.controller.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not guess a provider error kind from arbitrary error message text", async () => {
    const stream = new Stream<Chunk>(async function* () { throw new Error("Internal server error"); }, new AbortController());
    const { provider, create } = mockProvider(stream);
    await expect(provider.generateJson(request)).rejects.toMatchObject({ kind: "unknown" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry or return JSON when the transport fails after content arrives", async () => {
    const stream = new Stream<Chunk>(async function* () {
      yield chunk({ content: '{"answer":"partial"}' });
      throw new OpenAI.APIConnectionError({ message: "Disconnected mid-stream" });
    }, new AbortController());
    const { provider, create } = mockProvider(stream);
    await expect(provider.generateJson(request)).rejects.toMatchObject({ kind: "network" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([429, 503])("retries a completed HTTP %i only before opening the stream", async (status) => {
    const { provider, create } = mockProvider(fromChunks(chunk({ content: '{"answer":"ok"}' }, "stop")));
    create.mockRejectedValueOnce(OpenAI.APIError.generate(status, { message: "Busy" }, "Busy", new Headers()));
    const output = provider.generateJson(request);
    await vi.advanceTimersByTimeAsync(499);
    expect(create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(output).resolves.toBe('{"answer":"ok"}');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![1]).toMatchObject({ timeout: 179500, maxRetries: 0 });
    expect(create.mock.calls[0]![1]!.signal).toBe(create.mock.calls[1]![1]!.signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts and rejects partial content at the total 180-second deadline, without retrying", async () => {
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const stream = new Stream<Chunk>(async function* () {
      yield chunk({ content: '{"answer":"partial"}' });
      await paused; // This synthetic iterator deliberately ignores cancellation.
      yield chunk({}, "stop");
    }, new AbortController());
    const { provider, create } = mockProvider(stream);
    const result = expect(provider.generateJson(request)).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(179999);
    expect(create.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(stream.controller.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("counts the retry delay in the same deadline rather than resetting it when a stream opens", async () => {
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const stream = new Stream<Chunk>(async function* () {
      yield chunk({ content: '{"answer":"partial"}' });
      await paused;
      yield chunk({}, "stop");
    }, new AbortController());
    const { provider, create } = mockProvider(stream);
    create.mockRejectedValueOnce(OpenAI.APIError.generate(503, { message: "Busy" }, "Busy", new Headers()));
    const result = expect(provider.generateJson(request)).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(500);
    expect(create).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(179500);
    await result;
    expect(create).toHaveBeenCalledTimes(2);
    expect(stream.controller.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
  });
});
