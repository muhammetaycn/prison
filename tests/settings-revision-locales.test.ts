import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider, type UILocale } from "@/ui/i18n";
import type { RevisionRecord } from "@/models/prison";
import { ProviderSettings } from "@/ui/settings/ProviderSettings";
import { RevisionChat } from "@/ui/revision-chat/RevisionChat";

describe("settings and revision language boundaries", () => {
  it.each([
    ["tr", "AI ekibini kur", "Ekip yükleniyor", "Göreve dön"],
    ["en", "Build your AI team", "Loading your team", "Return to task"],
    ["zh", "组建你的 AI 团队", "正在加载团队", "返回任务"],
  ] as const)("shows an honest settings loading screen in %s", (locale, heading, loading, back) => {
    const onSaved = vi.fn(async () => undefined);
    const html = renderToStaticMarkup(createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(ProviderSettings, { onClose: vi.fn(), onSaved }),
    }));
    expect(html).toContain(heading);
    expect(html).toContain(loading);
    expect(html).toContain(back);
    expect(html).not.toContain('type="password"');
    expect(onSaved).not.toHaveBeenCalled();
    if (locale !== "tr") expect(html).not.toContain("Hedef AI promptu kullanacağın yerdir");
  });

  const userRevision: RevisionRecord = {
    id: "revision-example",
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    message: "Keep my custom request: 飞机 kanadı.",
    summary: "Provider summary: 用户的原文 korunur.",
    changes: ["Original engine change: preserve wing geometry."],
    resultVersion: 3,
    engine: "local",
    clarifications: [{ question: "Original question: Kanat boyutu?", answer: "My exact answer: 2 米." }],
  };

  const renderRevision = (locale: UILocale, hasPrompt = true) => renderToStaticMarkup(createElement(I18nProvider, {
    initialLocale: locale,
    children: createElement(RevisionChat, {
      revisions: [userRevision], busy: true, onSubmit: vi.fn(async () => true), onViewVersion: vi.fn(), hasPrompt,
    }),
  }));

  it.each([
    ["tr", "Sistem sorusu:", "Yanıtın:", "Bunu daha katı yap.", "yerel motor"],
    ["en", "System question:", "Your answer:", "Make this stricter.", "local engine"],
    ["zh", "系统问题：", "你的回答：", "让要求更严格。", "本地引擎"],
  ] as const)("localizes revision controls in %s while preserving user and provider text", (locale, question, answer, suggestion, engine) => {
    const html = renderRevision(locale);
    expect(html).toContain(question);
    expect(html).toContain(answer);
    expect(html).toContain(suggestion);
    expect(html).toContain(engine);
    expect(html).toContain(userRevision.clarifications![0].question);
    expect(html).toContain(userRevision.clarifications![0].answer);
    expect(html).toContain(userRevision.summary);
    expect(html).toContain(userRevision.changes[0]);
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).toContain("→ v3");
    if (locale !== "tr") {
      expect(html).not.toContain("Promptu nasıl değiştireyim");
      expect(html).not.toContain("az önce");
    }
  });

  it("uses clarification wording before a prompt is ready in English and Chinese", () => {
    const english = renderRevision("en", false);
    expect(english).toContain("Clarify the details");
    expect(english).toContain("Answer the questions or adjust your task.");
    expect(english).toContain("Update details");
    expect(english).not.toContain("How should the prompt change?");
    const chinese = renderRevision("zh", false);
    expect(chinese).toContain("澄清信息");
    expect(chinese).toContain("回答问题或调整任务。");
    expect(chinese).toContain("更新信息");
    expect(chinese).not.toContain("如何修改提示词");
  });
});
