import { describe, expect, it, vi } from "vitest";
import { conductCouncil } from "@/core/model-council";
import { toCompileInput } from "@/core/context-engine";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { compilePrompt } from "@/core/prompt-compiler";
import { CouncilReviewSchema } from "@/models/council";
import type { ProgressUpdate } from "@/models/operation-progress";
import type { ResolvedPrison } from "@/models/prison";
import { createCouncil, DEFAULT_COUNCIL_MODELS, DEFAULT_COUNCIL_RESERVE_MODELS, type CouncilDeps } from "@/services/ai/council-config";
import type { EngineStatus } from "@/services/ai/config";
import { AIProviderError } from "@/services/ai/errors";
import type { JsonGenerationRequest, LLMProvider } from "@/services/ai/types";

const RAW_REQUEST = "Add a payment system to the existing project. Preserve existing architecture and user flows. Do not deploy to production.";
const BODY = "Inspect the existing payment flow, implement the requested integration within the current architecture, and verify successful and failed payments. Preserve existing user workflows and keep production deployment disabled.";

/** Answers every council schema generically; `down` makes the probe fail like an unreachable endpoint. */
class StubModel implements LLMProvider {
  readonly info;
  readonly calls: JsonGenerationRequest[] = [];
  private drafts = 0;

  constructor(model: string, private readonly down = false) {
    this.info = { mode: "ai" as const, provider: "nvidia", model };
  }

  async generateJson(request: JsonGenerationRequest): Promise<string> {
    this.calls.push(request);
    if (request.schemaName === "council_preflight") {
      if (this.down) throw new AIProviderError("bad_request", "404 for this account");
      return JSON.stringify({ ok: true });
    }
    if (request.schemaName === "prison_prompt_refinement" || request.schemaName === "jailbreak_output") {
      return JSON.stringify({ prompt: `${BODY} Draft by ${this.info.model}, ${++this.drafts}.`, strategies_used: ["Owner-contract preservation"],
        ...(request.schemaName === "jailbreak_output" ? { reasoning: "summary", confidence: 0.9 } : {}) });
    }
    if (request.schemaName.startsWith("prison_council_")) {
      const text = request.messages[0].content;
      const envelope = JSON.parse(text.slice(text.lastIndexOf("</prison_state>") + "</prison_state>".length).trim()) as { candidates: Array<{ id: string }> };
      const value = 0.9;
      return JSON.stringify({ evaluations: envelope.candidates.map(({ id }) => ({ candidate_id: id, issues: [], suggestions: [], scores: {
        intent_alignment: value, context_completeness: value, constraint_clarity: value, execution_clarity: value, output_clarity: value, target_ai_compatibility: value,
      } })) });
    }
    throw new Error(`Unexpected schema ${request.schemaName}`);
  }

  workCalls(): JsonGenerationRequest[] {
    return this.calls.filter((call) => call.schemaName !== "council_preflight");
  }
}

function deps(members: StubModel[], reserves: StubModel[]): CouncilDeps {
  return { members: members.map((provider, index) => ({ id: `member_${index + 1}`, role: `Uzman ${index + 1}`, provider })), reserves };
}

async function prison(): Promise<ResolvedPrison> {
  return runAnalysisPipeline({ rawRequest: RAW_REQUEST, language: "en", targetAI: "codex" }, null);
}

function baseFor(value: ResolvedPrison) {
  const input = toCompileInput(value);
  return compilePrompt({ ...input, options: { ...input.options, jailbreakMode: false } });
}

