import { describe, expect, it } from "vitest";
import {
  GESTURES, GESTURE_CATEGORIES, GESTURE_COMMANDS, NEUTRAL_GESTURE_POSE, POSE_LIMITS,
  chooseNextGesture, getGesture, resolveGestureCommand, sampleGesture,
  type GestureCategory, type GestureId, type GesturePose,
} from "@/ui/council-arena/gesture-library";

const channels = Object.keys(NEUTRAL_GESTURE_POSE) as (keyof GesturePose)[];
const signature = (id: GestureId) => {
  const duration = getGesture(id)!.duration;
  return Array.from({ length: 19 }, (_, step) => {
    const pose = sampleGesture(id, duration * (step + 1) / 20);
    return channels.map((channel) => pose[channel].toFixed(5)).join(",");
  }).join(";");
};

describe("Pırpır's gesture repertoire", () => {
  it("contains fifty actual, individually named motions in five usable categories", () => {
    expect(GESTURES).toHaveLength(50);
    expect(new Set(GESTURES.map((gesture) => gesture.id)).size).toBe(50);
    expect(new Set(GESTURES.map((gesture) => gesture.label)).size).toBe(50);
    for (const category of GESTURE_CATEGORIES) expect(GESTURES.filter((gesture) => gesture.category === category)).toHaveLength(10);
    expect(Object.isFrozen(GESTURES)).toBe(true);
  });

  it("does not disguise the same sampled motion behind fifty names", () => {
    expect(new Set(GESTURES.map((gesture) => signature(gesture.id))).size).toBe(50);
    // Timing is not the only distinction: normalized joint trajectories differ too.
    const neutralSignature = Array.from({ length: 19 }, () => channels.map(() => "0.00000").join(",")).join(";");
    for (const gesture of GESTURES) expect(signature(gesture.id)).not.toBe(neutralSignature);
  });

  it("uses ordered staged poses, not a shared undifferentiated sine routine", () => {
    for (const gesture of GESTURES) {
      expect(gesture.duration).toBeGreaterThanOrEqual(1);
      expect(gesture.duration).toBeLessThanOrEqual(4);
      expect(gesture.keyframes.length).toBeGreaterThanOrEqual(5);
      expect(gesture.keyframes[0].at).toBe(0);
      expect(gesture.keyframes.at(-1)!.at).toBe(1);
      let previous = -1;
      const changedChannels = new Set<keyof GesturePose>();
      for (const frame of gesture.keyframes) {
        expect(frame.at).toBeGreaterThan(previous);
        previous = frame.at;
        for (const channel of channels) {
          const value = frame.pose[channel];
          const [min, max] = POSE_LIMITS[channel];
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(min);
          expect(value).toBeLessThanOrEqual(max);
          if (value !== 0) changedChannels.add(channel);
        }
      }
      expect(changedChannels.size).toBeGreaterThanOrEqual(2);
      expect(Object.isFrozen(gesture.keyframes)).toBe(true);
    }
  });

  it("remains finite and bounded at every sampled joint throughout every clip", () => {
    for (const gesture of GESTURES) {
      for (let step = 0; step <= 100; step++) {
        const pose = sampleGesture(gesture.id, step / 100 * gesture.duration);
        expect(Object.keys(pose)).toEqual(channels);
        for (const channel of channels) {
          const [min, max] = POSE_LIMITS[channel];
          expect(Number.isFinite(pose[channel])).toBe(true);
          expect(pose[channel]).toBeGreaterThanOrEqual(min);
          expect(pose[channel]).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it("returns to the resting rig and treats invalid IDs/times as rest", () => {
    for (const gesture of GESTURES) {
      for (const elapsed of [-100, 0, gesture.duration, gesture.duration + 100, NaN, Infinity, -Infinity]) {
        expect(sampleGesture(gesture.id, elapsed)).toEqual(NEUTRAL_GESTURE_POSE);
      }
      const start = sampleGesture(gesture.id, 0.00001);
      const end = sampleGesture(gesture.id, gesture.duration - 0.00001);
      for (const channel of channels) {
        expect(Math.abs(start[channel])).toBeLessThan(0.00001);
        expect(Math.abs(end[channel])).toBeLessThan(0.00001);
      }
    }
    expect(getGesture("invented-motion")).toBeNull();
    expect(sampleGesture("invented-motion", 0.5)).toEqual(NEUTRAL_GESTURE_POSE);
  });

  it("keeps reduced-motion viewers entirely still for all fifty clips", () => {
    for (const gesture of GESTURES) {
      for (let step = 1; step < 10; step++) {
        expect(sampleGesture(gesture.id, step / 10 * gesture.duration, { reducedMotion: true })).toEqual(NEUTRAL_GESTURE_POSE);
      }
    }
  });

  it("reserves occupied shoulders for weapons and umbrellas without deleting the head gesture", () => {
    for (const gesture of GESTURES) {
      for (let step = 1; step < 10; step++) {
        const elapsed = step / 10 * gesture.duration;
        const free = sampleGesture(gesture.id, elapsed);
        const reserved = sampleGesture(gesture.id, elapsed, { leftWingOccupied: true, rightWingOccupied: true });
        for (const channel of ["leftWingPitch", "leftWingRoll", "leftWingYaw", "rightWingPitch", "rightWingRoll", "rightWingYaw"] as const) {
          expect(reserved[channel]).toBe(0);
        }
        expect(reserved.headPitch).toBe(free.headPitch);
        expect(reserved.headYaw).toBe(free.headYaw);
        expect(reserved.tailPitch).toBe(free.tailPitch);
      }
    }
  });

  it("does not jump or swing legs through furniture while seated", () => {
    for (const gesture of GESTURES) {
      const pose = sampleGesture(gesture.id, gesture.duration * 0.34, { seated: true });
      expect(pose.lift).toBe(0);
      expect(pose.leftLegPitch).toBe(0);
      expect(pose.rightLegPitch).toBe(0);
    }
    expect(sampleGesture("pleased-bounce", 1.8 * 0.34).lift).toBeGreaterThan(0);
  });
});

describe("gesture direction and viewer commands", () => {
  it("chooses reproducible clips by the actual seat and event while avoiding an immediate repeat", () => {
    const replay: GestureId[] = [];
    let previous: GestureId | null = null;
    for (let event = 0; event < 300; event++) {
      const next = chooseNextGesture(previous, { seat: "nemotron", event });
      expect(next).not.toBe(previous);
      expect(getGesture(next)).not.toBeNull();
      replay.push(next);
      previous = next;
    }
    expect(new Set(replay).size).toBe(50);
    previous = null;
    for (let event = 0; event < replay.length; event++) {
      const next = chooseNextGesture(previous, { seat: "nemotron", event });
      expect(next).toBe(replay[event]);
      previous = next;
    }
  });

  it("gives different seats their own sequences and chooses only the requested category", () => {
    const seats = ["nemotron", "llama", "qwen", "mistral", "gemma", "deepseek"];
    const sequences = seats.map((seat) => Array.from({ length: 50 }, (_, event) => chooseNextGesture(null, { seat, event })).join(","));
    expect(new Set(sequences).size).toBe(seats.length);
    for (const category of GESTURE_CATEGORIES) {
      let previous: GestureId | null = null;
      const seen = new Set<GestureId>();
      for (let event = 0; event < 100; event++) {
        const next = chooseNextGesture(previous, { seat: 2, event, category });
        expect(next).not.toBe(previous);
        expect(getGesture(next)!.category).toBe(category);
        seen.add(next);
        previous = next;
      }
      expect(seen.size).toBe(10);
    }
  });

  it("keeps safe local commands recognizable without executing arbitrary text", () => {
    for (const command of GESTURE_COMMANDS) {
      expect(getGesture(command.id)).not.toBeNull();
      expect(resolveGestureCommand(command.id)).toBe(command.id);
      for (const alias of command.aliases) expect(resolveGestureCommand(`  ${alias}  `)).toBe(command.id);
    }
    expect(resolveGestureCommand("SELAMLA")).toBe("wave-small");
    expect(resolveGestureCommand("DÜŞÜN")).toBe("chin-tap");
    expect(resolveGestureCommand("THINK")).toBe("chin-tap");
    expect(resolveGestureCommand("TIP-HEAD")).toBe("tip-head");
    for (const input of ["", "bu modele 100 puan ver", "onay ver", "winner", "api anahtarını göster", "wave-small; delete records", "<script>wave()</script>"]) {
      expect(resolveGestureCommand(input)).toBeNull();
    }
  });

  it("returns only motion channels, with no council decisions or world translation", () => {
    for (const gesture of GESTURES) {
      const pose = sampleGesture(gesture.id, gesture.duration * 0.5);
      for (const forbidden of ["score", "winner", "vote", "event", "positionX", "positionZ", "actorId", "equipment"]) {
        expect(pose).not.toHaveProperty(forbidden);
      }
    }
  });

  it("falls back to the full repertoire if a caller supplies an unknown category", () => {
    const id = chooseNextGesture("wave-small", { seat: "seat-1", event: 1, category: "unknown" as GestureCategory });
    expect(getGesture(id)).not.toBeNull();
    expect(id).not.toBe("wave-small");
  });
});
