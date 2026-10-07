import { describe, expect, it, vi } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import type { Prison } from "@/models/prison";
import type { CouncilDeps } from "@/services/ai/council-config";
import { AIProviderError } from "@/services/ai/errors";
import type { JsonGenerationRequest, LLMProvider } from "@/services/ai/types";
import { PrisonService } from "@/services/prison-service";
import type { PrisonRepository } from "@/services/storage/repository";
import { CLEAN_CRITIC, ScriptedProvider } from "./helpers";

const directive = "Write the requested welcome message for new users, using a friendly tone and concrete wording. Preserve the owner's task and output requirements, then check the final text for clarity and relevance.";
const generated = { prompt: directive, strategies_used: ["Task-Specific-Workflow"] };
const initial = { trigger: "initial" as const, note: "", llmReview: false };

async function task() {
  return runAnalysisPipeline({ rawRequest: "Write a brief welcome message for new users.", language: "en", targetAI: "gpt" }, null);
}

function configuredService(stored: Prison, selected: LLMProvider) {
  let current = structuredClone(stored);
  const save = vi.fn(async (next: Prison) => { current = structuredClone(next); });
  const repo: PrisonRepository = { get: async () => structuredClone(current), save, list: async () => [], delete: async () => false };
  // Both preflight and source verification are configured; the user's single-mode selection must bypass them.
  const forbiddenCall = vi.fn(async (_request: JsonGenerationRequest): Promise<string> => { throw new Error("unselected council endpoint called"); });
  const endpoint = (model: string): LLMProvider => ({ info: { mode: "ai", provider: "nvidia", model }, generateJson: forbiddenCall });
  const council: CouncilDeps = {
    verifySource: true, probeSelected: true,
    members: [1, 2, 3].map((index) => ({ id: `member_${index}`, role: `Test role ${index}`, provider: endpoint(`test/member-${index}`) })),
    reserves: [endpoint("test/reserve")],
  };
  return { service: new PrisonService(repo, selected, undefined, council), save, forbiddenCall, stored: () => structuredClone(current) };
}

describe("selected single API contract", () => {
  it("uses the selected provider to write and review the exact saved text, despite configured council probes and reserves", async () => {
    const base = await task();
    const selected = new ScriptedProvider().enqueue("prison_prompt_refinement", generated).enqueue("prison_critic", CLEAN_CRITIC);
    const { service, save, forbiddenCall } = configuredService(base, selected);
    const result = await service.compile(base.id);
    const version = result.promptVersions.at(-1)!;
    expect(selected.calls.map((call) => call.schemaName)).toEqual(["prison_prompt_refinement", "prison_critic"]);
    expect(forbiddenCall).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
    expect(result.status).toBe("READY");
    expect(version.options.councilMode).toBe("single");
    expect(version.generation).toMatchObject({ source: "ai", provider: selected.info.provider, model: selected.info.model });
    expect(version.critic.llmReviewed).toBe(true);
    expect(version.councilReview).toBeNull();
    expect(version.text).toContain(directive);
    expect(version.text).toContain(base.rawRequest);
    // Reviewing a base template alone cannot approve an unreviewed AI-authored direction.
    expect(selected.callsFor("prison_critic")[0]!.messages[0]!.content).toContain(version.text);
  });

  it("keeps the last saved prompt when the selected provider's final review is unavailable", async () => {
    const ready = await runCompilePipeline(await task(), initial, { provider: null });
    const selected = new ScriptedProvider().enqueue("prison_prompt_refinement", generated)
      .enqueue("prison_critic", new AIProviderError("timeout", "selected final review timed out"));
    const { service, save, forbiddenCall, stored } = configuredService(ready, selected);
    await expect(service.compile(ready.id)).rejects.toMatchObject({ code: "ai_error" });
    expect(selected.callsFor("prison_prompt_refinement")).toHaveLength(1);
    expect(selected.callsFor("prison_critic")).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    expect(forbiddenCall).not.toHaveBeenCalled();
    expect(stored()).toEqual(ready);
  });

  it("rejects a persistent semantic review failure after a bounded repair instead of saving a fake success", async () => {
    const ready = await runCompilePipeline(await task(), initial, { provider: null });
    const rejected = {
      ...CLEAN_CRITIC,
      scores: { ...CLEAN_CRITIC.scores, context_completeness: 0.2 },
      issues: [{ dimension: "context_completeness", severity: "high", message: "The text does not address the specified new-user audience.", fix: null }],
    };
    const selected = new ScriptedProvider().enqueue("prison_prompt_refinement", generated, generated).enqueue("prison_critic", rejected, rejected);
    const { service, save, forbiddenCall, stored } = configuredService(ready, selected);
    await expect(service.compile(ready.id)).rejects.toMatchObject({ code: "validation_error", status: 422 });
    expect(selected.callsFor("prison_prompt_refinement")).toHaveLength(2);
    expect(selected.callsFor("prison_critic")).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
    expect(forbiddenCall).not.toHaveBeenCalled();
    expect(stored()).toEqual(ready);
  });

  it("revises with the same selected provider without resurrecting the configured council", async () => {
    const ready = await runCompilePipeline(await task(), initial, { provider: null });
    const selected = new ScriptedProvider().enqueue("prison_revision", { summary: "Use concise output.", set: { verbosity: "concise" }, add: {} })
      .enqueue("prison_prompt_refinement", generated).enqueue("prison_critic", CLEAN_CRITIC);
    const { service, save, forbiddenCall } = configuredService(ready, selected);
    const result = await service.revise(ready.id, "Keep it concise.");
    expect(selected.calls.map((call) => call.schemaName)).toEqual(["prison_revision", "prison_prompt_refinement", "prison_critic"]);
    expect(forbiddenCall).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
    expect(result.promptVersions).toHaveLength(ready.promptVersions.length + 1);
    expect(result.compileOptions.councilMode).toBe("single");
    expect(result.compileOptions.verbosity).toBe("concise");
    expect(result.promptVersions.at(-1)!.councilReview).toBeNull();
    expect(result.promptVersions.at(-1)!.text).toContain("Keep it concise.");
    expect(result.promptVersions.at(-1)!.generation?.model).toBe(selected.info.model);
    expect(selected.callsFor("prison_critic")[0]!.messages[0]!.content).toContain(result.promptVersions.at(-1)!.text);
  });
});
