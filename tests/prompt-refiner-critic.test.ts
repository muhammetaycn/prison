import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { toCompileInput } from "@/core/context-engine";
import { compilePrompt } from "@/core/prompt-compiler";
import { generateRefinedPrompt } from "@/core/prompt-refiner";
import { CriticOutputSchema, runLlmCritic, MIN_REVIEW_SCORE } from "@/core/prompt-critic/llm";
import { mergeFixes } from "@/core/prompt-critic";
import { applyPatch, CRITIC_POLICY } from "@/core/prison-engine/patch";
import { generateJailbreakPrompt } from "@/core/jailbreak-engine";
import { AIProviderError } from "@/services/ai/errors";
import type { ResolvedPrison } from "@/models/prison";
import { CLEAN_CRITIC, ScriptedProvider } from "./helpers";

const DIRECTIVE = "Review the current payment flow and locate the extension points before implementing the requested payment behavior. Verify signed webhooks, failed payments and existing user flows. Explain the code changes and the verification results in the requested deliverable.";
const REFINEMENT = { prompt: DIRECTIVE, strategies_used: ["Task-Specific-Workflow", "Verification-Plan"] };

async function task(): Promise<ResolvedPrison> {
  const prison = await runAnalysisPipeline({ rawRequest: "Codex'e mevcut projeme ödeme ekletecek prompt üret. Veritabanı şemasını koru, deploy yapma.", language: "en", targetAI: "codex" }, null);
  return {
    ...prison,
    spec: {
      ...prison.spec,
      requirements: [...prison.spec.requirements, { id: "req_explicit", text: "Verify payment webhook signatures", source: "explicit" }],
      constraints: [...prison.spec.constraints, { id: "con_memory", text: "Preserve the existing transaction database", source: "implicit" }],
      assumptions: [{ id: "ass_test", text: "Confirm the installed payment SDK by inspecting the repository", source: "implicit" }],
      unknowns: [{ id: "unk_test", text: "Which payment provider is configured", source: "implicit" }],
    },
    taskMemory: [{ id: "mem_test", createdAt: new Date().toISOString(), directive: "Preserve the existing transaction database", kind: "constraint", itemRefs: ["con_memory"], active: true }],
    compileOptions: { ...prison.compileOptions, verbosity: "concise", technicality: "technical", agentMode: true },
  };
}

const emptyAdd = { requirements: [], constraints: [], protected_elements: [], disallowed_operations: [], success_criteria: [], assumptions: [], unknowns: [] };

describe("AI prompt refinement", () => {
  it("uses one isolated task's complete request, settings, unknowns and durable constraints", async () => {
    const prison = await task();
    const compiled = compilePrompt(toCompileInput(prison));
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", REFINEMENT);
    const result = await generateRefinedPrompt({ provider, prison, compiled });
    expect(result).toEqual({ prompt: DIRECTIVE, strategies: REFINEMENT.strategies_used });
    const call = provider.calls[0]!;
    const sent = call.messages.map((message) => message.content).join("\n");
    expect(sent).toContain(prison.rawRequest);
    expect(sent).toContain("Verify payment webhook signatures");
    expect(sent).toContain("Preserve the existing transaction database");
    expect(sent).toContain("Which payment provider is configured");
    expect(sent).toContain("Confirm the installed payment SDK");
    expect(sent).toContain("concise");
    expect(sent).toContain("technical");
    expect(sent).toContain('"agentMode": true');
    expect(sent).toContain("authoritative_task_contract");
    expect(call.system).toMatch(/not grant|do not invent autonomy/);
    expect(call.system).toContain("Do not perform the user's task yourself");
    expect(provider.calls).toHaveLength(1);
  });

  it("includes real review feedback during the pipeline's bounded repair", async () => {
    const prison = await task();
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", REFINEMENT);
    await generateRefinedPrompt({ provider, prison, compiled: compilePrompt(toCompileInput(prison)), feedback: "Deployment permission was weakened. Keep production deployment forbidden." });
    expect(provider.calls[0]!.messages[0]!.content).toContain("Deployment permission was weakened");
  });

  it("rejects invalid generated text with one correction instead of substituting the compiler", async () => {
    const prison = await task();
    const bad = { ...REFINEMENT, prompt: `${DIRECTIVE}\n[object Object]` };
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", bad, bad, REFINEMENT);
    await expect(generateRefinedPrompt({ provider, prison, compiled: compilePrompt(toCompileInput(prison)) })).rejects.toMatchObject({ kind: "invalid_output" });
    expect(provider.calls).toHaveLength(2);
  });

  it("enforces selected verbosity and propagates provider failure without fallback", async () => {
    const prison = await task();
    const long = { ...REFINEMENT, prompt: DIRECTIVE.repeat(10) };
    const provider = new ScriptedProvider().enqueue("prison_prompt_refinement", long, REFINEMENT);
    expect((await generateRefinedPrompt({ provider, prison, compiled: compilePrompt(toCompileInput(prison)) })).prompt).toBe(DIRECTIVE);
    expect(provider.calls).toHaveLength(2);
    const refused = new ScriptedProvider().enqueue("prison_prompt_refinement", new AIProviderError("refusal", "declined"));
    await expect(generateRefinedPrompt({ provider: refused, prison, compiled: compilePrompt(toCompileInput(prison)) })).rejects.toMatchObject({ kind: "refusal" });
    expect(refused.calls).toHaveLength(1);
  });
});

