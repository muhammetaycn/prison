import type * as T from "three";
import { softDot } from "./motion-fx";
import type { WeatherKind } from "./weather";

type Three = typeof T;

interface Look {
  sky: string;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunColor: string;
  fill: number;
  clouds: string;
  rain: number;
  heat: number;
}

/** What each kind of weather looks like on the open field. */
const LOOKS: Record<WeatherKind, Look> = {
  sunny: { sky: "#8fd3ff", fogNear: 28, fogFar: 75, sun: 2.8, sunColor: "#fff3d6", fill: 1.4, clouds: "#ffffff", rain: 0, heat: 0 },
  cloudy: { sky: "#a7bccc", fogNear: 24, fogFar: 64, sun: 1.5, sunColor: "#eef3f8", fill: 1.2, clouds: "#d7dfe7", rain: 0, heat: 0 },
  rainy: { sky: "#6c8295", fogNear: 18, fogFar: 52, sun: 0.75, sunColor: "#cfdbe6", fill: 1.0, clouds: "#8794a1", rain: 1, heat: 0 },
  storm: { sky: "#45536a", fogNear: 14, fogFar: 44, sun: 0.45, sunColor: "#c4cede", fill: 0.8, clouds: "#5c6779", rain: 1.4, heat: 0 },
  heat: { sky: "#ffc27a", fogNear: 22, fogFar: 60, sun: 3.6, sunColor: "#ffcf8a", fill: 1.35, clouds: "#ffe6c9", rain: 0, heat: 1 },
};

const RAIN_DROPS = 1400;
const RIPPLES = 56;
const HAZE = 220;
const PUDDLES = 18;

/**
 * Weather over the fighting field: sky and fog colours, light levels, cloud tint, rain with ripples on the grass,
 * lightning in a storm, and heat shimmer rising off the pitch. Everything eases from one weather into the next.
 */
export class SkyFx {
  /** Light levels for the scene to apply (it also dims them for its own drama). */
  readonly light: { sun: number; fill: number; sunColor: T.Color; flash: number };
  private kind: WeatherKind = "cloudy";
  private readonly skyColor: T.Color;
  private readonly cloudColor: T.Color;
  private sun = LOOKS.cloudy.sun;
  private fill = LOOKS.cloudy.fill;
  private fogNear = LOOKS.cloudy.fogNear;
  private fogFar = LOOKS.cloudy.fogFar;
  private rainAmount = 0;
  private heatAmount = 0;
  private readonly rain: T.LineSegments;
  private readonly drops: Float32Array;
  private readonly ripples: T.InstancedMesh;
  private readonly rippleAge: Float32Array;
  private readonly rippleAt: Float32Array;
  private readonly haze: T.Points;
  private readonly hazeDot: T.Texture | null;
  /** Rain puddles that spread while it rains and dry up slowly afterwards, and how wet the ground is. */
  private readonly puddles: T.InstancedMesh;
  private readonly puddleSpots: Float32Array;
  private wet = 0;
  private readonly hazeSeed: Float32Array;
  private bolt: T.Mesh | null = null;
  private nextBolt = 2;
  private readonly placer: T.Object3D;
  private readonly target = new Map<string, number>();

