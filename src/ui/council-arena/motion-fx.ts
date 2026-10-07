import type * as T from "three";

type Three = typeof T;

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

/**
 * A soft round dot for point sprites (sparks, motes, sweat, heat shimmer). Without it points draw as hard squares,
 * which look like glitches up close. Null where there is no canvas (tests); points then stay square.
 */
export function softDot(three: Three): T.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new three.CanvasTexture(canvas);
  texture.colorSpace = three.SRGBColorSpace;
  return texture;
}

/**
 * The smear a blade leaves as it swings: a ribbon between the weapon's grip end and its tip over the last instant,
 * brightest at the tip and freshest edge, fading toward the hilt and with age. It only grows while samples are pushed
 * (the strike itself), so a weapon at rest leaves nothing behind.
 */
export class SwingTrail {
  readonly mesh: T.Mesh;
  private readonly samples: Array<{ base: T.Vector3; tip: T.Vector3; at: number }> = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: T.BufferGeometry;
  private readonly material: T.MeshBasicMaterial;
  private readonly tint: T.Color;

  constructor(private readonly three: Three, tint: T.ColorRepresentation, private readonly life = 0.22, private readonly max = 30) {
    this.positions = new Float32Array(max * 2 * 3);
    this.colors = new Float32Array(max * 2 * 4);
    const index: number[] = [];
    for (let quad = 0; quad < max - 1; quad++) {
      const a = quad * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry = new three.BufferGeometry();
    this.geometry.setAttribute("position", new three.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new three.BufferAttribute(this.colors, 4));
    this.geometry.setIndex(index);
    this.geometry.setDrawRange(0, 0);
    // A white core tinted with the fighter's colour.
    this.tint = new three.Color("#ffffff").lerp(new three.Color(tint), 0.25);
    this.material = new three.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: three.DoubleSide });
    this.mesh = new three.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.userData.noOutline = true;
  }

  /** How many samples are still alive. */
  get length() { return this.samples.length; }

  /** Records where the blade is now (world space). */
  push(base: T.Vector3, tip: T.Vector3, now: number) {
    const last = this.samples[this.samples.length - 1];
    // Standing still adds nothing; a ribbon needs movement.
    if (last && last.tip.distanceToSquared(tip) < 1e-5 && last.base.distanceToSquared(base) < 1e-5) { last.at = now; return; }
    this.samples.push({ base: base.clone(), tip: tip.clone(), at: now });
    if (this.samples.length > this.max) this.samples.shift();
  }

  /** Drops expired samples and rebuilds the ribbon; false once nothing is left to draw. */
  update(now: number): boolean {
    while (this.samples.length && now - this.samples[0].at > this.life) this.samples.shift();
    const count = this.samples.length;
    this.geometry.setDrawRange(0, count >= 2 ? (count - 1) * 6 : 0);
    if (count < 2) return count > 0;
    this.samples.forEach((sample, index) => {
      const fresh = 1 - clamp((now - sample.at) / this.life);
      // Older samples fade; the tip edge is solid and the hilt edge nearly clear, a crescent of light.
      const alpha = Math.pow(fresh, 1.2) * (0.45 + 0.55 * (index / (count - 1)));
      this.positions.set([sample.base.x, sample.base.y, sample.base.z, sample.tip.x, sample.tip.y, sample.tip.z], index * 6);
      this.colors.set([this.tint.r, this.tint.g, this.tint.b, alpha * 0.05, this.tint.r, this.tint.g, this.tint.b, alpha], index * 8);
    });
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    return true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

interface Puff {
  at: T.Vector3;
  drift: T.Vector3;
  size: number;
  born: number;
  life: number;
  color: T.Color;
}

/**
 * Cartoon dust: little round puffs that pop up, drift and shrink away, from footsteps, landings, skids and heavy
 * blows. One instanced mesh with an ink outline holds them all, so a busy fight costs a single draw call.
 */
export class DustPuffs {
  readonly mesh: T.InstancedMesh;
  private readonly puffs: Puff[] = [];
  private readonly matrix: T.Matrix4;
  private readonly scale: T.Vector3;
  private readonly rotation: T.Quaternion;
  private readonly hidden: T.Matrix4;

  constructor(private readonly three: Three, material: T.Material, private readonly capacity = 72) {
    this.mesh = new three.InstancedMesh(new three.IcosahedronGeometry(1, 1), material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.matrix = new three.Matrix4();
    this.scale = new three.Vector3();
    this.rotation = new three.Quaternion();
    this.hidden = new three.Matrix4().makeScale(0, 0, 0);
    const white = new three.Color("#ffffff");
    for (let index = 0; index < capacity; index++) {
      this.mesh.setMatrixAt(index, this.hidden);
      this.mesh.setColorAt(index, white);
    }
  }

  get active() { return this.puffs.length; }

  /** One puff at `at` (world), drifting by `drift` over its life. */
  spawn(at: T.Vector3, size: number, drift: T.Vector3, now: number, color: T.ColorRepresentation, life = 0.55) {
    if (this.puffs.length >= this.capacity) this.puffs.shift();
    this.puffs.push({ at: at.clone(), drift: drift.clone(), size, born: now, life, color: new this.three.Color(color) });
  }

  /** A ring of puffs rolling outward along the ground, as from a landing or a slam. */
  burst(at: T.Vector3, count: number, size: number, reach: number, now: number, color: T.ColorRepresentation) {
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.4;
      const out = new this.three.Vector3(Math.cos(angle), 0, Math.sin(angle));
      this.spawn(at.clone().addScaledVector(out, 0.12), size * (0.75 + Math.random() * 0.5), out.multiplyScalar(reach).setY(0.12 + Math.random() * 0.1), now, color, 0.5 + Math.random() * 0.2);
    }
  }

  update(now: number) {
    for (let index = this.puffs.length - 1; index >= 0; index--) {
      if (now - this.puffs[index].born > this.puffs[index].life) this.puffs.splice(index, 1);
    }
    for (let index = 0; index < this.capacity; index++) {
      const puff = this.puffs[index];
      if (!puff) { this.mesh.setMatrixAt(index, this.hidden); continue; }
      const t = clamp((now - puff.born) / puff.life);
      // Pops up fast, then shrinks away while it slows and rises.
      const grow = t < 0.2 ? Math.sin((t / 0.2) * Math.PI * 0.5) : 1 - Math.pow((t - 0.2) / 0.8, 1.6);
      const travel = 1 - (1 - t) * (1 - t);
      this.scale.setScalar(Math.max(0.0001, puff.size * grow * (0.8 + 0.4 * t)));
      this.matrix.compose(puff.at.clone().addScaledVector(puff.drift, travel), this.rotation, this.scale);
      this.mesh.setMatrixAt(index, this.matrix);
      this.mesh.setColorAt(index, puff.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

/** A damped spring for secondary motion (a tail or a crest that lags and wobbles behind the body). */
export interface Spring {
  value: number;
  velocity: number;
}

/** Advances `spring` toward `target` by `delta` seconds; small fixed steps keep it stable at any frame rate. */
export function stepSpring(spring: Spring, target: number, delta: number, stiffness = 150, damping = 9) {
  let left = Math.min(delta, 0.1);
  while (left > 1e-6) {
    const step = Math.min(left, 1 / 120);
    spring.velocity += (-(spring.value - target) * stiffness - spring.velocity * damping) * step;
    spring.value += spring.velocity * step;
    left -= step;
  }
  return spring.value;
}

/**
 * Comic-book speed lines that burst in round the edge of the frame on a heavy blow, converging on where it landed.
 * They hang on the camera and run on real time, so they flash at full speed through the hit-stop.
 */
export class SpeedLines {
  readonly mesh: T.Mesh;
  private readonly positions: Float32Array;
  private readonly geometry: T.BufferGeometry;
  private readonly material: T.MeshBasicMaterial;
  private start = -Infinity;
  private strength = 0;
  private center = { x: 0, y: 0 };

  constructor(private readonly three: Three, private readonly count = 46, private readonly duration = 0.32) {
    this.positions = new Float32Array(count * 3 * 3);
    this.geometry = new three.BufferGeometry();
    this.geometry.setAttribute("position", new three.BufferAttribute(this.positions, 3));
    this.material = new three.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: three.DoubleSide });
    this.mesh = new three.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.mesh.userData.noOutline = true;
  }

  get showing() { return this.mesh.visible; }

  /** Bursts the lines for a blow of `strength` (0…1.5) at `center` in normalised device coordinates. */
  fire(realNow: number, strength: number, center: { x: number; y: number }) {
    this.start = realNow;
    this.strength = clamp(strength, 0.4, 1.4);
    this.center = { x: clamp(center.x, -0.6, 0.6), y: clamp(center.y, -0.6, 0.6) };
  }

  /** Lays the lines out across the camera's view for this frame. */
  update(realNow: number, camera: T.PerspectiveCamera) {
    const t = (realNow - this.start) / this.duration;
    if (t < 0 || t >= 1) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    // In the camera's own space, one unit in front: half the view height there is tan(fov / 2).
    const half = Math.tan((camera.fov * Math.PI) / 360);
    const depth = -1;
    const cx = this.center.x * camera.aspect * half;
    const cy = this.center.y * half;
    const outer = half * (camera.aspect + 1.4);
    for (let line = 0; line < this.count; line++) {
      const angle = (line / this.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
      // Each frame the lines reach in a different way, the crackle of a drawn impact.
      const inner = half * (0.55 + Math.random() * 0.5 + t * 0.25);
      const width = half * (0.012 + Math.random() * 0.028) * this.strength;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      this.positions.set([
        cx + dx * inner, cy + dy * inner, depth,
        cx + dx * outer - dy * width, cy + dy * outer + dx * width, depth,
        cx + dx * outer + dy * width, cy + dy * outer - dx * width, depth,
      ], line * 9);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.material.opacity = 0.7 * Math.min(1, this.strength) * (1 - t * t);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
