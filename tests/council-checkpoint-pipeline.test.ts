import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { restoreVersion } from "@/core/pipeline/revise";
import type { Prison, ResolvedPrison } from "@/models/prison";
import type { TaskPlan } from "@/models/spec";
import { AppError } from "@/services/errors";
import { AIProviderError } from "@/services/ai/errors";
import { QUICK_DEPTH, type CouncilDeps } from "@/services/ai/council-config";
import type { JsonGenerationRequest, LLMProvider } from "@/services/ai/types";
import { PrisonService } from "@/services/prison-service";
import { FileCouncilCheckpointRepository } from "@/services/storage/council-checkpoint-repository";
import type { PrisonRepository } from "@/services/storage/repository";
import { CLEAN_CRITIC, ScriptedProvider } from "./helpers";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const BAD_REVIEW = { ...CLEAN_CRITIC, issues: [{ dimension: "target_ai_compatibility", severity: "high", message: "Seçilen hedef için görev yönlendirmesi eksik.", fix: null }] };
const timeout = () => new AIProviderError("timeout", "Test endpoint unavailable");

class Member implements LLMProvider {
  readonly info;
  readonly calls: JsonGenerationRequest[] = [];
  criticReplies: Array<object | Error> = [];
  repairFailure = false;
  probeFailure = false;
  constructor(readonly index: number, readonly suffix = "initial") {
    this.info = { mode: "ai" as const, provider: "nvidia", model: `checkpoint/member-${index}` };
  }
  async generateJson(request: JsonGenerationRequest): Promise<string> {
    this.calls.push(request);
    if (request.schemaName === "council_preflight") {
      if (this.probeFailure) throw new AIProviderError("auth", "Test probe unavailable");
      return JSON.stringify({ ok: true });
    }
    if (request.schemaName === "prison_critic") {
      const reply = this.criticReplies.shift() ?? CLEAN_CRITIC;
      if (reply instanceof Error) throw reply;
      return JSON.stringify(reply);
    }
    if (request.schemaName === "prison_prompt_refinement") {
      const repair = request.messages[0]!.content.includes("Repair: resolve the exact-text review findings");
      if (repair && this.repairFailure) throw timeout();
      return JSON.stringify({
        prompt: `Kullanıcının istediği haftalık içerik önerilerini verilen bağlamla hazırla. Görev sözleşmesindeki çıktı biçimini, kullanıcı sınırlarını ve aktif yönergeleri uygula; eksik bilgi icat etmeden sonucu doğrula. Üye ${this.index}, ${this.suffix}, ${repair ? "repaired" : "draft"}.`,
        strategies_used: ["Owner grounded direction"],
      });
    }
    if (request.schemaName.startsWith("prison_council_")) {
      const body = request.messages[0]!.content;
      const envelope = JSON.parse(body.slice(body.lastIndexOf("</prison_state>") + "</prison_state>".length)) as { candidates: Array<{ id: string }> };
      return JSON.stringify({ evaluations: envelope.candidates.map(({ id }) => ({
        candidate_id: id,
        scores: Object.fromEntries(Object.keys(CLEAN_CRITIC.scores).map((key) => [key, id === "member_2" ? 0.95 : 0.9])),
        issues: [], suggestions: [],
      })) });
    }
    throw new Error(`Unexpected request ${request.schemaName}`);
  }
  get drafts() { return this.calls.filter((call) => call.schemaName === "prison_prompt_refinement"); }
  get repairs() { return this.drafts.filter((call) => call.messages[0]!.content.includes("Repair: resolve the exact-text review findings")); }
}

function configured(suffix = "initial") {
  const models = [1, 2, 3].map((index) => new Member(index, suffix));
  const council: CouncilDeps = { verifySource: true, depth: QUICK_DEPTH, members: models.map((provider, index) => ({ id: `member_${index + 1}`, role: `Specialist ${index + 1}`, provider })) };
  return { models, council };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prison-council-checkpoint-"));
  roots.push(root);
  const initial = await runAnalysisPipeline({ rawRequest: "Kafe için bir haftalık içerik önerileri hazırla.", language: "tr", targetAI: "gpt" }, null);
  let persisted: Prison = structuredClone(initial);
  const save = vi.fn(async (next: Prison) => { persisted = structuredClone(next); });
  const repository: PrisonRepository = { list: async () => [], get: async () => structuredClone(persisted), save, delete: async () => true };
  const checkpoints = new FileCouncilCheckpointRepository(root);
  const service = (primary: LLMProvider | null, council: CouncilDeps, store = checkpoints) => new PrisonService(repository, primary, undefined, council, undefined, store);
  return { root, initial, repository, checkpoints, service, save, current: () => structuredClone(persisted), set: (next: Prison) => { persisted = structuredClone(next); } };
}

