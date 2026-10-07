import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CouncilEvent, CouncilReview } from "@/models/council";
import { CouncilArena } from "@/ui/council-arena/CouncilArena";
import { dwellMs, kindLabel, replayEvents, SEAT_COLORS, seatsFrom, SPEAKING_GREEN, stateAt } from "@/ui/council-arena/timeline";
import { MIN_REVIEW_SCORE } from "@/models/review-policy";

let seq = 0;
function event(kind: CouncilEvent["kind"], actorId: string, extra: Partial<CouncilEvent> = {}): CouncilEvent {
  return { seq: seq++, at: "2026-10-04T12:00:00.000Z", round: 1, kind, actorId, model: `vendor/${actorId}`, targetId: null, dimension: null, score: null, text: `${kind} by ${actorId}`, ...extra };
}

const FIGHT: CouncilEvent[] = [
  event("seat", "member_1", { round: 0, text: "Uzman 1" }),
  event("seat", "member_2", { round: 0, text: "Uzman 2" }),
  event("seat", "member_3", { round: 0, text: "Uzman 3" }),
  event("seat", "member_4", { round: 0, text: "Uzman 4" }),
  event("thinking", "member_1"),
  event("thinking", "member_2"),
  event("proposal", "member_1"),
  event("proposal", "member_2"),
  event("critique", "member_1", { targetId: "member_2", score: 0.9 }),
  event("critique", "member_3", { targetId: "member_2", score: 0.7 }),
  event("weapon", "member_2", { dimension: "intent_alignment", score: 0.8 }),
  event("eliminated", "member_4", { score: 0.6 }),
  event("critique", "member_4", { round: 2, targetId: "member_2", score: 0.5 }),
  event("winner", "member_2", { round: 2, score: 0.92 }),
];

describe("council arena timeline", () => {
  it("seats members in order with distinct non-green colors", () => {
    const seats = seatsFrom(FIGHT);
    expect(seats.map((seat) => seat.id)).toEqual(["member_1", "member_2", "member_3", "member_4"]);
    expect(seats.map((seat) => seat.label)).toEqual(["member_1", "member_2", "member_3", "member_4"]);
    expect(new Set(seats.map((seat) => seat.color)).size).toBe(4);
    expect(SEAT_COLORS).not.toContain(SPEAKING_GREEN);
  });

  it("folds thinking, speaking, weapons, eliminations and per-round health at any moment", () => {
    const thinking = stateAt(FIGHT, 5);
    expect(thinking.thinking.sort()).toEqual(["member_1", "member_2"]);
    expect(thinking.speaker).toBeNull();

    const spoke = stateAt(FIGHT, 6);
    expect(spoke.speaker).toBe("member_1");
    expect(spoke.thinking).toEqual(["member_2"]);
    expect(spoke.proposals).toEqual(["member_1"]);

    const armed = stateAt(FIGHT, 11);
    expect(armed.weapons).toEqual({ intent_alignment: "member_2" });
    expect(armed.eliminated).toEqual(["member_4"]);
    expect(armed.health.member_2).toBeCloseTo(0.8);

    const end = stateAt(FIGHT, FIGHT.length - 1);
    expect(end.health.member_2).toBeCloseTo(0.5);
    expect(end.winner).toBe("member_2");
    expect(end.round).toBe(2);
    expect(stateAt(FIGHT, -1)).toMatchObject({ speaker: null, thinking: [], winner: null });
  });

  it("treats a missed jury review as transient and clears a failure once the member acts again", () => {
    const events = [
      event("seat", "a", { round: 0 }),
      event("abstained", "a"),
      event("failed", "b"),
      event("revision", "b", { round: 2 }),
    ];
    expect(stateAt(events, 1).failed).toEqual([]);
    expect(stateAt(events, 2).failed).toEqual(["b"]);
    expect(stateAt(events, 3).failed).toEqual([]);
  });

  it("ends only the completed member's research wait and lets its next call start a new wait", () => {
    const events = [
      event("thinking", "a", { round: 0 }),
      event("thinking", "b", { round: 0 }),
      event("research", "a", { round: 0 }),
      event("thinking", "a", { round: 1 }),
      event("research", "b", { round: 0 }),
    ];
    expect(stateAt(events, 2)).toMatchObject({ thinking: ["b"], speaker: "a" });
    expect(stateAt(events, 3).thinking.sort()).toEqual(["a", "b"]);
    expect(stateAt(events, 4).thinking).toEqual(["a"]);
  });

  it("rebuilds a replay for records saved before timelines existed", () => {
    const scores = { intent_alignment: 0.9, context_completeness: 0.9, constraint_clarity: 0.9, execution_clarity: 0.9, output_clarity: 0.9, target_ai_compatibility: 0.9 };
    const participant = (id: string, status: "reviewed" | "winner" | "failed") => ({
      id, provider: "nvidia", model: `vendor/${id}`, role: `Uzman ${id}`, status, error: status === "failed" ? "Zaman aşımı" : null,
      initialPrompt: status === "failed" ? null : `Draft ${id}`, revisedPrompt: status === "failed" ? null : `Revised ${id}`,
      strategies: [], findings: [], score: status === "failed" ? null : 0.9,
    });
    const review: CouncilReview = {
      mode: "collaboration", executionContext: "chat", startedAt: "2026-10-04T10:00:00.000Z", completedAt: "2026-10-04T10:05:00.000Z", rounds: 2,
      participants: [participant("a", "winner"), participant("b", "reviewed"), participant("c", "failed")],
      reviews: [
        { stage: "peer", reviewerId: "b", candidateId: "a", scores, issues: [], suggestions: ["Netleştir."] },
        { stage: "final", reviewerId: "b", candidateId: "a", scores, issues: [{ severity: "high", message: "Sınır düştü." }], suggestions: [] },
      ],
      winnerId: "a", winnerModel: "vendor/a", decision: "Karar", finalReviewerModel: "vendor/b",
    };
    const events = replayEvents(review);
    expect(seatsFrom(events).map((seat) => seat.id)).toEqual(["a", "b", "c"]);
    expect(events.map((entry) => entry.kind)).toEqual(["seat", "seat", "seat", "proposal", "proposal", "failed", "critique", "draft", "draft", "objection", "winner"]);
    expect(events.map((entry) => entry.seq)).toEqual(events.map((_, index) => index));
    expect(replayEvents({ ...review, events: FIGHT })).toBe(FIGHT);
    expect(replayEvents({ ...review, selectionBasis: "finalist" }).at(-1)?.kind).toBe("finalist");
  });

  it("retains a provisional selection without inventing a winner, agreement or approval", () => {
    const events = [event("thinking", "a"), event("finalist", "a")];
    expect(stateAt(events, 1)).toMatchObject({ winner: null, finalist: "a", thinking: [], approvals: 0 });
    for (const mode of ["competition", "collaboration"] as const) {
      expect(kindLabel("finalist", mode)).toBe("Son denetime seçildi");
    }
  });

  it.each([undefined, "finalist"] as const)("does not turn a weak legacy reviewer score into approval (selection=%s)", (selectionBasis) => {
    const scores = { intent_alignment: 0.9, context_completeness: 0.9, constraint_clarity: 0.9, execution_clarity: 0.9, output_clarity: MIN_REVIEW_SCORE - 0.01, target_ai_compatibility: 0.9 };
    const review: CouncilReview = {
      mode: "collaboration", executionContext: "chat", startedAt: "2026-10-04T10:00:00.000Z", completedAt: "2026-10-04T10:05:00.000Z", rounds: 2, selectionBasis,
      participants: ["a", "b", "c"].map((id) => ({ id, provider: "nvidia", model: `vendor/${id}`, role: "Uzman", status: id === "a" ? "winner" : "reviewed", error: null,
        initialPrompt: `Draft ${id}`, revisedPrompt: null, strategies: [], findings: [], score: 0.9 })),
      reviews: [{ stage: "final", reviewerId: "b", candidateId: "a", scores, issues: [], suggestions: [] }],
      winnerId: "a", winnerModel: "vendor/a", decision: "Saved selection evidence", finalReviewerModel: "vendor/b",
    };
    const events = replayEvents(review);
    expect(events.filter((entry) => entry.kind === "objection")).toHaveLength(1);
    expect(events.some((entry) => entry.kind === "approval")).toBe(false);
    const beforeSelection = stateAt(events, events.length - 2);
    expect(beforeSelection).toMatchObject({ approvals: 0, objections: 1, winner: null });
    if (selectionBasis === "finalist") expect(stateAt(events, events.length - 1)).toMatchObject({ winner: null, finalist: "a", approvals: 0 });

    const accepted = replayEvents({ ...review, reviews: [{ ...review.reviews[0], scores: { ...scores, output_clarity: MIN_REVIEW_SCORE } }] });
    expect(accepted.filter((entry) => entry.kind === "approval")).toHaveLength(1);
    expect(accepted.some((entry) => entry.kind === "objection")).toBe(false);
  });

  it("keeps long spoken text on stage long enough to read", () => {
    expect(dwellMs(event("proposal", "a", { text: "x".repeat(280) }))).toBeGreaterThan(dwellMs(event("proposal", "a", { text: "short" })));
    expect(dwellMs(event("thinking", "a"))).toBeLessThan(1000);
  });
});

