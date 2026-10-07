import * as three from "three";
import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { Crowd } from "@/ui/council-arena/crowd";
import { ArenaScene } from "@/ui/council-arena/scene";
import { SPEAKING_GREEN, stateAt, type SceneState, type Seat } from "@/ui/council-arena/timeline";
import { addOutlines, INK, outlineMaterial, toonGradient } from "@/ui/council-arena/toon";

describe("cartoon finish", () => {
  it("inks lit meshes once and leaves unlit details alone", () => {
    const root = new three.Group();
    const body = new three.Mesh(new three.SphereGeometry(1), new three.MeshToonMaterial());
    const pupil = new three.Mesh(new three.SphereGeometry(0.1), new three.MeshBasicMaterial());
    const glow = new three.Mesh(new three.SphereGeometry(0.2), new three.MeshStandardMaterial({ transparent: true, opacity: 0.3 }));
    root.add(body, pupil, glow);
    const ink = outlineMaterial(three, 0.02);
    addOutlines(three, root, ink);
    addOutlines(three, root, ink);
    expect(body.children).toHaveLength(1);
    expect((body.children[0] as three.Mesh).geometry).toBe(body.geometry);
    expect(pupil.children).toHaveLength(0);
    expect(glow.children).toHaveLength(0);
    expect(ink.side).toBe(three.BackSide);
    expect(`#${ink.color.getHexString()}`).toBe(INK);
  });

  it("pushes the outline shell out along the normals in the vertex shader", () => {
    const ink = outlineMaterial(three, 0.016);
    const shader = { vertexShader: "void main() {\n#include <begin_vertex>\n}", fragmentShader: "", uniforms: {} };
    ink.onBeforeCompile(shader as unknown as three.WebGLProgramParametersWithUniforms, {} as three.WebGLRenderer);
    expect(shader.vertexShader).toContain("transformed += normalize( normal ) * 0.0160;");
  });

  it("shades in three flat bands", () => {
    const ramp = toonGradient(three);
    expect(ramp.image.width).toBe(3);
    expect(ramp.magFilter).toBe(three.NearestFilter);
  });

  it("gives every spectator a beak and two eyes", () => {
    const crowd = new Crowd(three, new three.Scene(), true, () => 0.3, { ramp: toonGradient(three), ink: outlineMaterial(three, 0.016) });
    const internals = crowd as unknown as { bodies: three.InstancedMesh; beaks: three.InstancedMesh; eyes: three.InstancedMesh };
    expect(crowd.size).toBeGreaterThan(50);
    expect(internals.beaks.count).toBe(crowd.size);
    expect(internals.eyes.count).toBe(crowd.size * 2);
    // The outline shell reuses the bodies' own instance placements.
    const shell = internals.bodies.children[0] as three.InstancedMesh;
    expect(shell.instanceMatrix).toBe(internals.bodies.instanceMatrix);
  });
});

describe("final flags", () => {
  it("brings out flags in the winner's colour only once a winner stands", () => {
    const crowd = new Crowd(three, new three.Scene(), true, () => 0.3);
    const cloths = (crowd as unknown as { cloths: three.InstancedMesh }).cloths;
    const scale = () => { const matrix = new three.Matrix4(); cloths.getMatrixAt(0, matrix); return new three.Vector3().setFromMatrixScale(matrix).x; };
    crowd.update(1, 0.016, null, false, null);
    expect(crowd.flags).toBe(0);
    expect(scale()).toBeLessThan(0.01);
    crowd.update(2, 0.016, null, true, new three.Color("#ec4899"));
    expect(crowd.flags).toBe(1);
    expect(scale()).toBeCloseTo(1);
    const colour = new three.Color();
    cloths.getColorAt(0, colour);
    expect(colour.getHexString()).toBe(new three.Color("#ec4899").getHexString());
  });
});

interface Face {
  face: { tilt: number; lift: number; pupil: number; gaze: number; squint: number; lid: number };
  eyeMeshes: three.Object3D[];
  lids: three.Object3D[];
  brows: three.Object3D[];
  jaw: three.Object3D;
  body: three.Group;
}

