import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CouncilProgressPanel, elapsedOperationTime, watchElapsedOperationTime } from "@/ui/common/CouncilProgressPanel";

afterEach(() => vi.useRealTimers());

describe("real elapsed council time", () => {
  it("ticks from the recorded start and retains elapsed time when the view is remounted", async () => {
    vi.useFakeTimers();
    const startedAt = "2026-10-05T12:00:00Z";
    vi.setSystemTime("2026-10-05T12:03:12Z");
    const first = vi.fn();
    const stop = watchElapsedOperationTime(startedAt, first);
    expect(first).toHaveBeenLastCalledWith({ seconds: 192, label: "3 dk 12 sn" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(first).toHaveBeenLastCalledWith({ seconds: 197, label: "3 dk 17 sn" });
    stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    const reloaded = vi.fn();
    const stopReloaded = watchElapsedOperationTime(startedAt, reloaded);
    expect(reloaded).toHaveBeenLastCalledWith({ seconds: 257, label: "4 dk 17 sn" });
    stopReloaded();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not infer an estimated end and safely handles longer duration or clock skew", () => {
    const startedAt = "2026-10-05T12:00:00Z";
    expect(elapsedOperationTime(startedAt, Date.parse("2026-10-05T13:03:02Z"))).toEqual({ seconds: 3782, label: "1 sa 3 dk 2 sn" });
    expect(elapsedOperationTime(startedAt, Date.parse("2026-10-05T11:59:59Z"))).toEqual({ seconds: 0, label: "0 sn" });
    expect(elapsedOperationTime("invalid", Date.now())).toBeNull();
  });

  it("keeps the per-second clock outside the polite stage live region", () => {
    const html = renderToStaticMarkup(createElement(CouncilProgressPanel, { progress: {
      stage: "peer_review", completed: 2, total: 6, message: "Gerçek model incelemesi", startedAt: "2026-10-05T12:00:00Z",
    } }));
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toMatch(/2\/6 tamamlandı<\/span><\/div><span[^>]*aria-live="off">Geçen süre/);
    expect(html).not.toContain("0 sn");
  });
});
