import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OperationManager, createOperationManagerState } from "@/services/operation-manager";
import { FileOperationRepository, type OperationRepository } from "@/services/storage/operation-repository";
import { AppError } from "@/services/errors";
import { PrisonOperationSchema, type OperationRequest, type PrisonOperation } from "@/models/operation";
import type { OperationProgress } from "@/models/operation-progress";
import type { PrisonService } from "@/services/prison-service";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";

class MemoryOperations implements OperationRepository {
  rows = new Map<string, PrisonOperation>();
  latestIds = new Map<string, string>();
  writes: PrisonOperation[] = [];
  async get(id: string) { return structuredClone(this.rows.get(id) ?? null); }
  async latest(id: string) { return this.get(this.latestIds.get(id) ?? ""); }
  async save(record: PrisonOperation) {
    this.writes.push(structuredClone(record));
    this.rows.set(record.id, structuredClone(record));
    if (record.status === "queued") this.latestIds.set(record.prisonId, record.id);
  }
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup(repo: OperationRepository = new MemoryOperations()) {
  const prison = await runAnalysisPipeline({ rawRequest: "Create a weekly content plan.", language: "en", targetAI: "gpt" }, null);
  let listener: ((p: OperationProgress | null) => void) | undefined;
  const service = { hasActiveMutation: vi.fn(() => false), get: vi.fn(async (id: string) => {
    if (id !== prison.id) throw new AppError("not_found", "Prison bulunamadı.");
    return structuredClone(prison);
  }), compile: vi.fn(async () => prison), adjust: vi.fn(async () => prison), revise: vi.fn(async () => prison), clarify: vi.fn(async () => prison), subscribeProgress: vi.fn((_id: string, callback: typeof listener) => {
    listener = callback;
    return () => { listener = undefined; };
  }) } as unknown as PrisonService;
  const state = createOperationManagerState();
  const manager = new OperationManager(repo, service, state);
  const publish = () => listener?.({ stage: "voting", completed: 1, total: 3, message: "Actual public discussion", startedAt: prison.createdAt,
    events: [{ seq: 0, at: prison.createdAt, kind: "objection", round: 3, actorId: "a", model: "test/a", targetId: null, dimension: null, score: null, text: "Concrete public objection" }] });
  return { manager, repo, service, state, prison, publish };
}

afterEach(() => { vi.useRealTimers(); });

describe("durable long-running operations", () => {
  it("accepts before a long worker finishes and rejects duplicate submission", async () => {
    const { manager, prison, publish } = await setup();
    const hold = gate(); const entered = gate();
    const job = await manager.start(prison.id, "compile", async () => {
      publish(); entered.resolve(); await hold.promise;
      return { ...prison, activeVersion: 1 };
    });
    await entered.promise;
    expect(job.status).toBe("running");
    await expect(manager.start(prison.id, "compile", async () => prison)).rejects.toMatchObject({ code: "busy" });
    expect((await manager.latest(prison.id))?.progress?.events?.[0]?.text).toBe("Concrete public objection");
    hold.resolve(); await manager.wait(job.id);
    expect(await manager.get(job.id)).toMatchObject({ status: "completed", resultVersion: 1 });
    expect((await manager.latest(prison.id))?.progress?.events).toHaveLength(1);
  });

  it("has no total elapsed-time deadline and a client abort does not cancel the worker", async () => {
    vi.useFakeTimers();
    const { manager, prison } = await setup();
    const hold = gate(); const entered = gate();
    const client = new AbortController();
    const job = await manager.start(prison.id, "compile", async () => { entered.resolve(); await hold.promise; return { ...prison, activeVersion: 2 }; });
    await entered.promise;
    client.abort();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect((await manager.get(job.id)).status).toBe("running");
    hold.resolve(); await manager.wait(job.id);
    expect((await manager.get(job.id)).status).toBe("completed");
  });

  it("retains terminal failure and public timeline without leaking error details", async () => {
    const { manager, prison, publish, repo } = await setup();
    const job = await manager.start(prison.id, "compile", async () => {
      publish(); throw new AppError("validation_error", "Son metin denetimden geçemedi.", "secret diagnostic value");
    });
    await manager.wait(job.id);
    const record = await manager.latest(prison.id);
    expect(record).toMatchObject({ status: "failed", error: { code: "validation_error", message: "Son metin denetimden geçemedi." } });
    expect(record?.progress?.events).toHaveLength(1);
    expect(JSON.stringify((repo as MemoryOperations).writes)).not.toContain("secret diagnostic value");
    await expect(manager.assertIdle(prison.id)).resolves.toBeUndefined();
  });

  it("does not lose an active operation after runtime/service hot reload", async () => {
    const { manager, prison, state, repo, service } = await setup();
    const hold = gate(); const entered = gate();
    const job = await manager.start(prison.id, "compile", async () => { entered.resolve(); await hold.promise; return prison; });
    await entered.promise;
    const refreshed = new OperationManager(repo, service, state);
    expect((await refreshed.get(job.id)).status).toBe("running");
    await expect(refreshed.start(prison.id, "revise", async () => prison)).rejects.toMatchObject({ code: "busy" });
    hold.resolve(); await manager.wait(job.id);
    expect((await refreshed.latest(prison.id))?.status).toBe("completed");
  });

  it("marks an abandoned saved job interrupted after process restart and keeps its evidence", async () => {
    const { manager, prison, publish, repo, service } = await setup();
    const hold = gate(); const entered = gate();
    const job = await manager.start(prison.id, "compile", async () => { publish(); entered.resolve(); await hold.promise; return prison; });
    await entered.promise;
    const recovered = new MemoryOperations();
    await recovered.save({ ...(await manager.get(job.id)), status: "queued" });
    await recovered.save(await manager.get(job.id));
    const restarted = new OperationManager(recovered, service);
    const record = await restarted.latest(prison.id);
    expect(record).toMatchObject({ id: job.id, status: "interrupted", error: { code: "interrupted" } });
    expect(record?.progress?.events).toHaveLength(1);
    expect((await restarted.get(job.id)).status).toBe("interrupted");
    hold.resolve(); await manager.wait(job.id);
    expect((repo as MemoryOperations).rows.get(job.id)?.status).toBe("completed");
  });

  it("reserves before I/O and never launches work if initial durable storage fails", async () => {
    const repo = new MemoryOperations(); const hold = gate();
    repo.save = vi.fn(async () => { await hold.promise; throw new AppError("storage_error", "Disk unavailable"); });
    const { manager, prison } = await setup(repo);
    const worker = vi.fn(async () => prison);
    const accepted = manager.start(prison.id, "compile", worker);
    await expect(manager.start(prison.id, "compile", worker)).rejects.toMatchObject({ code: "busy" });
    hold.resolve(); await expect(accepted).rejects.toMatchObject({ code: "storage_error" });
    expect(worker).not.toHaveBeenCalled();
    await expect(manager.assertIdle(prison.id)).resolves.toBeUndefined();
  });

  it("keeps completion newer than every throttled progress snapshot", async () => {
    vi.useFakeTimers();
    const { manager, prison, publish, repo } = await setup();
    const hold = gate(); const entered = gate();
    const job = await manager.start(prison.id, "compile", async () => { publish(); entered.resolve(); await hold.promise; return prison; });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(250);
    hold.resolve(); await manager.wait(job.id);
    await vi.advanceTimersByTimeAsync(1000);
    expect((repo as MemoryOperations).writes.at(-1)?.status).toBe("completed");
    expect((await manager.latest(prison.id))?.status).toBe("completed");
  });

  it("keeps a readable terminal snapshot even if the final disk write fails", async () => {
    const repo = new MemoryOperations(); const save = repo.save.bind(repo);
    repo.save = async record => {
      if (record.status === "completed") throw new AppError("storage_error", "Disk unavailable");
      await save(record);
    };
    const { manager, prison } = await setup(repo);
    const job = await manager.start(prison.id, "compile", async () => ({ ...prison, activeVersion: 3 }));
    await manager.wait(job.id);
    expect((await manager.get(job.id)).status).toBe("completed");
    expect((await manager.latest(prison.id))?.status).toBe("completed");
  });

  it("sanitizes unexpected worker errors and does not expose another task's jobs", async () => {
    const { manager, prison } = await setup();
    const job = await manager.start(prison.id, "compile", async () => { throw new Error("Bearer sensitive_key"); });
    await manager.wait(job.id);
    expect(JSON.stringify(await manager.get(job.id))).not.toContain("sensitive_key");
    await expect(manager.latest("pr_aaaaaaaa")).rejects.toMatchObject({ code: "not_found" });
  });

  it("reserves short restore/delete actions atomically against new long jobs", async () => {
    const { manager, prison } = await setup();
    const hold = gate();
    const short = manager.runIdle(prison.id, async () => { await hold.promise; return "restored"; });
    await expect(manager.start(prison.id, "compile", async () => prison)).rejects.toMatchObject({ code: "busy" });
    hold.resolve(); await expect(short).resolves.toBe("restored");
    await expect(manager.assertIdle(prison.id)).resolves.toBeUndefined();
  });

  it("does not queue another job behind a legacy direct service mutation", async () => {
    const { manager, prison, service } = await setup();
    vi.mocked(service.hasActiveMutation).mockReturnValue(true);
    const worker = vi.fn(async () => prison);
    await expect(manager.start(prison.id, "compile", worker)).rejects.toMatchObject({ code: "busy" });
    await expect(manager.runIdle(prison.id, worker)).rejects.toMatchObject({ code: "busy" });
    expect(worker).not.toHaveBeenCalled();
  });
});

describe("operation file persistence", () => {
  it("persists task-isolated status and rejects traversal and mismatched indices", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prison-operation-"));
    try {
      const repo = new FileOperationRepository(dir);
      const { manager, prison } = await setup(repo);
      const job = await manager.start(prison.id, "compile", async () => ({ ...prison, activeVersion: 1 }));
      await manager.wait(job.id);
      expect((await new FileOperationRepository(dir).latest(prison.id))?.status).toBe("completed");
      await expect(repo.get("../.env.local")).rejects.toMatchObject({ code: "not_found" });
      await fs.writeFile(path.join(dir, "pr_aaaaaaaa.latest.json"), JSON.stringify(job.id));
      await expect(repo.latest("pr_aaaaaaaa")).rejects.toMatchObject({ code: "storage_error" });
      expect((await repo.get(`op_${randomUUID().replaceAll("-", "")}`))).toBeNull();
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe("exact durable operation retry", () => {
  const requests: { request: OperationRequest; method: "compile" | "adjust" | "revise" | "clarify"; expected: unknown }[] = [
    { request: { kind: "compile", input: { executionContext: "mobile", councilMode: "collaboration" } }, method: "compile", expected: { executionContext: "mobile", councilMode: "collaboration" } },
    { request: { kind: "adjust", input: { executionContext: "mobile" } }, method: "adjust", expected: { kind: "context", executionContext: "mobile" } },
    { request: { kind: "adjust", input: { councilMode: "collaboration" } }, method: "adjust", expected: { kind: "council_mode", councilMode: "collaboration" } },
    { request: { kind: "adjust", input: { target: "claude" } }, method: "adjust", expected: { kind: "target", target: "claude" } },
    { request: { kind: "adjust", input: { action: "toggle_jailbreak" } }, method: "adjust", expected: { kind: "modifier", action: "toggle_jailbreak" } },
    { request: { kind: "revise", input: { message: "Make the table shorter." } }, method: "revise", expected: "Make the table shorter." },
    { request: { kind: "clarify", input: { clarifications: [{ question: "Which audience?", answer: "Coffee lovers" }] } }, method: "clarify", expected: [{ question: "Which audience?", answer: "Coffee lovers" }] },
  ];

  it.each(requests)("replays $request.kind input after a failed job without substituting compile or persisted options", async ({ request, method, expected }) => {
    const { manager, prison, service } = await setup();
    const previous = await manager.start(prison.id, request.kind, async () => { throw new AppError("ai_error", "Unavailable"); }, request);
    await manager.wait(previous.id);
    const retry = await manager.retry(previous.id);
    await manager.wait(retry.id);
    expect(retry.id).not.toBe(previous.id);
    expect(retry.retry?.request).toEqual(request);
    expect(service[method]).toHaveBeenCalledExactlyOnceWith(prison.id, expected);
    if (method !== "compile") expect(service.compile).not.toHaveBeenCalled();
    expect((await manager.get(retry.id)).status).toBe("completed");
  });

  it.each(requests)("retains the exact $request.kind action through a repository reload", async ({ request, method, expected }) => {
    const repo = new MemoryOperations();
    const { manager, prison, service } = await setup(repo);
    const previous = await manager.start(prison.id, request.kind, async () => { throw new AppError("ai_error", "Unavailable"); }, request);
    await manager.wait(previous.id);
    const restarted = new OperationManager(repo, service);
    expect((await restarted.latest(prison.id))?.retry?.request).toEqual(request);
    const retry = await restarted.retry(previous.id);
    await restarted.wait(retry.id);
    expect(service[method]).toHaveBeenCalledExactlyOnceWith(prison.id, expected);
  });

  it("blocks stale owner actions after the task changes", async () => {
    const { manager, prison, service } = await setup();
    const previous = await manager.start(prison.id, "revise", async () => { throw new Error("Unavailable"); }, { kind: "revise", input: { message: "Use an older audience" } });
    await manager.wait(previous.id);
    prison.rawRequest += " Use a different audience instead.";
    await expect(manager.retry(previous.id)).rejects.toMatchObject({ code: "not_ready" });
    expect(service.revise).not.toHaveBeenCalled();
    expect((await manager.latest(prison.id))?.id).toBe(previous.id);
    await expect(manager.assertIdle(prison.id)).resolves.toBeUndefined();
  });

  it("blocks replay of an older failure after another operation is accepted", async () => {
    const { manager, prison, service } = await setup();
    const request: OperationRequest = { kind: "compile", input: {} };
    const previous = await manager.start(prison.id, "compile", async () => { throw new Error("Unavailable"); }, request);
    await manager.wait(previous.id);
    const newer = await manager.start(prison.id, "compile", async () => { throw new Error("Unavailable again"); }, request);
    await manager.wait(newer.id);
    await expect(manager.retry(previous.id)).rejects.toMatchObject({ code: "not_ready" });
    expect(service.compile).not.toHaveBeenCalled();
  });

  it("reserves one retry before worker execution and rejects a second replay", async () => {
    const { manager, prison, service } = await setup();
    const previous = await manager.start(prison.id, "compile", async () => { throw new Error("Unavailable"); }, { kind: "compile", input: { executionContext: "browser" } });
    await manager.wait(previous.id);
    const hold = gate();
    vi.mocked(service.compile).mockImplementation(async () => { await hold.promise; return prison; });
    const retry = await manager.retry(previous.id);
    await expect(manager.retry(previous.id)).rejects.toMatchObject({ code: "busy" });
    expect(service.compile).toHaveBeenCalledTimes(1);
    hold.resolve(); await manager.wait(retry.id);
  });

  it("does not invent the missing action in a legacy operation", async () => {
    const { manager, prison, service } = await setup();
    const previous = await manager.start(prison.id, "revise", async () => { throw new Error("Unavailable"); });
    await manager.wait(previous.id);
    await expect(manager.retry(previous.id)).rejects.toMatchObject({ code: "not_ready" });
    expect(service.revise).not.toHaveBeenCalled();
    expect(service.compile).not.toHaveBeenCalled();
  });

  it("validates metadata kind and rejects fields that could contain provider credentials", async () => {
    const { manager, prison } = await setup();
    const worker = vi.fn(async () => prison);
    await expect(manager.start(prison.id, "compile", worker, { kind: "revise", input: { message: "A revision" } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(manager.start(prison.id, "compile", worker, { kind: "compile", input: { apiKey: "secret" } } as unknown as OperationRequest)).rejects.toMatchObject({ code: "invalid_input" });
    expect(worker).not.toHaveBeenCalled();
  });

  it("persists only schema-approved retry input and validates it again when reading from disk", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prison-operation-retry-"));
    try {
      const repo = new FileOperationRepository(dir);
      const { manager, prison, service } = await setup(repo);
      const request: OperationRequest = { kind: "compile", input: { executionContext: "mobile", councilMode: "collaboration" } };
      const previous = await manager.start(prison.id, "compile", async () => { throw new Error("Unavailable"); }, request);
      await manager.wait(previous.id);
      const restarted = new OperationManager(new FileOperationRepository(dir), service);
      const saved = await restarted.get(previous.id);
      expect(saved.retry?.request).toEqual(request);
      const retry = await restarted.retry(previous.id); await restarted.wait(retry.id);
      expect(service.compile).toHaveBeenCalledExactlyOnceWith(prison.id, request.input);
      const invalid = { ...saved, retry: { ...saved.retry, request: { kind: "compile", input: { ...request.input, apiKey: "sensitive" } } } };
      expect(PrisonOperationSchema.safeParse(invalid).success).toBe(false);
      await fs.writeFile(path.join(dir, `${previous.id}.json`), JSON.stringify(invalid));
      await expect(repo.get(previous.id)).rejects.toMatchObject({ code: "storage_error" });
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
