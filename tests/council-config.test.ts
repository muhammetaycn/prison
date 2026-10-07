import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCouncil, DEFAULT_COUNCIL_MODELS, describeCouncil } from "@/services/ai/council-config";
import type { EngineStatus } from "@/services/ai/config";
import { AIProviderError } from "@/services/ai/errors";

const NVIDIA_ENGINE: EngineStatus = { mode: "ai", provider: "nvidia", model: "nvidia/primary-model" };
const MODELS = ["deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3", "meta/muse-glimmer-30b"];
const ENV = { NVIDIA_API_KEY: "test-council-credential", PRISON_COUNCIL_MODE: "enabled" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("@/services/runtime");
});

describe("NVIDIA council configuration", () => {
  it("stays disabled by default and creates no clients or remote work", () => {
    const local: EngineStatus = { mode: "local", provider: "local", model: null, reason: "no_key" };
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(createCouncil(NVIDIA_ENGINE, {})).toBeNull();
    expect(createCouncil(local, {})).toBeNull();
    expect(createCouncil(NVIDIA_ENGINE, { ...ENV, PRISON_COUNCIL_MODE: " off ", PRISON_COUNCIL_MODELS: "invalid" })).toBeNull();
    expect(describeCouncil(null)).toEqual({ enabled: false, models: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates six separate NVIDIA providers with six real model IDs and one credential", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const council = createCouncil(NVIDIA_ENGINE, ENV)!;
    expect(council.verifySource).toBe(true);
    expect(council.members).toHaveLength(6);
    expect(new Set(council.members.map((member) => member.provider)).size).toBe(6);
    expect(council.members.map((member) => member.provider.info.model)).toEqual(DEFAULT_COUNCIL_MODELS);
    expect(new Set(council.members.map((member) => member.id)).size).toBe(6);
    expect(new Set(council.members.map((member) => member.role)).size).toBe(6);
    for (const member of council.members) {
      expect(member.provider.info.provider).toBe("nvidia");
      const client = (member.provider as unknown as { client: OpenAI }).client;
      expect(client.apiKey).toBe(ENV.NVIDIA_API_KEY);
      expect(client.baseURL).toBe("https://integrate.api.nvidia.com/v1");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("trims explicit model lists without substituting a model or silently adding members", () => {
    const council = createCouncil(NVIDIA_ENGINE, { ...ENV, PRISON_COUNCIL_MODE: " ENABLED ", PRISON_COUNCIL_MODELS: ` ${MODELS.join(" , ")} ` })!;
    expect(council.members.map((member) => member.provider.info.model)).toEqual(MODELS);
    expect(council.members.map((member) => member.id)).toEqual(["member_1", "member_2", "member_3"]);
  });

  it("keeps legacy NVIDIA key/endpoint configuration working for every member", () => {
    const council = createCouncil(NVIDIA_ENGINE, {
      PRISON_COUNCIL_MODE: "enabled", PRISON_COUNCIL_MODELS: MODELS.join(","),
      PRISON_MODEL: "nvidia/primary-model", DEEPSEEK_API_KEY: "legacy-test-key",
      DEEPSEEK_BASE_URL: "https://integrate.api.nvidia.com/v1",
    })!;
    expect(council.members).toHaveLength(3);
    for (const member of council.members) {
      const client = (member.provider as unknown as { client: OpenAI }).client;
      expect(client.apiKey).toBe("legacy-test-key");
      expect(client.baseURL).toBe("https://integrate.api.nvidia.com/v1");
    }
  });

  it("honors NVIDIA endpoint overrides without returning them in public metadata", () => {
    const council = createCouncil(NVIDIA_ENGINE, { ...ENV, NVIDIA_BASE_URL: "https://gateway.example/private/v1" })!;
    expect((council.members[0].provider as unknown as { client: OpenAI }).client.baseURL).toBe("https://gateway.example/private/v1");
    const metadata = describeCouncil(council);
    expect(metadata.enabled).toBe(true);
    expect(metadata.models.map((model) => model.model)).toEqual(DEFAULT_COUNCIL_MODELS);
    expect(Object.keys(metadata.models[0]).sort()).toEqual(["id", "model", "provider", "role"]);
    expect(JSON.stringify(metadata)).not.toContain(ENV.NVIDIA_API_KEY);
    expect(JSON.stringify(metadata)).not.toContain("gateway.example");
  });

  it.each(["on", "true", "competition", "enable"])("fails clearly on unsupported activation value %s", (mode) => {
    expect(() => createCouncil(NVIDIA_ENGINE, { ...ENV, PRISON_COUNCIL_MODE: mode })).toThrow(AIProviderError);
    expect(() => createCouncil(NVIDIA_ENGINE, { ...ENV, PRISON_COUNCIL_MODE: mode })).toThrow(/yapılandırması/);
  });

  it.each([
    "z-ai/glm-5.3,meta/muse-glimmer-30b",
    "a/a,b/b,c/c,d/d,e/e,f/f,g/g",
    "z-ai/glm-5.3,meta/muse-glimmer-30b,z-ai/glm-5.3",
    "Z-AI/GLM-5.3,meta/muse-glimmer-30b,z-ai/glm-5.3",
    "z-ai/glm-5.3,,meta/muse-glimmer-30b",
    "z-ai/glm-5.3,unknown,meta/muse-glimmer-30b",
    "z-ai/glm-5.3,https://example.com/model,meta/muse-glimmer-30b",
    `z-ai/glm-5.3,vendor/${"x".repeat(161)},meta/muse-glimmer-30b`,
  ])("rejects invalid model lists before any network request: %s", (models) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(() => createCouncil(NVIDIA_ENGINE, { ...ENV, PRISON_COUNCIL_MODELS: models })).toThrow(AIProviderError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires NVIDIA configuration and does not turn local/other providers into a pretend council", () => {
    const local: EngineStatus = { mode: "local", provider: "local", model: null, reason: "forced" };
    const other: EngineStatus = { mode: "ai", provider: "deepseek", model: "deepseek-flash" };
    expect(() => createCouncil(local, ENV)).toThrow(AIProviderError);
    expect(() => createCouncil(other, ENV)).toThrow(AIProviderError);
    expect(() => createCouncil(NVIDIA_ENGINE, { PRISON_COUNCIL_MODE: "enabled" })).toThrow(AIProviderError);
  });
});

describe("GET /api/engine council metadata", () => {
  it("returns only safe member information and never performs model calls", async () => {
    const council = createCouncil(NVIDIA_ENGINE, { ...ENV, PRISON_COUNCIL_MODELS: MODELS.join(",") })!;
    const calls = council.members.map((member) => vi.spyOn(member.provider, "generateJson"));
    const checkEngine = vi.fn();
    vi.doMock("@/services/runtime", () => ({ getRuntime: () => ({ engine: NVIDIA_ENGINE, council, checkEngine }) }));
    const { GET } = await import("@/app/api/engine/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ engine: NVIDIA_ENGINE, council: describeCouncil(council) });
    expect(JSON.stringify(body)).not.toContain(ENV.NVIDIA_API_KEY);
    expect(checkEngine).not.toHaveBeenCalled();
    calls.forEach((call) => expect(call).not.toHaveBeenCalled());
    // The first cold import of the route graph can exceed the 5 s default under a parallel full run.
  }, 30000);
});
