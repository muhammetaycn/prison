import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateStructured, parseJsonLoose } from "@/services/ai/structured";
import { AIProviderError, kindFromStatus } from "@/services/ai/errors";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import type { ResolvedPrison } from "@/models/prison";
import { CLEAN_CRITIC, paymentIntent, ScriptedProvider } from "./helpers";

const Schema = z.object({ answer: z.string(), count: z.number() });
const REFINEMENT = {
  prompt: "Inspect the current project before choosing an implementation. Add the requested payment flow inside its existing architecture and verify success, failure, and webhook behavior before reporting the deliverables.",
  strategies_used: ["Task-Specific-Workflow"],
};
const emptyFix = (): { add: Record<"requirements" | "constraints" | "protected_elements" | "disallowed_operations" | "success_criteria" | "assumptions" | "unknowns", string[]>; remove_item_ids: string[] } => ({
  add: { requirements: [], constraints: [], protected_elements: [], disallowed_operations: [], success_criteria: [], assumptions: [], unknowns: [] },
  remove_item_ids: [] as string[],
});
const highReview = (message: string) => ({
  ...CLEAN_CRITIC,
  issues: [{ dimension: "intent_alignment", severity: "high", message, fix: null }],
});

describe("structured generation (parse + validate + bounded retry)", () => {
  it("parses JSON wrapped in fences or prose", () => {
    expect(parseJsonLoose('~~~json\n{"a":1}\n~~~'.replaceAll("~~~", "```"))).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonLoose('Here you go: {"a":2} thanks')).toEqual({ ok: true, value: { a: 2 } });
    expect(parseJsonLoose("nope").ok).toBe(false);
  });

  it("preserves raw arrays and thinking tags inside JSON strings", () => {
    expect(parseJsonLoose('[{"a":1}]')).toEqual({ ok: true, value: [{ a: 1 }] });
    expect(parseJsonLoose('{"answer":"<think>literal</think>"}')).toEqual({ ok: true, value: { answer: "<think>literal</think>" } });
    expect(parseJsonLoose('~~~json\n{"answer":"<think>literal</think>"}\n~~~'.replaceAll("~~~", "```"))).toEqual({ ok: true, value: { answer: "<think>literal</think>" } });
    expect(parseJsonLoose('<think>an unrelated { draft }</think>\n{"a":2}')).toEqual({ ok: true, value: { a: 2 } });
    expect(parseJsonLoose('{"a":"unfinished"').ok).toBe(false);
  });

  it("retries truncation with a larger bounded token budget", async () => {
    const provider = new ScriptedProvider().enqueue("t", new AIProviderError("truncated", "limit"), { answer: "ok", count: 2 });
    const result = await generateStructured(provider, { system: "s", user: "u", schema: Schema, schemaName: "t", effort: "low", maxTokens: 1000 });
    expect(result.answer).toBe("ok");
    expect(provider.calls.map((call) => call.maxTokens)).toEqual([1000, 2000]);
    expect(provider.calls).toHaveLength(2);
  });

  it("does not retry refusals", async () => {
    const provider = new ScriptedProvider().enqueue("t", new AIProviderError("refusal", "declined"));
    await expect(generateStructured(provider, { system: "s", user: "u", schema: Schema, schemaName: "t", effort: "low" })).rejects.toMatchObject({ kind: "refusal" });
    expect(provider.calls).toHaveLength(1);
  });

  it("retries once with validation errors and then succeeds", async () => {
    const provider = new ScriptedProvider().enqueue("t", '{"answer": 1}', { answer: "ok", count: 2 });
    const result = await generateStructured(provider, { system: "s", user: "u", schema: Schema, schemaName: "t", effort: "low" });
    expect(result).toEqual({ answer: "ok", count: 2 });
    expect(provider.calls).toHaveLength(2);
    const retry = provider.calls[1]!.messages;
    expect(retry.at(-1)?.content).toContain("did not pass validation");
    expect(retry.at(-2)?.role).toBe("assistant");
  });

  it("gives up after the bounded number of attempts", async () => {
    const provider = new ScriptedProvider().enqueue("t", "garbage", "still garbage", "never used");
    await expect(generateStructured(provider, { system: "s", user: "u", schema: Schema, schemaName: "t", effort: "low" })).rejects.toMatchObject({ kind: "invalid_output" });
    expect(provider.calls).toHaveLength(2);
  });

  it("applies semantic checks", async () => {
    const provider = new ScriptedProvider().enqueue("t", { answer: "", count: 1 }, { answer: "fine", count: 1 });
    const result = await generateStructured(provider, { system: "s", user: "u", schema: Schema, schemaName: "t", effort: "low", check: (v) => (v.answer ? null : "answer must not be empty") });
    expect(result.answer).toBe("fine");
  });

  it("does not retry provider errors (the SDK already does)", async () => {
    const provider = new ScriptedProvider().enqueue("t", new AIProviderError("auth", "bad key"));
    await expect(generateStructured(provider, { system: "s", user: "u", schema: Schema, schemaName: "t", effort: "low" })).rejects.toMatchObject({ kind: "auth" });
    expect(provider.calls).toHaveLength(1);
  });

  it("maps HTTP statuses to error kinds with Turkish user messages", () => {
    expect(kindFromStatus(401)).toBe("auth");
    expect(kindFromStatus(429)).toBe("rate_limit");
    expect(kindFromStatus(408)).toBe("timeout");
    expect(kindFromStatus(529)).toBe("unavailable");
    expect(kindFromStatus(undefined)).toBe("network");
    expect(new AIProviderError("rate_limit", "x").message).toMatch(/hız sınırı/);
  });
});

