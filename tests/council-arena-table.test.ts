import * as three from "three";
import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { ArenaScene, type SoundCue } from "@/ui/council-arena/scene";
import { SPEAKING_GREEN, stateAt, type Seat } from "@/ui/council-arena/timeline";

interface Table {
  avatars: Map<string, { actions: Array<{ kind: string }> }>;
  stamps: Array<{ verdict: string }>;
  effects: Array<{ update: (now: number) => boolean }>;
  sync: (state: ReturnType<typeof stateAt>, event: CouncilEvent | null, animate: boolean) => void;
  updateAvatar: (avatar: unknown, delta: number, now: number) => void;
}

const seats: Seat[] = [
  { id: "a", index: 0, model: "acme/a", label: "a", role: "r", color: "#8b5cf6" },
  { id: "b", index: 1, model: "acme/b", label: "b", role: "r", color: "#3b82f6" },
];
let seq = 0;
const event = (kind: CouncilEvent["kind"], actorId = "a"): CouncilEvent =>
  ({ seq: seq++, at: "2026-10-06T13:00:00Z", round: 2, kind, actorId, model: null, targetId: null, dimension: null, score: null, text: kind });

function table(cues: SoundCue[] = []): Table {
  const scene = Object.assign(Object.create(ArenaScene.prototype), {
    three, options: { mode: "collaboration", reducedMotion: false, onCue: (cue: SoundCue) => cues.push(cue) }, scene: new three.Scene(),
    avatars: new Map(), weapons: new Map(), white: new three.Color("#eaf2ff"), green: new three.Color(SPEAKING_GREEN), grey: new three.Color("#555a63"),
    state: null, addressee: null, podium: null, papers: [], disposables: [], effects: [], azimuth: 0.35, speed: 1, environment: null, parts: null,
    documentMesh: new three.Mesh(new three.PlaneGeometry(0.75, 1), new three.MeshStandardMaterial({ transparent: true })), documentGlow: 0, documentRise: 0,
    clock: { getElapsed: () => 0 },
  }) as Table & { setSeats: (seats: Seat[]) => void };
  scene.setSeats(seats);
  return scene;
}

describe("table votes", () => {
  it("keeps one stamp per real vote since the latest draft, and clears them for a new draft", () => {
    const scene = table();
    const events = [event("draft"), event("approval", "a"), event("objection", "b"), event("approval", "b")];
    scene.sync(stateAt(events, 3), null, false);
    expect(scene.stamps.map((stamp) => stamp.verdict)).toEqual(["approve", "approve", "object"]);
    const redraft = [...events, event("draft", "a")];
    scene.sync(stateAt(redraft, 4), null, false);
    expect(scene.stamps).toEqual([]);
  });

  it("lands the vote being acted out with its own slam, and is heard", () => {
    const cues: SoundCue[] = [];
    const scene = table(cues);
    const events = [event("draft"), event("approval", "a")];
    scene.sync(stateAt(events, 1), events[1], true);
    // The newest stamp waits for the wing to come down.
    expect(scene.stamps).toHaveLength(0);
    const voter = scene.avatars.get("a")!;
    expect(voter.actions.some((action) => action.kind === "stamp")).toBe(true);
    for (let t = 0; t <= 1; t += 0.05) scene.updateAvatar(voter, 0.05, t);
    expect(scene.stamps.map((stamp) => stamp.verdict)).toEqual(["approve"]);
    for (const effect of [...scene.effects]) effect.update(5);
    expect(cues).toContain("stamp");
  });

  it("has the writer stand to present a new draft", () => {
    const scene = table();
    const draft = event("draft", "b");
    scene.sync(stateAt([draft], 0), draft, true);
    expect(scene.avatars.get("b")!.actions.some((action) => action.kind === "present")).toBe(true);
  });
});
