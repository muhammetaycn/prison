import * as three from "three";
import { describe, expect, it, vi } from "vitest";
import { ArenaScene } from "@/ui/council-arena/scene";
import { sampleGesture } from "@/ui/council-arena/gesture-library";
import { WIDE, type Shot } from "@/ui/council-arena/director";

interface Bird {
  seat: { id: string; index: number };
  root: three.Group;
  body: three.Group;
  head: three.Group;
  hips: three.Group;
  leftArm: three.Group;
  rightArm: three.Group;
  hand: three.Group;
  legs: three.Group[];
  tail: three.Group;
  umbrellaOpen: number;
  gesture: { id: string; start: number } | null;
  lastGesture: string | null;
  actions: Array<{ kind: string; start?: number; duration?: number }>;
  nextIdle: number;
}

interface ManualStage {
  avatars: Map<string, Bird>;
  camera: three.PerspectiveCamera;
  cam: { azimuth: number; elevation: number; distance: number; ready: boolean };
  focus: three.Vector3;
  shot: Shot;
  shotAt: number;
  manualUntil: number;
  dragging: { x: number; y: number } | null;
  disposed: boolean;
  shake: number;
  state: { speaker: string; health: Record<string, number>; winner: string | null };
  playGesture(seat: string, id: string): boolean;
  startGesture(bird: Bird, id: string, start: number): void;
  updateCamera(delta: number, now: number): void;
  applyGesture(bird: Bird, now: number): void;
}

function stage(mode: "competition" | "collaboration" = "competition", reducedMotion = false): ManualStage {
  const bird = (id: string, index: number, x: number, z: number): Bird => {
    const root = new three.Group();
    root.position.set(x, 0, z);
    const body = new three.Group();
    const head = new three.Group();
    head.position.y = 1.82;
    const hips = new three.Group();
    hips.position.y = 0.5;
    const legs = [new three.Group(), new three.Group()];
    hips.add(...legs);
    const leftArm = new three.Group();
    const rightArm = new three.Group();
    leftArm.position.set(-0.43, 1.2, 0);
    rightArm.position.set(0.43, 1.2, 0);
    const hand = new three.Group();
    rightArm.add(hand);
    const tail = new three.Group();
    tail.position.set(0, 0.72, -0.38);
    body.add(head, hips, leftArm, rightArm, tail);
    root.add(body);
    return { seat: { id, index }, root, body, head, hips, leftArm, rightArm, hand, legs, tail, umbrellaOpen: 0,
      gesture: null, lastGesture: null, actions: [], nextIdle: 100 };
  };
  const camera = new three.PerspectiveCamera(42, 375 / 300, 0.1, 200);
  camera.position.set(-11, 7, 12);
  camera.lookAt(0, 0.6, -1.2);
  return Object.assign(Object.create(ArenaScene.prototype), {
    three, options: { mode, reducedMotion }, camera,
    avatars: new Map([["a", bird("a", 0, -4.7, 1.5)], ["b", bird("b", 1, 4.7, -1.5)]]),
    state: { speaker: "a", health: { a: 0.8, b: 0.95 }, winner: null },
    shot: { ...WIDE }, shotAt: 10, realTime: 123, sceneTime: 7.5,
    cam: { azimuth: -1.3, elevation: 0.55, distance: 17, ready: true },
    focus: new three.Vector3(0, 0.6, -1.2), distance: 17, elevation: 0.5, azimuth: -1.3,
    manualUntil: 200, dragging: null, lastInteraction: 0, shake: 0, disposed: false, speed: 1,
    clock: { getElapsed: () => 7.5 },
  });
}

const projected = (scene: ManualStage, id: string) => {
  scene.camera.updateMatrixWorld(true);
  return scene.avatars.get(id)!.root.position.clone().add(new three.Vector3(0, 1.55, 0)).project(scene.camera);
};

const cameraSnapshot = (scene: ManualStage) => ({
  position: scene.camera.position.toArray(), quaternion: scene.camera.quaternion.toArray(),
  focus: scene.focus.toArray(), cam: { ...scene.cam }, shot: { ...scene.shot },
  shotAt: scene.shotAt, manualUntil: scene.manualUntil, dragging: scene.dragging,
});

