import { describe, expect, it } from "vitest";
import { analyzeIntentLocally } from "@/core/intent-engine/local/analyzer";
import { extractGoal, splitClauses } from "@/core/intent-engine/local/goal";
import { refreshExecutionPlan } from "@/core/intent-engine/planning";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";

describe("Chinese understanding in the honest local fallback", () => {
  it("keeps Han clauses without splitting Western filenames, URLs or version numbers", () => {
    const text = "修改src/routes/v1.2.ts，保留https://example.com/v1.2；不要发布。";
    const clauses = splitClauses(text);
    expect(clauses).toEqual(["修改src/routes/v1.2.ts", "保留https://example.com/v1.2", "不要发布"]);
    expect(extractGoal(text).clauses).toEqual(clauses);
    expect(splitClauses("Update src/routes/v1.2.ts for https://example.com/v1.2")).toHaveLength(1);
  });

  it("removes Chinese prompt wrappers without deleting a prompt-tool development task", () => {
    expect(extractGoal("请帮我生成一个提示词，用来修改现有项目的登录页面。").goal).toContain("修改现有项目的登录页面");
    expect(extractGoal("请为现有项目添加登录页面生成一个提示词。").goal).toBe("现有项目添加登录页面.");
    expect(extractGoal("创建提示词生成器。").goal).toBe("创建提示词生成器。");
  });

  it("understands Chinese input independently of the selected output language and asks domain-specific questions", () => {
    const rawRequest = "给现有项目添加登录页面；保留现有架构；不要删除数据；禁止发布。";
    const intent = analyzeIntentLocally({ rawRequest, language: "en", targetAI: "auto" });
    expect(intent.task_type).toBe("coding");
    expect(intent.existing_system).toBe(true);
    expect(intent.preserve_architecture).toBe(true);
    expect(intent.deployment_permission).toBe("forbidden");
    expect(intent.domain).toBe("authentication");
    expect(intent.unknowns.some((question) => question.includes("Authentication method"))).toBe(true);
    expect(intent.protected_elements).toContain("Existing data (no data loss)");
    expect(intent.disallowed_operations).toContain("不要删除数据");
    expect(intent.explicit_requirements).toContain("给现有项目添加登录页面");
  });

  it.each(["禁止发布。", "不发布。", "请勿部署。", "不得上线。"])("keeps %s as a negative permission, never a release requirement", (rawRequest) => {
    const intent = analyzeIntentLocally({ rawRequest, language: "zh", targetAI: "auto" });
    expect(intent.deployment_permission).toBe("forbidden");
    expect(intent.deployment_required).toBe(false);
  });

  it.each([
    ["绘制一张太空探索海报。", "image_generation", true],
    ["剪辑一段关于飞行的视频。", "video_generation", true],
    ["创建定时任务自动化工作流。", "automation", false],
  ] as const)("routes %s to %s", (rawRequest, expected, visual) => {
    const intent = analyzeIntentLocally({ rawRequest, language: "zh", targetAI: "auto" });
    expect(intent.task_type).toBe(expected);
    expect(intent.visual_generation_required).toBe(visual);
  });

  it("writes Chinese local plans and questions without granting execution to an advice request", async () => {
    const prison = await runAnalysisPipeline({ rawRequest: "只分析现有登录代码，不要修改代码，不发布。", language: "zh", targetAI: "claude" }, null);
    expect(prison.engine.mode).toBe("local");
    expect(prison.spec.flags.executionRequired).toBe(false);
    const plan = await refreshExecutionPlan(prison, null);
    expect(plan.approach).toMatch(/\p{Script=Han}/u);
    expect(plan.target_rationale).toContain("保留用户选择的 claude");
    expect(plan.steps.every((step) => /\p{Script=Han}/u.test(step.purpose))).toBe(true);
    expect(plan.clarifying_questions.every((question) => question.startsWith("请明确："))).toBe(true);
    expect(plan.clarifying_questions.length).toBeGreaterThan(0);
    expect(plan.steps.some((step) => /Do not|Follow the stated|Advance the requested/u.test(`${step.action} ${step.purpose} ${step.verification}`))).toBe(false);
  });
});
