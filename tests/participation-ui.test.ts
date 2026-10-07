import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptJourney } from "@/ui/participation/PromptJourney";
import { PromptHandoff } from "@/ui/participation/PromptHandoff";
import { appendComposerHint, copyPrompt, downloadPrompt, promptExport, promptUseInstruction } from "@/ui/participation/prompt-transfer";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { PromptOutput } from "@/ui/prompt-output/PromptOutput";
import { CouncilArena } from "@/ui/council-arena/CouncilArena";
import type { CouncilEvent } from "@/models/council";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("owner participation and truthful handoff", () => {
  it("teaches optional next steps without presenting models or evaluations that did not run", () => {
    const html = renderToStaticMarkup(createElement(PromptJourney, { stage: "input" }));
    expect(html).toContain("Rotayı sen çiziyorsun");
    expect(html).toContain("<details");
    expect(html).not.toContain(" open=");
    expect(html).not.toContain("Model önerilerini incele");
    expect(html).not.toContain("Adaylar ve eleştiriler kayıtlıdır");
    expect(html).toContain("verdiğin hedef ve geri bildirimdir");
  });

  it("only refers to recorded model comparison when council evidence is present", () => {
    const html = renderToStaticMarkup(createElement(PromptJourney, { stage: "ready", councilEvidence: true }));
    expect(html).toContain("Model önerilerini incele");
    expect(html).toContain("Adaylar ve eleştiriler kayıtlıdır");
    expect(html).not.toContain("Kazanan");
    expect(html).not.toContain("100%");
  });

  it("does not pretend there is a recorded discussion during a single-engine operation", () => {
    const html = renderToStaticMarkup(createElement(PromptJourney, { stage: "working" }));
    expect(html).toContain("hedef ve sınırlar prompta dönüştürülüyor");
    expect(html).not.toContain("Kaydedilen açıklamalar");
    expect(html).not.toContain("Adaylar ve eleştiriler kayıtlıdır");
  });

  it.each([false, true])("keeps a stopped ledger reviewable without claiming a prompt exists (council evidence=%s)", (councilEvidence) => {
    const html = renderToStaticMarkup(createElement(PromptJourney, { stage: "review", councilEvidence }));
    expect(html).toContain("Kaydedilen çalışmayı incele");
    expect(html).toContain("son tartışma kaydını gösterir");
    expect(html).toContain("Promptun hazır olup olmadığını işlem sonucundan kontrol et");
    expect(html).toContain("tamamlanamayan çalışmayı yeniden deneyebilirsin");
    expect(html).not.toContain("Şimdi kendi işinde dene");
    expect(html).not.toContain("Bu çıktı, başka bir AI");
    expect(html).not.toContain("Tam promptu kopyala");
    expect(html).not.toContain(".txt indir");
  });

  it.each([
    { live: false, promptReady: undefined, title: "Kaydedilen çalışmayı incele" },
    { live: false, promptReady: false, title: "Kaydedilen çalışmayı incele" },
    { live: false, promptReady: true, title: "Şimdi kendi işinde dene" },
    { live: true, promptReady: false, title: "Şimdi prompt hazırlanıyor" },
    { live: true, promptReady: true, title: "Şimdi prompt hazırlanıyor" },
  ])("uses real readiness instead of assuming non-live means completed ($live/$promptReady)", ({ live, promptReady, title }) => {
    const events: CouncilEvent[] = [
      { seq: 0, at: "2026-10-06T12:00:00Z", round: 0, kind: "seat", actorId: "one", model: "test/one", targetId: null, dimension: null, score: null, text: "Kaydedilen katılımcı" },
      { seq: 1, at: "2026-10-06T12:00:05Z", round: 1, kind: "critique", actorId: "one", model: "test/one", targetId: "two", dimension: null, score: 0.8, text: "Kaydedilen gerçek eleştiri" },
    ];
    const before = structuredClone(events);
    const html = renderToStaticMarkup(createElement(CouncilArena, { mode: "competition", events, live, promptReady }));
    expect(html).toContain(title);
    for (const other of ["Kaydedilen çalışmayı incele", "Şimdi kendi işinde dene", "Şimdi prompt hazırlanıyor"]) {
      if (other !== title) expect(html).not.toContain(other);
    }
    if (!promptReady || live) expect(html).not.toContain("Bu çıktı, başka bir AI");
    expect(events).toEqual(before);
  });

  it.each(["chat", "mobile", "browser", "agent"] as const)("gives a user-controlled %s handoff without auto-transmitting the prompt", (context) => {
    const html = renderToStaticMarkup(createElement(PromptHandoff, { text: "<script>özel metin</script>", version: 2, target: "gpt", context, active: true, busy: false }));
    expect(html).toContain("v2 promptunu");
    expect(html).toContain("Tam promptu kopyala");
    expect(html).toContain(".txt indir");
    expect(html).toContain("tamamını tek mesaj olarak yapıştır");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Kopyalandı");
    expect(html).toContain('href="https://chatgpt.com/"');
    expect(html).not.toContain("%3Cscript");
    expect(html).not.toContain("Geri bildirimin uygulandı");
  });

  it("prevents revisions to an inactive historical version and marks the real target", () => {
    const onRevise = vi.fn(async () => true);
    const html = renderToStaticMarkup(createElement(PromptHandoff, { text: "prompt", version: 1, target: "claude", context: "chat", active: false, busy: false, onRevise }));
    expect(html).toContain("Claude");
    expect(html).toContain("geri bildirimin aktif sürümü değiştirecek");
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Geri bildirimle yeni sürüm üret/);
    expect(onRevise).not.toHaveBeenCalled();
  });

  it("respects the parent operation lock while retaining export controls", () => {
    const html = renderToStaticMarkup(createElement(PromptHandoff, { text: "prompt", version: 1, target: "codex", context: "agent", active: true, busy: true, onRevise: async () => true }));
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Geri bildirimle yeni sürüm üret/);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Tam promptu kopyala/);
  });

  it("exports the entire exact selected prompt with a safe filename and no appended directives", () => {
    const text = 'Görev\n<script>only text</script>\n"Türkçe"\n' + "ş".repeat(18000);
    expect(promptExport(text, 7, "gemini")).toEqual({ text, filename: "prison-v7-gemini.txt", type: "text/plain;charset=utf-8" });
    expect(promptExport(text, Number.NaN, "gpt").filename).toBe("prison-v1-gpt.txt");
    expect(promptExport(text, -5, "gpt").text).toBe(text);
  });

  it("copies the entire actual prompt and confirms success only after the clipboard accepts it", async () => {
    const text = "Tam metin\n" + "uzun talimat ".repeat(1000);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyPrompt(text)).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
  });

  it("reports failed clipboard fallback honestly and always removes its temporary input", async () => {
    const remove = vi.fn();
    const area = { value: "", style: {}, setAttribute: vi.fn(), select: vi.fn(), remove };
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    vi.stubGlobal("document", { createElement: () => area, body: { appendChild: vi.fn() }, execCommand: () => false });
    expect(await copyPrompt("literal prompt")).toBe(false);
    expect(area.value).toBe("literal prompt");
    expect(remove).toHaveBeenCalledOnce();
  });

  it("handles unavailable clipboard and failing legacy copy without throwing", async () => {
    const remove = vi.fn();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { createElement: () => ({ value: "", style: {}, setAttribute: vi.fn(), select: vi.fn(), remove }), body: { appendChild: vi.fn() }, execCommand: () => { throw new Error("unsupported"); } });
    expect(await copyPrompt("prompt")).toBe(false);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("downloads a literal UTF-8 file, then removes the link and releases the blob", async () => {
    const blobs: Blob[] = [];
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { blobs.push(blob as Blob); return "blob:local-prompt"; });
    const click = vi.fn();
    const remove = vi.fn();
    const link = { href: "", download: "", click, remove };
    vi.stubGlobal("document", { createElement: () => link, body: { appendChild: vi.fn() } });
    vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 1; } });
    const text = "Görev ve sınırlar\n<script>bu düz metindir</script>\n";
    expect(downloadPrompt(text, 3, "claude")).toBe(true);
    expect(await blobs[0]!.text()).toBe(text);
    expect(blobs[0]!.type).toBe("text/plain;charset=utf-8");
    expect(link.download).toBe("prison-v3-claude.txt");
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:local-prompt");
  });

  it("releases a failed download without claiming it started", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:failure");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const remove = vi.fn();
    vi.stubGlobal("document", { createElement: () => ({ href: "", download: "", click: () => { throw new Error("blocked"); }, remove }), body: { appendChild: vi.fn() } });
    expect(downloadPrompt("prompt", 1, "gpt")).toBe(false);
    expect(remove).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:failure");
  });

  it("lets owner hints alter their visible request without truncating existing content", () => {
    const request = "Mevcut projemi koru.";
    expect(appendComposerHint(request, "Çıktı: ", 100)).toBe(`${request}\nÇıktı: `);
    expect(appendComposerHint(request + "\n", "Sınır: ", 100)).toBe(`${request}\nSınır: `);
    expect(appendComposerHint(request, "Uzun ek talimat", request.length + 2)).toBe(request);
    expect(appendComposerHint("", "Hedef: ", 100)).toBe("Hedef: ");
  });

  it("escapes owner-selected labels rather than executing text in guidance", () => {
    const instruction = promptUseInstruction("<script>name</script>", "chat");
    const html = renderToStaticMarkup(createElement("p", null, instruction));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("integrates a historical full prompt without silently substituting the active version", async () => {
    const analyzed = await runAnalysisPipeline({ rawRequest: "Bir içerik planı hazırla", targetAI: "gpt", language: "tr" }, null);
    const prison = await runCompilePipeline(analyzed, { trigger: "initial", note: "", llmReview: false }, { provider: null });
    const first = prison.promptVersions[0]!;
    first.text = "<script>historical</script>";
    prison.promptVersions.push({ ...first, version: 2, text: "ACTIVE SECOND VERSION", resolvedTarget: "claude" });
    prison.activeVersion = 2;
    const noop = () => undefined;
    const html = renderToStaticMarkup(createElement(PromptOutput, { prison, viewVersion: 1, busy: false, onViewVersion: noop, onModify: noop, onRetarget: noop, onRegenerate: noop, onRestore: noop, onRevise: async () => true }));
    expect(html).toContain("v1 promptunu");
    expect(html).toContain("&lt;script&gt;historical&lt;/script&gt;");
    expect(html).not.toContain("ACTIVE SECOND VERSION");
    expect(html).not.toContain("Adaylar ve eleştiriler kayıtlıdır");
    expect(html).not.toContain("<script>");
  });
});