describe("council pre-flight probe", () => {
  it("seats the first healthy reserve in an unreachable member's place and never sends it council work", async () => {
    const value = await prison();
    const down = new StubModel("vendor/down-model", true);
    const members = [new StubModel("vendor/a"), down, new StubModel("vendor/c")];
    const brokenReserve = new StubModel("vendor/broken-reserve", true);
    const reserve = new StubModel("vendor/reserve");
    const progress: ProgressUpdate[] = [];
    const result = await conductCouncil(value, baseFor(value), deps(members, [brokenReserve, reserve]), undefined, (update) => progress.push(update));

    expect(down.workCalls()).toHaveLength(0);
    expect(brokenReserve.workCalls()).toHaveLength(0);
    expect(reserve.workCalls().length).toBeGreaterThan(0);
    const seat = result.review.participants.find((participant) => participant.id === "member_2")!;
    expect(seat).toMatchObject({ model: "vendor/reserve", role: "Uzman 2" });
    expect(result.review.replacements).toEqual([{ model: "vendor/down-model", reason: expect.any(String), replacement: "vendor/reserve" }]);
    expect(JSON.stringify(result.review)).not.toContain("404 for this account");
    expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
    expect(progress[0]).toMatchObject({ stage: "preflight", completed: 0, total: 3 });
    for (const call of members.concat(reserve, brokenReserve).flatMap((model) => model.calls).filter((entry) => entry.schemaName === "council_preflight")) {
      expect(call.timeoutMs).toBeLessThanOrEqual(20000);
    }
  });

  it("stops before any drafting when fewer than three models answer the probe", async () => {
    const value = await prison();
    const original = structuredClone(value);
    const members = [new StubModel("vendor/a"), new StubModel("vendor/b", true), new StubModel("vendor/c", true)];
    const reserves = [new StubModel("vendor/r", true)];
    await expect(conductCouncil(value, baseFor(value), deps(members, reserves))).rejects.toMatchObject({ code: "validation_error" });
    expect(value).toEqual(original);
    expect(members.concat(reserves).flatMap((model) => model.workCalls())).toHaveLength(0);
  });

  it("does not probe when no reserves are configured", async () => {
    const value = await prison();
    const members = [new StubModel("vendor/a"), new StubModel("vendor/b"), new StubModel("vendor/c")];
    const result = await conductCouncil(value, baseFor(value), { members: deps(members, []).members });
    expect(members.flatMap((model) => model.calls).some((call) => call.schemaName === "council_preflight")).toBe(false);
    expect(result.review.replacements).toBeUndefined();
  });
});

describe("council reserve configuration", () => {
  const ENGINE: EngineStatus = { mode: "ai", provider: "nvidia", model: "nvidia/primary-model" };
  const ENV = { NVIDIA_API_KEY: "test-council-credential", PRISON_COUNCIL_MODE: "enabled" };

  it("uses default reserves that never repeat a seated model and makes no network call", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const council = createCouncil(ENGINE, ENV)!;
    expect(council.reserves!.map((provider) => provider.info.model)).toEqual([...DEFAULT_COUNCIL_RESERVE_MODELS]);
    const seated = createCouncil(ENGINE, { ...ENV, PRISON_COUNCIL_MODELS: "z-ai/glm-5.3,vendor/b,vendor/c" })!;
    expect(seated.reserves!.map((provider) => provider.info.model)).not.toContain("z-ai/glm-5.3");
    expect(DEFAULT_COUNCIL_RESERVE_MODELS.some((model) => (DEFAULT_COUNCIL_MODELS as readonly string[]).includes(model))).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("accepts an explicit list or none", () => {
    expect(createCouncil(ENGINE, { ...ENV, PRISON_COUNCIL_RESERVE_MODELS: " none " })!.reserves).toEqual([]);
    const explicit = createCouncil(ENGINE, { ...ENV, PRISON_COUNCIL_RESERVE_MODELS: " vendor/x , vendor/y " })!;
    expect(explicit.reserves!.map((provider) => provider.info.model)).toEqual(["vendor/x", "vendor/y"]);
  });

  it.each([
    `${DEFAULT_COUNCIL_MODELS[0]},vendor/x`,
    "vendor/x,VENDOR/X",
    "vendor/x,,vendor/y",
    "not-a-model-id",
    "a/a,b/b,c/c,d/d,e/e,f/f,g/g",
  ])("rejects invalid reserve list %s", (reserves) => {
    expect(() => createCouncil(ENGINE, { ...ENV, PRISON_COUNCIL_RESERVE_MODELS: reserves })).toThrow(AIProviderError);
  });
});
