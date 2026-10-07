import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrisonOperation } from "@/models/operation";
import { api, ApiError, OPERATION_POLL_TIMEOUT_MS } from "@/ui/lib/api";

const running: PrisonOperation = {
  id: `op_${"a".repeat(32)}`, prisonId: "pr_wait0001", status: "running", kind: "compile",
  startedAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z",
  progress: null, error: null, resultVersion: null,
};
const completed: PrisonOperation = { ...running, status: "completed", resultVersion: 2 };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("UI durable operation API", () => {
  it("retries the saved action once and observes the new job through a temporary read failure", async () => {
    const newJob = { ...running, id: `op_${"b".repeat(32)}`, kind: "adjust" as const };
    let reads = 0;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return response({ accepted: true, operation: newJob }, 202);
      if (path === `/api/operations/${newJob.id}`) {
        if (++reads === 1) throw new TypeError("Disconnected");
        return response({ operation: { ...newJob, status: "completed", resultVersion: 2 } });
      }
      return response({ prison: { id: running.prisonId, activeVersion: 2 } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = api.retryOperation(running.id);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toEqual({ prison: { id: running.prisonId, activeVersion: 2 } });
    const submissions = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(submissions).toHaveLength(1);
    expect(submissions[0]![0]).toBe(`/api/operations/${running.id}/retry`);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method !== "POST").map(([path]) => path))
      .toEqual([`/api/operations/${newJob.id}`, `/api/operations/${newJob.id}`, `/api/prisons/${running.prisonId}`]);
  });

  it("keeps one accepted generation alive beyond the former five-minute HTTP window", async () => {
    let reads = 0;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return response({ accepted: true, operation: running }, 202);
      if (path.startsWith("/api/operations/")) return response({ operation: ++reads >= 181 ? completed : running });
      return response({ prison: { id: running.prisonId, activeVersion: 2 } });
    });
    vi.stubGlobal("fetch", fetchMock);
    let settled = false;
    const pending = api.compile(running.prisonId).then((result) => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(360_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ prison: { id: running.prisonId, activeVersion: 2 } });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/prisons/${running.prisonId}`);
  });

  it("retries transient polling failures without submitting generation again", async () => {
    let reads = 0;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return response({ accepted: true, operation: running }, 202);
      if (path.startsWith("/api/operations/")) {
        reads++;
        if (reads === 1) throw new TypeError("Disconnected");
        if (reads === 2) return response({ error: { code: "busy", message: "Temporary read failure" } }, 503);
        return response({ operation: completed });
      }
      return response({ prison: { id: running.prisonId } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = api.modify(running.prisonId, "shorter");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toEqual({ prison: { id: running.prisonId } });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(reads).toBe(3);
  });

  it("aborts a stuck polling read after fifteen seconds and resumes observing the same job", async () => {
    let reads = 0;
    let hungSignal: AbortSignal | null = null;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return response({ accepted: true, operation: running }, 202);
      if (path.startsWith("/api/operations/")) {
        if (++reads === 1) return await new Promise<Response>((_resolve, reject) => {
          hungSignal = init!.signal!;
          hungSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
        return response({ operation: completed });
      }
      return response({ prison: { id: running.prisonId } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = api.compile(running.prisonId);
    await vi.advanceTimersByTimeAsync(2000 + OPERATION_POLL_TIMEOUT_MS - 1);
    expect((hungSignal as AbortSignal | null)?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5001);
    expect((hungSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(await pending).toEqual({ prison: { id: running.prisonId } });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("bounds a polling response body as well as its initial headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
      const stream = new ReadableStream({ start(controller) {
        init!.signal!.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      } });
      return new Response(stream, { headers: { "Content-Type": "application/json" } });
    }));
    const pending = api.latestOperation(running.prisonId).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(OPERATION_POLL_TIMEOUT_MS);
    expect(await pending).toMatchObject({ code: "request_timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["failed", "interrupted"] as const)("surfaces a persisted %s error with its saved timeline", async (status) => {
    const failed: PrisonOperation = { ...running, status, error: { code: "provider_failure", message: "Actual terminal failure" } };
    vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => response(init?.method === "POST" ? { accepted: true, operation: running } : { operation: failed }, init?.method === "POST" ? 202 : 200)));
    const pending = api.compile(running.prisonId).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000);
    const error = await pending;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "provider_failure", message: "Actual terminal failure", details: { operation: failed } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries result fetching after a completed operation without requesting another model run", async () => {
    let resultReads = 0;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return response({ accepted: true, operation: completed }, 202);
      if (path.startsWith("/api/prisons/")) {
        if (++resultReads === 1) throw new TypeError("Disconnected");
        return response({ prison: { id: running.prisonId } });
      }
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = api.compile(running.prisonId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ prison: { id: running.prisonId } });
    expect(resultReads).toBe(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("recovers the selected task after temporary offline startup so its operation can be discovered", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Offline"))
      .mockResolvedValueOnce(response({ prison: { id: running.prisonId } }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = api.getWithRetry(running.prisonId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ prison: { id: running.prisonId } });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([`/api/prisons/${running.prisonId}`, `/api/prisons/${running.prisonId}`]);
  });

  it("cancels pending startup retry on cleanup without leaving a timer or another request", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Offline"));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = api.getWithRetry(running.prisonId, controller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ code: "cancelled" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
