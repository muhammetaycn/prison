import { describe, expect, it } from "vitest";
import { conductCouncil } from "@/core/model-council";
import { toCompileInput } from "@/core/context-engine";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import { compilePrompt } from "@/core/prompt-compiler";
import { CouncilReviewSchema, type CouncilEvent } from "@/models/council";
import type { ResolvedPrison } from "@/models/prison";
import { createCouncil, DEEP_DEPTH, QUICK_DEPTH, type CouncilDeps } from "@/services/ai/council-config";
import type { EngineStatus } from "@/services/ai/config";
import { AIProviderError } from "@/services/ai/errors";
import type { JsonGenerationRequest, LLMProvider } from "@/services/ai/types";
import { OWNER_INTERPRETATION_RULES } from "@/templates/owner-interpretation";
import { OperationProgressSchema, type ProgressUpdate } from "@/models/operation-progress";

const RAW_REQUEST = "Add a payment system to the existing project. Preserve existing architecture and user flows. Do not deploy to production.";
const BODY = "Inspect the existing payment flow, implement the requested integration within the current architecture, and verify successful and failed payments. Preserve existing user workflows and keep production deployment disabled.";
const GENERATION = new Set(["prison_prompt_refinement", "jailbreak_output"]);

type Ballot = (request: JsonGenerationRequest, call: number, candidate: string, reviewer: number) => { scores?: number; issues?: Array<{ severity: "low" | "medium" | "high"; message: string }> };

/** Answers every council schema; `ballot` shapes each evaluation it returns. */
class Model implements LLMProvider {
  readonly info;
  readonly calls: JsonGenerationRequest[] = [];
  private drafts = 0;
  private ballots = 0;

  constructor(readonly index: number, private readonly ballot?: Ballot) {
    this.info = { mode: "ai" as const, provider: "nvidia", model: `vendor/deep-${index}` };
  }

  async generateJson(request: JsonGenerationRequest): Promise<string> {
    this.calls.push(request);
    if (request.schemaName === "prison_council_research") {
      return JSON.stringify({ findings: [`Finding ${this.index}: keep production deployment disabled.`, "Verify failed payments."], risks: [], open_questions: [], approach: `Approach ${this.index}` });
    }
    if (GENERATION.has(request.schemaName)) {
      return JSON.stringify({ prompt: `${BODY} Draft ${this.index}.${++this.drafts}.`, strategies_used: ["Owner-contract preservation"] });
    }
    if (request.schemaName.startsWith("prison_council_")) {
      const text = request.messages[0].content;
      const envelope = JSON.parse(text.slice(text.lastIndexOf("</prison_state>") + "</prison_state>".length).trim()) as { candidates: Array<{ id: string }> };
      const call = ++this.ballots;
      return JSON.stringify({ evaluations: envelope.candidates.map(({ id }) => {
        const shaped = this.ballot?.(request, call, id, this.index) ?? {};
        const value = shaped.scores ?? (id === "member_2" ? 0.95 : 0.9);
        return { candidate_id: id, issues: shaped.issues ?? [], suggestions: ["Keep the limits explicit."], scores: {
          intent_alignment: value, context_completeness: value, constraint_clarity: value, execution_clarity: value, output_clarity: value, target_ai_compatibility: value,
        } };
      }) });
    }
    throw new Error(`Unexpected schema ${request.schemaName}`);
  }

  generations(): JsonGenerationRequest[] {
    return this.calls.filter((call) => GENERATION.has(call.schemaName));
  }
}

function council(count: number, ballot?: Ballot): CouncilDeps & { models: Model[] } {
  const models = Array.from({ length: count }, (_, index) => new Model(index + 1, ballot));
  return { models, depth: DEEP_DEPTH, members: models.map((provider, index) => ({ id: `member_${index + 1}`, role: `Uzman ${index + 1}`, provider })) };
}