async function analyzedWithAI(provider: ScriptedProvider, overrides = {}, rawRequest = "Codex'e ödeme sistemi ekletecek prompt üret"): Promise<ResolvedPrison> {
  provider.enqueue("prison_intent", paymentIntent(overrides));
  return runAnalysisPipeline({ rawRequest, language: "en", targetAI: "auto" }, provider);
}

describe("API generation and final semantic review", () => {
  it("writes task-specific AI text, retains the contract, and reviews the exact accepted version", async () => {
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", REFINEMENT).enqueue("prison_critic", CLEAN_CRITIC);
    const prison = await analyzedWithAI(provider);
    expect(prison.status).toBe("READY_FOR_COMPILE");
    const compiled = await runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: true }, { provider });
    const version = compiled.promptVersions[0]!;
    expect(compiled.status).toBe("READY");
    expect(compiled.history.slice(-3).map((h) => h.to)).toEqual(["PROMPT_COMPILED", "PROMPT_VALIDATED", "READY"]);
    expect(version.generation).toMatchObject({ source: "ai", provider: "scripted", model: "test-model" });
    expect(version.text).toContain(REFINEMENT.prompt);
    expect(version.text).toContain("Add a payment system");
    expect(version.critic.llmReviewed).toBe(true);
    expect(provider.callsFor("prison_critic")[0]!.messages[0]!.content).toContain(version.text);
  });

  it("repairs a failed semantic review once and rechecks the exact repaired text", async () => {
    const fix = emptyFix();
    fix.add.requirements = ["Verify payment provider webhooks with their signature"];
    const failed = { ...CLEAN_CRITIC, scores: { ...CLEAN_CRITIC.scores, output_clarity: 0.6 },
      issues: [{ dimension: "output_clarity", severity: "medium", message: "Webhook verification is missing.", fix }] };
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", REFINEMENT, REFINEMENT)
      .enqueue("prison_critic", failed, CLEAN_CRITIC)
      .enqueue("prison_execution_plan", { ...paymentIntent().execution_plan!, steps: [
        ...paymentIntent().execution_plan!.steps,
        { action: "Verify payment provider webhooks with their signature", purpose: "Reject unauthenticated events", verification: "Invalid signatures are rejected" },
      ] });
    const prison = await analyzedWithAI(provider);
    const compiled = await runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: true }, { provider });
    const version = compiled.promptVersions[0]!;
    expect(version.critic.refined).toBe(true);
    expect(version.critic.compilePasses).toBe(2);
    expect(version.text).toContain("Verify payment provider webhooks with their signature");
    expect(compiled.spec.requirements.find((r) => r.text.startsWith("Verify payment"))?.source).toBe("critic");
    expect(provider.callsFor("prison_critic")).toHaveLength(2);
    expect(provider.callsFor("prison_prompt_refinement")[1]!.messages[0]!.content).toContain("Webhook verification is missing.");
    expect(version.critic.issues.find((issue) => issue.message.includes("Webhook"))?.fixed).toBe(true);
  });

  it("never removes user requirements in a repair", async () => {
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", REFINEMENT, REFINEMENT);
    const ownerRequirement = "Add a payment system without changing the existing architecture";
    const prison = await analyzedWithAI(provider, { explicit_requirements: [ownerRequirement] }, ownerRequirement);
    const explicit = prison.spec.requirements.find((r) => r.source === "explicit")!;
    expect(explicit.text).toBe(ownerRequirement);
    expect(prison.rawRequest).toBe(ownerRequirement);
    const implicit = prison.spec.constraints[0]!;
    const original = structuredClone(prison);
    const fix = emptyFix();
    fix.remove_item_ids = [explicit.id, implicit.id];
    provider.enqueue("prison_critic", { ...CLEAN_CRITIC,
      issues: [{ dimension: "constraint_clarity", severity: "high", message: "Remove these conditions.", fix }] }, CLEAN_CRITIC)
      .enqueue("prison_execution_plan", paymentIntent().execution_plan!);
    const compiled = await runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: true }, { provider });
    expect(compiled.spec.requirements.some((r) => r.id === explicit.id)).toBe(true);
    expect(compiled.spec.constraints.some((r) => r.id === implicit.id)).toBe(true);
    expect(compiled.promptVersions[0]!.text).toContain(explicit.text);
    expect(compiled.promptVersions[0]!.text).toContain(implicit.text);
    expect(provider.callsFor("prison_execution_plan")).toHaveLength(1);
    const planCall = provider.callsFor("prison_execution_plan")[0]!;
    expect(planCall.messages[0]!.content).toContain(ownerRequirement);
    expect(planCall.messages[0]!.content).toContain("rejected_state_fixes");
    expect(planCall.messages[0]!.content).toContain(explicit.text);
    expect(planCall.messages[0]!.content).toContain(implicit.text);
    expect(compiled.spec.taskPlan).toEqual(original.spec.taskPlan);
    expect(provider.callsFor("prison_critic")[1]!.messages[0]!.content).toContain(compiled.promptVersions[0]!.text);
    expect(prison).toEqual(original);
  });

  it("does not save an unreviewed prompt when the configured critic fails", async () => {
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", REFINEMENT)
      .enqueue("prison_critic", new AIProviderError("unavailable", "overloaded"));
    const prison = await analyzedWithAI(provider);
    await expect(runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: true }, { provider })).rejects.toMatchObject({ kind: "unavailable" });
    expect(prison.promptVersions).toHaveLength(0);
    expect(prison.status).toBe("READY_FOR_COMPILE");
  });

  it("rejects repeated high findings after one repair without an endless retry", async () => {
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", REFINEMENT, REFINEMENT)
      .enqueue("prison_critic", highReview("The goal is inverted."), highReview("The goal is inverted."))
      .enqueue("prison_execution_plan", paymentIntent().execution_plan!);
    const prison = await analyzedWithAI(provider);
    const original = structuredClone(prison);
    await expect(runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: true }, { provider })).rejects.toMatchObject({ code: "validation_error", status: 422 });
    expect(provider.callsFor("prison_prompt_refinement")).toHaveLength(2);
    expect(provider.callsFor("prison_critic")).toHaveLength(2);
    expect(provider.callsFor("prison_execution_plan")).toHaveLength(1);
    expect(provider.calls.map((call) => call.schemaName)).toEqual([
      "prison_intent", "prison_prompt_refinement", "prison_critic", "prison_execution_plan", "prison_prompt_refinement", "prison_critic",
    ]);
    expect(provider.callsFor("prison_execution_plan")[0]!.messages[0]!.content).toContain("The goal is inverted.");
    expect(prison.promptVersions).toHaveLength(0);
    expect(prison).toEqual(original);
  });

  it("also reviews packaging changes instead of claiming old review applies to new AI text", async () => {
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", REFINEMENT).enqueue("prison_critic", CLEAN_CRITIC);
    const prison = await analyzedWithAI(provider);
    const compiled = await runCompilePipeline(prison, { trigger: "modifier", note: "shorter", llmReview: false }, { provider });
    expect(compiled.promptVersions[0]!.critic.llmReviewed).toBe(true);
    expect(provider.callsFor("prison_critic")).toHaveLength(1);
  });

  it("rule critic fixes missing success criteria and protections in local mode", async () => {
    const provider = new ScriptedProvider();
    const prison = await analyzedWithAI(provider);
    const stripped: ResolvedPrison = { ...prison, spec: { ...prison.spec, successCriteria: [], protectedElements: [] } };
    const compiled = await runCompilePipeline(stripped, { trigger: "initial", note: "", llmReview: false }, { provider: null });
    expect(compiled.spec.successCriteria.length).toBeGreaterThan(0);
    expect(compiled.spec.protectedElements.length).toBeGreaterThan(0);
    expect(compiled.promptVersions[0]!.critic.issues.filter((issue) => issue.fixed).length).toBeGreaterThanOrEqual(2);
    expect(compiled.promptVersions[0]!.critic.llmReviewed).toBe(false);
  });
});

