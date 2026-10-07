import * as three from "three";
import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import type { CouncilMode } from "@/models/options";
import { ArenaScene, type ArenaSceneOptions } from "@/ui/council-arena/scene";
import { SEAT_COLORS, SPEAKING_GREEN, stateAt, type SceneState, type Seat } from "@/ui/council-arena/timeline";

interface TestAvatar {
  root: three.Group;
  body: three.Group;
  hips: three.Group;
  head: three.Group;
  rightArm: three.Group;
  leftArm: three.Group;
  jaw: three.Object3D;
  eyeMeshes: three.Mesh[];
  ringMaterial: three.MeshBasicMaterial;
  haloMaterial: three.MeshBasicMaterial;
  legs: three.Group[];
  home: three.Vector3;
  bench: three.Vector3;
  actions: Array<{ kind: string; start: number; duration: number }>;
}

/** Exercise the real scene updates and meshes without constructing a browser or WebGL renderer. */
interface SceneHarness {
  options: ArenaSceneOptions;
  scene: three.Scene;
  effects: Array<{ update: (now: number) => boolean }>;
  avatars: Map<string, TestAvatar>;
  papers: three.Mesh[];
  documentMesh: three.Mesh | null;
  documentGlow: number;
  documentRise: number;
  setSeats: (seats: Seat[]) => void;
  sync: (state: SceneState, event: CouncilEvent | null, animate: boolean) => void;
  updateAvatar: (avatar: TestAvatar, delta: number, now: number) => void;
  updateTable: (delta: number, now: number) => void;
}

const seat: Seat = { id: "a", index: 0, model: "test/a", label: "a", role: "reviewer", color: "#8b5cf6" };
const seatAt = (index: number): Seat => ({ id: "abc"[index], index, model: `test/${"abc"[index]}`, label: "abc"[index], role: "reviewer", color: SEAT_COLORS[index] });

function harness(mode: CouncilMode, reducedMotion: boolean, seats: Seat[] = [seat]): SceneHarness {
  const scene = Object.assign(Object.create(ArenaScene.prototype), {
    three, options: { mode, reducedMotion }, scene: new three.Scene(), avatars: new Map(), weapons: new Map(),
    white: new three.Color("#eaf2ff"), green: new three.Color(SPEAKING_GREEN), grey: new three.Color("#555a63"),
    state: null, addressee: null, podium: null, documentMesh: null, documentGlow: 0, documentRise: 0, papers: [], lamp: null, dust: null,
    disposables: [], effects: [], azimuth: 0.35, speed: 1, clock: { getElapsed: () => 0 },
  }) as SceneHarness;
  scene.setSeats(seats);
  return scene;
}

function event(kind: CouncilEvent["kind"], seq = 0, actorId = "a"): CouncilEvent {
  return { seq, at: "2026-10-04T18:00:00Z", round: 1, kind, actorId, model: `test/${actorId}`, targetId: null, dimension: null, score: null, text: kind };
}

function avatarFrame(avatar: TestAvatar) {
  return {
    position: avatar.root.position.toArray(), rotation: avatar.root.rotation.toArray(),
    bodyPosition: avatar.body.position.toArray(), bodyRotation: avatar.body.rotation.toArray(),
    head: avatar.head.rotation.toArray(), hips: avatar.hips.rotation.toArray(),
    rightArm: avatar.rightArm.rotation.toArray(), leftArm: avatar.leftArm.rotation.toArray(),
    eyes: avatar.eyeMeshes.map((eye) => eye.scale.toArray()), jaw: avatar.jaw.rotation.toArray(), scale: avatar.body.scale.toArray(),
    ring: avatar.ringMaterial.opacity, halo: avatar.haloMaterial.opacity,
  };
}

