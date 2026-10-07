import * as three from "three";
import { describe, expect, it, vi } from "vitest";
import { Crowd } from "@/ui/council-arena/crowd";
import { CROWD_REACTIONS, crowdProfile, nextCrowdReaction, type CrowdProfile, type CrowdReaction } from "@/ui/council-arena/crowd-variety";
import { outlineMaterial, toonGradient } from "@/ui/council-arena/toon";

const seeded = () => {
  let state = 17;
  return () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 4294967296);
};

interface Internals {
  fans: Array<{ profile: CrowdProfile; reaction: CrowdReaction }>;
  bodies: three.InstancedMesh;
  heads: three.InstancedMesh;
  crests: three.InstancedMesh;
  tails: three.InstancedMesh;
  arms: three.InstancedMesh;
}

const internals = (crowd: Crowd) => crowd as unknown as Internals;
const placements = (mesh: three.InstancedMesh) => Array.from(mesh.instanceMatrix.array);

describe("spectator identities", () => {
  it("keeps reproducible profiles and different silhouettes even when randomness repeats", () => {
    const profiles = Array.from({ length: 12 }, (_, index) => crowdProfile(index, () => 0.3));
    expect(profiles).toEqual(Array.from({ length: 12 }, (_, index) => crowdProfile(index, () => 0.3)));
    expect(new Set(profiles.map((profile) => `${profile.bodyWidth}/${profile.bodyHeight}/${profile.crest}`)).size).toBe(4);
    for (const profile of profiles) {
      expect(profile.size).toBeGreaterThan(0.85);
      expect(profile.size).toBeLessThan(1.12);
      expect(profile.pace).toBeGreaterThan(0.8);
      expect(profile.pace).toBeLessThan(1.2);
    }
  });

  it("gives every bird three crest feathers and tail feathers through two shared instance meshes", () => {
    const scene = new three.Scene();
    const crowd = new Crowd(three, scene, true, seeded());
    const parts = internals(crowd);
    expect(parts.crests.count).toBe(crowd.size * 3);
    expect(parts.tails.count).toBe(crowd.size * 3);
    expect(scene.children).toHaveLength(10);
    const matrix = new three.Matrix4();
    const scale = new three.Vector3();
    const silhouettes = new Set<string>();
    for (let index = 0; index < crowd.size; index++) {
      parts.bodies.getMatrixAt(index, matrix);
      scale.setFromMatrixScale(matrix);
      silhouettes.add(`${scale.x.toFixed(2)}/${scale.y.toFixed(2)}`);
    }
    expect(silhouettes.size).toBeGreaterThan(8);
    crowd.dispose();
  });
});

