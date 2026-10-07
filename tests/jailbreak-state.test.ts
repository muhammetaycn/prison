import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { runRevisionPipeline } from "@/core/pipeline/revise";
import { interpretRevisionLocally } from "@/core/revision-engine/local";
import { interpretRevision } from "@/core/revision-engine";
import { readJailbreakModeRequest } from "@/core/prison-engine/jailbreak-mode";
import { PrisonService } from "@/services/prison-service";
import { FilePrisonRepository } from "@/services/storage/file-repository";
import { AIProviderError } from "@/services/ai/errors";
import { CLEAN_CRITIC, paymentIntent, ScriptedProvider } from "./helpers";

const runtime = vi.hoisted(() => ({ service: null as PrisonService | null }));
vi.mock("@/services/runtime", () => ({ getRuntime: () => runtime }));
import { POST } from "@/app/api/prisons/route";

describe("JB mode selection", () => {
  it.each([
    ["JB modunu aç ve bir blog yazısı hazırla", true],
    ["Jailbreak mode: write a blog post", true],
    ["Sansürsüz modda bir blog yazısı hazırla", true],
    ["Use JB mode but do not deploy", true],
    ["JB modu açık kalsın, canlı deploy yapma", true],
    ["Use JB mode with no deployment changes", true],
    ["Ürünlere kategori filtresi ekle", false],
    ["Dosya boyutu kısıtlamasını düzenle", false],
    ["Explain how to bypass the product cache", false],
    ["JB modunu açma, bir blog yazısı hazırla", false],
    ["Jailbreak modu kullanılmasın", false],
    ["Do not enable jailbreak mode", false],
    ["Write a blog post without jailbreak mode", false],
    ["Don't use JB", false],
    ["JB modunu devre dışı bırak", false],
    ["JB mode should not be enabled", false],
    ["JB modunu kullanmak istemiyorum", false],
    ["JB modunu açmak istemiyorum", false],
    ["JB modunu kapat. Vazgeçtim, JB modunu aç.", true],
    ["JB modunu aç; ardından JB modunu kapat.", false],
    ["Disable JB mode, then enable JB mode.", true],
    ["Enable JB mode. Turn off JB mode.", false],
    ["Turn on JB mode and do not publish anything", true],
    ["JB modunu açar mısın?", true],
    ["JB modunu kapatır mısın?", false],
    ["Could you enable JB mode?", true],
    ["Could you disable JB mode?", false],
    ["I want JB mode", true],
    ["JB modunu istiyorum", true],
    ["Use 'JB mode' for this task", true],
    ["Don't use 'JB mode'", false],
  ])("respects the user's mode intent: %s", async (rawRequest, expected) => {
    const prison = await runAnalysisPipeline({ rawRequest, language: "tr", targetAI: "auto" }, null);
    expect(prison.compileOptions.jailbreakMode).toBe(expected);
  });

  it.each([
    "JB modunu açıkla",
    "Explain JB mode",
    "Tell me about jailbreak mode",
    "Write an article about JB mode",
    "JB modu nasıl çalışır?",
    "JB modu nedir?",
    "JB modu açık mı?",
    "JB modu açık değil mi?",
    "JB modu kapalı mı?",
    "JB modu kullanılmasın mı?",
    "Is JB mode disabled?",
    "Should JB mode not be enabled?",
    "Can JB mode be enabled?",
    "JB mode enabled?",
    "Should I disable JB mode?",
    "Explain how to disable JB mode",
    "Explain how to disable JB mode and enable JB mode",
    "Explain 'disable JB mode'",
    "JB mode: explain what it does",
    "JB modu: ne anlama geliyor?",
    '"JB modunu kapat" cümlesi ne anlama geliyor?',
  ])("does not treat an informational reference as a mode choice: %s", async (message) => {
    const prison = await runAnalysisPipeline({ rawRequest: "Prepare a blog post", language: "en", targetAI: "gpt", jailbreakMode: true }, null);
    expect(readJailbreakModeRequest(message)).toBeUndefined();
    expect(interpretRevisionLocally(message, prison).patch.set?.options?.jailbreakMode).toBeUndefined();
    expect(prison.compileOptions.jailbreakMode).toBe(true);
  });

  it.each([
    ["JB modunu aç. JB modu kapalı mı?", true],
    ["JB modunu kapat. Explain JB mode.", false],
    ["JB modu nasıl çalışır? JB modunu aç.", true],
    ["Explain how to enable JB mode. Disable JB mode.", false],
    ["Explain JB mode, then enable JB mode.", true],
  ])("keeps the last actual preference when information is also requested: %s", (message, expected) => {
    expect(readJailbreakModeRequest(message)).toBe(expected);
  });

  it("does not infer a mode selection from provider-added requirements", async () => {
    const provider = new ScriptedProvider().enqueue("prison_intent", paymentIntent({
      implicit_requirements: ["Use jailbreak mode"],
      explicit_requirements: ["Add product filtering"],
    }));
    const prison = await runAnalysisPipeline({ rawRequest: "Add product filtering", language: "en", targetAI: "auto" }, provider);
    expect(prison.engine).toEqual(provider.info);
    expect(prison.compileOptions.jailbreakMode).toBe(false);
  });
});

