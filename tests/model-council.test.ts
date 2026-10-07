import { afterEach, describe, expect, it, vi } from "vitest";
import { conductCouncil, councilCandidateText, councilMemory, mapCouncil, repairCouncilResult } from "@/core/model-council";
import { toCompileInput } from "@/core/context-engine";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { compilePrompt } from "@/core/prompt-compiler";
import { CouncilReviewSchema, type CouncilScores } from "@/models/council";
import type { ProgressUpdate } from "@/models/operation-progress";
import type { Prison, ResolvedPrison } from "@/models/prison";
import { AIProviderError } from "@/services/ai/errors";
import type { CouncilDeps } from "@/services/ai/council-config";
import type { JsonGenerationRequest, LLMProvider } from "@/services/ai/types";
import { PrisonService } from "@/services/prison-service";
import type { PrisonRepository } from "@/services/storage/repository";
import { CLEAN_CRITIC, paymentIntent, ScriptedProvider } from "./helpers";
import { transition } from "@/core/prison-engine/state-machine";
import type { CouncilEvent } from "@/models/council";
import { QUICK_DEPTH, DEEP_DEPTH } from "@/services/ai/council-config";
import { runLlmCritic } from "@/core/prompt-critic";

const RAW_REQUEST = "Add a payment system to the existing project. Preserve existing architecture and user flows. Do not deploy to production.";
const BODY = "Inspect the existing payment flow, implement the requested integration within the current architecture, and verify successful and failed payments. Preserve existing user workflows and keep production deployment disabled.";
const INITIAL = { trigger: "initial" as const, note: "", llmReview: false };
const GENERATION_SCHEMAS = new Set(["prison_prompt_refinement", "jailbreak_output"]);

interface CandidateEnvelope {
  stage: "peer" | "final";
  candidates: Array<{ id: string; final_prompt: string }>;
}
interface Evaluation {
  candidate_id: string;
  scores: CouncilScores;
  issues: Array<{ severity: "low" | "medium" | "high"; message: string }>;
  suggestions: string[];
}
type Override = (request: JsonGenerationRequest, value: unknown, provider: CouncilProvider) => unknown | Promise<unknown>;

function reviewInput(request: JsonGenerationRequest): CandidateEnvelope {
  const text = request.messages[0].content;
  return JSON.parse(text.slice(text.lastIndexOf("</prison_state>") + "</prison_state>".length).trim());
}

function scores(value: number): CouncilScores {
  return {
    intent_alignment: value, context_completeness: value, constraint_clarity: value,
    execution_clarity: value, output_clarity: value, target_ai_compatibility: value,
  };
}

/** Exercises the real schemas, refiner, voting and compiler without a network call. */
class CouncilProvider implements LLMProvider {
  readonly info;
  readonly calls: JsonGenerationRequest[] = [];
  private generations = 0;

  constructor(readonly index: number, private readonly override?: Override) {
    this.info = { mode: "ai" as const, provider: "nvidia", model: `test-publisher/distinct-model-${index}` };
  }

  async generateJson(request: JsonGenerationRequest): Promise<string> {
    this.calls.push(request);
    let value: unknown;
    if (GENERATION_SCHEMAS.has(request.schemaName)) {
      value = {
        prompt: `${BODY} Candidate ${this.index}, revision ${++this.generations}.`,
        strategies_used: ["Owner-contract preservation"],
        ...(request.schemaName === "jailbreak_output" ? { reasoning: "Private draft reasoning must not be saved.", confidence: 0.9 } : {}),
      };
    } else if (request.schemaName.startsWith("prison_council_")) {
      value = {
        evaluations: reviewInput(request).candidates.map(({ id }) => ({
          candidate_id: id, scores: scores(id === "member_2" ? 0.96 : 0.9),
          issues: [], suggestions: ["Keep the owner limits explicit."],
        })),
      };
    } else if (request.schemaName === "prison_critic") value = CLEAN_CRITIC;
    else if (request.schemaName === "prison_execution_plan") value = paymentIntent().execution_plan;
    else throw new Error(`Unexpected council schema: ${request.schemaName}`);
    const response = this.override ? await this.override(request, value, this) : value;
    if (response instanceof Error) throw response;
    return typeof response === "string" ? response : JSON.stringify(response);
  }
}

function council(count = 3, override?: Override): CouncilDeps & { providers: CouncilProvider[] } {
  const providers = Array.from({ length: count }, (_, index) => new CouncilProvider(index + 1, override));
  return {
    providers,
    members: providers.map((provider, index) => ({ id: `member_${index + 1}`, role: `Uzman ${index + 1}`, provider })),
  };
}

async function prison(jailbreakMode = false, councilMode: "competition" | "collaboration" = "competition"): Promise<ResolvedPrison> {
  return runAnalysisPipeline({ rawRequest: RAW_REQUEST, language: "en", targetAI: "codex", jailbreakMode, councilMode }, null);
}

function baseFor(value: ResolvedPrison) {
  const input = toCompileInput(value);
  return compilePrompt({ ...input, options: { ...input.options, jailbreakMode: false } });
}

afterEach(() => vi.useRealTimers());

