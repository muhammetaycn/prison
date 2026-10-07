/**
 * Where a Pırpır carries the weapons it has won. The first one is in its right wing (the scene's own hold); every
 * other one has its own place on the body, so a bird with all six still looks orderly rather than cluttered:
 *
 *   sword   sheathed in a scabbard on the left hip, hilt forward
 *   hammer  hanging head-down from the D-ring on the right hip, swung back
 *   shield  on the middle of the back, face out
 *   bow     slung across the back, top over the right shoulder
 *   spear   across the back, point over the right shoulder   staff  across the back, orb over the left shoulder
 *
 * Positions are in the avatar's body space (scene axes: y up, z forward, the egg's centre at y 0.95); rotations
 * are Euler XYZ. Weapons are modelled along +y from the grip. Layers go outward from the body (shield, then bow,
 * then the long arms), so nothing passes through anything else. Pure data: the scene applies it.
 */

export type WeaponKind = "sword" | "bow" | "shield" | "hammer" | "spear" | "staff";

export interface Mount {
  kind: WeaponKind;
  /** In the wing (the scene's hold for that weapon) or on the body at `position`/`rotation`. */
  slot: "hand" | "body";
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

export interface Gear {
  /** A belt as soon as anything is carried on the body. */
  belt: boolean;
  /** A strap over the shoulder when something rides on the back. */
  strap: boolean;
  /** The sword's scabbard whenever the bird owns the sword: holding it, the scabbard hangs empty. */
  scabbard: boolean;
}

/** The scabbard on the left hip: its throat just below the belt, tilted so the tip trails back. */
export const SCABBARD: { position: [number, number, number]; rotation: [number, number, number] } = {
  position: [-0.44, 0.7, 0.06],
  rotation: [0.6, 0, -0.17],
};

const ON_BODY: Record<WeaponKind, Omit<Mount, "kind" | "slot">> = {
  // The sword turned point-down into the scabbard, the guard at its throat.
  // (The guard, 0.1 up the grip, sits 0.09 back up the scabbard from where the blade goes in.)
  sword: { position: [-0.425, 0.773, 0.11], rotation: [SCABBARD.rotation[0], 0, Math.PI + SCABBARD.rotation[2]], scale: 0.9 },
  hammer: { position: [0.47, 0.66, -0.06], rotation: [0.9, 0, Math.PI], scale: 0.8 },
  shield: { position: [0, 0.72, -0.5], rotation: [0, Math.PI, 0], scale: 0.85 },
  bow: { position: [0.05, 0.62, -0.56], rotation: [0, 0, -0.62], scale: 0.85 },
  spear: { position: [-0.32, 0.42, -0.6], rotation: [-0.1, 0, -0.62], scale: 0.9 },
  staff: { position: [0.32, 0.42, -0.62], rotation: [-0.1, 0, 0.62], scale: 0.9 },
};

/** Mounts for the weapons a bird holds, in the order it won them: the first in the wing, the rest on the body. */
export function carry(kinds: readonly WeaponKind[]): Mount[] {
  return kinds.map((kind, index) => {
    if (index === 0) return { kind, slot: "hand", position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
    const place = ON_BODY[kind];
    return { kind, slot: "body", position: [...place.position], rotation: [...place.rotation], scale: place.scale };
  });
}

/** Which straps and sheaths to show for what the bird holds. */
export function gearFor(kinds: readonly WeaponKind[]): Gear {
  const carried = kinds.slice(1);
  return {
    belt: carried.length > 0 || kinds.includes("sword"),
    strap: carried.some((kind) => kind === "shield" || kind === "bow" || kind === "spear" || kind === "staff"),
    scabbard: kinds.includes("sword"),
  };
}
