import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import type { Prison } from "@/models/prison";
import type { ProviderSettingsInput, PublicProviderSettings } from "@/models/provider-settings";
import { createCouncil, describeCouncil } from "@/services/ai/council-config";
import { configuredProviders, environmentProviderSettings, mergeProviderSettings, resetProviderSettings, saveProviderSettings } from "@/services/ai/provider-settings";
import { PrisonService } from "@/services/prison-service";
import { getRuntime } from "@/services/runtime";
import { FileProviderSettingsRepository } from "@/services/storage/provider-settings-repository";
import type { PrisonRepository } from "@/services/storage/repository";
import { CLEAN_CRITIC, ScriptedProvider } from "./helpers";

const OPENAI_ENV = {
  PRISON_PROVIDER: "openai", OPENAI_API_KEY: "optional-council-private-test-key", PRISON_MODEL: "selected-primary-model",
  PRISON_COUNCIL_MODE: "enabled",
};
const NVIDIA_ENV = {
  PRISON_PROVIDER: "nvidia", NVIDIA_API_KEY: "optional-nvidia-private-test-key", PRISON_MODEL: "nvidia/primary",
  PRISON_COUNCIL_MODE: "enabled", PRISON_COUNCIL_MODELS: "test/one,test/two,test/three", PRISON_COUNCIL_RESERVE_MODELS: "none",
};
const PRIMARY_MISMATCH = "An enabled council requires a configured NVIDIA engine.";
const createdDirectories: string[] = [];

beforeEach(() => {
  // This suite only constructs clients and uses scripted providers; accidental traffic must fail locally.
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network calls are forbidden in this suite"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const directory of createdDirectories.splice(0)) {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unexpected test cleanup target");
    await rm(directory, { recursive: true, force: true });
  }
});

async function directory() {
  const result = await mkdtemp(path.join(os.tmpdir(), "prison-optional-council-"));
  createdDirectories.push(result);
  return result;
}
function inputOf(settings: PublicProviderSettings): ProviderSettingsInput {
  return {
    revision: settings.revision, primary: settings.primary, council: structuredClone(settings.council),
    providers: settings.providers.map(({ id, label, provider, baseURL }) => ({ id, label, provider, baseURL })),
  };
}
function task() {
  return runAnalysisPipeline({ rawRequest: "Write a brief welcome message for new users.", language: "en", targetAI: "gpt" }, null);
}
function primary() {
  return new ScriptedProvider().enqueue("prison_prompt_refinement", {
    prompt: "Write the requested brief welcome message for new users. Use a friendly tone and concrete wording, preserve the owner's output requirements, and check the final wording for clarity and relevance.",
    strategies_used: ["Task-Specific-Workflow"],
  }).enqueue("prison_critic", CLEAN_CRITIC);
}
function serviceFor(stored: Prison, selected = primary()) {
  let current = structuredClone(stored);
  const save = vi.fn(async (next: Prison) => { current = structuredClone(next); });
  const repo: PrisonRepository = { get: async () => structuredClone(current), save, list: async () => [], delete: async () => false };
  return {
    service: new PrisonService(repo, selected, undefined, null, undefined, undefined, PRIMARY_MISMATCH),
    selected, save, stored: () => structuredClone(current),
  };
}

