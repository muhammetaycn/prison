import { describe, expect, it } from "vitest";
import type { CouncilEvent } from "@/models/council";
import { stateAt } from "@/ui/council-arena/timeline";
import { weatherAt } from "@/ui/council-arena/weather";

let seq = 0;
const event = (kind: CouncilEvent["kind"], extra: Partial<CouncilEvent> = {}): CouncilEvent =>
  ({ seq: seq++, at: "2026-10-05T21:00:00Z", round: 1, kind, actorId: "a", model: null, targetId: null, dimension: null, score: null, text: kind, ...extra });
const weather = (events: CouncilEvent[]) => weatherAt(events, events.length - 1, stateAt(events, events.length - 1));

describe("arena weather", () => {
  it("is cloudy before anything happens and while the table deliberates", () => {
    expect(weatherAt([], -1, stateAt([], -1)).kind).toBe("cloudy");
    expect(weather([event("seat"), event("research")])).toMatchObject({ kind: "cloudy", reason: "İnceleme sürüyor" });
  });

  it("rains when objections or low scores pile up", () => {
    const events = [event("seat"), event("objection"), event("objection"), event("critique", { targetId: "b", score: 0.3 })];
    expect(weather(events).kind).toBe("rainy");
  });

  it("turns sunny on approvals and stays sunny once there is a result", () => {
    expect(weather([event("seat"), event("approval"), event("approval")]).kind).toBe("sunny");
    expect(weather([event("seat"), event("objection"), event("objection"), event("objection"), event("winner")])).toMatchObject({ kind: "sunny" });
  });

  it("storms for an elimination", () => {
    expect(weather([event("seat"), event("critique", { targetId: "b", score: 0.6 }), event("eliminated", { actorId: "b" })]).kind).toBe("storm");
  });

  it("brings the heat only when the system itself struggles, and says so", () => {
    const strained = weather([event("seat"), event("failed"), event("replace", { actorId: "b" }), event("proposal")]);
    expect(strained.kind).toBe("heat");
    expect(strained.reason).toContain("Sistem");
    expect(strained.strain).toBeGreaterThan(0.5);
    // Low scores alone are the models' doing, not the system's: rain, not heat.
    const harsh = weather([event("seat"), ...Array.from({ length: 4 }, () => event("critique", { targetId: "b", score: 0.2 }))]);
    expect(harsh.kind).toBe("rainy");
    expect(harsh.strain).toBe(0);
  });

  it("forgets old trouble after enough has happened since", () => {
    const events = [event("seat"), event("failed"), event("abstained"), ...Array.from({ length: 10 }, () => event("proposal"))];
    expect(weather(events).kind).not.toBe("heat");
  });
});

describe("weather on stage", () => {
  it("wets the ground and spreads puddles in the rain, and dries them out afterwards", async () => {
    const three = await import("three");
    const { SkyFx } = await import("@/ui/council-arena/sky");
    const scene = new three.Scene();
    scene.background = new three.Color("#8fd3ff");
    scene.fog = new three.Fog("#8fd3ff", 28, 75);
    const lawn = new three.MeshToonMaterial({ color: "#ffffff" });
    const sky = new SkyFx(three, scene, null, false, [lawn]);
    const puddles = (sky as unknown as { puddles: import("three").InstancedMesh }).puddles;
    sky.set("rainy");
    for (let t = 0; t < 20; t += 0.1) sky.update(0.1, t);
    expect(puddles.visible).toBe(true);
    expect(lawn.color.r).toBeLessThan(0.8);
    expect((scene.background as import("three").Color).getHexString()).not.toBe("8fd3ff");
    sky.set("sunny");
    for (let t = 20; t < 120; t += 0.1) sky.update(0.1, t);
    expect(puddles.visible).toBe(false);
    expect(lawn.color.r).toBeGreaterThan(0.98);
  });

  it("flashes lightning only in a storm, and never under reduced motion", async () => {
    const three = await import("three");
    const { SkyFx } = await import("@/ui/council-arena/sky");
    const stormy = new SkyFx(three, new three.Scene(), null, false);
    stormy.set("storm");
    let flashed = false;
    for (let t = 0; t < 8; t += 0.05) { stormy.update(0.05, t); if (stormy.light.flash > 0.9) flashed = true; }
    expect(flashed).toBe(true);
    const calm = new SkyFx(three, new three.Scene(), null, true);
    calm.set("storm");
    for (let t = 0; t < 8; t += 0.05) { calm.update(0.05, t); expect(calm.light.flash).toBe(0); }
  });
});
