import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/ui/lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("execution settings request routing", () => {
  it("routes both chosen settings to first compile while preserving no-body regeneration", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ prison: { id: "test" } }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.compile("test", { executionContext: "mobile", councilMode: "collaboration" });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/prisons/test/compile");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ executionContext: "mobile", councilMode: "collaboration" });
    await api.compile("test");
    expect(fetchMock.mock.calls[1]![1].body).toBeUndefined();
  });

  it("keeps a context adjustment separate from AI target and JB mode changes", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ prison: { id: "test" } }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.executionContext("test", "browser");
    await api.councilMode("test", "competition");
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/prisons/test/adjust", "/api/prisons/test/adjust"]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ executionContext: "browser" });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ councilMode: "competition" });
  });

  it("keeps progress reads cancellable and separate from generation requests", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ progress: null }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await api.progress("test", controller.signal);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/prisons/test/progress");
    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal);
    expect(fetchMock.mock.calls[0]![1].method).toBeUndefined();
    expect(fetchMock.mock.calls[0]![1].body).toBeUndefined();
  });
});