describe("manual gesture camera framing", () => {
  it.each(["competition", "collaboration"] as const)("frames the requested seat immediately in %s before the clip begins", (mode) => {
    const scene = stage(mode);
    const selected = scene.avatars.get("b")!;
    const cameraBefore = scene.camera.position.toArray();
    const councilBefore = structuredClone(scene.state);
    const cameraUpdate = vi.spyOn(scene, "updateCamera");
    const realStart = scene.startGesture.bind(scene);
    const start = vi.spyOn(scene, "startGesture").mockImplementation((bird, id, at) => {
      // No frame or easing delay is needed before the first visible pose.
      const center = projected(scene, "b");
      expect(Math.abs(center.x)).toBeLessThan(0.00001);
      expect(Math.abs(center.y)).toBeLessThan(0.00001);
      expect(center.z).toBeGreaterThan(-1);
      expect(center.z).toBeLessThan(1);
      realStart(bird, id, at);
    });
    expect(scene.playGesture("b", "wave-small")).toBe(true);
    expect(scene.shot).toEqual({ kind: "speaker", subject: "b", other: null });
    expect(scene.shotAt).toBe(123);
    expect(scene.manualUntil).toBe(0);
    expect(scene.cam.ready).toBe(true);
    expect(scene.camera.position.toArray()).not.toEqual(cameraBefore);
    expect(cameraUpdate).toHaveBeenCalledWith(0, 7.5);
    expect(cameraUpdate.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
    expect(scene.focus.toArray()).toEqual([4.7, 1.55, -1.5]);
    expect(selected.gesture).toEqual({ id: "wave-small", start: 7.5 });
    expect(scene.avatars.get("a")!.gesture).toBeNull();
    expect(scene.state).toEqual(councilBefore);
    // The real articulated wave is non-neutral once time advances, while its
    // visible head target stays inside the immediately selected camera frame.
    const restingWing = selected.rightArm.rotation.x;
    scene.applyGesture(selected, 8);
    expect(selected.rightArm.rotation.x).not.toBe(restingWing);
    selected.root.updateMatrixWorld(true);
    scene.camera.updateMatrixWorld(true);
    const animatedHead = selected.head.getWorldPosition(new three.Vector3()).project(scene.camera);
    expect(animatedHead.toArray().every(Number.isFinite)).toBe(true);
    expect(Math.abs(animatedHead.x)).toBeLessThan(1);
    expect(Math.abs(animatedHead.y)).toBeLessThan(1);
    expect(animatedHead.z).toBeGreaterThan(-1);
    expect(animatedHead.z).toBeLessThan(1);
    expect(projected(scene, "b").toArray().every(Number.isFinite)).toBe(true);
  });

  it("honors a new explicit focus request even after a recent manual orbit or active drag", () => {
    const scene = stage();
    scene.dragging = { x: 60, y: 20 };
    scene.shake = 0.8;
    expect(scene.playGesture("b", "stretch-up")).toBe(true);
    expect(scene.dragging).toBeNull();
    expect(scene.manualUntil).toBe(0);
    expect(scene.shake).toBe(0);
    expect(scene.shot.subject).toBe("b");
    expect(Math.abs(projected(scene, "b").x)).toBeLessThan(0.00001);
    expect(Math.abs(projected(scene, "b").y)).toBeLessThan(0.00001);
  });

  it("uses deterministic camera coordinates for the same requested actor and scene", () => {
    const first = stage();
    const second = stage();
    first.playGesture("b", "wave-small");
    second.playGesture("b", "wave-high");
    expect(first.camera.position.toArray()).toEqual(second.camera.position.toArray());
    expect(first.camera.quaternion.toArray()).toEqual(second.camera.quaternion.toArray());
    first.playGesture("a", "wave-small");
    expect(first.shot.subject).toBe("a");
    expect(first.camera.position.toArray()).not.toEqual(second.camera.position.toArray());
    expect(Math.abs(projected(first, "a").x)).toBeLessThan(0.00001);
  });

  it.each([["unknown", "wave-small"], ["b", "invented-motion"]])("rejects invalid request %s/%s without changing camera or actors", (seatId, clipId) => {
    const scene = stage();
    const cameraBefore = cameraSnapshot(scene);
    const selected = scene.avatars.get("b")!;
    const nextIdle = selected.nextIdle;
    expect(scene.playGesture(seatId, clipId)).toBe(false);
    expect(cameraSnapshot(scene)).toEqual(cameraBefore);
    expect(selected.gesture).toBeNull();
    expect(selected.lastGesture).toBeNull();
    expect(selected.nextIdle).toBe(nextIdle);
  });

  it("rejects commands after disposal without reviving the camera or a clip", () => {
    const scene = stage();
    const before = cameraSnapshot(scene);
    scene.disposed = true;
    expect(scene.playGesture("b", "wave-small")).toBe(false);
    expect(cameraSnapshot(scene)).toEqual(before);
    expect(scene.avatars.get("b")!.gesture).toBeNull();
  });

  it("preserves reduced-motion camera state and the existing accepted neutral-clip behavior", () => {
    const scene = stage("competition", true);
    const cameraBefore = cameraSnapshot(scene);
    const updateCamera = vi.spyOn(scene, "updateCamera");
    expect(scene.playGesture("b", "wave-small")).toBe(true);
    expect(cameraSnapshot(scene)).toEqual(cameraBefore);
    expect(updateCamera).not.toHaveBeenCalled();
    expect(scene.avatars.get("b")!.gesture).toEqual({ id: "wave-small", start: 7.5 });
    const pose = sampleGesture("wave-small", 0.5, { reducedMotion: true });
    expect(Object.values(pose).every((value) => value === 0)).toBe(true);
  });
});
