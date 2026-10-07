import { randomUUID } from "node:crypto";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAnalysisPipeline } from "@/core/pipeline/analyze";
import type { PipelineDeps } from "@/core/pipeline/compile";
import { summarizePrison, type Prison, type ResolvedPrison } from "@/models/prison";
import { createPrisonOperationState, PrisonService } from "@/services/prison-service";
import type { PrisonRepository } from "@/services/storage/repository";

const mocks = vi.hoisted(() => ({
  compile: vi.fn(), repositories: new Map<string, PrisonRepository>(), directories: [] as string[],
  provider: vi.fn(() => ({ info: { mode: "ai", provider: "test", model: "test/model" }, generateJson: vi.fn() })),
  council: vi.fn(() => ({ members: [] })), health: vi.fn(() => vi.fn()),
}));
vi.mock("@/core/pipeline/compile", () => ({ runCompilePipeline: mocks.compile }));
vi.mock("@/services/ai/config", () => ({
  resolveEngineStatus: () => ({ mode: "ai", provider: "nvidia", model: "test/model" }), createProvider: mocks.provider,
}));
vi.mock("@/services/ai/council-config", () => ({ createCouncil: mocks.council }));
vi.mock("@/services/ai/health", () => ({ createEngineConnectionCheck: mocks.health }));
vi.mock("@/services/storage/file-repository", () => ({
  FilePrisonRepository: class {
    constructor(dir: string) {
      mocks.directories.push(dir);
      let repo = mocks.repositories.get(dir);
      if (!repo) { repo = new MemoryRepository(); mocks.repositories.set(dir, repo); }
      return repo;
    }
  },
}));

class MemoryRepository implements PrisonRepository {
  private readonly rows = new Map<string, Prison>();
  async list() { return [...this.rows.values()].map(summarizePrison); }
  async get(id: string) { return structuredClone(this.rows.get(id) ?? null); }
  async save(prison: Prison) { this.rows.set(prison.id, structuredClone(prison)); }
  async delete(id: string) { return this.rows.delete(id); }
}

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function publish(deps: PipelineDeps) {
  deps.onProgress?.({ stage: "preflight", completed: 0, total: 3, message: "Operation is running", councilMode: "competition" });
  deps.onCouncilEvent?.({ seq: 0, at: "2026-10-04T18:00:00Z", round: 0, kind: "seat", actorId: "a", model: "test/a", targetId: null, dimension: null, score: null, text: "Actual seat" });
}

let repo: MemoryRepository;
let task: ResolvedPrison;

beforeEach(async () => {
  vi.resetModules();
  mocks.compile.mockReset();
  mocks.provider.mockClear(); mocks.council.mockClear(); mocks.health.mockClear();
  mocks.repositories.clear(); mocks.directories.length = 0;
  repo = new MemoryRepository();
  task = await runAnalysisPipeline({ rawRequest: "Create a weekday study plan.", language: "en", targetAI: "gpt" }, null);
  await repo.save(task);
});