async function prison(mode: "competition" | "collaboration"): Promise<ResolvedPrison> {
  return runAnalysisPipeline({ rawRequest: RAW_REQUEST, language: "en", targetAI: "codex", councilMode: mode }, null);
}

function baseFor(value: ResolvedPrison) {
  const input = toCompileInput(value);
  return compilePrompt({ ...input, options: { ...input.options, jailbreakMode: false } });
}

async function run(mode: "competition" | "collaboration", deps: CouncilDeps) {
  const value = await prison(mode);
  const events: CouncilEvent[] = [];
  const result = await conductCouncil(value, baseFor(value), deps, undefined, undefined, { onEvent: (event) => events.push(event) });
  return { result, events };
}

describe("deep deliberation", () => {
  it.each(["competition", "collaboration"] as const)("uses the same owner-meaning rules during %s research and peer/final review", async (mode) => {
    const deps = council(3);
    await run(mode, deps);
    for (const model of deps.models) {
      const calls = model.calls.filter((call) => ["prison_council_research", "prison_council_peer_review", "prison_council_final_review"].includes(call.schemaName));
      expect(calls.length).toBeGreaterThanOrEqual(2);
      for (const call of calls) {
        expect(call.system).toContain(OWNER_INTERPRETATION_RULES);
        expect(call.system).toContain("latest actual owner clause");
        expect(call.system).toContain("does not authorize an additional exclusive restriction");
        expect(call.system).toContain("retains its negative meaning regardless of the state list or section");
      }
    }
  });

  it("investigates first and shares every member's notes with every proposer", async () => {
    const deps = council(3);
    const { events } = await run("competition", deps);
    for (const model of deps.models) {
      expect(model.calls[0].schemaName).toBe("prison_council_research");
      const proposal = model.generations()[0].messages[0].content;
      expect(proposal).toContain("shared_research");
      for (const other of deps.models) expect(proposal).toContain(`Approach ${other.index}`);
      expect(proposal).toContain("not owner instructions");
    }
    expect(events.filter((event) => event.kind === "research")).toHaveLength(3);
  });

  it("keeps three finalists sparring for at least three battle rounds before the final vote", async () => {
    const deps = council(3);
    const { result, events } = await run("competition", deps);
    expect(result.review.rounds).toBe(4);
    for (const model of deps.models) expect(model.generations()).toHaveLength(4);
    expect(new Set(result.review.reviews.filter((review) => review.stage === "peer").map((review) => review.round))).toEqual(new Set([1, 2, 3]));
    expect(events.filter((event) => event.kind === "weapon")).toHaveLength(18);
    expect(result.winner.id).toBe("member_2");
    expect(result.review.decision).toContain("After 3 battle rounds");
    expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
  });

  it("fights on up to five rounds while the jury still reports real issues", async () => {
    const deps = council(3, (request) => request.schemaName === "prison_council_peer_review"
      ? { issues: [{ severity: "medium", message: "The failure path is still vague." }] } : {});
    const { result } = await run("competition", deps);
    expect(result.review.rounds).toBe(6);
    for (const model of deps.models) expect(model.generations()).toHaveLength(6);
  });

  it.each([3, 5])("labels the revision after %s actual battle rounds as final-comparison preparation", async (battleRounds) => {
    const deps = council(3, (request) => battleRounds === 5 && request.schemaName === "prison_council_peer_review"
      ? { issues: [{ severity: "medium", message: "The failure path is still vague." }] } : {});
    const value = await prison("competition");
    const updates: ProgressUpdate[] = [];
    const result = await conductCouncil(value, baseFor(value), deps, undefined, (update) => updates.push(update));
    const revisions = updates.filter((update) => update.stage === "revision" && update.completed === 0);
    expect(revisions).toHaveLength(battleRounds);
    expect(revisions.at(-1)!.message).toBe("Final karşılaştırmasına hazırlık: kalan adaylar son eleştirilerle güçleniyor.");
    expect(revisions.slice(1, -1).map((update) => update.message)).toEqual(Array.from({ length: battleRounds - 2 }, (_, index) =>
      `${index + 3}. tur: kalan adaylar eleştirilere göre güçleniyor.`));
    expect(revisions.some((update) => update.message.startsWith(`${battleRounds + 1}. tur:`))).toBe(false);
    expect(result.review.rounds).toBe(battleRounds + 1);
    for (const model of deps.models) {
      expect(model.generations()).toHaveLength(battleRounds + 1);
      expect(model.calls.filter((call) => call.schemaName === "prison_council_peer_review")).toHaveLength(battleRounds);
      expect(model.calls.filter((call) => call.schemaName === "prison_council_final_review")).toHaveLength(1);
    }
  });

  it.each([true, false])("bounds a six-model battle when every later peer review fails (final review succeeds=%s)", async (finalSucceeds) => {
    const deps = council(6);
    for (const model of deps.models) {
      const original = model.generateJson.bind(model);
      let peerCalls = 0;
      model.generateJson = async (request) => {
        if ((request.schemaName === "prison_council_peer_review" && ++peerCalls > 1)
          || (request.schemaName === "prison_council_final_review" && !finalSucceeds)) {
          model.calls.push(request);
          throw new AIProviderError("timeout", "test timeout");
        }
        return original(request);
      };
    }
    const value = await prison("competition");
    const events: CouncilEvent[] = [];
    let reviewStages = 0;
    const pending = conductCouncil(value, baseFor(value), deps, undefined, (progress) => {
      // An old unbounded loop fails this guard immediately instead of leaving the test running.
      if (progress.stage === "peer_review" && progress.completed === 0 && ++reviewStages > DEEP_DEPTH.maxBattleRounds * 2) {
        throw new Error("Battle exceeded the bounded regression guard.");
      }
    }, { onEvent: (event) => events.push(event) });
    if (finalSucceeds) {
      const result = await pending;
      expect(result.review.rounds).toBe(DEEP_DEPTH.maxBattleRounds + 1);
      expect(result.review.participants.filter((participant) => participant.status !== "eliminated")).toHaveLength(4);
      expect(result.review.reviews.filter((review) => review.stage === "final" && review.candidateId === result.winner.id)).toHaveLength(5);
      expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
    } else {
      const result = await pending;
      expect(result.review.rounds).toBe(DEEP_DEPTH.maxBattleRounds + 1);
      expect(result.review.decision).toContain("did not produce agreement");
      expect(result.review.decision).toContain("consensus or approval was not assumed");
      expect(result.review.reviews.filter((review) => review.stage === "final")).toHaveLength(0);
      expect(result.finalReviewers).toHaveLength(5);
      expect(result.finalReviewers.every((member) => member.id !== result.winner.id)).toBe(true);
      expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
    }
    expect(events.every((event) => event.round <= DEEP_DEPTH.maxBattleRounds + 1)).toBe(true);
    for (const model of deps.models) {
      expect(model.calls.filter((call) => call.schemaName === "prison_council_peer_review")).toHaveLength(1 + (DEEP_DEPTH.maxBattleRounds - 1) * 2);
      expect(model.calls.filter((call) => call.schemaName === "prison_council_final_review")).toHaveLength(finalSucceeds ? 1 : 2);
    }
  });

  it("gives a drafter whose first proposal timed out a second pass, within the longer deep budget", async () => {
    const deps = council(3);
    const original = deps.models[0].generateJson.bind(deps.models[0]);
    let first = true;
    deps.models[0].generateJson = async (request) => {
      if (GENERATION.has(request.schemaName) && first) {
        first = false;
        deps.models[0].calls.push(request);
        throw new AIProviderError("timeout", "test timeout");
      }
      return original(request);
    };
    const { result } = await run("competition", deps);
    expect(result.review.participants[0].initialPrompt).not.toBeNull();
    for (const model of deps.models) {
      expect(model.calls.every((call) => call.schemaName === "council_preflight" || (call.timeoutMs! > 90000 && call.timeoutMs! <= DEEP_DEPTH.callTimeoutMs))).toBe(true);
    }
  });

  it("does not retry a draft refused for a non-transient reason", async () => {
    const deps = council(4);
    deps.models[3].generateJson = async (request) => {
      deps.models[3].calls.push(request);
      if (GENERATION.has(request.schemaName)) throw new AIProviderError("auth", "test auth");
      return new Model(4).generateJson(request);
    };
    await run("competition", deps);
    expect(deps.models[3].generations()).toHaveLength(1);
  });

  it("keeps a fighter whose later revision fails in the battle with its previous prompt", async () => {
    const deps = council(3);
    const original = deps.models[2].generateJson.bind(deps.models[2]);
    let generations = 0;
    deps.models[2].generateJson = async (request) => {
      if (GENERATION.has(request.schemaName) && ++generations === 3) {
        deps.models[2].calls.push(request);
        throw new AIProviderError("timeout", "test timeout");
      }
      return original(request);
    };
    const { result } = await run("competition", deps);
    const fighter = result.review.participants.find((participant) => participant.id === "member_3")!;
    expect(fighter.status).not.toBe("failed");
    expect(fighter.findings.some((finding) => finding.includes("önceki adayıyla devam etti"))).toBe(true);
  });

  it("lets table members learn from the discussion and reviews the shared prompt at least twice", async () => {
    const deps = council(3);
    const { result, events } = await run("collaboration", deps);
    const scribe = deps.models[0];
    expect(scribe.generations()).toHaveLength(4);
    expect(scribe.generations()[1].messages[0].content).toContain("learn from the discussion");
    expect(scribe.generations()[3].messages[0].content).toContain("polish it");
    for (const model of deps.models.slice(1)) {
      expect(model.generations()).toHaveLength(2);
      expect(model.calls.filter((call) => call.schemaName === "prison_council_final_review")).toHaveLength(2);
    }
    expect(events.filter((event) => event.kind === "approval")).toHaveLength(4);
    expect(result.review.decision).toContain("No vote was taken");
    expect(result.review.decision).toContain("After 2 review rounds");
  });

  it("keeps the last version the whole table approved when a later polish loses agreement", async () => {
    // Approve the first shared draft, then object to every polished one.
    const consensus: JsonGenerationRequest[] = [];
    const deps = council(3, (request) => {
      if (request.schemaName !== "prison_council_final_review") return {};
      if (!consensus.includes(request)) consensus.push(request);
      return consensus.indexOf(request) >= 2 ? { issues: [{ severity: "high", message: "The polish dropped the no-deploy limit." }] } : {};
    });
    const { result } = await run("collaboration", deps);
    const scribe = result.review.participants.find((participant) => participant.status === "winner")!;
    const synthesis = deps.models[0].generations()[2];
    expect(synthesis.messages[0].content).toContain("you are the scribe");
    expect(scribe.revisedPrompt).toBe(`${BODY} Draft 1.3.`);
    expect(scribe.findings).toContain("Son cilalama masanın onayını alamadı; en son onaylanan ortak metin kullanıldı.");
  });
});