describe("semantic final-text critic", () => {
  it("reviews the exact generated text and considers task rules rather than structural presence", async () => {
    const prison = await task();
    const compiled = { ...compilePrompt(toCompileInput(prison)), text: `${DIRECTIVE}\n\nFINAL-TEXT-MARKER` };
    const provider = new ScriptedProvider().enqueue("prison_critic", CLEAN_CRITIC);
    const review = await runLlmCritic(provider, prison, compiled);
    expect(review.passed).toBe(true);
    const call = provider.calls[0]!;
    expect(call.system).toContain("The contract's presence alone is not proof");
    expect(call.system).toContain("policy-bypass guarantees");
    expect(call.messages[0]!.content).toContain("FINAL-TEXT-MARKER");
    expect(call.messages[0]!.content).toContain("Preserve the existing transaction database");
  });

  it("rejects out-of-range scores instead of clamping them into a passing report", async () => {
    const prison = await task();
    const invalid = { ...CLEAN_CRITIC, scores: { ...CLEAN_CRITIC.scores, intent_alignment: 12 } };
    const provider = new ScriptedProvider().enqueue("prison_critic", invalid, invalid, CLEAN_CRITIC);
    await expect(runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)))).rejects.toMatchObject({ kind: "invalid_output" });
    expect(provider.calls).toHaveLength(2);
  });

  it("requires a concrete explanation for a low score, then reports the real failure", async () => {
    const prison = await task();
    const low = { ...CLEAN_CRITIC, scores: { ...CLEAN_CRITIC.scores, intent_alignment: MIN_REVIEW_SCORE - 0.1 } };
    const explained = { ...low, issues: [{ dimension: "intent_alignment", severity: "medium", message: "The directive changes the requested task.", fix: null }] };
    const provider = new ScriptedProvider().enqueue("prison_critic", low, explained);
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.passed).toBe(false);
    expect(review.findings).toHaveLength(1);
    expect(provider.calls).toHaveLength(2);
  });

  it("retains unexplained low scores as a failed review after the bounded explanation retry", async () => {
    const prison = await task();
    const low = { ...CLEAN_CRITIC, scores: { ...CLEAN_CRITIC.scores, constraint_clarity: 0.6 } };
    const provider = new ScriptedProvider().enqueue("prison_critic", low, low);
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.passed).toBe(false);
    expect(review.scores.constraint_clarity).toBe(0.6);
    expect(review.findings).toContainEqual(expect.objectContaining({ severity: "high", dimension: "constraint_clarity" }));
    expect(provider.callsFor("prison_critic")).toHaveLength(2);
  });

  it("fails high-severity findings even when scores are high; medium style findings may pass", async () => {
    const prison = await task();
    const issue = { dimension: "constraint_clarity", severity: "high", message: "Production deployment was incorrectly authorized.", fix: null };
    const provider = new ScriptedProvider().enqueue("prison_critic", { ...CLEAN_CRITIC, issues: [issue] }, { ...CLEAN_CRITIC, issues: [{ ...issue, severity: "medium" }] });
    expect((await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)))).passed).toBe(false);
    expect((await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)))).passed).toBe(true);
  });

  it("cannot remove explicit, revision or memory-protected items through a proposed fix", async () => {
    const prison = await task();
    prison.spec.requirements.push({ id: "req_revision", text: "Keep the webhook verification test", source: "revision" });
    prison.spec.protectedElements.push({ id: "protect_implicit", text: "Preserve the user's existing features", source: "implicit" });
    prison.spec.assumptions.push({ id: "ass_default", text: "A superseded default", source: "default" });
    const fix = { add: emptyAdd, remove_item_ids: ["req_explicit", "req_revision", "con_memory", "protect_implicit", "ass_default", "not-an-item"] };
    const provider = new ScriptedProvider().enqueue("prison_critic", { ...CLEAN_CRITIC, issues: [{ dimension: "context_completeness", severity: "medium", message: "Remove the superseded default", fix }] });
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.findings[0]!.fix?.removeIds).toEqual(["ass_default"]);
    expect(prison.spec.requirements.some((item) => item.id === "req_explicit")).toBe(true);
    expect(prison.spec.constraints.some((item) => item.id === "con_memory")).toBe(true);
  });

  it("preserves a partial critic addition while missing lists are no-ops and protected removals stay blocked", async () => {
    const prison = await task();
    const requirement = "Report the webhook signature verification result";
    const issue = {
      dimension: "output_clarity", severity: "high", message: "The requested verification result is missing",
      fix: { add: { requirements: [requirement] }, remove_item_ids: ["req_explicit", "con_memory"] },
    };
    const provider = new ScriptedProvider().enqueue("prison_critic", { ...CLEAN_CRITIC, issues: [issue] });
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.passed).toBe(false);
    expect(review.findings[0]).toMatchObject({ severity: "high", fix: { add: { requirements: [requirement] }, removeIds: [] } });
    expect(review.findings[0]!.fix!.add).toEqual({
      requirements: [requirement], constraints: [], protectedElements: [], disallowedOperations: [],
      successCriteria: [], assumptions: [], unknowns: [],
    });
    const patched = applyPatch(prison, mergeFixes(review.findings)!, CRITIC_POLICY).prison;
    expect(patched.spec.requirements.map((item) => item.text)).toContain(requirement);
    expect(patched.spec.requirements.map((item) => item.id)).toContain("req_explicit");
    expect(patched.spec.constraints.map((item) => item.id)).toContain("con_memory");
    expect(provider.calls).toHaveLength(1);
    const withoutRemoval = CriticOutputSchema.parse({ ...CLEAN_CRITIC, issues: [{ ...issue, fix: { add: { requirements: [requirement] } } }] });
    expect(withoutRemoval.issues[0]!.fix!.remove_item_ids).toEqual([]);
    const withoutOperations = CriticOutputSchema.parse({ ...CLEAN_CRITIC, issues: [{ ...issue, fix: {} }] });
    expect(withoutOperations.issues[0]!.fix).toEqual({ add: emptyAdd, remove_item_ids: [] });
  });

  it.each([null, "not a list", [42]])("rejects a supplied malformed critic addition rather than defaulting it: %j", async (constraints) => {
    const prison = await task();
    const invalid = {
      ...CLEAN_CRITIC,
      issues: [{ dimension: "constraint_clarity", severity: "high", message: "A real constraint needs clarification", fix: { add: { constraints } } }],
    };
    const provider = new ScriptedProvider().enqueue("prison_critic", invalid, invalid);
    await expect(runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)))).rejects.toMatchObject({ kind: "invalid_output" });
    expect(provider.calls).toHaveLength(2);
  });

  it("propagates critic failure without manufacturing a passing review", async () => {
    const prison = await task();
    const provider = new ScriptedProvider().enqueue("prison_critic", new AIProviderError("network", "offline"));
    await expect(runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)))).rejects.toMatchObject({ kind: "network" });
    expect(provider.calls).toHaveLength(1);
  });

  it("keeps a serious issue failing when optional no-op fix fields are omitted", async () => {
    const prison = await task();
    const issue = { dimension: "constraint_clarity", severity: "high", message: "The generated text incorrectly authorizes production deployment" };
    const provider = new ScriptedProvider().enqueue("prison_critic", { ...CLEAN_CRITIC, issues: [issue] });
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.passed).toBe(false);
    expect(review.findings).toContainEqual(expect.objectContaining({ severity: "high", message: issue.message }));
    expect(mergeFixes(review.findings)).toBeNull();
    const removeOnly = new ScriptedProvider().enqueue("prison_critic", { ...CLEAN_CRITIC, issues: [{ ...issue, fix: { remove_item_ids: ["req_explicit"] } }] });
    const guarded = await runLlmCritic(removeOnly, prison, compilePrompt(toCompileInput(prison)));
    expect(guarded.passed).toBe(false);
    expect(mergeFixes(guarded.findings)).toBeNull();
    expect(prison.spec.requirements.some((item) => item.id === "req_explicit")).toBe(true);
  });

  it("removes an unsupported model assumption while preserving owner, memory and task requirements", async () => {
    const prison = await task();
    prison.spec.assumptions.push(
      { id: "ass_invented", text: "The shop also sells pastries", source: "implicit" },
      { id: "ass_owner", text: "The owner confirms the current payment provider", source: "explicit" },
      { id: "ass_revision", text: "The owner confirms the current webhook route", source: "revision" },
      { id: "ass_memory", text: "Keep the confirmed transaction behavior", source: "implicit" },
    );
    prison.spec.requirements.push({ id: "req_inferred", text: "Handle a failed payment safely", source: "implicit" });
    prison.taskMemory.push({ id: "mem_assumption", createdAt: new Date().toISOString(), directive: "Keep the confirmed transaction behavior", kind: "constraint", itemRefs: ["ass_memory"], active: true });
    const removeIds = ["ass_invented", "ass_owner", "ass_revision", "ass_memory", "req_inferred"];
    const provider = new ScriptedProvider().enqueue("prison_critic", {
      ...CLEAN_CRITIC,
      issues: [{ dimension: "context_completeness", severity: "high", message: "The owner's request never says that the shop sells pastries", fix: { add: emptyAdd, remove_item_ids: removeIds } }],
    });
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    const patch = mergeFixes(review.findings)!;
    expect(patch.removeIds).toEqual(["ass_invented"]);
    const result = applyPatch(prison, patch, CRITIC_POLICY);
    expect(result.prison.spec.assumptions.map((item) => item.id)).not.toContain("ass_invented");
    expect(result.prison.spec.assumptions.map((item) => item.id)).toEqual(expect.arrayContaining(["ass_owner", "ass_revision", "ass_memory"]));
    expect(result.prison.spec.requirements.map((item) => item.id)).toContain("req_inferred");
    // The independent application guard also rejects protected IDs if a caller bypasses critic filtering.
    const guarded = applyPatch(prison, { removeIds }, CRITIC_POLICY);
    expect(guarded.blocked).toHaveLength(4);
    expect(guarded.prison.spec.assumptions.map((item) => item.id)).toEqual(expect.arrayContaining(["ass_owner", "ass_revision", "ass_memory"]));
    expect(guarded.prison.spec.requirements.map((item) => item.id)).toContain("req_inferred");
  });
});