describe("arena reduced motion", () => {
  it.each(["competition", "collaboration"] as const)("does not celebrate a provisional %s selection as a victory", (mode) => {
    const scene = harness(mode, false);
    const selected = event("finalist");
    const state = stateAt([selected], 0);
    scene.sync(state, selected, true);
    expect(state.winner).toBeNull();
    expect(scene.avatars.get("a")!.actions).toEqual([]);
    expect(scene.effects).toEqual([]);
    expect(scene.documentRise).toBe(0);
  });
  it.each(["thinking", "proposal", "winner"] as const)("keeps the %s pose and indicators still across frames", (kind) => {
    const scene = harness("competition", true);
    scene.sync(stateAt([event(kind)], 0), null, true);
    const avatar = scene.avatars.get("a")!;
    scene.updateAvatar(avatar, 0.016, 0.2);
    const first = avatarFrame(avatar);
    scene.updateAvatar(avatar, 0.016, 1.4);
    expect(avatarFrame(avatar)).toEqual(first);
    if (kind === "thinking") expect(first.ring).toBeGreaterThan(0);
    if (kind === "proposal") expect(first.ring).toBeCloseTo(0.95);
  });

  it("keeps the agreed document still while preserving its final pose and approval glow", () => {
    const scene = harness("collaboration", true);
    scene.documentMesh = new three.Mesh(new three.PlaneGeometry(0.75, 1), new three.MeshStandardMaterial());
    const events = [event("draft"), event("approval", 1), event("winner", 2)];
    scene.sync(stateAt(events, 2), null, true);
    const frame = () => ({
      position: scene.documentMesh!.position.toArray(), rotation: scene.documentMesh!.rotation.toArray(),
      glow: (scene.documentMesh!.material as three.MeshStandardMaterial).emissiveIntensity,
    });
    scene.updateTable(0.016, 0.2);
    const first = frame();
    scene.updateTable(0.016, 1.4);
    expect(frame()).toEqual(first);
    expect(first.position[1]).toBe(1);
    expect(first.glow).toBeGreaterThan(0.15);
  });

  it("retains ordinary movement when reduced motion is off", () => {
    const scene = harness("competition", false);
    scene.sync(stateAt([event("thinking")], 0), null, false);
    const avatar = scene.avatars.get("a")!;
    scene.updateAvatar(avatar, 0.016, 0.2);
    const first = avatarFrame(avatar);
    scene.updateAvatar(avatar, 0.016, 1.4);
    expect(avatarFrame(avatar)).not.toEqual(first);
  });
});

