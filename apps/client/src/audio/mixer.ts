/**
 * One audio graph for the whole game: music and sound effects each have a
 * volume the player sets in Settings, and both go quiet when the sound is
 * turned off (N, or in the bath).
 *
 *   music ──┐
 *           ├── master ── speakers
 *   effects ┘
 */
const SETTINGS_KEY = 'nongs.audio';

export interface Volumes {
  /** 0–1. */
  music: number;
  effects: number;
}

const DEFAULT_VOLUMES: Volumes = { music: 0.5, effects: 0.8 };

class Mixer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private volumes: Volumes = loadVolumes();
  private muted = false;
  private readonly startListeners: ((audio: AudioContext) => void)[] = [];

  constructor() {
    // Browsers only allow sound after the player has done something on the page.
    const unlock = () => {
      const audio = this.audio;
      if (!audio) return;
      void audio.resume();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  /** The audio context, made on first use; null when the browser has no Web Audio. */
  get audio(): AudioContext | null {
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        return null;
      }
      this.master = this.context.createGain();
      this.musicGain = this.context.createGain();
      this.effectsGain = this.context.createGain();
      this.musicGain.connect(this.master);
      this.effectsGain.connect(this.master);
      this.master.connect(this.context.destination);
      this.apply(0);
      for (const listener of this.startListeners) listener(this.context);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  /** Where music is played into. */
  get music(): AudioNode | null {
    return this.audio ? this.musicGain : null;
  }

  /** Where sound effects are played into. */
  get effects(): AudioNode | null {
    return this.audio ? this.effectsGain : null;
  }

  /** Runs once the audio exists (after the first click or key press). */
  onStart(listener: (audio: AudioContext) => void): void {
    if (this.context) listener(this.context);
    else this.startListeners.push(listener);
  }

  get settings(): Volumes {
    return { ...this.volumes };
  }

  setVolumes(volumes: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...volumes };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.volumes));
    } catch {
      // Not remembered after a reload; it still applies now.
    }
    this.apply(0.05);
  }

  /** Silences everything while the player's sound is off. */
  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    this.apply(0.3);
  }

  private apply(seconds: number): void {
    if (!this.context || !this.master || !this.musicGain || !this.effectsGain) return;
    const now = this.context.currentTime;
    // Squared, so the slider feels even to the ear.
    this.musicGain.gain.setTargetAtTime(this.volumes.music ** 2, now, seconds || 0.001);
    this.effectsGain.gain.setTargetAtTime(this.volumes.effects ** 2, now, seconds || 0.001);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, now, seconds || 0.001);
  }
}

function loadVolumes(): Volumes {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Volumes> | null;
    const clamp = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
    return { music: clamp(saved?.music, DEFAULT_VOLUMES.music), effects: clamp(saved?.effects, DEFAULT_VOLUMES.effects) };
  } catch {
    return { ...DEFAULT_VOLUMES };
  }
}

export const mixer = new Mixer();
