import { describe, expect, it } from "vitest";
import { IntentAnalysisSchema, buildIntentSchema } from "@/models/intent";
import { analyzeIntent } from "@/core/intent-engine";
import { refreshExecutionPlan } from "@/core/intent-engine/planning";
import { analyzeIntentLocally } from "@/core/intent-engine/local/analyzer";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { applyPatch, REVISION_POLICY } from "@/core/prison-engine/patch";
import { taskTypeIds } from "@/core/task-types/registry";
import { AIProviderError } from "@/services/ai/errors";
import { paymentIntent, ScriptedProvider } from "./helpers";

const request = { rawRequest: "Write a Codex prompt that adds payments to my existing project without breaking it", language: "en" as const, targetAI: "auto" as const };

describe("AI analysis planning contract", () => {
  it("requires a complete plan from new provider output while reading older saved intents", async () => {
    const { execution_plan: _plan, ...legacy } = paymentIntent();
    expect(IntentAnalysisSchema.parse(legacy).execution_plan).toBeNull();
    expect(buildIntentSchema(taskTypeIds()).safeParse(legacy).success).toBe(false);
    const provider = new ScriptedProvider().enqueue("prison_intent", legacy, paymentIntent());
    const result = await analyzeIntent(request, provider);
    expect(provider.callsFor("prison_intent")).toHaveLength(2);
    expect(provider.callsFor("prison_intent")[1]?.messages.at(-1)?.content).toContain("execution_plan");
    expect(result.intent.primary_goal).toContain("Add a payment system");
    expect(result.intent.execution_plan?.steps).toHaveLength(3);
    expect(result.intent.execution_plan?.clarifying_questions).toEqual(["Which payment provider should be used?"]);
    expect(result.engine.mode).toBe("ai");
  });

  it.each([
    { label: "blank verification", value: paymentIntent({ execution_plan: { ...paymentIntent().execution_plan!, steps: paymentIntent().execution_plan!.steps.map((step, index) => index === 0 ? { ...step, verification: " " } : step) } }) },
    { label: "duplicated actions", value: paymentIntent({ execution_plan: { ...paymentIntent().execution_plan!, steps: [paymentIntent().execution_plan!.steps[0]!, paymentIntent().execution_plan!.steps[0]!] } }) },
    { label: "missing completion criteria", value: paymentIntent({ success_conditions: [] }) },
    { label: "a prompt-writing wrapper instead of the underlying task", value: paymentIntent({ primary_goal: "Write a Codex prompt that adds payments to the existing project" }) },
  ])("requests one corrective retry for $label", async ({ value }) => {
    const provider = new ScriptedProvider().enqueue("prison_intent", value, paymentIntent());
    const result = await analyzeIntent(request, provider);
    expect(provider.callsFor("prison_intent")).toHaveLength(2);
    expect(result.intent.success_conditions).not.toHaveLength(0);
    expect(result.intent.execution_plan?.steps.every((step) => step.verification.trim())).toBe(true);
  });

  it("keeps the explicitly selected target ahead of an API recommendation", async () => {
    const corrected = paymentIntent({ execution_plan: { ...paymentIntent().execution_plan!, recommended_target: "gpt", target_rationale: "The owner explicitly selected GPT for this payment task." } });
    const provider = new ScriptedProvider().enqueue("prison_intent", paymentIntent(), corrected);
    const result = await analyzeIntent({ ...request, targetAI: "gpt" }, provider);
    expect(provider.callsFor("prison_intent")).toHaveLength(2);
    expect(result.intent.target_ai_mentioned).toBe("codex");
    expect(result.intent.execution_plan?.recommended_target).toBe("gpt");
    expect(result.intent.execution_plan?.target_rationale).toContain("explicitly selected");
  });

  it("keeps missing facts provisional and does not add a JB directive for a product filter", () => {
    const intent = analyzeIntentLocally({ rawRequest: "Mevcut ürün listesine kategori filtresi ekle", language: "tr", targetAI: "auto" });
    expect(intent.implicit_requirements.some((item) => /jb|jailbreak|bypass/i.test(item))).toBe(false);
    expect(intent.known_facts).toEqual([]);
    expect(intent.execution_plan).toBeNull();
  });
});

describe("planning from the revised isolated task", () => {
  it("uses resolved facts and active memory without resetting or mutating the specification", async () => {
    const analysisProvider = new ScriptedProvider().enqueue("prison_intent", paymentIntent());
    const prison = await runAnalysisPipeline(request, analysisProvider);
    const updated = applyPatch(prison, {
      resolvedUnknowns: [{ unknownId: prison.spec.unknowns[0]!.id, fact: "Use Stripe" }],
      add: { disallowedOperations: ["Deploy to production"] },
      memory: [{ directive: "Never deploy payment changes to production", kind: "prohibition" }],
    }, REVISION_POLICY).prison;
    const before = structuredClone(updated);
    const plan = { ...paymentIntent().execution_plan!, clarifying_questions: [], approach: "Implement and verify the chosen Stripe payment integration within the existing architecture." };
    const provider = new ScriptedProvider().enqueue("prison_execution_plan", plan);
    const refreshed = await refreshExecutionPlan(updated, provider, "Use Stripe and keep production deployment forbidden.");
    const call = provider.callsFor("prison_execution_plan")[0]!;
    expect(call.messages[0]?.content).toContain(updated.id);
    expect(call.messages[0]?.content).toContain("Use Stripe");
    expect(call.messages[0]?.content).toContain("Never deploy payment changes to production");
    expect(refreshed.clarifying_questions).toEqual([]);
    expect(refreshed.approach).toContain("Stripe");
    expect(updated).toEqual(before);
  });

  it("propagates provider failure without replacing it with a local plan", async () => {
    const prison = await runAnalysisPipeline(request, null);
    const before = structuredClone(prison);
    const provider = new ScriptedProvider().enqueue("prison_execution_plan", new AIProviderError("auth", "test authorization failure"));
    await expect(refreshExecutionPlan(prison, provider)).rejects.toMatchObject({ kind: "auth" });
    expect(prison).toEqual(before);
    expect(provider.callsFor("prison_execution_plan")).toHaveLength(1);
  });
});
