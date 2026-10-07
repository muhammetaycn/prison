import OpenAI from "openai";
import { Stream } from "openai/core/streaming";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCouncilCatalog, modelDiagnosticStatus, probeCouncilModel, probeFailureLabel } from "../scripts/council-model-probe";
import { DEFAULT_NVIDIA_BASE_URL, NvidiaProvider } from "@/services/ai/deepseek";
import { AIProviderError } from "@/services/ai/errors";

const MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const ULTRA = "nvidia/nemotron-3-ultra-550b-a55b";
const SECRET = "TEST_SECRET_MUST_NOT_BE_PRINTED";
const ENV = { NVIDIA_API_KEY: SECRET };
type Completion = OpenAI.Chat.Completions.ChatCompletion;
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;

function completion(content: string, finishReason: Completion["choices"][number]["finish_reason"] = "stop"): Completion {
  return { id: "probe-test", object: "chat.completion", created: 0, model: MODEL,
    choices: [{ index: 0, finish_reason: finishReason, logprobs: null, message: { role: "assistant", content, refusal: null } }] };
}

function mockProvider(model = MODEL) {
  const client = new OpenAI({ apiKey: SECRET, maxRetries: 0 });
  const create = vi.spyOn(client.chat.completions, "create");
  return { create, provider: new NvidiaProvider(model, SECRET, DEFAULT_NVIDIA_BASE_URL, client) };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("production council model diagnostics", () => {
  it.each([1, 2])("allows %i explicitly selected healthy endpoints without imposing council quorum", (count) => {
    const results = Array.from({ length: count }, () => ({ ok: true }));
    expect(modelDiagnosticStatus(results, "explicit")).toMatchObject({ ok: count, quorumFailed: false, exitCode: 0 });
    expect(modelDiagnosticStatus(results, "council")).toMatchObject({ ok: count, quorumFailed: true, exitCode: 1 });
  });

  it("fails an explicit diagnostic when any selected model fails while catalog scans remain informational", () => {
    const results = [{ ok: true }, { ok: false }];
    expect(modelDiagnosticStatus(results, "explicit")).toMatchObject({ ok: 1, quorumFailed: false, exitCode: 1 });
    expect(modelDiagnosticStatus(results, "catalog")).toMatchObject({ ok: 1, quorumFailed: false, exitCode: 0 });
  });

  it("uses the production provider, council schema and bounded request", async () => {
    const { create, provider } = mockProvider();
    create.mockResolvedValue(completion('{"ok":true}'));
    const result = await probeCouncilModel(MODEL, ENV, 90000, () => provider);
    expect(result).toMatchObject({ model: MODEL, ok: true, seconds: 0 });
    expect(create.mock.calls[0]![0]).toMatchObject({
      model: MODEL, stream: false, max_tokens: 1024, response_format: { type: "json_object" },
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(create.mock.calls[0]![0].messages[0].content).toContain("council_preflight");
    expect(create.mock.calls[0]![1]).toMatchObject({ timeout: 90000, maxRetries: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['{"ok":true', '{"ok":"true"}', '{"ok":false}', '{"status":"ok"}'])("rejects invalid connection JSON: %s", async (content) => {
    const { create, provider } = mockProvider();
    create.mockResolvedValue(completion(content));
    const result = await probeCouncilModel(MODEL, ENV, 90000, () => provider);
    expect(result).toMatchObject({ ok: false, result: "tam ve geçerli JSON yanıtı alınamadı" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects a truncated finish even when the content is valid JSON", async () => {
    const { create, provider } = mockProvider();
    create.mockResolvedValue(completion('{"ok":true}', "length"));
    await expect(probeCouncilModel(MODEL, ENV, 90000, () => provider)).resolves.toMatchObject({ ok: false, result: "yanıt yarıda kesildi" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("measures the complete production stream and does not expose private reasoning", async () => {
    const { create, provider } = mockProvider(ULTRA);
    let release!: () => void;
    const ended = new Promise<void>((resolve) => { release = resolve; });
    const stream = new Stream<Chunk>(async function* () {
      yield { id: "probe-test", object: "chat.completion.chunk", created: 0, model: ULTRA,
        choices: [{ index: 0, finish_reason: null, delta: { reasoning_content: SECRET } as Chunk["choices"][number]["delta"] }] };
      yield { id: "probe-test", object: "chat.completion.chunk", created: 0, model: ULTRA,
        choices: [{ index: 0, finish_reason: "stop", delta: { content: '{"ok":true}' } }] };
      await ended;
    }, new AbortController());
    create.mockResolvedValue(stream);
    let completed = false;
    const pending = probeCouncilModel(ULTRA, ENV, 90000, () => provider).then((result) => { completed = true; return result; });
    await vi.advanceTimersByTimeAsync(2500);
    expect(completed).toBe(false);
    release();
    const result = await pending;
    expect(result).toMatchObject({ ok: true, seconds: 2.5 });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(create.mock.calls[0]![0]).toHaveProperty("stream", true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a safe failure when the production call reaches its whole-response deadline", async () => {
    const { create, provider } = mockProvider();
    create.mockReturnValue(new Promise(() => {}) as never);
    const pending = probeCouncilModel(MODEL, ENV, 1000, () => provider);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ ok: false, result: "zaman aşımı", seconds: 1 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never reports SDK names, details or credential-like exception text", async () => {
    expect(probeFailureLabel(new AIProviderError("auth", SECRET))).toBe("erişim reddedildi");
    const result = await probeCouncilModel(MODEL, ENV, 90000, () => { throw Object.assign(new Error(SECRET), { name: SECRET }); });
    expect(result).toMatchObject({ ok: false, result: "kontrol tamamlanamadı" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe("bounded council catalog diagnostics", () => {
  it("validates, sorts and deduplicates the account catalog without returning credentials", async () => {
    const fetchCatalog = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "vendor/z" }, { id: "vendor/a" }, { id: "vendor/z" },
    ] })));
    await expect(listCouncilCatalog(ENV, 20000, fetchCatalog)).resolves.toEqual(["vendor/a", "vendor/z"]);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(fetchCatalog.mock.calls[0]![0]).toBe(`${DEFAULT_NVIDIA_BASE_URL}/models`);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a stalled catalog body even after HTTP headers arrive", async () => {
    const fetchCatalog = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as unknown as Response);
    const pending = listCouncilCatalog(ENV, 1000, fetchCatalog);
    const rejected = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(fetchCatalog.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["not JSON", '{"data":[{"id":5}]}'])("rejects invalid catalog output: %s", async (body) => {
    const fetchCatalog = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(listCouncilCatalog(ENV, 1000, fetchCatalog)).rejects.toMatchObject({ kind: "invalid_output" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
