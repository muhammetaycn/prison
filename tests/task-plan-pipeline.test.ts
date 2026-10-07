import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PrisonSchema } from "@/models/prison";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { runAdjustmentPipeline } from "@/core/pipeline/revise";
import { compilePrompt } from "@/core/prompt-compiler";
import { toCompileInput } from "@/core/context-engine";
import { applyPatch, REVISION_POLICY } from "@/core/prison-engine/patch";
import { resolveTarget } from "@/adapters/registry";
import { resolveTaskProfile } from "@/core/task-types/registry";
import { AIProviderError } from "@/services/ai/errors";
import { PrisonService } from "@/services/prison-service";
import { FilePrisonRepository } from "@/services/storage/file-repository";
import { ScriptedProvider, paymentIntent } from "./helpers";

async function plannedTask() {
  const provider = new ScriptedProvider().enqueue("prison_intent", paymentIntent());
  return runAnalysisPipeline({ rawRequest: "Add a payment system without changing the existing architecture", language: "en", targetAI: "auto" }, provider);
}

describe("task plan integration", () => {
  it("keeps an explicit schedule deliverable in detailed mode without adding lesson artifacts", async () => {
    const task = await runAnalysisPipeline({ rawRequest: "Haftalık çalışma planı hazırla", language: "tr", targetAI: "gpt" }, null);
    task.spec.taskType = "education";
    task.spec.expectedOutput = { format: "tablo", description: "Haftalık çalışma programı", deliverables: ["Dinlenmeleri içeren haftalık çalışma tablosu"] };
    const compiled = compilePrompt({ ...toCompileInput(task), options: { ...task.compileOptions, verbosity: "detailed" } });
    const output = compiled.blocks.find((block) => block.id === "OUTPUT_CONTRACT");
    expect(output?.items).toEqual(["Format: tablo", "Dinlenmeleri içeren haftalık çalışma tablosu"]);
    expect(output?.notes?.join(" ")).toContain("yalnızca tablo, JSON veya kod istenmesi");
    expect(compiled.blocks.find((block) => block.id === "EXECUTION_PROTOCOL")?.items?.join(" ")).not.toContain("Her önemli karar için neden");
  });

  it("carries the actual plan, its verification and unanswered decisions into concise and standard prompts", async () => {
    const task = await plannedTask();
    expect(task.spec.taskPlan?.approach).toBe(task.intent.execution_plan?.approach);
    for (const verbosity of ["standard", "concise"] as const) {
      const compiled = compilePrompt({ ...toCompileInput(task), options: { ...task.compileOptions, verbosity } });
      const step = task.spec.taskPlan!.steps[0]!;
      expect(compiled.text).toContain(step.action);
      expect(compiled.text).toContain(step.purpose);
      expect(compiled.text).toContain(step.verification);
      expect(compiled.text).toContain(task.spec.taskPlan!.clarifyingQuestions[0]);
      expect(compiled.text).toContain("Add a payment system");
    }
  });

  it("preserves explicit selection and named target over plan recommendations", async () => {
    const task = await plannedTask();
    task.spec.taskPlan!.recommendedTarget = "gemini";
    const profile = resolveTaskProfile(task.spec.taskType);
    expect(resolveTarget("gpt", task.spec, profile)).toEqual({ target: "gpt", reason: "user_selected" });
    expect(resolveTarget("auto", task.spec, profile)).toEqual({ target: "codex", reason: "request_mentioned" });
  });

  it("uses the analysed recommendation for AUTO when no selected or named workflow overrides it", async () => {
    const task = await plannedTask();
    const spec = { ...task.spec, requestedTarget: null, taskPlan: { ...task.spec.taskPlan!, recommendedTarget: "claude" as const } };
    expect(resolveTarget("auto", spec, resolveTaskProfile(spec.taskType))).toEqual({ target: "claude", reason: "ai_recommendation" });
  });

  it("keeps the plan aligned when the owner changes target and restores AUTO routing", async () => {
    const task = await plannedTask();
    const ready = await runCompilePipeline(task, { trigger: "initial", note: "", llmReview: false }, { provider: null });
    const selected = await runAdjustmentPipeline(ready, { kind: "target", target: "claude" }, { provider: null });
    expect(selected.spec.taskPlan?.recommendedTarget).toBe("claude");
    expect(selected.spec.taskPlan?.targetRationale).toContain("selected Claude");
    expect(selected.promptVersions.at(-1)?.resolvedTarget).toBe("claude");
    const automatic = await runAdjustmentPipeline(selected, { kind: "target", target: "auto" }, { provider: null });
    expect(automatic.spec.taskPlan?.recommendedTarget).toBe("codex");
    expect(automatic.promptVersions.at(-1)?.resolvedTarget).toBe("codex");
    expect(automatic.spec.primaryGoal).toBe(task.spec.primaryGoal);
  });

  it("loads older task records without fabricating a saved plan", async () => {
    const task = await plannedTask();
    const legacy = JSON.parse(JSON.stringify(task));
    delete legacy.intent.execution_plan;
    delete legacy.spec.taskPlan;
    const loaded = PrisonSchema.parse(legacy);
    expect(loaded.intent?.execution_plan).toBeNull();
    expect(loaded.spec?.taskPlan).toBeNull();
    expect(loaded.rawRequest).toBe(task.rawRequest);
  });

  it("preserves the owner's literal updated instructions in the prompt even in concise mode", async () => {
    const task = await plannedTask();
    task.revisions.push({ id: "rev_exact", createdAt: task.createdAt, message: "Never deploy; run the payment checks in staging only.", summary: "Checks clarified.", changes: [], resultVersion: null, engine: "ai" });
    const input = toCompileInput(task);
    const compiled = compilePrompt({ ...input, options: { ...input.options, verbosity: "concise" } });
    expect(compiled.text).toContain("Never deploy; run the payment checks in staging only.");
    expect(compiled.text).toContain("take precedence over inferred summaries");
    expect(compiled.blocks.some((block) => block.id === "USER_INTENT")).toBe(true);
  });

  it("counts a real change to execution conditions instead of silently dropping it", async () => {
    const task = await plannedTask();
    const changed = applyPatch(task, { set: { flags: { adviceOnly: true } } }, REVISION_POLICY);
    expect(changed.changes).not.toHaveLength(0);
    expect(changed.prison.spec.flags.adviceOnly).toBe(true);
    const same = applyPatch(changed.prison, { set: { flags: { adviceOnly: true } } }, REVISION_POLICY);
    expect(same.changes).toHaveLength(0);
  });

  it("retains the saved task when planning a substantive revision fails before first generation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "prison-plan-atomic-"));
    try {
      const repo = new FilePrisonRepository(dir);
      const task = await plannedTask();
      await repo.save(task);
      const file = path.join(dir, `${task.id}.json`);
      const before = await readFile(file, "utf8");
      const provider = new ScriptedProvider().enqueue("prison_revision", {
        summary: "Webhook verification added.",
        set: {},
        add: { requirements: ["Verify webhook signatures"] },
      }).enqueue("prison_execution_plan", new AIProviderError("network", "test outage"));
      const service = new PrisonService(repo, provider);
      await expect(service.revise(task.id, "Verify webhook signatures")).rejects.toMatchObject({ code: "ai_error" });
      expect(await readFile(file, "utf8")).toBe(before);
      expect((await service.get(task.id)).promptVersions).toHaveLength(0);
      expect(provider.callsFor("prison_prompt_refinement")).toHaveLength(0);
    } finally {
      if (path.dirname(path.resolve(dir)) !== path.resolve(tmpdir())) throw new Error("Unexpected test directory");
      await rm(dir, { recursive: true, force: true });
    }
  });
});
