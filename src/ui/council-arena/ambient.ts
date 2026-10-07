import type * as T from "three";
import { addOutlines, toon } from "./toon";
import type { WeatherKind } from "./weather";

type Three = typeof T;

/**
 * Life around the stage that is not the council: a flock wheeling over the treeline, butterflies at the flower beds
 * and leaves coming off the trees on the field; moths round the lantern and little wild birds that land on the
 * window sills in the room. None of it carries content or stands for a model; it only answers the weather (no
 * butterflies in the rain, no flock in a storm, leaves blown harder in the wind) and the big moments (a startle sends
 * the sill birds off, scatters the butterflies and sets the flock wheeling). Under reduced motion it holds still.
 */
export interface AmbientOptions {
  mode: "collaboration" | "competition";
  reducedMotion: boolean;
  /** Cel-shading ramp and ink outline, to match the rest of the stage. */
  ramp?: T.Texture | null;
  ink?: T.Material;
  /** Field: centres of the tree crowns (leaves fall from them) and the flower beds (butterflies keep near them). */
  trees?: T.Vector3[];
  flowers?: T.Vector3[];
  /** Room: window sills (a point on the outside ledge and the direction out of the room) and the lantern. */
  sills?: Array<{ position: T.Vector3; outward: T.Vector3 }>;
  lamp?: T.Vector3;
  random?: () => number;
}

const FLOCK = 9;
const BUTTERFLIES = 10;
const LEAVES = 26;
const MOTHS = 3;

type SillState = "away" | "arriving" | "perched" | "leaving";

interface SillBird {
  root: T.Group;
  head: T.Object3D;
  wings: T.Object3D[];
  sill: number;
  state: SillState;
  since: number;
  /** When the next arrival or departure is due. */
  next: number;
  from: T.Vector3;
}

interface Leaf {
  position: T.Vector3;
  drift: T.Vector3;
  spin: T.Vector3;
  turn: T.Euler;
  /** Seconds lying on the grass before it is blown off and replaced. */
  rest: number;
}

export class Ambient {
  private readonly group: T.Group;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly random: () => number;
  private flock: { body: T.InstancedMesh; wings: T.InstancedMesh } | null = null;
  private butterflies: { wings: T.InstancedMesh; homes: T.Vector3[]; seeds: number[] } | null = null;
  private leaves: { mesh: T.InstancedMesh; state: Leaf[] } | null = null;
  private moths: T.InstancedMesh | null = null;
  private readonly sill: SillBird[] = [];
  private weather: WeatherKind = "sunny";
  /** Excitement from a big moment, fading: the flock wheels faster, butterflies flee upward. */
  private alarm = 0;
  private lastNow = 0;
  private readonly m: T.Matrix4;
  private readonly n: T.Matrix4;
  private readonly q: T.Quaternion;
  private readonly e: T.Euler;
  private readonly v: T.Vector3;
  private readonly s: T.Vector3;

  constructor(private readonly three: Three, scene: T.Scene, private readonly options: AmbientOptions) {
    this.random = options.random ?? Math.random;
    this.group = new three.Group();
    this.group.name = "ambient";
    scene.add(this.group);
    this.m = new three.Matrix4();
    this.n = new three.Matrix4();
    this.q = new three.Quaternion();
    this.e = new three.Euler();
    this.v = new three.Vector3();
    this.s = new three.Vector3();
    if (options.mode === "competition") {
      if (!options.reducedMotion) this.buildFlock();
      this.buildButterflies(options.flowers ?? []);
      if (!options.reducedMotion && options.trees?.length) this.buildLeaves(options.trees);
    } else {
      if (options.lamp && !options.reducedMotion) this.buildMoths();
      (options.sills ?? []).forEach((_, index) => { if (index < 3) this.buildSillBird(index); });
    }
    this.update(0, 0);
  }

  /** Counts of what is out, for checks: flock birds flying, butterflies out, leaves, moths, birds on the sills. */
  get counts() {
    return {
      flock: this.flock?.body.visible ? FLOCK : 0,
      butterflies: this.butterflies?.wings.visible ? this.butterflies.homes.length : 0,
      leaves: this.leaves?.state.length ?? 0,
      moths: this.moths?.visible ? MOTHS : 0,
      perched: this.sill.filter((bird) => bird.state === "perched").length,
    };
  }

  setWeather(kind: WeatherKind) {
    this.weather = kind;
    // Rain and storms send the sill birds for shelter.
    if (kind === "rainy" || kind === "storm") for (const bird of this.sill) if (bird.state === "perched" || bird.state === "arriving") this.leave(bird, this.lastNow);
  }

