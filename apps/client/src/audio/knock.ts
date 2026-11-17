/**
 * Knocking on a door and turning a key, made on the spot from filtered noise
 * and a low thump, so nothing has to be downloaded.
 */
import { mixer } from './mixer';

let noise: AudioBuffer | null = null;

function noiseFor(audio: AudioContext): AudioBuffer {
  if (!noise) {
    noise = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.2), audio.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** One hit on wood: a short low thump and a dull knock of noise. */
function hit(audio: AudioContext, at: number, frequency: number, volume: number): void {
  const out = mixer.effects;
  if (!out) return;
  const thump = audio.createOscillator();
  thump.frequency.setValueAtTime(frequency, at);
  thump.frequency.exponentialRampToValueAtTime(frequency * 0.6, at + 0.08);
  const thumpGain = audio.createGain();
  thumpGain.gain.setValueAtTime(volume, at);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
  thump.connect(thumpGain).connect(out);
  thump.start(at);
  thump.stop(at + 0.12);

  const source = audio.createBufferSource();
  source.buffer = noiseFor(audio);
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = frequency * 4;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(volume * 0.8, at);
  gain.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
  source.connect(filter).connect(gain).connect(out);
  source.start(at);
  source.stop(at + 0.08);
}

/** Three knocks on a door. */
export function playKnock(): void {
  const audio = mixer.audio;
  if (!audio) return;
  for (let i = 0; i < 3; i += 1) hit(audio, audio.currentTime + i * 0.2, 150, 0.6);
}

/** The click of a lock turning. */
export function playLockClick(): void {
  const audio = mixer.audio;
  if (!audio) return;
  hit(audio, audio.currentTime, 900, 0.25);
  hit(audio, audio.currentTime + 0.07, 700, 0.2);
}
