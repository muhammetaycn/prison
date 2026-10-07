import { COUNCIL_EVENT_LIMIT, type CouncilEvent } from "./council";

/** Public result events that finish an actor's pending wait; no private reasoning is reconstructed. */
const COMPLETES_THINKING = new Set<CouncilEvent["kind"]>([
  "research", "proposal", "critique", "revision", "draft", "approval", "objection", "failed", "abstained", "winner", "finalist", "eliminated",
]);

/**
 * Bound a real timeline without renumbering or synthesizing events. Keep seat identities and durable
 * scene decisions, discard finished waits first, then expire the oldest remaining editorial events.
 * Valid councils have at most six seats, leaving ample room for these anchors at the normal limit.
 */
export function compactCouncilEvents(events: CouncilEvent[], limit = COUNCIL_EVENT_LIMIT): CouncilEvent[] {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Council event limit must be a positive integer");
  if (events.length <= limit) return events;
  const seats = new Map<string, number>();
  const durable = new Map<string, number>();
  const pending = new Map<string, number>();
  const completedThinking: number[] = [];
  events.forEach((event, index) => {
    if (event.kind === "seat" && !seats.has(event.actorId)) seats.set(event.actorId, index);
    if (event.kind === "thinking") {
      const superseded = pending.get(event.actorId);
      if (superseded !== undefined) completedThinking.push(superseded);
      pending.set(event.actorId, index);
    } else if (COMPLETES_THINKING.has(event.kind)) {
      const completed = pending.get(event.actorId);
      if (completed !== undefined) completedThinking.push(completed);
      pending.delete(event.actorId);
    }
    if (event.kind === "eliminated" || event.kind === "replace") durable.set(`${event.kind}:${event.actorId}`, index);
    if (event.kind === "weapon" && event.dimension) durable.set(`weapon:${event.dimension}`, index);
    if (event.kind === "memory" || event.kind === "winner" || event.kind === "finalist") durable.set(event.kind, index);
  });
  // At unusually small/custom limits, seats take precedence, followed by the latest actual event.
  const protectedIndexes = new Set<number>();
  for (const index of seats.values()) if (protectedIndexes.size < limit) protectedIndexes.add(index);
  if (protectedIndexes.size < limit) protectedIndexes.add(events.length - 1);
  for (const index of [...durable.values(), ...pending.values()].sort((a, b) => b - a)) {
    if (protectedIndexes.size >= limit) break;
    protectedIndexes.add(index);
  }
  let excess = events.length - limit;
  const removed = new Set<number>();
  const remove = (index: number) => {
    if (excess > 0 && !protectedIndexes.has(index) && !removed.has(index)) {
      removed.add(index);
      excess--;
    }
  };
  for (const index of completedThinking.sort((a, b) => a - b)) remove(index);
  for (let index = 0; index < events.length && excess > 0; index++) remove(index);
  return events.filter((_, index) => !removed.has(index));
}

/** Stable sequence cursor: a removed moment resolves to the nearest earlier retained real event. */
export function councilEventIndexAtSeq(events: CouncilEvent[], seq: number): number {
  for (let index = events.length - 1; index >= 0; index--) if (events[index].seq <= seq) return index;
  return -1;
}

export function nextCouncilEventSeq(events: CouncilEvent[], seq: number): number {
  return events.find((event) => event.seq > seq)?.seq ?? seq;
}

/** Convert an explicit transcript/control jump into a stable identity, including the replay start. */
export function councilEventSeqAtIndex(events: CouncilEvent[], index: number): number {
  return index < 0 || !events.length ? -1 : events[Math.min(index, events.length - 1)].seq;
}

/** Compaction may shift positions; animate only a new next retained event, never the same event twice. */
export function isNextCouncilEvent(events: CouncilEvent[], previousSeq: number, currentSeq: number): boolean {
  return currentSeq > previousSeq && nextCouncilEventSeq(events, previousSeq) === currentSeq;
}