  /** A big moment (an elimination, a winner, thunder): sill birds take off, butterflies scatter, the flock wheels. */
  startle(strength = 1) {
    if (this.options.reducedMotion) return;
    this.alarm = Math.min(1.5, this.alarm + strength);
    for (const bird of this.sill) if (bird.state === "perched" || bird.state === "arriving") this.leave(bird, this.lastNow);
  }

  update(now: number, delta: number) {
    this.lastNow = now;
    const motion = !this.options.reducedMotion;
    this.alarm = Math.max(0, this.alarm - delta * 0.35);
    this.updateFlock(now, motion);
    this.updateButterflies(now, motion);
    this.updateLeaves(now, delta);
    this.updateMoths(now);
    this.updateSill(now, motion);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((object) => {
      const mesh = object as T.Mesh;
      if (mesh.isMesh && !mesh.userData.outline) mesh.geometry?.dispose();
    });
    for (const item of this.disposables) item.dispose();
  }

  // ───────────────────────────── field ─────────────────────────────

  private paint(color: T.ColorRepresentation, extra: T.MeshToonMaterialParameters = {}) {
    const material = toon(this.three, this.options.ramp ?? null, color, extra);
    this.disposables.push(material);
    return material;
  }

  private buildFlock() {
    const three = this.three;
    const body = new three.InstancedMesh(new three.SphereGeometry(1, 10, 8).scale(0.26, 0.22, 0.5), this.paint("#3a4658"), FLOCK);
    const shape = new three.Shape();
    shape.moveTo(0, 0.12);
    shape.quadraticCurveTo(0.6, 0.18, 1.05, -0.05);
    shape.quadraticCurveTo(0.55, -0.12, 0, -0.22);
    shape.lineTo(0, 0.12);
    const wings = new three.InstancedMesh(new three.ShapeGeometry(shape).rotateX(-Math.PI / 2), this.paint("#4a5a70", { side: three.DoubleSide }), FLOCK * 2);
    for (const mesh of [body, wings]) { mesh.frustumCulled = false; mesh.castShadow = false; this.group.add(mesh); }
    if (this.options.ink) addOutlines(three, body, this.options.ink);
    this.flock = { body, wings };
  }

  private updateFlock(now: number, motion: boolean) {
    const flock = this.flock;
    if (!flock) return;
    const out = motion && this.weather !== "storm";
    flock.body.visible = flock.wings.visible = out;
    if (!out) return;
    const three = this.three;
    // A slow lap round the field just over the treeline; a big moment makes it wheel faster and climb.
    const lap = now * (0.035 + this.alarm * 0.06);
    const radius = 22 + Math.sin(now * 0.07) * 3;
    const centre = new three.Vector3(Math.cos(lap) * radius, 5.6 + Math.sin(now * 0.3) * 0.8 + this.alarm * 1.5, Math.sin(lap) * radius);
    const yaw = -lap;
    const right = new three.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const forward = new three.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    for (let index = 0; index < FLOCK; index++) {
      const rank = Math.ceil(index / 2);
      const side = index % 2 ? 1 : -1;
      const at = centre.clone().addScaledVector(right, side * rank * 1.6).addScaledVector(forward, -rank * 1.4);
      at.y += Math.sin(now * 1.3 + index * 1.7) * 0.25;
      this.e.set(0, yaw, -0.22);
      this.q.setFromEuler(this.e);
      this.m.compose(at, this.q, this.s.setScalar(1));
      flock.body.setMatrixAt(index, this.m);
      // Flapping in bursts, gliding in between.
      const gliding = Math.sin(now * 0.45 + index * 1.3) > 0.35;
      const flap = gliding ? 0.12 : Math.sin(now * 9 + index * 0.9) * 0.75;
      // The left wing is the right one mirrored, so both rise together.
      for (const mirror of [1, -1]) {
        this.n.makeRotationZ(flap);
        this.m.compose(at, this.q, this.s.set(mirror, 1, 1)).multiply(this.n);
        flock.wings.setMatrixAt(index * 2 + (mirror > 0 ? 0 : 1), this.m);
      }
    }
    flock.body.instanceMatrix.needsUpdate = true;
    flock.wings.instanceMatrix.needsUpdate = true;
  }

