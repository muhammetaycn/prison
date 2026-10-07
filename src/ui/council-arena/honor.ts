/**
 * The viewer's place on the stage. The council works for the person who asked; the stage shows it by giving them a
 * seat: at the table, a seat of honour just outside the ring of members; in the arena, a box with a canopy at the
 * head of the pitch, behind the jury bench, looking in. Members present toward it and the finished text is carried
 * to it. Presentation only: it never changes an event, an answer, a vote or a score.
 */

export interface Spot {
  x: number;
  z: number;
  /** Facing (radians about y, 0 = +z), turned toward the middle of the stage. */
  yaw: number;
}

/** How far out from the table centre the seat of honour stands (members sit at 3.05). */
export const HONOR_RADIUS = 4.45;

/** The arena box: centred behind the jury bench, raised so it shows over the bench, facing the pitch. */
export const ARENA_BOX = { x: 0, z: -12.4, yaw: 0, rise: 0.8 } as const;

const facingCentre = (x: number, z: number) => Math.atan2(-x, -z);

/**
 * Where the seat of honour goes at the table: in the widest gap between the members' seats (their polar angles,
 * x = cos, z = sin), the one nearest the far side (−z), so the usual view looks across the table at it.
 */
export function honorSeat(seatAngles: readonly number[], radius = HONOR_RADIUS): Spot {
  const far = -Math.PI / 2;
  const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
  if (seatAngles.length === 0) return { x: Math.cos(far) * radius, z: Math.sin(far) * radius, yaw: facingCentre(Math.cos(far) * radius, Math.sin(far) * radius) };
  const sorted = [...seatAngles].map(wrap).sort((a, b) => a - b);
  let best = { mid: far, gap: -1, distance: Infinity };
  sorted.forEach((angle, index) => {
    const next = index + 1 < sorted.length ? sorted[index + 1] : sorted[0] + Math.PI * 2;
    const gap = next - angle;
    const mid = wrap(angle + gap / 2);
    const distance = Math.abs(wrap(mid - far));
    // Wider gaps win; among equal gaps (the usual even spacing) the one nearest the far side.
    if (gap > best.gap + 1e-6 || (Math.abs(gap - best.gap) <= 1e-6 && distance < best.distance)) best = { mid, gap, distance };
  });
  const x = Math.cos(best.mid) * radius;
  const z = Math.sin(best.mid) * radius;
  return { x, z, yaw: facingCentre(x, z) };
}
