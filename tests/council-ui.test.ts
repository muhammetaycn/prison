import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import type { CouncilReview } from "@/models/council";
import { CouncilReviewPanel } from "@/ui/prompt-output/CouncilReviewPanel";
import { PromptOutput } from "@/ui/prompt-output/PromptOutput";
import { PrisonView } from "@/ui/prison-view/PrisonView";
import { EngineConnection } from "@/ui/common/EngineConnection";
import { CouncilModePicker } from "@/ui/common/CouncilModePicker";

const noop = () => undefined;
const revision = async () => true;
const scores = { intent_alignment: 0.95, context_completeness: 0.95, constraint_clarity: 0.95, execution_clarity: 0.95, output_clarity: 0.95, target_ai_compatibility: 0.95 };

function review(winnerModel = "test/model-one"): CouncilReview {
  return {
    mode: "competition",
    executionContext: "browser",
    startedAt: "2026-10-04T10:00:00.000Z",
    completedAt: "2026-10-04T10:01:00.000Z",
    rounds: 2,
    participants: [
      { id: "one", provider: "test", model: winnerModel, role: "Görev uzmanı", status: "winner", error: null, initialPrompt: "İlk prompt adayı", revisedPrompt: "Düzeltilen prompt adayı", strategies: [], findings: ["İstek sahibinin sınırları korundu."], score: 0.95 },
      { id: "two", provider: "test", model: "test/model-two", role: "Denetçi", status: "reviewed", error: null, initialPrompt: "İkinci aday", revisedPrompt: "İkinci düzeltilen aday", strategies: [], findings: [], score: 0.85 },
      { id: "three", provider: "test", model: "test/model-three", role: "Karşı görüş", status: "failed", error: "Yanıt süresi doldu.", initialPrompt: null, revisedPrompt: null, strategies: [], findings: [], score: null },
    ],
    reviews: [
      { stage: "peer", reviewerId: "two", candidateId: "one", scores, issues: [{ severity: "medium", message: "Gözlenen eksik giderilmeli." }], suggestions: ["Çıktı biçimini netleştir."] },
      { stage: "final", reviewerId: "two", candidateId: "one", scores, issues: [], suggestions: [] },
    ],
    winnerId: "one",
    winnerModel,
    decision: "İstek ve çıktı kurallarına en iyi uyan aday seçildi.",
    finalReviewerModel: "test/independent-reviewer",
  };
}

async function compiledPrison() {
  const prison = await runAnalysisPipeline({ rawRequest: "Bir içerik planı hazırla", targetAI: "gpt", language: "tr" }, null);
  return runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: false }, { provider: null });
}

