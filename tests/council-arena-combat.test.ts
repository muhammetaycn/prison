import * as three from "three";
import { describe, expect, it } from "vitest";
import type { CouncilDimension, CouncilEvent } from "@/models/council";
import { ArenaScene } from "@/ui/council-arena/scene";
import { SPEAKING_GREEN, stateAt, type Seat } from "@/ui/council-arena/timeline";
import type { Weather } from "@/ui/council-arena/weather";

interface Bird {
  root: three.Group;
  hand: three.Group;
  leftArm: three.Group;
  rightArm: three.Group;
  actions: Array<{ kind: string; style?: string; start: number; duration: number }>;
  hitFlash: number;
  umbrella: three.Group | null;
  umbrellaOpen: number;
}

interface Stage {
  avatars: Map<string, Bird>;
  weapons: Map<CouncilDimension, { dimension: CouncilDimension; mesh: three.Group; holder: Bird | null; spot: three.Vector3; drop: { from: three.Vector3 | null; lift: number } | null; landed: boolean }>;
  effects: Array<{ update: (now: number) => boolean }>;
  sync: (state: ReturnType<typeof stateAt>, event: CouncilEvent | null, animate: boolean) => void;
  setWeather: (weather: Weather, animate: boolean) => void;
  updateAvatar: (avatar: Bird, delta: number, now: number) => void;
  attach: (weapon: unknown, holder: Bird) => void;
}

const seats: Seat[] = [
  { id: "a", index: 0, model: "acme/a", label: "a", role: "r", color: "#8b5cf6" },
  { id: "b", index: 1, model: "acme/b", label: "b", role: "r", color: "#3b82f6" },
];
let seq = 0;
const event = (kind: CouncilEvent["kind"], extra: Partial<CouncilEvent> = {}): CouncilEvent =>
  ({ seq: seq++, at: "2026-10-05T21:00:00Z", round: 1, kind, actorId: "a", model: null, targetId: null, dimension: null, score: null, text: kind, ...extra });

function stage(reducedMotion = false): Stage {
  let time = 0;
  const scene = Object.assign(Object.create(ArenaScene.prototype), {
    three, options: { mode: "competition", reducedMotion }, scene: new three.Scene(), avatars: new Map(), weapons: new Map(),
    white: new three.Color("#eaf2ff"), green: new three.Color(SPEAKING_GREEN), grey: new three.Color("#555a63"),
    state: null, addressee: null, podium: null, papers: [], disposables: [], effects: [], azimuth: 0.35, speed: 1, environment: null, parts: null,
    clock: { getElapsed: () => time },
  }) as Stage & { setSeats: (seats: Seat[]) => void; clockAt: (t: number) => void };
  scene.setSeats(seats);
  (scene as unknown as { clockAt: (t: number) => void }).clockAt = (t: number) => { time = t; };
  return scene;
}

function arm(scene: Stage, holder: Bird, dimension: CouncilDimension) {
  const weapon = { dimension, mesh: new three.Group(), holder: null as Bird | null, spot: new three.Vector3(1.9, 0, 0), drop: null as { from: three.Vector3 | null; lift: number } | null, landed: true };
  scene.weapons.set(dimension, weapon);
  scene.attach(weapon, holder);
  return weapon;
}

