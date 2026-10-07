import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSettingsInput, PublicProviderSettings } from "@/models/provider-settings";
import { FileProviderSettingsRepository } from "@/services/storage/provider-settings-repository";
import { configuredProviders, environmentProviderSettings, mergeProviderSettings, normalizeProviderURL, providerTopologyKey, publicProviderSettings, resetProviderSettings, saveProviderSettings } from "@/services/ai/provider-settings";
import { createCredentialedProvider, createProvider } from "@/services/ai/config";
import { z } from "zod";
import { getRuntime, getRuntimeOperationState } from "@/services/runtime";

const ENV = { NVIDIA_API_KEY: "environment-private-test-key", PRISON_PROVIDER: "nvidia", PRISON_MODEL: "nvidia/primary", PRISON_COUNCIL_MODE: "enabled", PRISON_COUNCIL_MODELS: "nvidia/one,nvidia/two,nvidia/three", PRISON_COUNCIL_RESERVE_MODELS: "none", PRISON_COUNCIL_DEPTH: "quick" };
const inputOf = (settings: PublicProviderSettings): ProviderSettingsInput => ({
  revision: settings.revision, primary: settings.primary, council: structuredClone(settings.council),
  providers: settings.providers.map(({ keyPresent: _present, keySource: _source, ...profile }) => profile),
});
let directory: string;
let repository: FileProviderSettingsRepository;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "prison-provider-settings-")); repository = new FileProviderSettingsRepository(directory); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("editable provider settings", () => {
  it("keeps untouched environment defaults and redacts every secret", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(repository.loadSync()).toBeNull();
    const defaults = environmentProviderSettings(ENV);
    expect(defaults).toMatchObject({ source: "environment", revision: "environment", primary: { providerId: "env_nvidia", model: "nvidia/primary" }, council: { enabled: true, depth: "quick" } });
    expect(defaults.council.members.map(member => member.model)).toEqual(["nvidia/one", "nvidia/two", "nvidia/three"]);
    expect(defaults.providers.find(profile => profile.id === "env_nvidia")).toMatchObject({ keyPresent: true, keySource: "environment" });
    expect(JSON.stringify(defaults)).not.toContain(ENV.NVIDIA_API_KEY);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("saves, reloads and replaces profiles without changing environment files", async () => {
    const input = inputOf(environmentProviderSettings(ENV));
    input.providers = input.providers.filter(profile => profile.id === "env_nvidia");
    input.providers[0].apiKey = "saved-private-test-key";
    const saved = await saveProviderSettings(repository, input, ENV);
    expect(saved.source).toBe("saved");
    expect(saved.providers).toHaveLength(1);
    expect(saved.providers[0]).toMatchObject({ keyPresent: true, keySource: "saved" });
    expect(JSON.stringify(saved)).not.toContain("saved-private-test-key");
    expect(repository.loadSync()?.providers[0].key).toBe("saved-private-test-key");
    const disk = JSON.parse(await readFile(repository.file, "utf8"));
    expect(disk.providers[0].key).toBe("saved-private-test-key");
    expect(publicProviderSettings(new FileProviderSettingsRepository(directory).loadSync(), ENV)).toEqual(saved);
    expect(ENV.NVIDIA_API_KEY).toBe("environment-private-test-key");
  });

  it("omitted keys survive round trips and explicit null disables environment fallback", async () => {
    let input = inputOf(environmentProviderSettings(ENV));
    input.providers[0].apiKey = "saved-secret";
    let saved = await saveProviderSettings(repository, input, ENV);
    input = inputOf(saved); input.providers[0].label = "My chosen API";
    saved = await saveProviderSettings(repository, input, ENV);
    expect(repository.loadSync()?.providers[0].key).toBe("saved-secret");
    input = inputOf(saved); input.providers[0].apiKey = null;
    input.primary = null; input.council.enabled = false;
    saved = await saveProviderSettings(repository, input, ENV);
    expect(saved.providers[0]).toMatchObject({ keyPresent: false, keySource: "none" });
    expect(repository.loadSync()?.providers[0]).toMatchObject({ key: null, useEnvironmentKey: false });
    expect(configuredProviders(repository.loadSync(), ENV).engine).toMatchObject({ mode: "local", reason: "forced" });
  });

  it("can preserve an environment key without copying it into the saved file", async () => {
    await saveProviderSettings(repository, inputOf(environmentProviderSettings(ENV)), ENV);
    expect(repository.loadSync()?.providers[0]).toMatchObject({ key: null, useEnvironmentKey: true });
    expect(await readFile(repository.file, "utf8")).not.toContain(ENV.NVIDIA_API_KEY);
    expect(configuredProviders(repository.loadSync(), ENV).provider?.info.model).toBe("nvidia/primary");
  });

  it("rejects stale concurrent updates atomically rather than losing a key change", async () => {
    const first = inputOf(environmentProviderSettings(ENV)); const second = structuredClone(first);
    first.providers[0].apiKey = "first-secret"; second.providers[0].apiKey = "second-secret";
    const updates = await Promise.allSettled([saveProviderSettings(repository, first, ENV), saveProviderSettings(repository, second, ENV)]);
    expect(updates.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(updates[1]).toMatchObject({ reason: { code: "busy", status: 409 } });
    expect(repository.loadSync()?.providers[0].key).toBe("first-secret");
  });

  it("reset removes saved credentials and restores the environment team", async () => {
    const input = inputOf(environmentProviderSettings(ENV)); input.providers[0].apiKey = "saved-secret";
    const saved = await saveProviderSettings(repository, input, ENV);
    await expect(resetProviderSettings(repository, "environment", ENV)).rejects.toMatchObject({ code: "busy" });
    expect(await resetProviderSettings(repository, saved.revision, ENV)).toEqual(environmentProviderSettings(ENV));
    expect(repository.loadSync()).toBeNull();
    await expect(readFile(repository.file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to silently use defaults when a stored secret record is corrupt", async () => {
    await writeFile(repository.file, '{"key":"should-never-appear"}', "utf8");
    try { repository.loadSync(); expect.fail("Corrupt configuration must fail"); }
    catch (error) { expect(error).toMatchObject({ code: "storage_error" }); expect(String(error)).not.toContain("should-never-appear"); }
    expect(await readFile(repository.file, "utf8")).toContain("should-never-appear");
  });

  it("allows heterogeneous real models and keeps old client credentials after replacement", async () => {
    const input = inputOf(environmentProviderSettings(ENV));
    input.providers.push({ id: "my_gateway", label: "Custom service", provider: "compatible", baseURL: "https://api.my-service.com/v1", apiKey: "gateway-secret" },
      { id: "my_claude", label: "Claude", provider: "anthropic", baseURL: "https://api.anthropic.com", apiKey: "claude-secret" });
    input.council.members = [{ providerId: "env_nvidia", model: "nvidia/one" }, { providerId: "my_gateway", model: "qwen/my-model" }, { providerId: "my_claude", model: "claude-test" }];
    let saved = await saveProviderSettings(repository, input, ENV);
    const old = configuredProviders(repository.loadSync(), ENV);
    expect(old.council?.members.map(member => member.provider.info.provider)).toEqual(["nvidia", "compatible", "anthropic"]);
    expect(old.council?.members.map(member => member.id)).toEqual(["member_1", "member_2", "member_3"]);
    expect(old.council?.reserves).toEqual([]);
    const nextInput = inputOf(saved); nextInput.providers.find(profile => profile.id === "my_gateway")!.apiKey = "changed-secret";
    saved = await saveProviderSettings(repository, nextInput, ENV);
    const current = configuredProviders(repository.loadSync(), ENV);
    const clientOf = (value: unknown) => (value as { client: OpenAI }).client;
    expect(clientOf(old.council!.members[1].provider).apiKey).toBe("gateway-secret");
    expect(clientOf(current.council!.members[1].provider).apiKey).toBe("changed-secret");
    expect(JSON.stringify(saved)).not.toContain("changed-secret");
  });

  it("changing an endpoint cannot reuse or leak either a saved or environment credential", () => {
    const input = inputOf(environmentProviderSettings(ENV));
    input.providers[0].baseURL = "https://api.other-service.com/v1";
    expect(() => mergeProviderSettings(input, null, ENV)).toThrow(/yeni anahtarı/);
    input.providers[0].apiKey = "explicit-new-key";
    expect(mergeProviderSettings(input, null, ENV).providers[0]).toMatchObject({ key: "explicit-new-key", useEnvironmentKey: false });
  });

  it("isolates saved review recovery by actual endpoint/model without losing work on key rotation", () => {
    const first = mergeProviderSettings(inputOf(environmentProviderSettings(ENV)), null, ENV);
    const sameTopology = structuredClone(first); sameTopology.providers[0].key = "rotated-key"; sameTopology.providers[0].label = "New name";
    expect(providerTopologyKey(sameTopology)).toBe(providerTopologyKey(first));
    const moved = structuredClone(first); moved.providers[0].baseURL = "https://api.different-service.com/v1";
    expect(providerTopologyKey(moved)).not.toBe(providerTopologyKey(first));
    moved.providers[0].baseURL = first.providers[0].baseURL; moved.council.members[0].model = "nvidia/changed-model";
    expect(providerTopologyKey(moved)).not.toBe(providerTopologyKey(first));
  });

  it("refreshes runtime providers on a settings revision while retaining original client instances", async () => {
    vi.stubEnv("PRISON_DATA_DIR", directory); vi.stubEnv("PRISON_PROVIDER", "nvidia"); vi.stubEnv("PRISON_MODEL", "nvidia/model");
    vi.stubEnv("NVIDIA_API_KEY", "original-runtime-key"); vi.stubEnv("PRISON_COUNCIL_MODE", "off");
    const fetch = vi.spyOn(globalThis, "fetch");
    const initial = getRuntime(); const sharedState = getRuntimeOperationState(directory);
    const oldProvider = (initial.service as unknown as { provider: { client: OpenAI } }).provider;
    const input = inputOf(environmentProviderSettings(process.env)); input.providers[0].apiKey = "new-runtime-key";
    const saved = await saveProviderSettings(repository, input, process.env);
    const next = getRuntime();
    expect(next).not.toBe(initial); expect(next.engine).toEqual(initial.engine);
    expect((next.service as unknown as { provider: { client: OpenAI } }).provider.client.apiKey).toBe("new-runtime-key");
    expect(oldProvider.client.apiKey).toBe("original-runtime-key");
    expect(getRuntimeOperationState(directory)).toBe(sharedState);
    expect(getRuntime()).toBe(next);
    await resetProviderSettings(repository, saved.revision, process.env);
    const reset = getRuntime(); expect(reset).not.toBe(next);
    expect((reset.service as unknown as { provider: { client: OpenAI } }).provider.client.apiKey).toBe("original-runtime-key");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["http://api.openai.com/v1"], ["https://localhost/v1"], ["https://127.0.0.1/v1"], ["https://2130706433/v1"], ["https://[::1]/v1"],
    ["https://api.internal/v1"], ["https://user:password@api.openai.com/v1"], ["https://api.openai.com/v1?api_key=secret"],
    ["https://api.openai.com/v1#secret"], ["https://api.openai.com:8443/v1"], ["https://api.openai.com/%0a"]
  ])("rejects unsafe endpoint %s", (url) => { expect(() => normalizeProviderURL(url)).toThrow(/API adresi/); });

  it("normalizes public HTTPS endpoints with trailing slashes", () => { expect(normalizeProviderURL("https://API.OPENAI.COM:443/v1/")).toBe("https://api.openai.com/v1"); });

  it.each(["duplicate_id", "unknown_member", "duplicate_model", "missing_key", "too_few", "wrong_nvidia_id"])("rejects invalid team %s before writing", async (scenario) => {
    const input = inputOf(environmentProviderSettings(ENV));
    if (scenario === "duplicate_id") input.providers.push(structuredClone(input.providers[0]));
    if (scenario === "unknown_member") input.council.members[0].providerId = "missing";
    if (scenario === "duplicate_model") input.council.members[1] = structuredClone(input.council.members[0]);
    if (scenario === "missing_key") input.providers[0].apiKey = null;
    if (scenario === "too_few") input.council.members.pop();
    if (scenario === "wrong_nvidia_id") input.council.members[0].model = "missing-publisher";
    await expect(saveProviderSettings(repository, input, ENV)).rejects.toMatchObject({ code: "invalid_input", status: 400 });
    expect(repository.loadSync()).toBeNull();
  });

  it("captures explicit OpenAI and Anthropic credentials rather than reading global environment at call time", () => {
    vi.stubEnv("OPENAI_API_KEY", "different-global-openai"); vi.stubEnv("ANTHROPIC_API_KEY", "different-global-claude");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "different-global-auth"); vi.stubEnv("OPENAI_ORG_ID", "other-organization"); vi.stubEnv("OPENAI_PROJECT_ID", "other-project");
    const openai = createProvider({ mode: "ai", provider: "openai", model: "test-model" }, { OPENAI_API_KEY: "chosen-openai-key" });
    const claude = createProvider({ mode: "ai", provider: "anthropic", model: "test-model" }, { ANTHROPIC_API_KEY: "chosen-claude-key" });
    expect((openai as unknown as { client: { apiKey: string } }).client.apiKey).toBe("chosen-openai-key");
    expect((claude as unknown as { client: { apiKey: string } }).client.apiKey).toBe("chosen-claude-key");
    expect((claude as unknown as { client: { authToken: string | null } }).client.authToken).toBeNull();
    const tokenProvider = createProvider({ mode: "ai", provider: "anthropic", model: "test-model" }, { ANTHROPIC_AUTH_TOKEN: "chosen-token" });
    expect((tokenProvider as unknown as { client: { apiKey: string | null; authToken: string } }).client).toMatchObject({ apiKey: null, authToken: "chosen-token" });
    expect((openai as unknown as { client: { organization: string | null; project: string | null } }).client).toMatchObject({ organization: null, project: null });
  });

  it("actually sends custom gateway requests through chat completions with validated JSON schema", async () => {
    const provider = createCredentialedProvider("compatible", "qwen/model", "gateway-secret", "https://api.my-service.com/v1");
    const client = (provider as unknown as { client: OpenAI }).client;
    const create = vi.spyOn(client.chat.completions, "create").mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] } as OpenAI.Chat.Completions.ChatCompletion);
    await expect(provider.generateJson({ system: "Return valid JSON", messages: [{ role: "user", content: "Check" }], schema: z.object({ ok: z.boolean() }), schemaName: "gateway_check", effort: "low", maxTokens: 512 })).resolves.toBe('{"ok":true}');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ model: "qwen/model", response_format: { type: "json_object" } });
    expect(client.apiKey).toBe("gateway-secret"); expect(client.baseURL).toBe("https://api.my-service.com/v1");
    expect(create.mock.calls[0][0].messages[0].content).toContain('"ok"');
  });

  it.each(["openai", "anthropic"] as const)("honors bounded call budgets for the native %s adapter", async (type) => {
    const provider = createCredentialedProvider(type, "native-model", "native-secret", type === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com");
    const client = (provider as unknown as { client: OpenAI & { beta: { messages: { create: (...args: unknown[]) => unknown } } } }).client;
    const create = type === "openai" ? vi.spyOn(client.responses, "create").mockResolvedValue({ status: "completed", output_text: '{"ok":true}' } as OpenAI.Responses.Response)
      : vi.spyOn(client.beta.messages, "create").mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":true}' }] });
    await expect(provider.generateJson({ system: "Return JSON", messages: [{ role: "user", content: "Check" }], schema: z.object({ ok: z.boolean() }), schemaName: "native_probe", effort: "low", maxTokens: 512, timeoutMs: 20000 })).resolves.toBe('{"ok":true}');
    expect(create.mock.calls[0][1]).toEqual({ timeout: 20000, maxRetries: 0 });
    if (type === "anthropic") {
      expect(create.mock.calls[0][0]).toMatchObject({ model: "native-model", output_config: { format: { type: "json_schema" } } });
      expect(create.mock.calls[0][0]).not.toHaveProperty("fallbacks");
      expect(create.mock.calls[0][0]).not.toHaveProperty("betas");
    }
  });

  it("keeps an explicitly selected Claude model and reports refusal without retrying another model", async () => {
    const provider = createCredentialedProvider("anthropic", "chosen-claude-model", "native-secret", "https://api.anthropic.com");
    const client = (provider as unknown as { client: { beta: { messages: { create: (...args: unknown[]) => unknown } } } }).client;
    const create = vi.spyOn(client.beta.messages, "create").mockResolvedValue({ stop_reason: "refusal", content: [] });
    await expect(provider.generateJson({ system: "Return JSON", messages: [{ role: "user", content: "Check" }], schema: z.object({ ok: z.boolean() }), schemaName: "native_probe", effort: "low", maxTokens: 512, timeoutMs: 20000 })).rejects.toMatchObject({ kind: "refusal" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ model: "chosen-claude-model", output_config: { format: { type: "json_schema" } } });
    expect(create.mock.calls[0][0]).not.toHaveProperty("fallbacks");
    expect(create.mock.calls[0][0]).not.toHaveProperty("betas");
    expect(provider.info.model).toBe("chosen-claude-model");
  });

  it.each(["compatible", "openai", "anthropic"] as const)("sanitizes raw SDK errors from %s before they reach operation logs or results", async (type) => {
    const provider = createCredentialedProvider(type, "native-model", "native-secret", "https://api.my-service.com/v1");
    const client = (provider as unknown as { client: OpenAI & { beta: { messages: { create: (...args: unknown[]) => unknown } } } }).client;
    const sdkError = new Error("Unexpected private value native-secret");
    if (type === "compatible") vi.spyOn(client.chat.completions, "create").mockRejectedValue(sdkError);
    else if (type === "openai") vi.spyOn(client.responses, "create").mockRejectedValue(sdkError);
    else vi.spyOn(client.beta.messages, "create").mockRejectedValue(sdkError);
    try {
      await provider.generateJson({ system: "Return JSON", messages: [{ role: "user", content: "Check" }], schema: z.object({ ok: z.boolean() }), schemaName: "native_probe", effort: "low", maxTokens: 512, timeoutMs: 20000 });
      expect.fail("Error must not be accepted");
    } catch (error) {
      expect(error).toMatchObject({ kind: "unknown" });
      expect(String(error)).not.toContain("native-secret");
      expect((error as { detail: string }).detail).not.toContain("native-secret");
    }
  });
});
