import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { PrisonOperationSchema, type OperationRequest, type PrisonOperation } from "@/models/operation";
import type { CouncilMode } from "@/models/options";
import { STATUS_LABELS } from "@/templates/ui-labels";
import { PrisonView } from "@/ui/prison-view/PrisonView";

const noop = () => undefined;
const revision = async () => true;
const actions = { viewVersion: null, onViewVersion: noop, onCompile: noop, onModify: noop, onRetarget: noop, onRevise: revision, onClarify: revision, onRestore: noop };

function failedOperation(prisonId: string, mode: CouncilMode, status: "failed" | "interrupted"): PrisonOperation {
  return {
    id: `op_${"a".repeat(32)}`, prisonId, kind: "compile", status, startedAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:10:00Z",
    resultVersion: null, error: { code: status, message: "Gerçek işlem son hatası" },
    progress: {
      stage: "peer_review", completed: 2, total: 3, message: "Actual prior progress", startedAt: "2026-10-05T00:00:00Z", councilMode: mode,
      events: [
        { seq: 0, at: "2026-10-05T00:00:00Z", round: 0, kind: "seat", actorId: "one", model: "test/one", targetId: null, dimension: null, score: null, text: "Gerçek masa katılımcısı" },
        { seq: 1, at: "2026-10-05T00:09:00Z", round: 2, kind: "critique", actorId: "one", model: "test/one", targetId: null, dimension: null, score: null, text: "Kaydedilmiş gerçek değerlendirme" },
      ],
    },
  };
}

describe("persistent terminal operation presentation", () => {
  it.each<OperationRequest>([
    { kind: "compile", input: { executionContext: "mobile", councilMode: "collaboration" } },
    { kind: "adjust", input: { executionContext: "mobile" } },
    { kind: "revise", input: { message: "Kısa bir tablo hazırla." } },
    { kind: "clarify", input: { clarifications: [{ question: "Hangi kitle?", answer: "Kahve severler" }] } },
  ])("offers the saved $kind action after reloading its failure instead of substituting generation", async (request) => {
    const prison = await runAnalysisPipeline({ rawRequest: "Bir içerik planı hazırla", targetAI: "gpt", language: "tr" }, null);
    const operation = PrisonOperationSchema.parse(JSON.parse(JSON.stringify({
      ...failedOperation(prison.id, "collaboration", "failed"), kind: request.kind,
      retry: { request, sourceFingerprint: "b".repeat(64) },
    })));
    const html = renderToStaticMarkup(createElement(PrisonView, { prison, busy: null, operation, ...actions, onRetryOperation: noop }));
    expect(html).toContain("Aynı işlemi yeniden dene");
    expect(html).not.toContain("Promptu yeniden üret");
    expect(html).toContain("Gerçek işlem son hatası");
    expect(html).toContain("Kaydedilmiş gerçek değerlendirme");
  });

  it.each([
    ["collaboration", "failed"], ["competition", "failed"],
    ["collaboration", "interrupted"], ["competition", "interrupted"],
  ] as const)("retains %s %s discussion with an honest error and available retry", async (mode, status) => {
    const prison = await runAnalysisPipeline({ rawRequest: "Bir içerik planı hazırla", targetAI: "gpt", language: "tr" }, null);
    const operation = failedOperation(prison.id, mode, status);
    const html = renderToStaticMarkup(createElement(PrisonView, { prison, busy: null, operation, ...actions }));
    expect(html).toContain(status === "failed" ? "İşlem tamamlanamadı" : "İşlem yarıda kesildi");
    expect(html).toContain("Gerçek işlem son hatası");
    expect(html).toContain("Kaydedilmiş gerçek değerlendirme");
    expect(html).toContain(mode === "competition" ? 'aria-label="Kapışma arenası"' : 'aria-label="Tartışma masası"');
    expect(html).not.toContain('aria-label="AI masası ilerlemesi"');
    expect(html).not.toContain("Kazanan prompt");
    expect(html).toContain(`>${STATUS_LABELS[prison.status]}</span>`);
    const retry = html.match(/<button[^>]*>Promptu yeniden üret<\/button>/)?.[0];
    expect(retry).toBeTruthy();
    expect(retry).not.toContain("disabled");
  });

  it("preserves the previous valid prompt when a later operation fails", async () => {
    const analyzed = await runAnalysisPipeline({ rawRequest: "Bir içerik planı hazırla", targetAI: "gpt", language: "tr" }, null);
    const prison = await runCompilePipeline(analyzed, { trigger: "initial", note: "", llmReview: false }, { provider: null });
    const html = renderToStaticMarkup(createElement(PrisonView, { prison, busy: null, operation: failedOperation(prison.id, "collaboration", "failed"), ...actions }));
    expect(html).toContain("Kaydedilmiş gerçek değerlendirme");
    expect(html).toContain("Gerçek işlem son hatası");
    expect(html).toContain("v1");
    expect(html).toContain("Promptu yeniden üret");
  });

  it("replaces the saved ready badge with generation state while the first prompt is being built", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: "Bir içerik planı hazırla", targetAI: "gpt", language: "tr" }, null);
    const html = renderToStaticMarkup(createElement(PrisonView, { prison, busy: { kind: "compile", label: "İşlem sürüyor" }, ...actions }));
    expect(html).toContain(">Üretiliyor</span>");
    expect(html).not.toContain(`>${STATUS_LABELS[prison.status]}</span>`);
  });

  it("indicates a new version while retaining the saved old prompt during generation", async () => {
    const analyzed = await runAnalysisPipeline({ rawRequest: "Bir içerik planı hazırla", targetAI: "gpt", language: "tr" }, null);
    const prison = await runCompilePipeline(analyzed, { trigger: "initial", note: "", llmReview: false }, { provider: null });
    const html = renderToStaticMarkup(createElement(PrisonView, { prison, busy: { kind: "compile", label: "İşlem sürüyor" }, ...actions }));
    expect(html).toContain(">Yeni sürüm hazırlanıyor</span>");
    expect(html).toContain("v1");
  });

  it("labels unknown reload discovery honestly instead of claiming generation has started", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: "Bir içerik planı hazırla", targetAI: "gpt", language: "tr" }, null);
    const html = renderToStaticMarkup(createElement(PrisonView, { prison, busy: { kind: "load", label: "İşlem durumu kontrol ediliyor" }, ...actions }));
    expect(html).toContain(">Durum okunuyor</span>");
    expect(html).not.toContain(">Üretiliyor</span>");
  });

  it("uses the durable active job kind even when the reloaded observer has a generic busy state", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: "Bir içerik planı hazırla", targetAI: "gpt", language: "tr" }, null);
    const operation = { ...failedOperation(prison.id, "competition", "failed"), status: "running" as const, error: null };
    const html = renderToStaticMarkup(createElement(PrisonView, { prison, operation, busy: { kind: "load", label: "İşlem durumu kontrol ediliyor" }, ...actions }));
    expect(html).toContain(">Üretiliyor</span>");
    const clarifying = renderToStaticMarkup(createElement(PrisonView, { prison, operation: { ...operation, kind: "clarify" }, busy: { kind: "compile", label: "İşlem izleniyor" }, ...actions }));
    expect(clarifying).toContain(">Görev güncelleniyor</span>");
    expect(clarifying).not.toContain(">Üretiliyor</span>");
  });
});
