import * as three from "three";
import { describe, expect, it } from "vitest";
import type { CouncilDimension } from "@/models/council";
import { ArenaScene } from "@/ui/council-arena/scene";
import { DustPuffs, SpeedLines } from "@/ui/council-arena/motion-fx";
import { SPEAKING_GREEN, type Seat } from "@/ui/council-arena/timeline";

interface Bird {
  root: three.Group;
  hand: three.Group;
  tail: three.Object3D;
  actions: Array<Record<string, unknown>>;
}

interface Stage {
  avatars: Map<string, Bird>;
  weapons: Map<CouncilDimension, unknown>;
  trails: Map<string, { length: number; mesh: three.Mesh }>;
  puffs: DustPuffs | null;
  speedLines: SpeedLines | null;
  camera: three.PerspectiveCamera;
  realTime: number;
  scene: three.Scene;
  updateAvatar: (avatar: Bird, delta: number, now: number) => void;
  attach: (weapon: unknown, holder: Bird) => void;
  buildWeapon: (dimension: CouncilDimension) => three.Group;
  impact: (attacker: Bird, target: Bird, score: number, now: number, color: string, heft?: number) => void;
}

const seats: Seat[] = [
  { id: "a", index: 0, model: "acme/a", label: "a", role: "r", color: "#f97316" },
  { id: "b", index: 1, model: "acme/b", label: "b", role: "r", color: "#8b5cf6" },
];

function stage(reducedMotion = false) {
  let time = 0;
  const scene = Object.assign(Object.create(ArenaScene.prototype), {
    three, options: { mode: "competition", reducedMotion }, scene: new three.Scene(), avatars: new Map(), weapons: new Map(),
    white: new three.Color("#eaf2ff"), green: new three.Color(SPEAKING_GREEN), grey: new three.Color("#555a63"),
    state: null, addressee: null, podium: null, papers: [], disposables: [], effects: [], azimuth: 0.35, speed: 1, environment: null, parts: null,
    camera: new three.PerspectiveCamera(42, 16 / 9, 0.1, 100), realTime: 0,
    clock: { getElapsed: () => time },
  }) as Stage & { setSeats: (seats: Seat[]) => void };
  scene.setSeats(seats);
  /** Runs one bird's animation from `from` to `to` seconds in 60 fps steps. */
  const run = (bird: Bird, from: number, to: number, each?: (t: number) => void) => {
    for (let t = from; t <= to; t += 1 / 60) {
      time = t;
      scene.updateAvatar(bird, 1 / 60, t);
      each?.(t);
    }
  };
  return { scene, run };
}

function armWithSword(scene: Stage, holder: Bird) {
  const weapon = { dimension: "intent_alignment" as CouncilDimension, mesh: scene.buildWeapon("intent_alignment"), holder: null, spot: new three.Vector3(1.9, 0, 0), drop: null, landed: true };
  scene.weapons.set(weapon.dimension, weapon);
  scene.attach(weapon, holder);
}

describe("motion feel", () => {
  it("a sword cut grips the blade along the wing and leaves a trail that fades afterwards", () => {
    const { scene, run } = stage();
    const a = scene.avatars.get("a")!;
    const b = scene.avatars.get("b")!;
    armWithSword(scene, a);
    a.actions = [{ kind: "attack", start: 0, duration: 1.1, target: b, style: "sword", score: 0.3 }];
    let longest = 0;
    let gripped = false;
    run(a, 0, 0.6, () => {
      longest = Math.max(longest, scene.trails.get("a")?.length ?? 0);
      gripped ||= Math.abs(a.hand.rotation.x - (Math.PI - 0.55)) < 1e-6;
    });
    expect(gripped).toBe(true);
    expect(longest).toBeGreaterThan(4);
    expect(scene.trails.get("a")!.mesh.parent).toBe(scene.scene);
    run(a, 0.6, 1.6);
    expect(scene.trails.get("a")!.length).toBe(0);
    // Back at rest the weapon sits the way its stance says.
    expect(a.hand.rotation.x).toBe(0);
  });

  it("gathers itself before a blow: a crouch on the spot and a glint off the blade, heard as a ting", () => {
    const { scene, run } = stage();
    const cues: string[] = [];
    (scene as unknown as { options: { onCue: (cue: string) => void } }).options.onCue = (cue) => cues.push(cue);
    const a = scene.avatars.get("a")!;
    const b = scene.avatars.get("b")!;
    armWithSword(scene, a);
    const home = a.root.position.clone();
    const effects = (scene as unknown as { effects: unknown[] }).effects;
    a.actions = [{ kind: "attack", start: 0, duration: 1.1, target: b, style: "sword", score: 0.3 }];
    let lowest = 1;
    run(a, 0, 0.07, () => { lowest = Math.min(lowest, (a as Bird & { body: three.Group }).body.scale.y); });
    // Still on its spot, squashed down, and the glint is up.
    expect(a.root.position.distanceTo(home)).toBeLessThan(1e-6);
    expect(lowest).toBeLessThan(0.95);
    expect(effects.length).toBeGreaterThan(0);
    expect(cues).toContain("ting");
    // Then it launches.
    run(a, 0.07, 0.3);
    expect(a.root.position.distanceTo(home)).toBeGreaterThan(0.5);
  });

  it("running feet and a fall kick up dust", () => {
    const { scene, run } = stage();
    scene.puffs = new DustPuffs(three, new three.MeshBasicMaterial(), 64);
    const a = scene.avatars.get("a")!;
    const b = scene.avatars.get("b")!;
    a.actions = [{ kind: "attack", start: 0, duration: 1.1, target: b, style: "peck", score: 0.9 }];
    run(a, 0, 0.35);
    const steps = scene.puffs.active;
    expect(steps).toBeGreaterThan(0);
    a.actions = [{ kind: "fall", start: 1, duration: 1.4 }];
    run(a, 1, 1.5);
    expect(scene.puffs.active).toBeGreaterThanOrEqual(10);
  });

  it("the tail lags behind a hop and settles again", () => {
    const { scene, run } = stage();
    const a = scene.avatars.get("a")!;
    // No further fidgets after this one, so the tail can come to rest.
    (a as Bird & { nextIdle: number }).nextIdle = Infinity;
    a.actions = [{ kind: "idle", idle: "hop", start: 0, duration: 0.7 }];
    let swing = 0;
    run(a, 0, 0.8, () => { swing = Math.max(swing, Math.abs(a.tail.rotation.x)); });
    expect(swing).toBeGreaterThan(0.03);
    run(a, 0.8, 4);
    expect(Math.abs(a.tail.rotation.x)).toBeLessThan(0.01);
  });

  it("keeps the tail still with reduced motion", () => {
    const { scene, run } = stage(true);
    const a = scene.avatars.get("a")!;
    a.actions = [{ kind: "idle", idle: "hop", start: 0, duration: 0.7 }];
    run(a, 0, 0.8);
    expect(a.tail.rotation.x).toBe(0);
  });

  it("bursts speed lines on a heavy blow only", () => {
    const { scene } = stage();
    scene.speedLines = new SpeedLines(three);
    const a = scene.avatars.get("a")!;
    const b = scene.avatars.get("b")!;
    scene.impact(a, b, 0.6, 0, "#ffb347");
    scene.speedLines.update(scene.realTime + 0.05, scene.camera);
    expect(scene.speedLines.showing).toBe(false);
    scene.impact(a, b, 0.2, 0, "#ffb347");
    scene.speedLines.update(scene.realTime + 0.05, scene.camera);
    expect(scene.speedLines.showing).toBe(true);
  });
});
