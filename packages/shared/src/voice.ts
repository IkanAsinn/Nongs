/**
 * A player's microphone and sound switches. There is no voice chat yet; when
 * there is, the server will use `canSpeak` and `canHear` to decide whose
 * sound goes to whom, so a bath stays private whatever the client does.
 */
export interface Voice {
  /** The player switched their microphone off. */
  muted: boolean;
  /** The player switched everyone else's sound off. A deafened player is not heard either. */
  deafened: boolean;
  /** In the bath: nothing goes in or out, whatever the two switches say. */
  inPrivate: boolean;
}

export const VOICE_OPEN: Voice = { muted: false, deafened: false, inPrivate: false };

export const canSpeak = (voice: Voice): boolean => !voice.muted && !voice.deafened && !voice.inPrivate;
export const canHear = (voice: Voice): boolean => !voice.deafened && !voice.inPrivate;

/** The mute key. It does nothing in private, and it also ends deafening, as that is what holds the microphone off. */
export function toggleMute(voice: Voice): Voice {
  if (voice.inPrivate) return voice;
  if (voice.deafened) return { ...voice, muted: false, deafened: false };
  return { ...voice, muted: !voice.muted };
}

/** The deafen key. It does nothing in private. */
export function toggleDeafen(voice: Voice): Voice {
  if (voice.inPrivate) return voice;
  return { ...voice, deafened: !voice.deafened };
}

/** Getting into or out of the bath. The switches keep their positions for afterwards. */
export function setPrivate(voice: Voice, inPrivate: boolean): Voice {
  return voice.inPrivate === inPrivate ? voice : { ...voice, inPrivate };
}

/** What the other players see on a character: tape over the mouth, headphones on the ears. */
export interface VoiceSigns {
  tape: boolean;
  headphones: boolean;
}

/**
 * The switches as worn on the head: muted shows tape over the mouth and
 * deafened shows headphones. In the bath nothing is worn; the bath closes
 * both anyway, and the switches only show again afterwards.
 */
export function voiceSigns(voice: Voice): VoiceSigns {
  if (voice.inPrivate) return { tape: false, headphones: false };
  return { tape: voice.muted, headphones: voice.deafened };
}
