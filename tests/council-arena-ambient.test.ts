import * as three from "three";
import { describe, expect, it } from "vitest";
import { Ambient } from "@/ui/council-arena/ambient";

const seeded = () => {
  let state = 7;
  return () => ((state = (state * 16807) % 2147483647) / 2147483647);
};

const field = (reducedMotion = false) => {
  const scene = new three.Scene();
  const ambient = new Ambient(three, scene, {
    mode: "competition", reducedMotion, random: seeded(),
    trees: [new three.Vector3(16, 4, 3), new three.Vector3(-15, 4.5, 6)],
    flowers: [new three.Vector3(7.8, 0, 1), new three.Vector3(-7.7, 0, -2)],
  });
  return { scene, ambient };
};

const room = (reducedMotion = false) => {
  const scene = new three.Scene();
  const sills = [0, 1, 2].map((index) => {
    const angle = -Math.PI / 2 + (index - 1) * 0.7;
    return { position: new three.Vector3(Math.cos(angle) * 6.1, 1.6, Math.sin(angle) * 6.1), outward: new three.Vector3(Math.cos(angle), 0, Math.sin(angle)) };
  });
  const ambient = new Ambient(three, scene, { mode: "collaboration", reducedMotion, random: seeded(), sills, lamp: new three.Vector3(0, 3.1, 0) });
  return { scene, ambient };
};

const instancePosition = (mesh: three.InstancedMesh, index: number) => {
  const matrix = new three.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new three.Vector3().setFromMatrixPosition(matrix);
};

describe("ambient life", () => {
  it("flies a flock over the treeline, keeps butterflies at the flowers and lets leaves fall from the crowns", () => {
    const { scene, ambient } = field();
    expect(ambient.counts).toMatchObject({ flock: 9, butterflies: 2, leaves: 26 });
    const group = scene.getObjectByName("ambient")!;
    const meshes = group.children.filter((child) => (child as three.InstancedMesh).isInstancedMesh) as three.InstancedMesh[];
    const flock = meshes[0];
    const before = instancePosition(flock, 0);
    for (let t = 0; t < 4; t += 1 / 30) ambient.update(t, 1 / 30);
    const after = instancePosition(flock, 0);
    expect(after.distanceTo(before)).toBeGreaterThan(1);
    // Over the treeline, round the field.
    expect(after.y).toBeGreaterThan(4);
    expect(Math.hypot(after.x, after.z)).toBeGreaterThan(15);
    const leaves = meshes.find((mesh) => mesh.count === 26)!;
    for (let index = 0; index < 26; index++) expect(instancePosition(leaves, index).y).toBeGreaterThanOrEqual(0.02 - 1e-6);
  });

  it("answers the weather: no butterflies in the rain, no flock in a storm", () => {
    const { ambient } = field();
    ambient.setWeather("rainy");
    ambient.update(1, 0.016);
    expect(ambient.counts.butterflies).toBe(0);
    expect(ambient.counts.flock).toBe(9);
    ambient.setWeather("storm");
    ambient.update(1.1, 0.016);
    expect(ambient.counts.flock).toBe(0);
    ambient.setWeather("sunny");
    ambient.update(1.2, 0.016);
    expect(ambient.counts).toMatchObject({ flock: 9, butterflies: 2 });
  });

  it("brings little birds to the window sills, and a big moment sends them off", () => {
    const { ambient } = room();
    expect(ambient.counts.moths).toBe(3);
    let landed = 0;
    let t = 0;
    for (; t < 40 && landed === 0; t += 1 / 30) { ambient.update(t, 1 / 30); landed = ambient.counts.perched; }
    expect(landed).toBeGreaterThan(0);
    ambient.startle(1);
    for (const end = t + 1.2; t < end; t += 1 / 30) ambient.update(t, 1 / 30);
    expect(ambient.counts.perched).toBe(0);
    // Rain keeps them away.
    ambient.setWeather("rainy");
    for (const end = t + 30; t < end; t += 1 / 30) ambient.update(t, 1 / 30);
    expect(ambient.counts.perched).toBe(0);
  });

  it("holds still under reduced motion: no flock, no falling leaves, one bird resting on a sill", () => {
    const { ambient } = field(true);
    expect(ambient.counts).toMatchObject({ flock: 0, leaves: 0, butterflies: 2 });
    const quiet = room(true);
    expect(quiet.ambient.counts).toMatchObject({ moths: 0, perched: 1 });
    quiet.ambient.startle(1);
    quiet.ambient.update(5, 0.016);
    expect(quiet.ambient.counts.perched).toBe(1);
  });

  it("cleans up after itself", () => {
    const { scene, ambient } = field();
    ambient.dispose();
    expect(scene.getObjectByName("ambient")).toBeUndefined();
  });
});