describe("JB generation contracts", () => {
  it("uses final review feedback and never invents permissions through mode framing", async () => {
    const prison = await task();
    const compiled = compilePrompt(toCompileInput(prison));
    const provider = new ScriptedProvider().enqueue("jailbreak_output", { prompt: DIRECTIVE, strategies_used: ["Expert-Role"], reasoning: "Task-specific directive", confidence: 0.8 });
    await generateJailbreakPrompt({ prison, target: compiled.target, basePrompt: compiled.text, provider, feedback: "Do not claim prior authorization." });
    const call = provider.calls[0]!;
    expect(call.system).toContain("does not grant new permissions");
    expect(call.system).toContain("Do not add instructions claiming prior authorization");
    expect(call.messages[0]!.content).toContain("Do not claim prior authorization");
    expect(call.messages[0]!.content).toContain("Preserve the existing transaction database");
  });
});

describe("critic restoration of exact owner quotes", () => {
  const ownerRevision = (message: string, engine: "ai" | "modifier" = "ai", summary = "Owner instruction recorded") => ({
    id: "rev_owner_quote", createdAt: new Date().toISOString(), message, summary, changes: [], resultVersion: null, engine,
  });

  const sentFocus = (provider: ScriptedProvider) => JSON.parse(provider.calls[0]!.messages[0]!.content.match(/<owner_review_focus>\n([\s\S]*?)\n<\/owner_review_focus>/)![1]!) as {
    latest_owner_revision: string | null;
    exact_owner_quote_options: Array<{ id: string; quote: string }>;
  };

  it("sends a short source-ID enum and visible literal choices from only active owner text", async () => {
    const prison = await task();
    const latestMessage = "Hafta sonu\t dahil\nolmayacak. Derslere eşit süre şartı ekleme; Toplam 3 saate dinlenmeler dahil.";
    prison.revisions.push({ ...ownerRevision("Pasif kullanıcı metni."), id: "rev_inactive" });
    prison.revisions.push({ ...ownerRevision(latestMessage, "ai", "Modelin değiştirdiği ifade."), id: "rev_latest" });
    prison.revisions.push({ ...ownerRevision("JB Modu", "modifier"), id: "rev_modifier" });
    prison.inactiveOwnerRevisionIds = ["rev_inactive"];
    const provider = new ScriptedProvider().enqueue("prison_critic", CLEAN_CRITIC);
    await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    const options = sentFocus(provider).exact_owner_quote_options;
    const choices = options.map((option) => option.quote);
    expect(choices).toContain(prison.rawRequest);
    expect(choices[0]).toBe("Hafta sonu dahil olmayacak. Derslere eşit süre şartı ekleme; Toplam 3 saate dinlenmeler dahil.");
    expect(choices).toContain("Hafta sonu dahil olmayacak.");
    expect(choices).toContain("Derslere eşit süre şartı ekleme;");
    expect(choices).toContain("Toplam 3 saate dinlenmeler dahil.");
    expect(choices).not.toContain("Pasif kullanıcı metni.");
    expect(choices).not.toContain("Modelin değiştirdiği ifade.");
    expect(choices).not.toContain("JB Modu");
    expect(new Set(choices).size).toBe(choices.length);
    expect(z.toJSONSchema(provider.calls[0]!.schema, { io: "output", target: "draft-7" })).toMatchObject({
      properties: { corrections: { items: { properties: { owner_quote_id: { enum: options.map((option) => option.id) } }, required: ["item_id", "owner_quote_id"], additionalProperties: false } } },
    });
    expect(CriticOutputSchema.safeParse(CLEAN_CRITIC).success).toBe(true);
    expect(provider.calls[0]!.schema.safeParse(CLEAN_CRITIC).success).toBe(true);
    expect(provider.calls[0]!.schema.safeParse({ ...CLEAN_CRITIC, corrections: [] }).success).toBe(true);
  });

  it("rejects a paraphrased fixture and requires an actual source-ID choice on its single retry", async () => {
    const prison = await task();
    const ownerQuote = "Derslere eşit süre şartı ekleme.";
    prison.revisions.push(ownerRevision(ownerQuote));
    prison.spec.constraints.push({ id: "con_equal", text: "Derslere eşit süre ayırma", source: "revision" });
    const provider = new ScriptedProvider().enqueue("prison_critic",
      { ...CLEAN_CRITIC, corrections: [{ item_id: "con_equal", owner_quote: "Dersler eşit süreyle planlanmamalı." }] },
      { ...CLEAN_CRITIC, corrections: [{ item_id: "con_equal", owner_quote: ownerQuote }] },
    );
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.passed).toBe(false);
    expect(mergeFixes(review.findings)?.restoreOwnerQuotes).toEqual([{ itemId: "con_equal", ownerQuote }]);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.messages.at(-1)!.content).toContain("owner_quote_id");
  });

  it("maps a selected source ID to the owner's complete literal text before applying any correction", async () => {
    const prison = await task();
    const ownerQuote = "Hafta sonu dahil olmayacak.";
    prison.revisions.push(ownerRevision(ownerQuote));
    prison.spec.constraints.push({ id: "con_weekend", text: "Hafta sonu dışı çalışma yasaklanmalı", source: "revision" });
    const provider = new ScriptedProvider().enqueue("prison_critic", {
      ...CLEAN_CRITIC, corrections: [{ item_id: "con_weekend", owner_quote_id: "quote_1" }],
    });
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(sentFocus(provider).exact_owner_quote_options[0]).toEqual({ id: "quote_1", quote: ownerQuote });
    expect(review.passed).toBe(false);
    expect(mergeFixes(review.findings)?.restoreOwnerQuotes).toEqual([{ itemId: "con_weekend", ownerQuote }]);
    expect(provider.calls).toHaveLength(1);
  });

  it("rejects unavailable source IDs without substituting any quote", async () => {
    const prison = await task();
    prison.revisions.push(ownerRevision("Stripe kullanılacak."));
    const forged = { ...CLEAN_CRITIC, corrections: [{ item_id: "unk_test", owner_quote_id: "quote_999" }] };
    const provider = new ScriptedProvider().enqueue("prison_critic", forged, forged);
    await expect(runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)))).rejects.toMatchObject({ kind: "invalid_output" });
    expect(provider.calls).toHaveLength(2);
  });

  it("keeps the actual provider wire strict even when a legacy literal result has a genuine source", async () => {
    const prison = await task();
    prison.revisions.push(ownerRevision("Stripe kullanılacak."));
    const legacy = { ...CLEAN_CRITIC, corrections: [{ item_id: "unk_test", owner_quote: "Stripe kullanılacak." }] };
    expect(CriticOutputSchema.safeParse(legacy).success).toBe(true);
    let calls = 0;
    // Bypass ScriptedProvider's fixture-only compatibility mapping, as a real provider does.
    const provider = { info: { mode: "ai" as const, provider: "scripted", model: "test-model" }, async generateJson() { calls++; return JSON.stringify(legacy); } };
    await expect(runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)))).rejects.toMatchObject({ kind: "invalid_output" });
    expect(calls).toBe(2);
  });

  it("retains mapped literal corrections in a low-score assessment without an explanation", async () => {
    const prison = await task();
    const ownerQuote = "Hafta sonu dahil olmayacak.";
    prison.revisions.push(ownerRevision(ownerQuote));
    prison.spec.constraints.push({ id: "con_weekend", text: "Hafta sonu dışı çalışma yasaklanmalı", source: "revision" });
    const low = {
      ...CLEAN_CRITIC, scores: { ...CLEAN_CRITIC.scores, execution_clarity: 0.6 },
      corrections: [{ item_id: "con_weekend", owner_quote_id: "quote_1" }],
    };
    const provider = new ScriptedProvider().enqueue("prison_critic", low, low);
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.passed).toBe(false);
    expect(review.scores.execution_clarity).toBe(0.6);
    expect(mergeFixes(review.findings)?.restoreOwnerQuotes).toEqual([{ itemId: "con_weekend", ownerQuote }]);
    expect(review.findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "high", dimension: "execution_clarity" })]));
    expect(provider.calls).toHaveLength(2);
  });

  it("bounds literal choices without truncating their text or inventing a fallback quote", async () => {
    const prison = await task();
    const message = Array.from({ length: 120 }, (_, index) => `Kural ${index}: ${"Sınırlar aynen korunacak ".repeat(24)}.`).join("\n");
    prison.revisions.push(ownerRevision(message));
    const provider = new ScriptedProvider().enqueue("prison_critic", CLEAN_CRITIC);
    await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    const choices = sentFocus(provider).exact_owner_quote_options.map((option) => option.quote);
    expect(choices.length).toBeLessThanOrEqual(96);
    expect(choices.reduce((total, quote) => total + quote.length, 0)).toBeLessThanOrEqual(24000);
    expect(choices.every((quote) => quote.length <= 2000)).toBe(true);
    expect(choices[0]).toMatch(/^Kural 0:/);
    const normalizedMessage = message.replace(/\s+/gu, " ").trim();
    expect(choices.every((quote) => normalizedMessage.includes(quote) || prison.rawRequest.includes(quote))).toBe(true);
    expect(choices).not.toContain(message.slice(0, 2000));
  });

  it("disables corrections if no complete owner literal fits the limit", async () => {
    const prison = await task();
    prison.rawRequest = "a".repeat(2001);
    prison.revisions = [];
    const provider = new ScriptedProvider().enqueue("prison_critic", CLEAN_CRITIC);
    await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(sentFocus(provider).exact_owner_quote_options).toEqual([]);
    expect(z.toJSONSchema(provider.calls[0]!.schema, { io: "output", target: "draft-7" })).toMatchObject({ properties: { corrections: { maxItems: 0 } } });
    expect(provider.calls[0]!.schema.safeParse({ ...CLEAN_CRITIC, corrections: [{ item_id: "unk_test", owner_quote: "a" }] }).success).toBe(false);
  });

  it("restores a malformed paraphrase only from a real owner revision and forces re-review", async () => {
    const prison = await task();
    prison.spec.constraints.push({ id: "con_weekend", text: "Hafta sonu dışı çalışma yasaklanmalı (sadece Pazartesi-cuma)", source: "revision" });
    prison.revisions.push(ownerRevision("Hafta sonu\t dahil\nolmayacak."));
    const provider = new ScriptedProvider().enqueue("prison_critic", { ...CLEAN_CRITIC, corrections: [{ item_id: "con_weekend", owner_quote: "Hafta sonu dahil olmayacak." }] });
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.passed).toBe(false);
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]).toMatchObject({ severity: "high", dimension: "constraint_clarity" });
    expect(mergeFixes(review.findings)?.restoreOwnerQuotes).toEqual([{ itemId: "con_weekend", ownerQuote: "Hafta sonu dahil olmayacak." }]);
    expect(prison.spec.constraints.find((item) => item.id === "con_weekend")!.text).toContain("yasaklanmalı");
  });

  it("accepts an owner's exact answer for an existing unknown as a guarded correction", async () => {
    const prison = await task();
    prison.revisions.push(ownerRevision("Stripe kullanılacak."));
    const provider = new ScriptedProvider().enqueue("prison_critic", { ...CLEAN_CRITIC, corrections: [{ item_id: "unk_test", owner_quote: "Stripe kullanılacak." }] });
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.findings[0]).toMatchObject({ dimension: "context_completeness", fix: { restoreOwnerQuotes: [{ itemId: "unk_test", ownerQuote: "Stripe kullanılacak." }] } });
    expect(review.passed).toBe(false);
  });

  it.each(["invented", "summary", "modifier"])("rejects an owner quote taken from %s rather than actual owner text", async (source) => {
    const prison = await task();
    const quote = "Stripe kullanılacak.";
    if (source === "summary") prison.revisions.push(ownerRevision("Ödeme planını iyileştir.", "ai", quote));
    if (source === "modifier") prison.revisions.push(ownerRevision(quote, "modifier"));
    const correction = { ...CLEAN_CRITIC, corrections: [{ item_id: "unk_test", owner_quote: quote }] };
    const provider = new ScriptedProvider().enqueue("prison_critic", correction, correction);
    await expect(runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)))).rejects.toMatchObject({ kind: "invalid_output" });
    expect(provider.calls).toHaveLength(2);
  });

  it("rejects a quote from a revision excluded by version restore and focuses only the active branch", async () => {
    const prison = await task();
    prison.revisions.push({ ...ownerRevision("Ödeme planını iyileştir."), id: "rev_active" });
    prison.revisions.push({ ...ownerRevision("Stripe kullanılacak."), id: "rev_future" });
    prison.inactiveOwnerRevisionIds = ["rev_future"];
    const correction = { ...CLEAN_CRITIC, corrections: [{ item_id: "unk_test", owner_quote: "Stripe kullanılacak." }] };
    const provider = new ScriptedProvider().enqueue("prison_critic", correction, correction);
    await expect(runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)))).rejects.toMatchObject({ kind: "invalid_output" });
    expect(provider.calls[0]!.messages[0]!.content).toContain('"latest_owner_revision": "Ödeme planını iyileştir."');
    expect(provider.calls[0]!.messages[0]!.content).not.toContain("Stripe kullanılacak.");
    expect(provider.calls).toHaveLength(2);
  });

  it.each(["req_explicit", "con_memory"])("rejects mutation of protected item %s even when quote provenance is valid", async (itemId) => {
    const prison = await task();
    prison.revisions.push(ownerRevision("Hafta sonu dahil olmayacak."));
    const correction = { ...CLEAN_CRITIC, corrections: [{ item_id: itemId, owner_quote: "Hafta sonu dahil olmayacak." }] };
    const provider = new ScriptedProvider().enqueue("prison_critic", correction, correction);
    await expect(runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)))).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("ignores a correction after the same exact owner quote is already preserved", async () => {
    const prison = await task();
    prison.spec.constraints.push({ id: "con_weekend", text: "Hafta sonu dahil olmayacak.", source: "revision" });
    prison.revisions.push(ownerRevision("Hafta sonu dahil olmayacak."));
    const provider = new ScriptedProvider().enqueue("prison_critic", { ...CLEAN_CRITIC, corrections: [{ item_id: "con_weekend", owner_quote: "Hafta sonu dahil olmayacak." }] });
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.passed).toBe(true);
    expect(review.findings).toEqual([]);
    expect(mergeFixes(review.findings)).toBeNull();
  });

  it("focuses the latest owner prohibition and restores every incorrect state copy while flagging the stale plan", async () => {
    const prison = await task();
    const ownerQuote = "Derslere eşit süre şartı ekleme.";
    const latestMessage = `Toplam 3 saate dinlenmeler dahil. ${ownerQuote}`;
    prison.revisions.push(ownerRevision("Matematik, İngilizce ve Python çalışacağım."));
    prison.revisions.push({ ...ownerRevision("JB Modu", "modifier"), id: "rev_modifier" });
    prison.revisions.push({ ...ownerRevision(latestMessage), id: "rev_latest_owner" });
    const badCopies = [
      ["secondaryGoals", "goal_equal", "Derslere eşit süre ayırmak"],
      ["requirements", "req_equal", "Derslere eşit süre ayırma"],
      ["constraints", "con_equal", "Derslere eşit süre ayırma"],
      ["protectedElements", "pro_equal", "Derslere eşit süre ayırma"],
      ["requiredActions", "act_equal", "Derslere eşit süre ayırma"],
      ["assumptions", "asm_equal", "Dersler eşit süre ile planlanmalı"],
      ["successCriteria", "done_equal", "Derslere eşit süre ayırılmış"],
      ["contextFacts", "fact_equal", "Derslere eşit süre ayırma"],
    ] as const;
    for (const [list, id, text] of badCopies) prison.spec[list].push({ id, text, source: "revision" });
    prison.spec.taskPlan = {
      approach: "Üç dersin haftalık çalışma planını hazırla.",
      steps: [{ action: "Her dersin görevlerine eşit süre dağıt.", purpose: "Eşit süre şartını sağla.", verification: "Her dersin süresinin eşit olduğunu doğrula." }],
      clarifyingQuestions: [], recommendedTarget: "gpt", targetRationale: "Çalışma planı hazırlama.",
    };
    const corrections = badCopies.map(([, id]) => ({ item_id: id, owner_quote: ownerQuote }));
    const provider = new ScriptedProvider().enqueue("prison_critic", {
      ...CLEAN_CRITIC, corrections,
      issues: [{ dimension: "execution_clarity", severity: "high", message: "Planın eşit süre şartı son kullanıcı talimatıyla çelişiyor.", fix: null }],
    });
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.passed).toBe(false);
    expect(review.findings.filter((finding) => finding.severity === "high")).toHaveLength(9);
    expect(mergeFixes(review.findings)?.restoreOwnerQuotes).toEqual(badCopies.map(([, itemId]) => ({ itemId, ownerQuote })));
    const call = provider.calls[0]!;
    const user = call.messages[0]!.content;
    const focus = JSON.parse(user.match(/<owner_review_focus>\n([\s\S]*?)\n<\/owner_review_focus>/)![1]!);
    expect(focus.latest_owner_revision).toBe(latestMessage);
    expect(focus.quote_restoration_eligible_item_ids).toEqual(expect.arrayContaining(badCopies.map(([, id]) => id)));
    expect(focus.quote_restoration_eligible_item_ids).not.toContain("con_memory");
    expect(focus.active_memory_protected_item_ids).toContain("con_memory");
    expect(user.indexOf("<owner_review_focus>")).toBeLessThan(user.indexOf("<prison_state>"));
    expect(call.system).toContain("return one correction for EACH affected ID");
    expect(call.system).toContain("An execution-plan conflict needs its own high-severity issue with fix:null");
    expect(provider.calls).toHaveLength(1);
  });

  it("keeps a stale plan failure actionable after exact state quotes have already been restored", async () => {
    const prison = await task();
    const ownerQuote = "Derslere eşit süre şartı ekleme.";
    prison.revisions.push(ownerRevision(ownerQuote));
    prison.spec.constraints.push({ id: "con_equal", text: ownerQuote, source: "revision" });
    const provider = new ScriptedProvider().enqueue("prison_critic", {
      ...CLEAN_CRITIC,
      corrections: [{ item_id: "con_equal", owner_quote: ownerQuote }],
      issues: [{ dimension: "execution_clarity", severity: "high", message: "Kullanıcı sözü korunmuş olsa da planda eşit süre şartı kaldı.", fix: null }],
    });
    const review = await runLlmCritic(provider, prison, compilePrompt(toCompileInput(prison)));
    expect(review.passed).toBe(false);
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]).toMatchObject({ severity: "high", dimension: "execution_clarity" });
    expect(mergeFixes(review.findings)).toBeNull();
  });
});
