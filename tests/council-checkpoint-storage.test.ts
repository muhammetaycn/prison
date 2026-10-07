import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import { runCompilePipeline } from "@/core/pipeline/compile";
import {
  CouncilCheckpointSchema, councilCheckpointModelRef, councilSourceFingerprint,
  type CouncilCheckpoint,
} from "@/models/council-checkpoint";
import type { ResolvedPrison } from "@/models/prison";
import { QUICK_DEPTH, type CouncilDeps } from "@/services/ai/council-config";
import type { LLMProvider } from "@/services/ai/types";
import { FileCouncilCheckpointRepository } from "@/services/storage/council-checkpoint-repository";

const AT = "2026-10-05T01:00:00.000Z";
const privateDirs: string[] = [];

function provider(model: string): LLMProvider {
  return { info: { mode: "ai", provider: "nvidia", model }, generateJson: async () => { throw new Error("No live API calls in storage tests"); } };
}

function council(): CouncilDeps {
  return {
    members: [1, 2, 3].map((index) => ({ id: `member_${index}`, role: `Task specialist ${index}`, provider: provider(`test/member-${index}`) })),
    reserves: [provider("test/reserve")], depth: { ...QUICK_DEPTH }, verifySource: true,
  };
}

async function fixture(): Promise<{ prison: ResolvedPrison; council: CouncilDeps; checkpoint: CouncilCheckpoint }> {
  const prison = await runAnalysisPipeline({ rawRequest: "Prepare a seven-day content plan for my cafe.", language: "en", targetAI: "gpt" }, null, () => new Date(AT));
  const deps = council();
  const winner = councilCheckpointModelRef(deps.members[1]!);
  const checkpoint: CouncilCheckpoint = {
    schemaVersion: 1, prisonId: prison.id, sourceFingerprint: councilSourceFingerprint(prison, deps),
    createdAt: AT, updatedAt: AT, phase: "selected", repairInFlight: false, workingPrison: prison,
    selectedPrompt: "Prepare the requested seven-day content plan, respecting the owner's wording.", strategies: ["Owner-grounded output contract"],
    review: {
      mode: prison.compileOptions.councilMode, executionContext: prison.compileOptions.executionContext, startedAt: AT, completedAt: AT, rounds: 1,
      participants: deps.members.map((member) => ({
        id: member.id, provider: member.provider.info.provider, model: member.provider.info.model!, role: member.role,
        status: member.id === winner.id ? "winner" : "reviewed", error: null,
        initialPrompt: `Real task candidate ${member.id}`, revisedPrompt: null, strategies: [], findings: [], score: 0.9,
      })),
      reviews: [], winnerId: winner.id, winnerModel: winner.model,
      decision: "Real candidate selected for mandatory exact-text review.", finalReviewerModel: deps.members[0]!.provider.info.model!,
    },
    winner, writer: null, finalReviewers: [councilCheckpointModelRef(deps.members[0]!), councilCheckpointModelRef(deps.members[2]!)],
    reviewBudgetMs: 90000, feedback: null,
    diagnostics: { initialFindings: [], sourceRepairFindings: [], repairFindings: [] }, appliedFixes: [], sourceRepaired: false,
  };
  return { prison, council: deps, checkpoint };
}

