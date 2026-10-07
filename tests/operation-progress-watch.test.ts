import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prison } from "@/models/prison";
import type { PrisonOperation } from "@/models/operation";
import { ApiError, type CouncilProgress } from "@/ui/lib/api";
import { watchOperationProgress, type OperationProgressWatch } from "@/ui/lib/operation-progress-watch";

const progress: CouncilProgress = {
  stage: "peer_review", completed: 2, total: 5, message: "Actual council progress", startedAt: "2026-10-04T18:00:00Z",
  events: [{ seq: 0, at: "2026-10-04T18:00:00Z", round: 0, kind: "seat", actorId: "a", model: "test/a", targetId: null, dimension: null, score: null, text: "Actual seat" }],
};
const updated = { id: "pr_watch001", title: "Updated task", activeVersion: 2 } as Prison;
const running: PrisonOperation = {
  id: `op_${"a".repeat(32)}`, prisonId: updated.id, kind: "compile", status: "running", progress,
  startedAt: progress.startedAt, updatedAt: progress.startedAt, resultVersion: null, error: null,
};
const completed: PrisonOperation = { ...running, status: "completed", resultVersion: 2 };
const watches: OperationProgressWatch[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(local = false) {
  const callbacks = {
    readOperation: vi.fn().mockResolvedValue({ operation: null }),
    readPrison: vi.fn().mockResolvedValue({ prison: updated }),
    onPhase: vi.fn(), onProgress: vi.fn(), onOperation: vi.fn(), onCompleted: vi.fn(), onError: vi.fn(),
  };
  const start = (id = updated.id) => {
    const watch = watchOperationProgress({ id, local, ...callbacks });
    watches.push(watch);
    return watch;
  };
  return { ...callbacks, start };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  for (const watch of watches.splice(0)) watch.stop();
  vi.useRealTimers();
});

