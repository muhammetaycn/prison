import { COUNCIL_WEAPONS, type CouncilEvent } from "@/models/council";
import type { CouncilMode } from "@/models/options";
import type { Seat } from "./timeline";

export type CardTone = "round" | "out" | "win" | "weapon" | "info";

/** A broadcast-style title card for a big moment; everything on it comes from the event itself. */
export interface TitleCard {
  key: string;
  label: string;
  title: string;
  /** Who it is about, in its seat colour. */
  seat: Seat | null;
  tone: CardTone;
}

/**
 * The card for the moment at `index`, or null. A new round, an elimination, the result, a final-check selection and
 * each weapon award get one; ordinary talk does not.
 */
export function titleCardFor(events: CouncilEvent[], index: number, mode: CouncilMode, seatOf: (id: string | null | undefined) => Seat | undefined): TitleCard | null {
  const event = events[index];
  if (!event || event.kind === "thinking") return null;
  const seat = seatOf(event.actorId) ?? null;
  const fight = mode === "competition";
  const key = `${event.seq}`;
  switch (event.kind) {
    case "eliminated":
      return { key, label: fight ? "Elendi" : "Ayrıldı", title: seat?.label ?? "", seat, tone: "out" };
    case "winner":
      return { key, label: fight ? "Kazanan" : "Uzlaşma", title: seat?.label ?? "", seat, tone: "win" };
    case "finalist":
      return { key, label: "Son denetime seçildi", title: seat?.label ?? "", seat, tone: "info" };
    case "weapon":
      return event.dimension ? { key, label: "Yeni silah", title: COUNCIL_WEAPONS[event.dimension].name, seat, tone: "weapon" } : null;
  }
  // The first spoken moment of a new round announces the round.
  let previous = index - 1;
  while (previous >= 0 && events[previous].kind === "thinking") previous--;
  if (event.round > 0 && previous >= 0 && events[previous].round < event.round) {
    return { key: `round-${event.round}`, label: fight ? "Kapışma" : "Masa", title: `${event.round}. TUR`, seat: null, tone: "round" };
  }
  return null;
}