async function repository(): Promise<{ dir: string; repository: FileCouncilCheckpointRepository }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prison-council-checkpoint-"));
  privateDirs.push(dir);
  return { dir, repository: new FileCouncilCheckpointRepository(path.join(dir, ".council-checkpoints")) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(privateDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("private durable council checkpoints", () => {
  it("recovers the exact selected prompt and working task after repository recreation", async () => {
    const { checkpoint } = await fixture();
    const { dir, repository: store } = await repository();
    checkpoint.selectedPrompt = `\n ${checkpoint.selectedPrompt}\n`;
    expect(await store.get(checkpoint.prisonId)).toBeNull();
    await store.save(checkpoint);
    const reloaded = new FileCouncilCheckpointRepository(path.join(dir, ".council-checkpoints"));
    expect(await reloaded.get(checkpoint.prisonId)).toEqual(checkpoint);
    expect(await fs.readdir(path.join(dir, ".council-checkpoints"))).toEqual([`${checkpoint.prisonId}.json`]);
    checkpoint.selectedPrompt = "Mutation outside the repository";
    expect((await store.get(checkpoint.prisonId))?.selectedPrompt).not.toBe(checkpoint.selectedPrompt);
  });

  it("atomically replaces selected, prepared repair, repaired and rejected phases in the same task file", async () => {
    const { checkpoint } = await fixture();
    const { repository: store } = await repository();
    for (const phase of ["selected", "needs_repair", "repaired", "rejected"] as const) {
      const record = { ...checkpoint, phase, feedback: phase === "selected" ? null : "Public exact-text findings" };
      await store.save(record);
      expect(await store.get(checkpoint.prisonId)).toEqual(record);
    }
    expect(await store.delete(checkpoint.prisonId)).toBe(true);
    expect(await store.delete(checkpoint.prisonId)).toBe(false);
    expect(await store.get(checkpoint.prisonId)).toBeNull();
  });

  it("never permits a traversal or a checkpoint belonging to another task", async () => {
    const { checkpoint } = await fixture();
    const { dir, repository: store } = await repository();
    for (const id of ["../pr_abcd1234", "pr_abcdefgh/../../escape", "PR_abcd1234", "pr_short"]) {
      await expect(store.get(id)).rejects.toMatchObject({ code: "not_found" });
      await expect(store.delete(id)).rejects.toMatchObject({ code: "not_found" });
    }
    await expect(store.save({ ...checkpoint, prisonId: "pr_abcd1234" })).rejects.toMatchObject({ code: "storage_error" });
    expect(await fs.readdir(dir)).toEqual([]);
    await store.save(checkpoint);
    const filename = path.join(dir, ".council-checkpoints", `${checkpoint.prisonId}.json`);
    await fs.writeFile(filename, JSON.stringify({ ...checkpoint, prisonId: "pr_abcd1234", workingPrison: { ...checkpoint.workingPrison, id: "pr_abcd1234" } }));
    await expect(store.get(checkpoint.prisonId)).rejects.toMatchObject({ code: "storage_error" });
  });

  it("rejects unsupported schema versions, extra checkpoint fields and executable finding patches", async () => {
    const { checkpoint } = await fixture();
    const { repository: store } = await repository();
    for (const invalid of [
      { ...checkpoint, schemaVersion: 2 },
      { ...checkpoint, provider: { apiKey: "secret-provider-client" } },
      { ...checkpoint, winner: { ...checkpoint.winner, apiKey: "secret-provider-client" } },
      { ...checkpoint, diagnostics: { ...checkpoint.diagnostics, initialFindings: [{ rule: "test", dimension: "intent_alignment", severity: "high", message: "Public issue", fix: { removeIds: ["req_1"] } }] } },
    ]) {
      await expect(store.save(invalid as unknown as CouncilCheckpoint)).rejects.toMatchObject({ code: "storage_error" });
    }
    expect(await store.get(checkpoint.prisonId)).toBeNull();
  });

  it("whitelists nested task and council evidence instead of persisting clients or private reasoning", async () => {
    const { checkpoint } = await fixture();
    const { dir, repository: store } = await repository();
    const secret = "nested-provider-key-or-private-reasoning";
    const unsafe = structuredClone(checkpoint) as unknown as Record<string, any>;
    unsafe.workingPrison.engine.client = { apiKey: secret };
    unsafe.workingPrison.spec.client = { apiKey: secret };
    unsafe.workingPrison.intent.privateReasoning = secret;
    unsafe.review.participants[0].privateReasoning = secret;
    await store.save(unsafe as CouncilCheckpoint);
    expect(await store.get(checkpoint.prisonId)).toEqual(checkpoint);
    expect(await fs.readFile(path.join(dir, ".council-checkpoints", `${checkpoint.prisonId}.json`), "utf8")).not.toContain(secret);
  });

  it("fails closed on fabricated winner, writer and reviewer identities", async () => {
    const { checkpoint } = await fixture();
    const invalid = [
      { ...checkpoint, winner: { ...checkpoint.winner, model: "test/fake" } },
      { ...checkpoint, writer: { ...checkpoint.winner, id: "fake_writer" } },
      { ...checkpoint, finalReviewers: [checkpoint.winner] },
      { ...checkpoint, finalReviewers: [checkpoint.finalReviewers[0]!, checkpoint.finalReviewers[0]!] },
      { ...checkpoint, finalReviewers: [{ ...checkpoint.finalReviewers[0]!, provider: "fake_provider" }] },
      { ...checkpoint, finalReviewers: [] },
    ];
    for (const record of invalid) expect(CouncilCheckpointSchema.safeParse(record).success).toBe(false);
    expect(CouncilCheckpointSchema.safeParse({ ...checkpoint, writer: checkpoint.winner }).success).toBe(true);
    expect(CouncilCheckpointSchema.safeParse({ ...checkpoint, writer: checkpoint.finalReviewers[0] }).success).toBe(false);
  });

  it("retains the last durable checkpoint and cleans its temporary file after a failed atomic replacement", async () => {
    const { checkpoint } = await fixture();
    const { dir, repository: store } = await repository();
    await store.save(checkpoint);
    vi.spyOn(fs, "rename").mockRejectedValueOnce(Object.assign(new Error("unsafe raw error details"), { code: "EIO" }));
    await expect(store.save({ ...checkpoint, phase: "needs_repair" })).rejects.toMatchObject({ code: "storage_error", message: "Konsey kontrol noktası kaydedilemedi; mevcut görev korundu." });
    expect((await store.get(checkpoint.prisonId))?.phase).toBe("selected");
    expect(await fs.readdir(path.join(dir, ".council-checkpoints"))).toEqual([`${checkpoint.prisonId}.json`]);
  });

  it("reports corrupt persisted JSON without returning its contents", async () => {
    const { checkpoint } = await fixture();
    const { dir, repository: store } = await repository();
    await store.save(checkpoint);
    await fs.writeFile(path.join(dir, ".council-checkpoints", `${checkpoint.prisonId}.json`), "{raw private diagnostic");
    await expect(store.get(checkpoint.prisonId)).rejects.toMatchObject({ code: "storage_error", message: "Konsey kontrol noktası doğrulanamadı; mevcut görev korundu." });
  });
});

describe("effective source checkpoint fingerprints", () => {
  it("is stable across status, timestamps, audit history and object key ordering", async () => {
    const { prison, council: deps } = await fixture();
    const changed: ResolvedPrison = {
      ...prison, status: "PROMPT_COMPILED", title: "Different display title", updatedAt: "2026-10-06T01:00:00.000Z", createdAt: "2026-10-01T01:00:00.000Z",
      history: [...prison.history, { at: "2026-10-06T01:00:00.000Z", from: prison.status, to: "PROMPT_COMPILED", note: "Progress bookkeeping" }],
      spec: Object.fromEntries(Object.entries(prison.spec).reverse()) as ResolvedPrison["spec"],
    };
    expect(councilSourceFingerprint(changed, deps)).toBe(councilSourceFingerprint(prison, deps));
  });

  it("invalidates every meaningful task input or mode change", async () => {
    const { prison, council: deps } = await fixture();
    const fingerprint = councilSourceFingerprint(prison, deps);
    const changed: ResolvedPrison[] = [
      { ...prison, rawRequest: `${prison.rawRequest} Use a CSV output.` },
      { ...prison, language: "tr" },
      { ...prison, targetAI: "claude" },
      { ...prison, spec: { ...prison.spec, primaryGoal: "Changed goal" } },
      { ...prison, intent: { ...prison.intent, primary_goal: "Changed model interpretation" } },
      { ...prison, compileOptions: { ...prison.compileOptions, jailbreakMode: true } },
      { ...prison, compileOptions: { ...prison.compileOptions, councilMode: "collaboration" } },
      { ...prison, compileOptions: { ...prison.compileOptions, executionContext: "browser" } },
      { ...prison, activeVersion: 42 },
    ];
    for (const source of changed) expect(councilSourceFingerprint(source, deps)).not.toBe(fingerprint);
  });

  it("hashes active owner IDs, exact messages and clarification answers, ignoring inactive branch records", async () => {
    const { prison, council: deps } = await fixture();
    const owner = { id: "rev_owner", createdAt: AT, message: "Keep the output concise.", summary: "Owner instruction", changes: [], resultVersion: null, engine: "ai" as const,
      clarifications: [{ question: "Which language?", answer: "English" }] };
    const source = { ...prison, revisions: [owner], inactiveOwnerRevisionIds: [] };
    const fingerprint = councilSourceFingerprint(source, deps);
    for (const changed of [
      { ...owner, id: "rev_new_id" },
      { ...owner, message: "Keep the output detailed." },
      { ...owner, clarifications: [{ question: "Which language?", answer: "Turkish" }] },
    ]) expect(councilSourceFingerprint({ ...source, revisions: [changed] }, deps)).not.toBe(fingerprint);
    expect(councilSourceFingerprint({ ...source, revisions: [{ ...owner, createdAt: "2026-10-06T01:00:00.000Z", summary: "Different audit summary" }] }, deps)).toBe(fingerprint);
    expect(councilSourceFingerprint({ ...source, revisions: [owner, { ...owner, id: "rev_inactive", message: "Inactive old branch" }], inactiveOwnerRevisionIds: ["rev_inactive"] }, deps)).toBe(fingerprint);
  });

  it("hashes active memory scope but ignores inactive memory and bookkeeping timestamps", async () => {
    const { prison, council: deps } = await fixture();
    const memory = { id: "mem_owner", createdAt: AT, directive: "Preserve the owner's menu.", kind: "constraint" as const, itemRefs: ["con_1"], active: true };
    const source = { ...prison, taskMemory: [memory] };
    const fingerprint = councilSourceFingerprint(source, deps);
    expect(councilSourceFingerprint({ ...source, taskMemory: [{ ...memory, itemRefs: ["con_2"] }] }, deps)).not.toBe(fingerprint);
    expect(councilSourceFingerprint({ ...source, taskMemory: [{ ...memory, directive: "Another memory" }] }, deps)).not.toBe(fingerprint);
    expect(councilSourceFingerprint({ ...source, taskMemory: [{ ...memory, createdAt: "2026-10-06T01:00:00.000Z" }, { ...memory, id: "mem_inactive", active: false }] }, deps)).toBe(fingerprint);
  });

  it("includes the current active prompt text instead of just its version number", async () => {
    const { prison, council: deps } = await fixture();
    const compiled = await runCompilePipeline(prison, { trigger: "initial", note: "", llmReview: false }, { provider: null, now: () => new Date(AT) });
    const fingerprint = councilSourceFingerprint(compiled, deps);
    const changed = { ...compiled, promptVersions: compiled.promptVersions.map((version) => ({ ...version, text: `${version.text}\nChanged prompt memory.` })) };
    expect(councilSourceFingerprint(changed, deps)).not.toBe(fingerprint);
  });

  it("includes actual primary, member, reserve, role and depth configuration without hashing provider secrets", async () => {
    const { prison, council: deps } = await fixture();
    const primary = provider("test/primary");
    const fingerprint = councilSourceFingerprint(prison, deps, primary);
    const changed: CouncilDeps[] = [
      { ...deps, members: deps.members.map((member, index) => index === 0 ? { ...member, id: "changed_id" } : member) },
      { ...deps, members: deps.members.map((member, index) => index === 0 ? { ...member, role: "New specialty" } : member) },
      { ...deps, members: deps.members.map((member, index) => index === 0 ? { ...member, provider: provider("test/new-member") } : member) },
      { ...deps, reserves: [provider("test/new-reserve")] },
      { ...deps, depth: { ...deps.depth!, maxBattleRounds: 5 } },
      { ...deps, verifySource: false },
    ];
    for (const configuration of changed) expect(councilSourceFingerprint(prison, configuration, primary)).not.toBe(fingerprint);
    expect(councilSourceFingerprint(prison, deps, provider("test/new-primary"))).not.toBe(fingerprint);
    (primary as unknown as Record<string, unknown>).apiKey = "private-client-field";
    (deps.depth as unknown as Record<string, unknown>).apiKey = "private-depth-field";
    (deps.members[0]!.provider.info as unknown as Record<string, unknown>).apiKey = "private-info-field";
    expect(councilSourceFingerprint(prison, deps, primary)).toBe(fingerprint);
  });
});