describe("council arena markup", () => {
  it.each(["competition", "collaboration"] as const)("labels a %s finalist without a false consensus milestone", (mode) => {
    const events = [event("seat", "a", { round: 0 }), event("finalist", "a", { text: "No consensus; separate review required." })];
    const html = renderToStaticMarkup(createElement(CouncilArena, { mode, events, live: true }));
    expect(html).toContain("Son denetime seçildi");
    expect(html).toContain("Son denetime seçilen aday");
    expect(html).not.toContain("Uzlaşma Kararı");
    expect(html).not.toContain("Masa uzlaştı");
    expect(html).not.toContain("Kazanan:");
  });
  it("renders seats, the current speaker and a readable transcript on the server without touching WebGL", () => {
    const html = renderToStaticMarkup(createElement(CouncilArena, { mode: "competition", events: FIGHT, live: false }));
    expect(html).toContain("Kapışma arenası");
    expect(html).toContain("Konuşma akışı");
    // A saved council plays from its first moment; the outcome is one click away.
    expect(html).not.toContain("Kazanan: member_2");
    expect(html).toContain("Sonuca atla");
    expect(html).toContain("Duraklat");
    expect(html).toContain("member_4");
    expect(html).toContain("jüri");
    expect(html).not.toContain("thinking by");
    expect(html).toContain("gizli iç düşünce izi kaydedilmez");
  });

  it("names the round table and its no-vote outcome", () => {
    const table = FIGHT.filter((entry) => entry.kind !== "weapon" && entry.kind !== "eliminated");
    const html = renderToStaticMarkup(createElement(CouncilArena, { mode: "collaboration", events: table, live: true }));
    expect(html).toContain("Tartışma masası");
    expect(html).toContain("oylamasız ortak çalışma");
    expect(html).toContain("Canlı");
  });
});
