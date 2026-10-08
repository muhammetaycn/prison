import type * as T from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { COUNCIL_DIMENSIONS, COUNCIL_WEAPONS, type CouncilDimension, type CouncilEvent } from "@/models/council";
import type { CouncilMode } from "@/models/options";
import { ACCESSORY_SLOTS, accessoriesFor, dress } from "./accessories";
import { Crowd } from "./crowd";
import { Ambient } from "./ambient";
import { carry, gearFor, SCABBARD, type WeaponKind } from "./equipment";
import { ARENA_BOX, honorSeat } from "./honor";
import { chooseNextGesture, getGesture, sampleGesture, type GestureCategory, type GestureId } from "./gesture-library";
import { chooseMoodGesture, outcomeReactions } from "./outcome-gestures";
import { DustPuffs, softDot, SpeedLines, SwingTrail, stepSpring, type Spring } from "./motion-fx";
import { loadArenaParts, type AccessoryPart, type BodyPart, type FurniturePart, type GearPart, type PartLibrary, type WeaponPart } from "./parts";
import { shotFor, WIDE, type Shot } from "./director";
import { PostFx } from "./post";
import { SkyFx } from "./sky";
import { addOutlines, outlineMaterial, toon, toonGradient } from "./toon";
import type { Weather } from "./weather";
import { SPEAKING_GREEN, type SceneState, type Seat } from "./timeline";

type Three = typeof T;

export interface Anchor {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

/** Moments the stage can be heard at; the page decides whether and how to play them. */
export type SoundCue = "hit" | "heavy" | "whoosh" | "cheer" | "ooh" | "thunder" | "stamp" | "fanfare" | "pop" | "drop" | "sad" | "swish" | "ting";

export interface ArenaSceneOptions {
  mode: CouncilMode;
  reducedMotion: boolean;
  /** Called when something audible happens (with a strength 0…1.5). */
  onCue?: (cue: SoundCue, strength: number) => void;
  /** Called every rendered frame with each seat's projected head position in CSS pixels. */
  onFrame?: (anchors: Anchor[]) => void;
}

type ActionKind = "attack" | "shoot" | "throw" | "pickup" | "fall" | "toBench" | "victory" | "lean" | "flinch" | "hop" | "toPodium" | "idle" | "knock" | "dodge" | "pat" | "present" | "stamp";
/** Little things a Pırpır does when nothing is asked of it. */
type IdleKind = "preen" | "stretch" | "look" | "hop" | "tap" | "shake";
const IDLE_SECONDS: Record<IdleKind, number> = { preen: 1.7, stretch: 1.5, look: 2.2, hop: 0.7, tap: 1.3, shake: 0.9 };
/** How each weapon sits in the right wing at rest: sword raised forward, hammer on the shoulder, spear and staff planted, bow upright, shield out front. */
const HOLDS: Record<string, { position: [number, number, number]; rotation: [number, number, number]; scale: number }> = {
  sword: { position: [0, -0.02, 0.1], rotation: [0.55, 0, 0], scale: 0.9 },
  hammer: { position: [0, 0.02, 0.04], rotation: [-0.9, 0, 0.12], scale: 0.85 },
  spear: { position: [0.02, -0.5, 0.08], rotation: [0.08, 0, 0], scale: 0.95 },
  staff: { position: [0.02, -0.42, 0.08], rotation: [0.06, 0, 0], scale: 0.95 },
  bow: { position: [0, -0.18, 0.1], rotation: [0, -Math.PI / 2, 0.05], scale: 0.9 },
  shield: { position: [0.06, 0.06, 0.16], rotation: [0, 0, 0], scale: 0.85 },
};

/** How a fighter attacks: by the weapon in its wing, or with its beak when it has none. */
type AttackStyle = "sword" | "hammer" | "spear" | "shield" | "bow" | "staff" | "peck";

interface Action {
  kind: ActionKind;
  start: number;
  duration: number;
  target?: Avatar;
  weapon?: Weapon;
  /** Weapon-specific moves for attacks and shots. */
  style?: AttackStyle;
  /** Which idle fidget this is. */
  idle?: IdleKind;
  /** The jury score behind an attack (how good the target's work was judged); it decides how hard the blow lands. */
  score?: number | null;
  /** Knock-back or side-step offset on the ground. */
  push?: T.Vector3;
  /** Which stamp a vote leaves on the shared text. */
  verdict?: "approve" | "object";
  /** Ground route for a walk (an eliminated fighter heading to the jury bench). */
  path?: T.Curve<T.Vector3>;
  /** One-shot side effect at the action's midpoint (hit, attach). */
  fired?: boolean;
  /** A second one-shot cue (the sparkle when a weapon is shown off). */
  landed?: boolean;
}

interface Avatar {
  seat: Seat;
  root: T.Group;
  body: T.Group;
  hips: T.Group;
  /** Left and right leg pivots at the hip, swung while walking. */
  legs: T.Group[];
  head: T.Group;
  rightArm: T.Group;
  leftArm: T.Group;
  hand: T.Group;
  /** Tip of the left wing; it holds the umbrella in the rain. */
  leftHand: T.Group;
  umbrella: T.Group | null;
  /** How far the umbrella is open (0 stowed … 1 open overhead). */
  umbrellaOpen: number;
  /** Whites of the eyes; tinted green while speaking. */
  eyes: T.MeshStandardMaterial | T.MeshToonMaterial;
  /** Eye groups, squashed a little for a happy squint. */
  eyeMeshes: T.Object3D[];
  /** Upper eyelids in feather colour; they roll down over the eyeball to blink and to set the mood. */
  lids: T.Object3D[];
  /** Lower beak, hinged; it opens and closes while the model speaks. */
  jaw: T.Object3D;
  pupils: T.Object3D[];
  brows: T.Object3D[];
  /** Smoothed expression: brow tilt (inner ends up > 0) and lift, pupil size, gaze height, eye openness. */
  face: { tilt: number; lift: number; pupil: number; gaze: number; squint: number; lid: number };
  /** Cape pivot at the shoulders, if the model wears one. */
  cape: T.Group | null;
  /** Accessory lights that brighten while the model thinks or speaks. */
  lights: Array<T.MeshStandardMaterial | T.MeshToonMaterial>;
  /** Top of the headwear above the head centre; the name tag sits above it. */
  crown: number;
  /** Smoothed head turn toward whoever has the floor. */
  look: number;
  nextBlink: number;
  /** When it next fidgets if it is still left alone. */
  nextIdle: number;
  blinkUntil: number;
  ringMaterial: T.MeshBasicMaterial;
  haloMaterial: T.MeshBasicMaterial;
  skin: Array<T.MeshStandardMaterial | T.MeshToonMaterial>;
  /** Original color of each skin material, restored after a failure tint. */
  skinColors: T.Color[];
  /** Self-light in the seat color so faces and colors read outside the lamp's pool. */
  glow: T.Color;
  baseColor: T.Color;
  home: T.Vector3;
  homeYaw: number;
  bench: T.Vector3;
  speaking: number;
  thinking: boolean;
  active: boolean;
  eliminated: boolean;
  failed: boolean;
  winner: boolean;
  hitFlash: number;
  actions: Action[];
  /** Tail fan and forelock (and the forelock's resting tilt); they lag and wobble behind the body's moves. */
  tail: T.Object3D;
  tuft: T.Object3D;
  tuftRest: number;
  /** Secondary motion: springs for the tail's pitch and roll and the forelock, and the body's last position and speed. */
  jiggle: { tail: Spring; roll: Spring; tuft: Spring; cape: Spring; last: T.Vector3 | null; velocity: T.Vector3 };
  /** The foot last planted (for footstep dust), the height a jump reached (for its landing), and when a skid may
   * next kick up dust. */
  step: number;
  airborne: number;
  nextPuff: number;
  /** A clip from the shared gesture library (gesture-library.ts) playing on top of the pose, and the last one played. */
  gesture: { id: GestureId; start: number } | null;
  lastGesture: GestureId | null;
  /** Belt (with buckle), shoulder strap and scabbard for carrying won weapons; null until the parts library is in. */
  gear: { belt: T.Object3D; strap: T.Object3D; scabbard: T.Object3D } | null;
}

/** Which kind of library gesture a moment calls for; the clip itself is picked from the seat and the event. */
const GESTURE_FOR: Partial<Record<CouncilEvent["kind"], GestureCategory>> = {
  seat: "greeting", replace: "greeting", memory: "thinking", thinking: "thinking", research: "thinking",
  proposal: "presenting", revision: "presenting", failed: "reaction", abstained: "resting",
};

interface Weapon {
  dimension: CouncilDimension;
  mesh: T.Group;
  holder: Avatar | null;
  spot: T.Vector3;
  /** Falling from the sky; `from` (and `lift`) when it first flies up out of its previous holder's wing. */
  drop: { start: number; duration: number; from: T.Vector3 | null; lift: number } | null;
  landed: boolean;
}

interface Effect {
  update: (now: number) => boolean;
  dispose: () => void;
}

/** Ground speed of a walk in scene units per second at 1x, and the time it takes to sit down at the end. */
const WALK_SPEED = 4.8;
const SIT_SECONDS = 0.55;
/** The table lantern's spotlight. Bright enough for a warm pool on the table, low enough that a close shot of the
 * table top is wood, not a white blaze. */
const LAMP = 50;
/** Paper on the table (the shared text and proposal sheets), toned for the lantern's pool of light. */
const PAPER = "#8a8270";
/** A walk off the pitch circles at this distance from the centre, outside the ring of fighters (radius 4.3). */
const WALK_CLEARANCE = 5.75;
/** The cage's door faces the jury bench at the back of the field; its half-width as a polar angle. */
const DOOR_ANGLE = -Math.PI / 2;
const DOOR_HALF = 0.42;
const CAGE_RADIUS = 7.25;
/** How far a seated Pırpır's body rises so its round bottom rests on the bench instead of sinking into it. */
const BENCH_LIFT = 0.1;

type Mood = "calm" | "joy" | "angry" | "sad" | "shock" | "think";
/**
 * Expression targets: brow tilt (inner ends up > 0) and lift, pupil size, gaze height, eye height (a happy squint
 * squashes the eye) and how far the upper lid has come down (0 wide open … 1 shut).
 */
const MOODS: Record<Mood, { tilt: number; lift: number; pupil: number; gaze: number; squint: number; lid: number }> = {
  calm: { tilt: 0, lift: 0, pupil: 1, gaze: 0, squint: 1, lid: 0.1 },
  joy: { tilt: 0.18, lift: 0.025, pupil: 1.05, gaze: 0.01, squint: 0.6, lid: 0.38 },
  angry: { tilt: -0.55, lift: -0.03, pupil: 0.82, gaze: 0, squint: 0.9, lid: 0.5 },
  sad: { tilt: 0.5, lift: 0.005, pupil: 1.12, gaze: -0.022, squint: 0.92, lid: 0.44 },
  shock: { tilt: 0.12, lift: 0.05, pupil: 0.55, gaze: 0, squint: 1.12, lid: 0 },
  think: { tilt: -0.18, lift: 0.02, pupil: 0.95, gaze: 0.028, squint: 0.96, lid: 0.24 },
};
/** Lid roll: tucked back into the head when open, over the front of the eye when shut. */
const LID_OPEN = -1.45;
const LID_SHUT = Math.PI / 2;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const ease = (value: number) => value < 0.5 ? 2 * value * value : 1 - (-2 * value + 2) ** 2 / 2;
const yawToward = (from: T.Vector3, to: T.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);

/**
 * Bakes a static group into one mesh per material, so a forest or a cage costs a handful of draw calls instead of
 * hundreds. Only positions and normals are kept (the scenery is flat-coloured).
 */
function bakeStatic(three: Three, group: T.Group): T.Group {
  group.updateMatrixWorld(true);
  const buckets = new Map<T.Material, T.BufferGeometry[]>();
  group.traverse((object) => {
    const mesh = object as T.Mesh;
    if (!mesh.isMesh || (mesh as T.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material)) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    geometry.applyMatrix4(mesh.matrixWorld);
    const list = buckets.get(mesh.material) ?? [];
    list.push(geometry);
    buckets.set(mesh.material, list);
    mesh.geometry.dispose();
  });
  const baked = new three.Group();
  for (const [material, list] of buckets) {
    const merged = mergeGeometries(list);
    list.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    const mesh = new three.Mesh(merged, material);
    mesh.castShadow = true;
    baked.add(mesh);
  }
  return baked;
}

/** How a prop is built: modelled pieces from the library with their materials, or simple shapes as a stand-in. */
interface Recipe {
  pieces: Array<[FurniturePart, T.Material]>;
  fallback: () => T.Object3D[];
}

/** Frees a subtree's own geometry and materials (not used for the shared library parts). */
function disposeTree(root: T.Object3D) {
  root.traverse((object) => {
    const mesh = object as T.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material as T.Material | T.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose?.();
  });
}

/** Imperative three.js stage for one council: a lamp-lit round table or a green fighting field. */
export class ArenaScene {
  private readonly renderer: T.WebGLRenderer;
  private readonly scene: T.Scene;
  private readonly camera: T.PerspectiveCamera;
  private readonly clock: T.Timer;
  private readonly avatars = new Map<string, Avatar>();
  private readonly weapons = new Map<CouncilDimension, Weapon>();
  private readonly effects: Effect[] = [];
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly visibility: IntersectionObserver;
  private readonly green: T.Color;
  private readonly white: T.Color;
  private readonly grey: T.Color;
  private frame = 0;
  private visible = true;
  private speed = 1;
  private azimuth = 0.35;
  private elevation: number;
  private distance: number;
  private dragging: { x: number; y: number } | null = null;
  private lastInteraction = -10;
  private lamp: { spot: T.SpotLight; bulb: T.MeshBasicMaterial; glow: T.MeshBasicMaterial; boost: number } | null = null;
  private documentMesh: T.Mesh | null = null;
  private documentGlow = 0;
  private documentRise = 0;
  private papers: T.Mesh[] = [];
  private confetti: { points: T.Points; velocities: Float32Array; until: number } | null = null;
  private state: SceneState | null = null;
  /** Whom the current speaker addresses, if anyone. */
  private addressee: string | null = null;
  private focus: T.Vector3;
  private zoom = 1;
  private beamCone: T.MeshBasicMaterial | null = null;
  private dust: T.Points | null = null;
  /** Fight finale: a podium rises in the middle of the pitch under a spotlight. */
  private podium: { group: T.Group; spot: T.SpotLight; rise: number } | null = null;
  /** Spectators around the fighting field. */
  private crowd: Crowd | null = null;
  /** Soft studio reflections for the robots' clear-coated vinyl. */
  private environment: T.Texture | null = null;
  /** Modelled parts; until they load (or if they never do) characters and weapons use simple shapes. */
  private parts: PartLibrary | null = null;
  /** Cel-shading ramp and ink outline, shared by everything on stage. */
  private ramp: T.DataTexture | null = null;
  private ink: T.MeshBasicMaterial | null = null;
  /** Approval and objection stamps on the shared text (since the latest draft). */
  private stamps: Array<{ verdict: "approve" | "object"; mesh: T.Object3D }> = [];
  /** Fight lighting, dimmed for the elimination spotlight. */
  private stage: { sun: T.DirectionalLight; sky: T.HemisphereLight; drama: T.SpotLight; dim: number; focus: Avatar | null; until: number } | null = null;
  private clouds: T.Group | null = null;
  /** Each fighter's banner on the cage behind its spot, and the door torches' flames and lights. */
  private banners: Array<{ cloth: T.Object3D; phase: number }> = [];
  private torches: Array<{ flame: T.Object3D; light: T.PointLight; phase: number }> = [];
  /** The sky dome, tinted by the weather. */
  private dome: T.MeshBasicMaterial | null = null;
  /** Pennants on the cage; they flutter a little in the breeze. */
  private bunting: T.InstancedMesh | null = null;
  /** The cage door's two leaves (hinge groups) and how far they stand open (0 shut … 1 open). */
  private door: { leaves: T.Group[]; open: number } | null = null;
  /** The cage's crown, which glows gold for the winner. */
  private cageCrown: T.MeshToonMaterial | null = null;
  /** Furniture holders (table, chairs, podium, bench); each rebuilds itself from its recipe when the library arrives. */
  private props: T.Group[] = [];
  /** Camera shake from hits, fading out. */
  private shake = 0;
  /** Bloom and vignette. */
  private post: PostFx | null = null;
  /** Blade smears per fighter (by seat), dust puffs on the pitch, and comic speed lines on heavy blows. */
  private trails = new Map<string, SwingTrail>();
  private puffs: DustPuffs | null = null;
  private speedLines: SpeedLines | null = null;
  /** Birds, butterflies, leaves and moths round the stage (ambient.ts), and what they are placed by. */
  private ambient: Ambient | null = null;
  private crowns: T.Vector3[] = [];
  private flowerBeds: T.Vector3[] = [];
  private sills: Array<{ position: T.Vector3; outward: T.Vector3 }> = [];
  /** The viewer's place: where it stands, which way it faces, and where things handed to them land. */
  private honorSpot: { position: T.Vector3; yaw: number; lap: T.Vector3 } | null = null;
  private honorSeatProp: T.Group | null = null;
  /** The finished prompt, rolled up, resting at the viewer's box once there is a winner; and whether it is in flight. */
  private honorScroll: T.Group | null = null;
  private delivering = false;
  /** Round sprite for point effects (sparks, sweat, motes); undefined until first asked for, null without a canvas. */
  private dot: T.Texture | null | undefined;
  /** Scene time runs through slow motion and hit-stops; real time keeps the camera smooth. */
  private sceneTime = 0;
  private realTime = 0;
  private warp: { scale: number; until: number } = { scale: 1, until: 0 };
  /** The director's current shot, when it started, and the camera it is easing toward. */
  private shot: Shot = WIDE;
  private shotAt = 0;
  private manualUntil = 0;
  private readonly cam = { azimuth: 0.35, elevation: 0.5, distance: 10, ready: false };
  /** Weather over the field (fight) and what it currently is, from the real state of the council. */
  private sky: SkyFx | null = null;
  private weather: Weather | null = null;
  /** The room around the table: walls with barred windows on a night sky, moonlight, and the swaying lamp. */
  private room: {
    swing: T.Group;
    ambient: T.AmbientLight;
    moon: T.SpotLight;
    moonFace: T.MeshBasicMaterial;
    windows: Array<{ frame: T.Group; sky: T.MeshBasicMaterial; rain: T.LineSegments; drops: Float32Array }>;
    flash: number;
    nextFlash: number;
  } | null = null;
  /** Sweat drops flicked off overheated birds. */
  private sweat: { points: T.Points; velocity: Float32Array; age: Float32Array; next: number } | null = null;
  private disposed = false;

  constructor(private readonly three: Three, private readonly host: HTMLElement, private readonly options: ArenaSceneOptions) {
    const { mode } = options;
    this.renderer = new three.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = three.PCFShadowMap;
    this.renderer.toneMapping = three.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = mode === "collaboration" ? 1.05 : 1.0;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(this.renderer.domElement);

    this.scene = new three.Scene();
    const pmrem = new three.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.disposables.push(this.environment);
    this.camera = new three.PerspectiveCamera(42, 1, 0.1, 200);
    this.clock = new three.Timer();
    this.clock.connect(document);
    this.green = new three.Color(SPEAKING_GREEN);
    this.white = new three.Color("#eaf2ff");
    this.grey = new three.Color("#555a63");
    // The room is seen a little lower so the windows in the far wall frame the table.
    this.elevation = mode === "collaboration" ? 0.5 : 0.58;
    this.focus = this.baseFocus();
    this.distance = mode === "collaboration" ? 9.2 : 14.5;
    if (mode === "collaboration") this.buildRoom(); else { this.buildField(); this.buildBox(); }
    this.startAmbient();
    // The stage only exists for a council; anything that is not the team table is staged as the arena.
    this.post = new PostFx(three, this.renderer, this.scene, this.camera, mode === "collaboration" ? "collaboration" : "competition");

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.visibility = new IntersectionObserver(([entry]) => { this.visible = entry?.isIntersecting ?? true; });
    this.visibility.observe(host);
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    this.resize();
    this.loop();
    void loadArenaParts().then((parts) => {
      if (!parts || this.disposed) return;
      this.parts = parts;
      this.refit();
    });
  }

  // ───────────────────────────── public API ─────────────────────────────

  setSpeed(speed: number) { this.speed = Math.max(0.25, speed); }

  setSeats(seats: Seat[]) {
    const ids = new Set(seats.map((seat) => seat.id));
    for (const [id, avatar] of this.avatars) {
      if (ids.has(id) && this.avatars.get(id)!.seat.model === seats.find((seat) => seat.id === id)!.model) continue;
      this.scene.remove(avatar.root);
      this.avatars.delete(id);
    }
    const count = Math.max(seats.length, 3);
    seats.forEach((seat, index) => {
      const angle = Math.PI / 2 + (index / count) * Math.PI * 2;
      const radius = this.options.mode === "collaboration" ? 3.05 : 4.3;
      const home = new this.three.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      const bench = new this.three.Vector3(-2.75 + index * 1.1, 0.02, -9.1);
      const existing = this.avatars.get(seat.id);
      if (existing) {
        existing.home.copy(home);
        existing.homeYaw = yawToward(home, new this.three.Vector3(0, 0, 0));
        return;
      }
      const avatar = this.buildAvatar(seat, home, bench);
      this.avatars.set(seat.id, avatar);
      if (this.options.mode === "collaboration") this.buildChair(home);
      else this.hangBanner(seat, angle);
    });
    if (this.options.mode === "collaboration") this.placeHonorSeat(seats.length);
  }

  /** Swaps in the modelled parts: rebuilds every robot and weapon, then snaps back to the current moment. */
  private refit() {
    for (const holder of this.props ?? []) this.furnish(holder);
    for (const [id, old] of [...this.avatars]) {
      this.scene.remove(old.root);
      disposeTree(old.root);
      const avatar = this.buildAvatar(old.seat, old.home, old.bench);
      avatar.homeYaw = old.homeYaw;
      this.avatars.set(id, avatar);
    }
    for (const weapon of this.weapons.values()) {
      weapon.mesh.removeFromParent();
      disposeTree(weapon.mesh);
      weapon.mesh = this.buildWeapon(weapon.dimension);
      weapon.mesh.visible = false;
      this.scene.add(weapon.mesh);
      weapon.holder = null;
      weapon.drop = null;
      weapon.landed = true;
    }
    if (this.state) {
      const state = this.state;
      this.state = null;
      this.sync(state, null, false);
    }
  }

  /**
   * Shows the folded state of the timeline. With `event` and `animate`, the moment itself is acted out;
   * otherwise everything snaps into place (used for jumps and reduced motion).
   */
  sync(state: SceneState, event: CouncilEvent | null, animate: boolean) {
    const previous = this.state;
    this.state = state;
    this.addressee = event?.targetId ?? null;
    const motion = animate && !this.options.reducedMotion;
    for (const avatar of this.avatars.values()) {
      const id = avatar.seat.id;
      avatar.thinking = state.thinking.includes(id);
      avatar.active = state.speaker === id;
      avatar.failed = state.failed.includes(id) && !state.eliminated.includes(id);
      avatar.winner = state.winner === id;
      const eliminated = state.eliminated.includes(id);
      if (eliminated !== avatar.eliminated) {
        avatar.eliminated = eliminated;
        if (!motion || event?.kind !== "eliminated" || event.actorId !== id) {
          avatar.actions = [];
          this.placeAtRest(avatar);
        }
      }
      if (!motion) { avatar.actions = []; this.placeAtRest(avatar); }
    }
    if (this.options.mode === "competition") { this.syncWeapons(state, event, motion); this.syncScroll(state); }
    else this.syncTable(state, previous, event, motion);
    if (event && motion) this.act(event);
    // The director picks the shot for this moment (thinking blips keep the current one).
    const current = this.shot ?? WIDE;
    const shot = motion ? shotFor(event, this.options.mode, current) : WIDE;
    if (shot.kind !== current.kind || shot.subject !== current.subject || shot.other !== current.other) {
      this.shot = shot;
      this.shotAt = this.realTime ?? 0;
    }
  }

  /**
   * Sets the weather read off the council's real state. A heat wave (the system struggling) shakes every bird at once;
   * it never touches a score.
   */
  setWeather(weather: Weather, animate: boolean) {
    const previous = this.weather;
    this.weather = weather;
    this.sky?.set(weather.kind);
    this.ambient?.setWeather(weather.kind);
    if (animate && !this.options.reducedMotion && weather.kind === "heat" && previous?.kind !== "heat") this.heatWave();
  }

  private heatWave() {
    const now = this.now();
    for (const avatar of this.avatars.values()) {
      avatar.actions.push({ kind: "flinch", start: now + Math.random() * 0.15, duration: 0.55 / this.speed });
      avatar.hitFlash = Math.max(avatar.hitFlash, 0.75);
    }
    this.crowd?.cheer(0.6);
    this.shake = Math.min(1, this.shake + 0.3);
  }

  dispose() {
    this.post?.dispose();
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.clock.dispose();
    this.resizeObserver.disconnect();
    this.visibility.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    for (const effect of this.effects.splice(0)) effect.dispose();
    this.scene.traverse((object) => {
      const mesh = object as T.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as T.Material | T.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose?.();
    });
    this.disposables.forEach((entry) => entry.dispose());
    this.renderer.dispose();
    canvas.remove();
  }

  // ───────────────────────────── staging ─────────────────────────────