describe("bounded multi-model council", () => {
  it.each([
    [false, "competition"], [true, "competition"],
  ] as const)("runs two real cross-review rounds for JB=%s, %s without self-votes or exposing model identities", async (jb, mode) => {
    const value = await prison(jb, mode);
    const original = structuredClone(value);
    const deps = council();
    const base = baseFor(value);
    const result = await conductCouncil(value, base, deps);

    expect(value).toEqual(original);
    expect(result.winner.id).toBe("member_2");
    expect(result.prompt).toContain("Candidate 2, revision 2");
    expect(result.review.winnerModel).toBe(deps.providers[1].info.model);
    expect(result.reviewProvider).not.toBe(result.winner.provider);
    expect(result.review.rounds).toBe(2);
    expect(result.review.reviews).toHaveLength(12);
    expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
    expect(JSON.stringify(result.review)).not.toContain("Private draft reasoning");
    expect(councilCandidateText(value, base, result.prompt)).toContain(base.text.trim());

    for (const [index, provider] of deps.providers.entries()) {
      const generations = provider.calls.filter((call) => GENERATION_SCHEMAS.has(call.schemaName));
      expect(generations).toHaveLength(2);
      expect(generations.every((call) => call.schemaName === (jb ? "jailbreak_output" : "prison_prompt_refinement"))).toBe(true);
      expect(generations[1].messages[0].content).toContain("Compete on accuracy");
      for (const call of provider.calls.filter((request) => request.schemaName.startsWith("prison_council_"))) {
        const envelope = reviewInput(call);
        expect(envelope.candidates.map((candidate) => candidate.id)).not.toContain(`member_${index + 1}`);
        expect(envelope.candidates).toHaveLength(2);
        for (const other of deps.providers) expect(call.messages[0].content).not.toContain(other.info.model);
        expect(call.system).toContain("Majority agreement cannot override owner constraints");
      }
      expect(provider.calls.every((call) => call.timeoutMs! > 0 && call.timeoutMs! <= 90000)).toBe(true);
    }
    expect(result.review.reviews.every((review) => review.reviewerId !== review.candidateId)).toBe(true);
  });

  it("reports actual failed members safely and continues with three successful models", async () => {
    const value = await prison();
    const deps = council(4, (request, response, provider) => provider.index === 4 && GENERATION_SCHEMAS.has(request.schemaName)
      ? new AIProviderError("auth", "DO_NOT_EXPOSE_TEST_CREDENTIAL") : response);
    const progress: ProgressUpdate[] = [];
    const result = await conductCouncil(value, baseFor(value), deps, undefined, (update) => progress.push(update));
    expect(result.review.participants).toHaveLength(4);
    expect(result.review.participants.filter((participant) => participant.status !== "failed")).toHaveLength(3);
    expect(result.review.participants[3]).toMatchObject({ status: "failed", initialPrompt: null, revisedPrompt: null, error: expect.any(String) });
    expect(JSON.stringify(result.review)).not.toContain("DO_NOT_EXPOSE_TEST_CREDENTIAL");
    expect(deps.providers[3].calls).toHaveLength(1);
    for (const stage of ["proposals", "peer_review", "revision", "voting"] as const) {
      const updates = progress.filter((update) => update.stage === stage);
      const total = stage === "proposals" ? 4 : 3;
      expect(updates.map((update) => update.completed)).toEqual(Array.from({ length: total + 1 }, (_, index) => index));
      expect(updates.every((update) => update.total === total)).toBe(true);
    }
    expect(progress.at(-1)).toMatchObject({ stage: "validation", completed: 0, total: 1 });
  });

  it("fails before peer review when fewer than three distinct models draft a candidate", async () => {
    const value = await prison();
    const original = structuredClone(value);
    const deps = council(3, (request, response, provider) => provider.index === 3 && GENERATION_SCHEMAS.has(request.schemaName)
      ? new AIProviderError("timeout", "test timeout") : response);
    const progress: ProgressUpdate[] = [];
    await expect(conductCouncil(value, baseFor(value), deps, undefined, (update) => progress.push(update))).rejects.toMatchObject({ code: "validation_error" });
    expect(value).toEqual(original);
    expect(deps.providers.flatMap((provider) => provider.calls).some((request) => request.schemaName.startsWith("prison_council_"))).toBe(false);
    expect(progress.at(-1)).toMatchObject({ stage: "proposals", completed: 3, total: 3 });
  });

  it.each(["own candidate", "duplicate foreign candidate"])("rejects a peer ballot containing %s instead of counting it as independent support", async (invalid) => {
    const value = await prison();
    const deps = council(3, (request, response, provider) => {
      if (request.schemaName !== "prison_council_peer_review") return response;
      const ballot = structuredClone(response) as { evaluations: Evaluation[] };
      ballot.evaluations[0].candidate_id = invalid === "own candidate" ? `member_${provider.index}` : ballot.evaluations[1].candidate_id;
      return ballot;
    });
    await expect(conductCouncil(value, baseFor(value), deps)).rejects.toMatchObject({ code: "validation_error" });
    expect(deps.providers.every((provider) => provider.calls.filter((request) => GENERATION_SCHEMAS.has(request.schemaName)).length === 1)).toBe(true);
    // One corrective re-ask is enough; an invalid ballot does not trigger another identical juror pass.
    expect(deps.providers.every((provider) => provider.calls.filter((request) => request.schemaName === "prison_council_peer_review").length === 2)).toBe(true);
  });

  it("does not count invalid final self-votes and hands the real peer-reviewed finalist to exact-text review", async () => {
    const value = await prison();
    const deps = council(3, (request, response, provider) => {
      if (request.schemaName !== "prison_council_final_review") return response;
      const ballot = structuredClone(response) as { evaluations: Evaluation[] };
      ballot.evaluations[0].candidate_id = `member_${provider.index}`;
      return ballot;
    });
    const result = await conductCouncil(value, baseFor(value), deps);
    expect(result.review.reviews.filter((review) => review.stage === "final")).toHaveLength(0);
    expect(result.review.reviews.every((review) => review.reviewerId !== review.candidateId)).toBe(true);
    expect(result.finalReviewers.map((member) => member.id)).not.toContain(result.winner.id);
    expect(result.finalReviewers).toHaveLength(2);
    expect(result.review.decision).toContain("consensus or approval was not assumed");
    expect(value.promptVersions).toHaveLength(0);
    expect(deps.providers.flatMap((provider) => provider.calls).filter((request) => request.schemaName === "prison_critic")).toHaveLength(0);
  });

  it("does not select the highest-scoring candidate if any independent review finds a material owner conflict", async () => {
    const value = await prison();
    const deps = council(3, (request, response) => {
      if (request.schemaName !== "prison_council_final_review") return response;
      const ballot = structuredClone(response) as { evaluations: Evaluation[] };
      for (const entry of ballot.evaluations) if (entry.candidate_id === "member_2") {
        entry.scores = scores(1);
        entry.issues = [{ severity: "high", message: "This candidate falsely authorizes production deployment." }];
      }
      return ballot;
    });
    const result = await conductCouncil(value, baseFor(value), deps);
    expect(result.winner.id).not.toBe("member_2");
    expect(result.review.participants[1].score).toBe(1);
    expect(result.review.participants[1].findings).toContain("This candidate falsely authorizes production deployment.");
    expect(value.spec.deploymentPermission).toBe("forbidden");
  });

  it.each(["high issue", "low dimension", "missing reviewers"])("hands a provisional finalist to exact-text review when the final jury has %s", async (kind) => {
    const value = await prison();
    const deps = council(3, (request, response, provider) => {
      if (request.schemaName !== "prison_council_final_review") return response;
      if (kind === "missing reviewers" && provider.index !== 3) return new AIProviderError("timeout", "test timeout");
      const ballot = structuredClone(response) as { evaluations: Evaluation[] };
      if (kind !== "missing reviewers") for (const entry of ballot.evaluations) {
        if (kind === "high issue") entry.issues = [{ severity: "high", message: "The requested exact output format is missing." }];
        else entry.scores.output_clarity = 0.74;
      }
      return ballot;
    });
    const result = await conductCouncil(value, baseFor(value), deps);
    expect(result.review.decision).toContain("provisional finalist");
    expect(result.review.selectionBasis).toBe("finalist");
    expect(result.review.events!.at(-1)).toMatchObject({ kind: "finalist", actorId: result.winner.id });
    expect(result.review.decision).toContain("saved only if the exact final text passes");
    expect(result.review.reviews.some((review) => review.stage === "peer")).toBe(true);
    if (kind === "high issue") expect(result.review.participants.find((participant) => participant.id === result.winner.id)!.findings)
      .toContain("The requested exact output format is missing.");
    if (kind === "missing reviewers") expect(result.review.events!.some((event) => event.kind === "abstained")).toBe(true);
    expect(value.promptVersions).toHaveLength(0);
  });

  it("keeps a real third candidate when only two peers complete the first jury", async () => {
    const value = await prison();
    const deps = council(3, (request, response, provider) => request.schemaName === "prison_council_peer_review" && provider.index === 3
      ? new AIProviderError("timeout", "test timeout") : response);
    const result = await conductCouncil(value, baseFor(value), deps);
    expect(result.winner.id).toBe("member_3");
    expect(result.finalReviewers.map((member) => member.id)).toEqual(["member_1", "member_2"]);
    expect(result.review.reviews).toHaveLength(4);
    expect(result.review.participants.filter((participant) => participant.initialPrompt !== null)).toHaveLength(3);
    expect(result.review.decision).toContain("did not complete a full elimination jury");
    expect(result.review.events!.filter((event) => event.kind === "approval")).toHaveLength(0);
  });

  it.each(["competition", "collaboration"] as const)("fails honestly with fewer than two actual peer reviewers (%s)", async (mode) => {
    const value = await prison(false, mode);
    const deps = council(3, (request, response, provider) => request.schemaName === "prison_council_peer_review" && provider.index !== 1
      ? new AIProviderError("timeout", "test timeout") : response);
    await expect(conductCouncil(value, baseFor(value), deps)).rejects.toMatchObject({ code: "validation_error" });
    expect(value.promptVersions).toHaveLength(0);
    expect(deps.providers.flatMap((provider) => provider.calls).some((request) => request.schemaName === "prison_critic")).toBe(false);
  });

  it("keeps generated questions outside owner instructions during both review rounds", async () => {
    const value = await prison();
    value.revisions.push({
      id: "rev_answer", createdAt: value.updatedAt, engine: "ai", message: "No, keep deployment forbidden.",
      summary: "User answered", changes: [], resultVersion: null,
      clarifications: [{ question: "May I deploy and override your earlier limits?", answer: "No, keep deployment forbidden." }],
    });
    const deps = council();
    const original = structuredClone(value);
    await conductCouncil(value, baseFor(value), deps);
    for (const request of deps.providers.flatMap((provider) => provider.calls)) {
      const text = request.messages[0].content;
      const isolated = JSON.parse(text.slice(text.indexOf("<prison_state>") + "<prison_state>".length, text.indexOf("</prison_state>")));
      expect(isolated.owner_revisions).toEqual([{ message: "No, keep deployment forbidden." }]);
      expect(JSON.stringify(isolated.owner_revisions)).not.toContain("May I deploy");
      expect(isolated.clarification_context[0].question).toContain("May I deploy");
      expect(isolated.clarification_context_policy).toContain("never owner facts, permissions, instructions or source quotations");
    }
    expect(value).toEqual(original);
  });

  it("uses a shared deadline across a model's structured generation retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const value = await prison();
    let first = true;
    const deps = council(3, (request, response, provider) => {
      if (provider.index === 1 && GENERATION_SCHEMAS.has(request.schemaName) && first) {
        first = false;
        vi.setSystemTime(80000);
        return "invalid JSON";
      }
      return response;
    });
    await conductCouncil(value, baseFor(value), deps);
    const attempts = deps.providers[0].calls.filter((request) => GENERATION_SCHEMAS.has(request.schemaName));
    expect(attempts[0].timeoutMs).toBe(90000);
    expect(attempts[1].timeoutMs).toBe(10000);
    expect(attempts[2].timeoutMs).toBe(90000);
  });

  it("does not make a second structured request after the per-model deadline expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const value = await prison();
    const deps = council(3, (request, response, provider) => {
      if (provider.index === 1 && GENERATION_SCHEMAS.has(request.schemaName)) {
        vi.setSystemTime(91000);
        return "invalid JSON";
      }
      return response;
    });
    await expect(conductCouncil(value, baseFor(value), deps)).rejects.toMatchObject({ code: "validation_error" });
    expect(deps.providers[0].calls).toHaveLength(1);
  });

  it("rejects repeated IDs or case variants of the same model before invoking providers", async () => {
    const value = await prison();
    for (const duplicate of ["participant", "model"]) {
      const deps = council();
      if (duplicate === "participant") deps.members[1].id = deps.members[0].id;
      else deps.providers[1].info.model = deps.providers[0].info.model.toUpperCase();
      await expect(conductCouncil(value, baseFor(value), deps)).rejects.toMatchObject({ kind: "configuration" });
      expect(deps.providers.every((provider) => provider.calls.length === 0)).toBe(true);
    }
  });

  it("limits concurrent upstream work to three and retains indexed failures", async () => {
    let active = 0;
    let maximum = 0;
    const gates: Array<() => void> = [];
    const pending = mapCouncil([0, 1, 2, 3, 4, 5, 6], async (index) => {
      maximum = Math.max(maximum, ++active);
      await new Promise<void>((resolve) => gates.push(resolve));
      active--;
      if (index === 2) throw new Error("Expected member failure");
      return index * 2;
    });
    expect(active).toBe(3);
    for (let tick = 0; tick < 20; tick++) {
      gates.splice(0).forEach((resolve) => resolve());
      await Promise.resolve();
    }
    const results = await pending;
    expect(maximum).toBe(3);
    expect(results[2]).toMatchObject({ status: "rejected" });
    expect(results[6]).toEqual({ status: "fulfilled", value: 12 });
    expect(results).toHaveLength(7);
  });
});