describe("Pırpır expressions", () => {
  const seats: Seat[] = [
    { id: "a", index: 0, model: "acme/a", label: "a", role: "r", color: "#8b5cf6" },
    { id: "b", index: 1, model: "acme/b", label: "b", role: "r", color: "#3b82f6" },
  ];
  const event = (kind: CouncilEvent["kind"], seq: number, actorId: string): CouncilEvent =>
    ({ seq, at: "2026-10-05T19:00:00Z", round: 1, kind, actorId, model: null, targetId: null, dimension: null, score: null, text: kind });
  const harness = () => {
    const scene = Object.assign(Object.create(ArenaScene.prototype), {
      three, options: { mode: "competition", reducedMotion: true }, scene: new three.Scene(), avatars: new Map(), weapons: new Map(),
      white: new three.Color("#eaf2ff"), green: new three.Color(SPEAKING_GREEN), grey: new three.Color("#555a63"),
      state: null, addressee: null, podium: null, papers: [], disposables: [], effects: [], azimuth: 0.35, speed: 1, environment: null, parts: null,
    }) as { setSeats: (seats: Seat[]) => void; sync: (state: SceneState, event: CouncilEvent | null, animate: boolean) => void; avatars: Map<string, Face>; updateAvatar: (avatar: Face, delta: number, now: number) => void };
    scene.setSeats(seats);
    return scene;
  };

  it("beams with squinted eyes when winning and frowns with sad brows when eliminated", () => {
    const scene = harness();
    const events = [event("eliminated", 0, "b"), event("winner", 1, "a")];
    scene.sync(stateAt(events, 1), null, false);
    const winner = scene.avatars.get("a")!;
    const loser = scene.avatars.get("b")!;
    scene.updateAvatar(winner, 0.016, 1);
    scene.updateAvatar(loser, 0.016, 1);
    expect(winner.face.squint).toBeLessThan(0.75);
    expect(winner.eyeMeshes[0].scale.y).toBeLessThan(0.75);
    // The lids come part way down over happy eyes, further than at rest.
    expect(winner.lids[0].rotation.x).toBeGreaterThan(loser.lids[0].rotation.x - 1);
    expect(winner.face.lid).toBeGreaterThan(0.3);
    expect(loser.face.tilt).toBeGreaterThan(0.3);
    // Sad brows lift their inner ends: the left brow turns one way, the right the other.
    expect(Math.sign(loser.brows[0].rotation.z)).toBe(-Math.sign(loser.brows[1].rotation.z));
  });

  it("talks with its wings while it has the floor", () => {
    const scene = harness();
    (scene as unknown as { options: { reducedMotion: boolean } }).options.reducedMotion = false;
    const events = [event("proposal", 0, "a")];
    scene.sync(stateAt(events, 0), null, false);
    const speaker = scene.avatars.get("a")! as Face & { leftArm: three.Group; speaking: number };
    speaker.speaking = 1;
    scene.updateAvatar(speaker, 0.016, 0.3);
    expect(speaker.leftArm.rotation.z).toBeLessThan(-0.2);
    const listener = scene.avatars.get("b")! as Face & { leftArm: three.Group };
    scene.updateAvatar(listener, 0.016, 0.3);
    expect(listener.leftArm.rotation.z).toBeCloseTo(0);
  });

  it("fidgets when left alone, keeps quiet while another bird speaks, and stays still under reduced motion", () => {
    const scene = harness();
    (scene as unknown as { options: { reducedMotion: boolean } }).options.reducedMotion = false;
    scene.sync(stateAt([event("seat", 0, "a")], 0), null, false);
    const bird = scene.avatars.get("b")! as Face & { actions: Array<{ kind: string; idle?: string }>; nextIdle: number };
    bird.nextIdle = 0;
    scene.updateAvatar(bird, 0.016, 1);
    // "a" took its seat, so it has the floor: b may only tap or shake.
    expect(bird.actions[0]?.kind).toBe("idle");
    expect(["tap", "shake"]).toContain(bird.actions[0]?.idle);

    const quiet = harness();
    const still = quiet.avatars.get("a")! as Face & { actions: unknown[]; nextIdle: number };
    still.nextIdle = 0;
    quiet.updateAvatar(still, 0.016, 5);
    expect(still.actions).toEqual([]);
  });

  it("keeps the beak shut and the body unsquashed under reduced motion", () => {
    const scene = harness();
    const events = [event("proposal", 0, "a")];
    scene.sync(stateAt(events, 0), null, false);
    const speaker = scene.avatars.get("a")!;
    scene.updateAvatar(speaker, 0.016, 0.5);
    expect(speaker.jaw.rotation.x).toBe(0);
    expect(speaker.body.scale.toArray()).toEqual([1, 1, 1]);
  });
});
