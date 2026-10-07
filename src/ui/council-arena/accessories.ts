import type * as T from "three";
import { toon } from "./toon";

type Three = typeof T;

/**
 * Add-ons that tell models apart beyond seat color. Each one is read off the model's own name
 * (a "vision" model wears glasses, a "lightning" model a bolt), so nothing about the model is invented.
 */
export type Accessory =
  | "glasses" | "headphones" | "llamaEars" | "crown" | "cape" | "bolt" | "beret" | "cap"
  | "antenna" | "twinAntennae" | "halo" | "crest" | "topHat";

export type AccessorySlot = "top" | "sides" | "eyes" | "back";

export const ACCESSORY_SLOTS: Record<Accessory, AccessorySlot> = {
  glasses: "eyes", headphones: "sides", llamaEars: "sides", cape: "back",
  crown: "top", bolt: "top", beret: "top", cap: "top", antenna: "top", twinAntennae: "top", halo: "top", crest: "top", topHat: "top",
};

/**
 * Name hints, checked in order; the first hit fills its slot. Family names come before size words so
 * "gemini-pro" keeps its family look. Words of five letters or more also match inside a token.
 */
const HINTS: Array<[Accessory, string[]]> = [
  ["glasses", ["vision", "vl", "visual", "eye", "see", "ocr", "pixtral"]],
  ["llamaEars", ["llama", "alpaca", "vicuna"]],
  ["headphones", ["gpt", "chatgpt", "chat", "whisper", "audio", "voice", "speech", "talk"]],
  ["cape", ["super", "hero", "titan", "giant"]],
  ["halo", ["claude", "sonnet", "haiku", "guard", "safe", "angel"]],
  ["twinAntennae", ["gemini", "gemma", "twin", "duo", "pair"]],
  ["antenna", ["mistral", "mixtral", "qwen", "deepseek", "radio"]],
  ["bolt", ["lightning", "flash", "turbo", "fast", "spark", "instant", "rapid"]],
  ["beret", ["muse", "art", "poet", "glimmer", "creative", "story", "writer"]],
  ["crest", ["code", "coder", "codestral", "devstral", "dev", "program"]],
  ["crown", ["ultra", "max", "opus", "king", "large", "pro"]],
  ["cap", ["laguna", "mini", "nano", "xs", "tiny", "small", "lite"]],
];

/** For names that give no hint: a stable pick so the same model always looks the same. */
const FALLBACK: Accessory[] = ["antenna", "twinAntennae", "topHat", "crest", "halo"];

function tokens(model: string): string[] {
  return (model.toLowerCase().split("/").at(-1) ?? "").split(/[^a-z0-9]+/).filter(Boolean);
}

/** At most one accessory per slot, in hint order; every model gets at least one. */
export function accessoriesFor(model: string): Accessory[] {
  const words = tokens(model);
  const taken = new Set<AccessorySlot>();
  const chosen: Accessory[] = [];
  for (const [accessory, hints] of HINTS) {
    const slot = ACCESSORY_SLOTS[accessory];
    if (taken.has(slot)) continue;
    if (!words.some((word) => hints.some((hint) => word === hint || (hint.length >= 5 && word.includes(hint))))) continue;
    taken.add(slot);
    chosen.push(accessory);
  }
  if (!chosen.length) {
    let hash = 0;
    for (const char of model) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    chosen.push(FALLBACK[hash % FALLBACK.length]);
  }
  return chosen;
}

export interface HeadShape {
  /** Height of the skull's crown above the head centre. */
  top: number;
  /** Half the skull's width at ear height. */
  half: number;
  /** Depth of the face plate in front of the head centre. */
  face: number;
  /** Rounded skulls let hats sink onto the curve; flat tops carry them on the lid. */
  round: boolean;
  /** Where the eyes sit (centre x/y, front z, radius), so glasses fit any face. */
  eyes?: { x: number; y: number; z: number; r: number };
}

export interface Outfit {
  /** Cape pivot at the shoulders, swung back while walking; null without a cape. */
  cape: T.Group | null;
  /** Lit tips (antennae, halo, bolt, crest, gems) that brighten while the model thinks or speaks. */
  lights: Array<T.MeshStandardMaterial | T.MeshToonMaterial>;
  /** Highest point above the head centre, so the name tag clears tall hats. */
  height: number;
}

export interface Wardrobe {
  three: Three;
  head: T.Group;
  body: T.Group;
  shape: HeadShape;
  color: T.Color;
  skin: T.Material;
  trim: T.Material;
  /** Ear bolts for heads without side headwear; birds leave it out. */
  joint?: T.Material;
  /** At the table the cape is draped over the chair back rather than hanging from the shoulders. */
  seated: boolean;
  /** Cel-shading ramp so the accessories match the rest of the stage. */
  ramp?: T.Texture | null;
  /** Modelled pieces from the parts library (head space); missing ones fall back to simple shapes. */
  library?: (name: string) => T.BufferGeometry | null;
}