describe("real-event crowd reactions", () => {
  it("never chooses a bird's previous cheer pose and uses the complete repertoire", () => {
    let previous: CrowdReaction | null = null;
    const seen = new Set<CrowdReaction>();
    const first: CrowdReaction[] = [];
    for (let event = 0; event < 100; event++) {
      const next = nextCrowdReaction(previous, 8192, event);
      expect(next).not.toBe(previous);
      first.push(next);
      seen.add(next);
      previous = next;
    }
    expect(seen.size).toBe(CROWD_REACTIONS.length);
    previous = null;
    expect(first).toEqual(Array.from({ length: 100 }, (_, event) => (previous = nextCrowdReaction(previous, 8192, event))));
  });

  it("changes actual wing poses across repeated real cheers while retaining a bounded scene", () => {
    const scene = new three.Scene();
    const crowd = new Crowd(three, scene, false, seeded());
    const parts = internals(crowd);
    const objects = [...scene.children];
    crowd.cheer(1.2);
    crowd.update(0.8, 0.016, null, false);
    const first = placements(parts.arms);
    const reactions = parts.fans.map((fan) => fan.reaction);
    crowd.cheer(1.2);
    // The same timestamp isolates event variation from the usual time-driven movement.
    crowd.update(0.8, 0.016, null, false);
    expect(placements(parts.arms)).not.toEqual(first);
    expect(parts.fans.every((fan, index) => fan.reaction !== reactions[index])).toBe(true);
    for (let event = 0; event < 500; event++) { crowd.cheer(1); crowd.update(event * 0.05, 0.05, null, false); }
    expect(scene.children).toEqual(objects);
    expect(crowd.flags).toBe(0);
    expect([...parts.bodies.instanceMatrix.array, ...parts.crests.instanceMatrix.array, ...parts.tails.instanceMatrix.array].every(Number.isFinite)).toBe(true);
    crowd.dispose();
  });

  it("does not turn quiet frames or invalid cheer strengths into fresh event reactions", () => {
    const crowd = new Crowd(three, new three.Scene(), false, seeded());
    const before = internals(crowd).fans.map((fan) => fan.reaction);
    crowd.cheer(0);
    crowd.cheer(-1);
    crowd.cheer(Number.NaN);
    crowd.cheer(Number.POSITIVE_INFINITY);
    for (let frame = 0; frame < 200; frame++) crowd.update(frame * 0.05, 0.05, null, false);
    expect(internals(crowd).fans.map((fan) => fan.reaction)).toEqual(before);
    expect(crowd.flags).toBe(0);
    crowd.dispose();
  });

  it("varies an existing winner celebration without bringing out flags on a non-winning event", () => {
    const crowd = new Crowd(three, new three.Scene(), false, seeded());
    crowd.cheer(1.5);
    crowd.update(1, 0.016, null, false, new three.Color("#e879f9"));
    expect(crowd.flags).toBe(0);
    crowd.update(1, 0.1, null, true, new three.Color("#e879f9"));
    const first = internals(crowd).fans.map((fan) => fan.reaction);
    crowd.update(6, 0.1, null, true, new three.Color("#e879f9"));
    expect(internals(crowd).fans.every((fan, index) => fan.reaction !== first[index])).toBe(true);
    expect(crowd.flags).toBeGreaterThan(0);
    crowd.dispose();
  });
});

describe("stillness and resource ownership", () => {
  it("keeps all bird features still under reduced motion during repeated events and a sustained winner", () => {
    const scene = new three.Scene();
    const crowd = new Crowd(three, scene, true, seeded());
    const movingParts = [internals(crowd).bodies, internals(crowd).heads, internals(crowd).arms, internals(crowd).crests, internals(crowd).tails];
    const before = movingParts.map(placements);
    for (let event = 0; event < 30; event++) {
      crowd.cheer(1.5);
      crowd.update(event * 2, 0.016, new three.Vector3(2, 0, -1), true, new three.Color("#e879f9"));
    }
    expect(movingParts.map(placements)).toEqual(before);
    expect(crowd.flags).toBe(1);
    crowd.dispose();
  });

  it("releases every owned instanced resource once and preserves shared ink and lighting texture", () => {
    const scene = new three.Scene();
    const ink = outlineMaterial(three, 0.016);
    const ramp = toonGradient(three);
    const sharedInk = vi.spyOn(ink, "dispose");
    const sharedRamp = vi.spyOn(ramp, "dispose");
    const crowd = new Crowd(three, scene, false, seeded(), { ink, ramp });
    const owned = scene.children as three.InstancedMesh[];
    const geometryCalls = owned.map((mesh) => vi.spyOn(mesh.geometry, "dispose"));
    const materialCalls = owned.map((mesh) => vi.spyOn(mesh.material as three.Material, "dispose"));
    const meshCalls = owned.map((mesh) => vi.spyOn(mesh, "dispose"));
    const shells = owned.flatMap((mesh) => mesh.children as three.InstancedMesh[]).map((mesh) => vi.spyOn(mesh, "dispose"));
    crowd.dispose();
    crowd.dispose();
    crowd.cheer(1);
    crowd.update(5, 0.1, null, true);
    expect(scene.children).toHaveLength(0);
    for (const release of [...geometryCalls, ...materialCalls, ...meshCalls, ...shells]) expect(release).toHaveBeenCalledTimes(1);
    expect(sharedInk).not.toHaveBeenCalled();
    expect(sharedRamp).not.toHaveBeenCalled();
  });
});
