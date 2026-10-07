import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import type { ResolvedPrison } from "@/models/prison";
import { I18nProvider } from "@/ui/i18n";
import { Composer } from "@/ui/composer/Composer";
import { PrisonView } from "@/ui/prison-view/PrisonView";
import { PromptOutput } from "@/ui/prompt-output/PromptOutput";

const originalRequest = "Write a weekly plan to learn airplane modeling. 保留我的原始目标。";
const promptText = "Exact saved prompt:\n飞机 kanat geometry\nPreserve this mixed-language text.";
const noop = () => undefined;
const revise = async () => true;
let analyzed: ResolvedPrison;
let compiled: ResolvedPrison;

beforeAll(async () => {
  analyzed = await runAnalysisPipeline({ rawRequest: originalRequest, targetAI: "gpt", language: "en" }, null);
  compiled = await runCompilePipeline(analyzed, { trigger: "initial", note: "", llmReview: false }, { provider: null });
  // Explicit mixed-language fixtures verify that presentation never rewrites the saved prompt.
  compiled.promptVersions[0].text = promptText;
});

describe("composer and prompt presentation locales", () => {
  it.each([
    ["en", "Analyze request", "Prompt language", "Example requests", "Quick mode uses one model."],
    ["zh", "分析需求", "提示词语言", "需求示例", "快速模式使用一个模型。"],
  ] as const)("localizes the %s composer while keeping prompt language an independent selection", (locale, submit, language, examples, single) => {
    const onSubmit = vi.fn(async () => true);
    const html = renderToStaticMarkup(createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(Composer, {
        engine: { mode: "ai", provider: "nvidia", model: "fixture/analysis-model" },
        council: { enabled: true, models: [1, 2, 3].map(id => ({ id: String(id), provider: "nvidia", model: `fixture/model-${id}`, role: "Fixture role" })) },
        busy: false, onSubmit,
      }),
    }));
    expect(html).toContain(submit);
    expect(html).toContain(`aria-label="${language}"`);
    expect(html).toContain(`aria-label="${examples}"`);
    expect(html).toContain(single);
    expect(html).toContain("fixture/analysis-model");
    const languageGroup = html.split(`aria-label="${language}"`)[1].split("</div>")[0];
    expect(languageGroup).toMatch(/role="radio" aria-checked="true"[^>]*>TR<\/button>/);
    expect(languageGroup).toContain("中文");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(html).not.toContain("İsteğini anlat.");
  });

  it.each([
    ["en", "Original request", "Generate prompt", "Next step"],
    ["zh", "原始需求", "生成提示词", "下一步"],
  ] as const)("shows the next step in %s without translating the recorded request or title", (locale, originalLabel, generate, next) => {
    const html = renderToStaticMarkup(createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(PrisonView, {
        prison: analyzed, busy: null, viewVersion: null, councilEnabled: false,
        onViewVersion: noop, onCompile: noop, onModify: noop, onRetarget: noop, onRevise: revise, onClarify: revise, onRestore: noop,
      }),
    }));
    expect(html).toContain(originalLabel);
    expect(html).toContain(generate);
    expect(html).toContain(next);
    expect(html).toContain(originalRequest);
    expect(html).toContain(analyzed.title);
    expect(html).not.toContain("Orijinal istek");
  });

  it.each([
    ["en", "Generated prompt", "Prompt versions", "Rule checks", "Regenerate prompt"],
    ["zh", "生成的提示词", "提示词版本", "规则检查", "重新生成提示词"],
  ] as const)("localizes %s output controls without altering saved content or inventing AI review", (locale, output, versions, rules, regenerate) => {
    const onModify = vi.fn();
    const html = renderToStaticMarkup(createElement(I18nProvider, {
      initialLocale: locale,
      children: createElement(PromptOutput, {
        prison: compiled, viewVersion: null, busy: false, onViewVersion: noop, onModify, onRetarget: noop,
        onExecutionContext: noop, onCouncilMode: noop, onRegenerate: noop, onRestore: noop,
      }),
    }));
    expect(html).toContain(`aria-label="${output}"`);
    expect(html).toContain(`aria-label="${versions}"`);
    expect(html).toContain(rules);
    expect(html).toContain(regenerate);
    expect(html).toContain(promptText);
    expect(html).not.toContain("Rule checks + AI critic");
    expect(html).not.toContain("规则检查 + AI 评审");
    expect(html).not.toContain("Üretim ve kontrol bilgisi");
    expect(onModify).not.toHaveBeenCalled();
    expect(compiled.language).toBe("en");
    expect(compiled.promptVersions[0].text).toBe(promptText);
  });
});
