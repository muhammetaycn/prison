import * as three from "three";
import { describe, expect, it } from "vitest";
import { ACCESSORY_SLOTS, accessoriesFor, dress, type HeadShape } from "@/ui/council-arena/accessories";
import { Crowd } from "@/ui/council-arena/crowd";
import { partsFrom } from "@/ui/council-arena/parts";
import { ArenaScene } from "@/ui/council-arena/scene";

describe("arena accessories", () => {
  it.each([
    ["nvidia/llama-3.2-90b-vision-instruct", ["glasses", "llamaEars"]],
    ["openai/gpt-oss-20b", ["headphones"]],
    ["nvidia/nemotron-3-super-120b-a12b", ["cape"]],
    ["nvidia/nemotron-3-ultra-550b-a55b", ["crown"]],
    ["nvidia/nemotron-3.5-lightning-30b-a3b", ["bolt"]],
    ["muse-glimmer-30b", ["beret"]],
    ["laguna-xs-2.1", ["cap"]],
    ["google/gemini-2.5-pro", ["twinAntennae"]],
    ["openai/gpt-4o-mini", ["headphones", "cap"]],
  ])("reads %s's look off its name", (model, expected) => {
    expect(accessoriesFor(model)).toEqual(expected);
  });

  it("does not mistake words that only contain a short hint", () => {
    // "gemini" contains "mini" and "smart" contains "art"; neither is a whole word here.
    expect(accessoriesFor("google/gemini-flash")).not.toContain("cap");
    expect(accessoriesFor("acme/smartbot")).not.toContain("beret");
  });

  it("gives every model a look, stable across calls, with at most one accessory per slot", () => {
    for (const model of ["acme/unknown-7b", "x", "", "nvidia/llama-3.2-90b-vision-instruct", "acme/super-ultra-vision-gpt-lightning"]) {
      const first = accessoriesFor(model);
      expect(first.length).toBeGreaterThan(0);
      expect(accessoriesFor(model)).toEqual(first);
      const slots = first.map((accessory) => ACCESSORY_SLOTS[accessory]);
      expect(new Set(slots).size).toBe(slots.length);
    }
  });

  it("builds every accessory onto a head and reports how tall the headwear is", () => {
    const shape: HeadShape = { top: 0.31, half: 0.31, face: 0.285, round: true };
    const all = Object.keys(ACCESSORY_SLOTS) as Array<keyof typeof ACCESSORY_SLOTS>;
    for (const accessory of all) {
      const head = new three.Group();
      const body = new three.Group();
      const material = new three.MeshStandardMaterial();
      const outfit = dress({ three, head, body, shape, color: new three.Color("#3b82f6"), skin: material, trim: material, joint: material, seated: false }, [accessory]);
      expect(head.children.length + body.children.length).toBeGreaterThan(0);
      expect(outfit.height).toBeGreaterThanOrEqual(shape.top);
      expect(outfit.height).toBeLessThan(0.75);
      expect(outfit.cape !== null).toBe(accessory === "cape");
      head.traverse((object) => {
        const position = (object as three.Mesh).geometry?.getAttribute("position");
        if (position) for (let index = 0; index < position.count; index++) expect(Number.isFinite(position.getX(index))).toBe(true);
      });
    }
  });
  it("wears the modelled cape (cloth, piping, brooches) from the neck, draped wider and shorter when seated", () => {
    const shape: HeadShape = { top: 0.31, half: 0.31, face: 0.285, round: true };
    const pieces = new Map(["acc_cape", "acc_cape_trim", "acc_cape_clasp"].map((name) => [name, new three.BoxGeometry(0.1, 0.1, 0.1)]));
    const wear = (seated: boolean) => {
      const body = new three.Group();
      const material = new three.MeshStandardMaterial();
      const outfit = dress({ three, head: new three.Group(), body, shape, color: new three.Color("#8b5cf6"), skin: material, trim: material, seated, library: (name) => pieces.get(name) ?? null }, ["cape"]);
      return outfit.cape!;
    };
    const standing = wear(false);
    expect(standing.position.y).toBeCloseTo(1.4);
    const drape = standing.children[0];
    expect(drape.children.map((mesh) => (mesh as three.Mesh).geometry)).toEqual([...pieces.values()]);
    expect(drape.scale.y).toBe(1);
    const seated = wear(true).children[0];
    expect(seated.scale.x).toBeGreaterThan(1);
    expect(seated.scale.y).toBeLessThan(1);
  });
});