describe("shared runtime operation state", () => {
  it("shares progress and serializes writes across service instances using the same state", async () => {
    const state = createPrisonOperationState();
    const first = new PrisonService(repo, null, undefined, null, state);
    const second = new PrisonService(repo, null, undefined, null, state);
    const entered = signal(); const release = signal();
    let secondTitle: string | undefined;
    mocks.compile.mockImplementationOnce(async (input: ResolvedPrison, _request: unknown, deps: PipelineDeps) => {
      publish(deps); entered.resolve(); await release.promise;
      return { ...input, title: "First saved" };
    }).mockImplementationOnce(async (input: ResolvedPrison) => {
      secondTitle = input.title;
      expect(await second.getProgress(task.id)).toBeNull();
      return { ...input, title: "Second saved" };
    });
    const running = first.compile(task.id);
    await entered.promise;
    const queued = second.compile(task.id);
    try {
      expect(await second.getProgress(task.id)).toMatchObject({ stage: "preflight", events: [{ kind: "seat", actorId: "a" }] });
      expect(mocks.compile).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); await Promise.all([running, queued]); }
    expect(secondTitle).toBe("First saved");
    expect((await first.get(task.id)).title).toBe("Second saved");
    expect(await first.getProgress(task.id)).toBeNull();
    expect(await second.getProgress(task.id)).toBeNull();
  });

  it("keeps in-flight progress and locks after module reload while refreshing runtime dependencies", async () => {
    const initial = await import("@/services/runtime");
    const first = initial.getRuntime();
    const runtimeRepo = mocks.repositories.get(mocks.directories[0]!)!;
    await runtimeRepo.save(task);
    const entered = signal(); const release = signal();
    mocks.compile.mockImplementationOnce(async (input: ResolvedPrison, _request: unknown, deps: PipelineDeps) => {
      publish(deps); entered.resolve(); await release.promise;
      return { ...input, title: "Saved by old runtime" };
    }).mockImplementationOnce(async (input: ResolvedPrison, _request: unknown, deps: PipelineDeps) => {
      expect(input.title).toBe("Saved by old runtime");
      expect(deps.provider).toBe(mocks.provider.mock.results[1]!.value);
      expect(deps.council).toBe(mocks.council.mock.results[1]!.value);
      return input;
    });
    const running = first.service.compile(task.id);
    await entered.promise;
    vi.resetModules();
    const reloaded = await import("@/services/runtime");
    const second = reloaded.getRuntime();
    const queued = second.service.compile(task.id);
    try {
      expect(second).not.toBe(first);
      expect(second.service).not.toBe(first.service);
      expect(second.council).not.toBe(first.council);
      expect(second.checkEngine).not.toBe(first.checkEngine);
      expect(mocks.provider).toHaveBeenCalledTimes(2);
      expect(mocks.provider.mock.results[1]!.value).not.toBe(mocks.provider.mock.results[0]!.value);
      expect(await second.service.getProgress(task.id)).toMatchObject({ stage: "preflight", events: [{ kind: "seat" }] });
      expect(mocks.compile).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); await Promise.all([running, queued]); }
    expect(await second.service.getProgress(task.id)).toBeNull();
  });

  it("shares equivalent resolved directories and isolates different directories with the same prison id", async () => {
    const { getRuntimeOperationState } = await import("@/services/runtime");
    const directory = path.join(process.cwd(), `test-runtime-${randomUUID()}`, "first");
    const state = getRuntimeOperationState(directory);
    expect(getRuntimeOperationState(path.join(directory, "unused", ".."))).toBe(state);
    if (process.platform === "win32") expect(getRuntimeOperationState(directory.toUpperCase())).toBe(state);
    const otherState = getRuntimeOperationState(path.join(directory, "..", "second"));
    expect(otherState).not.toBe(state);
    const otherRepo = new MemoryRepository(); await otherRepo.save(task);
    const first = new PrisonService(repo, null, undefined, null, state);
    const second = new PrisonService(otherRepo, null, undefined, null, otherState);
    const entered = signal(); const release = signal();
    mocks.compile.mockImplementationOnce(async (input: ResolvedPrison, _request: unknown, deps: PipelineDeps) => {
      publish(deps); entered.resolve(); await release.promise; return input;
    }).mockImplementationOnce(async (input: ResolvedPrison) => input);
    const running = first.compile(task.id); await entered.promise;
    try {
      expect(await second.getProgress(task.id)).toBeNull();
      await second.compile(task.id);
      expect(mocks.compile).toHaveBeenCalledTimes(2);
      expect(await first.getProgress(task.id)).not.toBeNull();
    } finally { release.resolve(); await running; }
  });

  it.each(["default", "explicit"] as const)("keeps %s service state independent", async (kind) => {
    const first = new PrisonService(repo, null, undefined, null, kind === "explicit" ? createPrisonOperationState() : undefined);
    const second = new PrisonService(repo, null, undefined, null, kind === "explicit" ? createPrisonOperationState() : undefined);
    const entered = signal(); const release = signal();
    mocks.compile.mockImplementationOnce(async (input: ResolvedPrison, _request: unknown, deps: PipelineDeps) => {
      publish(deps); entered.resolve(); await release.promise; return input;
    }).mockImplementationOnce(async (input: ResolvedPrison) => input);
    const running = first.compile(task.id); await entered.promise;
    try {
      expect(await second.getProgress(task.id)).toBeNull();
      await second.compile(task.id);
      expect(mocks.compile).toHaveBeenCalledTimes(2);
      expect(await first.getProgress(task.id)).not.toBeNull();
    } finally { release.resolve(); await running; }
  });

  it("clears failed progress and releases the shared lock for the next queued operation", async () => {
    const state = createPrisonOperationState();
    const first = new PrisonService(repo, null, undefined, null, state);
    const second = new PrisonService(repo, null, undefined, null, state);
    const entered = signal(); const release = signal();
    mocks.compile.mockImplementationOnce(async (_input: ResolvedPrison, _request: unknown, deps: PipelineDeps) => {
      publish(deps); entered.resolve(); await release.promise; throw new Error("Mock pipeline failure");
    }).mockImplementationOnce(async (input: ResolvedPrison) => {
      expect(await second.getProgress(task.id)).toBeNull();
      return input;
    });
    const failed = first.compile(task.id).catch((error: unknown) => error);
    await entered.promise;
    const queued = second.compile(task.id);
    try { expect(await second.getProgress(task.id)).not.toBeNull(); }
    finally { release.resolve(); }
    expect(await failed).toMatchObject({ code: "storage_error" });
    await queued;
    expect(mocks.compile).toHaveBeenCalledTimes(2);
    expect(await first.getProgress(task.id)).toBeNull();
  });

  it("clears progress when saving fails and allows a later operation", async () => {
    const state = createPrisonOperationState();
    const first = new PrisonService(repo, null, undefined, null, state);
    const second = new PrisonService(repo, null, undefined, null, state);
    mocks.compile.mockImplementation(async (input: ResolvedPrison, _request: unknown, deps: PipelineDeps) => { publish(deps); return input; });
    vi.spyOn(repo, "save").mockRejectedValueOnce(new Error("Mock save failure"));
    await expect(first.compile(task.id)).rejects.toMatchObject({ code: "storage_error" });
    expect(await second.getProgress(task.id)).toBeNull();
    await second.compile(task.id);
    expect(await first.getProgress(task.id)).toBeNull();
  });
});