  private buildRoom() {
    const three = this.three;
    const scene = this.scene;
    const ramp = this.toonRamp();
    scene.background = new three.Color("#07060b");
    scene.fog = new three.FogExp2("#07060b", 0.072);

    const floor = new three.Mesh(new three.CircleGeometry(30, 64), toon(three, ramp, "#151219"));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    // A round rug with two woven bands.
    const rugBands: Array<[number, number, string]> = [[0, 5.1, "#2a1621"], [4.55, 4.75, "#6b3a3f"], [3.5, 3.6, "#4a2530"]];
    rugBands.forEach(([inner, outer, color], index) => {
      const band = new three.Mesh(inner ? new three.RingGeometry(inner, outer, 72) : new three.CircleGeometry(outer, 72), toon(three, ramp, color));
      band.rotation.x = -Math.PI / 2;
      band.position.y = 0.005 + index * 0.002;
      band.receiveShadow = true;
      scene.add(band);
    });

    // The table: bird-footed pedestal and a brass birdcage inlay in the top (simple shapes until the library loads).
    const wood = toon(three, ramp, "#8a5634");
    const brass = toon(three, ramp, "#c9973f");
    const table = this.prop({
      pieces: [["furn_table", wood], ["furn_table_inlay", brass]],
      fallback: () => {
        const top = new three.Mesh(new three.CylinderGeometry(2.3, 2.3, 0.12, 72), wood);
        top.position.y = 0.92;
        const rim = new three.Mesh(new three.TorusGeometry(2.3, 0.055, 10, 72), wood);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.92;
        const pedestal = new three.Mesh(new three.CylinderGeometry(0.28, 0.6, 0.86, 24), wood);
        pedestal.position.y = 0.43;
        const foot = new three.Mesh(new three.CylinderGeometry(0.85, 0.95, 0.08, 32), wood);
        foot.position.y = 0.04;
        return [top, rim, pedestal, foot];
      },
    });
    scene.add(table);

    // Lamp: a little brass birdcage lantern over the table, the room's only light; its bars throw shadows on the table.
    const lantern = new three.Group();
    const cable = new three.Mesh(new three.CylinderGeometry(0.012, 0.012, 4, 6), toon(three, ramp, "#1d2128"));
    cable.position.y = 6.2;
    lantern.add(cable);
    const cap = new three.Mesh(new three.SphereGeometry(0.24, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), brass);
    cap.position.y = 3.95;
    const hook = new three.Mesh(new three.TorusGeometry(0.07, 0.018, 8, 20), brass);
    hook.position.y = 4.24;
    const floorRing = new three.Mesh(new three.TorusGeometry(0.5, 0.028, 8, 40), brass);
    floorRing.rotation.x = Math.PI / 2;
    floorRing.position.y = 3.18;
    const perch = new three.Mesh(new three.CylinderGeometry(0.014, 0.014, 0.8, 6), brass);
    perch.rotation.z = Math.PI / 2;
    perch.position.y = 3.26;
    lantern.add(cap, hook, floorRing, perch);
    for (let k = 0; k < 12; k++) {
      const angle = (k / 12) * Math.PI * 2;
      const at = (radius: number, y: number) => new three.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      lantern.add(new three.Mesh(new three.TubeGeometry(new three.QuadraticBezierCurve3(at(0.21, 3.97), at(0.62, 3.62), at(0.5, 3.18)), 14, 0.013, 5), brass));
    }
    lantern.traverse((object) => { object.castShadow = true; });
    cable.castShadow = false;
    addOutlines(three, lantern, this.inkLine());
    const swing = new three.Group();
    swing.position.y = 8.2;
    lantern.position.y = -8.2;
    swing.add(lantern);
    scene.add(swing);
    const bulbMaterial = new three.MeshBasicMaterial({ color: "#ffd890" });
    const bulb = new three.Mesh(new three.SphereGeometry(0.15, 24, 16), bulbMaterial);
    bulb.position.y = 3.5 - 8.2;
    swing.add(bulb);
    const spot = new three.SpotLight("#ffcf8a", LAMP, 0, 0.78, 0.55, 1.6);
    spot.position.set(0, 3.48 - 8.2, 0);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0004;
    swing.add(spot);
    scene.add(spot.target);
    const fill = new three.PointLight("#ffb866", 6, 9, 1.8);
    fill.position.set(0, 3.1 - 8.2, 0);
    swing.add(fill);
    const ambient = new three.AmbientLight("#3a4a6a", 0.16);
    scene.add(ambient);
    this.buildWalls(ambient, swing);
    scene.add(new three.HemisphereLight("#6d7fa8", "#1a1012", 0.45));
    const glowMaterial = new three.MeshBasicMaterial({ color: "#ffcf8a", transparent: true, opacity: 0.16, blending: three.AdditiveBlending, depthWrite: false });
    const glow = new three.Mesh(new three.CircleGeometry(1.7, 48), glowMaterial);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.985;
    scene.add(glow);
    this.lamp = { spot, bulb: bulbMaterial, glow: glowMaterial, boost: 0 };

    // A faint visible cone under the lantern and dust drifting in it.
    this.beamCone = new three.MeshBasicMaterial({ color: "#ffcf8a", transparent: true, opacity: 0.05, blending: three.AdditiveBlending, depthWrite: false, side: three.DoubleSide });
    const cone = new three.Mesh(new three.ConeGeometry(1.95, 2.3, 48, 1, true), this.beamCone);
    cone.position.y = 3.18 - 2.3 / 2 - 8.2;
    swing.add(cone);
    const motes = 160;
    const dustPositions = new Float32Array(motes * 3);
    for (let index = 0; index < motes; index++) {
      const radius = Math.sqrt(Math.random()) * 1.5;
      const angle = Math.random() * Math.PI * 2;
      dustPositions.set([Math.cos(angle) * radius, 1.05 + Math.random() * 2.1, Math.sin(angle) * radius], index * 3);
    }
    const dustGeometry = new three.BufferGeometry();
    dustGeometry.setAttribute("position", new three.BufferAttribute(dustPositions, 3));
    this.dust = new three.Points(dustGeometry, new three.PointsMaterial({ color: "#ffe2b0", size: 0.04, map: this.dotMap(), transparent: true, opacity: 0.55, blending: three.AdditiveBlending, depthWrite: false }));
    scene.add(this.dust);

    // Paper sits right under the lantern: a mid cream reads as bright paper there without blowing out (so the
    // stamps on it stay legible).
    const documentMaterial = new three.MeshStandardMaterial({ color: PAPER, emissive: "#ffe9b0", emissiveIntensity: 0.08, roughness: 0.8, side: three.DoubleSide, transparent: true, opacity: 0 });
    this.documentMesh = new three.Mesh(new three.PlaneGeometry(0.75, 1), documentMaterial);
    this.documentMesh.rotation.x = -Math.PI / 2;
    this.documentMesh.position.y = 0.99;
    scene.add(this.documentMesh);
  }

  private buildField() {
    const three = this.three;
    const scene = this.scene;
    const ramp = this.toonRamp();
    scene.background = new three.Color("#8fd3ff");
    scene.fog = new three.Fog("#8fd3ff", 28, 75);
    const lawn = toon(three, ramp, "#ffffff", { map: this.stripes("#5cb653", "#52ab4a", 30) });
    const grass = new three.Mesh(new three.CircleGeometry(60, 64), lawn);
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    scene.add(grass);
    const turf = toon(three, ramp, "#ffffff", { map: this.stripes("#6fcd63", "#63c158", 7) });
    const pitch = new three.Mesh(new three.CircleGeometry(6.6, 64), turf);
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.y = 0.004;
    pitch.receiveShadow = true;
    scene.add(pitch);
    const lineMaterial = new three.MeshBasicMaterial({ color: "#f4fbf1", transparent: true, opacity: 0.85 });
    for (const [inner, outer] of [[6.45, 6.6], [1.15, 1.25]] as const) {
      const line = new three.Mesh(new three.RingGeometry(inner, outer, 72), lineMaterial);
      line.rotation.x = -Math.PI / 2;
      line.position.y = 0.01;
      scene.add(line);
    }
    const sky = new three.HemisphereLight("#e4f4ff", "#3b6b2f", 1.35);
    scene.add(sky);
    const sun = new three.DirectionalLight("#fff3d6", 2.6);
    sun.position.set(7, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 40 });
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun);
    // The stage dims and a spotlight finds the eliminated fighter for a moment of drama.
    const drama = new three.SpotLight("#fff4d6", 0, 0, 0.22, 0.5, 1.2);
    drama.position.set(0, 13, 2);
    scene.add(drama, drama.target);
    this.stage = { sun, sky, drama, dim: 0, focus: null, until: 0 };

    const stone = toon(three, ramp, "#efe9dc");
    const goldTrim = toon(three, ramp, "#f2c14e");
    const podium = this.prop({
      pieces: [["furn_podium", stone], ["furn_podium_gold", goldTrim]],
      fallback: () => {
        const plinth = new three.Mesh(new three.CylinderGeometry(1.05, 1.15, 0.28, 40), stone);
        plinth.position.y = 0.14;
        const top = new three.Mesh(new three.CylinderGeometry(0.82, 0.9, 0.27, 40), stone);
        top.position.y = 0.415;
        const trim = new three.Mesh(new three.TorusGeometry(0.84, 0.035, 8, 48), goldTrim);
        trim.rotation.x = Math.PI / 2;
        trim.position.y = 0.55;
        return [plinth, top, trim];
      },
    });
    podium.visible = false;
    podium.scale.y = 0.001;
    scene.add(podium);
    const podiumSpot = new three.SpotLight("#fff1c1", 0, 0, 0.32, 0.45, 1.1);
    podiumSpot.position.set(0, 10, 0.5);
    podiumSpot.target.position.set(0, 0, 0);
    scene.add(podiumSpot, podiumSpot.target);
    this.podium = { group: podium, spot: podiumSpot, rise: 0 };

    // Jury bench for eliminated fighters, outside the cage's door; they keep voting from here.
    const juryBench = new three.Group();
    const benchWood = toon(three, ramp, "#9a6a3c");
    const bench = this.prop({
      pieces: [["furn_bench", benchWood]],
      fallback: () => {
        const seat = new three.Mesh(new three.BoxGeometry(7.2, 0.12, 0.8), benchWood);
        seat.position.set(0, 0.55, 0);
        const legs = [-3.3, 0, 3.3].map((x) => {
          const leg = new three.Mesh(new three.BoxGeometry(0.12, 0.55, 0.7), benchWood);
          leg.position.set(x, 0.27, 0);
          return leg;
        });
        return [seat, ...legs];
      },
    });
    bench.position.set(0, 0, -9.1);
    scene.add(bench);
    const sign = new three.Mesh(new three.BoxGeometry(2.6, 0.62, 0.08), toon(three, ramp, "#20324a"));
    sign.position.set(0, 1.85, -9.6);
    const post = new three.Mesh(new three.CylinderGeometry(0.05, 0.05, 1.6, 8), benchWood);
    post.position.set(0, 0.8, -9.62);
    juryBench.add(sign, post);
    juryBench.traverse((object) => { object.castShadow = true; });
    addOutlines(three, juryBench, this.inkLine());
    const label = this.signText("JÜRİ");
    if (label) { label.position.set(0, 1.85, -9.555); juryBench.add(label); }
    scene.add(juryBench);
    this.crowd = new Crowd(three, scene, this.options.reducedMotion, Math.random, { ramp, ink: this.inkLine() });
    this.disposables.push(this.crowd);
    if (!this.options.reducedMotion) {
      // Dust puffs are unit spheres scaled down, so their ink line is drawn thicker to look the same weight.
      const puffInk = outlineMaterial(three, 0.1);
      this.disposables.push(puffInk);
      this.puffs = new DustPuffs(three, toon(three, ramp, "#ffffff"));
      addOutlines(three, this.puffs.mesh, puffInk);
      scene.add(this.puffs.mesh);
      this.speedLines = new SpeedLines(three);
      this.camera.add(this.speedLines.mesh);
      scene.add(this.camera);
    }
    this.buildCage();
    this.buildGrounds();

    // Cartoon trees (cones and round crowns), a few bushes and slow clouds.
    const scenery = new three.Group();
    const trunk = toon(three, ramp, "#7a5332");
    const leaves = [toon(three, ramp, "#3f8f3a"), toon(three, ramp, "#4fa245"), toon(three, ramp, "#2f7a34")];
    for (let index = 0; index < 16; index++) {
      const angle = (index / 16) * Math.PI * 2 + 0.2;
      const radius = 15 + (index % 3) * 2.2;
      const tree = new three.Group();
      const stem = new three.Mesh(new three.CylinderGeometry(0.15, 0.22, 1.2, 8), trunk);
      stem.position.y = 0.6;
      tree.add(stem);
      if (index % 2) {
        for (const [y, r] of [[1.9, 1.1], [2.9, 0.85], [3.7, 0.55]] as const) {
          const tier = new three.Mesh(new three.ConeGeometry(r, 1.2, 9), leaves[index % 3]);
          tier.position.y = y;
          tree.add(tier);
        }
      } else {
        for (const [x, y, z, r] of [[0, 2.2, 0, 1.05], [0.55, 1.85, 0.2, 0.7], [-0.5, 1.95, -0.15, 0.75], [0.1, 2.85, 0.1, 0.65]] as const) {
          const puff = new three.Mesh(new three.IcosahedronGeometry(r, 1), leaves[(index + 1) % 3]);
          puff.position.set(x, y, z);
          tree.add(puff);
        }
      }
      tree.traverse((object) => { object.castShadow = true; });
      tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      (this.crowns ??= []).push(tree.position.clone().setY(2.3));
      tree.rotation.y = angle * 3;
      scenery.add(tree);
    }
    for (let index = 0; index < 22; index++) {
      const angle = (index / 22) * Math.PI * 2 + 0.07;
      const bush = new three.Mesh(new three.IcosahedronGeometry(0.45 + (index % 3) * 0.12, 1), leaves[index % 3]);
      bush.position.set(Math.cos(angle) * 12.6, 0.25, Math.sin(angle) * 12.6);
      bush.scale.y = 0.75;
      bush.castShadow = true;
      scenery.add(bush);
    }
    const forest = bakeStatic(three, scenery);
    addOutlines(three, forest, this.inkLine());
    scene.add(forest);
    const clouds = new three.Group();
    const fluff = toon(three, ramp, "#ffffff", { emissive: "#ffffff", emissiveIntensity: 0.35 });
    for (let index = 0; index < 7; index++) {
      const cloud = new three.Group();
      for (const [x, y, r] of [[0, 0, 1.6], [1.5, -0.2, 1.2], [-1.5, -0.25, 1.15], [0.6, 0.6, 1.0]] as const) {
        const puff = new three.Mesh(new three.IcosahedronGeometry(r, 2), fluff);
        puff.position.set(x, y, 0);
        cloud.add(puff);
      }
      const angle = (index / 7) * Math.PI * 2 + 0.5;
      cloud.position.set(Math.cos(angle) * 34, 15 + (index % 3) * 2.5, Math.sin(angle) * 34);
      cloud.lookAt(0, cloud.position.y, 0);
      clouds.add(cloud);
    }
    this.sky = new SkyFx(three, scene, fluff, this.options.reducedMotion, [lawn, turf]);
    this.disposables.push(this.sky);
    const cloudBank = bakeStatic(three, clouds);
    cloudBank.traverse((object) => { object.castShadow = false; });
    scene.add(cloudBank);
    this.clouds = cloudBank;