const primaryForSource = () => new ScriptedProvider().enqueue("prison_critic", CLEAN_CRITIC);

function primaryForRevision() {
  return primaryForSource().enqueue("prison_revision", {
    summary: "Kullanıcının seçtiği Claude hedefi uygulanıyor.", set: { target_ai: "claude" }, add: {},
  }).enqueue("prison_execution_plan", {
    approach: "Kullanıcının haftalık içerik önerilerini seçtiği Claude hedefi için hazırla.",
    steps: [
      { action: "Haftalık içerik önerilerini hazırla", purpose: "İstenen önerileri sun", verification: "Yedi günlük öneri tamamlandı" },
      { action: "Görev koşullarını doğrula", purpose: "Kullanıcı sınırlarını koru", verification: "İstenen çıktı biçimi ve sınırlar korundu" },
    ],
    clarifying_questions: [], recommended_target: "claude", target_rationale: "Kullanıcı Claude hedefini seçti.",
  });
}

const questionPlan = (questions: string[]): TaskPlan => ({
  approach: "Haftalık içerik önerilerini kullanıcı koşullarına göre hazırla.",
  steps: [
    { action: "Haftalık önerileri hazırla", purpose: "İstenen içerikleri sun", verification: "Yedi gün için öneri hazır" },
    { action: "İstenen biçimi doğrula", purpose: "Görev sınırlarını koru", verification: "Kullanıcının istediği çıktı biçimi doğru" },
  ],
  clarifyingQuestions: questions, recommendedTarget: "gpt", targetRationale: "Kullanıcı GPT hedefini seçti.",
});

describe("exact pending owner revision checkpoint recovery", () => {
  it.each(["revise", "clarify"])("resumes the same %s without interpreting, replanning or holding another council", async (action) => {
    const f = await fixture();
    await f.service(primaryForSource(), configured().council).compile(f.initial.id);
    const before = f.current();
    before.spec!.taskPlan = questionPlan(["Hangi AI hedefini kullanalım?"]);
    f.set(before);
    const answers = [{ question: "Hangi AI hedefini kullanalım?", answer: "Claude" }];
    const run = (service: PrisonService) => action === "revise"
      ? service.revise(f.initial.id, "Bu promptu Claude için hazırla.") : service.clarify(f.initial.id, answers);
    const first = configured("pending-owner");
    first.models[0]!.criticReplies = [timeout()]; first.models[2]!.criticReplies = [timeout()];
    await expect(run(f.service(primaryForRevision(), first.council))).rejects.toMatchObject({ code: "ai_error" });
    const saved = await f.checkpoints.get(f.initial.id);
    expect(saved?.phase).toBe("selected");
    expect(saved?.revisionOrigin).toBeDefined();
    expect(f.current()).toEqual(before);
    const primary = new ScriptedProvider();
    const next = configured("reconstructed-owner");
    const result = await run(f.service(primary, next.council, new FileCouncilCheckpointRepository(f.root)));
    expect(primary.calls).toEqual([]);
    expect(next.models.flatMap((model) => model.drafts)).toEqual([]);
    expect(next.models.flatMap((model) => model.calls).map((call) => call.schemaName)).toEqual(["prison_critic"]);
    expect(result.promptVersions).toHaveLength(2);
    expect(result.promptVersions[0]).toEqual(before.promptVersions[0]);
    expect(result.promptVersions[1]!.text).toContain(saved!.selectedPrompt);
    expect(result.targetAI).toBe("claude");
    expect(result.revisions.at(-1)).toMatchObject({
      id: saved!.revisionOrigin!.pendingRevisionId, summary: saved!.revisionOrigin!.summary,
      changes: saved!.revisionOrigin!.changes, resultVersion: 2,
      ...(action === "clarify" ? { clarifications: answers } : {}),
    });
    expect(result.promptVersions[1]!.ownerRevisionIds).toContain(saved!.revisionOrigin!.pendingRevisionId);
    expect(await f.checkpoints.get(f.initial.id)).toBeNull();
  });

  it.each(["message", "question", "answer", "branch"])("starts a fresh interpretation and council when the %s differs from the pending revision", async (change) => {
    const f = await fixture();
    await f.service(primaryForSource(), configured().council).compile(f.initial.id);
    const before = f.current();
    const questions = ["Hangi AI hedefini kullanalım?", "Prompt hangi modele yönelik olsun?"];
    before.spec!.taskPlan = questionPlan(questions); f.set(before);
    const first = configured("old-owner");
    first.models[0]!.criticReplies = [timeout()]; first.models[2]!.criticReplies = [timeout()];
    const originalMessage = "Bu promptu Claude için hazırla.";
    const originalAnswers = [{ question: questions[0]!, answer: "Claude" }];
    const clarify = change === "question" || change === "answer";
    await expect(clarify
      ? f.service(primaryForRevision(), first.council).clarify(f.initial.id, originalAnswers)
      : f.service(primaryForRevision(), first.council).revise(f.initial.id, originalMessage)).rejects.toMatchObject({ code: "ai_error" });
    const oldPendingId = (await f.checkpoints.get(f.initial.id))!.revisionOrigin!.pendingRevisionId;
    if (change === "branch") {
      // Recreate a valid restored branch without removing its stale private file first.
      f.set(restoreVersion(before as ResolvedPrison, 1)!);
    }
    const primary = primaryForRevision();
    const next = configured("fresh-owner");
    const result = clarify
      ? await f.service(primary, next.council).clarify(f.initial.id, [{
        question: questions[change === "question" ? 1 : 0]!, answer: change === "answer" ? "Claude modeli" : "Claude",
      }])
      : await f.service(primary, next.council).revise(f.initial.id, change === "message" ? "Promptu Claude için yeniden düzenle." : originalMessage);
    expect(primary.callsFor("prison_revision")).toHaveLength(1);
    expect(next.models.flatMap((model) => model.drafts).length).toBeGreaterThan(3);
    expect(result.revisions.at(-1)!.id).not.toBe(oldPendingId);
    expect(result.promptVersions.at(-1)!.text).toContain("fresh-owner");
    expect(await f.checkpoints.get(f.initial.id)).toBeNull();
  });
});