describe("optional environment council configuration", () => {
  it("keeps the explicitly selected primary when an optional team requires another provider", () => {
    const configured = configuredProviders(null, OPENAI_ENV);
    expect(configured.engine).toEqual({ mode: "ai", provider: "openai", model: "selected-primary-model" });
    expect(configured.provider?.info).toMatchObject(configured.engine);
    expect(configured.council).toBeNull();
    expect(configured.councilConfigurationError).toBe(PRIMARY_MISMATCH);
    expect(describeCouncil(configured.council, configured.councilConfigurationError)).toEqual({ enabled: false, models: [], configurationError: PRIMARY_MISMATCH });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ PRISON_COUNCIL_MODE: "unsupported" }, "PRISON_COUNCIL_MODE"],
    [{ PRISON_COUNCIL_MODELS: "test/one" }, "PRISON_COUNCIL_MODELS"],
    [{ PRISON_COUNCIL_DEPTH: "unsupported" }, "PRISON_COUNCIL_DEPTH"],
    [{ PRISON_COUNCIL_RESERVE_MODELS: "test/one" }, "Council reserves"],
  ] as const)("isolates a malformed optional team setting while preserving a valid NVIDIA primary: %j", (changes, diagnostic) => {
    const env = { ...NVIDIA_ENV, ...changes };
    const configured = configuredProviders(null, env);
    expect(configured.provider?.info).toMatchObject({ mode: "ai", provider: "nvidia", model: "nvidia/primary" });
    expect(configured.council).toBeNull();
    expect(configured.councilConfigurationError).toContain(diagnostic);
    const settings = environmentProviderSettings(env);
    expect(settings.councilConfigurationError).toBe(configured.councilConfigurationError);
    expect(JSON.stringify(settings)).not.toContain(NVIDIA_ENV.NVIDIA_API_KEY);
    // Explicit council construction remains strict for callers that actually require a team.
    expect(() => createCouncil(configured.engine, env)).toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not conceal invalid primary configuration or missing primary credentials", () => {
    expect(() => configuredProviders(null, { ...OPENAI_ENV, PRISON_PROVIDER: "unsupported" })).toThrow();
    expect(() => configuredProviders(null, { ...OPENAI_ENV, OPENAI_API_KEY: undefined })).toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("allows saving a real replacement team and restoring broken environment defaults without locking settings", async () => {
    const repository = new FileProviderSettingsRepository(await directory());
    const initial = environmentProviderSettings(OPENAI_ENV);
    expect(initial.councilConfigurationError).toBe(PRIMARY_MISMATCH);
    const input = inputOf(initial);
    input.council = { enabled: true, depth: "quick", members: ["model-one", "model-two", "model-three"].map(model => ({ providerId: "env_openai", model })) };
    const saved = await saveProviderSettings(repository, input, OPENAI_ENV);
    const configured = configuredProviders(repository.loadSync(), OPENAI_ENV);
    expect(saved).not.toHaveProperty("councilConfigurationError");
    expect(configured.councilConfigurationError).toBeNull();
    expect(configured.council?.members.map(member => member.provider.info.model)).toEqual(["model-one", "model-two", "model-three"]);
    expect(configured.provider?.info.model).toBe(OPENAI_ENV.PRISON_MODEL);
    expect(JSON.stringify(saved)).not.toContain(OPENAI_ENV.OPENAI_API_KEY);
    const reset = await resetProviderSettings(repository, saved.revision, OPENAI_ENV);
    expect(reset.source).toBe("environment");
    expect(reset.councilConfigurationError).toBe(PRIMARY_MISMATCH);
    expect(repository.loadSync()).toBeNull();
    expect(() => mergeProviderSettings(inputOf(reset), null, OPENAI_ENV)).not.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("boots the runtime and returns usable engine/settings endpoints with a redacted team diagnostic", async () => {
    const dataDir = await directory();
    vi.stubEnv("PRISON_DATA_DIR", dataDir);
    for (const [name, value] of Object.entries(OPENAI_ENV)) vi.stubEnv(name, value);
    const runtime = getRuntime();
    expect(runtime.engine).toEqual({ mode: "ai", provider: "openai", model: "selected-primary-model" });
    expect(runtime.councilConfigurationError).toBe(PRIMARY_MISMATCH);
    await expect(runtime.service.analyze({ rawRequest: "Write a brief welcome message.", language: "en", targetAI: "gpt", councilMode: "collaboration" })).rejects.toMatchObject({ code: "invalid_input", detail: PRIMARY_MISMATCH });
    expect(await runtime.service.list()).toEqual([]);
    const { GET: getEngine } = await import("@/app/api/engine/route");
    const { GET: getSettings } = await import("@/app/api/settings/providers/route");
    const engineResponse = await getEngine();
    const settingsResponse = await getSettings();
    expect(engineResponse.status).toBe(200);
    expect(settingsResponse.status).toBe(200);
    const engineBody = await engineResponse.json();
    const settingsBody = await settingsResponse.json();
    expect(engineBody.council.configurationError).toBe(PRIMARY_MISMATCH);
    expect(settingsBody.settings.primary).toEqual({ providerId: "env_openai", model: OPENAI_ENV.PRISON_MODEL });
    expect(settingsBody.settings.councilConfigurationError).toBe(PRIMARY_MISMATCH);
    expect(JSON.stringify([engineBody, settingsBody])).not.toContain(OPENAI_ENV.OPENAI_API_KEY);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }, 30000);
});

describe("task mode enforcement with an invalid optional council", () => {
  it("still generates, reviews and saves with the selected single provider", async () => {
    const base = await task();
    const { service, selected, save } = serviceFor(base);
    const result = await service.compile(base.id);
    expect(selected.calls.map(call => call.schemaName)).toEqual(["prison_prompt_refinement", "prison_critic"]);
    expect(result.status).toBe("READY");
    expect(result.promptVersions.at(-1)?.generation?.model).toBe(selected.info.model);
    expect(result.promptVersions.at(-1)?.councilReview).toBeNull();
    expect(save).toHaveBeenCalledOnce();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(["competition", "collaboration"] as const)("rejects explicit %s before any provider call or persistence instead of silently falling back", async councilMode => {
    const base = await task();
    const { service, selected, save, stored } = serviceFor(base);
    await expect(service.analyze({ rawRequest: base.rawRequest, language: "en", targetAI: "gpt", councilMode })).rejects.toMatchObject({ code: "invalid_input", detail: PRIMARY_MISMATCH, message: expect.stringContaining(PRIMARY_MISMATCH) });
    await expect(service.compile(base.id, { councilMode })).rejects.toMatchObject({ code: "invalid_input", detail: PRIMARY_MISMATCH });
    expect(selected.calls).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
    expect(stored()).toEqual(base);
    expect(await service.getProgress(base.id)).toBeNull();
  });

  it("rejects revisions and team switches without changing an existing prompt, and permits switching back to single", async () => {
    const ready = await runCompilePipeline(await task(), { trigger: "initial", note: "", llmReview: false }, { provider: null });
    const storedTeam = { ...ready, compileOptions: { ...ready.compileOptions, councilMode: "collaboration" as const } };
    const { service, selected, save, stored } = serviceFor(storedTeam);
    await expect(service.revise(storedTeam.id, "Keep it concise.")).rejects.toMatchObject({ code: "invalid_input", detail: PRIMARY_MISMATCH });
    await expect(service.adjust(storedTeam.id, { kind: "council_mode", councilMode: "competition" })).rejects.toMatchObject({ code: "invalid_input", detail: PRIMARY_MISMATCH });
    expect(selected.calls).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
    expect(stored()).toEqual(storedTeam);
    const recovered = await service.compile(storedTeam.id, { councilMode: "single" });
    expect(recovered.compileOptions.councilMode).toBe("single");
    expect(recovered.promptVersions).toHaveLength(ready.promptVersions.length + 1);
    expect(selected.calls.map(call => call.schemaName)).toEqual(["prison_prompt_refinement", "prison_critic"]);
    expect(save).toHaveBeenCalledOnce();
  });
});
