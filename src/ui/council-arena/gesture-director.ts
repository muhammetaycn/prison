import type { CouncilEvent } from "@/models/council";
import {
  chooseNextGesture, getGesture, sampleGesture,
  type GestureCategory, type GestureId, type GesturePose, type GestureSampleOptions,
} from "./gesture-library";

interface ActorMotion {
  previousAutomatic: GestureId | null;
  lastEvent: string | null;
  pendingManual: GestureId | null;
  pendingAutomatic: GestureId | null;
  active: { id: GestureId; source: "manual" | "automatic"; startedAt: number } | null;
  lastPoseAt: number | null;
  wasBlocked: boolean;
}

export interface DirectedGestureOptions extends GestureSampleOptions {
  /** Critical movement owns the rig: attack, fall, equipment pickup or bench walk. */
  blocked?: boolean;
}

const EVENT_CATEGORIES: Partial<Record<CouncilEvent["kind"], GestureCategory>> = {
  seat: "greeting", replace: "greeting", thinking: "thinking", research: "thinking",
  proposal: "presenting", revision: "presenting", draft: "presenting",
  approval: "reaction", objection: "reaction",
};

/**
 * Cosmetic one-shot animation arbitration, isolated from the council's state.
 * Each actor keeps at most one queued request. Manual clips take priority;
 * critical movement can defer them without delaying the actual council.
 */
export class GestureDirector {
  private actors = new Map<string, ActorMotion>();
  private disposed = false;

  constructor(actorIds: readonly string[] = []) {
    this.setSeats(actorIds);
  }

  setSeats(actorIds: readonly string[]): void {
    if (this.disposed) return;
    const retained = new Set(actorIds.filter((id) => id.length > 0));
    for (const id of this.actors.keys()) if (!retained.has(id)) this.actors.delete(id);
    for (const id of retained) {
      if (!this.actors.has(id)) this.actors.set(id, {
        previousAutomatic: null, lastEvent: null, pendingManual: null, pendingAutomatic: null,
        active: null, lastPoseAt: null, wasBlocked: false,
      });
    }
  }

  /** IDs are explicit library clips, not code or instructions to the AI provider. */
  request(actorId: string, id: string): boolean {
    const actor = this.actors.get(actorId);
    const gesture = getGesture(id);
    if (this.disposed || !actor || !gesture) return false;
    actor.pendingManual = gesture.id;
    actor.pendingAutomatic = null;
    actor.active = null;
    return true;
  }

  onEvent(event: CouncilEvent): void {
    if (this.disposed) return;
    const actor = this.actors.get(event.actorId);
    const category = EVENT_CATEGORIES[event.kind];
    if (!actor || !category) return;
    const key = `${event.seq}|${event.round}|${event.kind}|${event.at}`;
    if (actor.lastEvent === key) return;
    actor.lastEvent = key;
    // Do not queue an old vote/explanation gesture behind a viewer's motion.
    if (actor.pendingManual || actor.active?.source === "manual") return;
    actor.pendingAutomatic = chooseNextGesture(actor.previousAutomatic, { seat: event.actorId, event: key, category });
    actor.active = null;
  }

  pose(actorId: string, nowSeconds: number, options: DirectedGestureOptions = {}): GesturePose | null {
    const actor = this.actors.get(actorId);
    if (this.disposed || !actor || !Number.isFinite(nowSeconds)) return null;
    const previousTime = actor.lastPoseAt;
    const delta = previousTime === null ? 0 : Math.max(0, nowSeconds - previousTime);
    actor.lastPoseAt = nowSeconds;
    if (options.reducedMotion) {
      actor.active = null;
      actor.pendingManual = null;
      actor.pendingAutomatic = null;
      actor.wasBlocked = false;
      return null;
    }
    if (options.blocked) {
      if (actor.active?.source === "manual") actor.active.startedAt += delta;
      else actor.active = null;
      actor.pendingAutomatic = null;
      actor.wasBlocked = true;
      return null;
    }
    if (actor.active && actor.wasBlocked) actor.active.startedAt += delta;
    actor.wasBlocked = false;
    // A rewound clock cannot create a negative or unbounded pose.
    if (actor.active && nowSeconds < actor.active.startedAt) actor.active.startedAt = nowSeconds;
    if (!actor.active) {
      const manual = actor.pendingManual;
      const id = manual ?? actor.pendingAutomatic;
      if (!id) return null;
      actor.pendingManual = null;
      actor.pendingAutomatic = null;
      actor.active = { id, source: manual ? "manual" : "automatic", startedAt: nowSeconds };
      if (!manual) actor.previousAutomatic = id;
    }
    const elapsed = nowSeconds - actor.active.startedAt;
    const gesture = getGesture(actor.active.id)!;
    if (elapsed >= gesture.duration) { actor.active = null; return null; }
    return sampleGesture(gesture.id, elapsed, options);
  }

  dispose(): void {
    this.actors.clear();
    this.disposed = true;
  }
}
