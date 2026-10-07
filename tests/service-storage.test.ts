import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrisonService } from "@/services/prison-service";
import { FilePrisonRepository } from "@/services/storage/file-repository";
import { AppError } from "@/services/errors";
import { AIProviderError } from "@/services/ai/errors";
import { resolveEngineStatus } from "@/services/ai/config";
import { ScriptedProvider } from "./helpers";

let dir: string;
let repo: FilePrisonRepository;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "prison-test-"));
  repo = new FilePrisonRepository(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("file repository", () => {
  it("stores each prison in its own file and lists summaries", async () => {
    const service = new PrisonService(repo, null);
    const a = await service.analyze({ rawRequest: "Bir blog yazısı yaz", language: "tr", targetAI: "auto" });
    const b = await service.analyze({ rawRequest: "Instagram için içerik planı hazırla", language: "tr", targetAI: "gpt" });
    const list = await service.list();
    expect(list.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect((await repo.get(a.id))?.rawRequest).toBe("Bir blog yazısı yaz");
  });

  it("rejects ids that could escape the data directory", async () => {
    await expect(repo.get("../../etc/passwd")).rejects.toMatchObject({ code: "invalid_id" });
  });

  it("skips corrupt files when listing instead of failing", async () => {
    await writeFile(path.join(dir, "pr_broken01.json"), "{not json", "utf8");
    const service = new PrisonService(repo, null);
    await service.analyze({ rawRequest: "Bir blog yazısı yaz", language: "tr", targetAI: "auto" });
    expect(await service.list()).toHaveLength(1);
  });
});

describe("prison service (end to end, local engine)", () => {
  it("analyze → compile → modify → retarget → revise → restore", async () => {
    const service = new PrisonService(repo, null);
    const created = await service.analyze({
      rawRequest: "Codex'e mevcut projemi bozmadan ödeme sistemini ekletecek prompt üret.",
      language: "en",
      targetAI: "auto",
    });
    expect(created.status).toBe("READY_FOR_COMPILE");

    const compiled = await service.compile(created.id);
    expect(compiled.promptVersions[0]?.resolvedTarget).toBe("codex");

    const shorter = await service.adjust(created.id, { kind: "modifier", action: "shorter" });
    expect(shorter.compileOptions.verbosity).toBe("standard");
    expect(shorter.promptVersions[1]!.text.length).toBeLessThan(compiled.promptVersions[0]!.text.length);

    const claude = await service.adjust(created.id, { kind: "target", target: "claude" });
    expect(claude.promptVersions[2]?.resolvedTarget).toBe("claude");
    expect(claude.promptVersions[2]?.trigger).toBe("target_change");

    const revised = await service.revise(created.id, "Canlı deploy yapmasına izin verme.");
    expect(revised.taskMemory.some((m) => m.active && m.kind === "prohibition")).toBe(true);
    expect(revised.compileOptions.verbosity).toBe("standard");
    expect(revised.targetAI).toBe("claude");

    const restored = await service.restore(created.id, 1);
    const last = restored.promptVersions.at(-1)!;
    expect(last.trigger).toBe("restore");
    expect(last.text).toBe(compiled.promptVersions[0]!.text);
    expect(restored.compileOptions.verbosity).toBe("detailed");
    expect(restored.activeVersion).toBe(last.version);

    const reloaded = await service.get(created.id);
    expect(reloaded.promptVersions).toHaveLength(restored.promptVersions.length);
  });

  it("keeps prisons isolated: revising one never changes another", async () => {
    const service = new PrisonService(repo, null);
    const a = await service.compile(
      (await service.analyze({ rawRequest: "Codex'e mevcut projemi bozmadan ödeme sistemini ekletecek prompt üret.", language: "en", targetAI: "auto" })).id,
    );
    const b = await service.compile(
      (await service.analyze({ rawRequest: "Instagram için içerik planı hazırla", language: "tr", targetAI: "auto" })).id,
    );
    await service.revise(a.id, "Mevcut mimariyi değiştirmesin.");
    const bAfter = await service.get(b.id);
    expect(bAfter.taskMemory).toHaveLength(0);
    expect(bAfter.promptVersions).toHaveLength(1);
    expect(bAfter.updatedAt).toBe(b.updatedAt);
  });

  it("validates input and missing prisons with readable errors", async () => {
    const service = new PrisonService(repo, null);
    await expect(service.analyze({ rawRequest: "  a ", language: "en", targetAI: "auto" })).rejects.toBeInstanceOf(AppError);
    await expect(service.get("pr_missing0")).rejects.toMatchObject({ code: "not_found" });
    const created = await service.analyze({ rawRequest: "Bir blog yazısı yaz", language: "tr", targetAI: "auto" });
    await expect(service.adjust(created.id, { kind: "modifier", action: "shorter" })).rejects.toMatchObject({ code: "not_ready" });
  });

  it("does not save anything when an AI call fails", async () => {
    const provider = new ScriptedProvider().enqueue("prison_intent", new AIProviderError("rate_limit", "429"));
    const service = new PrisonService(repo, provider);
    await expect(service.analyze({ rawRequest: "Bir blog yazısı yaz", language: "tr", targetAI: "auto" })).rejects.toMatchObject({
      code: "ai_error",
      message: expect.stringMatching(/hız sınırı/),
    });
    expect(await service.list()).toHaveLength(0);
  });
});

describe("engine configuration", () => {
  it("picks the provider from the environment and falls back to local", () => {
    expect(resolveEngineStatus({})).toMatchObject({ mode: "local", reason: "no_key" });
    expect(resolveEngineStatus({ ANTHROPIC_API_KEY: "x" })).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(resolveEngineStatus({ OPENAI_API_KEY: "x" })).toMatchObject({ provider: "openai" });
    expect(resolveEngineStatus({ ANTHROPIC_API_KEY: "x", PRISON_PROVIDER: "local" })).toMatchObject({ mode: "local", reason: "forced" });
    expect(resolveEngineStatus({ OPENAI_API_KEY: "x", PRISON_MODEL: "gpt-5.4" })).toMatchObject({ model: "gpt-5.4" });
  });
});