describe("broad agreement", () => {
  it.each(["en", "tr"] as const)("records missing reviewers without claiming unanimous approval (%s)", async (language) => {
    const deps = council(6);
    for (const model of deps.models.slice(3)) {
      const original = model.generateJson.bind(model);
      model.generateJson = async (request) => {
        if (request.schemaName === "prison_council_final_review") {
          model.calls.push(request);
          throw new AIProviderError("timeout", "test timeout");
        }
        return original(request);
      };
    }
    const value = { ...await prison("collaboration"), language };
    const result = await conductCouncil(value, baseFor(value), deps);
    const decision = result.review.decision;
    if (language === "en") {
      expect(decision).toContain("2 of 5 other members approved it outright");
      expect(decision).toContain("3 members did not complete this shared draft's review");
      expect(decision).not.toContain("all 2 other members approved");
    } else {
      expect(decision).toContain("masadaki 5 üyenin 2 tanesi tam onay verdi");
      expect(decision).toContain("3 üye bu ortak metnin denetimini tamamlayamadı");
      expect(decision).not.toContain("üyenin tamamı");
    }
    for (const model of deps.models.slice(1, 3)) {
      expect(model.calls.filter((call) => call.schemaName === "prison_council_final_review")).toHaveLength(DEEP_DEPTH.maxConsensusRounds);
    }
    expect(result.review.events!.filter((event) => event.kind === "abstained")).toHaveLength(3 * DEEP_DEPTH.maxConsensusRounds * 2);
    expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
  });

  it("settles the table on broad agreement at the last round when one member keeps a non-blocking reservation", async () => {
    const deps = council(4, (request, _call, _candidate, reviewer) =>
      request.schemaName === "prison_council_final_review" && reviewer === 4 ? { scores: 0.7 } : {});
    const { result } = await run("collaboration", deps);
    expect(deps.models[1].calls.filter((call) => call.schemaName === "prison_council_final_review")).toHaveLength(DEEP_DEPTH.maxConsensusRounds);
    expect(result.review.decision).toContain("2 of 3 other members approved it outright");
    expect(result.winner.id).toBe("member_1");
  });

  it("treats a lone material objection as a recorded reservation, not a veto", async () => {
    const deps = council(4, (request, _call, _candidate, reviewer) =>
      request.schemaName === "prison_council_final_review" && reviewer === 4 ? { issues: [{ severity: "high", message: "Day names must not appear in the day column." }] } : {});
    const { result } = await run("collaboration", deps);
    // The table still debated it for every allowed round before settling on broad agreement.
    expect(deps.models[3].calls.filter((call) => call.schemaName === "prison_council_final_review")).toHaveLength(DEEP_DEPTH.maxConsensusRounds);
    expect(result.review.decision).toContain("no other member joined one member's material reservation");
  });

  it("does not claim consensus when two members report a material issue and hands the draft to the exact-text gate", async () => {
    const deps = council(4, (request, _call, _candidate, reviewer) =>
      request.schemaName === "prison_council_final_review" && reviewer >= 3 ? { issues: [{ severity: "high", message: "Deployment limit dropped." }] } : {});
    const value = await prison("collaboration");
    const result = await conductCouncil(value, baseFor(value), deps);
    expect(result.review.decision).toContain("did not reach consensus");
    expect(result.review.decision).toContain("consensus or approval was not assumed");
    const selected = result.review.participants.find((participant) => participant.status === "winner")!;
    expect(selected.findings).toContain("Deployment limit dropped.");
    expect(result.review.events!.filter((event) => event.kind === "objection")).toHaveLength(2 * DEEP_DEPTH.maxConsensusRounds);
    expect(result.finalReviewers).toHaveLength(3);
    expect(value.promptVersions).toHaveLength(0);
  });

  it("lets a finalist win when one juror of three withholds full approval without a material issue", async () => {
    const deps = council(4, (request, _call, _candidate, reviewer) =>
      request.schemaName === "prison_council_final_review" && reviewer === 4 ? { scores: 0.7 } : {});
    const { result } = await run("competition", deps);
    expect(result.review.participants.find((participant) => participant.id === "member_4")!.status).toBe("eliminated");
    expect(result.review.reviews.filter((review) => review.stage === "final" && review.candidateId === "member_2")).toHaveLength(3);
    expect(result.winner.id).toBe("member_2");
  });
});