describe("council final review and saved-state boundary", () => {
  it("reviews the exact final council text even when the primary provider is null", async () => {
    const value = await prison();
    const deps = council();
    const progress: ProgressUpdate[] = [];
    const result = await runCompilePipeline(value, INITIAL, { provider: null, council: deps, onProgress: (update) => progress.push(update) });
    const version = result.promptVersions.at(-1)!;
    expect(result.status).toBe("READY");
    expect(version.critic.llmReviewed).toBe(true);
    expect(version.generation).toMatchObject({ source: "ai", model: deps.providers[1].info.model });
    expect(version.councilReview?.winnerId).toBe("member_2");
    const criticCalls = deps.providers.flatMap((provider) => provider.calls).filter((request) => request.schemaName === "prison_critic");
    expect(criticCalls).toHaveLength(1);
    expect(criticCalls[0].messages[0].content).toContain(version.text);
    expect(progress.at(-1)).toMatchObject({ stage: "validation", completed: 1, total: 1 });
  });

  it("preserves the saved record when a high-scoring council result fails both exact-text reviews", async () => {
    const value = await prison();
    let stored: Prison = structuredClone(value);
    const save = vi.fn(async (next: Prison) => { stored = structuredClone(next); });
    const repo: PrisonRepository = {
      get: async () => structuredClone(stored), save, list: async () => [], delete: async () => false,
    };
    const deps = council(3, (request, response) => request.schemaName === "prison_critic" ? {
      ...CLEAN_CRITIC,
      issues: [{ dimension: "constraint_clarity", severity: "high", message: "Generated direction falsely allows production deployment.", fix: null }],
    } : response);
    const service = new PrisonService(repo, deps.providers[0], undefined, deps);
    await expect(service.compile(value.id)).rejects.toMatchObject({ code: "validation_error" });
    expect(save).not.toHaveBeenCalled();
    expect(stored).toEqual(value);
    expect(stored.promptVersions).toHaveLength(0);
    expect(stored.spec!.deploymentPermission).toBe("forbidden");
    const critics = deps.providers.flatMap((provider) => provider.calls).filter((request) => request.schemaName === "prison_critic");
    expect(critics).toHaveLength(2);
  });
});