describe("durable selected task operation discovery", () => {
  it("checks an idle task once and blocks actions until discovery finishes", async () => {
    const calls = setup();
    const watch = calls.start();
    expect(watch.canMutate()).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(watch.canMutate()).toBe(true);
    expect(calls.onPhase).toHaveBeenLastCalledWith("idle");
    expect(calls.readOperation).toHaveBeenCalledTimes(1);
    expect(calls.readPrison).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finds work after reload and stays locked until the completed saved result arrives", async () => {
    const calls = setup();
    const refresh = deferred<{ prison: Prison }>();
    calls.readOperation.mockResolvedValueOnce({ operation: running }).mockResolvedValueOnce({ operation: completed });
    calls.readPrison.mockReturnValueOnce(refresh.promise);
    const watch = calls.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.onPhase).toHaveBeenLastCalledWith("refreshing");
    expect(watch.canMutate()).toBe(false);
    expect(calls.onProgress).toHaveBeenLastCalledWith(progress);
    expect(calls.onCompleted).not.toHaveBeenCalled();
    refresh.resolve({ prison: updated });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.onCompleted).toHaveBeenCalledExactlyOnceWith(updated);
    expect(watch.canMutate()).toBe(true);
    expect(calls.readOperation).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fetches a finished result even when the job completed before this page loaded", async () => {
    const calls = setup();
    calls.readOperation.mockResolvedValueOnce({ operation: completed });
    const watch = calls.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.onOperation).toHaveBeenLastCalledWith(completed);
    expect(calls.onCompleted).toHaveBeenCalledExactlyOnceWith(updated);
    expect(watch.canMutate()).toBe(true);
  });

  it.each(["failed", "interrupted"] as const)("retains %s evidence after reload and enables an explicit retry", async (status) => {
    const failed: PrisonOperation = { ...running, status, error: { code: status, message: "Actual persisted failure" } };
    const calls = setup();
    calls.readOperation.mockResolvedValueOnce({ operation: failed });
    const watch = calls.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.onOperation).toHaveBeenLastCalledWith(failed);
    expect(calls.onProgress).toHaveBeenLastCalledWith(progress);
    expect(calls.readPrison).not.toHaveBeenCalled();
    expect(watch.canMutate()).toBe(true);
    expect(calls.readOperation).toHaveBeenCalledTimes(1);
  });

  it("ignores an earlier terminal job until a local submission publishes its own operation", async () => {
    const calls = setup(true);
    calls.readOperation.mockResolvedValueOnce({ operation: { ...completed, id: `op_${"b".repeat(32)}` } })
      .mockResolvedValueOnce({ operation: running }).mockResolvedValueOnce({ operation: completed });
    const watch = calls.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.onOperation).not.toHaveBeenCalled();
    expect(watch.canMutate()).toBe(false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls.onOperation).toHaveBeenLastCalledWith(completed);
    expect(calls.readPrison).not.toHaveBeenCalled();
    expect(calls.onCompleted).not.toHaveBeenCalled();
  });

  it("keeps a known job busy and its timeline intact across temporary network loss", async () => {
    const calls = setup();
    calls.readOperation.mockResolvedValueOnce({ operation: running }).mockRejectedValueOnce(new ApiError("network", "Offline"))
      .mockResolvedValueOnce({ operation: completed });
    const watch = calls.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(watch.canMutate()).toBe(false);
    expect(calls.onProgress).toHaveBeenLastCalledWith(progress);
    expect(calls.onOperation).toHaveBeenLastCalledWith(running);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.onCompleted).toHaveBeenCalledExactlyOnceWith(updated);
    expect(watch.canMutate()).toBe(true);
  });

  it("does not treat a missing latest record as proof that an observed job completed", async () => {
    const calls = setup();
    calls.readOperation.mockResolvedValueOnce({ operation: running }).mockResolvedValueOnce({ operation: null })
      .mockResolvedValueOnce({ operation: completed });
    const watch = calls.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(watch.canMutate()).toBe(false);
    expect(calls.onOperation).toHaveBeenLastCalledWith(running);
    expect(calls.onProgress).toHaveBeenLastCalledWith(progress);
    expect(calls.readPrison).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.onCompleted).toHaveBeenCalledExactlyOnceWith(updated);
    expect(watch.canMutate()).toBe(true);
  });

  it("keeps discovery locked during lost contact and retries with increasing pauses", async () => {
    const calls = setup();
    calls.readOperation.mockRejectedValueOnce(new ApiError("network", "Offline"))
      .mockRejectedValueOnce(new ApiError("request_timeout", "Timeout"));
    const watch = calls.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(watch.canMutate()).toBe(false);
    expect(calls.readOperation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(calls.readOperation).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.readOperation).toHaveBeenCalledTimes(3);
    expect(watch.canMutate()).toBe(true);
  });

  it("retries only saved-result reads after completion instead of losing a finished job", async () => {
    const calls = setup();
    calls.readOperation.mockResolvedValueOnce({ operation: completed });
    calls.readPrison.mockRejectedValueOnce(new ApiError("network", "Offline"));
    const watch = calls.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.canMutate()).toBe(false);
    expect(calls.onPhase).toHaveBeenLastCalledWith("refreshing");
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.readOperation).toHaveBeenCalledTimes(1);
    expect(calls.readPrison).toHaveBeenCalledTimes(2);
    expect(calls.onCompleted).toHaveBeenCalledExactlyOnceWith(updated);
    expect(watch.canMutate()).toBe(true);
  });

  it("does not overlap reads and ignores an old task's late discovery after cleanup", async () => {
    const calls = setup();
    const delayed = deferred<{ operation: PrisonOperation | null }>();
    calls.readOperation.mockReturnValueOnce(delayed.promise);
    const watch = calls.start();
    const signal = calls.readOperation.mock.calls[0]![1] as AbortSignal;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls.readOperation).toHaveBeenCalledTimes(1);
    watch.stop();
    delayed.resolve({ operation: running });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(signal.aborted).toBe(true);
    expect(calls.onOperation).not.toHaveBeenCalled();
    expect(calls.onCompleted).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a late saved-record refresh after cleanup", async () => {
    const calls = setup();
    const delayed = deferred<{ prison: Prison }>();
    calls.readOperation.mockResolvedValueOnce({ operation: completed });
    calls.readPrison.mockReturnValueOnce(delayed.promise);
    const watch = calls.start();
    await vi.advanceTimersByTimeAsync(0);
    watch.stop();
    delayed.resolve({ prison: updated });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.onCompleted).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops following a removed task instead of remaining busy forever", async () => {
    const calls = setup();
    const error = new ApiError("not_found", "Task was removed");
    calls.readOperation.mockResolvedValueOnce({ operation: running }).mockRejectedValueOnce(error);
    const watch = calls.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.onOperation).toHaveBeenLastCalledWith(null);
    expect(calls.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(watch.canMutate()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
