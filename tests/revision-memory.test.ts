import { describe, expect, it } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { runRevisionPipeline } from "@/core/pipeline/revise";
import { applyPatch, REVISION_POLICY } from "@/core/prison-engine/patch";
import { interpretRevisionLocally } from "@/core/revision-engine/local";
import { canTransition, InvalidTransitionError, transition } from "@/core/prison-engine/state-machine";
import type { ResolvedPrison } from "@/models/prison";
import { ScriptedProvider, paymentIntent, CLEAN_CRITIC } from "./helpers";

async function readyPrison(): Promise<ResolvedPrison> {
  const prison = await runAnalysisPipeline(
    { rawRequest: "Codex'e mevcut projemi bozmadan ödeme sistemini ekletecek prompt üret.", language: "en", targetAI: "auto" },
    null,
  );
  return runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: false }, { provider: null });
}

describe("local revision interpreter", () => {
  it("forbids deployment and remembers it", async () => {
    const prison = await readyPrison();
    const { patch } = interpretRevisionLocally("Canlı deploy yapmasına izin verme.", prison);
    expect(patch.set?.deploymentPermission).toBe("forbidden");
    expect(patch.memory?.[0]?.kind).toBe("prohibition");
  });

  it("switches the target", async () => {
    const prison = await readyPrison();
    expect(interpretRevisionLocally("Claude için üret.", prison).patch.set?.targetAI).toBe("claude");
  });

  it("protects the architecture", async () => {
    const prison = await readyPrison();
    const { patch } = interpretRevisionLocally("Mevcut mimariyi değiştirmesin.", prison);
    expect(patch.add?.protectedElements?.length).toBe(1);
    expect(patch.memory?.[0]?.kind).toBe("protection");
  });

  it("maps presentation requests to compile options", async () => {
    const prison = await readyPrison();
    expect(interpretRevisionLocally("Bunu daha katı yap.", prison).patch.set?.options).toEqual({ scope: "strict" });
    expect(interpretRevisionLocally("Daha kısa ve teknik olsun", prison).patch.set?.options).toEqual({
      verbosity: "concise",
      technicality: "technical",
    });
  });
});

