import * as three from "three";
import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { GESTURES } from "@/ui/council-arena/gesture-library";
import { chooseMoodGesture, MOOD_CLIPS, outcomeReactions, REACTION_STAGGER, type OutcomeMood } from "@/ui/council-arena/outcome-gestures";
import { ArenaScene } from "@/ui/council-arena/scene";
import { SPEAKING_GREEN, stateAt, type Seat } from "@/ui/council-arena/timeline";

let seq = 0;
const event = (kind: CouncilEvent["kind"], actorId: string, extra: Partial<CouncilEvent> = {}): CouncilEvent =>
  ({ seq: seq++, at: "2026-10-08T12:00:00Z", round: 1, kind, actorId, model: null, targetId: null, dimension: null, score: null, text: kind, ...extra });
const seat = (id: string, state: Partial<{ eliminated: boolean; failed: boolean }> = {}) => ({ id, eliminated: false, failed: false, ...state });
const table = [seat("a"), seat("b"), seat("c"), seat("d", { eliminated: true }), seat("e", { failed: true })];

describe("reactions to what really happened", () => {
  it.each([[0.92, "pleased"], [0.8, "pleased"], [0.65, "weighing"], [0.5, "weighing"], [0.31, "stung"]] as const)(
    "a review scored %s makes only the reviewed bird look %s", (score, mood) => {
      expect(outcomeReactions(event("critique", "a", { targetId: "b", score }), table)).toEqual([{ seat: "b", mood, delay: 0 }]);
    });

  it("has no reaction to a review without a score or a target that dropped out", () => {
    expect(outcomeReactions(event("critique", "a", { targetId: "b" }), table)).toEqual([]);
    expect(outcomeReactions(event("critique", "a", { targetId: "e", score: 0.2 }), table)).toEqual([]);
    expect(outcomeReactions(event("proposal", "a"), table)).toEqual([]);
  });

  it("lets the writer of the shared text take a stamp in", () => {
    expect(outcomeReactions(event("approval", "a", { targetId: "c" }), table)).toEqual([{ seat: "c", mood: "pleased", delay: 0 }]);
    expect(outcomeReactions(event("objection", "a", { targetId: "c" }), table)).toEqual([{ seat: "c", mood: "weighing", delay: 0 }]);
  });

  it("startles the birds still in play at an elimination, one after another", () => {
    const fallen = [seat("a"), seat("b", { eliminated: true }), seat("c"), seat("d", { eliminated: true }), seat("e", { failed: true })];
    expect(outcomeReactions(event("eliminated", "b"), fallen)).toEqual([
      { seat: "a", mood: "takenAback", delay: 0 },
      { seat: "c", mood: "takenAback", delay: REACTION_STAGGER },
    ]);
  });

  it("has everyone else congratulate the winner, the jury bench included", () => {
    const reactions = outcomeReactions(event("winner", "a"), table);
    expect(reactions.map((reaction) => reaction.seat)).toEqual(["b", "c", "d"]);
    expect(reactions.every((reaction) => reaction.mood === "congratulate")).toBe(true);
  });

  it("picks real library clips, the same one on a replay, never the bird's last clip twice", () => {
    const known = new Set<string>(GESTURES.map((gesture) => gesture.id));
    for (const [mood, clips] of Object.entries(MOOD_CLIPS) as Array<[OutcomeMood, readonly string[]]>) {
      expect(clips.every((id) => known.has(id))).toBe(true);
      for (let index = 0; index < 20; index++) {
        const id = chooseMoodGesture(null, `seat_${index}`, index, mood);
        expect(clips).toContain(id);
        expect(chooseMoodGesture(null, `seat_${index}`, index, mood)).toBe(id);
        expect(chooseMoodGesture(id, `seat_${index}`, index, mood)).not.toBe(id);
      }
    }
  });
});

interface Bird {
  gesture: { id: string; start: number } | null;
  actions: Array<{ kind: string; start: number; duration: number }>;
  nextIdle: number;
}

const seats: Seat[] = ["a", "b", "c"].map((id, index) => ({ id, index, model: `acme/${id}`, label: id, role: "r", color: "#f97316" }));

function stage(mode: "competition" | "collaboration", reducedMotion = false) {
  const scene = Object.assign(Object.create(ArenaScene.prototype), {
    three, options: { mode, reducedMotion }, scene: new three.Scene(), avatars: new Map(), weapons: new Map(),
    white: new three.Color("#eaf2ff"), green: new three.Color(SPEAKING_GREEN), grey: new three.Color("#555a63"),
    state: null, addressee: null, podium: null, papers: [], disposables: [], effects: [], azimuth: 0.35, speed: 1, environment: null, parts: null,
    camera: new three.PerspectiveCamera(), realTime: 0, disposed: false,
    focus: new three.Vector3(), distance: 12, elevation: 0.5, dragging: null, lastInteraction: -10,
    manualUntil: 0, shake: 0, shot: { kind: "wide", subject: null, other: null }, shotAt: 0,
    cam: { azimuth: 0.35, elevation: 0.5, distance: 12, ready: false },
    clock: { getElapsed: () => 0 },
  }) as { avatars: Map<string, Bird>; setSeats: (seats: Seat[]) => void; sync: (state: ReturnType<typeof stateAt>, event: CouncilEvent | null, animate: boolean) => void };
  scene.setSeats(seats);
  for (const bird of scene.avatars.values()) bird.nextIdle = Infinity;
  return scene;
}

describe("reactions on the stage", () => {
  it("makes a bird hit by a low score react after the blow, not before it", () => {
    const scene = stage("competition");
    const blow = event("critique", "a", { targetId: "b", score: 0.2, dimension: "intent_alignment" });
    scene.sync(stateAt([blow], 0), blow, true);
    const attack = scene.avatars.get("a")!.actions.find((action) => action.kind !== "idle")!;
    const reaction = scene.avatars.get("b")!.gesture!;
    expect(MOOD_CLIPS.stung).toContain(reaction.id);
    expect(reaction.start).toBeGreaterThanOrEqual(attack.start + attack.duration);
    expect(scene.avatars.get("c")!.gesture).toBeNull();
  });

  it("has the others congratulate a consensus at the team table", () => {
    const scene = stage("collaboration");
    const done = event("winner", "a");
    scene.sync(stateAt([done], 0), done, true);
    for (const id of ["b", "c"]) expect(MOOD_CLIPS.congratulate).toContain(scene.avatars.get(id)!.gesture!.id);
  });

  it("keeps every bird still when the viewer asked for reduced motion", () => {
    const scene = stage("competition", true);
    const blow = event("critique", "a", { targetId: "b", score: 0.2, dimension: "intent_alignment" });
    scene.sync(stateAt([blow], 0), blow, true);
    expect([...scene.avatars.values()].every((bird) => bird.gesture === null)).toBe(true);
  });
});
