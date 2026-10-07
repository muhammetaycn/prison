import * as three from "three";
import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { GESTURE_COMMANDS, GESTURES, resolveGestureCommand } from "@/ui/council-arena/gesture-library";
import { ArenaScene } from "@/ui/council-arena/scene";
import { SPEAKING_GREEN, stateAt, type Seat } from "@/ui/council-arena/timeline";

interface Bird {
  leftArm: three.Group;
  rightArm: three.Group;
  head: three.Group;
  body: three.Group;
  gesture: { id: string; start: number } | null;
  actions: Array<Record<string, unknown>>;
  nextIdle: number;
}

interface Stage {
  avatars: Map<string, Bird>;
  playGesture: (seatId: string, id: string) => boolean;
  sync: (state: ReturnType<typeof stateAt>, event: CouncilEvent | null, animate: boolean) => void;
  updateAvatar: (avatar: Bird, delta: number, now: number) => void;
}

const seats: Seat[] = [
  { id: "a", index: 0, model: "acme/a", label: "a", role: "r", color: "#f97316" },
  { id: "b", index: 1, model: "acme/b", label: "b", role: "r", color: "#8b5cf6" },
];
let seq = 0;
const event = (kind: CouncilEvent["kind"], actorId = "a"): CouncilEvent =>
  ({ seq: seq++, at: "2026-10-06T16:00:00Z", round: 1, kind, actorId, model: null, targetId: null, dimension: null, score: null, text: kind });

function stage(mode: "competition" | "collaboration" = "competition", reducedMotion = false) {
  let time = 0;
  const scene = Object.assign(Object.create(ArenaScene.prototype), {
    three, options: { mode, reducedMotion }, scene: new three.Scene(), avatars: new Map(), weapons: new Map(),
    white: new three.Color("#eaf2ff"), green: new three.Color(SPEAKING_GREEN), grey: new three.Color("#555a63"),
    state: null, addressee: null, podium: null, papers: [], disposables: [], effects: [], azimuth: 0.35, speed: 1, environment: null, parts: null,
    camera: new three.PerspectiveCamera(), realTime: 0, disposed: false,
    focus: new three.Vector3(), distance: 12, elevation: 0.5, dragging: null, lastInteraction: -10,
    manualUntil: 0, shake: 0, shot: { kind: "wide", subject: null, other: null }, shotAt: 0,
    cam: { azimuth: 0.35, elevation: 0.5, distance: 12, ready: false },
    clock: { getElapsed: () => time },
  }) as Stage & { setSeats: (seats: Seat[]) => void };
  scene.setSeats(seats);
  for (const bird of scene.avatars.values()) bird.nextIdle = Infinity;
  const run = (bird: Bird, from: number, to: number, each?: (t: number) => void) => {
    for (let t = from; t <= to + 1e-9; t += 1 / 60) {
      time = t;
      scene.updateAvatar(bird, 1 / 60, t);
      each?.(t);
    }
  };
  return { scene, run };
}

/** How far a bird's joints are from where they were, summed over the wings, head and body. */
const pose = (bird: Bird) => [bird.leftArm.rotation, bird.rightArm.rotation, bird.head.rotation, bird.body.rotation].flatMap((r) => [r.x, r.y, r.z]);
const apart = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0);

describe("gesture library on the stage", () => {
  it("plays a commanded clip on a seat and then lets go of the body", () => {
    const { scene, run } = stage();
    const a = scene.avatars.get("a")!;
    run(a, 0, 0.2);
    const rest = pose(a);
    const id = resolveGestureCommand(GESTURE_COMMANDS[0].aliases[0])!;
    expect(scene.playGesture("a", id)).toBe(true);
    let furthest = 0;
    const duration = GESTURES.find((gesture) => gesture.id === id)!.duration;
    run(a, 0.2, 0.2 + duration, () => { furthest = Math.max(furthest, apart(pose(a), rest)); });
    expect(furthest).toBeGreaterThan(0.1);
    run(a, 0.2 + duration, 0.4 + duration);
    expect(a.gesture).toBeNull();
    expect(apart(pose(a), rest)).toBeLessThan(0.02);
  });

  it("refuses unknown seats and clips", () => {
    const { scene } = stage();
    expect(scene.playGesture("nobody", GESTURES[0].id)).toBe(false);
    expect(scene.playGesture("a", "drop table votes")).toBe(false);
  });

  it("gives a proposal a presenting clip, the same one on every replay", () => {
    const proposal = event("proposal", "b");
    const first = stage();
    first.scene.sync(stateAt([proposal], 0), proposal, true);
    const second = stage();
    second.scene.sync(stateAt([proposal], 0), proposal, true);
    const chosen = first.scene.avatars.get("b")!.gesture;
    expect(chosen).not.toBeNull();
    expect(GESTURES.find((gesture) => gesture.id === chosen!.id)?.category).toBe("presenting");
    expect(second.scene.avatars.get("b")!.gesture?.id).toBe(chosen!.id);
    // It waits for the hop that the proposal already plays.
    expect(chosen!.start).toBeGreaterThan(0);
  });

  it("does not move under reduced motion", () => {
    const { scene, run } = stage("competition", true);
    const a = scene.avatars.get("a")!;
    run(a, 0, 0.1);
    const rest = pose(a);
    scene.playGesture("a", GESTURES[0].id);
    run(a, 0.1, 0.1 + GESTURES[0].duration * 0.5);
    expect(apart(pose(a), rest)).toBe(0);
  });
});
