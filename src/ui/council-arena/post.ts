import type * as T from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";

type Three = typeof T;

/** Bloom tuned per stage: in the dark room warm lights bloom generously, on the sunny field only real glows do. */
const LOOK = {
  collaboration: { strength: 0.75, radius: 0.55, threshold: 0.58, vignette: 1.25 },
  competition: { strength: 0.32, radius: 0.38, threshold: 0.86, vignette: 0.9 },
} as const;

/**
 * The stage's finishing pass: glow on lamps, gems, lanterns, sparks and lightning, and a soft vignette that pulls the
 * eye to the middle. `pulse` lets big moments (a heavy hit, lightning, the winner) flare the glow for an instant.
 */
export class PostFx {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly vignette: ShaderPass;
  private readonly base: { strength: number; radius: number; threshold: number; vignette: number };
  private flare = 0;

  constructor(three: Three, renderer: T.WebGLRenderer, scene: T.Scene, camera: T.Camera, mode: keyof typeof LOOK) {
    this.base = LOOK[mode];
    this.composer = new EffectComposer(renderer);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new three.Vector2(256, 256), this.base.strength, this.base.radius, this.base.threshold);
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VignetteShader);
    this.vignette.uniforms.offset.value = 1.0;
    this.vignette.uniforms.darkness.value = this.base.vignette;
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height);
  }

  /** A brief extra glow (0…1) that fades on its own. */
  pulse(amount: number) {
    this.flare = Math.min(1.5, Math.max(this.flare, amount));
  }

  render(delta: number) {
    this.flare = Math.max(0, this.flare - delta * 2.2);
    this.bloom.strength = this.base.strength + this.flare * 0.9;
    this.composer.render(delta);
  }

  dispose() {
    this.bloom.dispose();
    this.composer.dispose();
  }
}
