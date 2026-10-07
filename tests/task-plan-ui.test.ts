import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import type { ResolvedPrison } from "@/models/prison";
import { IntentPreview } from "@/ui/intent-preview/IntentPreview";
import { PrisonView } from "@/ui/prison-view/PrisonView";
import { PromptOutput } from "@/ui/prompt-output/PromptOutput";

async function plannedPrison(): Promise<ResolvedPrison> {
  const prison = await runAnalysisPipeline({ rawRequest: "Mevcut projemdeki ödeme akışını düzelt", targetAI: "gpt", language: "tr" }, null);
  return {
    ...prison,
    spec: {
      ...prison.spec,
      taskPlan: {
        approach: "Mevcut ödeme akışını inceleyip doğrulanan sorunları küçük değişikliklerle düzelt.",
        steps: [
          { action: "Webhook işleyicisini incele", purpose: "Tekrarlanan ödemelerin kaynağını bul", verification: "Başarısız olay kaydını tekrar üret" },
          { action: "Yinelenen olayları ayıkla", purpose: "İkinci kez tahsilatı engelle", verification: "Aynı olay iki kez geldiğinde tek tahsilat olduğunu doğrula" },
        ],
        clarifyingQuestions: ["Hangi ödeme sağlayıcısı kullanılıyor?"],
        recommendedTarget: "codex",
        targetRationale: "Codex, mevcut depo içindeki ödeme akışını dosyalar ve testlerle birlikte ele almaya uygundur.",
      },
    },
  };
}

const noop = () => undefined;
const revise = async () => true;

describe("task planning presentation", () => {
  it("shows actionable steps, verification, questions, and an honest recommendation while preserving the selected AI", async () => {
    const prison = await plannedPrison();
    const html = renderToStaticMarkup(createElement(IntentPreview, { prison }));
    expect(html).toContain("Promptun hazırlanacağı AI");
    expect(html).toContain("Prompt, seçtiğin AI için hazırlanacak.");
    expect(html).toContain("Analizin önerisi: Codex");
    expect(html).toContain(prison.spec.taskPlan!.targetRationale);
    expect(html).toContain("Webhook işleyicisini incele");
    expect(html).toContain("Tekrarlanan ödemelerin kaynağını bul");
    expect(html).toContain("Kontrol: Başarısız olay kaydını tekrar üret");
    expect(html).toContain("Hangi ödeme sağlayıcısı kullanılıyor?");
    expect(html).toContain("Varsayımlar · doğrulanmış bilgi değildir");
  });

  it("allows clarification before the first prompt exists", async () => {
    const prison = await plannedPrison();
    const html = renderToStaticMarkup(createElement(PrisonView, {
      prison,
      busy: null,
      viewVersion: null,
      onViewVersion: noop,
      onCompile: noop,
      onModify: noop,
      onRetarget: noop,
      onRevise: revise,
      onClarify: revise,
      onRestore: noop,
    }));
    expect(html).toContain("Bilgileri netleştir");
    expect(html).toContain("Bilgileri güncelle");
    expect(html).toContain('aria-label="Revizyon mesajı"');
    expect(html).toContain("Promptu üret");
    expect(html).toContain("Yanıtları işle ve planı güncelle");
    expect(html).toContain('placeholder="Yanıtını yaz…"');
  });

  it("handles legacy plans without inventing a detailed approach or an AI recommendation", async () => {
    const base = await plannedPrison();
    const prison = { ...base, spec: { ...base.spec, taskPlan: null } };
    const html = renderToStaticMarkup(createElement(IntentPreview, { prison }));
    expect(html).toContain("bu sürümde ayrıntılı yaklaşım bulunmuyor");
    expect(html).not.toContain("Analizin önerisi:");
    expect(html).toContain(prison.spec.requiredActions[0]!.text);
  });

  it("does not ask incidental unknowns when the current plan needs no further clarification", async () => {
    const prison = await plannedPrison();
    prison.spec.taskPlan!.clarifyingQuestions = [];
    prison.spec.unknowns = [{ id: "unk_budget", text: "Unknown advertising budget", source: "implicit" }];
    const html = renderToStaticMarkup(createElement(IntentPreview, { prison, onClarify: revise }));
    expect(html).not.toContain("Netleştirilecek bilgiler");
    expect(html).not.toContain("Yanıtları işle ve planı güncelle");
    expect(html).toContain("Unknown advertising budget");
  });

  it("escapes generated planning text instead of interpreting it as HTML", async () => {
    const prison = await plannedPrison();
    prison.spec.taskPlan!.approach = '<script>alert("untrusted plan")</script>';
    const html = renderToStaticMarkup(createElement(IntentPreview, { prison }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows real generation and review evidence, including unresolved warnings in JB mode", async () => {
    const prison = await plannedPrison();
    const compiled = await runCompilePipeline(
      { ...prison, compileOptions: { ...prison.compileOptions, jailbreakMode: true } },
      { trigger: "initial", note: "", llmReview: false },
      { provider: null },
    );
    compiled.promptVersions[0]!.critic.issues = [{ dimension: "constraint_clarity", severity: "high", message: "Netleştirilmesi gereken görev sınırı", source: "rules", fixed: false }];
    const html = renderToStaticMarkup(createElement(PromptOutput, {
      prison: compiled,
      viewVersion: null,
      busy: false,
      onViewVersion: noop,
      onModify: noop,
      onRetarget: noop,
      onRegenerate: noop,
      onRestore: noop,
    }));
    expect(html).toContain("Yerel motorla üretildi");
    expect(html).toContain("Kural kontrolü");
    expect(html).not.toContain("Kural kontrolü + AI eleştirmeni");
    expect(html).toContain("1 kontrol notu");
    expect(html).toContain("Netleştirilmesi gereken görev sınırı");
    expect(html).toContain("Kontroller, hazırlanan promptun yapısını ve görevle uyumunu değerlendirir.");
  });
});