describe("review failure retry policy", () => {
  it("keeps persisted progress valid when every later juror is unavailable, and still fails exact review honestly", async () => {
    const deps = council(3);
    for (const reviewer of deps.models) {
      const original = reviewer.generateJson.bind(reviewer);
      let peerCalls = 0;
      reviewer.generateJson = async (request) => {
        if ((request.schemaName === "prison_council_peer_review" && ++peerCalls > 1)
          || request.schemaName === "prison_critic") {
          reviewer.calls.push(request);
          throw new AIProviderError("auth", "test endpoint failure");
        }
        return original(request);
      };
    }
    const value = await prison("competition");
    const original = structuredClone(value);
    const updates: ProgressUpdate[] = [];
    const events: CouncilEvent[] = [];
    await expect(runCompilePipeline(value, { trigger: "initial", note: "", llmReview: true }, {
      provider: null, council: deps, onProgress: (update) => updates.push(update), onCouncilEvent: (event) => events.push(event),
    })).rejects.toMatchObject({ kind: "auth" });
    expect(value).toEqual(original);
    expect(value.promptVersions).toHaveLength(0);
    for (const update of updates) expect(OperationProgressSchema.safeParse({ ...update, startedAt: "2026-10-05T00:00:00.000Z" }).success).toBe(true);
    const skipped = updates.filter((update) => update.message.includes("jüri üyeleri önceki"));
    expect(skipped.map((update) => ({ stage: update.stage, completed: update.completed, total: update.total }))).toEqual([
      { stage: "peer_review", completed: 0, total: 3 }, { stage: "voting", completed: 0, total: 3 },
    ]);
    for (const reviewer of deps.models) {
      expect(reviewer.calls.filter((call) => call.schemaName === "prison_council_peer_review")).toHaveLength(2);
      expect(reviewer.calls.filter((call) => call.schemaName === "prison_council_final_review")).toHaveLength(0);
    }
    expect(events.filter((event) => event.kind === "abstained" && event.round === 3)).toHaveLength(3);
    expect(events.filter((event) => event.kind === "abstained" && event.round === 4)).toHaveLength(3);
    expect(events.some((event) => event.kind === "approval" || event.kind === "winner")).toBe(false);
    expect(deps.models[0].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
    expect(deps.models[2].calls.filter((call) => call.schemaName === "prison_critic")).toHaveLength(1);
  });

  it.each([
    ["competition", "auth"], ["competition", "configuration"],
    ["collaboration", "auth"], ["collaboration", "configuration"],
  ] as const)("records an absent %s juror after one %s failure without calling it again", async (mode, kind) => {
    const deps = council(4);
    const broken = deps.models[3];
    const original = broken.generateJson.bind(broken);
    broken.generateJson = async (request) => {
      if (request.schemaName === "prison_council_peer_review" || request.schemaName === "prison_council_final_review") {
        broken.calls.push(request);
        throw new AIProviderError(kind, "PRIVATE_ENDPOINT_DETAILS");
      }
      return original(request);
    };
    const { result, events } = await run(mode, deps);
    expect(broken.calls.filter((call) => call.schemaName.endsWith("_review"))).toHaveLength(1);
    expect(result.review.reviews.some((review) => review.reviewerId === "member_4")).toBe(false);
    expect(events.some((event) => event.actorId === "member_4" && event.kind === "approval")).toBe(false);
    expect(events.filter((event) => event.actorId === "member_4" && event.kind === "abstained").length).toBeGreaterThan(1);
    expect(events.filter((event) => event.actorId === "member_4" && event.kind === "abstained").at(-1)!.text).toContain("yeni çağrı yapılmadı");
    expect(events.some((event) => event.text.includes("PRIVATE_ENDPOINT_DETAILS"))).toBe(false);
    expect(result.finalReviewers).toHaveLength(2);
    expect(result.finalReviewers.every((reviewer) => reviewer.id !== "member_4" && reviewer.id !== result.winner.id)).toBe(true);
    expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
  });

  it.each([
    ["competition", "bad_request"], ["competition", "refusal"], ["competition", "invalid_output"],
    ["collaboration", "bad_request"], ["collaboration", "refusal"], ["collaboration", "invalid_output"],
  ] as const)("does not repeat a %s %s review immediately, but allows a later text", async (mode, kind) => {
    const deps = council(4);
    const reviewer = deps.models[3];
    const original = reviewer.generateJson.bind(reviewer);
    let failed = false;
    reviewer.generateJson = async (request) => {
      if (request.schemaName === "prison_council_peer_review" && !failed) {
        failed = true;
        reviewer.calls.push(request);
        throw new AIProviderError(kind, "test non-transient review");
      }
      return original(request);
    };
    const { result, events } = await run(mode, deps);
    expect(events.filter((event) => event.actorId === "member_4" && event.round === 1 && event.kind === "abstained")).toHaveLength(1);
    expect(result.review.reviews.some((review) => review.reviewerId === "member_4" && review.round === 1)).toBe(false);
    expect(result.review.reviews.some((review) => review.reviewerId === "member_4" && review.round! > 1)).toBe(true);
    expect(reviewer.calls.filter((call) => call.schemaName === "prison_council_peer_review")).toHaveLength(mode === "competition" ? 3 : 1);
    expect(CouncilReviewSchema.safeParse(result.review).success).toBe(true);
  });

  it.each(["competition", "collaboration"] as const)("gives a timed-out %s juror one more attempt in the same round", async (mode) => {
    const deps = council(4);
    const reviewer = deps.models[3];
    const original = reviewer.generateJson.bind(reviewer);
    let failed = false;
    reviewer.generateJson = async (request) => {
      if (request.schemaName === "prison_council_peer_review" && !failed) {
        failed = true;
        reviewer.calls.push(request);
        throw new AIProviderError("timeout", "test timeout");
      }
      return original(request);
    };
    const { result, events } = await run(mode, deps);
    expect(events.filter((event) => event.actorId === "member_4" && event.round === 1 && event.kind === "abstained")).toHaveLength(1);
    expect(result.review.reviews.filter((review) => review.reviewerId === "member_4" && review.round === 1)).toHaveLength(3);
    expect(reviewer.calls.filter((call) => call.schemaName === "prison_council_peer_review")).toHaveLength(mode === "competition" ? 4 : 2);
  });

  it.each(["competition", "collaboration"] as const)("does not replace missing independent %s reviews with fabricated approval", async (mode) => {
    const deps = council(3);
    for (const reviewer of deps.models.slice(1)) {
      const original = reviewer.generateJson.bind(reviewer);
      reviewer.generateJson = async (request) => {
        if (request.schemaName === "prison_council_peer_review") {
          reviewer.calls.push(request);
          throw new AIProviderError("auth", "test auth");
        }
        return original(request);
      };
    }
    const value = await prison(mode);
    const events: CouncilEvent[] = [];
    await expect(conductCouncil(value, baseFor(value), deps, undefined, undefined, { onEvent: (event) => events.push(event) })).rejects.toMatchObject({ code: "validation_error" });
    expect(events.some((event) => event.kind === "approval" || event.kind === "winner" || event.kind === "finalist")).toBe(false);
    for (const reviewer of deps.models.slice(1)) expect(reviewer.calls.filter((call) => call.schemaName === "prison_council_peer_review")).toHaveLength(1);
  });
});

describe("council depth configuration", () => {
  const ENGINE: EngineStatus = { mode: "ai", provider: "nvidia", model: "nvidia/primary-model" };
  const ENV = { NVIDIA_API_KEY: "test-council-credential", PRISON_COUNCIL_MODE: "enabled" };

  it("defaults to deep deliberation and accepts quick", () => {
    expect(createCouncil(ENGINE, ENV)!.depth).toEqual(DEEP_DEPTH);
    expect(createCouncil(ENGINE, { ...ENV, PRISON_COUNCIL_DEPTH: " Quick " })!.depth).toEqual(QUICK_DEPTH);
    expect(() => createCouncil(ENGINE, { ...ENV, PRISON_COUNCIL_DEPTH: "forever" })).toThrow(AIProviderError);
  });
});