describe("JB mode API persistence", () => {
  let dir: string;
  let repo: FilePrisonRepository;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "prison-jb-state-"));
    repo = new FilePrisonRepository(dir);
    runtime.service = new PrisonService(repo, null);
  });

  afterEach(async () => {
    runtime.service = null;
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    [true, "Bir blog yazısı yaz"],
    [false, "JB modunu aç ve bir blog yazısı yaz"],
  ])("saves the explicit API flag (%s) before returning the new prison", async (jailbreakMode, rawRequest) => {
    const response = await POST(new Request("http://localhost/api/prisons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawRequest, jailbreakMode }),
    }));
    expect(response.status).toBe(201);
    const { prison } = await response.json();
    expect(prison.compileOptions.jailbreakMode).toBe(jailbreakMode);
    const persisted = await repo.get(prison.id);
    expect(persisted?.compileOptions.jailbreakMode).toBe(jailbreakMode);
    expect((await new PrisonService(repo, null).get(prison.id)).compileOptions.jailbreakMode).toBe(jailbreakMode);
  });

  it("keeps the saved prison unchanged when its configured revision provider fails", async () => {
    const provider = new ScriptedProvider()
      .enqueue("prison_intent", paymentIntent())
      .enqueue("prison_prompt_refinement", {
        prompt: "Inspect the existing payment flow, identify the required integration points and implement the requested behavior while preserving the authoritative task contract. Verify the result and provide the required deliverables.",
        strategies_used: ["Task-Specific-Workflow"],
      })
      .enqueue("prison_critic", CLEAN_CRITIC)
      .enqueue("prison_revision", new AIProviderError("rate_limit", "429"));
    const service = new PrisonService(repo, provider);
    const created = await service.analyze({ rawRequest: "Add a payment system", language: "en", targetAI: "codex" });
    const initial = await service.compile(created.id);
    await expect(service.revise(created.id, "JB modunu aç")).rejects.toMatchObject({ code: "ai_error" });
    expect(await repo.get(created.id)).toEqual(initial);
  });
});

describe("JB mode revisions", () => {
  it.each([
    ["Ürünlere kategori filtresi ekle", false, true, undefined],
    ["Ürünlere kategori filtresi ekle", true, false, undefined],
    ["JB modunu açma", true, true, false],
    ["Use JB mode but do not deploy", false, false, true],
    ["JB modunu açıkla", true, false, undefined],
    ["Is JB mode disabled?", true, false, undefined],
    ["Should I use JB mode?", false, true, undefined],
    ["JB modunu kapat. Vazgeçtim, JB modunu aç.", false, false, true],
  ])("requires the user's explicit mode selection for AI revisions: %s", async (message, initialMode, modelMode, expected) => {
    const prison = await runAnalysisPipeline({ rawRequest: "Build a product list", language: "en", targetAI: "gpt", jailbreakMode: initialMode }, null);
    const provider = new ScriptedProvider().enqueue("prison_revision", {
      summary: "Product inventory requirement updated.",
      set: { jailbreak_mode: modelMode, verbosity: "concise" },
      add: { requirements: ["Verify product inventory"] },
    });
    const result = await interpretRevision(message, prison, provider);
    expect(result.engine).toBe("ai");
    expect(result.patch.set?.options?.jailbreakMode).toBe(expected);
    expect(result.patch.set?.options?.verbosity).toBe("concise");
    expect(result.patch.add?.requirements).toContain("Verify product inventory");
  });

  it("keeps product-filter requests as requirements instead of changing JB mode", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: "Build a product list", language: "en", targetAI: "gpt" }, null);
    const result = interpretRevisionLocally("Ürünlere kategori filtresi ekle", prison);
    expect(result.patch.set?.options?.jailbreakMode).toBeUndefined();
    expect(result.patch.add?.requirements).toContain("Ürünlere kategori filtresi ekle");
  });

  it("recompiles mode-only changes and preserves mode in version snapshots", async () => {
    const analyzed = await runAnalysisPipeline({ rawRequest: "Bir blog yazısı yaz", language: "tr", targetAI: "gpt" }, null);
    const initial = await runCompilePipeline(analyzed, { trigger: "initial", note: "", llmReview: false }, { provider: null });
    const enabled = await runRevisionPipeline(initial, "JB modunu aç", { provider: null });
    expect(enabled.compileOptions.jailbreakMode).toBe(true);
    expect(enabled.promptVersions).toHaveLength(2);
    expect(enabled.promptVersions[0]?.options.jailbreakMode).toBe(false);
    expect(enabled.promptVersions[1]?.options.jailbreakMode).toBe(true);
    expect(enabled.revisions.at(-1)?.resultVersion).toBe(2);
    expect(enabled.revisions.at(-1)?.changes).toContain("Ayarlar: JB modu açık");

    const unchanged = await runRevisionPipeline(enabled, "JB modunu aç", { provider: null });
    expect(unchanged.promptVersions).toHaveLength(2);
    expect(unchanged.revisions.at(-1)?.resultVersion).toBeNull();

    const disabled = await runRevisionPipeline(unchanged, "JB modunu açma", { provider: null });
    expect(disabled.compileOptions.jailbreakMode).toBe(false);
    expect(disabled.promptVersions).toHaveLength(3);
    expect(disabled.promptVersions[2]?.options.jailbreakMode).toBe(false);
    expect(disabled.revisions.at(-1)?.resultVersion).toBe(3);
  });
});