  constructor(
    private readonly three: Three,
    private readonly scene: T.Scene,
    private readonly clouds: T.Material | null,
    private readonly reducedMotion: boolean,
    /** Grass materials that darken when the ground is wet. */
    private readonly ground: T.MeshToonMaterial[] = [],
  ) {
    this.skyColor = new three.Color(LOOKS.cloudy.sky);
    this.cloudColor = new three.Color(LOOKS.cloudy.clouds);
    this.light = { sun: this.sun, fill: this.fill, sunColor: new three.Color(LOOKS.cloudy.sunColor), flash: 0 };

    // Rain: short slanted streaks in a column over the stage, recycled from the top as they land.
    this.drops = new Float32Array(RAIN_DROPS * 6);
    for (let index = 0; index < RAIN_DROPS; index++) this.placeDrop(index, Math.random() * 18);
    const rainGeometry = new three.BufferGeometry();
    rainGeometry.setAttribute("position", new three.BufferAttribute(this.drops, 3));
    this.rain = new three.LineSegments(rainGeometry, new three.LineBasicMaterial({ color: "#d6e6ff", transparent: true, opacity: 0, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;

    // Ripples where drops land on the grass.
    this.ripples = new three.InstancedMesh(new three.RingGeometry(0.06, 0.09, 18).rotateX(-Math.PI / 2), new three.MeshBasicMaterial({
      color: "#e8f4ff", transparent: true, opacity: 0.45, depthWrite: false,
    }), RIPPLES);
    this.rippleAge = new Float32Array(RIPPLES).fill(1);
    this.rippleAt = new Float32Array(RIPPLES * 2);
    this.ripples.frustumCulled = false;
    this.ripples.visible = false;

    // Heat shimmer: warm motes rising off the pitch and wavering as they go.
    const hazePositions = new Float32Array(HAZE * 3);
    this.hazeSeed = new Float32Array(HAZE * 3);
    for (let index = 0; index < HAZE; index++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * 9;
      this.hazeSeed.set([Math.cos(angle) * radius, Math.sin(angle) * radius, Math.random()], index * 3);
    }
    const hazeGeometry = new three.BufferGeometry();
    hazeGeometry.setAttribute("position", new three.BufferAttribute(hazePositions, 3));
    // Soft round motes; square points would read as glitches close to the camera.
    this.hazeDot = softDot(three);
    this.haze = new three.Points(hazeGeometry, new three.PointsMaterial({
      color: "#ffd9a0", size: 0.3, map: this.hazeDot ?? undefined, transparent: true, opacity: 0, depthWrite: false, blending: three.AdditiveBlending,
    }));
    this.haze.frustumCulled = false;
    this.haze.visible = false;

    // Puddles in hollows across the pitch and the lawn outside the cage.
    this.puddleSpots = new Float32Array(PUDDLES * 3);
    for (let index = 0; index < PUDDLES; index++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = index < 10 ? 2.2 + Math.random() * 3.8 : 8 + Math.random() * 3.5;
      this.puddleSpots.set([Math.cos(angle) * radius, Math.sin(angle) * radius, 0.45 + Math.random() * 0.55], index * 3);
    }
    this.puddles = new three.InstancedMesh(new three.CircleGeometry(1, 28).rotateX(-Math.PI / 2), new three.MeshToonMaterial({
      color: "#8ea4b6", emissive: "#2a3a4a", transparent: true, opacity: 0.62, depthWrite: false,
    }), PUDDLES);
    this.puddles.frustumCulled = false;
    this.puddles.visible = false;

    this.placer = new three.Object3D();
    scene.add(this.rain, this.ripples, this.haze, this.puddles);
  }

  get weather() { return this.kind; }

  set(kind: WeatherKind) {
    this.kind = kind;
    if (this.reducedMotion) this.snap();
  }

  private snap() {
    const look = LOOKS[this.kind];
    this.skyColor.set(look.sky);
    this.cloudColor.set(look.clouds);
    this.light.sunColor.set(look.sunColor);
    this.sun = look.sun;
    this.fill = look.fill;
    this.fogNear = look.fogNear;
    this.fogFar = look.fogFar;
    this.rainAmount = look.rain;
    this.heatAmount = look.heat;
  }

  private placeDrop(index: number, height: number) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * 17;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // Each streak leans with the wind.
    this.drops.set([x, height, z, x + 0.06, height + 0.45, z + 0.03], index * 6);
  }

  update(delta: number, now: number) {
    const three = this.three;
    const look = LOOKS[this.kind];
    if (!this.reducedMotion) {
      const rate = Math.min(1, delta * 0.9);
      this.skyColor.lerp(new three.Color(look.sky), rate);
      this.cloudColor.lerp(new three.Color(look.clouds), rate);
      this.light.sunColor.lerp(new three.Color(look.sunColor), rate);
      this.sun += (look.sun - this.sun) * rate;
      this.fill += (look.fill - this.fill) * rate;
      this.fogNear += (look.fogNear - this.fogNear) * rate;
      this.fogFar += (look.fogFar - this.fogFar) * rate;
      this.rainAmount += (look.rain - this.rainAmount) * Math.min(1, delta * 1.4);
      this.heatAmount += (look.heat - this.heatAmount) * Math.min(1, delta * 1.2);
    }
    const background = this.scene.background as T.Color | null;
    background?.copy?.(this.skyColor);
    const fog = this.scene.fog as T.Fog | null;
    if (fog) { fog.color.copy(this.skyColor); fog.near = this.fogNear; fog.far = this.fogFar; }
    const clouds = this.clouds as T.MeshToonMaterial | null;
    if (clouds) { clouds.color.copy(this.cloudColor); clouds.emissive.copy(this.cloudColor).multiplyScalar(0.3); }

    this.updateRain(delta);
    this.updateGround(delta);
    this.updateHaze(now);
    this.updateLightning(delta, now);
    this.light.sun = this.sun;
    this.light.fill = this.fill;
  }

  private updateRain(delta: number) {
    const amount = this.reducedMotion ? 0 : this.rainAmount;
    this.rain.visible = amount > 0.02;
    this.ripples.visible = amount > 0.02;
    if (!this.rain.visible) return;
    (this.rain.material as T.LineBasicMaterial).opacity = Math.min(0.7, amount * 0.55);
    const fall = 17 * delta;
    for (let index = 0; index < RAIN_DROPS; index++) {
      const base = index * 6;
      this.drops[base + 1] -= fall;
      this.drops[base + 4] -= fall;
      if (this.drops[base + 1] < 0) this.placeDrop(index, 16 + Math.random() * 3);
    }
    this.rain.geometry.getAttribute("position").needsUpdate = true;

    // New ripples at a rate that follows the rain; each grows and is recycled once it fades out.
    for (let index = 0; index < RIPPLES; index++) {
      this.rippleAge[index] += delta * 1.6;
      if (this.rippleAge[index] >= 1 && Math.random() < amount * delta * 9) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * 11;
        this.rippleAt.set([Math.cos(angle) * radius, Math.sin(angle) * radius], index * 2);
        this.rippleAge[index] = 0;
      }
      const age = Math.min(1, this.rippleAge[index]);
      this.placer.position.set(this.rippleAt[index * 2], 0.02, this.rippleAt[index * 2 + 1]);
      this.placer.scale.setScalar(age >= 1 ? 0.0001 : 1 + age * 5);
      this.placer.updateMatrix();
      this.ripples.setMatrixAt(index, this.placer.matrix);
    }
    this.ripples.instanceMatrix.needsUpdate = true;
  }

  /** Wet ground: puddles spread while it rains and shrink slowly once it stops; the grass darkens with them. */
  private updateGround(delta: number) {
    const raining = LOOKS[this.kind].rain > 0;
    const target = raining ? 1 : 0;
    this.wet = this.reducedMotion ? target : this.wet + (target - this.wet) * Math.min(1, delta * (raining ? 0.22 : 0.07));
    for (const material of this.ground) material.color.setRGB(1 - this.wet * 0.32, 1 - this.wet * 0.22, 1 - this.wet * 0.12);
    this.puddles.visible = this.wet > 0.02;
    if (!this.puddles.visible) return;
    for (let index = 0; index < PUDDLES; index++) {
      const size = this.puddleSpots[index * 3 + 2] * this.wet;
      this.placer.position.set(this.puddleSpots[index * 3], 0.013 + index * 0.0004, this.puddleSpots[index * 3 + 1]);
      this.placer.scale.set(size, 1, size * 0.72);
      this.placer.rotation.set(0, index * 1.7, 0);
      this.placer.updateMatrix();
      this.puddles.setMatrixAt(index, this.placer.matrix);
    }
    this.placer.rotation.set(0, 0, 0);
    this.puddles.instanceMatrix.needsUpdate = true;
  }

  private updateHaze(now: number) {
    const amount = this.reducedMotion ? 0 : this.heatAmount;
    this.haze.visible = amount > 0.02;
    if (!this.haze.visible) return;
    (this.haze.material as T.PointsMaterial).opacity = amount * 0.35;
    const positions = this.haze.geometry.getAttribute("position") as T.BufferAttribute;
    for (let index = 0; index < HAZE; index++) {
      const [x, z, seed] = [this.hazeSeed[index * 3], this.hazeSeed[index * 3 + 1], this.hazeSeed[index * 3 + 2]];
      const rise = ((now * 0.35 + seed) % 1) * 4.5;
      const waver = Math.sin(now * 3 + seed * 20 + rise * 2) * 0.18;
      positions.setXYZ(index, x + waver, 0.2 + rise, z + Math.cos(now * 2.6 + seed * 13) * 0.12);
    }
    positions.needsUpdate = true;
  }

  private updateLightning(delta: number, now: number) {
    this.light.flash = Math.max(0, this.light.flash - delta * 5);
    if (this.bolt) {
      (this.bolt.material as T.MeshBasicMaterial).opacity = Math.min(1, this.light.flash * 1.6);
      this.bolt.visible = this.light.flash > 0.08;
    }
    if (this.kind !== "storm" || this.reducedMotion || now < this.nextBolt) return;
    this.nextBolt = now + 1.6 + Math.random() * 3.2;
    this.light.flash = 1;
    // A jagged bolt from the clouds down to a spot outside the cage.
    const three = this.three;
    const angle = Math.random() * Math.PI * 2;
    const ground = new three.Vector3(Math.cos(angle) * (11 + Math.random() * 5), 0, Math.sin(angle) * (11 + Math.random() * 5));
    const points: T.Vector3[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const jitter = k === 0 || k === 10 ? 0 : 1.1;
      points.push(new three.Vector3(ground.x + (Math.random() - 0.5) * jitter, 22 * (1 - t), ground.z + (Math.random() - 0.5) * jitter));
    }
    if (this.bolt) { this.scene.remove(this.bolt); this.bolt.geometry.dispose(); (this.bolt.material as T.Material).dispose(); }
    this.bolt = new three.Mesh(new three.TubeGeometry(new three.CatmullRomCurve3(points, false, "catmullrom", 0), 40, 0.07, 5),
      new three.MeshBasicMaterial({ color: "#f4f8ff", transparent: true, opacity: 1, depthWrite: false }));
    this.scene.add(this.bolt);
  }

  dispose() {
    for (const object of [this.rain, this.ripples, this.haze, this.puddles, this.bolt]) {
      if (!object) continue;
      this.scene.remove(object);
      object.geometry.dispose();
      (object.material as T.Material).dispose();
    }
    this.ripples.dispose();
    this.puddles.dispose();
    this.hazeDot?.dispose();
  }
}
