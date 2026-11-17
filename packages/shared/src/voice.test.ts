import { describe, expect, it } from 'vitest';
import { VOICE_OPEN, canHear, canSpeak, setPrivate, toggleDeafen, toggleMute, voiceSigns } from './voice.js';

describe('microphone and sound switches', () => {
  it('start open', () => {
    expect(canSpeak(VOICE_OPEN)).toBe(true);
    expect(canHear(VOICE_OPEN)).toBe(true);
  });

  it('mute stops speaking only', () => {
    const muted = toggleMute(VOICE_OPEN);
    expect(canSpeak(muted)).toBe(false);
    expect(canHear(muted)).toBe(true);
    expect(toggleMute(muted)).toEqual(VOICE_OPEN);
  });

  it('deafen stops both, and the mute key ends it', () => {
    const deaf = toggleDeafen(VOICE_OPEN);
    expect(canSpeak(deaf)).toBe(false);
    expect(canHear(deaf)).toBe(false);
    expect(toggleDeafen(deaf)).toEqual(VOICE_OPEN);
    expect(toggleMute(deaf)).toEqual(VOICE_OPEN);
  });

  it('a bath closes both and locks the keys, then gives the switches back as they were', () => {
    const muted = toggleMute(VOICE_OPEN);
    const bathing = setPrivate(muted, true);
    expect(canSpeak(bathing)).toBe(false);
    expect(canHear(bathing)).toBe(false);
    expect(toggleMute(bathing)).toBe(bathing);
    expect(toggleDeafen(bathing)).toBe(bathing);
    expect(setPrivate(bathing, false)).toEqual(muted);
    expect(canHear(setPrivate(setPrivate(VOICE_OPEN, true), false))).toBe(true);
  });

  it('show tape when muted and headphones when deafened, and nothing in the bath', () => {
    expect(voiceSigns(VOICE_OPEN)).toEqual({ tape: false, headphones: false });
    const muted = toggleMute(VOICE_OPEN);
    expect(voiceSigns(muted)).toEqual({ tape: true, headphones: false });
    expect(voiceSigns(toggleDeafen(VOICE_OPEN))).toEqual({ tape: false, headphones: true });
    expect(voiceSigns(toggleDeafen(muted))).toEqual({ tape: true, headphones: true });
    expect(voiceSigns(setPrivate(toggleDeafen(muted), true))).toEqual({ tape: false, headphones: false });
  });
});
