import * as three from "three";
import { describe, expect, it } from "vitest";
import { carry, gearFor, SCABBARD, type WeaponKind } from "@/ui/council-arena/equipment";
import { ARENA_BOX, honorSeat, HONOR_RADIUS } from "@/ui/council-arena/honor";

const ALL: WeaponKind[] = ["sword", "bow", "shield", "hammer", "spear", "staff"];
/** Each weapon's length from grip to tip in the parts library. */
const LENGTH: Record<WeaponKind, number> = { sword: 0.9, bow: 0.75, shield: 0.66, hammer: 0.82, spear: 1.32, staff: 1.13 };

/** World direction of a weapon's +y (grip to tip) under a mount's rotation. */
const along = (rotation: [number, number, number]) => new three.Vector3(0, 1, 0).applyEuler(new three.Euler(...rotation));

describe("carried equipment", () => {
  it("puts the first weapon in the wing and gives every other kind its own place on the body", () => {
    const mounts = carry(ALL);
    expect(mounts[0]).toMatchObject({ kind: "sword", slot: "hand" });
    const onBody = mounts.slice(1);
    expect(onBody.every((mount) => mount.slot === "body")).toBe(true);
    const places = new Set(onBody.map((mount) => mount.position.join(",")));
    expect(places.size).toBe(onBody.length);
  });

  it("keeps everything off the ground and out of the body", () => {
    for (const first of ALL) {
      const kinds = [first, ...ALL.filter((kind) => kind !== first)];
      for (const mount of carry(kinds).slice(1)) {
        const [x, y, z] = mount.position;
        // Nothing starts inside the egg (radius ≈ 0.44 round its centre at y 0.95)…
        expect(Math.hypot(x, (y - 0.95) * 0.8, z)).toBeGreaterThan(0.38);
        // …and no tip drags on the ground.
        const tip = new three.Vector3(x, y, z).addScaledVector(along(mount.rotation), LENGTH[mount.kind] * mount.scale);
        expect(Math.min(y, tip.y)).toBeGreaterThan(0.1);
      }
    }
  });

  it("sheathes a carried sword point-down along its scabbard, and slings the long arms across the back", () => {
    const sword = carry(["bow", "sword"])[1];
    const sheath = new three.Vector3(0, -1, 0).applyEuler(new three.Euler(...SCABBARD.rotation));
    expect(along(sword.rotation).angleTo(sheath)).toBeLessThan(1e-6);
    const [spear, staff] = carry(["sword", "spear", "staff"]).slice(1);
    // Behind the body, tips over opposite shoulders.
    expect(spear.position[2]).toBeLessThan(-0.4);
    expect(along(spear.rotation).x).toBeGreaterThan(0.3);
    expect(along(staff.rotation).x).toBeLessThan(-0.3);
  });

  it("wears a belt, a strap and a scabbard only when there is something to hold", () => {
    expect(gearFor([])).toEqual({ belt: false, strap: false, scabbard: false });
    expect(gearFor(["bow"])).toEqual({ belt: false, strap: false, scabbard: false });
    // Holding the sword: an empty scabbard on the belt.
    expect(gearFor(["sword"])).toEqual({ belt: true, strap: false, scabbard: true });
    expect(gearFor(["hammer", "shield"])).toEqual({ belt: true, strap: true, scabbard: false });
    expect(gearFor(["bow", "hammer"])).toEqual({ belt: true, strap: false, scabbard: false });
  });
});

describe("the viewer's place", () => {
  const evenly = (count: number) => Array.from({ length: count }, (_, index) => Math.PI / 2 + (index / count) * Math.PI * 2);

  it("sets the seat of honour in a gap between members, toward the far side, facing the table", () => {
    for (const count of [3, 4, 5, 6]) {
      const angles = evenly(count);
      const spot = honorSeat(angles);
      expect(Math.hypot(spot.x, spot.z)).toBeCloseTo(HONOR_RADIUS);
      expect(spot.z).toBeLessThan(0);
      // Clear of every member's seat.
      for (const angle of angles) {
        expect(Math.hypot(spot.x - Math.cos(angle) * 3.05, spot.z - Math.sin(angle) * 3.05)).toBeGreaterThan(1.2);
      }
      // Facing the middle of the table.
      const facing = new three.Vector3(Math.sin(spot.yaw), 0, Math.cos(spot.yaw));
      expect(facing.dot(new three.Vector3(-spot.x, 0, -spot.z).normalize())).toBeCloseTo(1);
    }
  });

  it("prefers a real gap when members are not evenly spaced", () => {
    const spot = honorSeat([0, 0.5, 1.0, 1.5, 2.0]);
    const angle = Math.atan2(spot.z, spot.x);
    // The open side runs from 2.0 round to 2π; its middle is near −2.14.
    expect(angle).toBeCloseTo(Math.atan2(Math.sin(4.14), Math.cos(4.14)), 1);
  });

  it("raises the arena box at the head of the pitch, looking in", () => {
    expect(ARENA_BOX.z).toBeLessThan(-10);
    expect(ARENA_BOX.yaw).toBe(0);
  });
});