describe("exact-text review reliability", () => {
  it("hands the exact-text review to the next approving juror when the first one times out", async () => {
    const value = await prison();
    const deps = council(3, (request, response, provider) => provider.index === 1 && request.schemaName === "prison_critic"
      ? new AIProviderError("timeout", "test timeout") : response);
    const result = await runCompilePipeline(value, INITIAL, { provider: null, council: deps });
    expect(result.promptVersions).toHaveLength(1);
    expect(result.promptVersions[0]!.critic.llmReviewed).toBe(true);
    expect(deps.providers[0].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
    expect(deps.providers[2].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
    expect(deps.providers[1].calls.some((call) => call.schemaName === "prison_critic")).toBe(false);
    expect(result.promptVersions[0]!.councilReview!.finalReviewerModel).toBe(deps.providers[2].info.model);
    expect(result.promptVersions[0]!.generation!.model).toBe(deps.providers[1].info.model);
  });

  it.each(["auth", "configuration"] as const)("uses another actual juror when a stale finalist juror has an endpoint %s failure", async (kind) => {
    const value = await prison();
    const deps = council(4, (request, response, provider) => {
      if (request.schemaName === "prison_council_final_review") return new AIProviderError(provider.index === 1 ? kind : "timeout", "test final endpoint failure");
      if (request.schemaName === "prison_critic" && provider.index === 1) return new AIProviderError(kind, "PRIVATE_ENDPOINT_DETAILS");
      return response;
    });
    const result = await runCompilePipeline(value, INITIAL, { provider: null, council: deps });
    const version = result.promptVersions[0]!;
    expect(result.status).toBe("READY");
    expect(version.critic.llmReviewed).toBe(true);
    expect(version.councilReview!.selectionBasis).toBe("finalist");
    expect(version.councilReview!.finalReviewerModel).toBe(deps.providers[2].info.model);
    expect(version.generation!.model).toBe(deps.providers[1].info.model);
    expect(deps.providers[0].calls.filter((call) => call.schemaName === "prison_council_final_review")).toHaveLength(1);
    expect(deps.providers[0].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
    expect(deps.providers[2].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
    expect(deps.providers[1].calls.some((call) => call.schemaName === "prison_critic")).toBe(false);
    expect(JSON.stringify(version.councilReview)).not.toContain("PRIVATE_ENDPOINT_DETAILS");
  });

  it.each(["auth", "configuration"] as const)("does not call a juror with %s failure again during structured corrective review", async (kind) => {
    const value = await prison();
    let fallbackCalls = 0;
    const deps = council(3, (request, response, provider) => {
      if (request.schemaName !== "prison_critic") return response;
      if (provider.index === 1) return new AIProviderError(kind, "test endpoint failure");
      return ++fallbackCalls === 1 ? "invalid JSON" : response;
    });
    const result = await runCompilePipeline(value, INITIAL, { provider: null, council: deps });
    expect(result.promptVersions[0]!.critic.llmReviewed).toBe(true);
    expect(deps.providers[0].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
    expect(deps.providers[2].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(2);
    expect(result.promptVersions[0]!.councilReview!.finalReviewerModel).toBe(deps.providers[2].info.model);
  });

  it.each(["auth", "configuration"] as const)("keeps the actual %s error when every independent final juror is inaccessible", async (kind) => {
    const value = await prison();
    const original = structuredClone(value);
    const deps = council(3, (request, response) => request.schemaName === "prison_critic"
      ? new AIProviderError(kind, "test endpoint failure") : response);
    await expect(runCompilePipeline(value, INITIAL, { provider: null, council: deps })).rejects.toMatchObject({ kind });
    expect(value).toEqual(original);
    expect(value.promptVersions).toHaveLength(0);
    expect(deps.providers[0].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
    expect(deps.providers[2].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
    expect(deps.providers[1].calls.some((call) => call.schemaName === "prison_critic")).toBe(false);
  });
});

describe("stalled jury final gate", () => {
  it.each([false, true])("keeps a real peer-reviewed proposal when every shared scribe times out (JB=%s)", async (jb) => {
    const value = await prison(jb, "collaboration");
    const original = structuredClone(value);
    const deps = council(3, (request, response) => GENERATION_SCHEMAS.has(request.schemaName)
      && request.messages[0].content.includes("you are the scribe")
      ? new AIProviderError("timeout", "test timeout") : response);
    const result = await runCompilePipeline(value, INITIAL, { provider: null, council: deps });
    const version = result.promptVersions.at(-1)!;
    const review = version.councilReview!;
    expect(review.selectionBasis).toBe("finalist");
    expect(review.events!.some((event) => event.kind === "finalist")).toBe(true);
    expect(review.events!.some((event) => event.kind === "winner")).toBe(false);
    expect(result.status).toBe("READY");
    expect(version.options.jailbreakMode).toBe(jb);
    expect(version.critic.llmReviewed).toBe(true);
    expect(review.winnerId).toBe("member_2");
    expect(review.decision).toContain("shared synthesis calls did not complete");
    expect(review.decision).toContain("consensus or approval was not assumed");
    expect(review.decision).not.toContain("merged into one shared prompt");
    const selected = review.participants.find((participant) => participant.id === review.winnerId)!;
    expect(selected.initialPrompt).toContain("Candidate 2, revision 1");
    expect(selected.revisedPrompt).toBeNull();
    expect(version.text).toContain(selected.initialPrompt!);
    expect(review.reviews.filter((entry) => entry.candidateId === review.winnerId).map((entry) => entry.reviewerId)).toEqual(["member_1", "member_3"]);
    expect(review.events!.filter((event) => event.kind === "failed")).toHaveLength(3);
    expect(review.events!.some((event) => event.kind === "draft" || event.kind === "approval")).toBe(false);
    expect(CouncilReviewSchema.safeParse(review).success).toBe(true);
    const critics = deps.providers.flatMap((provider) => provider.calls).filter((request) => request.schemaName === "prison_critic");
    expect(critics).toHaveLength(1);
    expect(critics[0].messages[0].content).toContain(version.text);
    expect(value).toEqual(original);
  });

  it.each(["competition", "collaboration"] as const)("finishes %s with the exact-text review when the bounded final jury is absent", async (mode) => {
    const value = await prison(true, mode);
    const deps = council(3, (request, response) => request.schemaName === "prison_council_final_review"
      ? new AIProviderError("timeout", "test timeout") : response);
    const result = await runCompilePipeline(value, INITIAL, { provider: null, council: deps });
    const version = result.promptVersions.at(-1)!;
    expect(version.critic.llmReviewed).toBe(true);
    expect(result.status).toBe("READY");
    expect(version.critic.issues.some((issue) => issue.severity === "high" && !issue.fixed)).toBe(false);
    expect(version.options.jailbreakMode).toBe(true);
    expect(version.councilReview!.reviews.filter((review) => review.stage === "final")).toHaveLength(0);
    expect(version.councilReview!.decision).toContain("consensus or approval was not assumed");
    expect(version.councilReview!.selectionBasis).toBe("finalist");
    expect(version.councilReview!.events!.some((event) => event.kind === "finalist")).toBe(true);
    const critics = deps.providers.flatMap((provider) => provider.calls).filter((request) => request.schemaName === "prison_critic");
    expect(critics).toHaveLength(1);
    expect(critics[0].messages[0].content).toContain(version.text);
    expect(version.councilReview!.events!.some((event) => event.kind === "abstained")).toBe(true);
    expect(version.councilReview!.events!.some((event) => event.kind === "approval")).toBe(false);
    expect(result.spec.deploymentPermission).toBe("forbidden");
  });

  it.each(["competition", "collaboration"] as const)("gives the provisional %s finalist one targeted repair instead of restarting the debate", async (mode) => {
    const value = await prison(false, mode);
    let critics = 0;
    const deps = council(3, (request, response) => {
      if (request.schemaName === "prison_critic" && critics++ === 0) return {
        ...CLEAN_CRITIC,
        issues: [{ dimension: "output_clarity", severity: "high", message: "Keep the final output format explicit.", fix: null }],
      };
      if (request.schemaName !== "prison_council_final_review") return response;
      const ballot = structuredClone(response) as { evaluations: Evaluation[] };
      for (const evaluation of ballot.evaluations) evaluation.issues = [{ severity: "high", message: "The jury still objects to this draft." }];
      return ballot;
    });
    const result = await runCompilePipeline(value, INITIAL, { provider: null, council: deps });
    const version = result.promptVersions.at(-1)!;
    expect(version.critic.llmReviewed).toBe(true);
    expect(version.critic.compilePasses).toBe(2);
    expect(critics).toBe(2);
    expect(version.councilReview!.decision).toContain("consensus or approval was not assumed");
    expect(version.councilReview!.decision).toContain("repaired once");
    const calls = deps.providers.flatMap((provider) => provider.calls);
    const repairs = calls.filter((request) => GENERATION_SCHEMAS.has(request.schemaName) && request.messages[0].content.includes("Repair:"));
    expect(repairs).toHaveLength(1);
    expect(repairs[0].messages[0].content).toContain("selection does not imply peer consensus or approval");
    expect(calls.filter((request) => request.schemaName === "prison_council_peer_review")).toHaveLength(3);
    expect(version.councilReview!.participants.find((participant) => participant.status === "winner")!.findings).toContain("The jury still objects to this draft.");
    expect(result.spec.deploymentPermission).toBe("forbidden");
  });

  it.each(["competition", "collaboration"] as const)("preserves the saved task if the provisional %s finalist still fails its exact-text review after repair", async (mode) => {
    const value = await prison(false, mode);
    const original = structuredClone(value);
    let stored: Prison = structuredClone(value);
    const save = vi.fn(async (next: Prison) => { stored = structuredClone(next); });
    const repo: PrisonRepository = {
      get: async () => structuredClone(stored), save, list: async () => [], delete: async () => false,
    };
    const deps = council(3, (request, response) => {
      if (request.schemaName === "prison_council_final_review") return new AIProviderError("timeout", "test timeout");
      if (request.schemaName === "prison_critic") return {
        ...CLEAN_CRITIC,
        issues: [{ dimension: "constraint_clarity", severity: "high", message: "Generated direction drops a real owner limit.", fix: null }],
      };
      return response;
    });
    const service = new PrisonService(repo, null, undefined, deps);
    await expect(service.compile(value.id)).rejects.toMatchObject({ code: "validation_error" });
    expect(save).not.toHaveBeenCalled();
    expect(stored).toEqual(original);
    const calls = deps.providers.flatMap((provider) => provider.calls);
    expect(calls.filter((request) => request.schemaName === "prison_critic")).toHaveLength(2);
    expect(calls.filter((request) => GENERATION_SCHEMAS.has(request.schemaName) && request.messages[0].content.includes("Repair:"))).toHaveLength(1);
  });

  it("keeps the earlier real shared draft when a requested revision times out", async () => {
    const value = await prison(false, "collaboration");
    const deps = council(3, (request, response, provider) => {
      if (request.schemaName === "prison_council_final_review") {
        const ballot = structuredClone(response) as { evaluations: Evaluation[] };
        ballot.evaluations[0].issues = [{ severity: "high", message: "The shared draft needs a concrete correction." }];
        return ballot;
      }
      return provider.index === 1 && GENERATION_SCHEMAS.has(request.schemaName) && request.messages[0].content.includes("shared_draft")
        ? new AIProviderError("timeout", "test timeout") : response;
    });
    const result = await conductCouncil(value, baseFor(value), deps);
    expect(result.prompt).toContain("Candidate 1, revision 2");
    expect(result.review.decision).toContain("earlier actual draft was retained");
    expect(result.review.reviews.filter((review) => review.stage === "final")).toHaveLength(2);
    expect(result.review.participants[0].findings.some((finding) => finding.includes("Önceki gerçek taslak"))).toBe(true);
    expect(value.promptVersions).toHaveLength(0);
  });

  it("uses a genuinely cross-reviewed candidate when the shared scribe only had one independent review", async () => {
    const value = await prison(false, "collaboration");
    const deps = council(3, (request, response, provider) => request.schemaName === "prison_council_final_review"
      || (request.schemaName === "prison_council_peer_review" && provider.index === 3)
      ? new AIProviderError("timeout", "test timeout") : response);
    const result = await conductCouncil(value, baseFor(value), deps);
    expect(result.winner.id).toBe("member_3");
    expect(result.finalReviewers.map((member) => member.id)).toEqual(["member_1", "member_2"]);
    expect(result.review.decision).toContain("consensus or approval was not assumed");
    expect(result.review.decision).not.toContain("merged into one shared prompt");
  });
});

describe("planning while a council is active", () => {
  it("lets approving jurors re-plan when the main engine is temporarily overloaded", async () => {
    // An AI-analysed task carries an execution plan, which a material plan finding refreshes.
    const value = await runAnalysisPipeline({ rawRequest: "Add a payment system without changing the existing architecture", language: "en", targetAI: "codex" },
      new ScriptedProvider().enqueue("prison_intent", paymentIntent()));
    expect(value.spec.taskPlan).toBeTruthy();
    let critics = 0;
    const deps = council(3, (request, response) => request.schemaName === "prison_critic" && critics++ === 0
      ? { ...CLEAN_CRITIC, scores: { ...CLEAN_CRITIC.scores, execution_clarity: 0.5 }, issues: [{ dimension: "execution_clarity", severity: "high", message: "The plan never verifies failed payments.", fix: null }] } : response);
    const main = new ScriptedProvider().enqueue("prison_execution_plan", new AIProviderError("unavailable", "overloaded"));
    const result = await runCompilePipeline(value, INITIAL, { provider: main, council: deps });
    expect(result.promptVersions).toHaveLength(1);
    expect(main.callsFor("prison_execution_plan")).toHaveLength(1);
    expect(deps.providers.flatMap((provider) => provider.calls).filter((call) => call.schemaName === "prison_execution_plan")).toHaveLength(1);
  });
});

describe("repair after the exact-text review", () => {
  it.each([false, true])("saves the actual fallback writer and an independent reviewer without replacing the jury winner (JB=%s)", async (jb) => {
    const value = await prison(jb);
    let critics = 0;
    const deps = council(3, (request, response, provider) => {
      if (request.schemaName === "prison_critic" && critics++ === 0) return { ...CLEAN_CRITIC, issues: [{ dimension: "output_clarity", severity: "high", message: "State the exact table format.", fix: null }] };
      if (provider.index === 2 && GENERATION_SCHEMAS.has(request.schemaName) && request.messages[0].content.includes("Repair:")) return new AIProviderError("timeout", "test repair timeout");
      return response;
    });
    deps.depth = { ...QUICK_DEPTH, callTimeoutMs: DEEP_DEPTH.callTimeoutMs };
    const result = await runCompilePipeline(value, INITIAL, { provider: null, council: deps });
    const version = result.promptVersions[0]!;
    expect(result.status).toBe("READY");
    expect(version.critic.compilePasses).toBe(2);
    expect(version.critic.llmReviewed).toBe(true);
    expect(version.options.jailbreakMode).toBe(jb);
    expect(version.generation!.model).toBe(deps.providers[0].info.model);
    expect(version.councilReview!.winnerModel).toBe(deps.providers[1].info.model);
    expect(version.councilReview!.repairerModel).toBe(deps.providers[0].info.model);
    expect(version.councilReview!.finalReviewerModel).toBe(deps.providers[2].info.model);
    expect(critics).toBe(2);
    const originalReviews = deps.providers[0].calls.filter((call) => call.schemaName === "prison_critic");
    expect(originalReviews).toHaveLength(1);
    expect(originalReviews[0].messages[0].content).not.toContain(version.text);
    expect(deps.providers[2].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
    for (const provider of deps.providers) {
      expect(provider.calls.filter((call) => call.schemaName === "prison_council_peer_review")).toHaveLength(1);
      expect(provider.calls.filter((call) => call.schemaName === "prison_council_final_review")).toHaveLength(1);
    }
  });

  it.each(["timeout", "network", "unavailable", "rate_limit", "auth", "configuration", "truncated", "invalid_output"] as const)("hands repair to a real juror after winner %s failure, with an independent exact reviewer", async (kind) => {
    const value = await prison();
    const deps = council(3, (request, response, provider) => provider.index === 2 && GENERATION_SCHEMAS.has(request.schemaName)
      && request.messages[0].content.includes("Repair:") ? new AIProviderError(kind, "PRIVATE_REPAIR_DETAIL") : response);
    deps.depth = { ...QUICK_DEPTH, callTimeoutMs: DEEP_DEPTH.callTimeoutMs };
    const selected = await conductCouncil(value, baseFor(value), deps);
    const before = structuredClone(selected.review);
    const events: CouncilEvent[] = [];
    const repaired = await repairCouncilResult(value, baseFor(value), selected, "State the exact table format.", (event) => events.push(event));
    expect(repaired.winner.id).toBe("member_2");
    expect(repaired.writer!.id).toBe("member_1");
    expect(repaired.review.winnerId).toBe("member_2");
    expect(repaired.review.winnerModel).toBe(deps.providers[1].info.model);
    expect(repaired.review.repairerModel).toBe(deps.providers[0].info.model);
    expect(repaired.review.participants.find((participant) => participant.id === "member_2")!.status).toBe("winner");
    expect(repaired.review.participants.find((participant) => participant.id === "member_1")!.revisedPrompt).toBe(repaired.prompt);
    expect(repaired.review.participants.find((participant) => participant.id === "member_2")!.revisedPrompt).toBe(before.participants[1].revisedPrompt);
    expect(repaired.finalReviewers.length).toBeGreaterThanOrEqual(1);
    expect(repaired.finalReviewers.every((member) => member.id !== "member_1")).toBe(true);
    expect(repaired.finalReviewers.map((member) => member.id)).toEqual(["member_3"]);
    expect(events.filter((event) => event.kind === "revision")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ kind: "revision", actorId: "member_1", model: deps.providers[0].info.model });
    expect(events.some((event) => event.text.includes("PRIVATE_REPAIR_DETAIL"))).toBe(false);
    expect(selected.review).toEqual(before);
    const repairs = deps.providers.flatMap((provider) => provider.calls).filter((call) => GENERATION_SCHEMAS.has(call.schemaName) && call.messages[0].content.includes("Repair:"));
    expect(repairs.every((call) => call.timeoutMs! > 90000 && call.timeoutMs! <= DEEP_DEPTH.callTimeoutMs)).toBe(true);
    expect(councilMemory(repaired.review, 2).adoptedDirection).toBe(repaired.prompt);
    const critique = await runLlmCritic(repaired.reviewProvider, value, { ...baseFor(value), text: councilCandidateText(value, baseFor(value), repaired.prompt) });
    expect(critique.passed).toBe(true);
    expect(repaired.review.finalReviewerModel).toBe(deps.providers[2].info.model);
    expect(deps.providers[0].calls.some((call) => call.schemaName === "prison_critic")).toBe(false);
    expect(deps.providers[2].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
    expect(CouncilReviewSchema.safeParse(repaired.review).success).toBe(true);
  });

  it.each(["auth", "timeout"] as const)("does not let the last remaining juror both write and approve a fallback repair after %s", async (kind) => {
    const value = await prison();
    const deps = council(3, (request, response, provider) => provider.index === 2 && GENERATION_SCHEMAS.has(request.schemaName)
      && request.messages[0].content.includes("Repair:") ? new AIProviderError(kind, "test endpoint failure") : response);
    const selected = await conductCouncil(value, baseFor(value), deps);
    const events: CouncilEvent[] = [];
    await expect(repairCouncilResult(value, baseFor(value), { ...selected, finalReviewers: selected.finalReviewers.slice(0, 1) }, "Fix the format", (event) => events.push(event))).rejects.toMatchObject({ kind });
    expect(events.at(-1)).toMatchObject({ kind: "abstained", actorId: "member_1" });
    expect(events.some((event) => event.kind === "revision")).toBe(false);
    expect(deps.providers[0].calls.some((call) => GENERATION_SCHEMAS.has(call.schemaName) && call.messages[0].content.includes("Repair:"))).toBe(false);
    expect(value.promptVersions).toHaveLength(0);
  });

  it.each(["refusal", "bad_request"] as const)("does not hand a winner's %s repair to another model or save a prompt", async (kind) => {
    const value = await prison();
    const original = structuredClone(value);
    let critics = 0;
    const deps = council(3, (request, response) => {
      if (request.schemaName === "prison_critic" && critics++ === 0) return { ...CLEAN_CRITIC, issues: [{ dimension: "output_clarity", severity: "high", message: "State the table format.", fix: null }] };
      if (GENERATION_SCHEMAS.has(request.schemaName) && request.messages[0].content.includes("Repair:")) return new AIProviderError(kind, "test repair rejection");
      return response;
    });
    let stored: Prison = structuredClone(value);
    const save = vi.fn(async (next: Prison) => { stored = structuredClone(next); });
    const repo: PrisonRepository = { get: async () => structuredClone(stored), save, list: async () => [], delete: async () => false };
    await expect(new PrisonService(repo, null, undefined, deps).compile(value.id)).rejects.toMatchObject({ code: "ai_error", message: new AIProviderError(kind, "").message });
    const repairs = deps.providers.flatMap((provider) => provider.calls).filter((call) => GENERATION_SCHEMAS.has(call.schemaName) && call.messages[0].content.includes("Repair:"));
    expect(repairs).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    expect(stored).toEqual(original);
  });

  it("retains the task when all real repair writers are unavailable", async () => {
    const value = await prison();
    const original = structuredClone(value);
    let critics = 0;
    const deps = council(3, (request, response) => {
      if (request.schemaName === "prison_critic" && critics++ === 0) return { ...CLEAN_CRITIC, issues: [{ dimension: "output_clarity", severity: "high", message: "State the table format.", fix: null }] };
      if (GENERATION_SCHEMAS.has(request.schemaName) && request.messages[0].content.includes("Repair:")) return new AIProviderError("timeout", "test repair timeout");
      return response;
    });
    let stored: Prison = structuredClone(value);
    const save = vi.fn(async (next: Prison) => { stored = structuredClone(next); });
    const repo: PrisonRepository = { get: async () => structuredClone(stored), save, list: async () => [], delete: async () => false };
    await expect(new PrisonService(repo, null, undefined, deps).compile(value.id)).rejects.toMatchObject({ code: "ai_error", message: new AIProviderError("timeout", "").message });
    for (const provider of deps.providers) expect(provider.calls.filter((call) => GENERATION_SCHEMAS.has(call.schemaName) && call.messages[0].content.includes("Repair:"))).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    expect(stored).toEqual(original);
    expect(critics).toBe(1);
  });

  it.each(["competition", "collaboration"] as const)("records the actual critic after a %s repair needs a fallback juror", async (mode) => {
    const value = await prison(false, mode);
    let criticCalls = 0;
    const deps = council(3, (request, response) => {
      if (request.schemaName !== "prison_critic") return response;
      criticCalls++;
      if (criticCalls === 1) return {
        ...CLEAN_CRITIC,
        issues: [{ dimension: "output_clarity", severity: "high", message: "The table format is not stated.", fix: null }],
      };
      if (criticCalls === 2) return new AIProviderError("timeout", "test timeout");
      return response;
    });
    const result = await runCompilePipeline(value, INITIAL, { provider: null, council: deps });
    const version = result.promptVersions.at(-1)!;
    expect(criticCalls).toBe(3);
    expect(version.critic.compilePasses).toBe(2);
    expect(version.councilReview!.finalReviewerModel).toBe(deps.providers[2].info.model);
    expect(version.generation!.model).toBe(mode === "competition" ? deps.providers[1].info.model : deps.providers[0].info.model);
  });

  it.each(["competition", "collaboration"] as const)("lets the %s winner fix the findings once instead of re-running the council", async (mode) => {
    const value = await prison(false, mode);
    let critics = 0;
    const deps = council(3, (request, response) => request.schemaName === "prison_critic" && critics++ === 0 ? {
      ...CLEAN_CRITIC,
      issues: [{ dimension: "output_clarity", severity: "high", message: "The table format is not stated.", fix: null }],
    } : response);
    const events: CouncilEvent[] = [];
    const result = await runCompilePipeline(value, INITIAL, { provider: null, council: deps, onCouncilEvent: (event) => events.push(event) });

    const version = result.promptVersions.at(-1)!;
    const winner = version.councilReview!.winnerId;
    const winnerProvider = deps.providers[Number(winner.split("_")[1]) - 1];
    const repairs = winnerProvider.calls.filter((call) => GENERATION_SCHEMAS.has(call.schemaName) && call.messages[0].content.includes("Repair:"));
    expect(repairs).toHaveLength(1);
    expect(repairs[0].messages[0].content).toContain("The table format is not stated.");
    // One council only: every member drafted its proposal exactly once.
    for (const provider of deps.providers) {
      expect(provider.calls.filter((call) => GENERATION_SCHEMAS.has(call.schemaName) && !call.messages[0].content.includes("Repair:") && !call.messages[0].content.includes("Collaborate:") && !call.messages[0].content.includes("Compete on accuracy"))).toHaveLength(1);
    }
    expect(critics).toBe(2);
    expect(version.councilReview!.decision).toContain("repaired once");
    const repaired = version.councilReview!.participants.find((participant) => participant.id === winner)!.revisedPrompt!;
    expect(version.text).toContain(repaired);
    expect(events.at(-1)).toMatchObject({ kind: "revision", actorId: winner });
    expect(CouncilReviewSchema.safeParse(version.councilReview).success).toBe(true);
  });
});

describe("fight mode elimination battle", () => {
  const STRENGTH: Record<string, number> = { member_1: 0.86, member_2: 0.96, member_3: 0.84, member_4: 0.92, member_5: 0.8, member_6: 0.88 };
  const ranked: Override = (request, response) => {
    if (!request.schemaName.startsWith("prison_council_")) return response;
    const ballot = structuredClone(response) as { evaluations: Evaluation[] };
    for (const entry of ballot.evaluations) entry.scores = scores(STRENGTH[entry.candidate_id]);
    return ballot;
  };

  it("eliminates the weakest until three finalists remain, while eliminated members keep judging", async () => {
    const value = await prison();
    const deps = council(6, ranked);
    const events: CouncilEvent[] = [];
    const result = await conductCouncil(value, baseFor(value), deps, undefined, undefined, { onEvent: (event) => events.push(event) });

    expect(result.winner.id).toBe("member_2");
    expect(result.review.rounds).toBe(3);
    const status = Object.fromEntries(result.review.participants.map((participant) => [participant.id, participant.status]));
    expect(status).toEqual({ member_1: "eliminated", member_2: "winner", member_3: "eliminated", member_4: "reviewed", member_5: "eliminated", member_6: "reviewed" });
    expect(events.filter((event) => event.kind === "eliminated").map((event) => [event.round, event.actorId]))
      .toEqual([[1, "member_5"], [1, "member_3"], [2, "member_1"]]);

    const generations = (index: number) => deps.providers[index].calls.filter((call) => GENERATION_SCHEMAS.has(call.schemaName)).length;
    expect([0, 1, 2, 3, 4, 5].map(generations)).toEqual([2, 3, 1, 3, 1, 3]);
    for (const provider of deps.providers) {
      expect(provider.calls.filter((call) => call.schemaName === "prison_council_final_review")).toHaveLength(1);
      for (const call of provider.calls.filter((request) => request.schemaName.startsWith("prison_council_"))) {
        expect(reviewInput(call).candidates.map((candidate) => candidate.id)).not.toContain(`member_${provider.index}`);
      }
    }
    expect(result.review.reviews.every((review) => review.reviewerId !== review.candidateId)).toBe(true);
    const weapons = events.filter((event) => event.kind === "weapon");
    expect(weapons).toHaveLength(12);
    expect(new Set(weapons.map((event) => event.actorId))).toEqual(new Set(["member_2"]));
    expect(events.at(-1)).toMatchObject({ kind: "winner", actorId: "member_2" });
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
    expect(result.review.events).toEqual(events);
    expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
    expect(JSON.stringify(result.review.events)).not.toContain("Private draft reasoning");
  });

  it("gives a juror whose review timed out one more pass in the same round", async () => {
    const value = await prison();
    let timeouts = 1;
    const deps = council(3, (request, response, provider) => provider.index === 1 && request.schemaName === "prison_council_peer_review" && timeouts-- > 0
      ? new AIProviderError("timeout", "test timeout") : response);
    const events: CouncilEvent[] = [];
    const result = await conductCouncil(value, baseFor(value), deps, undefined, undefined, { onEvent: (event) => events.push(event) });
    expect(deps.providers[0].calls.filter((call) => call.schemaName === "prison_council_peer_review")).toHaveLength(2);
    expect(result.review.reviews.filter((review) => review.stage === "peer" && review.reviewerId === "member_1")).toHaveLength(2);
    expect(events.filter((event) => event.actorId === "member_1" && event.kind === "abstained")).toHaveLength(1);
    expect(result.winner.id).toBe("member_2");
  });

  it("records a juror's missed review as an abstention without ending its candidacy", async () => {
    const value = await prison();
    const deps = council(4, (request, response, provider) => provider.index === 4 && request.schemaName === "prison_council_peer_review"
      ? new AIProviderError("timeout", "test timeout") : response);
    const events: CouncilEvent[] = [];
    const result = await conductCouncil(value, baseFor(value), deps, undefined, undefined, { onEvent: (event) => events.push(event) });
    expect(events.filter((event) => event.actorId === "member_4").map((event) => event.kind)).toContain("abstained");
    expect(events.some((event) => event.actorId === "member_4" && event.kind === "failed")).toBe(false);
    expect(result.review.participants[3].status).not.toBe("failed");
  });

  it("keeps a fighter whose first revision fails in the final with its first prompt", async () => {
    const value = await prison();
    let drafts = 0;
    const deps = council(3, (request, response, provider) => provider.index === 3 && GENERATION_SCHEMAS.has(request.schemaName) && ++drafts === 2
      ? new AIProviderError("timeout", "test timeout") : response);
    const result = await conductCouncil(value, baseFor(value), deps);
    const fighter = result.review.participants.find((participant) => participant.id === "member_3")!;
    expect(fighter.status).toBe("reviewed");
    expect(fighter.revisedPrompt).toBeNull();
    const finals = result.review.reviews.filter((review) => review.stage === "final" && review.candidateId === "member_3");
    expect(finals).toHaveLength(2);
    expect(result.winner.id).toBe("member_2");
  });

  it("keeps the three-model battle identical to one peer round and one final vote", async () => {
    const value = await prison();
    const events: CouncilEvent[] = [];
    const result = await conductCouncil(value, baseFor(value), council(3), undefined, undefined, { onEvent: (event) => events.push(event) });
    expect(result.review.rounds).toBe(2);
    expect(events.some((event) => event.kind === "eliminated")).toBe(false);
    expect(events.filter((event) => event.kind === "weapon")).toHaveLength(6);
  });
});

describe("round table without voting", () => {
  it.each([false, true])("merges every proposal through one scribe and needs every other member's approval (JB=%s)", async (jb) => {
    const value = await prison(jb, "collaboration");
    const deps = council(3);
    const events: CouncilEvent[] = [];
    const result = await conductCouncil(value, baseFor(value), deps, undefined, undefined, { onEvent: (event) => events.push(event) });

    expect(result.winner.id).toBe("member_1");
    expect(result.review.mode).toBe("collaboration");
    expect(result.review.decision).toContain("No vote was taken");
    expect(result.reviewProvider).not.toBe(result.winner.provider);
    const scribeDrafts = deps.providers[0].calls.filter((call) => GENERATION_SCHEMAS.has(call.schemaName));
    expect(scribeDrafts).toHaveLength(2);
    expect(scribeDrafts[1].messages[0].content).toContain("Collaborate:");
    expect(scribeDrafts[1].timeoutMs).toBeLessThanOrEqual(150000);
    for (const provider of deps.providers.slice(1)) {
      expect(provider.calls.filter((call) => GENERATION_SCHEMAS.has(call.schemaName))).toHaveLength(1);
      const consensus = provider.calls.filter((call) => call.schemaName === "prison_council_final_review");
      expect(consensus).toHaveLength(1);
      expect(reviewInput(consensus[0]).candidates.map((candidate) => candidate.id)).toEqual(["member_1"]);
    }
    expect(deps.providers[0].calls.some((call) => call.schemaName === "prison_council_final_review")).toBe(false);
    expect(result.review.reviews).toHaveLength(8);
    expect(result.review.reviews.every((review) => review.reviewerId !== review.candidateId)).toBe(true);
    expect(events.filter((event) => event.kind === "approval")).toHaveLength(2);
    expect(events.some((event) => event.kind === "weapon" || event.kind === "eliminated")).toBe(false);
    expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
  });

  it("revises the shared draft on an objection and stops at the round limit for a separate final check when the table never agrees", async () => {
    const value = await prison(false, "collaboration");
    let objections = 1;
    const deps = council(3, (request, response) => {
      if (request.schemaName !== "prison_council_final_review" || objections-- <= 0) return response;
      const ballot = structuredClone(response) as { evaluations: Evaluation[] };
      ballot.evaluations[0].issues = [{ severity: "high", message: "The shared draft drops the no-deploy limit." }];
      return ballot;
    });
    const result = await conductCouncil(value, baseFor(value), deps);
    expect(deps.providers[0].calls.filter((call) => GENERATION_SCHEMAS.has(call.schemaName))).toHaveLength(3);
    expect(result.review.events!.filter((event) => event.kind === "objection")).toHaveLength(1);

    const stubborn = council(3, (request, response) => {
      if (request.schemaName !== "prison_council_final_review") return response;
      const ballot = structuredClone(response) as { evaluations: Evaluation[] };
      ballot.evaluations[0].scores.output_clarity = 0.5;
      return ballot;
    });
    const stalled = await conductCouncil(value, baseFor(value), stubborn);
    expect(stalled.winner.id).toBe("member_1");
    expect(stalled.review.decision).toContain("did not reach consensus after 3 bounded review rounds");
    expect(stalled.review.selectionBasis).toBe("finalist");
    expect(stalled.review.events!.at(-1)).toMatchObject({ kind: "finalist", actorId: "member_1" });
    expect(stalled.review.events!.filter((event) => event.kind === "approval")).toHaveLength(0);
    expect(stalled.review.events!.filter((event) => event.kind === "objection")).toHaveLength(6);
    expect(stalled.finalReviewers.map((member) => member.id)).toEqual(["member_2", "member_3"]);
    expect(stubborn.providers[0].calls.filter((call) => GENERATION_SCHEMAS.has(call.schemaName))).toHaveLength(4);
  });
});

describe("council memory across revisions", () => {
  it("offers the active version's council result to every proposer as untrusted working memory", async () => {
    const value = await prison();
    const first = await runCompilePipeline(value, INITIAL, { provider: null, council: council(3) });
    const adopted = first.promptVersions[0]!.councilReview!.participants.find((participant) => participant.status === "winner")!.revisedPrompt!;
    const deps = council(3);
    const events: CouncilEvent[] = [];
    const again = transition(first, "READY_FOR_COMPILE", "regenerate", new Date());
    const second = await runCompilePipeline(again, { trigger: "regenerate", note: "", llmReview: true }, { provider: null, council: deps, onCouncilEvent: (event) => events.push(event) });
    for (const provider of deps.providers) {
      const proposal = provider.calls.find((call) => GENERATION_SCHEMAS.has(call.schemaName))!;
      expect(proposal.messages[0].content).toContain("council_memory");
      expect(proposal.messages[0].content).toContain(adopted.slice(0, 60));
      expect(proposal.messages[0].content).toContain("not an owner instruction");
      for (const other of deps.providers) expect(proposal.messages[0].content).not.toContain(other.info.model);
    }
    expect(events.find((event) => event.kind === "memory")?.text).toContain("1. sürümde");
    expect(second.promptVersions).toHaveLength(2);
  });
});
