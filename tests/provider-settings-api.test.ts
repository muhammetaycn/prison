import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT, DELETE } from "@/app/api/settings/providers/route";
import type { ProviderSettingsInput, PublicProviderSettings } from "@/models/provider-settings";
import { FileProviderSettingsRepository } from "@/services/storage/provider-settings-repository";

let directory: string;
const request = (method: string, input: unknown, origin = "http://localhost:3100") => new Request("http://localhost:3100/api/settings/providers", { method, headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(input) });
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "prison-provider-settings-api-"));
  vi.stubEnv("PRISON_DATA_DIR", directory); vi.stubEnv("PRISON_PROVIDER", "nvidia"); vi.stubEnv("NVIDIA_API_KEY", "never-return-this-secret");
  vi.stubEnv("PRISON_MODEL", "nvidia/model"); vi.stubEnv("PRISON_COUNCIL_MODE", "off");
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("provider settings API", () => {
  it("returns redacted no-store configuration, accepts an edit and restores defaults", async () => {
    const response = await GET(); const initial = (await response.json()).settings as PublicProviderSettings;
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(initial)).not.toContain("never-return-this-secret");
    const input: ProviderSettingsInput = { revision: initial.revision, primary: initial.primary, council: initial.council,
      providers: initial.providers.map(({ keyPresent: _present, keySource: _source, ...profile }) => profile) };
    input.providers[0].label = "My service";
    const savedResponse = await PUT(request("PUT", input));
    expect(savedResponse.status).toBe(200);
    const saved = (await savedResponse.json()).settings as PublicProviderSettings;
    expect(saved.providers[0].label).toBe("My service"); expect(saved.source).toBe("saved");
    expect((await GET()).status).toBe(200);
    const reset = await DELETE(request("DELETE", { revision: saved.revision }));
    expect(reset.status).toBe(200); expect((await reset.json()).settings.source).toBe("environment");
    expect(new FileProviderSettingsRepository(directory).loadSync()).toBeNull();
  });

  it.each(["PUT", "DELETE"])("blocks cross-origin %s before touching configuration", async (method) => {
    const handler = method === "PUT" ? PUT : DELETE;
    const response = await handler(request(method, { revision: "environment" }, "https://unrelated.com"));
    expect(response.status).toBe(400); expect((await response.json()).error.message).toContain("yalnızca bu uygulama");
    expect(new FileProviderSettingsRepository(directory).loadSync()).toBeNull();
  });

  it("never returns or logs invalid schema values that contain secret material", async () => {
    const warn = vi.spyOn(console, "warn"); const error = vi.spyOn(console, "error");
    const response = await PUT(request("PUT", { revision: "environment", providers: [{ provider: "malformed-api-key-value" }], primary: null, council: { enabled: false, depth: "quick", members: [] } }));
    expect(response.status).toBe(400); expect(await response.text()).not.toContain("malformed-api-key-value");
    expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and oversized configuration without exposing input", async () => {
    const invalid = await PUT(new Request("http://localhost:3100/api/settings/providers", { method: "PUT", body: "secret-not-json" }));
    expect(invalid.status).toBe(400); expect(await invalid.text()).not.toContain("secret-not-json");
    const oversized = await PUT(new Request("http://localhost:3100/api/settings/providers", { method: "PUT", body: "s".repeat(100001) }));
    expect(oversized.status).toBe(400);
  });
});
