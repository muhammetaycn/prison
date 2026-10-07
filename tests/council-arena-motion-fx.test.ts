import * as three from "three";
import { describe, expect, it } from "vitest";
import { DustPuffs, SpeedLines, SwingTrail, stepSpring } from "@/ui/council-arena/motion-fx";

const at = (x: number, y: number, z = 0) => new three.Vector3(x, y, z);

describe("swing trail", () => {
  it("grows only while the blade moves, then fades away on its own", () => {
    const trail = new SwingTrail(three, "#f97316", 0.2);
    // A blade standing still leaves nothing.
    trail.push(at(0, 1), at(0, 2), 0);
    trail.push(at(0, 1), at(0, 2), 0.02);
    expect(trail.length).toBe(1);
    for (let index = 1; index <= 10; index++) trail.push(at(0, 1), at(Math.sin(index * 0.2), 1 + Math.cos(index * 0.2)), index * 0.016);
    expect(trail.update(0.16)).toBe(true);
    expect(trail.mesh.geometry.drawRange.count).toBe((trail.length - 1) * 6);
    // The tip edge is brighter than the hilt edge, and the newest sample brighter than the oldest.
    const colors = trail.mesh.geometry.getAttribute("color").array as Float32Array;
    const newest = (trail.length - 1) * 8;
    expect(colors[newest + 7]).toBeGreaterThan(colors[newest + 3]);
    expect(colors[newest + 7]).toBeGreaterThan(colors[7]);
    expect(trail.update(1)).toBe(false);
    expect(trail.length).toBe(0);
    expect(trail.mesh.geometry.drawRange.count).toBe(0);
    trail.dispose();
  });
});

describe("dust puffs", () => {
  const scaleOf = (puffs: DustPuffs, index: number) => {
    const matrix = new three.Matrix4();
    puffs.mesh.getMatrixAt(index, matrix);
    return new three.Vector3().setFromMatrixScale(matrix).x;
  };

  it("pop up, drift and shrink away", () => {
    const puffs = new DustPuffs(three, new three.MeshBasicMaterial(), 8);
    puffs.spawn(at(0, 0.05), 0.2, at(0.3, 0.2), 0, "#efe4cc", 0.5);
    puffs.update(0.1);
    expect(puffs.active).toBe(1);
    const early = scaleOf(puffs, 0);
    expect(early).toBeGreaterThan(0.1);
    puffs.update(0.45);
    expect(scaleOf(puffs, 0)).toBeLessThan(early);
    puffs.update(0.6);
    expect(puffs.active).toBe(0);
    expect(scaleOf(puffs, 0)).toBe(0);
    puffs.dispose();
  });

  it("rings out from a landing and never holds more than it can draw", () => {
    const puffs = new DustPuffs(three, new three.MeshBasicMaterial(), 10);
    puffs.burst(at(0, 0.05), 8, 0.15, 0.8, 0, "#efe4cc");
    expect(puffs.active).toBe(8);
    puffs.burst(at(0, 0.05), 8, 0.15, 0.8, 0.1, "#efe4cc");
    expect(puffs.active).toBe(10);
    puffs.dispose();
  });
});

describe("spring", () => {
  it("overshoots a little and settles on its target at any frame rate", () => {
    for (const delta of [1 / 30, 1 / 60, 1 / 144]) {
      const spring = { value: 0, velocity: 0 };
      let peak = 0;
      for (let t = 0; t < 3; t += delta) peak = Math.max(peak, stepSpring(spring, 0.5, delta));
      expect(peak).toBeGreaterThan(0.5);
      expect(spring.value).toBeCloseTo(0.5, 3);
    }
  });

  it("stays stable through a long hitch", () => {
    const spring = { value: 0, velocity: 0 };
    stepSpring(spring, 1, 5);
    expect(Number.isFinite(spring.value)).toBe(true);
    expect(Math.abs(spring.value)).toBeLessThan(2);
  });
});

describe("speed lines", () => {
  it("burst in on a blow and fade out within a third of a second", () => {
    const lines = new SpeedLines(three, 20, 0.3);
    const camera = new three.PerspectiveCamera(42, 16 / 9, 0.1, 100);
    lines.update(0, camera);
    expect(lines.showing).toBe(false);
    lines.fire(1, 1.2, { x: 0.2, y: -0.1 });
    lines.update(1.05, camera);
    expect(lines.showing).toBe(true);
    const strong = (lines.mesh.material as three.MeshBasicMaterial).opacity;
    lines.update(1.25, camera);
    expect((lines.mesh.material as three.MeshBasicMaterial).opacity).toBeLessThan(strong);
    lines.update(1.31, camera);
    expect(lines.showing).toBe(false);
    lines.dispose();
  });
});
