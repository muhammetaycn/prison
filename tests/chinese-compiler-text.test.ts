import { describe, expect, it } from "vitest";
import { toCompileInput } from "@/core/context-engine";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { runRevisionPipeline } from "@/core/pipeline/revise";
import { compilePrompt } from "@/core/prompt-compiler";
import { executionContextDirective } from "@/core/prompt-compiler/execution-context";
import { combineDirectedPrompt } from "@/core/prompt-refiner";
import { LANGUAGES } from "@/models/common";
import { ExecutionContextSchema } from "@/models/options";

const HAN = /\p{Script=Han}/u;
const initial = { trigger: "initial" as const, note: "", llmReview: false };

describe("compiler text written in the prompt's language", () => {
  it("heads an AI direction and its task contract in each language", () => {
    const headings = LANGUAGES.map((language) => combineDirectedPrompt("DIRECTION", "CONTRACT", language).split("\n").filter((line) => line.startsWith("# ")));
    expect(headings).toEqual([
      ["# Task-Specific Direction", "# Authoritative Task Contract"],
      ["# Göreve Özel Yönlendirme", "# Bağlayıcı Görev Sözleşmesi"],
      ["# 任务专属指引", "# 权威任务契约"],
    ]);
    const text = combineDirectedPrompt("DIRECTION", "CONTRACT", "zh");
    expect(text.indexOf("DIRECTION")).toBeLessThan(text.indexOf("CONTRACT"));
  });

  it.each(ExecutionContextSchema.options)("describes the %s environment in Chinese", (context) => {
    const zh = executionContextDirective(context, "zh");
    expect(zh).toMatch(HAN);
    expect(zh).not.toBe(executionContextDirective(context, "en"));
    expect(zh).not.toBe(executionContextDirective(context, "tr"));
  });

  it("labels the owner's latest Chinese instructions in Chinese", async () => {
    const analyzed = await runAnalysisPipeline({ language: "zh", targetAI: "gpt", rawRequest: "创建一份欢迎新用户的说明。" }, null);
    const ready = await runCompilePipeline(analyzed, initial, { provider: null });
    const revised = await runRevisionPipeline(ready, "语气要更正式。", { provider: null });
    const intent = compilePrompt(toCompileInput(revised)).blocks.find((block) => block.id === "USER_INTENT");
    expect(intent?.items).toContain("语气要更正式。");
    expect(intent?.itemsLabel).toBe("用户的最新指示（按时间顺序）：");
    expect(intent?.notes?.join("\n")).toMatch(HAN);
  });
});
