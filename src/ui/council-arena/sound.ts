import type { SoundCue } from "./scene";

/**
 * The stage's sound, made on the fly with Web Audio (no files): impacts, whooshes, the crowd, thunder, stamps, a
 * fanfare, and two beds that follow the weather and the stands (rain and crowd murmur). It is off until the viewer
 * turns it on, which is also the user gesture browsers require before audio may start.
 */
export class ArenaSound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private rain: GainNode | null = null;
  private murmur: GainNode | null = null;
  private last = new Map<SoundCue, number>();

  get on() { return this.context !== null && this.context.state === "running"; }

  /** Turns sound on or off; turning on must happen in a click handler. */
  async enable(on: boolean) {
    if (!on) {
      await this.context?.suspend();
      return;
    }
    if (!this.context) {
      const Context = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.context.destination);
      this.noise = this.makeNoise(2);
      this.rain = this.bed(2800, 0.6);
      this.murmur = this.bed(520, 1.1);
    }
    await this.context.resume();
  }

  /** Sets the background beds: rain 0…1 and crowd murmur 0…1. */
  setBeds(rain: number, crowd: number) {
    const context = this.context;
    if (!context || !this.rain || !this.murmur) return;
    this.rain.gain.setTargetAtTime(rain * 0.12, context.currentTime, 0.6);
    this.murmur.gain.setTargetAtTime(crowd * 0.05, context.currentTime, 0.8);
  }

  play(cue: SoundCue, strength = 1) {
    const context = this.context;
    if (!context || context.state !== "running" || !this.master) return;
    // The same sound twice within 60 ms is one sound.
    const now = context.currentTime;
    if (now - (this.last.get(cue) ?? -1) < 0.06) return;
    this.last.set(cue, now);
    const level = Math.min(1.4, Math.max(0.2, strength));
    switch (cue) {
      case "hit":
        this.burst(1400, 2.5, 0.14, 0.45 * level);
        this.tone("sine", 140, 70, 0.16, 0.5 * level);
        break;
      case "heavy":
        this.burst(500, 1.2, 0.35, 0.6 * level);
        this.tone("sine", 95, 38, 0.42, 0.9 * level);
        break;
      case "whoosh":
        this.sweep(380, 2200, 0.28, 0.32 * level);
        break;
      case "swish":
        this.sweep(900, 3200, 0.22, 0.2 * level);
        break;
      case "cheer":
        this.burst(1600, 0.7, 1.3, 0.22 * level, 0.15);
        this.burst(2600, 0.9, 1.1, 0.12 * level, 0.1);
        break;
      case "ooh":
        this.tone("sawtooth", 262, 196, 0.9, 0.07, 0.15, 900);
        this.tone("sawtooth", 330, 247, 0.9, 0.06, 0.15, 900);
        break;
      case "thunder":
        this.burst(160, 0.6, 2.2, 0.75 * level, 0.02);
        this.burst(900, 1.5, 0.25, 0.25 * level);
        break;
      case "stamp":
        this.tone("sine", 110, 60, 0.12, 0.8);
        this.burst(3000, 2, 0.05, 0.25);
        break;
      case "fanfare":
        [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => this.tone("triangle", frequency, frequency, 0.32, 0.18, 0.01, 0, index * 0.12));
        [523.25, 659.25, 783.99].forEach((frequency) => this.tone("square", frequency, frequency, 1.1, 0.05, 0.02, 2400, 0.5));
        break;
      case "pop":
        this.tone("sine", 620, 980, 0.09, 0.25);
        break;
      case "ting":
        // A blade catching the light: a bright bell ping with a higher shimmer.
        this.tone("sine", 2637, 2637, 0.38, 0.11 * level, 0.003);
        this.tone("triangle", 3951, 3951, 0.22, 0.04 * level, 0.003);
        break;
      case "drop":
        this.tone("sine", 1500, 320, 0.45, 0.09);
        this.tone("sine", 120, 70, 0.2, 0.55, 0.005, 0, 0.42);
        break;
      case "sad":
        this.tone("sawtooth", 311, 293, 0.35, 0.08, 0.02, 1200);
        this.tone("sawtooth", 277, 207, 0.9, 0.08, 0.02, 1200, 0.38);
        break;
    }
  }

  dispose() {
    void this.context?.close();
    this.context = null;
  }

  private makeNoise(seconds: number) {
    const context = this.context!;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    return buffer;
  }

  /** A looping filtered-noise bed (rain hiss, crowd murmur), silent until raised. */
  private bed(frequency: number, q: number) {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master!);
    source.start();
    return gain;
  }

  /** A burst of band-passed noise with a quick attack and a decay. */
  private burst(frequency: number, q: number, seconds: number, level: number, attack = 0.005) {
    const context = this.context!;
    const start = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    source.connect(filter).connect(gain).connect(this.master!);
    source.start(start, Math.random());
    source.stop(start + seconds + 0.05);
  }

  /** Noise swept through a band-pass, for whooshes. */
  private sweep(from: number, to: number, seconds: number, level: number) {
    const context = this.context!;
    const start = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + seconds);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + seconds * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    source.connect(filter).connect(gain).connect(this.master!);
    source.start(start, Math.random());
    source.stop(start + seconds + 0.05);
  }

  /** A pitched tone gliding from one frequency to another, optionally low-passed and delayed. */
  private tone(type: OscillatorType, from: number, to: number, seconds: number, level: number, attack = 0.005, lowpass = 0, delay = 0) {
    const context = this.context!;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + seconds);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    let tail: AudioNode = oscillator;
    if (lowpass) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = lowpass;
      tail = oscillator.connect(filter);
    }
    tail.connect(gain).connect(this.master!);
    oscillator.start(start);
    oscillator.stop(start + seconds + 0.05);
  }
}
