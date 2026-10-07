import type * as T from "three";
import { addOutlines, toon } from "./toon";
import { crowdProfile, nextCrowdReaction, type CrowdProfile, type CrowdReaction } from "./crowd-variety";

type Three = typeof T;

/** Tiered rows around the pitch: radius of each step's centre and the height of its seat. */
const ROWS = [
  { radius: 9.1, top: 0.36 },
  { radius: 9.9, top: 0.76 },
  { radius: 10.7, top: 1.16 },
] as const;
const STEP_DEPTH = 0.78;
/** The jury bench sits behind the pitch (−z); the stands leave that side open. */
const GAP_CENTRE = -Math.PI / 2;
const GAP_HALF = 0.66;
const SECTIONS = 5;
const AISLE = 0.09;
/** Roughly one fan per this much bench, with some seats left empty. */
const FAN_SPACING = 0.62;
const FILL = 0.66;

interface Fan {
  x: number;
  z: number;
  seat: number;
  /** Facing the pitch centre. */
  yaw: number;
  /** Polar angle around the pitch, for the stadium wave. */
  angle: number;
  phase: number;
  /** How strongly this fan reacts, so the crowd never moves in lockstep. */
  zeal: number;
  /** Smoothed head turn toward whoever has the floor. */
  look: number;
  /** Slot in the flag meshes for fans who bring a flag to the final, or -1. */
  flag: number;
  profile: CrowdProfile;
  reaction: CrowdReaction;
  reactionAge: number;
  celebrationCycle: number;
}

const yawToward = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(toX - fromX, toZ - fromZ);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Optional cartoon finish shared with the rest of the stage. */
export interface CrowdStyle {
  ramp?: T.Texture | null;
  ink?: T.Material | null;
}

/**
 * Pırpır spectators in stands around the fighting field. They are scenery: they never speak and carry no
 * content, but they react to what really happens on the pitch (a weapon drop, a hit, an elimination, the winner).
 */
export class Crowd {
  private readonly steps: T.InstancedMesh;
  private readonly bodies: T.InstancedMesh;
  private readonly heads: T.InstancedMesh;
  private readonly arms: T.InstancedMesh;
  private readonly beaks: T.InstancedMesh;
  private readonly eyes: T.InstancedMesh;
  private readonly crests: T.InstancedMesh;
  private readonly tails: T.InstancedMesh;
  /** Flags in the winner's colour, waved by every third fan once a winner stands. */
  private readonly sticks: T.InstancedMesh;
  private readonly cloths: T.InstancedMesh;
  private flagColour = "";
  private flagShow = 0;
  private readonly fans: Fan[] = [];
  private readonly pose: T.Object3D;
  private readonly limb: T.Object3D;
  /** Shifts an arm from its shoulder pivot to the middle of the limb. */
  private readonly hang: T.Matrix4;
  private energy = 0;
  private cheerSequence = 0;
  private disposed = false;

