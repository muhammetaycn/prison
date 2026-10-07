import { describe, expect, it } from "vitest";
import { toCompileInput } from "@/core/context-engine";
import { generateJailbreakPrompt } from "@/core/jailbreak-engine";
import { combineJailbreakPrompt, generateLocalJailbreak } from "@/core/jailbreak-engine/local";
import { buildJailbreakStrategyPlan, JAILBREAK_FRAMING_LIMITS } from "@/core/jailbreak-engine/strategy";
import { jailbreakUserMessage } from "@/core/jailbreak-engine/system-prompt";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { compilePrompt } from "@/core/prompt-compiler";
import { resolveRequirements } from "@/core/requirement-resolver";
import type { IntentAnalysis } from "@/models/intent";
import type { CompileOptions } from "@/models/options";
import type { ResolvedPrison } from "@/models/prison";
import { paymentIntent, ScriptedProvider } from "./helpers";

async function task(intentChanges: Partial<IntentAnalysis> = {}, options: Partial<CompileOptions> = {}): Promise<ResolvedPrison> {
  const rawRequest = "Add payment retries to the existing project. Preserve checkout; do not deploy. Return a summary and verification evidence.";
  const base = await runAnalysisPipeline({ rawRequest, language: "en", targetAI: "codex", jailbreakMode: true }, null);
  const intent = paymentIntent(intentChanges);
  const resolved = resolveRequirements({ intent, language: "en", itemSeq: 0 });
  return { ...base, intent, spec: resolved.spec, itemSeq: resolved.itemSeq, compileOptions: { ...base.compileOptions, ...options } };
}

function contract(prison: ResolvedPrison) {
  const input = toCompileInput(prison);
  return compilePrompt({ ...input, options: { ...input.options, jailbreakMode: false } });
}

describe("JB strategy adaptation", () => {
  it("keeps Codex advice as advice even in an agent environment", async () => {
    const prison = await task({
      primary_goal: "Compare payment retry approaches and recommend one",
      operation: "advise",
      execution_required: false,
      advice_only: true,
      execution_plan: null,
      expected_output: { format: "Comparison table", description: "A recommendation with trade-offs", deliverables: ["Comparison table", "Recommendation"] },
    }, { executionContext: "agent", agentMode: true });
    const plan = buildJailbreakStrategyPlan(prison, "codex");
    const result = await generateJailbreakPrompt({ prison, target: "codex", basePrompt: contract(prison).text });
    expect(plan).toMatchObject({ workflow: "analysis", executionRequested: false, environment: "agent" });
    expect(result.prompt).toContain("does not authorize file changes");
    expect(result.prompt).not.toContain("before making the authorized changes");
    expect(prison.spec.allowedOperations).toEqual([]);
    expect(prison.compileOptions.agentMode).toBe(true);
  });

  it.each([
    [{ operation: "modify_existing", coding_required: true, execution_required: true }, "implementation"],
    [{ operation: "analyze", coding_required: true, execution_required: true }, "analysis"],
    [{ operation: "generate_content", task_type: "writing", coding_required: false }, "content"],
    [{ operation: "research", coding_required: false, research_required: true }, "research"],
    [{ operation: "generate_media", coding_required: false, visual_generation_required: true }, "media"],
  ] as const)("selects a workflow from the task operation rather than the target (%s)", async (changes, expected) => {
    const prison = await task({ ...changes, execution_plan: null });
    const plans = ["gpt", "claude", "gemini", "codex"].map((target) => buildJailbreakStrategyPlan(prison, target as "gpt" | "claude" | "gemini" | "codex"));
    expect(new Set(plans.map((plan) => plan.workflow))).toEqual(new Set([expected]));
    expect(new Set(plans.map((plan) => plan.guidance.target)).size).toBe(4);
    expect(plans.map((plan) => plan.goal)).toEqual(Array(4).fill(prison.spec.primaryGoal));
  });

  it("uses concrete task actions, acceptance checks and missing context without mutating the task", async () => {
    const prison = await task();
    const original = structuredClone(prison);
    const plan = buildJailbreakStrategyPlan(prison, "codex");
    const result = await generateJailbreakPrompt({ prison, target: "codex", basePrompt: contract(prison).text });
    expect(plan.steps).toEqual(prison.spec.taskPlan!.steps);
    expect(result.prompt).toContain(prison.spec.taskPlan!.steps[2]!.verification);
    expect(result.prompt).toContain("Which payment provider to use");
    expect(result.prompt).toContain(prison.spec.expectedOutput.deliverables[0]!);
    plan.steps[0]!.action = "Unrelated replacement";
    plan.deliverables.push("Extra artifact");
    expect(prison).toEqual(original);
    const repeated = await generateJailbreakPrompt({ prison, target: "codex", basePrompt: contract(prison).text });
    expect(repeated).toEqual(result);
  });

  it.each(["chat", "mobile", "browser", "agent"] as const)("adapts %s without changing the output contract or granting permissions", async (executionContext) => {
    const prison = await task({ expected_output: { format: "JSON only", description: "A decision object", deliverables: ["A JSON decision object"] } }, { executionContext, agentMode: executionContext === "agent", verbosity: "concise" });
    const before = structuredClone(prison);
    const plan = buildJailbreakStrategyPlan(prison, "gpt");
    const result = await generateJailbreakPrompt({ prison, target: "gpt", basePrompt: contract(prison).text });
    expect(plan).toMatchObject({ environment: executionContext, outputFormat: "JSON only", deliverables: ["A JSON decision object"] });
    expect(result.prompt.length).toBeLessThanOrEqual(JAILBREAK_FRAMING_LIMITS.concise);
    expect(result.prompt).toContain(plan.guidance.environment);
    expect(result.prompt).toContain("Keep explanations inside that format");
    expect(prison).toEqual(before);
  });

  it.each(["en", "tr"] as const)("honors the concise framing budget with long source fields in %s", async (language) => {
    const prison = await task({}, { verbosity: "concise", executionContext: "agent", agentMode: true });
    prison.language = language;
    prison.spec.role = "specialist ".repeat(500);
    prison.spec.primaryGoal = "Add focused behavior ".repeat(500);
    const basePrompt = contract(prison).text;
    const framing = await generateJailbreakPrompt({ prison, target: "codex", basePrompt });
    const final = combineJailbreakPrompt(framing.prompt, basePrompt, language);
    expect(framing.prompt.length).toBeLessThanOrEqual(JAILBREAK_FRAMING_LIMITS.concise);
    expect(final.endsWith(`${basePrompt.trim()}\n`)).toBe(true);
    expect(final).toContain(prison.spec.primaryGoal.trim());
  });

  it("preserves legacy local callers without inventing Codex execution intent", () => {
    const framing = generateLocalJailbreak("Compare retry algorithms", "payments", "engineer", "Provide advice only", "codex", "en");
    expect(framing).toContain("does not authorize file changes");
    expect(framing).not.toContain("make the requested changes");
  });
});

