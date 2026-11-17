/**
 * Background music, played on the spot so there is no file to download: a
 * slow, warm loop of soft chords, a walking bass, a music-box tune and a
 * quiet shaker, with a little room echo. The tune changes from one pass of
 * the chords to the next, so it does not repeat exactly.
 */
import { mixer } from './mixer';

const BPM = 84;
const BEAT = 60 / BPM;
/** How far ahead notes are put in the queue, and how often the queue is topped up. */
const LOOKAHEAD = 0.4;
const TICK_MS = 100;

/** MIDI note numbers. The chords: Fmaj7 – Em7 – Dm7 – Cmaj7, then Fmaj7 – G6 – Em7 – Am7. */
const CHORDS: readonly (readonly number[])[] = [
  [53, 57, 60, 64],
  [52, 55, 59, 62],
  [50, 53, 57, 60],
  [48, 52, 55, 59],
  [53, 57, 60, 64],
  [55, 59, 62, 64],
  [52, 55, 59, 62],
  [57, 60, 64, 67],
];
/** C major pentatonic, two octaves, for the tune. */
const SCALE = [72, 74, 76, 79, 81, 84, 86, 88];
/** Where tune notes fall in a bar, in beats. */
const RHYTHMS: readonly (readonly number[])[] = [
  [0, 1.5, 2, 3],
  [0, 0.5, 1, 2.5],
  [0, 2, 2.5, 3.5],
  [1, 1.5, 2, 3],
  [0, 3],
];

const hz = (note: number) => 440 * 2 ** ((note - 69) / 12);

export class Music {
  private audio: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private nextBar = 0;
  private bar = 0;
  private tune = 3;
  private seed = 7;
  private timer = 0;

  /** Starts as soon as the browser allows sound. */
  start(): void {
    mixer.onStart((audio) => {
      if (this.audio) return;
      const music = mixer.music;
      if (!music) return;
      this.audio = audio;
      this.out = audio.createGain();
      this.out.gain.value = 0;
      // Fades in over a few seconds instead of starting loud.
      this.out.gain.setTargetAtTime(0.9, audio.currentTime, 1.5);
      const echo = audio.createConvolver();
      echo.buffer = roomEcho(audio);
      const wet = audio.createGain();
      wet.gain.value = 0.35;
      this.out.connect(music);
      this.out.connect(echo).connect(wet).connect(music);
      this.noise = noiseBuffer(audio);
      this.nextBar = audio.currentTime + 0.2;
      this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    });
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.out?.disconnect();
    this.audio = null;
  }

  private schedule(): void {
    const audio = this.audio;
    if (!audio) return;
    while (this.nextBar < audio.currentTime + LOOKAHEAD) {
      this.playBar(this.nextBar);
      this.nextBar += BEAT * 4;
      this.bar += 1;
    }
  }

  private random(): number {
    // A small repeatable random, so a tune can be played again later.
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private playBar(at: number): void {
    const chord = CHORDS[this.bar % CHORDS.length]!;
    // Every second pass through the chords plays the same tune as the pass before; then a new one.
    const pass = Math.floor(this.bar / CHORDS.length);
    if (this.bar % CHORDS.length === 0) this.seed = 7 + Math.floor(pass / 2) * 101;

    for (const note of chord) this.pad(hz(note), at, BEAT * 4);
    const root = chord[0]! - 12;
    this.bass(hz(root), at, BEAT * 1.6);
    this.bass(hz(root + 7), at + BEAT * 2, BEAT * 0.9);
    this.bass(hz(root + 12), at + BEAT * 3, BEAT * 0.9);

    const rhythm = RHYTHMS[Math.floor(this.random() * RHYTHMS.length)]!;
    for (const beat of rhythm) {
      // A gentle walk up and down the scale, leaning towards notes of the chord.
      this.tune = Math.min(Math.max(this.tune + Math.round((this.random() - 0.5) * 3.2), 0), SCALE.length - 1);
      let note = SCALE[this.tune]!;
      if (beat === 0 && !chord.some((c) => (note - c) % 12 === 0)) note = chord[1]! + 24;
      this.bell(hz(note), at + beat * BEAT);
    }

    for (let half = 0; half < 8; half += 1) this.shaker(at + half * BEAT * 0.5, half % 2 === 1 ? 0.05 : 0.025);
  }

  private voice(type: OscillatorType, frequency: number, detune = 0): OscillatorNode {
    const oscillator = this.audio!.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.detune.value = detune;
    return oscillator;
  }

  /** A soft, slow chord note: two slightly different triangles through a low filter. */
  private pad(frequency: number, at: number, length: number): void {
    const audio = this.audio!;
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.035, at + 0.6);
    gain.gain.setValueAtTime(0.035, at + length - 0.4);
    gain.gain.linearRampToValueAtTime(0, at + length + 0.3);
    filter.connect(gain).connect(this.out!);
    for (const detune of [-7, 7]) {
      const oscillator = this.voice('triangle', frequency, detune);
      oscillator.connect(filter);
      oscillator.start(at);
      oscillator.stop(at + length + 0.4);
    }
  }

  private bass(frequency: number, at: number, length: number): void {
    const audio = this.audio!;
    const oscillator = this.voice('sine', frequency);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.16, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    oscillator.connect(gain).connect(this.out!);
    oscillator.start(at);
    oscillator.stop(at + length + 0.05);
  }

  /** A music-box note: a sine with a quiet bell overtone, struck and fading. */
  private bell(frequency: number, at: number): void {
    const audio = this.audio!;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.07, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 1.4);
    gain.connect(this.out!);
    const tone = this.voice('sine', frequency);
    const shimmer = this.voice('sine', frequency * 3.01);
    const shimmerGain = audio.createGain();
    shimmerGain.gain.value = 0.12;
    tone.connect(gain);
    shimmer.connect(shimmerGain).connect(gain);
    for (const oscillator of [tone, shimmer]) {
      oscillator.start(at);
      oscillator.stop(at + 1.5);
    }
  }

  private shaker(at: number, volume: number): void {
    const audio = this.audio!;
    const source = audio.createBufferSource();
    source.buffer = this.noise;
    const filter = audio.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + 0.07);
    source.connect(filter).connect(gain).connect(this.out!);
    source.start(at, Math.random() * 0.5, 0.08);
  }
}

function noiseBuffer(audio: AudioContext): AudioBuffer {
  const buffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A short fading hiss in two channels: played through a convolver it sounds like a small room. */
function roomEcho(audio: AudioContext): AudioBuffer {
  const seconds = 2.2;
  const length = Math.floor(audio.sampleRate * seconds);
  const buffer = audio.createBuffer(2, length, audio.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}
