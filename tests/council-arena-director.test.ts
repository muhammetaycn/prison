import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { shotFor, WIDE } from "@/ui/council-arena/director";

const event = (kind: CouncilEvent["kind"], extra: Partial<CouncilEvent> = {}): CouncilEvent =>
  ({ seq: 0, at: "2026-10-05T23:00:00Z", round: 1, kind, actorId: "a", model: null, targetId: null, dimension: null, score: null, text: kind, ...extra });

describe("camera director", () => {
  it("frames each moment with the shot that tells it", () => {
    expect(shotFor(null, "competition", null)).toEqual(WIDE);
    expect(shotFor(event("weapon"), "competition", null).kind).toBe("wide");
    expect(shotFor(event("proposal"), "collaboration", null)).toEqual({ kind: "speaker", subject: "a", other: null });
    expect(shotFor(event("critique", { targetId: "b" }), "competition", null)).toEqual({ kind: "duel", subject: "a", other: "b" });
    expect(shotFor(event("critique", { targetId: "b" }), "collaboration", null)).toEqual({ kind: "speaker", subject: "a", other: "b" });
    expect(shotFor(event("eliminated"), "competition", null).kind).toBe("drama");
    expect(shotFor(event("winner"), "competition", null).kind).toBe("hero");
    expect(shotFor(event("winner"), "collaboration", null).kind).toBe("overview");
  });

  it("holds the current shot through thinking blips and goes wide for the system's own notes", () => {
    const duel = shotFor(event("critique", { targetId: "b" }), "competition", null);
    expect(shotFor(event("thinking", { actorId: "c" }), "competition", duel)).toBe(duel);
    expect(shotFor(event("memory", { actorId: "system" }), "competition", duel)).toEqual(WIDE);
  });
});