describe("revision pipeline", () => {
  it("updates the same prison, recompiles and records the revision", async () => {
    const prison = await readyPrison();
    const revised = await runRevisionPipeline(prison, "Bunu daha katı yap.", { provider: null });
    expect(revised.id).toBe(prison.id);
    expect(revised.status).toBe("READY");
    expect(revised.promptVersions).toHaveLength(2);
    expect(revised.compileOptions.scope).toBe("strict");
    expect(revised.promptVersions[1]!.text).toContain("Stay strictly inside this scope");
    expect(revised.revisions.at(-1)?.resultVersion).toBe(2);
    expect(revised.history.map((h) => h.to)).toContain("USER_REVISION");
    expect(revised.history.map((h) => h.to)).toContain("PROMPT_RECOMPILED");
  });

  it("does not create a version when nothing changed", async () => {
    const prison = await readyPrison();
    const once = await runRevisionPipeline(prison, "Bunu daha katı yap.", { provider: null });
    const twice = await runRevisionPipeline(once, "Bunu daha katı yap.", { provider: null });
    expect(twice.promptVersions).toHaveLength(2);
    expect(twice.revisions.at(-1)?.resultVersion).toBeNull();
  });

  it("task memory survives later revisions: protected items cannot be removed until revoked", async () => {
    const prison = await readyPrison();
    const revised = await runRevisionPipeline(prison, "Mevcut mimariyi değiştirmesin.", { provider: null });
    const memory = revised.taskMemory.find((m) => m.active)!;
    expect(memory.itemRefs.length).toBeGreaterThan(0);

    const attempt = applyPatch(revised, { removeIds: memory.itemRefs }, REVISION_POLICY);
    expect(attempt.blocked.length).toBe(memory.itemRefs.length);
    for (const id of memory.itemRefs) expect(attempt.prison.spec.protectedElements.concat(attempt.prison.spec.disallowedOperations).some((i) => i.id === id)).toBe(true);

    const revoked = applyPatch(revised, { revokeMemoryIds: [memory.id], removeIds: memory.itemRefs }, REVISION_POLICY);
    expect(revoked.blocked).toHaveLength(0);
    expect(revoked.prison.taskMemory.find((m) => m.id === memory.id)?.active).toBe(false);
  });

  it("passes only the active prison's isolated state to the revision model", async () => {
    const provider = new ScriptedProvider();
    provider.enqueue("prison_intent", paymentIntent());
    provider.enqueue("prison_prompt_refinement", {
      prompt: "Inspect the existing payment integration points, confirm the provider decision, implement only the requested flow, and verify successful and failed payments without changing protected behavior or deploying to production.",
      strategies_used: ["Task-specific implementation", "Verification"],
    }, {
      prompt: "Use Stripe for the requested payment flow and verify webhook signatures before processing events. Inspect the existing integration points, keep the established architecture, and confirm successful, rejected and duplicate-event behavior without deploying to production.",
      strategies_used: ["Resolved provider decision", "Webhook verification"],
    });
    const prison = await runAnalysisPipeline({ rawRequest: "ödeme", language: "en", targetAI: "auto" }, provider);
    provider.enqueue("prison_critic", CLEAN_CRITIC);
    const ready = await runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: true }, { provider });
    provider.enqueue("prison_revision", {
      summary: "Webhook doğrulaması eklendi.",
      set: {
        primary_goal: null, task_type: null, target_ai: null, operation: null, deployment_permission: null,
        existing_system: null, preserve_architecture: null, coding_required: null, advice_only: null,
        expected_output_format: null, expected_output_description: null,
        verbosity: null, technicality: null, scope: null, agent_mode: null,
      },
      add: {
        secondary_goals: [], requirements: ["Verify webhook signatures"], constraints: [], protected_elements: [],
        allowed_operations: [], disallowed_operations: [], required_actions: [], assumptions: [], unknowns: [],
        success_criteria: [], context_facts: [],
      },
      remove_item_ids: [],
      resolved_unknowns: [{ unknown_id: ready.spec.unknowns[0]!.id, fact: "Use Stripe" }],
      memory: [],
      revoke_memory_ids: [],
    });
    provider.enqueue("prison_execution_plan", {
      ...paymentIntent().execution_plan!,
      approach: "Integrate Stripe into the existing payment flow and verify webhook signatures without changing unrelated behavior.",
      steps: [
        { action: "Inspect the existing architecture", purpose: "Locate the payment integration points", verification: "The current flow and integration boundaries are recorded" },
        { action: "Integrate Stripe and verify webhook signatures", purpose: "Implement the chosen provider with authenticated events", verification: "Invalid webhook signatures are rejected" },
        { action: "Test the payment flow", purpose: "Check success, failure and duplicate events", verification: "A test payment completes and duplicate events do not duplicate charges" },
      ],
      clarifying_questions: [],
    });
    provider.enqueue("prison_critic", CLEAN_CRITIC);
    const revised = await runRevisionPipeline(ready, "Webhookları doğrulasın, sağlayıcı Stripe.", { provider });

    const request = provider.callsFor("prison_revision")[0]!;
    expect(request.messages[0]!.content).toContain(`"prison_id": "${ready.id}"`);
    expect(revised.spec.requirements.some((r) => r.text === "Verify webhook signatures" && r.source === "revision")).toBe(true);
    expect(revised.spec.contextFacts.some((f) => f.text === "Use Stripe")).toBe(true);
    expect(revised.spec.unknowns.some((u) => u.text === "Which payment provider to use")).toBe(false);
    expect(revised.spec.taskPlan?.clarifyingQuestions).toEqual([]);
    expect(revised.spec.taskPlan?.approach).toContain("Stripe");
    expect(revised.spec.taskPlan?.steps.some((step) => step.action.includes("webhook signatures"))).toBe(true);
    expect(provider.callsFor("prison_execution_plan")[0]?.messages[0]?.content).toContain("Use Stripe");
    expect(revised.revisions.at(-1)?.engine).toBe("ai");
  });
});

describe("state machine", () => {
  it("rejects illegal transitions", async () => {
    const prison = await readyPrison();
    expect(canTransition("READY", "PROMPT_VALIDATED")).toBe(false);
    expect(() => transition(prison, "INTENT_PARSED")).toThrow(InvalidTransitionError);
  });
});
