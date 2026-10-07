import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { GestureDirector } from "@/ui/council-arena/gesture-director";
import {
  chooseNextGesture, getGesture, NEUTRAL_GESTURE_POSE, sampleGesture,
  type GestureCategory, type GestureId, type GesturePose,
} from "@/ui/council-arena/gesture-library";

const event = (kind: CouncilEvent["kind"], seq = 0, actorId = "seat-1"): CouncilEvent => ({
  seq, round: 1, at: `2026-10-06T12:00:${String(seq).padStart(2, "0")}Z`, kind,
  actorId, model: "test/model", targetId: null, dimension: null, score: null, text: "Recorded public event",
});
const key = (value: CouncilEvent) => `${value.seq}|${value.round}|${value.kind}|${value.at}`;
const closePose = (actual: GesturePose | null, expected: GesturePose) => {
  expect(actual).not.toBeNull();
  for (const channel of Object.keys(expected) as (keyof GesturePose)[]) expect(actual![channel]).toBeCloseTo(expected[channel], 7);
};

describe("optional rig gesture director", () => {
  it("accepts only registered actor IDs and actual library gestures", () => {
    const director = new GestureDirector(["seat-1"]);
    expect(director.request("unknown", "wave-small")).toBe(false);
    expect(director.request("seat-1", "score=100")).toBe(false);
    expect(director.request("seat-1", "wave-small")).toBe(true);
    expect(director.pose("seat-1", 0)).toEqual(NEUTRAL_GESTURE_POSE);
    closePose(director.pose("seat-1", 0.5), sampleGesture("wave-small", 0.5));
    expect(director.pose("unknown", 0.5)).toBeNull();
  });

  it("drops removed seats while preserving a retained seat's active clip", () => {
    const director = new GestureDirector(["seat-1", "seat-2"]);
    director.request("seat-1", "wave-small");
    director.request("seat-2", "stretch-up");
    director.pose("seat-1", 0);
    director.setSeats(["seat-1", "seat-3", "seat-3", ""]);
    expect(director.request("seat-2", "wave-small")).toBe(false);
    expect(director.pose("seat-2", 1)).toBeNull();
    closePose(director.pose("seat-1", 0.5), sampleGesture("wave-small", 0.5));
    expect(director.request("seat-3", "wave-small")).toBe(true);
    expect(director.request("", "wave-small")).toBe(false);
  });

  it("uses categories from actual events without rewriting the event or a result", () => {
    const mappings: Array<[CouncilEvent["kind"], GestureCategory]> = [
      ["seat", "greeting"], ["replace", "greeting"], ["thinking", "thinking"], ["research", "thinking"],
      ["proposal", "presenting"], ["revision", "presenting"], ["draft", "presenting"],
      ["approval", "reaction"], ["objection", "reaction"],
    ];
    for (const [kind, category] of mappings) {
      const director = new GestureDirector(["seat-1"]);
      const record = Object.freeze(event(kind));
      const before = JSON.stringify(record);
      const id = chooseNextGesture(null, { seat: record.actorId, event: key(record), category });
      director.onEvent(record);
      director.pose("seat-1", 0);
      closePose(director.pose("seat-1", 0.5), sampleGesture(id, 0.5));
      expect(JSON.stringify(record)).toBe(before);
    }
    const director = new GestureDirector(["seat-1"]);
    for (const kind of ["winner", "finalist", "weapon", "eliminated", "failed", "abstained", "memory", "critique"] as const) {
      director.onEvent(event(kind));
      expect(director.pose("seat-1", 0.5)).toBeNull();
    }
  });

  it("does not restart a clip for an identical poll of the same actual event", () => {
    const director = new GestureDirector(["seat-1"]);
    const record = event("proposal");
    const id = chooseNextGesture(null, { seat: "seat-1", event: key(record), category: "presenting" });
    director.onEvent(record);
    director.pose("seat-1", 0);
    director.onEvent({ ...record });
    closePose(director.pose("seat-1", 0.5), sampleGesture(id, 0.5));
    director.pose("seat-1", getGesture(id)!.duration);
    director.onEvent({ ...record });
    expect(director.pose("seat-1", 10)).toBeNull();
  });

  it("never repeats the previous started automatic gesture, even if queued clips were dropped", () => {
    const director = new GestureDirector(["seat-1"]);
    let previous: GestureId | null = null;
    for (let sequence = 0; sequence < 40; sequence++) {
      const record = event("research", sequence);
      const id = chooseNextGesture(previous, { seat: "seat-1", event: key(record), category: "thinking" });
      expect(id).not.toBe(previous);
      director.onEvent(record);
      director.pose("seat-1", sequence * 10);
      closePose(director.pose("seat-1", sequence * 10 + 0.5), sampleGesture(id, 0.5));
      previous = id;
    }
    const dropped = event("research", 100);
    director.onEvent(dropped);
    expect(director.pose("seat-1", 500, { blocked: true })).toBeNull();
    const following = event("research", 101);
    const id = chooseNextGesture(previous, { seat: "seat-1", event: key(following), category: "thinking" });
    director.onEvent(following);
    director.pose("seat-1", 501);
    closePose(director.pose("seat-1", 501.5), sampleGesture(id, 0.5));
  });

  it("defers a manual command until critical movement releases the rig", () => {
    const director = new GestureDirector(["seat-1"]);
    director.request("seat-1", "stretch-up");
    expect(director.pose("seat-1", 0, { blocked: true })).toBeNull();
    expect(director.pose("seat-1", 30, { blocked: true })).toBeNull();
    expect(director.pose("seat-1", 31)).toEqual(NEUTRAL_GESTURE_POSE);
    closePose(director.pose("seat-1", 31.5), sampleGesture("stretch-up", 0.5));
  });

  it("pauses an already-started manual clip while a critical movement owns the rig", () => {
    const director = new GestureDirector(["seat-1"]);
    director.request("seat-1", "stretch-up");
    director.pose("seat-1", 0);
    closePose(director.pose("seat-1", 0.3), sampleGesture("stretch-up", 0.3));
    expect(director.pose("seat-1", 10, { blocked: true })).toBeNull();
    closePose(director.pose("seat-1", 11), sampleGesture("stretch-up", 0.3));
    closePose(director.pose("seat-1", 11.2), sampleGesture("stretch-up", 0.5));
  });

  it("uses the newest manual command and does not replay obsolete automatic events afterwards", () => {
    const director = new GestureDirector(["seat-1"]);
    director.onEvent(event("proposal"));
    director.request("seat-1", "wave-small");
    director.request("seat-1", "chin-tap");
    director.onEvent(event("approval", 1));
    director.pose("seat-1", 0);
    closePose(director.pose("seat-1", 0.5), sampleGesture("chin-tap", 0.5));
    director.onEvent(event("objection", 2));
    expect(director.pose("seat-1", 10)).toBeNull();
    expect(director.pose("seat-1", 11)).toBeNull();
  });

  it("drops cosmetic automatic motions during attack/walk/fall without queuing a later false reaction", () => {
    const director = new GestureDirector(["seat-1"]);
    director.onEvent(event("approval"));
    expect(director.pose("seat-1", 0, { blocked: true })).toBeNull();
    expect(director.pose("seat-1", 1)).toBeNull();
    director.onEvent(event("draft", 1));
    director.pose("seat-1", 2);
    expect(director.pose("seat-1", 2.5, { blocked: true })).toBeNull();
    expect(director.pose("seat-1", 3)).toBeNull();
  });

  it("honors seated, occupied-wing and reduced-motion options", () => {
    const director = new GestureDirector(["seat-1"]);
    director.request("seat-1", "pleased-bounce");
    director.pose("seat-1", 0);
    const pose = director.pose("seat-1", 0.5, { seated: true, rightWingOccupied: true, leftWingOccupied: true })!;
    expect(pose.lift).toBe(0);
    expect(pose.leftLegPitch).toBe(0);
    expect(pose.rightLegPitch).toBe(0);
    expect(pose.leftWingPitch).toBe(0);
    expect(pose.rightWingRoll).toBe(0);
    expect(director.pose("seat-1", 0.6, { reducedMotion: true })).toBeNull();
    expect(director.pose("seat-1", 0.7)).toBeNull();
  });

  it("handles invalid clocks and releases all actors on disposal", () => {
    const director = new GestureDirector(["seat-1"]);
    director.request("seat-1", "wave-small");
    expect(director.pose("seat-1", NaN)).toBeNull();
    expect(director.pose("seat-1", Infinity)).toBeNull();
    expect(director.pose("seat-1", 0)).toEqual(NEUTRAL_GESTURE_POSE);
    director.dispose();
    director.dispose();
    expect(director.request("seat-1", "wave-small")).toBe(false);
    director.setSeats(["seat-2"]);
    director.onEvent(event("seat", 0, "seat-2"));
    expect(director.pose("seat-2", 1)).toBeNull();
  });
});
