import { describe, expect, it, vi } from "vitest";
import { conductCouncil } from "@/core/model-council";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { toCompileInput } from "@/core/context-engine";
import { compilePrompt } from "@/core/prompt-compiler";
import { CouncilReviewSchema } from "@/models/council";
import type { ProgressUpdate } from "@/models/operation-progress";
import { configuredProviders, environmentProviderSettings, mergeProviderSettings } from "@/services/ai/provider-settings";
import { AIProviderError } from "@/services/ai/errors";
import type { JsonGenerationRequest, LLMProvider } from "@/services/ai/types";

const ENV = { NVIDIA_API_KEY: "fake-config-key", PRISON_PROVIDER: "nvidia", PRISON_MODEL: "nvidia/primary", PRISON_COUNCIL_MODE: "enabled", PRISON_COUNCIL_MODELS: "nvidia/a,nvidia/b,nvidia/c", PRISON_COUNCIL_DEPTH: "quick" };
const BODY = "Inspect the existing payment flow, implement the requested integration within the current architecture, and verify successful and failed payments. Preserve existing user workflows and keep production deployment disabled.";
class SelectedModel implements LLMProvider {
  readonly calls: JsonGenerationRequest[] = [];
  constructor(readonly info: LLMProvider["info"], private readonly reachable = true) {}
  async generateJson(request: JsonGenerationRequest): Promise<string> {
    this.calls.push(request);
    if (request.schemaName === "council_preflight") {
      if (!this.reachable) throw new AIProviderError("auth", "Raw key must never be public");
      return '{"ok":true}';
    }
    if (request.schemaName === "prison_prompt_refinement") return JSON.stringify({ prompt: `${BODY} Draft by ${this.info.model}.`, strategies_used: ["Owner-contract preservation"] });
    if (request.schemaName.startsWith("prison_council_")) {
      const text = request.messages[0].content;
      const data = JSON.parse(text.slice(text.lastIndexOf("</prison_state>") + "</prison_state>".length).trim()) as { candidates: Array<{ id: string }> };
      return JSON.stringify({ evaluations: data.candidates.map(({ id }) => ({ candidate_id: id, issues: [], suggestions: [], scores: {
        intent_alignment: .9, context_completeness: .9, constraint_clarity: .9, execution_clarity: .9, output_clarity: .9, target_ai_compatibility: .9,
      } })) });
    }
    throw new Error(`Unexpected schema ${request.schemaName}`);
  }
}

function customTeam() {
  const defaults = environmentProviderSettings(ENV);
  const saved = mergeProviderSettings({ revision: defaults.revision, primary: defaults.primary, council: defaults.council,
    providers: defaults.providers.map(({ keyPresent: _present, keySource: _source, ...profile }) => profile) }, null, ENV);
  return configuredProviders(saved, ENV).council!;
}

describe("selected model connection preflight", () => {
  it("probes exactly the saved team without presets, substitutes or automatic remote checks on save", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const team = customTeam();
    expect(team.probeSelected).toBe(true); expect(team.reserves).toEqual([]); expect(fetch).not.toHaveBeenCalled();
    const selected = team.members.map(member => new SelectedModel(member.provider.info));
    team.members = team.members.map((member, index) => ({ ...member, provider: selected[index] }));
    const prison = await runAnalysisPipeline({ rawRequest: "Add a payment system to the existing project. Preserve existing architecture and user flows. Do not deploy to production.", language: "en", targetAI: "codex" }, null);
    const input = toCompileInput(prison); const progress: ProgressUpdate[] = [];
    const result = await conductCouncil(prison, compilePrompt(input), team, undefined, update => progress.push(update));
    expect(result.review.participants.map(member => member.model)).toEqual(["nvidia/a", "nvidia/b", "nvidia/c"]);
    expect(result.review.replacements).toEqual([]); expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
    expect(progress[0]).toMatchObject({ stage: "preflight", total: 3, message: "Seçilen modellerin yanıt verip vermediği kontrol ediliyor." });
    for (const model of selected) {
      expect(model.calls[0].schemaName).toBe("council_preflight");
      expect(model.calls[0].timeoutMs).toBeLessThanOrEqual(20000);
      expect(model.calls.filter(call => call.schemaName === "council_preflight")).toHaveLength(1);
    }
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });

  it("stops before any drafts when the selected team has fewer than three reachable models", async () => {
    const team = customTeam();
    const selected = team.members.map((member, index) => new SelectedModel(member.provider.info, index === 0));
    team.members = team.members.map((member, index) => ({ ...member, provider: selected[index] }));
    const prison = await runAnalysisPipeline({ rawRequest: "Create a weekday study plan.", language: "en", targetAI: "gpt" }, null);
    const original = structuredClone(prison);
    await expect(conductCouncil(prison, compilePrompt(toCompileInput(prison)), team)).rejects.toMatchObject({ code: "validation_error" });
    expect(prison).toEqual(original);
    expect(selected.flatMap(model => model.calls).every(call => call.schemaName === "council_preflight")).toBe(true);
  });
});