describe("arena crowd", () => {
  const seeded = () => {
    let seed = 7;
    return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  };
  const fanPositions = (crowd: Crowd) => {
    const bodies = (crowd as unknown as { bodies: three.InstancedMesh }).bodies;
    const matrix = new three.Matrix4();
    const at = new three.Vector3();
    return Array.from({ length: bodies.count }, (_, index) => {
      bodies.getMatrixAt(index, matrix);
      return at.setFromMatrixPosition(matrix).clone();
    });
  };

  it("seats fans in the stands, off the pitch and clear of the jury bench", () => {
    const crowd = new Crowd(three, new three.Scene(), false, seeded());
    expect(crowd.size).toBeGreaterThan(50);
    for (const fan of fanPositions(crowd)) {
      const radius = Math.hypot(fan.x, fan.z);
      expect(radius).toBeGreaterThan(8.9);
      expect(radius).toBeLessThan(11.2);
      // The jury bench stands at z = −9.1 between x = ±3.6.
      expect(fan.z < -7 && Math.abs(fan.x) < 4).toBe(false);
    }
  });

  it("jumps when something happens and settles again", () => {
    const crowd = new Crowd(three, new three.Scene(), false, seeded());
    const calm = fanPositions(crowd).map((fan) => fan.y);
    crowd.cheer(1.5);
    crowd.update(0.3, 0.016, null, false);
    const excited = fanPositions(crowd).map((fan) => fan.y);
    expect(excited.some((y, index) => y > calm[index] + 0.05)).toBe(true);
    for (let step = 0; step < 400; step++) crowd.update(0.3 + step * 0.02, 0.02, null, false);
    crowd.update(20, 0.02, null, false);
    const settled = fanPositions(crowd).map((fan) => fan.y);
    expect(settled.every((y, index) => Math.abs(y - calm[index]) < 0.01)).toBe(true);
  });

  it("stays still under reduced motion", () => {
    const crowd = new Crowd(three, new three.Scene(), true, seeded());
    const before = fanPositions(crowd).map((fan) => fan.toArray());
    crowd.cheer(1.5);
    crowd.update(1.2, 0.016, new three.Vector3(2, 0, 2), true);
    expect(fanPositions(crowd).map((fan) => fan.toArray())).toEqual(before);
  });
});

describe("arena parts library", () => {
  const library = () => {
    const root = new three.Group();
    const torso = new three.Mesh(new three.SphereGeometry(0.3), new three.MeshStandardMaterial());
    torso.name = "pirpir_body";
    const sword = new three.Group();
    sword.name = "weapon_sword";
    sword.position.set(4, 0, 0);
    sword.add(new three.Mesh(new three.BoxGeometry(0.05, 0.8, 0.02), new three.MeshStandardMaterial({ name: "steel" })));
    root.add(torso, sword);
    return { parts: partsFrom(root), torso };
  };

  it("reads named parts and hands out weapons as fresh copies at the origin", () => {
    const { parts, torso } = library();
    expect(parts.size).toBe(2);
    expect(parts.geometry("pirpir_body")).toBe(torso.geometry);
    expect(parts.geometry("pirpir_leg")).toBeNull();
    const first = parts.weapon("weapon_sword")!;
    const second = parts.weapon("weapon_sword")!;
    expect(first).not.toBe(second);
    expect(first.position.toArray()).toEqual([0, 0, 0]);
    expect(parts.weapon("weapon_bow")).toBeNull();
  });

  it("builds robots from the modelled parts and falls back to primitives for the rest", () => {
    const { parts, torso } = library();
    const scene = Object.assign(Object.create(ArenaScene.prototype), {
      three, options: { mode: "competition", reducedMotion: true }, scene: new three.Scene(), avatars: new Map(), weapons: new Map(),
      white: new three.Color("#eaf2ff"), green: new three.Color("#22c55e"), grey: new three.Color("#555a63"),
      state: null, addressee: null, podium: null, papers: [], disposables: [], effects: [], azimuth: 0.35, speed: 1,
      environment: null, parts,
    }) as { setSeats: (seats: Array<{ id: string; index: number; model: string; label: string; role: string; color: string }>) => void; avatars: Map<string, { body: three.Group }> };
    scene.setSeats([{ id: "a", index: 0, model: "openai/gpt-oss-20b", label: "gpt-oss-20b", role: "r", color: "#3b82f6" }]);
    const geometries: three.BufferGeometry[] = [];
    scene.avatars.get("a")!.body.traverse((object) => { if ((object as three.Mesh).isMesh) geometries.push((object as three.Mesh).geometry); });
    expect(geometries).toContain(torso.geometry);
    expect(geometries.some((geometry) => geometry instanceof three.CylinderGeometry)).toBe(true);
  });
});