describe("arena elimination walk", () => {
  const seats = [seatAt(0), seatAt(1), seatAt(2)];

  it("gets the eliminated fighter up and walks it round the other fighters to its bench seat", () => {
    const scene = harness("competition", false, seats);
    const eliminated = event("eliminated", 0, "a");
    scene.sync(stateAt([eliminated], 0), eliminated, true);
    const avatar = scene.avatars.get("a")!;
    expect(avatar.actions.map((action) => action.kind)).toEqual(["fall", "toBench"]);
    const walk = avatar.actions[1];
    // The first frame past the fall finishes it; every later frame follows the walk.
    scene.updateAvatar(avatar, 0.016, walk.start);
    const others = seats.slice(1).map((entry) => scene.avatars.get(entry.id)!.home);
    let nearestFighter = Infinity;
    let nearestCentre = Infinity;
    let stepped = false;
    for (let step = 0; step <= 40; step++) {
      scene.updateAvatar(avatar, 0.016, walk.start + (walk.duration * step) / 40);
      const at = avatar.root.position.clone().setY(0);
      nearestFighter = Math.min(nearestFighter, ...others.map((home) => at.distanceTo(home)));
      nearestCentre = Math.min(nearestCentre, at.length());
      if (Math.abs(avatar.legs[0].rotation.x) > 0.1) stepped = true;
    }
    expect(nearestFighter).toBeGreaterThan(1.2);
    expect(nearestCentre).toBeGreaterThan(3);
    expect(stepped).toBe(true);
    expect(avatar.root.position.distanceTo(avatar.bench)).toBeLessThan(0.01);
    expect(avatar.hips.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(avatar.legs[0].rotation.x).toBeCloseTo(0);
  });

  it("leaves the cage only through its door, which swings open for the walk and shuts behind", () => {
    const scene = harness("competition", false, seats) as SceneHarness & {
      buildCage: () => void; updateStage: (delta: number, now: number) => void; door: { open: number; leaves: three.Group[] };
    };
    scene.buildCage();
    const eliminated = event("eliminated", 0, "a");
    scene.sync(stateAt([eliminated], 0), eliminated, true);
    const avatar = scene.avatars.get("a")!;
    const walk = avatar.actions[1] as unknown as { start: number; duration: number; path: three.Curve<three.Vector3> };
    // Where the route crosses the cage wall, it is inside the door opening at the back.
    let crossing: three.Vector3 | null = null;
    for (let step = 1; step <= 400 && !crossing; step++) {
      const before = walk.path.getPoint((step - 1) / 400);
      const after = walk.path.getPoint(step / 400);
      if (Math.hypot(before.x, before.z) < 7.25 && Math.hypot(after.x, after.z) >= 7.25) crossing = after;
    }
    expect(crossing).not.toBeNull();
    const angle = Math.atan2(crossing!.z, crossing!.x);
    expect(Math.abs(angle + Math.PI / 2)).toBeLessThan(0.42);
    // The door opens while the fighter is down and walking, then closes once it sits.
    let time = 0;
    for (; time < walk.start + walk.duration * 0.5; time += 0.05) { scene.updateAvatar(avatar, 0.05, time); scene.updateStage(0.05, time); }
    expect(scene.door.open).toBeGreaterThan(0.8);
    expect(Math.abs(scene.door.leaves[0].rotation.y)).toBeGreaterThan(1);
    for (; time < walk.start + walk.duration + 4; time += 0.05) { scene.updateAvatar(avatar, 0.05, time); scene.updateStage(0.05, time); }
    expect(scene.door.open).toBeLessThan(0.05);
  });

  it("puts the eliminated fighter straight on the bench under reduced motion", () => {
    const scene = harness("competition", true, seats);
    const eliminated = event("eliminated", 0, "a");
    scene.sync(stateAt([eliminated], 0), eliminated, true);
    const avatar = scene.avatars.get("a")!;
    expect(avatar.actions).toEqual([]);
    scene.updateAvatar(avatar, 0.016, 0.2);
    expect(avatar.root.position.distanceTo(avatar.bench)).toBeLessThan(0.01);
  });
});

describe("arena table details", () => {
  const seats = [seatAt(0), seatAt(1), seatAt(2)];
  const tubes = (scene: SceneHarness) => scene.scene.children.filter((child) => (child as three.Mesh).geometry instanceof three.TubeGeometry) as three.Mesh[];

  it("heads each proposal sheet with its proposer's color", () => {
    const scene = harness("collaboration", true, seats);
    const events = [event("proposal", 0, "b"), event("proposal", 1, "a")];
    scene.sync(stateAt(events, 1), null, false);
    const headers = scene.papers.map((paper) => `#${((paper.children[0] as three.Mesh).material as three.MeshStandardMaterial).color.getHexString()}`);
    expect(headers).toEqual([SEAT_COLORS[1], SEAT_COLORS[0]]);
  });

  it("sends a ray from the agreed text to every member when the table agrees", () => {
    const scene = harness("collaboration", false, seats);
    const events = [event("draft", 0, "b"), event("winner", 1, "b")];
    scene.sync(stateAt(events, 1), events[1], true);
    const rays = tubes(scene);
    expect(rays).toHaveLength(seats.length);
    expect(rays.every((ray) => ray.geometry.drawRange.count === 0)).toBe(true);
    for (const effect of scene.effects) effect.update(0.9);
    expect(rays.every((ray) => ray.geometry.drawRange.count === ray.geometry.index!.count)).toBe(true);
    expect(scene.documentGlow).toBeGreaterThan(1);
  });

  it("keeps the agreement without rays under reduced motion", () => {
    const scene = harness("collaboration", true, seats);
    const events = [event("draft", 0, "b"), event("winner", 1, "b")];
    scene.sync(stateAt(events, 1), events[1], true);
    expect(tubes(scene)).toHaveLength(0);
  });
});
