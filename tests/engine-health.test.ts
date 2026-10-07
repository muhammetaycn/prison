import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineHealthResult } from "@/models/engine-health";
import { AIProviderError } from "@/services/ai/errors";
import type { EngineStatus } from "@/services/ai/config";
import { checkEngineConnection, createEngineConnectionCheck } from "@/services/ai/health";
import type { LLMProvider } from "@/services/ai/types";
import { ScriptedProvider } from "./helpers";

const AI_ENGINE: EngineStatus = { mode: "ai", provider: "nvidia", model: "test-model" };
const LOCAL_ENGINE: EngineStatus = { mode: "local", provider: "local", model: null, reason: "no_key" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@/services/runtime");
});

describe("manual engine connectivity check", () => {
  it("validates a small connection response and returns safe metadata", async () => {
    const provider = new ScriptedProvider().enqueue("engine_connection_check", { ok: true });
    const health = await checkEngineConnection(AI_ENGINE, provider);
    expect(health).toMatchObject({ status: "connected", provider: "nvidia", model: "test-model" });
    expect(Date.parse(health.checkedAt)).not.toBeNaN();
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.message).toMatch(/doğrulandı/);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({ maxTokens: 512, effort: "low" });
    expect(health).not.toHaveProperty("errorKind");
  });

  it("returns local status without calling a remote provider", async () => {
    const provider = new ScriptedProvider();
    expect(await checkEngineConnection(LOCAL_ENGINE, provider)).toMatchObject({ status: "local", provider: "local", model: null });
    expect(provider.calls).toHaveLength(0);
    expect(await checkEngineConnection(LOCAL_ENGINE, null)).toMatchObject({ status: "local" });
  });

  it.each(["not JSON", '{"ok":"true"}', '{"ok":false}'])("rejects invalid confirmation %s without a retry", async (response) => {
    const provider = new ScriptedProvider().enqueue("engine_connection_check", response);
    expect(await checkEngineConnection(AI_ENGINE, provider)).toMatchObject({ status: "error", errorKind: "invalid_output" });
    expect(provider.calls).toHaveLength(1);
  });

  it.each(["refusal", "network", "timeout", "auth", "truncated"] as const)("returns a safe %s message without a retry", async (kind) => {
    const provider = new ScriptedProvider().enqueue("engine_connection_check", new AIProviderError(kind, "secret-key-and-provider-detail"));
    const result = await checkEngineConnection(AI_ENGINE, provider);
    expect(result).toMatchObject({ status: "error", errorKind: kind });
    expect(JSON.stringify(result)).not.toContain("secret-key-and-provider-detail");
    expect(provider.calls).toHaveLength(1);
  });

  it("hides unexpected error details and reports absent AI provider configuration", async () => {
    const provider = new ScriptedProvider().enqueue("engine_connection_check", new Error("secret-key-and-provider-detail"));
    const result = await checkEngineConnection(AI_ENGINE, provider);
    expect(result.errorKind).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("secret-key-and-provider-detail");
    expect(await checkEngineConnection(AI_ENGINE, null)).toMatchObject({ status: "error", errorKind: "configuration" });
  });

  it("shares a pending check and allows a fresh manual check after completion", async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => { resolve = done; });
    const provider: LLMProvider = {
      info: { mode: "ai", provider: "nvidia", model: "test-model" },
      generateJson: vi.fn().mockReturnValueOnce(pending).mockResolvedValue('{"ok":true}'),
    };
    const check = createEngineConnectionCheck(AI_ENGINE, provider);
    const first = check();
    const second = check();
    expect(first).toBe(second);
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
    resolve('{"ok":true}');
    expect((await first).status).toBe("connected");
    expect(await second).toEqual(await first);
    expect((await check()).status).toBe("connected");
    expect(provider.generateJson).toHaveBeenCalledTimes(2);
  });

  it("releases a failed check so a later manual check can recover", async () => {
    const provider = new ScriptedProvider().enqueue("engine_connection_check", new AIProviderError("network", "offline"), { ok: true });
    const check = createEngineConnectionCheck(AI_ENGINE, provider);
    expect((await check()).status).toBe("error");
    expect((await check()).status).toBe("connected");
    expect(provider.calls).toHaveLength(2);
  });
});

describe("POST /api/engine/check", () => {
  it("keeps the ordinary engine status request free of remote checks", async () => {
    const checkEngine = vi.fn();
    vi.doMock("@/services/runtime", () => ({ getRuntime: () => ({ engine: AI_ENGINE, checkEngine }) }));
    const { GET } = await import("@/app/api/engine/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ engine: AI_ENGINE, council: { enabled: false, models: [] } });
    expect(checkEngine).not.toHaveBeenCalled();
    // The first cold import of the route graph can exceed the 5 s default under a parallel full run.
  }, 30000);

  it("returns the safe result in the health envelope", async () => {
    const health: EngineHealthResult = { status: "connected", provider: "nvidia", model: "test-model", checkedAt: new Date().toISOString(), latencyMs: 20, message: "API bağlantısı doğrulandı." };
    const checkEngine = vi.fn().mockResolvedValue(health);
    vi.doMock("@/services/runtime", () => ({ getRuntime: () => ({ checkEngine }) }));
    const { POST } = await import("@/app/api/engine/check/route");
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ health });
    expect(checkEngine).toHaveBeenCalledTimes(1);
  });

  it("uses the existing safe configuration error response", async () => {
    const { AIProviderError: CurrentAIProviderError } = await import("@/services/ai/errors");
    vi.doMock("@/services/runtime", () => ({ getRuntime: () => { throw new CurrentAIProviderError("configuration", "secret-key-and-provider-detail"); } }));
    const { POST } = await import("@/app/api/engine/check/route");
    const response = await POST();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("ai_error");
    expect(body.error.message).toMatch(/yapılandırması/);
    expect(JSON.stringify(body)).not.toContain("secret-key-and-provider-detail");
  });

  it("returns a provider failure as a usable health result", async () => {
    const health: EngineHealthResult = { status: "error", provider: "nvidia", model: "test-model", checkedAt: new Date().toISOString(), latencyMs: 20, message: "AI sağlayıcısına bağlanılamadı.", errorKind: "network" };
    vi.doMock("@/services/runtime", () => ({ getRuntime: () => ({ checkEngine: () => Promise.resolve(health) }) }));
    const { POST } = await import("@/app/api/engine/check/route");
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ health });
  });
});
