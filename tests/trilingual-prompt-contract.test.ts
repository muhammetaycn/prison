import { describe, expect, it } from "vitest";
import { toCompileInput } from "@/core/context-engine";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { runRevisionPipeline } from "@/core/pipeline/revise";
import { compilePrompt } from "@/core/prompt-compiler";
import { LanguageSchema } from "@/models/common";
import { PrisonSchema } from "@/models/prison";

const initial = { trigger: "initial" as const, note: "", llmReview: false };
const examples = [
  { language: "tr" as const, rawRequest: "Mevcut projeme giriş sayfası ekle; mimariyi koru; verileri silme; yayına alma.", feature: "giriş sayfası" },
  { language: "en" as const, rawRequest: "Add a login page to the existing project; preserve the existing architecture; no data loss; do not publish.", feature: "login page" },
  { language: "zh" as const, rawRequest: "给现有项目添加登录页面；保留现有架构；不要删除数据；不要发布。", feature: "登录页面" },
];

describe("TR / EN / Chinese prompt contracts", () => {
  it.each(examples)("preserves the owner request and its basic execution limits in $language", async ({ language, rawRequest, feature }) => {
    expect(LanguageSchema.parse(language)).toBe(language);
    const analyzed = await runAnalysisPipeline({ language, rawRequest, targetAI: "codex" }, null);
    expect(analyzed.rawRequest).toBe(rawRequest);
    expect(analyzed.spec.primaryGoal).toContain(feature);
    expect(analyzed.spec.flags.existingSystem).toBe(true);
    expect(analyzed.spec.flags.preserveArchitecture).toBe(true);
    expect(analyzed.spec.deploymentPermission).toBe("forbidden");
    expect(analyzed.spec.flags.deploymentRequired).toBe(false);
    expect(analyzed.spec.protectedElements.length).toBeGreaterThan(0);
    expect(analyzed.spec.disallowedOperations.length).toBeGreaterThan(0);
    const result = await runCompilePipeline(analyzed, initial, { provider: null });
    const version = result.promptVersions.at(-1)!;
    expect(result.status).toBe("READY");
    expect(result.language).toBe(language);
    expect(version.text).toContain(rawRequest);
    expect(version.specSnapshot.deploymentPermission).toBe("forbidden");
    expect(version.resolvedTarget).toBe("codex");
    expect(version.councilReview).toBeNull();
    expect(PrisonSchema.parse(JSON.parse(JSON.stringify(result))).rawRequest).toBe(rawRequest);
  });

  it("understands a Chinese advice-only request with no whitespace, without granting execution", async () => {
    const rawRequest = "只分析现有代码，不要修改代码，不发布。";
    const prison = await runAnalysisPipeline({ language: "zh", targetAI: "claude", rawRequest }, null);
    expect(prison.spec.flags.adviceOnly).toBe(true);
    expect(prison.spec.flags.analysisRequired).toBe(true);
    expect(prison.spec.flags.executionRequired).toBe(false);
    expect(prison.spec.flags.codingRequired).toBe(false);
    expect(prison.spec.deploymentPermission).toBe("forbidden");
    const compiled = compilePrompt(toCompileInput(prison));
    expect(compiled.text).toContain(rawRequest);
    expect(compiled.blocks.find((block) => block.id === "DO_NOT_DO")?.items?.length).toBeGreaterThan(0);
  });

  it("keeps generated Chinese contract instructions in Chinese instead of falling back to English", async () => {
    const prison = await runAnalysisPipeline({ language: "zh", targetAI: "gpt", rawRequest: "给现有项目添加登录页面，保留现有架构，不要发布。" }, null);
    const compiled = compilePrompt({ ...toCompileInput(prison), options: { ...prison.compileOptions, verbosity: "detailed" } });
    for (const id of ["ROLE", "EXECUTION_PROTOCOL", "OUTPUT_CONTRACT", "DO_NOT_DO"] as const) {
      const block = compiled.blocks.find((candidate) => candidate.id === id);
      expect(block, `${id} must be present for this Chinese coding task`).toBeDefined();
      const instructions = [block?.intro, block?.text, block?.itemsLabel, ...(block?.items ?? []), ...(block?.notes ?? [])].filter(Boolean).join("\n");
      expect(instructions).toMatch(/\p{Script=Han}/u);
      expect(instructions).not.toMatch(/You are |Do not deploy|Expected output|İstenen çıktı|Yapılacak/);
    }
    expect(compiled.text).not.toMatch(/\bundefined\b|\[object Object\]/);
  });

  it("treats a Chinese publish prohibition in a revision as a permission change, rather than a positive requirement", async () => {
    const analyzed = await runAnalysisPipeline({ language: "zh", targetAI: "gpt", rawRequest: "创建一份欢迎新用户的说明。" }, null);
    const ready = await runCompilePipeline(analyzed, initial, { provider: null });
    const revised = await runRevisionPipeline(ready, "不要发布。", { provider: null });
    expect(revised.spec.deploymentPermission).toBe("forbidden");
    expect(revised.taskMemory.some((entry) => entry.active && entry.kind === "prohibition" && entry.directive.includes("不要发布"))).toBe(true);
    expect(revised.promptVersions.at(-1)!.text).toContain("不要发布。");
    expect(revised.promptVersions.at(-1)!.specSnapshot.deploymentPermission).toBe("forbidden");
    expect(ready.spec.deploymentPermission).toBe("unspecified");
  });

  it("honors Chinese architecture preservation when the owner revises the task", async () => {
    const analyzed = await runAnalysisPipeline({ language: "zh", targetAI: "codex", rawRequest: "修改现有项目的登录页面。" }, null);
    const ready = await runCompilePipeline(analyzed, initial, { provider: null });
    const revised = await runRevisionPipeline(ready, "保留现有架构。", { provider: null });
    expect(revised.spec.flags.preserveArchitecture).toBe(true);
    expect(revised.taskMemory.some((entry) => entry.active && entry.kind === "protection" && entry.directive.includes("保留现有架构"))).toBe(true);
    expect(revised.spec.protectedElements.length).toBeGreaterThan(0);
    expect(revised.promptVersions.at(-1)!.text).toContain("保留现有架构。");
    expect(revised.compileOptions.councilMode).toBe("single");
  });
});