    COUNCIL_DIMENSIONS.forEach((dimension, index) => {
      const angle = (index / COUNCIL_DIMENSIONS.length) * Math.PI * 2 + Math.PI / 6;
      const spot = new three.Vector3(Math.cos(angle) * 1.9, 0, Math.sin(angle) * 1.9);
      const mesh = this.buildWeapon(dimension);
      mesh.visible = false;
      scene.add(mesh);
      this.weapons.set(dimension, { dimension, mesh, holder: null, spot, drop: null, landed: true });
    });
  }

  /**
   * The fight happens inside a giant golden birdcage, PRISON's own arena. The back stays open as the door that
   * eliminated fighters walk through to the jury bench.
   */
  private buildCage() {
    const three = this.three;
    const gold = toon(three, this.toonRamp(), "#e9b949");
    const crownGold = toon(three, this.toonRamp(), "#f2c14e");
    const cage = new three.Group();
    const base = CAGE_RADIUS;
    const height = 7.9;
    const door = DOOR_HALF;
    const curveAt = (angle: number) => {
      const at = (radius: number, y: number) => new three.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      return new three.CubicBezierCurve3(at(base, 0), at(base + 0.2, 4.3), at(base * 0.6, height - 0.25), at(1.05, height));
    };
    // Few, slim bars: the cage frames the fight without hiding it.
    const bars = 16;
    for (let k = 0; k < bars; k++) {
      const angle = (k / bars) * Math.PI * 2;
      if (Math.abs(this.angleDelta(angle, DOOR_ANGLE)) < door) continue;
      cage.add(new three.Mesh(new three.TubeGeometry(curveAt(angle), 32, 0.034, 6), gold));
    }
    // Rings round the bars at a few heights, open at the door.
    const profile = curveAt(0);
    const start = -Math.PI / 2 + door;
    for (const t of [0, 0.62]) {
      const point = profile.getPoint(t);
      const radius = Math.hypot(point.x, point.z);
      const holder = new three.Group();
      holder.rotation.y = -start;
      const ring = new three.Mesh(new three.TorusGeometry(radius, t === 0 ? 0.09 : 0.055, 8, 96, Math.PI * 2 - door * 2), gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = point.y + (t === 0 ? 0.06 : 0);
      holder.add(ring);
      cage.add(holder);
    }
    // Festive bunting strung between neighbouring bars, sagging a little, in the seat colours (never green).
    const sag = profile.getPoint(0.36);
    const lineHeight = sag.y;
    const lineRadius = Math.hypot(sag.x, sag.z);
    const spans: Array<[number, number]> = [];
    for (let k = 0; k < bars; k++) {
      const from = (k / bars) * Math.PI * 2;
      const to = ((k + 1) / bars) * Math.PI * 2;
      if (Math.abs(this.angleDelta(from, -Math.PI / 2)) < door || Math.abs(this.angleDelta(to, -Math.PI / 2)) < door) continue;
      spans.push([from, to]);
    }
    const flagsPerSpan = 5;
    const flag = new three.BufferGeometry();
    flag.setAttribute("position", new three.Float32BufferAttribute([-0.13, 0, 0, 0.13, 0, 0, 0, -0.3, 0], 3));
    flag.setAttribute("normal", new three.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    const flags = new three.InstancedMesh(flag, toon(three, this.toonRamp(), "#ffffff", { side: three.DoubleSide }), spans.length * flagsPerSpan);
    const palette = ["#f2c14e", "#ec4899", "#3b82f6", "#f97316", "#8b5cf6", "#ffffff"].map((hex) => new three.Color(hex));
    const placer = new three.Object3D();
    const string: number[] = [];
    let index = 0;
    for (const [from, to] of spans) {
      const point = (t: number) => {
        const angle = from + (to - from) * t;
        return new three.Vector3(Math.cos(angle) * lineRadius, lineHeight - Math.sin(t * Math.PI) * 0.45, Math.sin(angle) * lineRadius);
      };
      for (let step = 0; step < 8; step++) string.push(...point(step / 8).toArray(), ...point((step + 1) / 8).toArray());
      for (let f = 0; f < flagsPerSpan; f++) {
        const t = (f + 0.5) / flagsPerSpan;
        const at = point(t);
        placer.position.copy(at);
        placer.lookAt(at.x * 2, at.y, at.z * 2);
        placer.updateMatrix();
        flags.setMatrixAt(index, placer.matrix);
        flags.setColorAt(index, palette[index % palette.length]);
        index++;
      }
    }
    flags.castShadow = true;
    // Paper-thin pennants: an ink shell would sit right on top of them.
    flags.userData.noOutline = true;
    const cord = new three.LineSegments(new three.BufferGeometry().setAttribute("position", new three.Float32BufferAttribute(string, 3)), new three.LineBasicMaterial({ color: "#5b4636" }));
    cage.add(flags, cord);
    this.bunting = flags;

    // Door arch, crown cap and the hook the whole cage hangs from.
    const arch = new three.Mesh(new three.TorusGeometry(base * Math.sin(door), 0.07, 8, 40, Math.PI), gold);
    arch.position.set(0, 3.4, -base * Math.cos(door));
    cage.add(arch);
    const crown = new three.Mesh(new three.SphereGeometry(1.25, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), crownGold);
    crown.position.y = height - 0.15;
    crown.scale.y = 0.45;
    const knob = new three.Mesh(new three.SphereGeometry(0.28, 20, 14), crownGold);
    knob.position.y = height + 0.48;
    const hook = new three.Mesh(new three.TorusGeometry(0.42, 0.08, 10, 32), crownGold);
    hook.position.y = height + 1.12;
    cage.add(crown, knob, hook);
    // Everything fixed is baked into a few meshes; the pennants, their cord and the door stay separate.
    cage.remove(flags, cord);
    const frame = bakeStatic(three, cage);
    addOutlines(three, frame, this.inkLine());
    frame.add(flags, cord);

    // The door: two gate leaves hinged on the bars either side of the opening. They swing out for the walk to the bench.
    const hingeX = base * Math.sin(door);
    const doorZ = -base * Math.cos(door);
    const leaves: T.Group[] = [];
    for (const side of [-1, 1]) {
      const hinge = new three.Group();
      hinge.position.set(side * hingeX, 0, doorZ);
      const leaf = new three.Group();
      const width = hingeX - 0.05;
      const tall = 3.25;
      const inward = -side;
      const rod = (radius: number, length: number, x: number, y: number, flat: boolean) => {
        const mesh = new three.Mesh(new three.CylinderGeometry(radius, radius, length, 8), gold);
        mesh.position.set(x, y, 0);
        if (flat) mesh.rotation.z = Math.PI / 2;
        leaf.add(mesh);
      };
      rod(0.05, tall, 0, tall / 2, false);
      rod(0.05, tall, inward * width, tall / 2, false);
      for (const y of [0.12, tall * 0.55, tall]) rod(0.04, width, (inward * width) / 2, y, true);
      for (let k = 1; k <= 4; k++) rod(0.026, tall * 0.55 - 0.12, inward * width * (k / 5), (0.12 + tall * 0.55) / 2, false);
      // A ring with a little perch-bar cross in the upper panel, the cage's own emblem.
      const emblem = new three.Mesh(new three.TorusGeometry(0.42, 0.035, 8, 32), crownGold);
      emblem.position.set((inward * width) / 2, tall * 0.78, 0);
      leaf.add(emblem);
      rod(0.022, 0.84, (inward * width) / 2, tall * 0.78, true);
      rod(0.022, 0.84, (inward * width) / 2, tall * 0.78, false);
      const bakedLeaf = bakeStatic(three, leaf);
      addOutlines(three, bakedLeaf, this.inkLine());
      hinge.add(bakedLeaf);
      frame.add(hinge);
      leaves.push(hinge);
    }
    this.door = { leaves, open: 0 };
    this.cageCrown = crownGold;
    this.scene.add(frame);
  }

  /**
   * The room, seen like a cut-away doll's house: a round wall drawn only from the inside, so the half nearest the camera
   * vanishes and the far half stays. Three round windows barred like a birdcage look out on a night sky; the moon in
   * the main one throws its light, and the bars' shadows, across the table.
   */
  private buildWalls(ambient: T.AmbientLight, swing: T.Group) {
    const three = this.three;
    const ramp = this.toonRamp();
    const wall = new three.Mesh(new three.CylinderGeometry(6, 6, 6.5, 72, 1, true), toon(three, ramp, "#1a1522", { side: three.BackSide }));
    wall.position.y = 3.25;
    wall.receiveShadow = true;
    this.scene.add(wall);
    const brass = toon(three, ramp, "#b88d42", { fog: false, emissive: "#3a2810" });
    const windows: Array<{ frame: T.Group; sky: T.MeshBasicMaterial; rain: T.LineSegments; drops: Float32Array }> = [];
    let moonFace: T.MeshBasicMaterial | null = null;
    let moonAt = new three.Vector3();
    for (const [angle, main] of [[-Math.PI / 2, true], [Math.PI / 6, false], [(Math.PI * 5) / 6, false]] as const) {
      const frame = new three.Group();
      frame.position.set(Math.cos(angle) * 5.92, 2.7, Math.sin(angle) * 5.92);
      frame.lookAt(0, 2.7, 0);
      frame.scale.setScalar(0.82);
      // The night sky through the glass: a gradient from deep blue at the top to violet at the horizon, and stars.
      const disc = new three.CircleGeometry(1.7, 48);
      const colors: number[] = [];
      const top = new three.Color("#1f3570");
      const low = new three.Color("#5a4690");
      const position = disc.getAttribute("position");
      for (let index = 0; index < position.count; index++) {
        const mix = new three.Color().lerpColors(low, top, (position.getY(index) / 1.7 + 1) / 2);
        colors.push(mix.r, mix.g, mix.b);
      }
      disc.setAttribute("color", new three.Float32BufferAttribute(colors, 3));
      const sky = new three.MeshBasicMaterial({ vertexColors: true, fog: false });
      frame.add(new three.Mesh(disc, sky));
      const stars: number[] = [];
      for (let index = 0; index < 34; index++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 1.6;
        stars.push(Math.cos(a) * r, Math.sin(a) * r * 0.9 + 0.1, 0.02);
      }
      const starField = new three.Points(new three.BufferGeometry().setAttribute("position", new three.Float32BufferAttribute(stars, 3)),
        new three.PointsMaterial({ color: "#fff6e0", size: 0.07, fog: false }));
      frame.add(starField);
      if (main) {
        moonFace = new three.MeshBasicMaterial({ color: "#fff3cf", fog: false, transparent: true });
        const moon = new three.Mesh(new three.CircleGeometry(0.4, 32), moonFace);
        moon.position.set(0.62, 0.62, 0.03);
        const halo = new three.Mesh(new three.CircleGeometry(0.6, 32), new three.MeshBasicMaterial({ color: "#c9d8ff", transparent: true, opacity: 0.18, fog: false, depthWrite: false }));
        halo.position.set(0.62, 0.62, 0.025);
        frame.add(halo, moon);
        frame.updateMatrixWorld(true);
        moonAt = moon.getWorldPosition(new three.Vector3());
      }
      // Rain running down the glass; shown only in wet weather.
      const drops = new Float32Array(44 * 6);
      for (let index = 0; index < 44; index++) this.placeStreak(drops, index, Math.random() * 3.4 - 1.7);
      const rain = new three.LineSegments(new three.BufferGeometry().setAttribute("position", new three.BufferAttribute(drops, 3)),
        new three.LineBasicMaterial({ color: "#b9d2ff", transparent: true, opacity: 0.55, fog: false }));
      rain.visible = false;
      rain.frustumCulled = false;
      frame.add(rain);
      // Frame, cage bars and a sill.
      const bars = new three.Group();
      bars.add(new three.Mesh(new three.TorusGeometry(1.74, 0.09, 10, 64), brass));
      for (const x of [-1.05, -0.52, 0, 0.52, 1.05]) {
        const length = 2 * Math.sqrt(1.72 ** 2 - x ** 2);
        const bar = new three.Mesh(new three.CylinderGeometry(0.035, 0.035, length, 8), brass);
        bar.position.set(x, 0, 0.06);
        bars.add(bar);
      }
      const rail = new three.Mesh(new three.CylinderGeometry(0.035, 0.035, 3.44, 8), brass);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, -0.3, 0.06);
      const sill = new three.Mesh(new three.BoxGeometry(2.6, 0.12, 0.45), toon(three, ramp, "#3a2a22", { fog: false }));
      sill.position.set(0, -1.86, 0.15);
      bars.add(rail, sill);
      addOutlines(three, bars, this.inkLine());
      frame.add(bars);
      this.scene.add(frame);
      windows.push({ frame, sky, rain, drops });
      // The ledge outside, where little wild birds come and sit (ambient.ts).
      frame.updateMatrixWorld(true);
      const ledge = frame.getWorldPosition(new three.Vector3());
      (this.sills ??= []).push({
        position: frame.localToWorld(new three.Vector3(0.55, -1.8, 0.12)),
        outward: frame.localToWorld(new three.Vector3(0, 0, -1)).sub(ledge).setY(0).normalize(),
      });
      if (main) {
        // An invisible copy of the bars that always casts their shadow, even while the window itself is hidden.
        const caster = bars.clone(true);
        const nothing = new three.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
        caster.traverse((object) => {
          const mesh = object as T.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = nothing;
          mesh.castShadow = !mesh.userData.outline;
          if (mesh.userData.outline) mesh.visible = false;
        });
        caster.position.copy(frame.position);
        caster.quaternion.copy(frame.quaternion);
        caster.scale.copy(frame.scale);
        this.scene.add(caster);
      }
    }
    // Moonlight: a cool beam from the main window onto the table, striped by the window's bars.
    const moon = new three.SpotLight("#9db8ff", 22, 0, 0.3, 0.45, 1);
    moon.position.copy(moonAt.lengthSq() ? moonAt.clone().multiplyScalar(1.02) : new three.Vector3(0, 3.2, -6.1));
    moon.target.position.set(0, 0.9, 0);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.bias = -0.0005;
    this.scene.add(moon, moon.target);
    this.room = { swing, ambient, moon, moonFace: moonFace!, windows, flash: 0, nextFlash: 3 };
  }

  /** A raindrop streak on a window pane (window space, inside the round glass). */
  private placeStreak(drops: Float32Array, index: number, y: number) {
    const x = (Math.random() - 0.5) * 3;
    const top = Math.min(y + 0.18, Math.sqrt(Math.max(0, 1.65 ** 2 - x ** 2)));
    drops.set([x, Math.max(y, -Math.sqrt(Math.max(0, 1.65 ** 2 - x ** 2))), 0.04, x + 0.01, top, 0.04], index * 6);
  }

  /** Night outside the room: the lamp sways, rain runs down the glass, the moon hides behind storm clouds, lightning flashes. */
  private updateRoom(delta: number, now: number) {
    const room = this.room;
    if (!room) return;
    const motion = !this.options.reducedMotion;
    const kind = this.weather?.kind;
    const wet = kind === "rainy" || kind === "storm";
    if (motion) {
      const gust = kind === "storm" ? 1.8 : 1;
      room.swing.rotation.z = Math.sin(now * 0.9) * 0.024 * gust;
      room.swing.rotation.x = Math.sin(now * 0.7 + 1) * 0.017 * gust;
    }
    // Lightning only in a storm; a cold blue flash through the windows.
    room.flash = Math.max(0, room.flash - delta * 4);
    if (kind === "storm" && motion && now > room.nextFlash) {
      room.flash = 1;
      room.nextFlash = now + 2 + Math.random() * 3.5;
      this.options.onCue?.("thunder", 0.7);
      this.ambient?.startle(0.8);
      this.shake = Math.min(1, this.shake + 0.15);
    }
    room.ambient.intensity = 0.16 + room.flash * 1.6;
    room.ambient.color.set(room.flash > 0.05 ? "#9fb6ff" : "#3a4a6a");
    room.moon.intensity = (wet ? 7 : 22) + room.flash * 60;
    room.moonFace.opacity = wet ? 0.35 : 1;
    const camera = new this.three.Vector3(this.camera?.position.x ?? 0, 0, this.camera?.position.z ?? 1);
    for (const window of room.windows) {
      // Windows on the near side of the cut-away are hidden with the wall they sit in.
      window.frame.visible = window.frame.position.x * camera.x + window.frame.position.z * camera.z < 0;
      const glow = 1 + room.flash * 3;
      window.sky.color.setRGB(glow, glow, glow * (kind === "heat" ? 0.8 : 1));
      window.rain.visible = wet && motion;
      if (!window.rain.visible) continue;
      for (let index = 0; index < window.drops.length / 6; index++) {
        const base = index * 6;
        window.drops[base + 1] -= delta * 1.6;
        window.drops[base + 4] -= delta * 1.6;
        if (window.drops[base + 4] < -1.6) this.placeStreak(window.drops, index, 1.5);
      }
      window.rain.geometry.getAttribute("position").needsUpdate = true;
    }
  }

  /**
   * The grounds around the cage: a sky dome brighter at the horizon, rolling hills far off, a ring of paving stones
   * inside the cage's foot, the cage emblem painted at the centre spot, torches at the door, and flowers and stones on
   * the lawn. Static pieces are baked to keep draw calls low.
   */
  private buildGrounds() {
    const three = this.three;
    const ramp = this.toonRamp();

    // Sky dome: the weather tints it, the vertex shade makes the horizon glow and the zenith deepen.
    const sphere = new three.SphereGeometry(90, 32, 16);
    const shade: number[] = [];
    const position = sphere.getAttribute("position");
    for (let index = 0; index < position.count; index++) {
      const up = position.getY(index) / 90;
      const value = up > 0 ? 1.08 - up * 0.36 : 1.0 + up * 0.25;
      shade.push(value, value, Math.min(1.1, value + up * 0.08));
    }
    sphere.setAttribute("color", new three.Float32BufferAttribute(shade, 3));
    this.dome = new three.MeshBasicMaterial({ vertexColors: true, side: three.BackSide, fog: false, depthWrite: false });
    const dome = new three.Mesh(sphere, this.dome);
    dome.renderOrder = -1;
    this.scene.add(dome);

    // Rolling hills on the horizon, softened by the haze.
    const hills = new three.Group();
    const greens = ["#3f7f45", "#4b8d4c", "#356e3f"].map((hex) => toon(three, ramp, hex));
    for (let index = 0; index < 22; index++) {
      const angle = (index / 22) * Math.PI * 2 + (index % 3) * 0.07;
      const radius = 46 + (index % 4) * 3.5;
      const hill = new three.Mesh(new three.IcosahedronGeometry(1, 2), greens[index % 3]);
      hill.position.set(Math.cos(angle) * radius, -1.5, Math.sin(angle) * radius);
      hill.scale.set(9 + (index % 5) * 2.2, 5 + (index % 4) * 2.4, 7 + (index % 3) * 2);
      hill.rotation.y = angle;
      hills.add(hill);
    }
    const baked = bakeStatic(three, hills);
    baked.traverse((object) => { object.castShadow = false; });
    this.scene.add(baked);

    // Paving stones in a ring at the cage's foot, and the cage emblem painted on the centre spot.
    const paving = new three.Group();
    const stone = toon(three, ramp, "#d4cbb8");
    const darker = toon(three, ramp, "#bfb5a1");
    for (let index = 0; index < 56; index++) {
      const angle = (index / 56) * Math.PI * 2;
      const tile = new three.Mesh(new three.BoxGeometry(0.74, 0.06, 0.46), index % 2 ? stone : darker);
      tile.position.set(Math.cos(angle) * 6.92, 0.03, Math.sin(angle) * 6.92);
      tile.rotation.y = -angle + Math.PI / 2;
      paving.add(tile);
    }
    const pavingBaked = bakeStatic(three, paving);
    pavingBaked.traverse((object) => { object.castShadow = false; object.receiveShadow = true; });
    addOutlines(three, pavingBaked, this.inkLine());
    this.scene.add(pavingBaked);
    const paint = new three.MeshBasicMaterial({ color: "#f4fbf1", transparent: true, opacity: 0.85 });
    const emblem = new three.Group();
    const strip = (x1: number, z1: number, x2: number, z2: number, width = 0.07) => {
      const length = Math.hypot(x2 - x1, z2 - z1);
      const bar = new three.Mesh(new three.PlaneGeometry(length, width).rotateX(-Math.PI / 2), paint);
      bar.position.set((x1 + x2) / 2, 0.013, (z1 + z2) / 2);
      bar.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      emblem.add(bar);
    };
    const dome2 = 0.62;
    for (let k = 0; k < 16; k++) {
      const a1 = Math.PI * (k / 16);
      const a2 = Math.PI * ((k + 1) / 16);
      strip(dome2 * Math.cos(a1), -0.1 - dome2 * Math.sin(a1), dome2 * Math.cos(a2), -0.1 - dome2 * Math.sin(a2));
    }
    for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) strip(x, 0.62, x, -0.1 - Math.sqrt(Math.max(0, dome2 ** 2 - x ** 2)) * 0.97, 0.05);
    strip(-0.72, 0.62, 0.72, 0.62, 0.1);
    for (let k = 0; k < 12; k++) {
      const a1 = (Math.PI * 2 * k) / 12;
      const a2 = (Math.PI * 2 * (k + 1)) / 12;
      strip(0.1 * Math.cos(a1), -0.86 + 0.1 * Math.sin(a1), 0.1 * Math.cos(a2), -0.86 + 0.1 * Math.sin(a2), 0.04);
    }
    this.scene.add(emblem);

    // Torches either side of the cage door.
    const wood = toon(three, ramp, "#6b4a2b");
    const iron = toon(three, ramp, "#3a3a44");
    for (const side of [-1, 1]) {
      const torch = new three.Group();
      torch.position.set(side * 3.45, 0, -7.05);
      const post = new three.Mesh(new three.CylinderGeometry(0.07, 0.1, 2.1, 10), wood);
      post.position.y = 1.05;
      const bowl = new three.Mesh(new three.CylinderGeometry(0.26, 0.14, 0.22, 16), iron);
      bowl.position.y = 2.2;
      torch.add(post, bowl);
      torch.traverse((object) => { object.castShadow = true; });
      addOutlines(three, torch, this.inkLine());
      const flame = new three.Group();
      flame.position.y = 2.32;
      const outer = new three.Mesh(new three.ConeGeometry(0.2, 0.62, 12).translate(0, 0.31, 0), new three.MeshBasicMaterial({ color: "#ff8a2a", transparent: true, opacity: 0.9 }));
      const inner = new three.Mesh(new three.ConeGeometry(0.11, 0.38, 10).translate(0, 0.19, 0), new three.MeshBasicMaterial({ color: "#ffe28a" }));
      flame.add(outer, inner);
      torch.add(flame);
      const light = new three.PointLight("#ff9a40", 5, 7, 1.6);
      light.position.y = 2.6;
      torch.add(light);
      this.scene.add(torch);
      this.torches.push({ flame, light, phase: side * 1.7 });
    }

    // Flowers in clumps and a scatter of stones on the lawn (between the cage and the stands, and beyond).
    const count = 160;
    const petals = new three.InstancedMesh(new three.IcosahedronGeometry(0.09, 0), toon(three, ramp, "#ffffff"), count);
    const stems = new three.InstancedMesh(new three.CylinderGeometry(0.012, 0.012, 0.22, 4).translate(0, 0.11, 0), toon(three, ramp, "#3d7a35"), count);
    const placer = new three.Object3D();
    const colours = ["#ffd1e8", "#fff3a3", "#ffffff", "#d8c8ff", "#ffc29e"].map((hex) => new three.Color(hex));
    for (let index = 0; index < count; index++) {
      const clump = Math.floor(index / 8);
      const angle = clump * 2.4 + (index % 8) * 0.03;
      if (Math.abs(this.angleDelta(angle, DOOR_ANGLE)) < 0.75) continue;
      const radius = (clump % 2 ? 7.75 : 12.4) + Math.sin(index * 7.1) * 0.25;
      const x = Math.cos(angle) * radius + Math.sin(index * 3.3) * 0.25;
      const z = Math.sin(angle) * radius + Math.cos(index * 5.1) * 0.25;
      if (index % 8 === 0) (this.flowerBeds ??= []).push(new three.Vector3(x, 0, z));
      placer.position.set(x, 0, z);
      placer.scale.setScalar(0.8 + ((index * 37) % 10) / 20);
      placer.updateMatrix();
      stems.setMatrixAt(index, placer.matrix);
      placer.position.y = 0.22 * placer.scale.y;
      placer.updateMatrix();
      petals.setMatrixAt(index, placer.matrix);
      petals.setColorAt(index, colours[index % colours.length]);
    }
    const stones = new three.Group();
    const rock = toon(three, ramp, "#9a978f");
    for (let index = 0; index < 26; index++) {
      const angle = index * 2.07 + 0.4;
      if (Math.abs(this.angleDelta(angle, DOOR_ANGLE)) < 0.8) continue;
      const radius = index % 3 ? 7.9 + (index % 2) * 0.3 : 12 + (index % 4) * 0.5;
      const pebble = new three.Mesh(new three.IcosahedronGeometry(0.16 + (index % 4) * 0.06, 0), rock);
      pebble.position.set(Math.cos(angle) * radius, 0.06, Math.sin(angle) * radius);
      pebble.scale.y = 0.55;
      pebble.rotation.y = index;
      stones.add(pebble);
    }
    const stonesBaked = bakeStatic(three, stones);
    addOutlines(three, stonesBaked, this.inkLine());
    this.scene.add(petals, stems, stonesBaked);
  }

  /** A fighter's banner in its seat colour, hung on the cage behind its spot, with its seat number. */
  private hangBanner(seat: Seat, angle: number) {
    const three = this.three;
    this.banners ??= [];
    if (this.banners.some((banner) => banner.cloth.userData.seat === seat.id)) return;
    const ramp = this.toonRamp();
    const holder = new three.Group();
    holder.position.set(Math.cos(angle) * 6.35, 5.3, Math.sin(angle) * 6.35);
    holder.lookAt(0, 5.3, 0);
    const rod = new three.Mesh(new three.CylinderGeometry(0.03, 0.03, 1.15, 8).rotateZ(Math.PI / 2), toon(three, ramp, "#f2c14e"));
    holder.add(rod);
    const cloth = new three.Group();
    const outline = new three.Shape();
    outline.moveTo(-0.5, 0);
    outline.lineTo(0.5, 0);
    outline.lineTo(0.5, -1.7);
    outline.lineTo(0, -1.35);
    outline.lineTo(-0.5, -1.7);
    outline.closePath();
    const banner = new three.Mesh(new three.ShapeGeometry(outline), toon(three, ramp, seat.color, { side: three.DoubleSide }));
    banner.castShadow = true;
    cloth.add(banner);
    const disc = new three.Mesh(new three.CircleGeometry(0.26, 24), toon(three, ramp, "#fff6dc", { side: three.DoubleSide }));
    disc.position.set(0, -0.62, 0.005);
    cloth.add(disc);
    const number = this.badgeNumber(seat.index + 1);
    if (number) { number.scale.setScalar(3); number.position.set(0, -0.62, 0.01); cloth.add(number); }
    cloth.userData.seat = seat.id;
    holder.add(cloth);
    addOutlines(three, holder, this.inkLine());
    this.scene.add(holder);
    this.banners.push({ cloth, phase: seat.index * 1.3 });
  }

  /** Mown-lawn stripes: two colours alternating, crisp up close and blended in the distance. */
  private stripes(light: string, dark: string, repeat: number): T.DataTexture {
    const three = this.three;
    const bytes = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
    const texture = new three.DataTexture(new Uint8Array([...bytes(light), 255, ...bytes(dark), 255]), 2, 1, three.RGBAFormat);
    texture.colorSpace = three.SRGBColorSpace;
    texture.magFilter = three.NearestFilter;
    texture.minFilter = three.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.wrapS = texture.wrapT = three.RepeatWrapping;
    texture.repeat.set(repeat, 1);
    texture.needsUpdate = true;
    this.disposables.push(texture);
    return texture;
  }

  /** Painted lettering for a sign; skipped where there is no canvas. */
  private signText(text: string): T.Mesh | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#f6e7c1";
    context.font = "800 44px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 128, 35);
    const texture = new this.three.CanvasTexture(canvas);
    texture.colorSpace = this.three.SRGBColorSpace;
    this.disposables.push(texture);
    return new this.three.Mesh(new this.three.PlaneGeometry(2.3, 0.575), new this.three.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  }

  private buildChair(home: T.Vector3) {
    const three = this.three;
    const ramp = this.toonRamp();
    const wood = toon(three, ramp, "#5a3a2a");
    const cushion = toon(three, ramp, "#6b3a4a");
    // Wide and low: a Pırpır is round and its legs stick out forward when it sits. The back is a row of cage bars.
    const chair = this.prop({
      pieces: [["furn_chair", wood], ["furn_chair_cushion", cushion]],
      fallback: () => {
        const seat = new three.Mesh(new three.BoxGeometry(0.98, 0.08, 0.9), wood);
        seat.position.y = 0.4;
        const pad = new three.Mesh(new three.CylinderGeometry(0.4, 0.42, 0.06, 28), cushion);
        pad.position.y = 0.47;
        const back = new three.Mesh(new three.BoxGeometry(0.98, 0.95, 0.08), wood);
        back.position.set(0, 0.9, -0.55);
        const legs = new three.Mesh(new three.CylinderGeometry(0.05, 0.08, 0.4, 8), wood);
        legs.position.y = 0.2;
        return [seat, pad, back, legs];
      },
    });
    chair.position.copy(home);
    chair.rotation.y = yawToward(home, new three.Vector3());
    this.scene.add(chair);
  }

  /** Belt and buckle, shoulder strap and scabbard on a bird's body, hidden until it has something to carry. */
  private buildGear(body: T.Group): Avatar["gear"] {
    const three = this.three;
    const parts = this.parts;
    if (!parts) return null;
    const ramp = this.toonRamp();
    const leather = toon(three, ramp, "#6b3f22");
    const brass = toon(three, ramp, "#f2c14e");
    const piece = (name: GearPart, material: T.Material) => {
      const geometry = parts.geometry(name);
      return geometry ? new three.Mesh(geometry, material) : null;
    };
    const pieces = [piece("gear_belt", leather), piece("gear_buckle", brass), piece("gear_strap", leather), piece("gear_scabbard", leather), piece("gear_scabbard_trim", brass)];
    if (pieces.some((entry) => !entry)) return null;
    const [beltMesh, buckle, strapMesh, sheath, sheathTrim] = pieces as T.Mesh[];
    // Belt and strap are modelled round the egg, whose centre is at body y 0.95.
    const belt = new three.Group();
    belt.position.y = 0.95;
    belt.add(beltMesh, buckle);
    const strap = new three.Group();
    strap.position.y = 0.95;
    strap.add(strapMesh);
    const scabbard = new three.Group();
    scabbard.position.set(...SCABBARD.position);
    scabbard.rotation.set(...SCABBARD.rotation);
    scabbard.add(sheath, sheathTrim);
    for (const group of [belt, strap, scabbard]) {
      group.visible = false;
      group.traverse((object) => { object.castShadow = true; });
      body.add(group);
    }
    return { belt, strap, scabbard };
  }

  /** The viewer's seat of honour at the table, in the widest gap between the members, facing the table. */
  private placeHonorSeat(count: number) {
    const three = this.three;
    const angles = Array.from({ length: count }, (_, index) => Math.PI / 2 + (index / Math.max(count, 3)) * Math.PI * 2);
    const spot = honorSeat(angles);
    if (!this.honorSeatProp) {
      const ramp = this.toonRamp();
      const wood = toon(three, ramp, "#5a3a2a");
      const cushion = toon(three, ramp, "#8a2b3a");
      const gold = toon(three, ramp, "#f2c14e");
      this.honorSeatProp = this.prop({
        pieces: [["furn_honor", wood], ["furn_honor_cushion", cushion], ["furn_honor_gold", gold]],
        fallback: () => {
          const seat = new three.Mesh(new three.BoxGeometry(1.25, 0.1, 1.05), wood);
          seat.position.y = 0.5;
          const pad = new three.Mesh(new three.BoxGeometry(1.1, 0.12, 0.95), cushion);
          pad.position.y = 0.61;
          const back = new three.Mesh(new three.BoxGeometry(1.2, 1.9, 0.1), wood);
          back.position.set(0, 1.4, -0.5);
          const crest = new three.Mesh(new three.SphereGeometry(0.14, 16, 10), gold);
          crest.position.set(0, 2.45, -0.5);
          return [seat, pad, back, crest];
        },
      });
      this.scene.add(this.honorSeatProp);
    }
    this.honorSeatProp.position.set(spot.x, 0, spot.z);
    this.honorSeatProp.rotation.y = spot.yaw;
    const facing = new three.Vector3(Math.sin(spot.yaw), 0, Math.cos(spot.yaw));
    this.honorSpot = { position: new three.Vector3(spot.x, 0, spot.z), yaw: spot.yaw, lap: new three.Vector3(spot.x, 1.0, spot.z).addScaledVector(facing, 0.1) };
  }

  /** The viewer's box at the head of the pitch: a plinth and dais under a canopy, the seat of honour, a name plate. */
  private buildBox() {
    const three = this.three;
    const ramp = this.toonRamp();
    const stone = toon(three, ramp, "#e9e1cf");
    const wood = toon(three, ramp, "#5a3a2a");
    const cushion = toon(three, ramp, "#8a2b3a");
    const gold = toon(three, ramp, "#f2c14e");
    const cloth = toon(three, ramp, "#8a2b3a", { side: three.DoubleSide });
    const box = new three.Group();
    box.position.set(ARENA_BOX.x, 0, ARENA_BOX.z);
    box.rotation.y = ARENA_BOX.yaw;
    // A plinth lifts the dais so the box shows over the jury bench.
    const plinth = new three.Mesh(new three.CylinderGeometry(1.85, 1.95, ARENA_BOX.rise, 48), stone);
    plinth.position.y = ARENA_BOX.rise / 2;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    box.add(plinth);
    addOutlines(three, plinth, this.inkLine());
    const top = ARENA_BOX.rise;
    const dais = this.prop({
      pieces: [["furn_dais", stone]],
      fallback: () => {
        const step = new three.Mesh(new three.CylinderGeometry(1.75, 1.75, 0.36, 40), stone);
        step.position.y = 0.18;
        return [step];
      },
    });
    dais.position.y = top;
    const canopy = this.prop({
      pieces: [["furn_canopy", cloth], ["furn_canopy_poles", gold]],
      fallback: () => {
        const roof = new three.Mesh(new three.ConeGeometry(1.9, 0.6, 4, 1, true).rotateY(Math.PI / 4), cloth);
        roof.position.y = 3.2;
        const poles = [-1, 1].flatMap((x) => [-1, 1].map((z) => {
          const pole = new three.Mesh(new three.CylinderGeometry(0.045, 0.045, 2.8, 8), gold);
          pole.position.set(x * 1.15, 1.58, z * 1.15);
          return pole;
        }));
        return [roof, ...poles];
      },
    });
    canopy.position.y = top;
    const seat = this.prop({
      pieces: [["furn_honor", wood], ["furn_honor_cushion", cushion], ["furn_honor_gold", gold]],
      fallback: () => {
        const base = new three.Mesh(new three.BoxGeometry(1.2, 0.6, 1.0), wood);
        base.position.y = 0.3;
        const back = new three.Mesh(new three.BoxGeometry(1.2, 1.9, 0.1), wood);
        back.position.set(0, 1.4, -0.5);
        return [base, back];
      },
    });
    seat.position.y = top + 0.36;
    box.add(dais, canopy, seat);
    const plate = this.signText("SENİN YERİN");
    if (plate) {
      plate.scale.setScalar(0.62);
      plate.position.set(0, ARENA_BOX.rise * 0.55, 1.96);
      box.add(plate);
    }
    // The winning prompt, rolled up and tied, waiting on the seat once there is a winner.
    this.honorScroll = this.makeScroll();
    this.honorScroll.position.set(0, top + 0.36 + 0.7, 0.12);
    this.honorScroll.visible = false;
    box.add(this.honorScroll);
    this.scene.add(box);
    box.updateMatrixWorld(true);
    this.honorSpot = {
      position: new three.Vector3(ARENA_BOX.x, top + 0.36, ARENA_BOX.z),
      yaw: ARENA_BOX.yaw,
      lap: this.honorScroll.getWorldPosition(new three.Vector3()),
    };
  }

  /** A rolled parchment with turned wooden ends and a red ribbon round the middle. */
  private makeScroll(): T.Group {
    const three = this.three;
    const ramp = this.toonRamp();
    const scroll = new three.Group();
    const paper = new three.Mesh(new three.CylinderGeometry(0.08, 0.08, 0.56, 20).rotateZ(Math.PI / 2), toon(three, ramp, "#f1e3c2"));
    const ribbon = new three.Mesh(new three.TorusGeometry(0.083, 0.018, 8, 24).rotateY(Math.PI / 2), toon(three, ramp, "#c0392b"));
    scroll.add(paper, ribbon);
    for (const side of [-1, 1]) {
      const knob = new three.Mesh(new three.SphereGeometry(0.05, 12, 8), toon(three, ramp, "#7a5332"));
      knob.position.x = side * 0.32;
      scroll.add(knob);
    }
    addOutlines(three, scroll, this.inkLine());
    return scroll;
  }

  /** Carries the winning prompt from the winner up to the viewer's box in a high arc, after `delay`. */
  private deliver(from: Avatar, delay: number) {
    const target = this.honorSpot;
    if (!target || this.options.reducedMotion) return;
    const three = this.three;
    const scroll = this.makeScroll();
    scroll.visible = false;
    this.scene.add(scroll);
    this.delivering = true;
    if (this.honorScroll) this.honorScroll.visible = false;
    const begin = this.now() + delay;
    const flight = 1.5 / this.speed;
    let start: T.Vector3 | null = null;
    let curve: T.QuadraticBezierCurve3 | null = null;
    let landed = false;
    this.effects.push({
      update: (now) => {
        if (now < begin) return true;
        if (!start) {
          start = this.headOf(from).add(new three.Vector3(0, 0.4, 0));
          const end = target.lap.clone();
          curve = new three.QuadraticBezierCurve3(start, start.clone().lerp(end, 0.5).add(new three.Vector3(0, 5, 0)), end);
          this.options.onCue?.("swish", 1);
        }
        const p = clamp((now - begin) / flight);
        scroll.visible = true;
        scroll.position.copy(curve!.getPoint(ease(p)));
        scroll.rotation.set(0, p * Math.PI * 3, Math.sin(p * Math.PI) * 0.6);
        if (p >= 1 && !landed) {
          landed = true;
          this.delivering = false;
          if (this.honorScroll && this.state?.winner) this.honorScroll.visible = true;
          this.sparks(target.lap.clone(), "#ffe08a", 26);
          this.crowd?.cheer(0.9);
          this.options.onCue?.("pop", 1);
        }
        return p < 1;
      },
      dispose: () => { this.delivering = false; this.scene.remove(scroll); disposeTree(scroll); },
    });
  }

  /** Life round the stage (ambient.ts), placed by the crowns, flower beds and window sills just built. */
  private startAmbient() {
    this.ambient = new Ambient(this.three, this.scene, {
      mode: this.options.mode === "collaboration" ? "collaboration" : "competition",
      reducedMotion: this.options.reducedMotion,
      ramp: this.toonRamp(),
      ink: this.inkLine(),
      trees: this.crowns,
      flowers: this.flowerBeds,
      sills: this.sills,
      lamp: this.options.mode === "collaboration" ? new this.three.Vector3(0, 3.15, 0) : undefined,
    });
    this.disposables.push(this.ambient);
  }

  /** A furniture holder built from its recipe now, and rebuilt from the same recipe once the library loads. */
  private prop(recipe: Recipe): T.Group {
    const holder = new this.three.Group();
    holder.userData.recipe = recipe;
    this.furnish(holder);
    (this.props ??= []).push(holder);
    return holder;
  }

  /** Fills a holder with the modelled pieces when the library has all of them, otherwise with the simple shapes. */
  private furnish(holder: T.Group) {
    const recipe = holder.userData.recipe as Recipe;
    for (const child of [...holder.children]) {
      holder.remove(child);
      // Only stand-in shapes own their geometry; library geometry is shared.
      if (holder.userData.standIn) child.traverse((object) => (object as T.Mesh).geometry?.dispose?.());
    }
    const geometries = recipe.pieces.map(([name]) => this.parts?.geometry(name) ?? null);
    const modelled = geometries.every(Boolean);
    const pieces = modelled ? recipe.pieces.map(([, material], index) => new this.three.Mesh(geometries[index]!, material)) : recipe.fallback();
    for (const piece of pieces) {
      piece.traverse((object) => { object.castShadow = true; object.receiveShadow = true; });
      holder.add(piece);
    }
    holder.userData.standIn = !modelled;
    addOutlines(this.three, holder, this.inkLine());
  }

  /**
   * A Pırpır, PRISON's own mascot bird, in the seat's colour. Body parts come from the parts library once it has
   * loaded (simple shapes stand in until then), accessories from the model's name, and the badge shows the seat number.
   */
  private buildAvatar(seat: Seat, home: T.Vector3, bench: T.Vector3): Avatar {
    const three = this.three;
    const parts = this.parts;
    const ramp = this.toonRamp();
    const baseColor = new three.Color(seat.color);
    const skin = toon(three, ramp, baseColor);
    const bib = toon(three, ramp, baseColor.clone().lerp(this.white, 0.62));
    const trim = toon(three, ramp, baseColor.clone().lerp(new three.Color("#1b1030"), 0.45));
    const beak = toon(three, ramp, "#ffc145");
    const jawColor = toon(three, ramp, "#f29d1b");
    const gold = toon(three, ramp, "#f2c14e");
    const root = new three.Group();
    const body = new three.Group();
    root.add(body);
    const part = <M extends T.Object3D>(parent: T.Object3D, mesh: M, x = 0, y = 0, z = 0): M => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const shape = (name: BodyPart, fallback: () => T.BufferGeometry) => parts?.geometry(name) ?? fallback();

    // Thin legs on round three-toed feet.
    const hips = new three.Group();
    hips.position.y = 0.5;
    const legs = [-0.16, 0.16].map((x) => {
      const pivot = new three.Group();
      pivot.position.x = x;
      part(pivot, new three.Mesh(shape("pirpir_leg", () => new three.CylinderGeometry(0.04, 0.04, 0.5, 10).translate(0, -0.25, 0)), beak));
      part(pivot, new three.Mesh(shape("pirpir_foot", () => new three.SphereGeometry(0.1, 14, 8).scale(1, 0.4, 1.5).translate(0, 0, 0.06)), beak), 0, -0.448, 0.02);
      hips.add(pivot);
      return pivot;
    });
    body.add(hips);

    // Egg body with a scaled feather bib, the inmate badge, and a fan tail that carries the lantern.
    part(body, new three.Mesh(shape("pirpir_body", () => new three.SphereGeometry(0.44, 40, 28).scale(1, 1.2, 1)), skin), 0, 0.95, 0);
    part(body, new three.Mesh(shape("pirpir_bib", () => new three.SphereGeometry(0.3, 28, 16).scale(1, 1.1, 0.42).translate(0, -0.12, 0.33)), bib), 0, 0.95, 0);
    const badge = part(body, new three.Mesh(shape("pirpir_badge", () => new three.CylinderGeometry(0.09, 0.09, 0.025, 28).rotateX(Math.PI / 2)), gold), 0, 1.17, 0.405);
    badge.rotation.x = -0.24;
    const number = this.badgeNumber(seat.index + 1);
    if (number) part(badge, number, 0, 0, 0.017).castShadow = false;
    const tail = part(body, new three.Mesh(shape("pirpir_tail", () => new three.ConeGeometry(0.12, 0.3, 12).rotateX(-0.7).translate(0, 0.12, -0.1)), skin), 0, 0.72, -0.38);
    const lantern = new three.MeshStandardMaterial({ color: baseColor.clone().lerp(this.white, 0.4), emissive: baseColor, emissiveIntensity: 0.6, roughness: 0.3 });
    part(tail, new three.Mesh(new three.SphereGeometry(0.058, 18, 12), lantern), 0, 0.37, -0.29);
    part(tail, new three.Mesh(new three.TorusGeometry(0.05, 0.012, 8, 20), gold), 0, 0.42, -0.31).rotation.x = Math.PI / 2 - 0.6;
    const lanternGlow = new three.Mesh(new three.SphereGeometry(0.12, 16, 10), new three.MeshBasicMaterial({
      color: baseColor, transparent: true, opacity: 0.22, blending: three.AdditiveBlending, depthWrite: false,
    }));
    lanternGlow.position.set(0, 0.37, -0.29);
    tail.add(lanternGlow);

    // Layered flipper wings; the library holds the right one and the left is its mirror image.
    const arm = (side: number) => {
      const shoulder = new three.Group();
      shoulder.position.set(side * 0.43, 1.2, 0);
      const wing = part(shoulder, new three.Mesh(shape("pirpir_wing", () => new three.SphereGeometry(0.15, 18, 12).scale(0.4, 1, 1.6).translate(0, -0.22, 0)), skin));
      wing.scale.x = side;
      wing.rotation.z = side * 0.14;
      body.add(shoulder);
      return shoulder;
    };
    const leftArm = arm(-1);
    const rightArm = arm(1);
    const hand = new three.Group();
    hand.position.set(0, -0.42, 0.06);
    rightArm.add(hand);
    const leftHand = new three.Group();
    leftHand.position.set(0, -0.42, 0.06);
    leftArm.add(leftHand);

    // Head: curled forelock, cheek tufts, a button beak with an opening jaw, big eyes, brows and blush.
    const head = new three.Group();
    head.position.y = 1.82;
    body.add(head);
    part(head, new three.Mesh(shape("pirpir_head", () => new three.SphereGeometry(0.36, 40, 28).scale(1, 0.94, 1)), skin));
    const accessories = accessoriesFor(seat.model);
    // With a hat on, the forelock peeks out behind it instead of poking through.
    const hatted = accessories.some((entry) => ACCESSORY_SLOTS[entry] === "top");
    const tuft = part(head, new three.Mesh(shape("pirpir_tuft", () => new three.TorusGeometry(0.07, 0.03, 8, 20, Math.PI * 1.4).rotateY(Math.PI / 2).translate(0, 0.08, 0)), trim),
      0, hatted ? 0.25 : 0.325, hatted ? -0.2 : 0.02);
    if (hatted) tuft.rotation.x = -0.75;
    for (const side of [-1, 1]) {
      const cheek = part(head, new three.Mesh(shape("pirpir_cheek", () => new three.ConeGeometry(0.05, 0.14, 8).rotateZ(-Math.PI / 2).translate(0.06, 0, 0)), trim), side * 0.33, -0.05, 0.1);
      cheek.scale.x = side;
    }
    part(head, new three.Mesh(shape("pirpir_beak", () => new three.ConeGeometry(0.1, 0.2, 16).rotateX(Math.PI / 2).translate(0, 0, 0.1)), beak), 0, -0.02, 0.3);
    const jaw = new three.Group();
    jaw.position.set(0, -0.065, 0.29);
    head.add(jaw);
    part(jaw, new three.Mesh(shape("pirpir_jaw", () => new three.ConeGeometry(0.08, 0.15, 14).rotateX(Math.PI / 2).translate(0, -0.02, 0.075)), jawColor));

    const eyes = toon(three, ramp, "#ffffff", { emissive: "#ffffff", emissiveIntensity: 0.22 });
    const ink = new three.MeshBasicMaterial({ color: "#140c1c" });
    const shine = new three.MeshBasicMaterial({ color: "#ffffff" });
    const blush = new three.MeshBasicMaterial({ color: "#ff7aa2", transparent: true, opacity: 0.55, depthWrite: false });
    const eyeMeshes: T.Object3D[] = [];
    const lids: T.Object3D[] = [];
    const pupils: T.Object3D[] = [];
    const brows: T.Object3D[] = [];
    for (const side of [-1, 1]) {
      const eye = new three.Group();
      eye.position.set(side * 0.135, 0.07, 0.29);
      eye.rotation.y = side * 0.32;
      head.add(eye);
      part(eye, new three.Mesh(new three.SphereGeometry(0.1, 24, 16), eyes)).scale.set(0.92, 1.15, 0.62);
      // The lid frame carries the eyeball's own proportions, so the rolling shell keeps hugging its surface.
      const lidFrame = new three.Group();
      lidFrame.scale.set(0.97, 1.2, 0.68);
      eye.add(lidFrame);
      const lid = part(lidFrame, new three.Mesh(new three.SphereGeometry(0.104, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), skin));
      lid.rotation.x = LID_OPEN;
      lids.push(lid);
      const pupil = new three.Group();
      pupil.position.set(0, -0.005, 0.03);
      eye.add(pupil);
      part(pupil, new three.Mesh(new three.SphereGeometry(0.052, 18, 12), ink)).scale.set(1, 1.1, 0.7);
      part(pupil, new three.Mesh(new three.SphereGeometry(0.016, 10, 8), shine), -0.018, 0.026, 0.035);
      eyeMeshes.push(eye);
      pupils.push(pupil);
      const brow = new three.Group();
      brow.position.set(side * 0.135, 0.205, 0.31);
      head.add(brow);
      part(brow, new three.Mesh(new three.CapsuleGeometry(0.017, 0.08, 4, 8), ink)).rotation.z = Math.PI / 2;
      brows.push(brow);
      const dot = part(head, new three.Mesh(new three.CircleGeometry(0.05, 20), blush), side * 0.236, -0.07, 0.286);
      dot.rotation.y = side * 0.69;
      dot.castShadow = false;
    }

    const outfit = dress({
      three, head, body, color: baseColor, skin, trim, seated: this.options.mode === "collaboration", ramp,
      library: (name) => parts?.geometry(name as AccessoryPart) ?? null,
      shape: { top: 0.34, half: 0.37, face: 0.33, round: true, eyes: { x: 0.135, y: 0.07, z: 0.36, r: 0.1 } },
    }, accessories);
    outfit.lights.push(lantern);

    const ringMaterial = new three.MeshBasicMaterial({ color: this.green, transparent: true, opacity: 0, depthWrite: false });
    const ring = new three.Mesh(new three.TorusGeometry(0.66, 0.04, 8, 56), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;
    root.add(ring);
    const haloMaterial = new three.MeshBasicMaterial({ color: this.green, transparent: true, opacity: 0, blending: three.AdditiveBlending, depthWrite: false });
    const glow = new three.Mesh(new three.CircleGeometry(0.7, 32), haloMaterial);
    glow.position.set(0, 1.82, -0.12);
    body.add(glow);

    // Carrying gear, shown only when there is something to carry (see arrangeWeapons).
    const gear = this.buildGear(body);

    // Ink outlines on everything lit, then studio reflections for the few metal and glass bits.
    addOutlines(three, root, this.inkLine());
    if (this.environment) {
      root.traverse((object) => {
        const material = (object as T.Mesh).material as T.MeshStandardMaterial | undefined;
        if (material?.isMeshStandardMaterial && !material.envMap) { material.envMap = this.environment; material.envMapIntensity = 0.6; }
      });
    }

    const skins = [skin, bib, trim, beak, jawColor];
    const avatar: Avatar = {
      seat, root, body, hips, legs, head, rightArm, leftArm, hand, leftHand, umbrella: null, umbrellaOpen: 0, eyes, eyeMeshes, lids, jaw, pupils, brows, ringMaterial, haloMaterial,
      cape: outfit.cape, lights: outfit.lights, crown: outfit.height,
      look: 0, nextBlink: Math.random() * 3, blinkUntil: 0, nextIdle: 3 + Math.random() * 5, face: { tilt: 0, lift: 0, pupil: 1, gaze: 0, squint: 1, lid: 0.1 },
      skin: skins, skinColors: skins.map((material) => material.color.clone()), baseColor,
      glow: baseColor.clone().multiplyScalar(this.options.mode === "collaboration" ? 0.16 : 0.03), home: home.clone(), homeYaw: yawToward(home, new three.Vector3()), bench: bench.clone(),
      speaking: 0, thinking: false, active: false, eliminated: false, failed: false, winner: false, hitFlash: 0, actions: [],
      tail, tuft, tuftRest: tuft.rotation.x,
      jiggle: { tail: { value: 0, velocity: 0 }, roll: { value: 0, velocity: 0 }, tuft: { value: 0, velocity: 0 }, cape: { value: 0, velocity: 0 }, last: null, velocity: new three.Vector3() },
      step: 0, airborne: 0, nextPuff: 0, gesture: null, lastGesture: null, gear,
    };
    this.placeAtRest(avatar);
    this.scene.add(root);
    return avatar;
  }

  /** The cel-shading ramp, made once per scene. */
  private toonRamp() {
    if (!this.ramp) {
      this.ramp = toonGradient(this.three);
      this.disposables.push(this.ramp);
    }
    return this.ramp;
  }

  /** The shared ink outline material. */
  private inkLine() {
    if (!this.ink) {
      this.ink = outlineMaterial(this.three, 0.016);
      this.disposables.push(this.ink);
    }
    return this.ink;
  }

  /** The seat number printed on a Pırpır's badge; skipped where there is no canvas (tests, very old browsers). */
  private badgeNumber(value: number): T.Mesh | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#2a1a08";
    context.font = "700 40px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(value), 32, 35);
    const texture = new this.three.CanvasTexture(canvas);
    texture.colorSpace = this.three.SRGBColorSpace;
    this.disposables.push(texture);
    return new this.three.Mesh(new this.three.CircleGeometry(0.07, 24), new this.three.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  }

  private buildWeapon(dimension: CouncilDimension): T.Group {
    const three = this.three;
    const group = new three.Group();
    group.userData.kind = COUNCIL_WEAPONS[dimension].weapon;
    const steel = new three.MeshStandardMaterial({ color: "#d7dde6", roughness: 0.25, metalness: 0.9 });
    const wood = new three.MeshStandardMaterial({ color: "#8a5a2b", roughness: 0.7 });
    const gold = new three.MeshStandardMaterial({ color: "#f2c14e", roughness: 0.3, metalness: 0.8, emissive: "#3a2600" });
    const modelled = this.parts?.weapon(`weapon_${COUNCIL_WEAPONS[dimension].weapon}` as WeaponPart);
    if (modelled) {
      if (this.environment) {
        modelled.traverse((object) => {
          const material = (object as T.Mesh).material as T.MeshStandardMaterial | undefined;
          if (material?.isMeshStandardMaterial) { material.envMap = this.environment; material.envMapIntensity = 0.8; }
        });
      }
      group.add(modelled);
      addOutlines(three, group, this.inkLine());
      return this.measureReach(group);
    }
    const add = (mesh: T.Mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); mesh.castShadow = true; group.add(mesh); return mesh; };
    switch (COUNCIL_WEAPONS[dimension].weapon) {
      case "sword":
        add(new three.Mesh(new three.BoxGeometry(0.07, 0.78, 0.02), steel), 0, 0.5);
        add(new three.Mesh(new three.BoxGeometry(0.28, 0.05, 0.06), gold), 0, 0.1);
        add(new three.Mesh(new three.CylinderGeometry(0.03, 0.03, 0.2, 8), wood), 0, -0.02);
        break;
      case "bow": {
        const arc = add(new three.Mesh(new three.TorusGeometry(0.42, 0.025, 6, 24, Math.PI), wood), 0, 0.3);
        arc.rotation.z = -Math.PI / 2;
        add(new three.Mesh(new three.CylinderGeometry(0.006, 0.006, 0.84, 4), new three.MeshBasicMaterial({ color: "#f5f0e0" })), 0, 0.3);
        break;
      }
      case "shield": {
        const disc = add(new three.Mesh(new three.CylinderGeometry(0.36, 0.36, 0.06, 28), new three.MeshStandardMaterial({ color: "#3d6fb6", roughness: 0.4, metalness: 0.4 })), 0, 0.3);
        disc.rotation.x = Math.PI / 2;
        const boss = add(new three.Mesh(new three.SphereGeometry(0.09, 14, 10), gold), 0, 0.3, 0.04);
        boss.scale.z = 0.6;
        break;
      }
      case "hammer":
        add(new three.Mesh(new three.CylinderGeometry(0.035, 0.035, 0.8, 8), wood), 0, 0.3);
        add(new three.Mesh(new three.BoxGeometry(0.34, 0.18, 0.18), steel), 0, 0.72);
        break;
      case "spear":
        add(new three.Mesh(new three.CylinderGeometry(0.025, 0.025, 1.3, 8), wood), 0, 0.45);
        add(new three.Mesh(new three.ConeGeometry(0.07, 0.24, 10), steel), 0, 1.2);
        break;
      case "staff":
        add(new three.Mesh(new three.CylinderGeometry(0.03, 0.04, 1.1, 8), wood), 0, 0.4);
        add(new three.Mesh(new three.IcosahedronGeometry(0.11, 1), new three.MeshStandardMaterial({ color: "#b48bff", emissive: "#7c3aed", emissiveIntensity: 1.4, roughness: 0.2 })), 0, 1.02);
        break;
    }
    addOutlines(three, group, this.inkLine());
    return this.measureReach(group);
  }

  /** Weapons are built along +Y from the grip; the trail is a band along the outer part, out to the tip. */
  private measureReach(group: T.Group) {
    const box = new this.three.Box3().setFromObject(group);
    if (!box.isEmpty()) group.userData.reach = [box.min.y + (box.max.y - box.min.y) * 0.55, box.max.y];
    return group;
  }

  // ───────────────────────────── state application ─────────────────────────────

  private placeAtRest(avatar: Avatar) {
    const atBench = avatar.eliminated && this.options.mode === "competition";
    const position = atBench ? avatar.bench : avatar.home;
    avatar.root.position.copy(position);
    avatar.root.rotation.y = atBench ? 0 : avatar.homeYaw;
    avatar.body.position.set(0, 0, 0);
    avatar.body.rotation.set(0, 0, 0);
    avatar.rightArm.rotation.set(0, 0, 0);
    avatar.leftArm.rotation.set(0, 0, 0);
    for (const leg of avatar.legs) leg.rotation.x = 0;
    avatar.hips.rotation.x = this.options.mode === "collaboration" || atBench ? -Math.PI / 2 : 0;
    avatar.body.position.y = atBench ? BENCH_LIFT : 0;
  }

  private syncWeapons(state: SceneState, event: CouncilEvent | null, motion: boolean) {
    for (const weapon of this.weapons.values()) {
      const holderId = state.weapons[weapon.dimension];
      const holder = holderId ? this.avatars.get(holderId) ?? null : null;
      const isNew = motion && event?.kind === "weapon" && event.dimension === weapon.dimension;
      if (isNew && holder) {
        // The system takes the weapon back up into the sky (out of its last holder's wing, if any) and drops it;
        // the round's best fighter on that dimension fetches it.
        const previous = weapon.holder;
        const from = previous && weapon.mesh.visible ? weapon.mesh.getWorldPosition(new this.three.Vector3()) : null;
        this.detach(weapon);
        weapon.holder = null;
        weapon.mesh.visible = true;
        this.scene.add(weapon.mesh);
        weapon.mesh.scale.setScalar(1);
        weapon.mesh.position.copy(from ?? new this.three.Vector3(weapon.spot.x, 7, weapon.spot.z));
        weapon.mesh.rotation.set(0, Math.random() * Math.PI, Math.PI / 2.4);
        const lift = from ? 0.45 / this.speed : 0;
        weapon.drop = { start: this.now(), duration: 0.55 / this.speed, from, lift };
        weapon.landed = false;
        if (previous && previous !== holder) previous.actions.push({ kind: "flinch", start: this.now(), duration: 0.4 / this.speed });
        for (const avatar of this.avatars.values()) avatar.actions = avatar.actions.filter((action) => action.weapon !== weapon);
        holder.actions.push({ kind: "pickup", start: this.now() + lift + 0.45 / this.speed, duration: 1.15 / this.speed, weapon });
        this.arrangeWeapons();
        continue;
      }
      if (weapon.holder === holder && (holder || !weapon.mesh.visible)) continue;
      weapon.drop = null;
      if (holder) this.attach(weapon, holder);
      else { this.detach(weapon); weapon.holder = null; weapon.mesh.visible = false; }
    }
    this.arrangeWeapons();
  }

  private attach(weapon: Weapon, holder: Avatar) {
    this.detach(weapon);
    weapon.holder = holder;
    weapon.mesh.visible = true;
    holder.root.add(weapon.mesh);
    this.arrangeWeapons();
  }

  private detach(weapon: Weapon) {
    if (weapon.mesh.parent && weapon.mesh.parent !== this.scene) {
      weapon.mesh.parent.remove(weapon.mesh);
      this.scene.add(weapon.mesh);
    }
  }

  /** First held weapon goes in the right hand; the rest hover behind the fighter as collected equipment. */
  private arrangeWeapons() {
    for (const avatar of this.avatars.values()) {
      const held = [...this.weapons.values()].filter((weapon) => weapon.holder === avatar && !weapon.drop);
      const kinds = held.map((weapon) => COUNCIL_WEAPONS[weapon.dimension].weapon as WeaponKind);
      const mounts = carry(kinds);
      const gear = gearFor(kinds);
      if (avatar.gear) {
        avatar.gear.belt.visible = gear.belt;
        avatar.gear.strap.visible = gear.strap;
        avatar.gear.scabbard.visible = gear.scabbard;
      }
      held.forEach((weapon, index) => {
        const kind = kinds[index];
        if (index === 0) {
          // In the right wing, held the way that weapon is held.
          if (weapon.mesh.parent !== avatar.hand) { weapon.mesh.parent?.remove(weapon.mesh); avatar.hand.add(weapon.mesh); }
          const hold = HOLDS[kind] ?? HOLDS.sword;
          weapon.mesh.position.set(...hold.position);
          weapon.mesh.rotation.set(...hold.rotation);
          weapon.mesh.scale.setScalar(hold.scale);
        } else {
          // Each other kind in its own place on the body (equipment.ts): sword sheathed at the hip, hammer on the
          // belt ring, shield, bow and the long arms across the back.
          if (weapon.mesh.parent !== avatar.body) { weapon.mesh.parent?.remove(weapon.mesh); avatar.body.add(weapon.mesh); }
          const mount = mounts[index];
          weapon.mesh.position.set(...mount.position);
          weapon.mesh.rotation.set(...mount.rotation);
          weapon.mesh.scale.setScalar(mount.scale);
        }
      });
    }
  }

  /** The rolled-up winning prompt lies at the viewer's box once there is a winner (unless it is still on its way). */
  private syncScroll(state: SceneState) {
    if (this.honorScroll) this.honorScroll.visible = Boolean(state.winner) && !this.delivering;
  }

  private syncTable(state: SceneState, previous: SceneState | null, event: CouncilEvent | null, motion: boolean) {
    const documentMaterial = this.documentMesh?.material as T.MeshStandardMaterial | undefined;
    if (documentMaterial) {
      documentMaterial.opacity = state.draft > 0 ? 1 : 0;
      this.documentGlow = state.draft > 0 ? 0.25 + state.approvals * 0.25 : 0;
      this.documentRise = state.winner ? 1 : 0;
    }
    const flying = motion && event?.kind === "proposal" && this.avatars.has(event.actorId) ? 1 : 0;
    const papers = Math.min(6, state.proposals.length);
    while (this.papers.length > papers - flying) this.removePaper();
    while (this.papers.length < papers - flying) this.addPaper(this.avatars.get(state.proposals[this.papers.length]) ?? null, false);
    if (this.lamp && state.memory && !previous?.memory && motion) this.lamp.boost = 1.4;
    // Stamps on the shared text match the real votes since the latest draft; a vote being acted out lands its own.
    const voting = motion && (event?.kind === "approval" || event?.kind === "objection") && this.avatars.has(event.actorId);
    const wanted: Array<"approve" | "object"> = [...Array(state.approvals).fill("approve"), ...Array(state.objections).fill("object")];
    if (voting) wanted.splice(wanted.lastIndexOf(event!.kind === "approval" ? "approve" : "object"), 1);
    this.stamps ??= [];
    const same = this.stamps.length === wanted.length && this.stamps.every((stamp, index) => stamp.verdict === wanted[index]);
    if (!same) {
      for (const stamp of this.stamps.splice(0)) stamp.mesh.removeFromParent();
      for (const verdict of wanted) this.placeStamp(verdict, false);
    }
  }

  /**
   * A rubber stamp on the shared text: a ring with ONAY (green) or İTİRAZ (red), set slightly askew in a grid down the
   * page. `slam` drops it from above with a thud.
   */
  private placeStamp(verdict: "approve" | "object", slam: boolean) {
    const doc = this.documentMesh;
    if (!doc) return;
    const three = this.three;
    const colour = verdict === "approve" ? "#22a35a" : "#d93a3a";
    const stamp = new three.Group();
    const ink = new three.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85, depthWrite: false });
    stamp.add(new three.Mesh(new three.RingGeometry(0.085, 0.105, 32), ink));
    const label = this.stampLabel(verdict === "approve" ? "ONAY" : "İTİRAZ", colour);
    if (label) stamp.add(label);
    const index = this.stamps.length;
    stamp.position.set(index % 2 ? 0.16 : -0.16, 0.36 - Math.floor(index / 2) * 0.22, 0.003 + index * 0.0005);
    stamp.rotation.z = (((index * 37) % 11) - 5) * 0.06;
    doc.add(stamp);
    this.stamps.push({ verdict, mesh: stamp });
    if (!slam || this.options.reducedMotion) return;
    const begin = this.now();
    const drop = 0.16 / this.speed;
    let landed = false;
    this.effects.push({
      update: (now) => {
        const p = clamp((now - begin) / drop);
        stamp.scale.setScalar(2.4 - 1.4 * ease(p));
        stamp.position.z = 0.003 + index * 0.0005 + (1 - p) * 0.5;
        if (p >= 1 && !landed) {
          landed = true;
          const at = new three.Vector3();
          stamp.getWorldPosition(at);
          this.sparks(at.add(new three.Vector3(0, 0.05, 0)), colour, 14);
          this.shake = Math.min(1, this.shake + 0.12);
          this.options.onCue?.("stamp", 1);
        }
        return p < 1;
      },
      dispose: () => undefined,
    });
  }

  /** The stamp's word, printed in its ink colour; skipped where there is no canvas. */
  private stampLabel(text: string, colour: string): T.Mesh | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = colour;
    context.font = "900 30px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 64, 34);
    const texture = new this.three.CanvasTexture(canvas);
    texture.colorSpace = this.three.SRGBColorSpace;
    this.disposables.push(texture);
    return new this.three.Mesh(new this.three.PlaneGeometry(0.17, 0.085), new this.three.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
  }

  private removePaper() {
    const paper = this.papers.pop()!;
    this.scene.remove(paper);
    const resources = new Set<{ dispose: () => void }>();
    paper.traverse((part) => {
      const mesh = part as T.Mesh;
      resources.add(mesh.geometry);
      resources.add(mesh.material as T.Material);
    });
    resources.forEach((resource) => resource.dispose());
  }

  /** A proposal sheet: cream paper headed by a strip in the proposer's color, with a few faint lines of text. */
  private addPaper(owner: Avatar | null, fly: boolean) {
    const three = this.three;
    const paper = new three.Mesh(new three.PlaneGeometry(0.42, 0.56), new three.MeshStandardMaterial({ color: PAPER, roughness: 0.9, side: three.DoubleSide }));
    // Self-lit enough that the seat color survives the lamp's warm cast.
    const header = new three.Mesh(new three.PlaneGeometry(0.42, 0.12), new three.MeshStandardMaterial({
      color: owner?.baseColor ?? "#9a9184", emissive: owner?.baseColor ?? "#000000", emissiveIntensity: 0.6, roughness: 0.7, side: three.DoubleSide,
    }));
    header.position.set(0, 0.22, 0.002);
    paper.add(header);
    const lineGeometry = new three.PlaneGeometry(1, 0.018);
    const lineMaterial = new three.MeshBasicMaterial({ color: "#b9ae9b", side: three.DoubleSide });
    [0.3, 0.3, 0.3, 0.18].forEach((width, row) => {
      const line = new three.Mesh(lineGeometry, lineMaterial);
      line.scale.x = width;
      line.position.set((width - 0.3) / 2, 0.1 - row * 0.075, 0.002);
      paper.add(line);
    });
    const index = this.papers.length;
    const angle = index * 1.05;
    const target = new three.Vector3(Math.cos(angle) * 0.75, 0.985 + index * 0.003, Math.sin(angle) * 0.75);
    paper.rotation.set(-Math.PI / 2, 0, angle);
    this.papers.push(paper);
    this.scene.add(paper);
    const from = fly ? owner : null;
    if (!from) { paper.position.copy(target); return; }
    const start = from.root.position.clone().add(new three.Vector3(0, 1.3, 0));
    const begin = this.now();
    const duration = 0.9 / this.speed;
    paper.position.copy(start);
    this.effects.push({
      update: (now) => {
        const p = clamp((now - begin) / duration);
        paper.position.lerpVectors(start, target, ease(p));
        paper.position.y += Math.sin(p * Math.PI) * 0.6;
        return p < 1;
      },
      dispose: () => undefined,
    });
  }

  /**
   * Plays one of the gesture library's clips on a seat, for example a viewer's command from the page. Presentation
   * only: it never changes the council's events, answers, votes or scores. False for an unknown seat or clip.
   */
  playGesture(seatId: string, id: string): boolean {
    const avatar = this.avatars.get(seatId);
    const gesture = getGesture(id);
    if (this.disposed || !avatar || !gesture) return false;
    const now = this.now();
    // A manual command asks to see this seat now: a short clip must not finish
    // while the view is still easing away from the previous wide shot.
    if (!this.options.reducedMotion) {
      this.shot = { kind: "speaker", subject: seatId, other: null };
      this.shotAt = this.realTime;
      this.manualUntil = 0;
      this.dragging = null;
      this.shake = 0;
      this.cam.ready = false;
      this.updateCamera(0, now);
    }
    this.startGesture(avatar, gesture.id, now);
    return true;
  }

  /**
   * Gives a moment its body language from the library: greeting on taking a seat, thinking while studying,
   * presenting a proposal. The clip follows whatever the bird is already doing, and a replay picks the same one.
   * The others then take the outcome in (outcome-gestures.ts): a reviewed bird by its real score, the rest at an
   * elimination or a win.
   */
  private gestureFor(event: CouncilEvent) {
    if (this.options.reducedMotion) return;
    const now = this.now();
    const busyUntil = (avatar: Avatar) => avatar.actions.reduce((end, action) => (action.kind === "idle" ? end : Math.max(end, action.start + action.duration)), now);
    const category = GESTURE_FOR[event.kind];
    const actor = this.avatars.get(event.actorId);
    if (category && actor) {
      const id = chooseNextGesture(actor.lastGesture ?? null, { seat: actor.seat.id, event: event.seq, category });
      this.startGesture(actor, id, busyUntil(actor));
    }
    // Reactions wait for the move that caused them: after the blow lands, the fall, the step onto the podium.
    const cause = actor?.actions.find((action) => action.kind !== "idle" && action.start >= now);
    const settled = cause ? cause.start + cause.duration : now;
    const seats = [...this.avatars.values()].map((avatar) => ({ id: avatar.seat.id, eliminated: avatar.eliminated, failed: avatar.failed }));
    for (const reaction of outcomeReactions(event, seats)) {
      const avatar = this.avatars.get(reaction.seat)!;
      const playing = avatar.gesture ? avatar.gesture.start + (getGesture(avatar.gesture.id)?.duration ?? 0) / this.speed : now;
      const id = chooseMoodGesture(avatar.lastGesture, reaction.seat, event.seq, reaction.mood);
      this.startGesture(avatar, id, Math.max(settled + reaction.delay / this.speed, busyUntil(avatar), playing));
    }
  }

  private startGesture(avatar: Avatar, id: GestureId, start: number) {
    avatar.gesture = { id, start };
    avatar.lastGesture = id;
    // An idle fidget gives way to it, and the next one waits until it is done.
    if (avatar.actions[0]?.kind === "idle") avatar.actions.shift();
    avatar.nextIdle = Math.max(avatar.nextIdle ?? 0, start + (getGesture(id)?.duration ?? 1) / this.speed + 2);
  }

  /** Acts out the current moment, then adds its body language once the moment's own moves are queued. */
  private act(event: CouncilEvent) {
    this.actOut(event);
    this.gestureFor(event);
  }

  private actOut(event: CouncilEvent) {
    const actor = this.avatars.get(event.actorId);
    const target = event.targetId ? this.avatars.get(event.targetId) : undefined;
    const now = this.now();
    const s = this.speed;
    const fight = this.options.mode === "competition";
    // The stands react to what really happens on the pitch.
    const uproar: Partial<Record<CouncilEvent["kind"], number>> = { proposal: 0.15, revision: 0.2, weapon: 0.55, critique: 0.35, eliminated: 1, winner: 1.5 };
    if (fight) {
      this.crowd?.cheer(uproar[event.kind] ?? 0);
      if (event.kind === "eliminated") this.options.onCue?.("ooh", 1);
      else if ((uproar[event.kind] ?? 0) >= 0.5) this.options.onCue?.("cheer", uproar[event.kind]!);
    }
    switch (event.kind) {
      case "seat":
      case "replace":
        if (!actor) break;
        actor.actions.push({ kind: "hop", start: now, duration: 0.6 / s });
        this.sparks(this.headOf(actor).add(new this.three.Vector3(0, 0.3, 0)), `#${actor.baseColor.getHexString()}`, 16);
        break;
      case "research":
        // Studying the task: lean toward the middle with a cool trace to the table or pitch centre.
        if (actor) { actor.actions.push({ kind: "lean", start: now, duration: 1.1 / s }); this.beam(actor, null, new this.three.Color("#38bdf8"), 0, false); }
        break;
      case "proposal":
      case "revision":
        if (!actor) break;
        actor.actions.push({ kind: fight ? "hop" : "lean", start: now, duration: 0.7 / s });
        if (!fight && event.kind === "proposal" && this.papers.length < 6) this.addPaper(actor, true);
        break;
      case "draft":
        // The writer stands up and holds the new shared text up for the table.
        if (actor) actor.actions.push({ kind: fight ? "lean" : "present", start: now, duration: (fight ? 0.9 : 1.8) / s });
        this.documentGlow = 1.2;
        this.options.onCue?.("swish", 0.8);
        break;
      case "critique":
        if (!actor || !target) break;
        if (fight) {
          if (actor.eliminated) {
            // From the jury bench the critique is thrown as a ball of light.
            actor.actions.push({ kind: "throw", start: now, duration: 0.8 / s, target });
            this.beam(actor, target, actor.baseColor, 0.25 / s, true, event.score);
          } else {
            const style = this.attackStyle(actor);
            const score = event.score;
            this.options.onCue?.("whoosh", 0.7);
            if (style === "bow" || style === "staff") actor.actions.push({ kind: "shoot", start: now, duration: 1.05 / s, target, style, score });
            else actor.actions.push({ kind: "attack", start: now, duration: (style === "hammer" ? 1.3 : 1.1) / s, target, style, score });
          }
        } else {
          actor.actions.push({ kind: "lean", start: now, duration: 0.8 / s, target });
          this.beam(actor, target, actor.baseColor, 0, false);
        }
        break;
      case "approval":
      case "objection": {
        const verdict = event.kind === "approval" ? "approve" : "object";
        if (actor && !fight && this.documentMesh) {
          // Lean in and bring the wing down on the table: the stamp lands on the shared text.
          actor.actions.push({ kind: "stamp", start: now, duration: 0.9 / s, verdict });
        } else if (actor) {
          actor.actions.push({ kind: verdict === "approve" ? "hop" : "flinch", start: now, duration: 0.6 / s });
          this.sparks(this.headOf(actor), verdict === "approve" ? SPEAKING_GREEN : "#ef4444", 18);
        }
        break;
      }
      case "eliminated": {
        if (!actor) break;
        // Knocked down, back on its feet, then a slow walk off the pitch to the jury bench.
        const fall = 1.5 / s;
        actor.actions = [{ kind: "fall", start: now, duration: fall }];
        if (this.stage && !this.options.reducedMotion) { this.stage.focus = actor; this.stage.until = now + 3.4 / s; }
        this.slowMo(0.35, 1.1);
        this.post?.pulse(0.5);
        this.options.onCue?.("sad", 1);
        this.ambient?.startle(1);
        this.shake = Math.min(1, this.shake + 0.6);
        if (fight) {
          const path = this.benchPath(actor);
          actor.actions.push({ kind: "toBench", start: now + fall, duration: (path.getLength() / WALK_SPEED + SIT_SECONDS) / s, path });
        }
        this.dizzy(actor);
        break;
      }
      case "winner":
        if (fight && actor) {
          // Step up onto the rising podium, then celebrate.
          actor.actions = [{ kind: "toPodium", start: now, duration: 1.1 / s }, { kind: "victory", start: now + 1.1 / s, duration: 2.6 / s }];
          this.burst();
          this.goldRain(actor);
          this.post?.pulse(0.45);
          this.options.onCue?.("fanfare", 1);
          // The winning prompt is carried up to the viewer's box: the work was for them.
          this.deliver(actor, 1.3 / s);
        }
        this.ambient?.startle(1.2);
        if (!fight) {
          if (this.lamp) this.lamp.boost = 2.2;
          for (const avatar of this.avatars.values()) avatar.actions.push({ kind: "hop", start: now + Math.random() * 0.3, duration: 0.7 / s });
          this.radiate();
          this.burst();
        }
        break;
      case "memory":
        if (this.lamp) this.lamp.boost = 1.4;
        break;
      case "failed":
      case "abstained":
        if (actor) actor.actions.push({ kind: "flinch", start: now, duration: 0.5 / s });
        break;
    }
  }

  // ───────────────────────────── effects ─────────────────────────────

  /** A curved light trail from one head to another (or to the shared document), optionally with a projectile. */
  private beam(from: Avatar, to: Avatar | null, color: T.Color, delay: number, projectile: boolean, score?: number | null) {
    const three = this.three;
    const start = from.root.position.clone().add(new three.Vector3(0, 1.85, 0));
    const end = to ? to.root.position.clone().add(new three.Vector3(0, 1.5, 0)) : new three.Vector3(0, 1.05, 0);
    const middle = start.clone().lerp(end, 0.5).add(new three.Vector3(0, 1.1, 0));
    const curve = new three.QuadraticBezierCurve3(start, middle, end);
    const material = new three.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: three.AdditiveBlending, depthWrite: false });
    const tube = new three.Mesh(new three.TubeGeometry(curve, 28, projectile ? 0.018 : 0.025, 6), material);
    this.scene.add(tube);
    const orb = projectile ? new three.Mesh(new three.SphereGeometry(0.11, 14, 10), new three.MeshBasicMaterial({ color })) : null;
    if (orb) this.scene.add(orb);
    const begin = this.now() + delay;
    const travel = 0.45 / this.speed;
    const life = 1.3 / this.speed;
    let hit = false;
    this.effects.push({
      update: (now) => {
        const p = (now - begin) / life;
        if (p < 0) return true;
        material.opacity = Math.sin(clamp(p) * Math.PI) * 0.75;
        if (orb) {
          const q = clamp((now - begin) / travel);
          orb.position.copy(curve.getPoint(q));
          orb.visible = q < 1;
          if (q >= 1 && !hit && to) {
            hit = true;
            this.impact(from, to, score, now, `#${color.getHexString()}`, 0.9);
          }
        }
        return p < 1;
      },
      dispose: () => {
        this.scene.remove(tube);
        tube.geometry.dispose();
        material.dispose();
        if (orb) { this.scene.remove(orb); orb.geometry.dispose(); (orb.material as T.Material).dispose(); }
      },
    });
  }

  /**
   * Rain gear: the umbrella comes out of nowhere into the left wing, opens overhead and stays level whatever the
   * wing is doing; it folds away again when the rain stops.
   */
  private updateUmbrella(avatar: Avatar, delta: number, motion: boolean) {
    const kind = this.weather?.kind;
    const wanted = this.options.mode === "competition" && (kind === "rainy" || kind === "storm") ? 1 : 0;
    avatar.umbrellaOpen = motion ? avatar.umbrellaOpen + (wanted - avatar.umbrellaOpen) * Math.min(1, delta * 3) : wanted;
    if (avatar.umbrellaOpen < 0.01) { if (avatar.umbrella) avatar.umbrella.visible = false; return; }
    const umbrella = avatar.umbrella ?? this.buildUmbrella(avatar);
    umbrella.visible = true;
    const open = avatar.umbrellaOpen;
    // Hold the wing up; the canopy unfolds from a furled spike.
    avatar.leftArm.rotation.x = Math.min(avatar.leftArm.rotation.x, -2.35 * ease(clamp(open * 1.4)));
    avatar.leftArm.rotation.z = -0.25 * open;
    const canopy = umbrella.children[0];
    canopy.scale.set(0.18 + 0.82 * ease(open), 0.5 + 0.5 * ease(open), 0.18 + 0.82 * ease(open));
    // Keep the umbrella upright in the world: undo the wing's turn, keep the body's heading.
    avatar.root.updateMatrixWorld(true);
    const hand = new this.three.Quaternion();
    avatar.leftHand.getWorldQuaternion(hand);
    const heading = new this.three.Quaternion().setFromAxisAngle(new this.three.Vector3(0, 1, 0), avatar.root.rotation.y);
    umbrella.quaternion.copy(hand.invert().multiply(heading));
  }

  private buildUmbrella(avatar: Avatar): T.Group {
    const three = this.three;
    const ramp = this.toonRamp();
    const umbrella = new three.Group();
    const canopyHolder = new three.Group();
    canopyHolder.position.y = 0.95;
    const library = this.parts;
    const canopyGeometry = library?.geometry("acc_umbrella") ?? new three.ConeGeometry(0.62, 0.3, 16, 1, true).translate(0, -0.15, 0);
    const handleGeometry = library?.geometry("acc_umbrella_handle") ?? new three.CylinderGeometry(0.018, 0.018, 1.0, 6).translate(0, 0.5, 0);
    canopyHolder.add(new three.Mesh(canopyGeometry, toon(three, ramp, avatar.baseColor.clone().lerp(this.white, 0.25), { side: three.DoubleSide })));
    umbrella.add(canopyHolder, new three.Mesh(handleGeometry, toon(three, ramp, "#5b3a22")));
    umbrella.traverse((object) => { object.castShadow = true; });
    addOutlines(three, umbrella, this.inkLine());
    avatar.leftHand.add(umbrella);
    avatar.umbrella = umbrella;
    return umbrella;
  }

  /** Sweat flicked off the birds' heads in a heat wave: drops arc out and fall. */
  private updateSweat(delta: number, now: number) {
    const hot = this.weather?.kind === "heat" && !this.options.reducedMotion;
    if (!hot && !this.sweat) return;
    const three = this.three;
    if (!this.sweat) {
      const count = 90;
      const positions = new Float32Array(count * 3).fill(-50);
      const geometry = new three.BufferGeometry();
      geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
      const points = new three.Points(geometry, new three.PointsMaterial({ color: "#8fd0ff", size: 0.11, map: this.dotMap(), transparent: true, opacity: 0.9, depthWrite: false }));
      points.frustumCulled = false;
      this.scene.add(points);
      this.sweat = { points, velocity: new Float32Array(count * 3), age: new Float32Array(count).fill(9), next: 0 };
      this.disposables.push({ dispose: () => { this.scene.remove(points); geometry.dispose(); (points.material as T.Material).dispose(); } });
    }
    const sweat = this.sweat;
    const attribute = sweat.points.geometry.getAttribute("position") as T.BufferAttribute;
    const birds = [...this.avatars.values()].filter((avatar) => !avatar.eliminated);
    if (hot && birds.length && now > sweat.next) {
      sweat.next = now + 0.06;
      const slot = sweat.age.findIndex((age) => age > 1.2);
      if (slot >= 0) {
        const bird = birds[Math.floor(Math.random() * birds.length)];
        const at = this.headOf(bird);
        const side = Math.random() < 0.5 ? -1 : 1;
        const out = new three.Vector3(side * 0.3, 0.2, 0.1).applyAxisAngle(new three.Vector3(0, 1, 0), bird.root.rotation.y);
        attribute.setXYZ(slot, at.x + out.x, at.y + out.y, at.z + out.z);
        sweat.velocity.set([out.x * 3, 1.4, out.z * 3], slot * 3);
        sweat.age[slot] = 0;
      }
    }
    for (let index = 0; index < sweat.age.length; index++) {
      if (sweat.age[index] > 1.2) { attribute.setXYZ(index, 0, -50, 0); continue; }
      sweat.age[index] += delta;
      sweat.velocity[index * 3 + 1] -= 6 * delta;
      attribute.setXYZ(index,
        attribute.getX(index) + sweat.velocity[index * 3] * delta,
        attribute.getY(index) + sweat.velocity[index * 3 + 1] * delta,
        attribute.getZ(index) + sweat.velocity[index * 3 + 2] * delta);
    }
    attribute.needsUpdate = true;
  }

  /** The fighter's move set comes from the weapon in its right wing. */
  private attackStyle(avatar: Avatar): AttackStyle {
    const inHand = [...this.weapons.values()].find((weapon) => weapon.holder === avatar && weapon.mesh.parent === avatar.hand);
    return inHand ? COUNCIL_WEAPONS[inHand.dimension].weapon : "peck";
  }

  /**
   * A blow arrives. How it lands comes from the jury's real score for the target's work: a strong candidate (0.8 and up)
   * side-steps and the blow glances off; the weaker the work was judged, the harder it lands: flash, knock-back, sparks,
   * a jolt of the camera, and for the heaviest a split-second freeze.
   */
  private impact(attacker: Avatar, target: Avatar, score: number | null | undefined, now: number, color: string, heft = 1) {
    const value = score ?? 0.6;
    const away = target.root.position.clone().sub(attacker.root.position).setY(0);
    if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
    away.normalize();
    const interrupt = (action: Action) => {
      if (!target.actions.length || target.actions[0].kind === "idle") target.actions.splice(0, target.actions.length ? 1 : 0, action);
      else target.actions.splice(1, 0, action);
    };
    if (value >= 0.8 && !target.eliminated) {
      const side = new this.three.Vector3(-away.z, 0, away.x).multiplyScalar(Math.random() < 0.5 ? 0.6 : -0.6);
      interrupt({ kind: "dodge", start: now, duration: 0.5 / this.speed, push: side });
      this.options.onCue?.("whoosh", 0.6);
      this.sparks(this.headOf(target), "#ffffff", 8);
      this.shake = Math.min(1, this.shake + 0.08);
      return;
    }
    const weight = clamp((0.8 - value) / 0.5, 0.3, 1.4) * heft;
    this.options.onCue?.(weight > 0.9 ? "heavy" : "hit", weight);
    target.hitFlash = 1;
    this.shake = Math.min(1, this.shake + 0.25 + weight * 0.35);
    this.sparks(this.headOf(target), color, Math.round(14 + 26 * weight));
    this.hitStar(this.headOf(target).lerp(attacker.root.position.clone().setY(1.5), 0.25), color, 0.45 + weight * 0.35);
    interrupt({ kind: "knock", start: now, duration: (0.35 + 0.25 * weight) / this.speed, push: away.multiplyScalar(0.22 + 0.45 * weight) });
    if (weight > 0.9) {
      this.slowMo(0.05, 0.09);
      this.post?.pulse(0.45 * weight);
      if (this.speedLines && !this.options.reducedMotion) {
        const spot = this.headOf(target).project(this.camera);
        this.speedLines.fire(this.realTime, weight, { x: spot.x, y: spot.y });
      }
    }
  }

  /** An arrow loosed in an arc from the archer's wing to the target. */
  private arrow(from: Avatar, to: Avatar, score: number | null | undefined) {
    const three = this.three;
    const start = new three.Vector3();
    from.hand.getWorldPosition(start);
    const end = this.headOf(to).add(new three.Vector3(0, -0.2, 0));
    const middle = start.clone().lerp(end, 0.5).add(new three.Vector3(0, 0.9, 0));
    const curve = new three.QuadraticBezierCurve3(start, middle, end);
    const arrow = new three.Group();
    const shaft = new three.Mesh(new three.CylinderGeometry(0.014, 0.014, 0.62, 6).rotateX(Math.PI / 2), toon(three, this.toonRamp(), "#8a5a2b"));
    const tip = new three.Mesh(new three.ConeGeometry(0.035, 0.1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.35), toon(three, this.toonRamp(), "#d7dde6"));
    const fletch = new three.Mesh(new three.ConeGeometry(0.05, 0.12, 3).rotateX(-Math.PI / 2).translate(0, 0, -0.3), toon(three, this.toonRamp(), `#${from.baseColor.getHexString()}`));
    arrow.add(shaft, tip, fletch);
    this.scene.add(arrow);
    const begin = this.now();
    const flight = 0.45 / this.speed;
    let hit = false;
    this.effects.push({
      update: (now) => {
        const q = clamp((now - begin) / flight);
        const at = curve.getPoint(q);
        arrow.position.copy(at);
        arrow.lookAt(curve.getPoint(Math.min(1, q + 0.02)).add(q >= 1 ? curve.getTangent(1) : new three.Vector3()));
        if (q >= 1 && !hit) { hit = true; this.impact(from, to, score, now, "#ffb347", 0.9); }
        return now - begin < flight + 0.05;
      },
      dispose: () => { this.scene.remove(arrow); arrow.traverse((object) => { const mesh = object as T.Mesh; mesh.geometry?.dispose(); (mesh.material as T.Material | undefined)?.dispose?.(); }); },
    });
  }

  private dotMap(): T.Texture | undefined {
    if (this.dot === undefined) {
      this.dot = softDot(this.three);
      if (this.dot) this.disposables.push(this.dot);
    }
    return this.dot ?? undefined;
  }

  /** Smears the held weapon's arc while it sweeps; the ribbon fades out on its own afterwards. */
  private updateTrail(avatar: Avatar, sweeping: boolean, now: number) {
    this.trails ??= new Map();
    let trail = this.trails.get(avatar.seat.id);
    const blade = avatar.hand.children.find((child) => child.userData.reach);
    if (sweeping && blade && !this.options.reducedMotion) {
      if (!trail) {
        trail = new SwingTrail(this.three, `#${avatar.baseColor.getHexString()}`);
        this.scene.add(trail.mesh);
        this.trails.set(avatar.seat.id, trail);
      }
      avatar.root.updateMatrixWorld(true);
      const [low, high] = blade.userData.reach as [number, number];
      trail.push(blade.localToWorld(new this.three.Vector3(0, low, 0)), blade.localToWorld(new this.three.Vector3(0, high, 0)), now);
    }
    trail?.update(now);
  }

  /** Dust underfoot, or splashes on a wet pitch, or a hotter, sandier dust in a heat wave. */
  private dustColor() {
    const kind = this.weather?.kind;
    return kind === "rainy" || kind === "storm" ? "#d4ebfa" : kind === "heat" ? "#f1d39c" : "#efe4cc";
  }

  /** Footsteps, landings, skids and falls kick up little puffs on the pitch. */
  private kickDust(avatar: Avatar, pose: { position: T.Vector3; yaw: number; lift: number; foot: number; legs: number; skid: boolean; thud: boolean }, now: number) {
    const puffs = this.puffs;
    if (!puffs) return;
    const three = this.three;
    const ground = pose.position.clone().setY(0.05);
    const back = new three.Vector3(-Math.sin(pose.yaw), 0, -Math.cos(pose.yaw));
    const right = new three.Vector3(Math.cos(pose.yaw), 0, -Math.sin(pose.yaw));
    const color = this.dustColor();
    // A footstep: each time a foot comes down, a puff kicked back from it.
    if (pose.foot && pose.foot !== avatar.step && Math.abs(pose.lift) < 0.1 && pose.legs === 0) {
      const at = ground.clone().addScaledVector(right, pose.foot * 0.13).addScaledVector(back, 0.08);
      puffs.spawn(at, 0.08 + Math.random() * 0.04, back.clone().multiplyScalar(0.28).setY(0.16), now, color, 0.45);
    }
    avatar.step = pose.foot || avatar.step;
    // Landing from a jump: a ring the size of the jump.
    if (pose.lift > 0.03 && pose.legs === 0) avatar.airborne = Math.max(avatar.airborne ?? 0, pose.lift);
    else if ((avatar.airborne ?? 0) > 0.11 && Math.abs(pose.lift) <= 0.03) {
      const height = Math.min(1, avatar.airborne);
      puffs.burst(ground, Math.round(4 + height * 6), 0.08 + height * 0.1, 0.35 + height * 0.5, now, color);
      avatar.airborne = 0;
    } else if (Math.abs(pose.lift) <= 0.03) avatar.airborne = 0;
    // Skidding back from a blow (or side-stepping one): a trail of dust from the feet.
    if (pose.skid && now >= (avatar.nextPuff ?? 0)) {
      puffs.spawn(ground.clone().addScaledVector(right, (Math.random() - 0.5) * 0.3), 0.1 + Math.random() * 0.05, new three.Vector3((Math.random() - 0.5) * 0.2, 0.22, (Math.random() - 0.5) * 0.2), now, color, 0.5);
      avatar.nextPuff = now + 0.035;
    }
    // Flat on its back: a big cloud.
    if (pose.thud) puffs.burst(ground, 10, 0.17, 0.9, now, color);
  }

  /**
   * Secondary motion: the tail fan and the forelock are carried by the body, so they lag behind its starts, stops and
   * jumps and wobble back. The tail also tells the mood: wagging in joy, up when angry, drooping when sad.
   */
  private updateJiggle(avatar: Avatar, delta: number, yaw: number, mood: Mood, now: number, motion: boolean) {
    const jiggle = avatar.jiggle;
    if (!jiggle || !avatar.tail || !avatar.tuft) return;
    if (!motion) {
      avatar.tail.rotation.set(0, 0, 0);
      avatar.tuft.rotation.x = avatar.tuftRest;
      return;
    }
    if (delta < 1e-5) {
      avatar.tail.rotation.x = jiggle.tail.value;
      avatar.tail.rotation.z = jiggle.roll.value;
      avatar.tuft.rotation.x = avatar.tuftRest + jiggle.tuft.value;
      if (avatar.cape && avatar.hips.rotation.x === 0) avatar.cape.rotation.x += jiggle.cape?.value ?? 0;
      return;
    }
    const at = avatar.root.position.clone();
    at.y += avatar.body.position.y;
    let forward = 0;
    let side = 0;
    let up = 0;
    if (jiggle.last) {
      const velocity = at.clone().sub(jiggle.last).divideScalar(delta);
      // A jump cut (a seek, a rebuild) is not motion.
      if (velocity.length() > 30) velocity.copy(jiggle.velocity);
      const accel = velocity.clone().sub(jiggle.velocity).divideScalar(delta);
      jiggle.velocity.copy(velocity);
      forward = accel.x * Math.sin(yaw) + accel.z * Math.cos(yaw);
      side = accel.x * Math.cos(yaw) - accel.z * Math.sin(yaw);
      up = accel.y;
    }
    jiggle.last = at;
    const mien = mood === "joy" ? 0.12 : mood === "angry" ? 0.22 : mood === "shock" ? 0.35 : mood === "sad" ? -0.38 : 0;
    const wag = mood === "joy" ? Math.sin(now * 13 + avatar.seat.index) * 0.3 : 0;
    const tail = stepSpring(jiggle.tail, clamp(mien - up * 0.025 - forward * 0.004, -0.8, 0.8), delta);
    const roll = stepSpring(jiggle.roll, clamp(wag + side * 0.005, -0.7, 0.7), delta, 120, 8);
    const tuft = stepSpring(jiggle.tuft, clamp(up * 0.03 - forward * 0.005, -0.7, 0.7), delta, 170, 7);
    avatar.tail.rotation.x = tail;
    avatar.tail.rotation.z = roll;
    avatar.tuft.rotation.x = avatar.tuftRest + tuft;
    // A cape billows back on a burst of speed and floats up as the bird drops, then settles; draped over a chair
    // (hips folded to sit) it stays put.
    if (avatar.cape && avatar.hips.rotation.x === 0) {
      jiggle.cape ??= { value: 0, velocity: 0 };
      avatar.cape.rotation.x += stepSpring(jiggle.cape, clamp(forward * 0.005 + Math.max(0, -up) * 0.012, -0.25, 0.9), delta, 60, 6);
    }
  }

  private headOf(avatar: Avatar) {
    const point = new this.three.Vector3();
    avatar.head.getWorldPosition(point);
    return point;
  }

  /** Where a fighter's weapon tip is now, or its eye when it fights with its beak. */
  private tipOf(avatar: Avatar) {
    avatar.root.updateMatrixWorld(true);
    const blade = avatar.hand.children.find((child) => child.userData.reach);
    if (blade) return blade.localToWorld(new this.three.Vector3(0, (blade.userData.reach as [number, number])[1], 0));
    const eye = avatar.eyeMeshes[0];
    return eye ? eye.getWorldPosition(new this.three.Vector3()) : this.headOf(avatar);
  }

  /** A four-pointed "ting" of light as a fighter readies a blow: on the blade's tip, or in the eye. */
  private glint(at: T.Vector3, size = 0.36) {
    if (this.options.reducedMotion) return;
    const three = this.three;
    const shape = new three.Shape();
    for (let index = 0; index <= 8; index++) {
      const angle = (index / 8) * Math.PI * 2 + Math.PI / 2;
      const radius = index % 2 ? 0.13 : index % 4 ? 0.7 : 1;
      if (index === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    const material = new three.MeshBasicMaterial({ color: "#fffbe6", transparent: true, opacity: 1, depthTest: false, depthWrite: false, blending: three.AdditiveBlending });
    const star = new three.Mesh(new three.ShapeGeometry(shape), material);
    star.position.copy(at);
    star.renderOrder = 14;
    star.scale.setScalar(0.001);
    this.scene.add(star);
    const begin = this.now();
    const life = 0.34 / Math.max(1, this.speed * 0.7);
    this.effects.push({
      update: (now) => {
        const p = clamp((now - begin) / life);
        if (this.camera) star.quaternion.copy(this.camera.quaternion);
        star.rotateZ(p * 1.4);
        star.scale.setScalar(Math.max(0.001, size * Math.sin(p * Math.PI)));
        material.opacity = 1 - p * 0.4;
        return p < 1;
      },
      dispose: () => { this.scene.remove(star); star.geometry.dispose(); material.dispose(); },
    });
    this.options.onCue?.("ting", 0.8);
  }

  /**
   * The comic "pow" of a landed blow: a jagged star that bursts open where it connects, a white flash with a core in
   * the hit's colour. It runs on scene time, so a heavy blow's hit-stop holds it open for a beat.
   */
  private hitStar(at: T.Vector3, color: string, size: number) {
    if (this.options.reducedMotion) return;
    const three = this.three;
    const star = (spikes: number, outer: number, inner: number) => {
      const shape = new three.Shape();
      for (let index = 0; index <= spikes * 2; index++) {
        const angle = (index / (spikes * 2)) * Math.PI * 2;
        // Uneven spikes look drawn rather than computed.
        const radius = index % 2 ? inner : outer * (index % 4 ? 0.78 : 1);
        if (index === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      return new three.ShapeGeometry(shape);
    };
    const flash = new three.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 1, depthTest: false, depthWrite: false });
    const core = new three.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
    const outer = new three.Mesh(star(8, 1, 0.42), flash);
    const inner = new three.Mesh(star(8, 0.6, 0.26), core);
    inner.position.z = 0.01;
    const burst = new three.Group();
    burst.add(outer, inner);
    burst.position.copy(at);
    burst.rotation.z = Math.random() * Math.PI;
    burst.renderOrder = 12;
    outer.renderOrder = 12;
    inner.renderOrder = 13;
    this.scene.add(burst);
    const begin = this.now();
    const life = 0.26;
    const spin = (Math.random() - 0.5) * 2;
    this.effects.push({
      update: (now) => {
        const p = clamp((now - begin) / life);
        if (this.camera) burst.quaternion.copy(this.camera.quaternion);
        burst.rotateZ(spin * p);
        burst.scale.setScalar(size * (0.35 + 0.65 * Math.sin(Math.min(1, p * 2.2) * Math.PI * 0.5)));
        flash.opacity = 1 - p * p;
        core.opacity = 1 - p;
        return p < 1;
      },
      dispose: () => { this.scene.remove(burst); outer.geometry.dispose(); inner.geometry.dispose(); flash.dispose(); core.dispose(); },
    });
  }

  /** Short-lived additive sparks; used for hits, approvals and landings. */
  private sparks(at: T.Vector3, color: string, count = 28) {
    if (this.options.reducedMotion) return;
    const three = this.three;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) {
      positions.set([at.x, at.y, at.z], index * 3);
      const angle = Math.random() * Math.PI * 2;
      const lift = Math.random();
      const power = 1.4 + Math.random() * 2.4;
      velocities.set([Math.cos(angle) * power * (1 - lift * 0.5), 1 + lift * 3, Math.sin(angle) * power * (1 - lift * 0.5)], index * 3);
    }
    const geometry = new three.BufferGeometry();
    const attribute = new three.BufferAttribute(positions, 3);
    geometry.setAttribute("position", attribute);
    const material = new three.PointsMaterial({ color, size: 0.11, map: this.dotMap(), transparent: true, opacity: 1, blending: three.AdditiveBlending, depthWrite: false });
    const points = new three.Points(geometry, material);
    this.scene.add(points);
    const begin = this.now();
    let last = begin;
    const life = 0.7 / Math.max(1, this.speed * 0.7);
    this.effects.push({
      update: (now) => {
        const step = Math.min(0.05, now - last);
        last = now;
        for (let index = 0; index < count; index++) {
          velocities[index * 3 + 1] -= 7 * step;
          attribute.setXYZ(index,
            attribute.getX(index) + velocities[index * 3] * step,
            Math.max(0.03, attribute.getY(index) + velocities[index * 3 + 1] * step),
            attribute.getZ(index) + velocities[index * 3 + 2] * step);
        }
        attribute.needsUpdate = true;
        const p = (now - begin) / life;
        material.opacity = 1 - clamp(p);
        return p < 1;
      },
      dispose: () => { this.scene.remove(points); geometry.dispose(); material.dispose(); },
    });
  }

  /** A ring that races outward along the ground where a weapon lands, or across the table top. */
  private shockwave(at: T.Vector3) {
    if (this.options.reducedMotion) return;
    const three = this.three;
    const material = new three.MeshBasicMaterial({ color: "#fff3c4", transparent: true, opacity: 0.85, depthWrite: false, side: three.DoubleSide });
    const ring = new three.Mesh(new three.RingGeometry(0.16, 0.24, 40), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(at.x, Math.max(0.03, at.y), at.z);
    this.scene.add(ring);
    const begin = this.now();
    const life = 0.6 / Math.max(1, this.speed * 0.7);
    this.effects.push({
      update: (now) => {
        const p = clamp((now - begin) / life);
        ring.scale.setScalar(1 + ease(p) * 7);
        material.opacity = 0.85 * (1 - p);
        return p < 1;
      },
      dispose: () => { this.scene.remove(ring); ring.geometry.dispose(); material.dispose(); },
    });
  }

  /** Agreement at the table: the shared text flares and a ray of lamp-gold light reaches out to every member. */
  private radiate() {
    if (this.options.reducedMotion) return;
    const three = this.three;
    const origin = new three.Vector3(0, 1.08, 0);
    this.documentGlow = 1.8;
    this.shockwave(new three.Vector3(0, 0.995, 0));
    [...this.avatars.values()].forEach((avatar, order) => {
      const end = this.headOf(avatar);
      const curve = new three.QuadraticBezierCurve3(origin, origin.clone().lerp(end, 0.5).add(new three.Vector3(0, 0.8, 0)), end);
      const geometry = new three.TubeGeometry(curve, 32, 0.04, 8);
      const material = new three.MeshBasicMaterial({ color: "#ffe6a8", transparent: true, opacity: 1, blending: three.AdditiveBlending, depthWrite: false });
      const ray = new three.Mesh(geometry, material);
      // A bright bead leads the ray so the light reads as travelling out to each member.
      const bead = new three.Mesh(new three.SphereGeometry(0.1, 14, 10), new three.MeshBasicMaterial({ color: "#fff4d6" }));
      bead.visible = false;
      // Tube indices run along the curve, six per segment side, so a growing draw range grows the ray.
      const total = geometry.index?.count ?? 0;
      geometry.setDrawRange(0, 0);
      this.scene.add(ray, bead);
      const begin = this.now() + (order * 0.1) / this.speed;
      const travel = 0.7 / this.speed;
      const life = 2.4 / this.speed;
      let arrived = false;
      this.effects.push({
        update: (now) => {
          const elapsed = now - begin;
          if (elapsed < 0) return true;
          const reach = ease(clamp(elapsed / travel));
          geometry.setDrawRange(0, Math.floor((reach * total) / 6) * 6);
          // Tube segments are spaced by arc length, so the bead follows the same parametrisation.
          bead.visible = reach < 1;
          bead.position.copy(curve.getPointAt(reach));
          material.opacity = 1 - clamp((elapsed - travel) / (life - travel));
          if (reach >= 1 && !arrived) {
            arrived = true;
            this.sparks(end, `#${avatar.baseColor.getHexString()}`, 16);
          }
          return elapsed < life;
        },
        dispose: () => {
          this.scene.remove(ray, bead);
          geometry.dispose();
          material.dispose();
          bead.geometry.dispose();
          (bead.material as T.Material).dispose();
        },
      });
    });
  }

  /** The winner's finale: gold and winner-coloured confetti tumbles out of the cage's crown and flutters down. */
  private goldRain(winner: Avatar) {
    if (this.options.reducedMotion || this.options.mode !== "competition") return;
    const three = this.three;
    const count = 420;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const palette = ["#f2c14e", "#ffd86b", "#fff3c4", "#e9b949", `#${winner.baseColor.getHexString()}`, "#ffffff"].map((hex) => new three.Color(hex));
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 0.9;
      positions.set([Math.cos(angle) * radius, 7.6 + Math.random() * 0.4, Math.sin(angle) * radius], index * 3);
      const power = 0.8 + Math.random() * 2.6;
      velocities.set([Math.cos(angle) * power, 0.6 + Math.random() * 1.8, Math.sin(angle) * power], index * 3);
      const color = palette[index % palette.length];
      colors.set([color.r, color.g, color.b], index * 3);
      phases[index] = Math.random() * Math.PI * 2;
    }
    const geometry = new three.BufferGeometry();
    const attribute = new three.BufferAttribute(positions, 3);
    geometry.setAttribute("position", attribute);
    geometry.setAttribute("color", new three.BufferAttribute(colors, 3));
    const material = new three.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true, opacity: 1 });
    const points = new three.Points(geometry, material);
    this.scene.add(points);
    const begin = this.now();
    let last = begin;
    const life = 6.5;
    this.effects.push({
      update: (now) => {
        const step = Math.min(0.05, now - last);
        last = now;
        for (let index = 0; index < count; index++) {
          const v = index * 3;
          // Paper falls slowly: light gravity, strong air drag, and a sideways flutter.
          velocities[v + 1] = Math.max(-1.1, velocities[v + 1] - 2.4 * step);
          velocities[v] *= 1 - step * 0.9;
          velocities[v + 2] *= 1 - step * 0.9;
          const flutter = Math.sin(now * 6 + phases[index]) * 0.5;
          attribute.setXYZ(index,
            attribute.getX(index) + (velocities[v] + flutter) * step,
            Math.max(0.03, attribute.getY(index) + velocities[v + 1] * step),
            attribute.getZ(index) + (velocities[v + 2] + flutter * 0.6) * step);
        }
        attribute.needsUpdate = true;
        material.opacity = clamp((life - (now - begin)) / 1.2);
        return now - begin < life;
      },
      dispose: () => { this.scene.remove(points); geometry.dispose(); material.dispose(); },
    });
  }

  private burst() {
    const three = this.three;
    if (this.confetti) { this.scene.remove(this.confetti.points); this.confetti.points.geometry.dispose(); (this.confetti.points.material as T.Material).dispose(); }
    const count = 320;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const palette = ["#22c55e", "#f2c14e", "#8b5cf6", "#3b82f6", "#ec4899", "#ffffff"].map((value) => new three.Color(value));
    const center = this.state?.winner ? this.avatars.get(this.state.winner)?.root.position ?? new three.Vector3() : new three.Vector3();
    for (let index = 0; index < count; index++) {
      positions.set([center.x, 2.2, center.z], index * 3);
      const angle = Math.random() * Math.PI * 2;
      const power = 1.5 + Math.random() * 3.5;
      velocities.set([Math.cos(angle) * power, 3 + Math.random() * 4, Math.sin(angle) * power], index * 3);
      const color = palette[index % palette.length];
      colors.set([color.r, color.g, color.b], index * 3);
    }
    const geometry = new three.BufferGeometry();
    geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new three.BufferAttribute(colors, 3));
    const points = new three.Points(geometry, new three.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, opacity: 1 }));
    this.scene.add(points);
    this.confetti = { points, velocities, until: this.now() + 4.5 };
  }

  // ───────────────────────────── frame loop ─────────────────────────────

  /** Scene time (slowed by hit-stops and slow motion); falls back to the clock where no scene time is kept. */
  private now() { return this.sceneTime ?? this.clock.getElapsed(); }

  /** Slow the action to `scale` for `seconds` of real time (a hit-stop when short, slow motion when longer). */
  private slowMo(scale: number, seconds: number) {
    if (this.options.reducedMotion || this.realTime === undefined) return;
    this.warp = { scale: Math.min(this.warpScale(), scale), until: this.realTime + seconds };
  }

  private warpScale() {
    const warp = this.warp;
    if (!warp || this.realTime === undefined) return 1;
    if (this.realTime < warp.until) return warp.scale;
    // Ease back to full speed over a quarter second.
    return Math.min(1, warp.scale + (this.realTime - warp.until) * 4 * (1 - warp.scale));
  }

  private readonly loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    if (!this.visible || document.hidden) return;
    this.clock.update();
    const real = Math.min(0.05, this.clock.getDelta());
    this.realTime += real;
    const delta = real * this.warpScale();
    this.sceneTime += delta;
    const now = this.now();
    this.updateCamera(real, now);
    for (const avatar of this.avatars.values()) this.updateAvatar(avatar, delta, now);
    this.puffs?.update(now);
    this.ambient?.update(now, delta);
    this.speedLines?.update(this.realTime, this.camera);
    this.updateDrops(now);
    this.updateTable(delta, now);
    this.updatePodium(delta);
    this.updateStage(delta, now);
    this.updateRoom(delta, now);
    const speaker = this.state?.speaker ? this.avatars.get(this.state.speaker) : undefined;
    const champion = this.state?.winner ? this.avatars.get(this.state.winner) : undefined;
    this.crowd?.update(now, delta, speaker?.root.position ?? null, Boolean(this.state?.winner), champion?.baseColor ?? null);
    this.updateConfetti(delta, now);
    for (let index = this.effects.length - 1; index >= 0; index--) {
      if (!this.effects[index].update(now)) { this.effects[index].dispose(); this.effects.splice(index, 1); }
    }
    if (this.post) this.post.render(real); else this.renderer.render(this.scene, this.camera);
    this.options.onFrame?.(this.anchors());
  };

  private baseFocus() {
    // At the table the view aims a little above it, so the far wall and its windows fill the back of the frame.
    return this.options.mode === "collaboration" ? new this.three.Vector3(0, 1.45, 0) : new this.three.Vector3(0, 0.6, -1.2);
  }

  /**
   * The director's camera. Each shot sets a focus, an angle and a distance; the camera eases from one to the next in
   * real time (so slow motion still looks smooth). Grabbing the view hands control to the viewer for a few seconds.
   */
  private updateCamera(delta: number, now: number) {
    const reduced = this.options.reducedMotion;
    const manual = this.dragging || this.realTime < this.manualUntil;
    if (!this.dragging && !reduced && now - this.lastInteraction > 4) this.azimuth += delta * 0.045;
    const fight = this.options.mode === "competition";
    const base = this.distance;
    const want = { focus: this.baseFocus(), azimuth: this.azimuth, elevation: this.elevation, distance: base };
    const shot = manual || reduced ? WIDE : this.shot;
    const age = this.realTime - this.shotAt;
    const subject = shot.subject ? this.avatars.get(shot.subject) : undefined;
    const other = shot.other ? this.avatars.get(shot.other) : undefined;
    const head = (avatar: Avatar) => avatar.root.position.clone().add(new this.three.Vector3(0, 1.55, 0));
    const toward = (from: T.Vector3, to: T.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);
    if (shot.kind === "speaker" && subject) {
      want.focus = head(subject);
      if (other && other !== subject) {
        // Over the shoulder of the one being addressed.
        want.azimuth = toward(subject.root.position, other.root.position) + 0.28;
        want.distance = subject.root.position.distanceTo(other.root.position) + (fight ? 3.4 : 2.6);
        // Across the table the view stays low, so the lit table top is a strip in front, not the whole frame.
        want.elevation = fight ? 0.3 : 0.17;
      } else {
        // From across the table / pitch, a three-quarter view of the speaker's face. At the table the camera stays
        // low and off-centre, from between the far seats, so it never hangs under the lantern looking down onto
        // the lit table top (which fills the frame and blooms).
        want.azimuth = toward(subject.root.position, new this.three.Vector3()) + (subject.seat.index % 2 ? 1 : -1) * (fight ? 0.42 : 0.32);
        want.distance = fight ? base * 0.48 : 5.6;
        want.elevation = fight ? 0.26 : 0.12;
      }
    } else if (shot.kind === "duel" && subject && other) {
      // Side-on to the line between them, on whichever side is nearer the current view. A melee attack is framed
      // tight where the blow lands (by the target); a shot from range keeps both birds in view.
      const line = other.home.clone().sub(subject.home).setY(0);
      const side = Math.atan2(-line.z, line.x);
      const flip = Math.abs(this.angleDelta(this.cam.azimuth, side)) > Math.PI / 2 ? side + Math.PI : side;
      const melee = subject.actions.some((action) => action.kind === "attack");
      want.focus = (melee ? subject.home.clone().lerp(other.home, 0.78) : subject.home.clone().lerp(other.home, 0.5)).add(new this.three.Vector3(0, 1.05, 0));
      want.azimuth = flip;
      want.distance = melee ? 5.6 : Math.max(6.5, line.length() * 1.15 + 3.2);
      want.elevation = melee ? 0.24 : 0.3;
    } else if (shot.kind === "drama" && subject) {
      // Low, from the middle of the pitch, pushing slowly in on the eliminated bird.
      want.focus = subject.root.position.clone().add(new this.three.Vector3(0, 0.9, 0));
      want.azimuth = toward(subject.home, new this.three.Vector3()) + 0.3;
      want.distance = Math.max(4.2, 7.5 - age * 1.1);
      want.elevation = 0.14;
    } else if (shot.kind === "hero" && subject) {
      // Low angle round the winner on the podium.
      want.focus = head(subject).add(new this.three.Vector3(0, 0.1, 0));
      // A slow, steady circle round the winner (driven below, not eased toward).
      want.azimuth = this.cam.azimuth;
      want.distance = 4.4;
      want.elevation = 0.12;
    } else if (shot.kind === "overview") {
      want.elevation = 0.95;
      want.distance = base * 1.05;
    }

    // Ease toward the shot: quick to start a new shot, gentle while holding one.
    const cam = this.cam;
    if (!cam.ready || reduced) {
      cam.azimuth = want.azimuth; cam.elevation = want.elevation; cam.distance = want.distance;
      this.focus.copy(want.focus);
      cam.ready = true;
    } else {
      const rate = Math.min(1, delta * (age < 0.9 ? 3.2 : 1.8));
      if (shot.kind === "hero") cam.azimuth += delta * 0.32;
      else cam.azimuth += this.angleDelta(cam.azimuth, want.azimuth) * rate;
      cam.elevation += (want.elevation - cam.elevation) * rate;
      cam.distance += (want.distance - cam.distance) * rate;
      this.focus.lerp(want.focus, rate);
    }
    if (manual) { cam.azimuth = this.azimuth; cam.elevation = this.elevation; } else { this.azimuth = shot.kind === "wide" ? this.azimuth : cam.azimuth; }
    this.camera.position.set(
      this.focus.x + Math.sin(cam.azimuth) * Math.cos(cam.elevation) * cam.distance,
      this.focus.y + Math.sin(cam.elevation) * cam.distance,
      this.focus.z + Math.cos(cam.azimuth) * Math.cos(cam.elevation) * cam.distance,
    );
    this.camera.lookAt(this.focus);
    if (this.shake > 0.001 && !reduced) {
      const amount = this.shake * this.shake * 0.22;
      this.camera.position.x += (Math.random() - 0.5) * amount;
      this.camera.position.y += (Math.random() - 0.5) * amount;
      this.camera.rotation.z += (Math.random() - 0.5) * amount * 0.12;
    }
    this.shake = Math.max(0, this.shake - delta * 2.4);
  }

  private updateAvatar(avatar: Avatar, delta: number, now: number) {
    const motion = !this.options.reducedMotion;
    const fight = this.options.mode === "competition";
    const restBench = avatar.eliminated && fight;
    const onPodium = fight && avatar.winner && !restBench && this.podium !== null;
    const rest = restBench ? avatar.bench : onPodium ? this.podiumTop() : avatar.home;
    let position = rest.clone();
    // On the podium the winner faces the camera.
    let yaw = restBench ? 0 : onPodium ? this.azimuth : avatar.homeYaw;
    let lift = restBench ? BENCH_LIFT : 0;
    let tilt = 0;
    let swing = 0;
    let raise = 0;
    let legs = fight && !restBench ? 0 : -Math.PI / 2;
    /** Covering ground this frame: legs and arms swing in step. */
    let moving = false;
    /** Head hung low, as when walking off after an elimination. */
    let droop = 0;
    /** Squash (< 0) and stretch (> 0) of the whole body, the cartoon timing of jumps and landings. */
    let stretch = 0;
    /** A weapon move's own right-wing pose (overrides the generic swing), a bow-string pull, and a beak peck. */
    let arm: { x: number; z: number } | null = null;
    let leftPull = 0;
    let peck = 0;
    let twirl = 0;
    /** Idle fidgets: a head turn and dip, both wings spread, a foot tap, a body shake. */
    let idleTurn = 0;
    let idleDip = 0;
    let spread = 0;
    let tap = 0;
    let wiggle = 0;
    /** Comforting pat: which wing (+1 right, −1 left) and how far it is raised. */
    let patSide = 0;
    let patLift = 0;
    /** The blade is sweeping (leave a trail); the feet are skidding; the body just hit the ground. */
    let slash = false;
    let skid = false;
    let thud = false;
    /** The weapon is gripped for a blow: it runs straight out from the wing, so the wing's swing is the weapon's. */
    let grip = false;
    let mood: Mood = avatar.winner ? "joy" : avatar.eliminated || avatar.failed ? "sad" : avatar.thinking ? "think" : "calm";

    // Left alone, a bird fidgets now and then. While another bird speaks it only does quiet things, so eyes stay on the
    // speaker; seated birds do not hop.
    if (motion && fight && avatar.winner && !avatar.actions.length && now > avatar.nextIdle) {
      avatar.actions.push({ kind: "victory", start: now, duration: 2.6 / this.speed });
      avatar.nextIdle = now + (5 + Math.random() * 3) / Math.max(1, this.speed * 0.6);
    }
    if (motion && !avatar.actions.length && !avatar.active && !avatar.thinking && !avatar.failed && !avatar.winner && now > avatar.nextIdle) {
      const someoneSpeaks = Boolean(this.state?.speaker && this.state.speaker !== avatar.seat.id);
      const seated = !fight || avatar.eliminated;
      const pool: IdleKind[] = someoneSpeaks ? ["tap", "shake"] : seated ? ["preen", "stretch", "look", "tap", "shake"] : ["preen", "stretch", "look", "hop", "tap", "shake"];
      if (!someoneSpeaks && Math.random() < 0.35) {
        // With nobody speaking, sometimes a resting or thinking clip from the shared gesture library instead.
        const category: GestureCategory = Math.random() < 0.5 ? "resting" : "thinking";
        this.startGesture(avatar, chooseNextGesture(avatar.lastGesture ?? null, { seat: avatar.seat.id, event: `idle-${Math.floor(now * 10)}`, category }), now);
      } else {
        const idle = pool[Math.floor(Math.random() * pool.length)];
        avatar.actions.push({ kind: "idle", idle, start: now, duration: IDLE_SECONDS[idle] / Math.max(1, this.speed * 0.6) });
      }
      avatar.nextIdle = now + (4 + Math.random() * 6) / Math.max(1, this.speed * 0.6);
    }

    const action = avatar.actions[0];
    if (action && now >= action.start) {
      const p = clamp((now - action.start) / action.duration);
      switch (action.kind) {
        case "attack": {
          // Run in, strike with the weapon's own move, run back. Each weapon has its reach, timing and weight.
          const style = action.style ?? "sword";
          const target = action.target!.root.position;
          const toward = target.clone().sub(rest).setY(0);
          const reachOf = { sword: 1.4, hammer: 1.45, spear: 1.85, shield: 1.25, peck: 0.95, bow: 1, staff: 1 }[style];
          const contact = rest.clone().add(toward.clone().multiplyScalar(Math.max(0, (toward.length() - reachOf) / Math.max(toward.length(), 0.001))));
          const forward = toward.clone().normalize();
          yaw = yawToward(rest, target);
          legs = 0;
          moving = (p >= 0.08 && p < 0.35) || p >= 0.62;
          // Before the run: a crouch to gather itself, and a glint of light off the blade (or in the eye).
          const crouch = p < 0.08 ? Math.sin((p / 0.08) * Math.PI * 0.5) : 0;
          if (!action.landed && p >= 0.03) { action.landed = true; this.glint(this.tipOf(avatar)); }
          const strikeAt = style === "hammer" ? 0.6 : 0.48;
          if (p < 0.08) position.copy(rest);
          else if (p < 0.35) position.lerpVectors(rest, contact, ease((p - 0.08) / 0.27));
          else if (p < 0.62) {
            position.copy(contact);
            const k = (p - 0.35) / 0.27;
            switch (style) {
              case "sword": {
                // A diagonal overhead slash: the blade swung back over the shoulder with the hips wound up, then
                // brought down across the body (meeting the target on the way down) as the hips unwind into it.
                grip = true;
                const windUp = ease(clamp(k / 0.3));
                const cut = ease(clamp((k - 0.3) / 0.4));
                arm = k < 0.3 ? { x: -1 - windUp * 2.4, z: 0.2 + windUp * 0.5 } : { x: -3.4 + cut * 2.9, z: 0.7 - cut * 1.2 };
                yaw += k < 0.3 ? windUp * 0.4 : 0.4 - cut * 0.95;
                break;
              }
              case "hammer": {
                // Wound up high behind the head (stretching tall), then brought down hard onto the target.
                grip = true;
                const slam = ease(clamp((k - 0.72) / 0.23));
                arm = k < 0.72 ? { x: -1 - ease(k / 0.72) * 2.6, z: 0.1 } : { x: -3.6 + slam * 2.8, z: 0.1 };
                stretch = k < 0.72 ? 0.08 * ease(k / 0.72) : -0.12 * slam;
                break;
              }
              case "spear":
                // Two quick thrusts, lunging into each.
                grip = true;
                arm = { x: -1.55, z: 0.05 };
                position.addScaledVector(forward, Math.max(0, Math.sin(k * Math.PI * 2)) * 0.32);
                break;
              case "shield":
                // A shove behind the shield.
                arm = { x: -1.35, z: -0.2 };
                position.addScaledVector(forward, Math.sin(k * Math.PI) * 0.38);
                tilt = Math.sin(k * Math.PI) * 0.22;
                break;
              case "peck":
                // No weapon: a sharp peck with the beak.
                peck = Math.sin(k * Math.PI);
                tilt = peck * 0.42;
                break;
            }
            // The blade leaves a smear through the strike itself (the cut, the downswing, the thrusts).
            slash = style === "sword" ? k > 0.28 && k < 0.8 : style === "hammer" ? k > 0.7 : style === "spear";
            if (!action.fired && p > strikeAt) {
              action.fired = true;
              const heft = style === "hammer" ? 1.4 : style === "peck" ? 0.6 : style === "shield" ? 1.1 : 1;
              this.impact(avatar, action.target!, action.score, now, style === "peck" ? "#ffd86b" : "#ffb347", heft);
              if (style === "hammer") {
                this.shockwave(target.clone().setY(0));
                this.puffs?.burst(target.clone().setY(0.05), 12, 0.2, 1.3, now, this.dustColor());
              }
            }
          } else position.lerpVectors(contact, rest, ease((p - 0.62) / 0.38));
          lift = p < 0.08 ? -0.045 * crouch : Math.sin(p * Math.PI) * 0.08;
          mood = "angry";
          if (p < 0.08) {
            stretch = -0.15 * crouch;
            tilt = 0.14 * crouch;
          } else if (style !== "hammer" || p >= 0.62) {
            // Launching out of the crouch stretched long, the strike's own stretch, and a breath back at its place.
            stretch = p < 0.35 ? 0.08 * (1 - (p - 0.08) / 0.27) : p < 0.62 ? 0.06 * Math.sin(((p - 0.35) / 0.27) * Math.PI)
              : p > 0.88 ? 0.05 * Math.sin(((p - 0.88) / 0.12) * Math.PI) : 0;
          }
          break;
        }
        case "shoot": {
          // Ranged: stand ground, face the target, draw (bow) or raise the staff, loose at 45%, follow through.
          yaw = yawToward(rest, action.target!.root.position);
          const draw = clamp(p / 0.45);
          if (action.style === "bow") {
            arm = { x: -1.5, z: 0.05 };
            leftPull = draw < 1 ? ease(draw) : 1 - ease(clamp((p - 0.45) / 0.2));
          } else {
            // The staff raised high, its orb at the top.
            grip = true;
            arm = { x: -1.2 - ease(draw) * 1.75, z: 0.15 };
            stretch = 0.06 * Math.sin(draw * Math.PI);
          }
          if (!action.landed && p >= 0.36) { action.landed = true; this.glint(this.tipOf(avatar), 0.3); }
          if (!action.fired && p >= 0.45) {
            action.fired = true;
            if (action.style === "bow") this.arrow(avatar, action.target!, action.score);
            else this.beam(avatar, action.target!, new this.three.Color("#b48bff"), 0, true, action.score);
          }
          mood = "angry";
          break;
        }
        case "throw":
          yaw = yawToward(rest, action.target!.root.position);
          swing = Math.sin(clamp(p / 0.35) * Math.PI);
          mood = "angry";
          break;
        case "pickup": {
          const weapon = action.weapon!;
          const spot = weapon.spot.clone().add(rest.clone().sub(weapon.spot).setY(0).normalize().multiplyScalar(0.45));
          legs = 0;
          moving = p < 0.4 || p >= 0.6;
          yaw = p < 0.5 ? yawToward(rest, spot) : yawToward(spot, rest) + Math.PI;
          if (p < 0.4) position.lerpVectors(rest, spot, ease(p / 0.4));
          else if (p < 0.6) {
            position.copy(spot);
            lift = -Math.sin(((p - 0.4) / 0.2) * Math.PI) * 0.25;
            if (!action.fired && p > 0.5) {
              action.fired = true;
              weapon.drop = null;
              // A faster replay may already have moved this weapon on; only the current holder takes it.
              if (this.state?.weapons[weapon.dimension] === avatar.seat.id) this.attach(weapon, avatar);
            }
          } else {
            position.lerpVectors(spot, rest, ease((p - 0.6) / 0.4));
            raise = Math.sin(((p - 0.6) / 0.4) * Math.PI) * 0.8;
            // Equip: the new weapon is twirled once and shown off overhead, leaving a ring of light.
            twirl = ease((p - 0.6) / 0.4) * Math.PI * 2;
            slash = p < 0.92;
            if (!action.landed && p > 0.62) {
              action.landed = true;
              this.options.onCue?.("pop", 1);
              const at = new this.three.Vector3();
              avatar.hand.getWorldPosition(at);
              this.sparks(at, "#ffe08a", 12);
            }
          }
          break;
        }
        case "fall": {
          // Knocked flat on its back, a moment on the ground, then slowly back on its feet.
          position = avatar.home.clone();
          yaw = avatar.homeYaw;
          legs = fight ? 0 : -Math.PI / 2;
          const down = p < 0.3 ? ease(p / 0.3) : p < 0.62 ? 1 : 1 - ease((p - 0.62) / 0.38);
          tilt = -down * (Math.PI / 2);
          lift = -down * 0.55;
          if (!action.landed && p >= 0.3) { action.landed = true; thud = true; }
          droop = p >= 0.62 ? 0.3 : 0;
          mood = p < 0.62 ? "shock" : "sad";
          stretch = p < 0.3 ? 0 : p < 0.4 ? -0.14 * Math.sin(((p - 0.3) / 0.1) * Math.PI) : 0;
          break;
        }
        case "toBench": {
          // Head down along the route, then turn round and sit at its place on the bench.
          const path = action.path!;
          const walking = path.getLength() / WALK_SPEED;
          const walk = walking / (walking + SIT_SECONDS);
          if (p < walk) {
            const t = clamp(p / walk);
            position = path.getPoint(t);
            const ahead = path.getPoint(Math.min(1, t + 0.02));
            yaw = yawToward(position, ahead);
            legs = 0;
            moving = true;
            droop = 0.35;
          } else {
            const sit = ease(clamp((p - walk) / (1 - walk)));
            if (!action.fired) {
              action.fired = true;
              // Whoever already sits on the bench next to it puts a wing round its shoulder.
              const neighbour = [...this.avatars.values()]
                .filter((other) => other !== avatar && other.eliminated && !other.actions.some((entry) => entry.kind === "toBench"))
                .sort((left, right) => left.bench.distanceTo(avatar.bench) - right.bench.distanceTo(avatar.bench))[0];
              if (neighbour && neighbour.bench.distanceTo(avatar.bench) < 2.5) {
                neighbour.actions.push({ kind: "pat", start: now + 0.3 / this.speed, duration: 1.6 / this.speed, target: avatar });
              }
            }
            position = avatar.bench.clone();
            yaw = yawToward(path.getPoint(0.98), path.getPoint(1)) * (1 - sit);
            legs = -Math.PI / 2 * sit;
            lift = BENCH_LIFT * sit;
            droop = 0.35 * (1 - sit);
          }
          break;
        }
        case "victory": {
          // Every bird has its own signature dance, picked by its seat.
          const facing = onPodium ? this.cam?.azimuth ?? this.azimuth : avatar.homeYaw;
          mood = "joy";
          switch (avatar.seat.index % 4) {
            case 0:
              // Spin-hop: four bounces through a full turn, wings up.
              lift = Math.abs(Math.sin(p * Math.PI * 4)) * 0.55;
              raise = 1;
              yaw = facing + p * Math.PI * 2;
              stretch = -Math.cos(p * Math.PI * 8) * 0.1;
              break;
            case 1: {
              // Flap and hover: wings beating fast, rising up and hanging there.
              const up = Math.sin(clamp(p * 1.25) * Math.PI * 0.5) * (1 - clamp((p - 0.85) / 0.15));
              lift = up * 0.85 + Math.sin(now * 9) * 0.05 * up;
              spread = 1.0 + Math.sin(now * 26) * 0.55;
              legs = 0.35 * up;
              yaw = facing;
              break;
            }
            case 2:
              // Hip shimmy: side to side on the beat, wings swinging in turn.
              position.addScaledVector(new this.three.Vector3(Math.cos(facing), 0, -Math.sin(facing)), Math.sin(p * Math.PI * 6) * 0.22);
              wiggle = Math.sin(p * Math.PI * 12) * 0.16;
              raise = 0.55 + Math.sin(p * Math.PI * 6) * 0.35;
              yaw = facing + Math.sin(p * Math.PI * 3) * 0.3;
              lift = Math.abs(Math.sin(p * Math.PI * 6)) * 0.1;
              break;
            default:
              // Salute: weapon (or wing) thrust high, chest puffed, a slow proud turn and back.
              grip = true;
              arm = { x: -2.95, z: 0.1 };
              stretch = 0.11 * Math.sin(Math.min(1, p * 3) * Math.PI * 0.5);
              yaw = facing + Math.sin(p * Math.PI * 2) * 0.6;
              lift = 0.06 * Math.sin(p * Math.PI);
              break;
          }
          break;
        }
        case "toPodium":
          legs = 0;
          position.lerpVectors(avatar.home, rest, ease(p));
          position.y = rest.y * ease(p) + Math.sin(p * Math.PI) * 0.9;
          yaw = p < 0.8 ? yawToward(avatar.home, rest) : this.azimuth;
          stretch = -Math.cos(p * Math.PI * 2) * 0.12;
          mood = "joy";
          break;
        case "lean": {
          tilt = Math.sin(p * Math.PI) * 0.28;
          if (action.target) yaw = avatar.homeYaw + clamp(Math.sin(p * Math.PI), 0, 1) * this.angleDelta(avatar.homeYaw, yawToward(rest, action.target.root.position)) * 0.6;
          break;
        }
        case "flinch":
          tilt = -Math.sin(p * Math.PI) * 0.3;
          stretch = -Math.sin(p * Math.PI) * 0.08;
          mood = "shock";
          break;
        case "hop":
          lift = Math.sin(p * Math.PI) * (fight ? 0.35 : 0.18);
          raise = Math.sin(p * Math.PI) * 0.6;
          stretch = -Math.cos(p * Math.PI * 2) * 0.1;
          if (!avatar.eliminated && !avatar.failed) mood = "joy";
          break;
        case "present": {
          // Up from the chair, the text held high in both wings, a turn to show the table, then back down.
          const up = p < 0.25 ? ease(p / 0.25) : p > 0.8 ? 1 - ease((p - 0.8) / 0.2) : 1;
          legs = -Math.PI / 2 * (1 - up);
          lift = 0.14 * up;
          raise = 0.75 * up;
          yaw = avatar.homeYaw + Math.sin(clamp((p - 0.25) / 0.55) * Math.PI * 2) * 0.45 * up;
          stretch = 0.05 * up;
          mood = "joy";
          break;
        }
        case "stamp": {
          // Lean over the table, wing up, then down hard: the stamp lands at the slam.
          tilt = 0.32 * Math.sin(Math.min(1, p * 1.6) * Math.PI * 0.5);
          arm = p < 0.45 ? { x: -0.4 - ease(p / 0.45) * 2.0, z: 0.2 } : { x: -2.4 + ease(clamp((p - 0.45) / 0.12)) * 1.6, z: 0.2 };
          if (!action.fired && p > 0.56) {
            action.fired = true;
            this.placeStamp(action.verdict ?? "approve", true);
          }
          mood = action.verdict === "object" ? "angry" : "joy";
          break;
        }
        case "pat": {
          // Leaning in toward the newcomer with the near wing round its shoulder, patting twice.
          const target = action.target!;
          const dx = target.root.position.x - position.x;
          const dz = target.root.position.z - position.z;
          const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw);
          const reach = Math.sin(p * Math.PI);
          patSide = localX >= 0 ? 1 : -1;
          patLift = reach * 1.05 + Math.max(0, Math.sin(p * Math.PI * 6)) * 0.18 * reach;
          tilt = 0.08 * reach;
          wiggle = patSide * 0.12 * reach;
          mood = "sad";
          break;
        }
        case "knock": {
          // Shoved back by the blow, a stagger, then back to its spot.
          const slide = p < 0.3 ? ease(p / 0.3) : 1 - ease((p - 0.3) / 0.7);
          if (action.push) position.addScaledVector(action.push, slide);
          skid = p < 0.3 && (action.push?.length() ?? 0) > 0.3;
          tilt = -0.5 * Math.sin(p * Math.PI) * Math.min(1, (action.push?.length() ?? 0.3) * 2);
          stretch = p < 0.2 ? -0.1 * Math.sin((p / 0.2) * Math.PI) : 0;
          mood = "shock";
          break;
        }
        case "dodge": {
          // A neat side-step, a little hop, and a confident look.
          if (action.push) position.addScaledVector(action.push, Math.sin(p * Math.PI));
          lift = Math.sin(p * Math.PI) * 0.12;
          skid = p < 0.15;
          stretch = -Math.cos(p * Math.PI * 2) * 0.05;
          mood = "joy";
          break;
        }
        case "idle": {
          const bell = Math.sin(p * Math.PI);
          switch (action.idle) {
            case "preen":
              // Head round to the right wing, a few quick nibbles at the feathers.
              idleTurn = -0.95 * bell;
              idleDip = 0.35 * bell + Math.max(0, Math.sin(p * Math.PI * 9)) * 0.12 * bell;
              arm = { x: -0.3 * bell, z: 0.55 * bell };
              peck = Math.max(0, Math.sin(p * Math.PI * 9)) * bell * 0.5;
              break;
            case "stretch":
              // Both wings up and out, up on its toes, eyes screwed shut with the pleasure of it.
              raise = 0.9 * bell;
              spread = 0.65 * bell;
              stretch = 0.09 * bell;
              lift += 0.04 * bell;
              mood = "joy";
              break;
            case "look":
              // A look left, then right, then back.
              idleTurn = Math.sin(p * Math.PI * 2) * 0.85;
              break;
            case "hop":
              lift = bell * 0.16;
              stretch = -Math.cos(p * Math.PI * 2) * 0.08;
              break;
            case "tap":
              // Three taps of one foot (or a swing of it when seated).
              tap = Math.max(0, Math.sin(p * Math.PI * 6)) * 0.45;
              break;
            case "shake":
              // A quick shake that fluffs the feathers.
              wiggle = Math.sin(p * Math.PI * 12) * 0.13 * (1 - p);
              stretch = -0.04 * bell;
              if (!action.fired && p > 0.3) { action.fired = true; this.sparks(this.headOf(avatar).add(new this.three.Vector3(0, -0.6, 0)), "#ffffff", 8); }
              break;
          }
          break;
        }
      }
      if (p >= 1) avatar.actions.shift();
    } else if (avatar.winner && fight) {
      raise = 0.8;
      lift = motion ? Math.abs(Math.sin(now * 3)) * 0.12 : 0;
    }

    const breathing = motion ? Math.sin(now * 2 + avatar.seat.index) * 0.012 : 0;
    // Opposite wing and leg swing together; the body bobs once per step and rocks side to side in a waddle.
    const stride = moving && motion ? Math.sin(now * 12 * Math.min(2, this.speed)) : 0;
    /** Which foot is down: it changes at the far end of each step. */
    const foot = moving && motion ? Math.sign(Math.cos(now * 12 * Math.min(2, this.speed))) : 0;
    if (!motion) stretch = 0;
    const squash = stretch + breathing * 1.5;
    avatar.root.position.copy(position);
    avatar.root.rotation.y = yaw;
    avatar.body.position.y = lift + Math.abs(stride) * 0.05;
    avatar.body.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
    avatar.body.rotation.x = tilt;
    avatar.body.rotation.z = stride * 0.13;
    avatar.hips.rotation.x = legs;
    avatar.legs[0].rotation.x = -stride * 0.55;
    avatar.legs[1].rotation.x = stride * 0.55 - tap;
    avatar.body.rotation.z += wiggle;
    avatar.rightArm.rotation.x = -swing * 2.3 - raise * 2.6 - stride * 0.45;
    avatar.leftArm.rotation.x = -raise * 2.6 + stride * 0.45;
    // Talking with the wings: flaps and lifts on the beat of its words while it has the floor; a wing holding a weapon
    // stays steady, and an eliminated or failed bird keeps its wings down.
    const talk = motion && !avatar.failed && !avatar.eliminated ? avatar.speaking : 0;
    const beat = Math.max(0, Math.sin(now * 5.2 + avatar.seat.index * 1.7));
    const offbeat = Math.max(0, Math.sin(now * 5.2 + avatar.seat.index * 1.7 + Math.PI * 0.8));
    const armed = avatar.hand.children.length > 0;
    avatar.leftArm.rotation.z = -talk * (0.22 + beat * 0.5);
    avatar.leftArm.rotation.x -= talk * beat * 0.55;
    avatar.rightArm.rotation.z = talk * (armed ? 0.08 : 0.22 + offbeat * 0.5);
    if (!armed) avatar.rightArm.rotation.x -= talk * offbeat * 0.55;
    // Armed and waiting on the pitch: a ready stance, weapon presented, bouncing lightly on the knees.
    if (fight && armed && !arm && !talk && !action && !avatar.eliminated && motion) {
      const bounce = Math.abs(Math.sin(now * 4 + avatar.seat.index));
      avatar.rightArm.rotation.x = -0.5 + bounce * 0.06;
      avatar.rightArm.rotation.z = 0.12;
      avatar.body.position.y += bounce * 0.03 - 0.03;
    }
    if (arm) { avatar.rightArm.rotation.x = arm.x; avatar.rightArm.rotation.z = arm.z; }
    if (spread) { avatar.rightArm.rotation.z += spread; avatar.leftArm.rotation.z -= spread; }
    if (patSide > 0) { avatar.rightArm.rotation.z = patLift; avatar.rightArm.rotation.x = -0.55 * patLift; }
    if (patSide < 0) { avatar.leftArm.rotation.z = -patLift; avatar.leftArm.rotation.x = -0.55 * patLift; }
    // Drawing a bow: the left wing reaches forward and pulls the string back.
    if (leftPull) { avatar.leftArm.rotation.x = -1.45 + leftPull * 0.35; avatar.leftArm.rotation.z = -0.35 * leftPull; }
    avatar.hand.rotation.y = twirl;
    // Gripped, the weapon is turned to run out from the wing like an extension of it (a spear is held further down
    // its shaft); otherwise it sits the way its stance says.
    const held = avatar.hand.children.find((child) => child.userData.reach);
    if (held) {
      const kind = String(held.userData.kind ?? "sword");
      const hold = HOLDS[kind] ?? HOLDS.sword;
      avatar.hand.rotation.x = grip ? Math.PI - hold.rotation[0] : 0;
      held.position.y = hold.position[1] + (grip && kind === "spear" ? 0.45 : 0);
    } else avatar.hand.rotation.x = 0;
    this.updateTrail(avatar, slash && motion, now);
    if (fight && motion) this.kickDust(avatar, { position, yaw, lift, foot, legs, skid, thud }, now);

    // Weather on the birds: panting and fanning in the heat, an umbrella over the head in the rain.
    const hot = motion && this.weather?.kind === "heat" && !avatar.eliminated ? 0.45 + this.weather.strain * 0.55 : 0;
    if (hot && !talk && !action) {
      avatar.leftArm.rotation.z = -(0.35 + Math.abs(Math.sin(now * 13 + avatar.seat.index)) * 0.45) * hot;
      avatar.leftArm.rotation.x = -0.5 * hot;
    }
    this.updateUmbrella(avatar, delta, motion);
    if (avatar.failed) { avatar.body.rotation.x = 0.35; avatar.head.rotation.x = 0.4; }
    else avatar.head.rotation.x = (avatar.thinking ? (motion ? Math.sin(now * 2.4) * 0.08 : 0) - 0.05 : 0) + droop;
    // A cape streams back on the move and stirs a little at rest; draped over a chair it stays put.
    if (avatar.cape) avatar.cape.rotation.x = !motion || legs !== 0 ? 0 : moving ? 0.45 + Math.abs(stride) * 0.12 : 0.05 + Math.sin(now * 1.4 + avatar.seat.index) * 0.03;

    this.updateJiggle(avatar, delta, yaw, mood, now, motion);

    // Attention: listeners turn toward the speaker; the speaker looks at whom it addresses.
    const speakerId = this.state?.speaker ?? null;
    const focusId = speakerId === avatar.seat.id ? this.addressee : speakerId;
    const focus = focusId ? this.avatars.get(focusId) : undefined;
    // With nobody speaking after the work is done, everyone looks over to the viewer's place.
    const honorLook = !focus && this.honorSpot && this.state?.winner && !avatar.failed && !fight ? this.honorSpot.position : null;
    const desired = focus && focus !== avatar && !avatar.failed
      ? clamp(this.angleDelta(yaw, yawToward(position, focus.root.position)), -1.1, 1.1)
      : honorLook ? clamp(this.angleDelta(yaw, yawToward(position, honorLook)), -1.1, 1.1) : 0;
    avatar.look += (desired - avatar.look) * (motion ? Math.min(1, delta * 5) : 1);
    avatar.head.rotation.y = avatar.look + idleTurn;
    if (motion && now > avatar.nextBlink) {
      avatar.blinkUntil = now + 0.12;
      avatar.nextBlink = now + 2.4 + Math.random() * 3.6;
    }
    const blinking = motion && now < avatar.blinkUntil;
    // Expressions follow the moment: angry on the attack, shocked when hit, sad when out, beaming when winning.
    if (avatar.hitFlash > 0.35) mood = "shock";
    const target = MOODS[mood];
    const rate = motion ? Math.min(1, delta * 10) : 1;
    for (const key of ["tilt", "lift", "pupil", "gaze", "squint", "lid"] as const) {
      avatar.face[key] = rate === 1 ? target[key] : avatar.face[key] + (target[key] - avatar.face[key]) * rate;
    }
    // A blink drops the lid all the way at once; moods hold it part way.
    const closure = blinking ? 1 : avatar.face.lid;
    for (const lid of avatar.lids) lid.rotation.x = LID_OPEN + (LID_SHUT - LID_OPEN) * closure;
    avatar.eyeMeshes.forEach((eye, index) => {
      eye.scale.y = avatar.face.squint;
      const pupil = avatar.pupils[index];
      if (pupil) { pupil.scale.setScalar(avatar.face.pupil); pupil.position.y = -0.005 + avatar.face.gaze; }
      const brow = avatar.brows[index];
      // Index 0 is the left brow; its inner end is on its right, so the two tilt in opposite senses.
      if (brow) { brow.rotation.z = (index === 0 ? 1 : -1) * avatar.face.tilt; brow.position.y = 0.205 + avatar.face.lift; }
    });
    avatar.head.rotation.z = motion && avatar.thinking ? Math.sin(now * 1.7 + avatar.seat.index) * 0.12 : 0;
    // A speaker nods along with its words and leans a little toward the table or its opponent.
    avatar.head.rotation.x += talk * Math.sin(now * 9 + avatar.seat.index) * 0.05 + peck * 0.35 + idleDip;
    avatar.body.rotation.x += talk * 0.06;
    this.applyGesture(avatar, now);

    const talking = avatar.active ? 1 : 0;
    avatar.speaking += (talking - avatar.speaking) * (motion ? Math.min(1, delta * 8) : 1);
    const pulse = avatar.thinking ? 0.3 + (motion ? Math.sin(now * 6) * 0.18 : 0) : 0;
    avatar.ringMaterial.opacity = Math.max(avatar.speaking * 0.95, pulse);
    avatar.haloMaterial.opacity = avatar.speaking * 0.32 + pulse * 0.25;
    const eyeGlow = Math.max(avatar.speaking, avatar.thinking ? 0.55 : 0);
    avatar.eyes.emissive.copy(this.white).lerp(this.green, eyeGlow);
    const tips = 0.6 + avatar.speaking * 0.6 + (avatar.thinking ? (motion ? 0.6 + Math.sin(now * 6) * 0.6 : 0.6) : 0);
    for (const light of avatar.lights) light.emissiveIntensity = tips;
    // The beak chatters open and shut while the model has the floor.
    avatar.jaw.rotation.x = motion ? avatar.speaking * (0.1 + Math.abs(Math.sin(now * 15)) * 0.42) : 0;
    // Panting in the heat; the beak also snaps open for a peck.
    if (hot) avatar.jaw.rotation.x = Math.max(avatar.jaw.rotation.x, hot * (0.1 + Math.abs(Math.sin(now * 9 + avatar.seat.index)) * 0.16));
    if (peck) avatar.jaw.rotation.x = Math.max(avatar.jaw.rotation.x, peck * 0.45);
    // Short and moderate, so the seat color stays recognisable after a hit.
    avatar.hitFlash = motion ? Math.max(0, avatar.hitFlash - delta * 4.5) : 0;
    avatar.skin.forEach((material, index) => {
      material.emissive.setRGB(avatar.glow.r + avatar.hitFlash * 0.55, avatar.glow.g + avatar.hitFlash * 0.08, avatar.glow.b);
      material.color.copy(avatar.skinColors[index]);
      if (avatar.failed) material.color.lerp(this.grey, 0.6);
    });
  }

  /** Layers the playing library clip on the pose; a blow, a fall or a walk owns the body while it lasts. */
  private applyGesture(avatar: Avatar, now: number) {
    // Only gestures turn these; they start from rest every frame so nothing piles up.
    avatar.body.rotation.y = 0;
    avatar.leftArm.rotation.y = 0;
    avatar.rightArm.rotation.y = 0;
    const playing = avatar.gesture;
    if (!playing) return;
    const clip = getGesture(playing.id);
    const elapsed = (now - playing.start) * this.speed;
    if (!clip || elapsed >= clip.duration) { avatar.gesture = null; return; }
    const action = avatar.actions[0];
    if (elapsed <= 0 || (action && action.kind !== "idle" && now >= action.start)) return;
    const pose = sampleGesture(playing.id, elapsed, {
      reducedMotion: this.options.reducedMotion,
      seated: avatar.hips.rotation.x !== 0,
      rightWingOccupied: avatar.hand.children.some((child) => child.userData.reach),
      leftWingOccupied: avatar.umbrellaOpen > 0.05,
    });
    avatar.body.position.y += pose.lift;
    avatar.body.rotation.x += pose.bodyPitch;
    avatar.body.rotation.z += pose.bodyRoll;
    avatar.body.rotation.y += pose.bodyYaw;
    avatar.head.rotation.x += pose.headPitch;
    avatar.head.rotation.y += pose.headYaw;
    avatar.head.rotation.z += pose.headRoll;
    avatar.leftArm.rotation.x += pose.leftWingPitch;
    avatar.leftArm.rotation.z += pose.leftWingRoll;
    avatar.leftArm.rotation.y += pose.leftWingYaw;
    avatar.rightArm.rotation.x += pose.rightWingPitch;
    avatar.rightArm.rotation.z += pose.rightWingRoll;
    avatar.rightArm.rotation.y += pose.rightWingYaw;
    avatar.legs[0].rotation.x += pose.leftLegPitch;
    avatar.legs[1].rotation.x += pose.rightLegPitch;
    avatar.tail.rotation.x += pose.tailPitch;
    avatar.tail.rotation.z += pose.tailRoll;
  }

  private angleDelta(from: number, to: number) {
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  private updateDrops(now: number) {
    if (this.options.reducedMotion) return;
    for (const weapon of this.weapons.values()) {
      if (!weapon.drop || weapon.holder) {
        if (!weapon.holder && weapon.mesh.visible && !weapon.drop) weapon.mesh.rotation.y += 0.02;
        continue;
      }
      const elapsed = now - weapon.drop.start;
      if (weapon.drop.from && elapsed < weapon.drop.lift) {
        // Up and away out of the old holder's wing, spinning.
        const q = ease(clamp(elapsed / weapon.drop.lift));
        const sky = new this.three.Vector3(weapon.spot.x, 7, weapon.spot.z);
        weapon.mesh.position.lerpVectors(weapon.drop.from, sky, q);
        weapon.mesh.rotation.y += 0.35;
        continue;
      }
      const p = clamp((elapsed - weapon.drop.lift) / weapon.drop.duration);
      weapon.mesh.position.set(weapon.spot.x, 7 * (1 - ease(p)) + 0.15, weapon.spot.z);
      weapon.mesh.rotation.y += 0.15;
      if (p >= 1 && !weapon.landed) {
        weapon.landed = true;
        this.options.onCue?.("drop", 1);
        this.shockwave(weapon.spot);
        this.puffs?.burst(weapon.spot.clone().setY(0.05), 9, 0.15, 0.9, now, this.dustColor());
        this.sparks(weapon.spot.clone().setY(0.2), "#d9c38a", 22);
      }
    }
  }

  private updateTable(delta: number, now: number) {
    if (this.lamp && !this.options.reducedMotion) {
      const kind = this.weather?.kind;
      if (kind === "storm" && Math.random() < delta * 0.7) this.lamp.boost = Math.max(this.lamp.boost, 1.35 + Math.random() * 0.4);
      const warm = kind === "heat" ? "#ffa860" : "#ffcf8a";
      this.lamp.spot.color.lerp(new this.three.Color(warm), Math.min(1, delta * 1.5));
    }
    if (this.lamp) {
      this.lamp.boost = Math.max(0, this.lamp.boost - delta * 0.6);
      const flicker = this.lamp.boost > 1.3 && !this.options.reducedMotion ? Math.sin(now * 40) * 0.25 : 0;
      const winner = this.state?.winner ? 0.25 : 0;
      this.lamp.spot.intensity = LAMP * (1 + this.lamp.boost * 0.4 + winner + flicker);
      this.lamp.glow.opacity = 0.1 + this.lamp.boost * 0.08 + winner * 0.12;
      if (this.beamCone) this.beamCone.opacity = 0.05 + this.lamp.boost * 0.025 + winner * 0.03 + flicker * 0.04;
    }
    if (this.dust && !this.options.reducedMotion) {
      this.dust.rotation.y += delta * 0.035;
      this.dust.position.y = Math.sin(now * 0.35) * 0.06;
      (this.dust.material as T.PointsMaterial).opacity = 0.42 + Math.sin(now * 0.9) * 0.12;
    }
    if (this.documentMesh) {
      const material = this.documentMesh.material as T.MeshStandardMaterial;
      const approvalGlow = this.state?.draft ? 0.25 + (this.state.approvals * 0.2) : 0;
      this.documentGlow = this.options.reducedMotion ? approvalGlow : Math.max(this.documentGlow * 0.985, approvalGlow);
      // The glow tells approval apart, but never so strongly that the page turns into a white blaze.
      material.emissiveIntensity = 0.08 + Math.min(0.6, this.documentGlow * 0.32);
      if (this.options.reducedMotion) {
        if (this.documentRise && this.honorSpot) {
          this.documentMesh.position.copy(this.honorSpot.lap);
          this.documentMesh.rotation.set(-1.15, this.honorSpot.yaw, 0);
          return;
        }
        this.documentMesh.position.set(0, this.documentRise ? 1 : 0.99, 0);
        this.documentMesh.rotation.set(-Math.PI / 2 + (this.documentRise ? 0.6 : 0), 0, 0);
        return;
      }
      const honor = this.honorSpot;
      if (this.documentRise && honor) {
        // Agreed: the text drifts over and comes to rest on the viewer's seat, leaning back, face to the table.
        const at = honor.lap.clone();
        at.y += Math.sin(now * 1.5) * 0.02;
        this.documentMesh.position.lerp(at, 0.04);
        this.documentMesh.rotation.x += (-1.15 - this.documentMesh.rotation.x) * 0.05;
        this.documentMesh.rotation.y += (honor.yaw - this.documentMesh.rotation.y) * 0.05;
        this.documentMesh.rotation.z += (0 - this.documentMesh.rotation.z) * 0.05;
        return;
      }
      this.documentMesh.position.x += (0 - this.documentMesh.position.x) * 0.08;
      this.documentMesh.position.z += (0 - this.documentMesh.position.z) * 0.08;
      this.documentMesh.rotation.y += (0 - this.documentMesh.rotation.y) * 0.08;
      const rise = this.documentRise ? 1.0 + Math.sin(now * 1.5) * 0.06 : 0.99;
      this.documentMesh.position.y += (rise - this.documentMesh.position.y) * 0.05;
      if (this.documentRise) {
        this.documentMesh.rotation.x += (-Math.PI / 2 + 0.6 - this.documentMesh.rotation.x) * 0.05;
        this.documentMesh.rotation.z += delta * 0.4;
      } else {
        this.documentMesh.rotation.x = -Math.PI / 2;
      }
    }
  }

  /** Elimination drama: the field dims and a spotlight follows the eliminated fighter; clouds drift. */
  private updateStage(delta: number, now: number) {
    if (this.clouds && !this.options.reducedMotion) this.clouds.rotation.y += delta * 0.006;
    if (!this.options.reducedMotion) {
      const gust = this.weather?.kind === "storm" ? 2.2 : this.weather?.kind === "rainy" ? 1.4 : 1;
      for (const banner of this.banners ?? []) {
        banner.cloth.rotation.x = (Math.sin(now * 1.3 + banner.phase) * 0.06 + 0.04) * gust;
        banner.cloth.rotation.y = Math.sin(now * 0.9 + banner.phase) * 0.08 * gust;
      }
    }
    // A banner right in front of the camera (or between it and what it is looking at) would fill the frame: hide it.
    for (const banner of this.banners ?? []) {
      const holder = banner.cloth.parent;
      if (!holder || !this.camera) continue;
      const toBanner = holder.position.clone().sub(this.camera.position);
      const toFocus = this.focus.clone().sub(this.camera.position);
      const along = toBanner.dot(toFocus.clone().normalize());
      const off = toBanner.clone().sub(toFocus.clone().normalize().multiplyScalar(along)).length();
      holder.visible = !(toBanner.length() < 3.2 || (along > 0 && along < toFocus.length() && off < 1.4));
    }
    if (!this.options.reducedMotion) {
      for (const torch of this.torches ?? []) {
        const flicker = 0.85 + Math.sin(now * 17 + torch.phase) * 0.08 + Math.sin(now * 29 + torch.phase * 2) * 0.06;
        torch.flame.scale.set(1, flicker * (this.weather?.kind === "rainy" || this.weather?.kind === "storm" ? 0.7 : 1), 1);
        torch.flame.rotation.z = Math.sin(now * 5 + torch.phase) * 0.08;
        torch.light.intensity = 5 * flicker;
      }
    }
    if (this.dome) {
      const background = this.scene.background as T.Color | null;
      if (background) this.dome.color.copy(background);
    }
    if (this.bunting && !this.options.reducedMotion) {
      // A gentle sway of the whole garland; cheap and enough to feel alive.
      this.bunting.rotation.y = Math.sin(now * 0.7) * 0.004;
      this.bunting.position.y = Math.sin(now * 1.3) * 0.03;
    }
    if (this.door) {
      // The door starts to open as the fighter goes down, stays open for the walk, and swings shut behind it.
      const leaving = !this.options.reducedMotion && [...this.avatars.values()].some((avatar) =>
        avatar.actions.some((action) => (action.kind === "fall" || action.kind === "toBench") && now >= action.start));
      const door = this.door;
      door.open += ((leaving ? 1 : 0) - door.open) * (this.options.reducedMotion ? 1 : Math.min(1, delta * 2.2));
      door.leaves.forEach((hinge, index) => { hinge.rotation.y = (index === 0 ? 1 : -1) * ease(door.open) * 1.75; });
    }
    if (this.cageCrown) {
      const glow = this.state?.winner ? 0.45 + (this.options.reducedMotion ? 0 : Math.sin(now * 3) * 0.15) : 0;
      this.cageCrown.emissive.setRGB(glow, glow * 0.75, glow * 0.2);
    }
    this.sky?.update(delta, now);
    this.updateSweat(delta, now);
    const stage = this.stage;
    if (!stage) return;
    const look = this.sky?.light;
    if (look && look.flash > 0.97) { this.shake = Math.min(1, this.shake + 0.25); this.post?.pulse(0.8); this.options.onCue?.("thunder", 1); this.ambient?.startle(0.8); }
    const active = stage.focus !== null && now < stage.until;
    stage.dim += ((active ? 1 : 0) - stage.dim) * Math.min(1, delta * 3.5);
    stage.sun.intensity = (look?.sun ?? 2.6) * (1 - stage.dim * 0.7);
    if (look) stage.sun.color.copy(look.sunColor);
    stage.sky.intensity = ((look?.fill ?? 1.35) + (look?.flash ?? 0) * 2.4) * (1 - stage.dim * 0.6);
    stage.drama.intensity = 420 * stage.dim;
    if (stage.focus) {
      const at = stage.focus.root.position;
      stage.drama.target.position.lerp(at, Math.min(1, delta * 6));
      stage.drama.position.set(at.x * 0.6, 13, at.z * 0.6 + 2);
    }
    if (!active && stage.dim < 0.01) stage.focus = null;
  }

  private podiumTop() {
    return new this.three.Vector3(0, 0.55 * (this.podium?.rise ?? 0), 0);
  }

  /**
   * Route from a fighter's spot to its bench seat: straight out past the ring of fighters, round the outside of the
   * ring to the back, out through the cage door, and over to its place on the bench.
   */
  private benchPath(avatar: Avatar) {
    const three = this.three;
    const start = avatar.home.clone().setY(0);
    const end = avatar.bench.clone().setY(0);
    const from = Math.atan2(start.z, start.x);
    const sweep = this.angleDelta(from, DOOR_ANGLE);
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 0.5));
    const points = [start];
    for (let k = 0; k <= steps; k++) {
      const angle = from + sweep * (k / steps);
      points.push(new three.Vector3(Math.cos(angle) * WALK_CLEARANCE, 0, Math.sin(angle) * WALK_CLEARANCE));
    }
    points.push(new three.Vector3(end.x * 0.15, 0, -CAGE_RADIUS * Math.cos(DOOR_HALF) + 0.55));
    points.push(new three.Vector3(end.x * 0.45, 0, -CAGE_RADIUS * Math.cos(DOOR_HALF) - 0.9));
    points.push(end);
    return new three.CatmullRomCurve3(points, false, "centripetal");
  }

  private updatePodium(delta: number) {
    const podium = this.podium;
    if (!podium) return;
    const target = this.state?.winner ? 1 : 0;
    podium.rise = this.options.reducedMotion ? target : podium.rise + (target - podium.rise) * Math.min(1, delta * 2.2);
    podium.group.visible = podium.rise > 0.01;
    podium.group.scale.y = Math.max(0.001, podium.rise);
    // Bright enough to pick the winner out, not so bright that the glow swallows it.
    podium.spot.intensity = 38 * podium.rise;
  }

  /** Stars circling an eliminated fighter's head while it goes down. */
  private dizzy(avatar: Avatar) {
    if (this.options.reducedMotion) return;
    const three = this.three;
    const ring = new three.Group();
    ring.position.y = 0.45;
    const material = new three.MeshBasicMaterial({ color: "#ffd84d" });
    const geometry = new three.OctahedronGeometry(0.075, 0);
    for (let index = 0; index < 4; index++) {
      const star = new three.Mesh(geometry, material);
      const angle = (index / 4) * Math.PI * 2;
      star.position.set(Math.cos(angle) * 0.34, Math.sin(angle * 2) * 0.04, Math.sin(angle) * 0.34);
      ring.add(star);
    }
    avatar.head.add(ring);
    const begin = this.now();
    const life = 2.4 / Math.max(1, this.speed * 0.7);
    this.effects.push({
      update: (now) => {
        ring.rotation.y += 0.14;
        for (const star of ring.children) star.rotation.y += 0.25;
        return now - begin < life;
      },
      dispose: () => { avatar.head.remove(ring); geometry.dispose(); material.dispose(); },
    });
  }

  private updateConfetti(delta: number, now: number) {
    const confetti = this.confetti;
    if (!confetti) return;
    const positions = confetti.points.geometry.getAttribute("position") as T.BufferAttribute;
    for (let index = 0; index < positions.count; index++) {
      const v = confetti.velocities;
      v[index * 3 + 1] -= 6.5 * delta;
      positions.setXYZ(index,
        positions.getX(index) + v[index * 3] * delta,
        Math.max(0.05, positions.getY(index) + v[index * 3 + 1] * delta),
        positions.getZ(index) + v[index * 3 + 2] * delta);
      v[index * 3] *= 0.985;
      v[index * 3 + 2] *= 0.985;
    }
    positions.needsUpdate = true;
    const material = confetti.points.material as T.PointsMaterial;
    material.opacity = clamp(confetti.until - now);
    if (now > confetti.until) {
      this.scene.remove(confetti.points);
      confetti.points.geometry.dispose();
      material.dispose();
      this.confetti = null;
    }
  }

  private anchors(): Anchor[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const point = new this.three.Vector3();
    const anchors: Anchor[] = [];
    for (const avatar of this.avatars.values()) {
      avatar.head.getWorldPosition(point);
      point.y += Math.max(0.45, avatar.crown + 0.14);
      point.project(this.camera);
      anchors.push({
        id: avatar.seat.id,
        x: (point.x * 0.5 + 0.5) * rect.width,
        y: (-point.y * 0.5 + 0.5) * rect.height,
        visible: point.z < 1 && point.x > -1.15 && point.x < 1.15 && point.y > -1.2 && point.y < 1.25,
      });
    }
    return anchors;
  }

  private resize() {
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.post?.setSize(width, height);
    this.camera.aspect = width / height;
    // Keep the whole table in frame on narrow screens.
    this.camera.fov = width < 520 ? 54 : 42;
    this.camera.updateProjectionMatrix();
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.dragging = { x: event.clientX, y: event.clientY };
    // Pick up from wherever the director left the camera.
    this.azimuth = this.cam.azimuth;
    this.elevation = this.cam.elevation;
    this.lastInteraction = this.now();
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.azimuth -= (event.clientX - this.dragging.x) * 0.006;
    this.elevation = clamp(this.elevation + (event.clientY - this.dragging.y) * 0.004, 0.18, 1.25);
    this.dragging = { x: event.clientX, y: event.clientY };
    this.lastInteraction = this.now();
  };

  private readonly onPointerUp = () => {
    // Only a drag that started on the stage hands the camera to the viewer; clicks elsewhere on the page do not.
    if (!this.dragging) return;
    this.dragging = null;
    this.lastInteraction = this.now();
    this.manualUntil = this.realTime + 6;
  };
}