describe("JB strategy generation boundary", () => {
  it("sends the strategy alongside the complete active contract while excluding inactive history", async () => {
    const prison = await task({}, { verbosity: "concise", executionContext: "mobile" });
    prison.revisions = [
      { id: "old", createdAt: prison.createdAt, message: "STALE_OWNER_DIRECTIVE", summary: "", changes: [], resultVersion: null, engine: "local" },
      { id: "current", createdAt: prison.updatedAt, message: "Return only the comparison table", summary: "", changes: [], resultVersion: null, engine: "local" },
    ];
    prison.inactiveOwnerRevisionIds = ["old"];
    prison.taskMemory = [{ id: "inactive", createdAt: prison.createdAt, directive: "STALE_PRIVATE_MEMORY", kind: "constraint", itemRefs: [], active: false }];
    const basePrompt = contract(prison).text;
    const sent = jailbreakUserMessage(prison, "codex", basePrompt);
    const supplemental = sent.slice(sent.indexOf('\n{\n  "target_ai"') + 1, sent.lastIndexOf("\n}") + 2);
    const payload = JSON.parse(supplemental);
    expect(payload.authoritative_task_contract).toBe(basePrompt);
    expect(payload.strategy_plan).toEqual(buildJailbreakStrategyPlan(prison, "codex"));
    expect(payload.framing_character_limit).toBe(JAILBREAK_FRAMING_LIMITS.concise);
    expect(sent).toContain("Return only the comparison table");
    expect(sent).not.toContain("STALE_OWNER_DIRECTIVE");
    expect(sent).not.toContain("STALE_PRIVATE_MEMORY");
  });

  it("generates only a directive and preserves the immutable downstream contract", async () => {
    const prison = await task();
    const basePrompt = contract(prison).text;
    const prompt = "Locate the payment retry boundaries and resolve the provider choice before choosing a minimal implementation. Preserve checkout and verify successful, failed and duplicate events against the task contract.";
    const provider = new ScriptedProvider().enqueue("jailbreak_output", {
      strategies_used: ["Task-Decomposition", "Evidence-Verification"], reasoning: "Editorial plan for payment work", prompt, confidence: 0.9,
    });
    const result = await generateJailbreakPrompt({ prison, target: "codex", basePrompt, provider });
    const call = provider.callsFor("jailbreak_output")[0]!;
    expect(provider.calls).toHaveLength(1);
    expect(call.system).toContain("Do not perform the user's downstream task");
    expect(result).toEqual({ prompt, strategies: ["Task-Decomposition", "Evidence-Verification"], isAiGenerated: true });
    const final = combineJailbreakPrompt(result.prompt, basePrompt, prison.language);
    expect(final.endsWith(`${basePrompt.trim()}\n`)).toBe(true);
    expect(final).toContain("Deploy to production");
    expect(prison.promptVersions).toEqual([]);
  });
});
