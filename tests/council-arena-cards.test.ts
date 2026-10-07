import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { titleCardFor } from "@/ui/council-arena/cards";
import type { Seat } from "@/ui/council-arena/timeline";

const seats: Seat[] = [{ id: "a", index: 0, model: "acme/alpha", label: "alpha", role: "r", color: "#8b5cf6" }];
const seatOf = (id: string | null | undefined) => seats.find((seat) => seat.id === id);
let seq = 0;
const event = (kind: CouncilEvent["kind"], round: number, extra: Partial<CouncilEvent> = {}): CouncilEvent =>
  ({ seq: seq++, at: "2026-10-06T13:00:00Z", round, kind, actorId: "a", model: "acme/alpha", targetId: null, dimension: null, score: null, text: kind, ...extra });

describe("title cards", () => {
  it("announces each new round once, on its first spoken moment", () => {
    const events = [event("proposal", 1), event("thinking", 2), event("critique", 2), event("critique", 2)];
    expect(titleCardFor(events, 0, "competition", seatOf)).toBeNull();
    expect(titleCardFor(events, 1, "competition", seatOf)).toBeNull();
    expect(titleCardFor(events, 2, "competition", seatOf)).toMatchObject({ title: "2. TUR", tone: "round" });
    expect(titleCardFor(events, 3, "competition", seatOf)).toBeNull();
  });

  it("names the bird in eliminations and results, and the weapon in awards", () => {
    expect(titleCardFor([event("eliminated", 2)], 0, "competition", seatOf)).toMatchObject({ label: "Elendi", title: "alpha", tone: "out" });
    expect(titleCardFor([event("winner", 3)], 0, "competition", seatOf)).toMatchObject({ label: "Kazanan", title: "alpha", tone: "win" });
    expect(titleCardFor([event("winner", 3)], 0, "collaboration", seatOf)).toMatchObject({ label: "Uzlaşma", tone: "win" });
    const award = titleCardFor([event("weapon", 1, { dimension: "intent_alignment" })], 0, "competition", seatOf);
    expect(award?.tone).toBe("weapon");
    expect(award?.seat?.id).toBe("a");
    expect(award?.title.length).toBeGreaterThan(0);
  });
});