/** Builds the accessories onto an avatar's head and body. */
export function dress(kit: Wardrobe, accessories: Accessory[]): Outfit {
  const { three, head, body, shape, color } = kit;
  const white = new three.Color("#ffffff");
  const outfit: Outfit = { cape: null, lights: [], height: shape.top };
  const reach = (y: number) => { outfit.height = Math.max(outfit.height, y); };
  const add = <M extends T.Object3D>(parent: T.Object3D, part: M, x = 0, y = 0, z = 0): M => {
    part.position.set(x, y, z);
    part.castShadow = true;
    parent.add(part);
    return part;
  };
  const ramp = kit.ramp ?? null;
  const paint = (tint: T.ColorRepresentation, extra: T.MeshToonMaterialParameters = {}) => toon(three, ramp, tint, extra);
  const light = (tint: T.Color = color) => {
    const material = paint(tint.clone().lerp(white, 0.35), { emissive: tint, emissiveIntensity: 0.6 });
    outfit.lights.push(material);
    return material;
  };
  const gold = () => paint("#f2c14e");
  /** Adds modelled pieces (with an optional mirrored twin) at the head's origin; false when any piece is missing. */
  const modelled = (pieces: Array<[string, T.Material, boolean?]>, height: number): T.Mesh[] | null => {
    const geometries = pieces.map(([name]) => kit.library?.(name) ?? null);
    if (geometries.some((geometry) => !geometry)) return null;
    const meshes: T.Mesh[] = [];
    pieces.forEach(([, material, mirrored], index) => {
      meshes.push(add(head, new three.Mesh(geometries[index]!, material)));
      if (mirrored) add(head, new three.Mesh(geometries[index]!, material)).scale.x = -1;
    });
    reach(height);
    return meshes;
  };
  /** Where a hat of radius `r` comes to rest on the skull. */
  const restOn = (r: number) => shape.round ? Math.sqrt(Math.max(0, shape.top ** 2 - r ** 2)) : shape.top;
  /** A thin bar between two points in head space. */
  const strut = (from: T.Vector3, to: T.Vector3, thickness: number, material: T.Material) => {
    const span = to.clone().sub(from);
    const bar = new three.Mesh(new three.BoxGeometry(thickness, thickness, span.length()), material);
    bar.rotation.order = "YXZ";
    bar.rotation.set(-Math.atan2(span.y, Math.hypot(span.x, span.z)), Math.atan2(span.x, span.z), 0);
    return add(head, bar, (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  };

  for (const accessory of accessories) {
    switch (accessory) {
      case "glasses": {
        const frame = paint("#f3d58a");
        if (modelled([["acc_glasses", frame]], shape.top)) break;
        const eyes = shape.eyes ?? { x: 0.085, y: 0.05, z: shape.face + 0.03, r: 0.056 };
        const ring = eyes.r + 0.014;
        for (const side of [-1, 1]) {
          add(head, new three.Mesh(new three.TorusGeometry(ring, 0.014, 8, 32), frame), side * eyes.x, eyes.y, eyes.z);
          strut(new three.Vector3(side * (eyes.x + ring), eyes.y + 0.01, eyes.z - 0.01), new three.Vector3(side * (shape.half + 0.012), eyes.y + 0.02, 0.04), 0.014, frame);
        }
        const gap = Math.max(0.02, eyes.x * 2 - ring * 2);
        add(head, new three.Mesh(new three.BoxGeometry(gap + 0.01, 0.014, 0.014), frame), 0, eyes.y + 0.02, eyes.z);
        break;
      }
      case "headphones": {
        const pad = paint("#2a2733");
        const hatted = accessories.some((entry) => ACCESSORY_SLOTS[entry] === "top");
        const pieces = modelled([["acc_headphones_band", pad], ["acc_headphones_cup", paint(color.clone().lerp(white, 0.3)), true], ["acc_headphones_light", light(), true]], 0.48);
        if (pieces) {
          // With a hat on top, the band slips back behind the head.
          if (hatted) pieces[0].rotation.x = -0.75;
          break;
        }
        for (const side of [-1, 1]) {
          const cup = add(head, new three.Mesh(new three.CylinderGeometry(0.105, 0.105, 0.08, 24), light()), side * (shape.half + 0.04), 0, 0);
          cup.rotation.z = Math.PI / 2;
          const cushion = add(head, new three.Mesh(new three.CylinderGeometry(0.085, 0.085, 0.03, 20), pad), side * (shape.half + 0.005), 0, 0);
          cushion.rotation.z = Math.PI / 2;
        }
        const band = add(head, new three.Mesh(new three.TorusGeometry(shape.half + 0.07, 0.024, 8, 32, Math.PI), pad));
        if (hatted) band.rotation.x = -0.75;
        reach(shape.half + 0.1);
        break;
      }
      case "llamaEars": {
        const inner = paint("#f4b6c2");
        if (modelled([["acc_llama_ears", kit.skin], ["acc_llama_inner", inner]], 0.62)) break;
        for (const side of [-1, 1]) {
          const ear = add(head, new three.Mesh(new three.CapsuleGeometry(0.055, 0.2, 4, 12), kit.skin), side * 0.17, shape.top + 0.06, -0.02);
          ear.rotation.set(0.15, 0, -side * 0.35);
          const lining = add(ear, new three.Mesh(new three.SphereGeometry(0.05, 12, 8), inner), 0, 0.02, 0.035);
          lining.scale.set(0.5, 2.2, 0.3);
        }
        reach(shape.top + 0.26);
        break;
      }
      case "crown": {
        const metal = gold();
        if (modelled([["acc_crown", metal], ["acc_crown_gems", light()]], 0.56)) break;
        const base = restOn(0.21);
        const band = add(head, new three.Mesh(new three.CylinderGeometry(0.2, 0.22, 0.11, 28, 1, true), metal), 0, base + 0.055, 0);
        (band.material as T.MeshToonMaterial).side = three.DoubleSide;
        for (let index = 0; index < 6; index++) {
          const angle = (index / 6) * Math.PI * 2;
          add(head, new three.Mesh(new three.ConeGeometry(0.045, 0.11, 8), metal), Math.sin(angle) * 0.205, base + 0.165, Math.cos(angle) * 0.205);
          add(head, new three.Mesh(new three.SphereGeometry(0.026, 10, 8), light()), Math.sin(angle) * 0.222, base + 0.05, Math.cos(angle) * 0.222);
        }
        reach(base + 0.23);
        break;
      }
      case "cape": {
        const pivot = new three.Group();
        pivot.position.set(0, 1.4, 0);
        body.add(pivot);
        // A deeper shade of the seat colour, so the cloak reads apart from the feathers under it.
        const cloth = paint(color.clone().multiplyScalar(0.5), { side: three.DoubleSide });
        outfit.cape = pivot;
        // Modelled cloak (pivot space): pleated cloth that parts round the tail, gold piping and a rolled collar, and
        // birdcage brooches. Seated, it is draped wider and shorter over the chair back.
        const sheet = kit.library?.("acc_cape");
        const piping = kit.library?.("acc_cape_trim");
        const brooch = kit.library?.("acc_cape_clasp");
        if (sheet && piping && brooch) {
          const drape = add(pivot, new three.Group());
          if (kit.seated) drape.scale.set(1.3, 0.8, 1.3);
          const metal = gold();
          add(drape, new three.Mesh(sheet, cloth));
          add(drape, new three.Mesh(piping, metal));
          add(drape, new three.Mesh(brooch, metal));
          break;
        }
        const [top, bottom, length] = kit.seated ? [0.43, 0.47, 0.78] : [0.33, 0.46, 0.98];
        add(pivot, new three.Mesh(new three.CylinderGeometry(top, bottom, length, 20, 4, true, Math.PI - 0.95, 1.9), cloth), 0, -length / 2, 0);
        const clasp = gold();
        for (const side of [-1, 1]) add(pivot, new three.Mesh(new three.SphereGeometry(0.04, 12, 8), clasp), side * Math.sin(0.95) * top, -0.02, -Math.cos(0.95) * top);
        break;
      }
      case "bolt": {
        if (modelled([["acc_bolt", light(new three.Color("#ffc21a"))]], 0.66)) break;
        const outline = new three.Shape();
        outline.moveTo(0.03, 0.3);
        for (const [x, y] of [[-0.08, 0.12], [0, 0.12], [-0.05, 0], [0.09, 0.17], [0.01, 0.17], [0.08, 0.3]] as const) outline.lineTo(x, y);
        const geometry = new three.ExtrudeGeometry(outline, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2 });
        geometry.translate(-0.005, 0, -0.0175);
        const bolt = add(head, new three.Mesh(geometry, light(new three.Color("#ffc21a"))), 0, shape.top - 0.03, 0);
        bolt.rotation.z = -0.15;
        reach(shape.top + 0.28);
        break;
      }
      case "beret": {
        const felt = paint("#4a2d5c");
        if (modelled([["acc_beret", felt]], 0.48)) break;
        const y = restOn(0.22) + 0.04;
        const beret = add(head, new three.Mesh(new three.SphereGeometry(0.27, 28, 14), felt), 0.03, y, -0.01);
        beret.scale.set(1, 0.32, 1);
        beret.rotation.z = -0.22;
        add(head, new three.Mesh(new three.CylinderGeometry(0.016, 0.02, 0.06, 8), felt), 0.05, y + 0.1, -0.01);
        reach(y + 0.13);
        break;
      }
      case "cap": {
        const cloth = paint("#f4f1ea");
        const visor = paint(color);
        if (modelled([["acc_cap", cloth], ["acc_cap_brim", visor]], 0.47)) break;
        let rim: number;
        let front: number;
        if (shape.round) {
          const radius = shape.half + 0.025;
          const centre = shape.top - radius + 0.14;
          add(head, new three.Mesh(new three.SphereGeometry(radius, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), cloth), 0, centre, 0);
          add(head, new three.Mesh(new three.SphereGeometry(0.03, 10, 8), visor), 0, centre + radius, 0);
          [rim, front] = [centre, radius - 0.06];
          reach(centre + radius + 0.03);
        } else {
          add(head, new three.Mesh(new three.CylinderGeometry(shape.half * 0.92, shape.half * 0.98, 0.13, 28), cloth), 0, shape.top + 0.06, 0);
          [rim, front] = [shape.top + 0.01, shape.half * 0.85];
          reach(shape.top + 0.13);
        }
        const brim = add(head, new three.Mesh(new three.CylinderGeometry(0.2, 0.2, 0.02, 20, 1, false, -Math.PI / 2, Math.PI), visor), 0, rim + 0.01, front);
        brim.rotation.x = 0.12;
        break;
      }
      case "antenna":
        if (modelled([["acc_antenna", kit.trim], ["acc_antenna_bulb", light()]], 0.73)) break;
        add(head, new three.Mesh(new three.CylinderGeometry(0.015, 0.015, 0.22, 6), kit.trim), 0, shape.top + 0.09, 0);
        add(head, new three.Mesh(new three.SphereGeometry(0.05, 12, 8), light()), 0, shape.top + 0.22, 0);
        reach(shape.top + 0.27);
        break;
      case "twinAntennae":
        if (modelled([["acc_twin_antennae", kit.trim], ["acc_twin_antennae_tips", light()]], 0.7)) break;
        for (const side of [-1, 1]) {
          const stalk = add(head, new three.Mesh(new three.CylinderGeometry(0.013, 0.013, 0.22, 6), kit.trim), side * 0.13, shape.top + 0.06, 0);
          stalk.rotation.z = -side * 0.4;
          add(head, new three.Mesh(new three.SphereGeometry(0.042, 12, 8), light()), side * 0.175, shape.top + 0.17, 0);
        }
        reach(shape.top + 0.22);
        break;
      case "halo": {
        if (modelled([["acc_halo", light(new three.Color("#ffe08a"))]], 0.56)) break;
        const ring = add(head, new three.Mesh(new three.TorusGeometry(0.24, 0.024, 8, 40), light(new three.Color("#ffe08a"))), 0, shape.top + 0.12, 0);
        ring.rotation.x = Math.PI / 2;
        reach(shape.top + 0.15);
        break;
      }
      case "crest": {
        const fin = light();
        if (modelled([["acc_crest", fin]], 0.55)) break;
        [0.11, 0.15, 0.17, 0.15, 0.11].forEach((height, index) => {
          add(head, new three.Mesh(new three.BoxGeometry(0.055, height, 0.085), fin), 0, restOn(0) + height / 2 - 0.03, 0.17 - index * 0.09);
        });
        reach(shape.top + 0.15);
        break;
      }
      case "topHat": {
        const silk = paint("#25222c");
        if (modelled([["acc_tophat", silk], ["acc_tophat_band", paint(color)]], 0.62)) break;
        const base = restOn(0.2) + 0.01;
        add(head, new three.Mesh(new three.CylinderGeometry(0.3, 0.3, 0.025, 28), silk), 0, base, 0);
        add(head, new three.Mesh(new three.CylinderGeometry(0.185, 0.2, 0.27, 28), silk), 0, base + 0.145, 0);
        add(head, new three.Mesh(new three.CylinderGeometry(0.203, 0.203, 0.055, 28), paint(color)), 0, base + 0.05, 0);
        reach(base + 0.28);
        break;
      }
    }
  }
  // Without headwear on the sides, small bolts mark where the ears would be.
  if (kit.joint && !accessories.some((entry) => ACCESSORY_SLOTS[entry] === "sides")) {
    for (const side of [-1, 1]) {
      const bolt = add(head, new three.Mesh(new three.CylinderGeometry(0.06, 0.07, 0.05, 16), kit.joint), side * (shape.half + 0.012), 0.01, 0);
      bolt.rotation.z = Math.PI / 2;
    }
  }
  return outfit;
}