describe("arena combat", () => {
  it("fights with the weapon in its wing, or pecks with its beak when it has none", () => {
    const scene = stage();
    const a = scene.avatars.get("a")!;
    const critique = event("critique", { targetId: "b", score: 0.4 });
    scene.sync(stateAt([critique], 0), critique, true);
    expect(a.actions.at(-1)).toMatchObject({ kind: "attack", style: "peck" });

    const armed = stage();
    const fighter = armed.avatars.get("a")!;
    arm(armed, fighter, "intent_alignment");
    // The fighter won the weapon earlier in the round, then attacks with it.
    const events = [event("weapon", { dimension: "intent_alignment" }), event("critique", { targetId: "b", score: 0.4 })];
    armed.sync(stateAt(events, 1), events[1], true);
    expect(fighter.actions.at(-1)?.kind).toMatch(/attack|shoot/);
    expect(fighter.actions.at(-1)?.style).not.toBe("peck");
  });

  it("looses an arrow from a bow that lands on the target", () => {
    const scene = stage();
    const a = scene.avatars.get("a")!;
    const b = scene.avatars.get("b")!;
    const bow = arm(scene, a, "context_completeness");
    expect(bow).toBeTruthy();
    // Make sure the weapon in hand is a bow for this test, whatever the dimension maps to.
    (scene as unknown as { attackStyle: () => string }).attackStyle = () => "bow";
    const shot = event("critique", { targetId: "b", score: 0.5 });
    scene.sync(stateAt([shot], 0), shot, true);
    expect(a.actions.at(-1)).toMatchObject({ kind: "shoot", style: "bow" });
    const before = scene.effects.length;
    for (let t = 0; t <= 0.6; t += 0.05) scene.updateAvatar(a, 0.05, t);
    expect(scene.effects.length).toBeGreaterThan(before);
    for (const effect of [...scene.effects]) effect.update(2);
    expect(b.hitFlash).toBe(1);
    expect(b.actions.some((action) => action.kind === "knock")).toBe(true);
  });

  it("lets the jury's score decide the blow: strong work side-steps, weak work is knocked back hard", () => {
    const strike = (score: number) => {
      const scene = stage();
      const b = scene.avatars.get("b")! as Bird & { actions: Array<{ kind: string; push?: three.Vector3 }> };
      const hit = event("critique", { targetId: "b", score });
      scene.sync(stateAt([hit], 0), hit, true);
      const a = scene.avatars.get("a")!;
      for (let t = 0; t <= 0.7; t += 0.05) scene.updateAvatar(a, 0.05, t);
      return b;
    };
    const strong = strike(0.92);
    expect(strong.actions[0]?.kind).toBe("dodge");
    expect(strong.hitFlash).toBe(0);
    const weak = strike(0.2);
    const middling = strike(0.6);
    expect(weak.actions[0]?.kind).toBe("knock");
    expect(middling.actions[0]?.kind).toBe("knock");
    expect(weak.actions[0].push!.length()).toBeGreaterThan(middling.actions[0].push!.length());
  });

  it("takes a weapon back up out of its old holder's wing before the new owner picks it up", () => {
    const scene = stage();
    const a = scene.avatars.get("a")!;
    const b = scene.avatars.get("b")!;
    const weapon = arm(scene, a, "intent_alignment");
    const awarded = event("weapon", { actorId: "b", dimension: "intent_alignment" });
    scene.sync(stateAt([awarded], 0), awarded, true);
    expect(weapon.holder).toBeNull();
    expect(weapon.drop?.from).not.toBeNull();
    expect(weapon.drop?.lift).toBeGreaterThan(0);
    const pickup = b.actions.find((action) => action.kind === "pickup")!;
    expect(pickup.start).toBeGreaterThan(0.45);
    expect(a.actions.some((action) => action.kind === "flinch")).toBe(true);
  });
});

describe("arena bench", () => {
  it("has a bird already on the bench comfort the next one to sit down", () => {
    const scene = stage();
    const a = scene.avatars.get("a")!;
    const b = scene.avatars.get("b")!;
    const first = event("eliminated", { actorId: "a" });
    scene.sync(stateAt([first], 0), first, false);
    const second = event("eliminated", { actorId: "b" });
    scene.sync(stateAt([first, second], 1), second, true);
    const walk = b.actions.find((action) => action.kind === "toBench")!;
    for (let t = 0; t <= walk.start + walk.duration; t += 0.05) scene.updateAvatar(b, 0.05, t);
    expect(a.actions.some((action) => action.kind === "pat")).toBe(true);
  });
});

describe("arena weather on the birds", () => {
  const rainy: Weather = { kind: "rainy", reason: "İtirazlar arttı", strain: 0 };
  const sunny: Weather = { kind: "sunny", reason: "Onaylar geliyor", strain: 0 };
  const heat: Weather = { kind: "heat", reason: "Sistem zorlanıyor", strain: 1 };

  it("puts up umbrellas in the rain and folds them away after", () => {
    const scene = stage(true);
    const a = scene.avatars.get("a")!;
    scene.setWeather(rainy, false);
    scene.updateAvatar(a, 0.016, 1);
    expect(a.umbrellaOpen).toBe(1);
    expect(a.umbrella?.visible).toBe(true);
    expect(a.leftArm.rotation.x).toBeLessThan(-2);
    scene.setWeather(sunny, false);
    scene.updateAvatar(a, 0.016, 2);
    expect(a.umbrellaOpen).toBe(0);
    expect(a.umbrella?.visible).toBe(false);
  });

  it("hits every bird at once when a heat wave arrives, once", () => {
    const scene = stage();
    scene.setWeather(sunny, true);
    scene.setWeather(heat, true);
    for (const bird of scene.avatars.values()) {
      expect(bird.hitFlash).toBeGreaterThan(0.5);
      expect(bird.actions.filter((action) => action.kind === "flinch")).toHaveLength(1);
    }
    scene.setWeather(heat, true);
    for (const bird of scene.avatars.values()) expect(bird.actions.filter((action) => action.kind === "flinch")).toHaveLength(1);
  });
});