  private buildButterflies(flowers: T.Vector3[]) {
    const three = this.three;
    const homes = flowers.length ? flowers.slice(0, BUTTERFLIES) : Array.from({ length: 6 }, (_, index) => {
      const angle = (index / 6) * Math.PI * 2 + 0.4;
      return new three.Vector3(Math.cos(angle) * 7.9, 0, Math.sin(angle) * 7.9);
    });
    const shape = new three.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.05, 0.16, 0.2, 0.2, 0.2, 0.08);
    shape.bezierCurveTo(0.21, 0.0, 0.14, -0.04, 0.08, -0.03);
    shape.bezierCurveTo(0.15, -0.1, 0.1, -0.17, 0.03, -0.12);
    shape.lineTo(0, 0);
    const wings = new three.InstancedMesh(new three.ShapeGeometry(shape).rotateX(-Math.PI / 2), this.paint("#ffffff", { side: three.DoubleSide }), homes.length * 2);
    wings.frustumCulled = false;
    wings.castShadow = false;
    const palette = ["#ffd166", "#ff8fab", "#9bf6ff", "#cdb4db", "#fdffb6", "#ffadad"].map((hex) => new three.Color(hex));
    homes.forEach((_, index) => {
      wings.setColorAt(index * 2, palette[index % palette.length]);
      wings.setColorAt(index * 2 + 1, palette[index % palette.length]);
    });
    this.group.add(wings);
    this.butterflies = { wings, homes, seeds: homes.map(() => this.random() * 100) };
  }

  private updateButterflies(now: number, motion: boolean) {
    const flutter = this.butterflies;
    if (!flutter) return;
    // They shelter from rain and storms.
    const out = this.weather !== "rainy" && this.weather !== "storm";
    flutter.wings.visible = out;
    if (!out) return;
    const lazy = this.weather === "heat" ? 0.55 : 1;
    flutter.homes.forEach((home, index) => {
      const seed = flutter.seeds[index];
      const t = motion ? now * 0.6 * lazy + seed : seed;
      // A wandering figure of eight round its flower bed; frightened, it flies up and out.
      const flee = this.alarm * 1.6;
      const at = this.v.set(
        home.x + Math.sin(t) * (0.9 + flee) + Math.sin(t * 2.3) * 0.25,
        0.45 + Math.abs(Math.sin(t * 1.7)) * 0.6 + flee,
        home.z + Math.sin(t * 2) * 0.6 * (1 + flee),
      );
      const heading = Math.atan2(Math.cos(t) * (0.9 + flee), Math.cos(t * 2) * 1.2);
      const beat = motion ? Math.sin(now * 22 * lazy + seed) * 0.9 : 0.5;
      this.e.set(0, heading, 0);
      this.q.setFromEuler(this.e);
      for (const mirror of [1, -1]) {
        this.n.makeRotationZ(beat + 0.25);
        this.m.compose(at, this.q, this.s.set(mirror, 1, 1)).multiply(this.n);
        flutter.wings.setMatrixAt(index * 2 + (mirror > 0 ? 0 : 1), this.m);
      }
    });
    flutter.wings.instanceMatrix.needsUpdate = true;
  }

  private buildLeaves(trees: T.Vector3[]) {
    const three = this.three;
    const shape = new three.Shape();
    shape.moveTo(0, -0.1);
    shape.quadraticCurveTo(0.08, 0, 0, 0.11);
    shape.quadraticCurveTo(-0.08, 0, 0, -0.1);
    const mesh = new three.InstancedMesh(new three.ShapeGeometry(shape), this.paint("#ffffff", { side: three.DoubleSide }), LEAVES);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    const greens = ["#5fae4f", "#7cc35c", "#4f9a45", "#c9b84a", "#e0913b"].map((hex) => new three.Color(hex));
    const state: Leaf[] = [];
    for (let index = 0; index < LEAVES; index++) {
      mesh.setColorAt(index, greens[index % greens.length]);
      const leaf: Leaf = { position: new three.Vector3(), drift: new three.Vector3(), spin: new three.Vector3(), turn: new three.Euler(), rest: 0 };
      this.dropLeaf(leaf, trees);
      // Start them part-way down so the first second is not a burst from the crowns.
      leaf.position.y *= this.random();
      state.push(leaf);
    }
    this.group.add(mesh);
    this.leaves = { mesh, state };
  }

  private dropLeaf(leaf: Leaf, trees: T.Vector3[]) {
    const crown = trees[Math.floor(this.random() * trees.length)];
    const angle = this.random() * Math.PI * 2;
    const reach = this.random() * 1.1;
    leaf.position.set(crown.x + Math.cos(angle) * reach, crown.y + (this.random() - 0.5) * 0.6, crown.z + Math.sin(angle) * reach);
    leaf.drift.set(this.random() - 0.5, 0, this.random() - 0.5).multiplyScalar(0.5);
    leaf.spin.set(this.random() * 3 + 1, this.random() * 2, this.random() * 3 + 1);
    leaf.turn.set(this.random() * 6, this.random() * 6, this.random() * 6);
    leaf.rest = 0;
  }

  private updateLeaves(now: number, delta: number) {
    const leaves = this.leaves;
    if (!leaves) return;
    const trees = this.options.trees ?? [];
    const wind = this.weather === "storm" ? 2.6 : this.weather === "rainy" ? 1.6 : 1;
    leaves.state.forEach((leaf, index) => {
      if (leaf.position.y <= 0.02) {
        // Lying on the grass a moment, then blown off (and a new one comes down somewhere).
        leaf.position.y = 0.02;
        leaf.rest += delta;
        if (leaf.rest > 3 / wind) this.dropLeaf(leaf, trees);
      } else {
        const sway = Math.sin(now * 2.2 + index) * 0.6;
        leaf.position.x += (leaf.drift.x * wind + sway * 0.3) * delta;
        leaf.position.z += (leaf.drift.z * wind + Math.cos(now * 1.7 + index) * 0.2) * delta;
        leaf.position.y -= (0.45 + Math.abs(sway) * 0.25) * delta;
        leaf.turn.x += leaf.spin.x * delta;
        leaf.turn.y += leaf.spin.y * delta;
        leaf.turn.z += leaf.spin.z * delta;
      }
      // Lying flat once down.
      if (leaf.position.y <= 0.02) leaf.turn.set(-Math.PI / 2, leaf.turn.y, 0);
      this.q.setFromEuler(leaf.turn);
      this.m.compose(leaf.position, this.q, this.s.setScalar(1));
      leaves.mesh.setMatrixAt(index, this.m);
    });
    leaves.mesh.instanceMatrix.needsUpdate = true;
  }

  // ───────────────────────────── room ─────────────────────────────

  private buildMoths() {
    const three = this.three;
    const shape = new three.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(0.09, 0.07, 0.1, -0.02);
    shape.quadraticCurveTo(0.05, -0.06, 0, 0);
    const moths = new three.InstancedMesh(new three.ShapeGeometry(shape).rotateX(-Math.PI / 2), this.paint("#e9dcc0", { side: three.DoubleSide, emissive: "#3a2a10" }), MOTHS * 2);
    moths.frustumCulled = false;
    this.group.add(moths);
    this.moths = moths;
  }

  private updateMoths(now: number) {
    const moths = this.moths;
    const lamp = this.options.lamp;
    if (!moths || !lamp) return;
    for (let index = 0; index < MOTHS; index++) {
      // Erratic little loops round the lantern.
      const t = now * (1.6 + index * 0.37) + index * 2.1;
      const at = this.v.set(
        lamp.x + Math.cos(t) * (0.42 + Math.sin(t * 2.7) * 0.12),
        lamp.y - 0.15 + Math.sin(t * 1.9 + index) * 0.22,
        lamp.z + Math.sin(t) * (0.42 + Math.cos(t * 3.1) * 0.12),
      );
      this.e.set(0, -t + Math.PI / 2, 0);
      this.q.setFromEuler(this.e);
      const beat = Math.sin(now * 30 + index * 2) * 0.8;
      for (const mirror of [1, -1]) {
        this.n.makeRotationZ(beat);
        this.m.compose(at, this.q, this.s.set(mirror, 1, 1)).multiply(this.n);
        moths.setMatrixAt(index * 2 + (mirror > 0 ? 0 : 1), this.m);
      }
    }
    moths.instanceMatrix.needsUpdate = true;
  }

  private buildSillBird(sill: number) {
    const three = this.three;
    const palette = [["#8a6a4a", "#d9c2a0"], ["#5a6f8a", "#c9d6e6"], ["#7a5a72", "#e2c6d6"]][sill % 3];
    const feathers = this.paint(palette[0]);
    const chest = this.paint(palette[1]);
    const beak = this.paint("#f0b44a");
    const root = new three.Group();
    const body = new three.Mesh(new three.SphereGeometry(1, 14, 10).scale(0.1, 0.085, 0.12), feathers);
    body.position.y = 0.085;
    const breast = new three.Mesh(new three.SphereGeometry(1, 12, 8).scale(0.07, 0.06, 0.05), chest);
    breast.position.set(0, 0.075, 0.075);
    const head = new three.Group();
    head.position.set(0, 0.17, 0.07);
    head.add(new three.Mesh(new three.SphereGeometry(0.06, 12, 10), feathers));
    const bill = new three.Mesh(new three.ConeGeometry(0.016, 0.05, 8).rotateX(Math.PI / 2), beak);
    bill.position.set(0, -0.005, 0.07);
    head.add(bill);
    for (const side of [-1, 1]) {
      const eye = new three.Mesh(new three.SphereGeometry(0.011, 8, 6), this.paint("#1d1424"));
      eye.position.set(side * 0.04, 0.015, 0.045);
      eye.userData.noOutline = true;
      head.add(eye);
    }
    const tail = new three.Mesh(new three.ConeGeometry(0.035, 0.12, 6).rotateX(-Math.PI / 2 - 0.5), feathers);
    tail.position.set(0, 0.1, -0.13);
    const wings = [-1, 1].map((side) => {
      const wing = new three.Group();
      wing.position.set(side * 0.085, 0.11, 0.0);
      const blade = new three.Mesh(new three.SphereGeometry(1, 10, 6).scale(0.02, 0.06, 0.1), feathers);
      blade.position.set(0, -0.03, -0.01);
      wing.add(blade);
      return wing;
    });
    root.add(body, breast, head, tail, ...wings);
    if (this.options.ink) addOutlines(this.three, root, this.options.ink);
    root.visible = false;
    this.group.add(root);
    const bird: SillBird = { root, head, wings, sill, state: "away", since: 0, next: 2 + sill * 5 + this.random() * 6, from: new three.Vector3() };
    if (this.options.reducedMotion && sill === 0) { bird.state = "perched"; root.visible = true; this.placeOnSill(bird); }
    this.sill.push(bird);
  }

  private placeOnSill(bird: SillBird) {
    const sill = this.options.sills![bird.sill];
    bird.root.position.copy(sill.position);
    bird.root.rotation.set(0, Math.atan2(-sill.outward.x, -sill.outward.z), 0);
  }

  private leave(bird: SillBird, now: number) {
    if (this.options.reducedMotion) return;
    bird.state = "leaving";
    bird.since = now;
    bird.from.copy(bird.root.position);
  }

  private updateSill(now: number, motion: boolean) {
    if (!motion) return;
    const sheltering = this.weather === "rainy" || this.weather === "storm";
    for (const bird of this.sill) {
      const sill = this.options.sills![bird.sill];
      const away = sill.position.clone().addScaledVector(sill.outward, 2.5).add(this.v.set(0, 1.2, 0));
      const age = now - bird.since;
      switch (bird.state) {
        case "away":
          bird.root.visible = false;
          if (now >= bird.next && !sheltering && this.alarm < 0.2) { bird.state = "arriving"; bird.since = now; bird.from.copy(away); }
          break;
        case "arriving": {
          // An arc in from outside, wings beating, then a little landing flare.
          const p = Math.min(1, age / 1.1);
          bird.root.visible = true;
          bird.root.position.lerpVectors(bird.from, sill.position, p);
          bird.root.position.y += Math.sin(p * Math.PI) * 0.35;
          bird.root.rotation.set(0, Math.atan2(sill.position.x - bird.from.x, sill.position.z - bird.from.z), 0);
          this.flap(bird, now, 1);
          if (p >= 1) { bird.state = "perched"; bird.since = now; bird.next = now + 8 + this.random() * 14; this.placeOnSill(bird); }
          break;
        }
        case "perched": {
          // Looking about, pecking at the ledge, a hop now and then, facing into the room more often than not.
          this.placeOnSill(bird);
          const beat = Math.floor(age * 1.3);
          const pick = (beat * 7 + bird.sill * 3) % 5;
          bird.head.rotation.set(pick === 0 ? 0.6 * Math.max(0, Math.sin(age * 9)) : 0, pick === 1 ? 0.7 : pick === 2 ? -0.7 : Math.sin(age * 0.8) * 0.2, 0);
          bird.root.position.y += pick === 3 ? Math.abs(Math.sin(age * 6)) * 0.05 : 0;
          bird.root.rotation.y += pick === 4 ? Math.PI * 0.85 : 0;
          this.flap(bird, now, 0);
          if (now >= bird.next) this.leave(bird, now);
          break;
        }
        case "leaving": {
          const p = Math.min(1, age / 0.9);
          bird.root.position.lerpVectors(bird.from, away, p * p);
          bird.root.rotation.set(0, Math.atan2(away.x - bird.from.x, away.z - bird.from.z), 0);
          this.flap(bird, now, 1);
          if (p >= 1) { bird.state = "away"; bird.root.visible = false; bird.next = now + 6 + this.random() * 12; }
          break;
        }
      }
    }
  }

  private flap(bird: SillBird, now: number, amount: number) {
    bird.wings.forEach((wing, index) => {
      const side = index ? 1 : -1;
      wing.rotation.z = side * (amount ? 0.3 + Math.sin(now * 28) * 0.9 : 0.05);
    });
  }
}