  constructor(three: Three, scene: T.Scene, private readonly reducedMotion: boolean, random: () => number = Math.random, style: CrowdStyle = {}) {
    const span = Math.PI * 2 - GAP_HALF * 2;
    const section = span / SECTIONS;
    const stepBoxes: Array<{ angle: number; radius: number; width: number; height: number; depth: number; color: string }> = [];
    for (let s = 0; s < SECTIONS; s++) {
      const start = GAP_CENTRE + GAP_HALF + s * section + AISLE / 2;
      const arc = section - AISLE;
      // A low painted wall in front of each section.
      const wallCount = Math.max(1, Math.round((arc * 8.5) / 1.4));
      for (let w = 0; w < wallCount; w++) {
        stepBoxes.push({ angle: start + ((w + 0.5) / wallCount) * arc, radius: 8.55, width: (arc * 8.55) / wallCount + 0.02, height: 0.3, depth: 0.12, color: "#20324a" });
      }
      ROWS.forEach((row, rowIndex) => {
        const count = Math.max(1, Math.round((arc * row.radius) / 1.1));
        for (let b = 0; b < count; b++) {
          stepBoxes.push({
            angle: start + ((b + 0.5) / count) * arc, radius: row.radius, width: (arc * row.radius) / count + 0.02, height: row.top,
            depth: STEP_DEPTH, color: rowIndex % 2 ? "#c9c2b5" : "#d9d3c7",
          });
        }
        const seats = Math.floor((arc * row.radius) / FAN_SPACING);
        for (let f = 0; f < seats; f++) {
          if (random() > FILL) continue;
          const angle = start + ((f + 0.5) / seats) * arc;
          const radius = row.radius + 0.08;
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          const profile = crowdProfile(this.fans.length, random);
          this.fans.push({ x, z, seat: row.top, yaw: yawToward(x, z, 0, 0), angle, phase: random() * Math.PI * 2, zeal: 0.55 + random() * 0.7, look: 0, flag: -1,
            profile, reaction: nextCrowdReaction(null, profile.seed, 0), reactionAge: 0, celebrationCycle: -1 });
        }
      });
    }

    const standMaterial = toon(three, style.ramp ?? null, "#ffffff");
    this.steps = new three.InstancedMesh(new three.BoxGeometry(1, 1, 1), standMaterial, stepBoxes.length);
    const placer = new three.Object3D();
    stepBoxes.forEach((box, index) => {
      placer.position.set(Math.cos(box.angle) * box.radius, box.height / 2, Math.sin(box.angle) * box.radius);
      placer.rotation.set(0, -box.angle - Math.PI / 2, 0);
      placer.scale.set(box.width, box.height, box.depth);
      placer.updateMatrix();
      this.steps.setMatrixAt(index, placer.matrix);
      this.steps.setColorAt(index, new three.Color(box.color));
    });
    this.steps.castShadow = true;
    this.steps.receiveShadow = true;

    // Little Pırpırs in muted colours, with orange beaks and dot eyes. Green is left out: it means "speaking" on stage.
    const count = this.fans.length;
    const fanMaterial = toon(three, style.ramp ?? null, "#ffffff");
    this.bodies = new three.InstancedMesh(new three.SphereGeometry(0.2, 12, 8).scale(1, 1.12, 1), fanMaterial, count);
    this.heads = new three.InstancedMesh(new three.SphereGeometry(0.15, 12, 8), fanMaterial.clone(), count);
    this.arms = new three.InstancedMesh(new three.SphereGeometry(0.07, 8, 6).scale(0.6, 1.9, 1), fanMaterial.clone(), count * 2);
    this.beaks = new three.InstancedMesh(new three.ConeGeometry(0.05, 0.1, 10).rotateX(Math.PI / 2), toon(three, style.ramp ?? null, "#ffc145"), count);
    this.eyes = new three.InstancedMesh(new three.SphereGeometry(0.026, 6, 4), new three.MeshBasicMaterial({ color: "#140c1c" }), count * 2);
    this.crests = new three.InstancedMesh(new three.SphereGeometry(0.04, 6, 4).scale(0.55, 2.7, 0.65), fanMaterial.clone(), count * 3);
    this.tails = new three.InstancedMesh(new three.SphereGeometry(0.065, 6, 4).scale(0.55, 0.55, 2.1), fanMaterial.clone(), count * 3);
    const tint = new three.Color();
    this.fans.forEach((fan, index) => {
      const hue = random() < 0.5 ? random() * 0.22 : 0.47 + random() * 0.53;
      tint.setHSL(hue, 0.35 + random() * 0.2, 0.42 + random() * 0.18);
      this.bodies.setColorAt(index, tint);
      this.arms.setColorAt(index * 2, tint);
      this.arms.setColorAt(index * 2 + 1, tint);
      this.heads.setColorAt(index, tint.clone().lerp(new three.Color("#f1efe9"), 0.55));
      const featherTint = tint.clone().lerp(new three.Color("#f1efe9"), 0.2);
      for (let feather = 0; feather < 3; feather++) {
        this.crests.setColorAt(index * 3 + feather, featherTint);
        this.tails.setColorAt(index * 3 + feather, tint);
      }
    });
    let bearers = 0;
    this.fans.forEach((fan, index) => { if (index % 3 === 0) fan.flag = bearers++; });
    this.sticks = new three.InstancedMesh(new three.CylinderGeometry(0.012, 0.012, 0.6, 5).translate(0, -0.48, 0), toon(three, style.ramp ?? null, "#6b4a2b"), bearers);
    const cloth = new three.BufferGeometry();
    cloth.setAttribute("position", new three.Float32BufferAttribute([0, -0.56, 0, 0, -0.78, 0, 0.3, -0.67, 0], 3));
    cloth.setAttribute("normal", new three.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    this.cloths = new three.InstancedMesh(cloth, toon(three, style.ramp ?? null, "#ffffff", { side: three.DoubleSide }), bearers);
    for (let index = 0; index < bearers; index++) this.cloths.setColorAt(index, new three.Color("#ffffff"));
    for (const mesh of [this.bodies, this.heads, this.arms, this.beaks, this.eyes, this.crests, this.tails, this.sticks, this.cloths]) {
      // Tiny feathers read through their colour and silhouette; skip extra shadow passes on phones.
      mesh.castShadow = mesh !== this.eyes && mesh !== this.crests && mesh !== this.tails;
      mesh.frustumCulled = false;
    }
    this.pose = new three.Object3D();
    this.limb = new three.Object3D();
    this.hang = new three.Matrix4().makeTranslation(0, -0.12, 0);
    if (style.ink) for (const mesh of [this.steps, this.bodies, this.heads]) addOutlines(three, mesh, style.ink);
    scene.add(this.steps, this.bodies, this.heads, this.arms, this.beaks, this.eyes, this.crests, this.tails, this.sticks, this.cloths);
    this.update(0, 0, null, false);
  }

  get size() { return this.fans.length; }

  /** How far the flags are out (0 hidden … 1 waving). */
  get flags() { return this.flagShow; }

  /** A burst of excitement (0 calm … 1.5 uproar) that fades over a couple of seconds. */
  cheer(strength: number) {
    if (this.disposed || this.reducedMotion || !Number.isFinite(strength) || strength <= 0) return;
    this.energy = Math.max(this.energy, Math.min(1.5, strength));
    this.cheerSequence++;
    for (const fan of this.fans) {
      fan.reaction = nextCrowdReaction(fan.reaction, fan.profile.seed, this.cheerSequence);
      fan.reactionAge = 0;
    }
  }

  /**
   * Moves every fan; `focus` is whoever has the floor, `celebrating` holds the crowd up while a winner stands, and
   * `colour` (the winner's seat colour) brings the flags out.
   */
  update(now: number, delta: number, focus: T.Vector3 | null, celebrating: boolean, colour: T.Color | null = null) {
    if (this.disposed) return;
    delta = Number.isFinite(delta) ? Math.max(0, Math.min(0.1, delta)) : 0;
    now = Number.isFinite(now) ? now : 0;
    const motion = !this.reducedMotion;
    this.energy = Math.max(celebrating ? 0.6 : 0, this.energy - delta * 0.5);
    const flagsOut = celebrating && colour !== null;
    this.flagShow = motion ? this.flagShow + ((flagsOut ? 1 : 0) - this.flagShow) * Math.min(1, delta * 3) : flagsOut ? 1 : 0;
    if (colour && colour.getHexString() !== this.flagColour) {
      this.flagColour = colour.getHexString();
      for (let index = 0; index < this.cloths.count; index++) this.cloths.setColorAt(index, colour);
      if (this.cloths.instanceColor) this.cloths.instanceColor.needsUpdate = true;
    }
    const energy = motion ? this.energy : 0;
    this.fans.forEach((fan, index) => {
      const profile = fan.profile;
      if (motion) fan.reactionAge += delta;
      if (motion && celebrating) {
        const cycle = Math.floor(now / 4.6 + profile.delay);
        if (cycle !== fan.celebrationCycle) {
          fan.celebrationCycle = cycle;
          fan.reaction = nextCrowdReaction(fan.reaction, profile.seed, this.cheerSequence + cycle + 31);
        }
      } else fan.celebrationCycle = -1;
      // A short stagger makes a real event ripple through the stands rather than starting every wing together.
      const onset = celebrating ? 1 : 0.4 + 0.6 * Math.max(0, Math.min(1, (fan.reactionAge - profile.delay) * 7));
      const excite = energy * fan.zeal * onset;
      // While a winner stands, a stadium wave runs round the stands.
      const wave = motion && celebrating ? Math.max(0, Math.sin(now * 2.4 - fan.angle * 3)) : 0;
      const beat = now * profile.pace;
      let jump = wave * 0.2;
      let raise = Math.min(1, excite * 0.8 + wave);
      let tilt = 0;
      let wingBeat = 0;
      let asymmetry = 0;
      switch (fan.reaction) {
        case "hop": jump += excite * 0.2 * Math.abs(Math.sin(beat * 7 + fan.phase)); wingBeat = Math.sin(beat * 8 + fan.phase) * 0.14 * raise; break;
        case "flutter": jump += excite * 0.05 * Math.abs(Math.sin(beat * 5 + fan.phase)); wingBeat = Math.sin(beat * 9 + fan.phase) * 0.34 * raise; break;
        case "clap": raise *= 0.7; wingBeat = Math.sin(beat * 6 + fan.phase) * 0.32 * raise; break;
        case "lean": tilt = Math.sin(beat * 3 + fan.phase) * 0.14 * excite; asymmetry = Math.sin(beat * 3 + fan.phase) * 0.38 * raise; break;
        case "reach": jump += excite * 0.09 * Math.abs(Math.sin(beat * 4 + fan.phase)); asymmetry = Math.sin(beat * 4 + fan.phase) * 0.42 * raise; break;
      }
      const sway = motion ? Math.sin(beat * 1.3 + fan.phase) * 0.04 + tilt : 0;
      const desired = focus && motion ? Math.max(-0.9, Math.min(0.9, wrap(yawToward(fan.x, fan.z, focus.x, focus.z) - fan.yaw))) : 0;
      fan.look += (desired - fan.look) * (motion ? Math.min(1, delta * 3) : 1);

      const lift = fan.seat + jump;
      this.pose.position.set(fan.x, lift + 0.27 * profile.size, fan.z);
      this.pose.rotation.set(0, fan.yaw, sway);
      this.pose.scale.set(profile.size * profile.bodyWidth, profile.size * profile.bodyHeight, profile.size * profile.bodyDepth);
      this.pose.updateMatrix();
      this.bodies.setMatrixAt(index, this.pose.matrix);
      this.pose.position.y = lift + (0.6 + (profile.bodyHeight - 1) * 0.15) * profile.size;
      this.pose.rotation.set(0, fan.yaw + fan.look, sway * 0.5);
      this.pose.scale.setScalar(profile.size * profile.head);
      this.pose.updateMatrix();
      this.heads.setMatrixAt(index, this.pose.matrix);
      this.limb.position.set(0, -0.02, 0.15);
      this.limb.rotation.set(0, 0, 0);
      this.limb.scale.setScalar(1);
      this.limb.updateMatrix();
      this.limb.matrixWorld.multiplyMatrices(this.pose.matrix, this.limb.matrix);
      this.beaks.setMatrixAt(index, this.limb.matrixWorld);
      for (const side of [-1, 1]) {
        this.limb.position.set(side * 0.06, 0.04, 0.128);
        this.limb.updateMatrix();
        this.limb.matrixWorld.multiplyMatrices(this.pose.matrix, this.limb.matrix);
        this.eyes.setMatrixAt(index * 2 + (side > 0 ? 1 : 0), this.limb.matrixWorld);
      }
      for (let feather = 0; feather < 3; feather++) {
        const side = feather - 1;
        this.limb.position.set(side * 0.044, 0.16 + (side === 0 ? 0.035 : 0), -0.018);
        this.limb.rotation.set(0.22, 0, -side * 0.3);
        this.limb.scale.set(1, profile.crest * (side === 0 ? 1 : 0.75), 1);
        this.limb.updateMatrix();
        this.limb.matrixWorld.multiplyMatrices(this.pose.matrix, this.limb.matrix);
        this.crests.setMatrixAt(index * 3 + feather, this.limb.matrixWorld);
      }

      // Arms hang at the sides and swing overhead when the crowd cheers.
      this.pose.position.y = lift + 0.27 * profile.size;
      this.pose.rotation.set(0, fan.yaw, sway);
      this.pose.scale.setScalar(profile.size);
      this.pose.updateMatrix();
      for (let feather = 0; feather < 3; feather++) {
        const side = feather - 1;
        this.limb.position.set(side * 0.035, -0.07, -0.2 * profile.bodyDepth);
        this.limb.rotation.set(-0.45, side * 0.26, 0);
        this.limb.scale.set(1, 1, profile.tail * (side === 0 ? 1 : 0.85));
        this.limb.updateMatrix();
        this.limb.matrixWorld.multiplyMatrices(this.pose.matrix, this.limb.matrix);
        this.tails.setMatrixAt(index * 3 + feather, this.limb.matrixWorld);
      }
      for (const side of [-1, 1]) {
        // Little wings flap overhead when the crowd cheers.
        const swing = side * (0.25 + raise * (Math.PI - 0.7) + wingBeat) + asymmetry;
        const pitch = fan.reaction === "clap" ? -raise * 0.9 : 0;
        const wingTurn = fan.reaction === "flutter" ? side * wingBeat * 0.6 : 0;
        this.limb.position.set(side * 0.2 * profile.bodyWidth, 0.08 * profile.bodyHeight, 0);
        this.limb.rotation.set(pitch, wingTurn, swing);
        this.limb.scale.setScalar(1);
        this.limb.updateMatrix();
        if (side > 0 && fan.flag >= 0) {
          // The flag rides on the right wing, waving as it goes; hidden (scaled away) until the final.
          this.limb.scale.setScalar(Math.max(0.0001, this.flagShow) / profile.size);
          this.limb.updateMatrix();
          this.limb.matrixWorld.multiplyMatrices(this.pose.matrix, this.limb.matrix);
          this.sticks.setMatrixAt(fan.flag, this.limb.matrixWorld);
          this.limb.rotation.set(pitch, wingTurn + (motion ? Math.sin(beat * 7 + fan.phase) * 0.48 : 0), swing);
          this.limb.updateMatrix();
          this.limb.matrixWorld.multiplyMatrices(this.pose.matrix, this.limb.matrix);
          this.cloths.setMatrixAt(fan.flag, this.limb.matrixWorld);
        }
        this.limb.scale.set(1, profile.wing, 1.1);
        this.limb.rotation.set(pitch, wingTurn, swing);
        this.limb.updateMatrix();
        this.limb.matrix.multiply(this.hang);
        this.limb.matrixWorld.multiplyMatrices(this.pose.matrix, this.limb.matrix);
        this.arms.setMatrixAt(index * 2 + (side > 0 ? 1 : 0), this.limb.matrixWorld);
      }
    });
    for (const mesh of [this.bodies, this.heads, this.arms, this.beaks, this.eyes, this.crests, this.tails, this.sticks, this.cloths]) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [this.steps, this.bodies, this.heads, this.arms, this.beaks, this.eyes, this.crests, this.tails, this.sticks, this.cloths]) {
      for (const shell of [...mesh.children]) if ((shell as T.InstancedMesh).isInstancedMesh) (shell as T.InstancedMesh).dispose();
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as T.Material).dispose();
      mesh.dispose();
    }
  }
}
