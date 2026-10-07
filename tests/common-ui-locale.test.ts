import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider, translate, type UILocale } from "@/ui/i18n";
import { CouncilModePicker } from "@/ui/common/CouncilModePicker";
import { CouncilProgressPanel, localizeProgressMessage } from "@/ui/common/CouncilProgressPanel";
import { EngineConnection, connectionHealthMessage } from "@/ui/common/EngineConnection";
import { ExecutionContextPicker } from "@/ui/common/ExecutionContextPicker";
import { StatusPipeline } from "@/ui/common/StatusPipeline";

function render(locale: UILocale, child: ReactNode) {
  return renderToStaticMarkup(createElement(I18nProvider, { initialLocale: locale }, child));
}

describe("localized controls preserve generation choices", () => {
  it.each([
    ["tr", "Hızlı · tek model", "Çalışma biçimi"],
    ["en", "Quick · single model", "Working mode"],
    ["zh", "快速 · 单模型", "工作方式"],
  ] as const)("keeps only the single-model route when no council is available in %s", (locale, quick, heading) => {
    const onChange = vi.fn();
    const html = render(locale, createElement(CouncilModePicker, { value: "competition", available: false, onChange }));
    expect(html).toContain(quick);
    expect(html).toContain(heading);
    expect(html.match(/role="radio"/gu)).toHaveLength(1);
    expect(html).toContain('aria-checked="true"');
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers optional team modes while preserving radio selection and operation locks", () => {
    const html = render("zh", createElement(CouncilModePicker, { value: "collaboration", available: true, disabled: true, onChange: vi.fn() }));
    expect(html.match(/role="radio"/gu)).toHaveLength(3);
    expect(html.match(/disabled=""/gu)).toHaveLength(3);
    expect(html).toMatch(/aria-checked="true"[^>]*>团队讨论（详细）/u);
    expect(render("en", createElement(ExecutionContextPicker, { value: "agent", onChange: vi.fn() }))).toContain("Your request determines its permissions.");
    expect(render("zh", createElement(StatusPipeline, { status: "READY" }))).toContain("任务状态");
  });
});

describe("service-generated status localization", () => {
  it("shows optional table configuration failure separately from the primary connection", () => {
    const html = render("zh", createElement(EngineConnection, {
      engine: { mode: "ai", provider: "openai", model: "primary/model" },
      council: { enabled: false, models: [], configurationError: "AI_COUNCIL_MODELS is invalid." },
      loading: false, health: null, checking: false, disabled: false, onCheck: vi.fn(),
    }));
    expect(html).toContain("primary/model");
    expect(html).toContain("仍可使用快速单模型模式");
    expect(html).toContain("AI_COUNCIL_MODELS is invalid.");
    expect(html).toContain("尚未测试连接");
    expect(html).not.toContain('disabled=""');
  });

  it("translates progress captions and round numbers without touching unknown quoted content", () => {
    const t = (tr: string, en: string, zh: string) => translate("zh", tr, en, zh);
    expect(localizeProgressMessage("3. dövüş turu: jüri adayları yeniden puanlıyor.", t)).toContain("第 3 轮竞争");
    expect(localizeProgressMessage("Yazıcı model masanın yorumlarını ortak metne işliyor.", t)).toContain("共同草稿");
    const quote = "<model excerpt> 用户要求 · özgün kullanıcı metni";
    expect(localizeProgressMessage(quote, t)).toBe(quote);
    const progress = { stage: "revision" as const, completed: 1, total: 2, startedAt: "2026-10-07T12:00:00Z", councilMode: "single" as const, message: quote };
    const before = structuredClone(progress);
    const html = render("zh", createElement(CouncilProgressPanel, { progress }));
    expect(html).toContain("AI 工作进度");
    expect(html).toContain("1/2 已完成");
    expect(html).toContain("&lt;model excerpt&gt; 用户要求 · özgün kullanıcı metni");
    expect(progress).toEqual(before);
  });

  it("uses localized connection failure guidance while preserving the selected model and user roles", () => {
    const health = { status: "error" as const, provider: "openai", model: "custom/model", checkedAt: "2026-10-07T12:00:00Z", latencyMs: 1000, message: "AI sağlayıcısı kimlik doğrulamayı reddetti. API ayarlarındaki anahtarı kontrol et.", errorKind: "auth" as const };
    const t = (tr: string, en: string, zh: string) => translate("en", tr, en, zh);
    expect(connectionHealthMessage(health, t)).toContain("rejected authentication");
    const html = render("zh", createElement(EngineConnection, { engine: { mode: "ai", provider: "openai", model: "custom/model" }, loading: false, health, checking: false, disabled: true, onCheck: vi.fn() }));
    expect(html).toContain("拒绝了身份验证");
    expect(html).toContain("custom/model");
    expect(html).toContain('disabled=""');
    expect(health.model).toBe("custom/model");
    const unknown = { ...health, errorKind: undefined, message: "Custom service explanation" };
    expect(connectionHealthMessage(unknown, t)).toBe(unknown.message);
  });
});