describe("private selected council checkpoints", () => {
  it.each(["regenerate", "adjust"])("resumes selected %s of READY v1 without discarding the saved old prompt", async (action) => {
    const f = await fixture();
    await f.service(primaryForSource(), configured().council).compile(f.initial.id);
    const before = f.current();
    const first = configured("new-version");
    first.models[0]!.criticReplies = [timeout()];
    first.models[2]!.criticReplies = [timeout()];
    const run = (service: PrisonService) => action === "regenerate"
      ? service.compile(f.initial.id)
      : service.adjust(f.initial.id, { kind: "context", executionContext: "mobile" });
    await expect(run(f.service(primaryForSource(), first.council))).rejects.toMatchObject({ code: "ai_error" });
    const selected = await f.checkpoints.get(f.initial.id);
    expect(selected!.workingPrison.status).toMatch(/^PROMPT_(?:RE)?COMPILED$/);
    expect(f.current()).toEqual(before);
    const next = configured("reloaded");
    const result = await run(f.service(new ScriptedProvider(), next.council));
    expect(next.models.flatMap((model) => model.drafts)).toEqual([]);
    expect(result.promptVersions).toHaveLength(2);
    expect(result.promptVersions[0]).toEqual(before.promptVersions[0]);
    expect(result.promptVersions[1]!.text).toContain(selected!.selectedPrompt);
    expect(result.activeVersion).toBe(2);
    expect(await f.checkpoints.get(f.initial.id)).toBeNull();
  });

  it("resumes independent final review after process/provider reconstruction without repeating the council", async () => {
    const f = await fixture();
    const first = configured();
    first.models[0]!.criticReplies = [timeout()];
    first.models[2]!.criticReplies = [timeout()];
    await expect(f.service(primaryForSource(), first.council).compile(f.initial.id)).rejects.toMatchObject({ code: "ai_error" });
    const saved = await f.checkpoints.get(f.initial.id);
    expect(saved?.phase).toBe("selected");
    expect(saved?.selectedPrompt).toContain("Üye 2");
    expect(f.current()).toEqual(f.initial);
    expect(f.current().promptVersions).toHaveLength(0);
    const rebuilt = configured("reloaded");
    const primary = new ScriptedProvider();
    const progress: string[] = [];
    const service = f.service(primary, rebuilt.council, new FileCouncilCheckpointRepository(f.root));
    service.subscribeProgress(f.initial.id, (value) => { if (value) progress.push(value.message); });
    const result = await service.compile(f.initial.id);
    expect(result.status).toBe("READY");
    expect(rebuilt.models.flatMap((model) => model.drafts)).toEqual([]);
    expect(rebuilt.models.flatMap((model) => model.calls).map((call) => call.schemaName)).toEqual(["prison_critic"]);
    expect(primary.calls).toEqual([]);
    const version = result.promptVersions[0]!;
    expect(version.text).toContain(saved!.selectedPrompt);
    expect(version.councilReview!.finalReviewerModel).toBe(rebuilt.models[0]!.info.model);
    expect(version.councilReview!.finalReviewerModel).not.toBe(version.generation!.model);
    expect(progress.some((message) => message.includes("geri yüklendi"))).toBe(true);
    expect(await f.checkpoints.get(f.initial.id)).toBeNull();
  });

  it("retains needed correction feedback after unavailable writers and resumes just that correction", async () => {
    const f = await fixture();
    const first = configured();
    first.models[0]!.criticReplies = [BAD_REVIEW];
    first.models[0]!.repairFailure = true;
    first.models[1]!.repairFailure = true;
    first.models[2]!.repairFailure = true;
    await expect(f.service(primaryForSource(), first.council).compile(f.initial.id)).rejects.toMatchObject({ code: "ai_error" });
    const saved = await f.checkpoints.get(f.initial.id);
    expect(saved?.phase).toBe("needs_repair");
    expect(saved?.feedback).toContain(BAD_REVIEW.issues[0]!.message);
    expect(f.save).not.toHaveBeenCalled();
    const next = configured("retry");
    const result = await f.service(new ScriptedProvider(), next.council).compile(f.initial.id);
    expect(next.models.flatMap((model) => model.drafts)).toHaveLength(1);
    expect(next.models.flatMap((model) => model.repairs)).toHaveLength(1);
    expect(result.promptVersions[0]!.critic.compilePasses).toBe(2);
    expect(result.promptVersions[0]!.text).toContain("retry, repaired");
    expect(await f.checkpoints.get(f.initial.id)).toBeNull();
  });

  it("rechecks an already repaired text after unavailable final jurors without performing another repair", async () => {
    const f = await fixture();
    const first = configured();
    first.models[0]!.criticReplies = [BAD_REVIEW, timeout()];
    first.models[2]!.criticReplies = [timeout()];
    await expect(f.service(primaryForSource(), first.council).compile(f.initial.id)).rejects.toMatchObject({ code: "ai_error" });
    const saved = await f.checkpoints.get(f.initial.id);
    expect(saved?.phase).toBe("repaired");
    expect(saved?.selectedPrompt).toContain("initial, repaired");
    expect(first.models.flatMap((model) => model.repairs)).toHaveLength(1);
    const next = configured("retry");
    const result = await f.service(new ScriptedProvider(), next.council).compile(f.initial.id);
    expect(next.models.flatMap((model) => model.drafts)).toEqual([]);
    expect(result.promptVersions[0]!.text).toContain(saved!.selectedPrompt);
    expect(result.promptVersions[0]!.critic.compilePasses).toBe(2);
    expect(result.promptVersions[0]!.critic.issues).toContainEqual(expect.objectContaining({ message: BAD_REVIEW.issues[0]!.message, fixed: true }));
  });

  it("never re-repairs a logically rejected repaired candidate; a new retry starts a fresh council", async () => {
    const f = await fixture();
    const first = configured();
    first.models[0]!.criticReplies = [BAD_REVIEW, BAD_REVIEW];
    await expect(f.service(primaryForSource(), first.council).compile(f.initial.id)).rejects.toMatchObject({ code: "validation_error" });
    expect((await f.checkpoints.get(f.initial.id))?.phase).toBe("rejected");
    expect(f.current().promptVersions).toHaveLength(0);
    const next = configured("fresh");
    const result = await f.service(primaryForSource(), next.council).compile(f.initial.id);
    expect(next.models.flatMap((model) => model.drafts).length).toBeGreaterThan(3);
    expect(next.models.flatMap((model) => model.repairs)).toEqual([]);
    expect(result.promptVersions[0]!.text).toContain("fresh, draft");
    expect(result.promptVersions[0]!.critic.compilePasses).toBe(1);
  });

  it("invalidates an old selected draft when effective owner source changes", async () => {
    const f = await fixture();
    const first = configured();
    first.models[0]!.criticReplies = [timeout()];
    first.models[2]!.criticReplies = [timeout()];
    await expect(f.service(primaryForSource(), first.council).compile(f.initial.id)).rejects.toMatchObject({ code: "ai_error" });
    f.set({ ...f.current(), rawRequest: `${f.initial.rawRequest} Metinler en fazla iki cümle olsun.` });
    const next = configured("new-owner");
    const result = await f.service(primaryForSource(), next.council).compile(f.initial.id);
    expect(next.models.flatMap((model) => model.drafts).length).toBeGreaterThan(3);
    expect(result.promptVersions[0]!.text).toContain("new-owner");
    expect(result.promptVersions[0]!.text).toContain("Metinler en fazla iki cümle olsun.");
  });

  it("reconstructs an actual configured reserve's original seat as an independent reviewer", async () => {
    const f = await fixture();
    const first = configured();
    const reserve = new Member(4);
    first.models[0]!.probeFailure = true;
    reserve.criticReplies = [timeout()];
    first.models[2]!.criticReplies = [timeout()];
    first.council.reserves = [reserve];
    await expect(f.service(primaryForSource(), first.council).compile(f.initial.id)).rejects.toMatchObject({ code: "ai_error" });
    const saved = await f.checkpoints.get(f.initial.id);
    expect(saved!.finalReviewers).toContainEqual(expect.objectContaining({ id: "member_1", model: reserve.info.model }));
    const next = configured("reloaded");
    const nextReserve = new Member(4, "reloaded-reserve");
    next.council.reserves = [nextReserve];
    const result = await f.service(new ScriptedProvider(), next.council).compile(f.initial.id);
    expect(nextReserve.calls.map((call) => call.schemaName)).toEqual(["prison_critic"]);
    expect(next.models.flatMap((model) => model.calls)).toEqual([]);
    expect(result.promptVersions[0]!.councilReview!.finalReviewerModel).toBe(nextReserve.info.model);
  });

  it("preserves the selected checkpoint when persisting the accepted READY task fails", async () => {
    const f = await fixture();
    const next = configured();
    f.save.mockRejectedValueOnce(new Error("Test save unavailable"));
    await expect(f.service(primaryForSource(), next.council).compile(f.initial.id)).rejects.toMatchObject({ code: "storage_error" });
    expect((await f.checkpoints.get(f.initial.id))?.phase).toBe("selected");
    expect(f.current()).toEqual(f.initial);
    const retry = configured("retry");
    await f.service(new ScriptedProvider(), retry.council).compile(f.initial.id);
    expect(retry.models.flatMap((model) => model.drafts)).toEqual([]);
    expect(await f.checkpoints.get(f.initial.id)).toBeNull();
  });

  it("does not re-repair a draft when the successful correction could not be checkpointed", async () => {
    const f = await fixture();
    const first = configured();
    first.models[0]!.criticReplies = [BAD_REVIEW];
    const persist = f.checkpoints.save.bind(f.checkpoints);
    f.checkpoints.save = async (checkpoint) => {
      if (checkpoint.phase === "repaired") throw new AppError("storage_error", "Test correction checkpoint unavailable");
      await persist(checkpoint);
    };
    await expect(f.service(primaryForSource(), first.council).compile(f.initial.id)).rejects.toMatchObject({ code: "storage_error" });
    expect(first.models.flatMap((model) => model.repairs)).toHaveLength(1);
    expect((await f.checkpoints.get(f.initial.id))?.repairInFlight).toBe(true);
    expect(f.current().promptVersions).toHaveLength(0);
    const retry = configured("fresh-after-uncertain-response");
    await f.service(primaryForSource(), retry.council, new FileCouncilCheckpointRepository(f.root)).compile(f.initial.id);
    expect(retry.models.flatMap((model) => model.drafts).length).toBeGreaterThan(3);
    expect(retry.models.flatMap((model) => model.repairs)).toEqual([]);
    expect(await f.checkpoints.get(f.initial.id)).toBeNull();
  });

  it.each(["restore", "delete"])("removes the private selected draft after a persisted %s", async (action) => {
    const f = await fixture();
    const ready = configured();
    await f.service(primaryForSource(), ready.council).compile(f.initial.id);
    const retry = configured("regenerate");
    retry.models[0]!.criticReplies = [timeout()];
    retry.models[2]!.criticReplies = [timeout()];
    const service = f.service(primaryForSource(), retry.council);
    await expect(service.compile(f.initial.id)).rejects.toMatchObject({ code: "ai_error" });
    expect((await f.checkpoints.get(f.initial.id))?.phase).toBe("selected");
    if (action === "restore") await service.restore(f.initial.id, 1);
    else await service.remove(f.initial.id);
    expect(await f.checkpoints.get(f.initial.id)).toBeNull();
  });
});
