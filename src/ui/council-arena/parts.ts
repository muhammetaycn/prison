import type * as T from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** The modelled parts library (characters, accessories, gear, furniture, weapons), Draco-compressed. */
export const ARENA_PARTS_URL = "/models/arena-parts.glb";
/** three's Draco decoder, served next to the library. */
export const DRACO_DECODER_PATH = "/draco/";

/** Pırpır, PRISON's own mascot bird; each part's origin is the point where the scene places it. */
export type BodyPart =
  | "pirpir_body" | "pirpir_bib" | "pirpir_badge" | "pirpir_head" | "pirpir_tuft" | "pirpir_beak" | "pirpir_jaw"
  | "pirpir_cheek" | "pirpir_wing" | "pirpir_tail" | "pirpir_leg" | "pirpir_foot";
/** Headwear and eyewear modelled in head space for the Pırpır head. */
export type AccessoryPart =
  | "acc_crown" | "acc_crown_gems" | "acc_headphones_band" | "acc_headphones_cup" | "acc_headphones_light" | "acc_cap" | "acc_cap_brim"
  | "acc_beret" | "acc_tophat" | "acc_tophat_band" | "acc_bolt" | "acc_glasses" | "acc_antenna" | "acc_antenna_bulb"
  | "acc_twin_antennae" | "acc_twin_antennae_tips" | "acc_halo" | "acc_crest" | "acc_llama_ears" | "acc_llama_inner"
  | "acc_umbrella" | "acc_umbrella_handle" | "acc_cape" | "acc_cape_trim" | "acc_cape_clasp";
/** Stage furniture with PRISON motifs; origins on the floor at each piece's centre. */
export type FurniturePart =
  | "furn_table" | "furn_table_inlay" | "furn_chair" | "furn_chair_cushion" | "furn_podium" | "furn_podium_gold" | "furn_bench"
  | "furn_honor" | "furn_honor_cushion" | "furn_honor_gold" | "furn_dais" | "furn_canopy" | "furn_canopy_poles";
/** What a Pırpır wears to carry won weapons: belt, buckle and strap in egg space (body y 0.95), the scabbard from its throat. */
export type GearPart = "gear_belt" | "gear_buckle" | "gear_strap" | "gear_scabbard" | "gear_scabbard_trim";
export type WeaponPart = "weapon_sword" | "weapon_bow" | "weapon_shield" | "weapon_hammer" | "weapon_spear" | "weapon_staff";

/**
 * Modelled parts. Body parts are bare geometry the scene paints in seat colours; weapons keep
 * their own materials. Any part missing from the file falls back to the scene's primitive.
 */
export class PartLibrary {
  constructor(private readonly nodes: Map<string, T.Object3D>) {}

  /** Shared geometry of a body part; every avatar reuses the same buffers. */
  geometry(name: BodyPart | AccessoryPart | FurniturePart | GearPart): T.BufferGeometry | null {
    const node = this.nodes.get(name) as T.Mesh | undefined;
    return node?.isMesh ? node.geometry : null;
  }

  /** A fresh copy of a weapon (geometry and materials are shared). */
  weapon(name: WeaponPart): T.Object3D | null {
    const node = this.nodes.get(name);
    if (!node) return null;
    const copy = node.clone(true);
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, 0);
    copy.scale.setScalar(1);
    copy.traverse((part) => { part.castShadow = true; });
    return copy;
  }

  get size() { return this.nodes.size; }
}

/** Top-level nodes of a parsed glTF scene, by name. */
export function partsFrom(root: T.Object3D): PartLibrary {
  const nodes = new Map<string, T.Object3D>();
  for (const child of root.children) if (child.name) nodes.set(child.name, child);
  return new PartLibrary(nodes);
}

let pending: Promise<PartLibrary | null> | null = null;

/** Loads the library once per page; resolves to null when the file is missing or broken, so the scene keeps its primitives. */
export function loadArenaParts(): Promise<PartLibrary | null> {
  pending ??= (() => {
    const draco = new DRACOLoader().setDecoderPath(DRACO_DECODER_PATH);
    return new GLTFLoader().setDRACOLoader(draco).loadAsync(ARENA_PARTS_URL)
      .then((gltf) => partsFrom(gltf.scene))
      .catch(() => null)
      // The decoder's worker is only needed for this one file.
      .finally(() => draco.dispose());
  })();
  return pending;
}