describe("council evidence presentation", () => {
  it.each(["competition", "collaboration"] as const)("distinguishes the selected %s draft from a different model's final repair", (mode) => {
    const evidence: CouncilReview = { ...review("test/original-selection"), mode, repairerModel: "test/actual-repairer", finalReviewerModel: "test/independent-final-reviewer" };
    const html = renderToStaticMarkup(createElement(CouncilReviewPanel, { review: evidence }));
    expect(html).toContain("original-selection");
    expect(html).toContain('Son düzeltmeyi hazırlayan: <span title="test/actual-repairer">actual-repairer</span>');
    expect(html).toContain("independent-final-reviewer");
    if (mode === "collaboration") {
      expect(html).toContain("Masada seçilen model");
      expect(html).not.toContain("Son promptu hazırlayan model");
    }
  });
  it.each(["competition", "collaboration"] as const)("does not call a guarded %s finalist an approved jury winner", (mode) => {
    const evidence: CouncilReview = { ...review(), mode, selectionBasis: "finalist", decision: "Uzlaşma sağlanmadı; ayrı son metin denetimini geçti." };
    const html = renderToStaticMarkup(createElement(CouncilReviewPanel, { review: evidence }));
    expect(html).toContain("Son denetimden geçen aday");
    expect(html).toContain(evidence.decision);
    expect(html).not.toContain("Kazanan prompt");
  });
  it("does not offer a pretend multi-model workflow while the council is off", () => {
    const html = renderToStaticMarkup(createElement(CouncilModePicker, { value: "competition", available: false, onChange: noop }));
    // Only the fast single-model path is offered, with a pointer to where a council can be set up.
    expect(html).toContain("Hızlı · tek model");
    expect(html).toContain("AI ekibim · API ayarları");
    expect(html).not.toContain("Yarışma masası");
    expect(html).not.toContain("Ekip masası");
  });

  it("offers the fast path first and the tables as the detailed options when a council is configured", () => {
    const html = renderToStaticMarkup(createElement(CouncilModePicker, { value: "single", available: true, onChange: noop }));
    const fast = html.indexOf("Hızlı · tek model");
    expect(fast).toBeGreaterThan(-1);
    expect(html.indexOf("Yarışma masası")).toBeGreaterThan(fast);
    expect(html.indexOf("Ekip masası")).toBeGreaterThan(fast);
    expect(html).toContain("tek bir yapay zekâ API");
  });

  it("labels configured models as configuration rather than claiming every model is connected", () => {
    const html = renderToStaticMarkup(createElement(EngineConnection, {
      engine: { mode: "ai", provider: "nvidia", model: "test/analysis-model" }, loading: false, health: null, checking: false, disabled: false, onCheck: noop,
      council: { enabled: true, models: review().participants.map(({ id, provider, model, role }) => ({ id, provider, model, role })) },
    }));
    expect(html).toContain("3 modelli AI masası");
    expect(html).toContain("Yapılandırılan modeller");
    expect(html).toContain("Bağlantı henüz sınanmadı");
    expect(html).toContain("Analiz motorunu kontrol et");
    expect(html).not.toContain("Değerlendirildi");
    expect(html).not.toContain("95/100");
  });

  it("shows real candidate scores, failure evidence, peer feedback and the selected winner", () => {
    const html = renderToStaticMarkup(createElement(CouncilReviewPanel, { review: review() }));
    expect(html).toContain("3 model · 2 tur");
    expect(html).toContain("Kazanan prompt");
    expect(html).toContain("95/100");
    expect(html).toContain("85/100");
    expect(html).toContain("Yanıt alınamadı");
    expect(html).toContain("Yanıt süresi doldu.");
    expect(html).toContain("1 modelin yanıtı tamamlanamadı");
    expect(html).toContain("Karşılıklı değerlendirme");
    expect(html).toContain("Son tur değerlendirmesi");
    expect(html).toContain("Çıktı biçimini netleştir.");
    expect(html).toContain("bu görevdeki adayların AI değerlendirmesidir");
    expect(html).toContain("independent-reviewer");
    expect(html).toContain("Tarayıcıdaki AI");
  });

  it("escapes model-generated text in findings, review notes and candidate prompts", () => {
    const evidence = review();
    const malicious = '<script>alert("model content")</script>';
    evidence.participants[0]!.findings = [malicious];
    evidence.participants[0]!.initialPrompt = malicious;
    evidence.reviews[0]!.suggestions = [malicious];
    const html = renderToStaticMarkup(createElement(CouncilReviewPanel, { review: evidence }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses collaboration language for an actual team result", () => {
    const evidence = { ...review(), mode: "collaboration" as const };
    const html = renderToStaticMarkup(createElement(CouncilReviewPanel, { review: evidence }));
    expect(html).toContain("Ekip masası");
    expect(html).toContain("Son promptu hazırlayan model");
    expect(html).not.toContain("Kazanan prompt");
  });

  it("does not manufacture council evidence for legacy or local prompt versions", async () => {
    const prison = await compiledPrison();
    const html = renderToStaticMarkup(createElement(PromptOutput, { prison, viewVersion: null, busy: false, onViewVersion: noop, onModify: noop, onRetarget: noop, onRegenerate: noop, onRestore: noop }));
    expect(html).not.toContain('aria-label="AI masası sonucu"');
    expect(html).not.toContain("Kazanan prompt");
  });

  it("shows the selected historical version's council result instead of the current winner", async () => {
    const prison = await compiledPrison();
    const first = prison.promptVersions[0]!;
    first.councilReview = review("test/historical-winner");
    prison.promptVersions.push({ ...first, version: 2, councilReview: review("test/current-winner") });
    prison.activeVersion = 2;
    const html = renderToStaticMarkup(createElement(PromptOutput, { prison, viewVersion: 1, busy: false, onViewVersion: noop, onModify: noop, onRetarget: noop, onRegenerate: noop, onRestore: noop }));
    expect(html).toContain("historical-winner");
    expect(html).not.toContain("current-winner");
  });

  it("offers context and workflow selection before the first prompt exists", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: "Bir içerik planı hazırla", targetAI: "gpt", language: "tr" }, null);
    const html = renderToStaticMarkup(createElement(PrisonView, { prison, busy: null, viewVersion: null, onViewVersion: noop, onCompile: noop, onModify: noop, onRetarget: noop, onRevise: revision, onClarify: revision, onRestore: noop }));
    expect(html).toContain("Normal sohbet");
    expect(html).toContain("Telefondaki AI");
    expect(html).toContain("Tarayıcıdaki AI");
    expect(html).toContain("Araç kullanan agent");
    expect(html).toContain("Yarışma masası");
    expect(html).toContain("Ekip masası");
    expect(html).not.toContain("Kazanan prompt");
  });

  it("shows operation progress only when the server has actually reported a stage", async () => {
    const prison = await compiledPrison();
    const props = { prison, busy: { kind: "compile" as const, label: "Prompt hazırlanıyor" }, viewVersion: null, onViewVersion: noop, onCompile: noop, onModify: noop, onRetarget: noop, onRevise: revision, onClarify: revision, onRestore: noop };
    const waiting = renderToStaticMarkup(createElement(PrisonView, props));
    expect(waiting).not.toContain('aria-label="AI masası ilerlemesi"');
    const working = renderToStaticMarkup(createElement(PrisonView, { ...props, progress: { stage: "peer_review", completed: 2, total: 6, message: "İki karşılıklı değerlendirme tamamlandı.", startedAt: "2026-10-04T10:00:00.000Z" } }));
    expect(working).toContain("Modeller birbirini değerlendiriyor");
    expect(working).toContain("2/6 tamamlandı");
    expect(working).toContain("İki karşılıklı değerlendirme tamamlandı.");
    const completed = renderToStaticMarkup(createElement(PrisonView, { ...props, busy: null, progress: { stage: "peer_review", completed: 2, total: 6, message: "Eski ilerleme", startedAt: "2026-10-04T10:00:00.000Z" } }));
    expect(completed).not.toContain("Eski ilerleme");
  });
});
