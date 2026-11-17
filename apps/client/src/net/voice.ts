/**
 * Voice chat. Each zone of the house is its own LiveKit room; the server only
 * gives a token for the zone it has this player in, and takes them out when
 * they leave it. Walking through a door switches rooms (about half a second).
 *
 * In a closed room everyone is heard at full volume. In an open area (the
 * living room, the kitchen, the garden) voices fade with distance and only the
 * nearest few are listened to.
 */
import { ConnectionState, Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrackPublication } from 'livekit-client';
import { VOICE_FALLOFF, ZONES, canHear, canSpeak, voiceVolume, type Voice } from '@nongs/shared';
import { ApiError, api } from './api';

/** At most this many voices are listened to at once in an open area. */
const MAX_STREAMS = 8;
/** A new zone is joined once the player has been in it this long, so a doorway is not joined and left. */
const SETTLE_SECONDS = 0.5;
/** After a failure, try again this much later. */
const RETRY_SECONDS = 10;

export type VoiceStatus = 'off' | 'connecting' | 'on' | 'unavailable';

export class VoiceChat {
  status: VoiceStatus = 'off';
  /** Called with a short message when something goes wrong that the player should know. */
  onProblem: (message: string) => void = () => {};

  private room: Room | null = null;
  private zone: string | null = null;
  private wanted: string | null = null;
  private settle = 0;
  private retryIn = 0;
  private busy = false;
  private publishing = false;
  private readonly audio = new Map<string, HTMLMediaElement>();

  /**
   * Runs once a frame. `zone` is the zone the player stands in (null outside),
   * `voice` their switches, and `positions` where the others are, by name, for
   * the fall-off in open areas.
   */
  update(dt: number, zone: string | null, voice: Voice, me: { x: number; z: number }, positions: ReadonlyMap<string, { x: number; z: number }>): void {
    if (this.status === 'unavailable') return;
    const wanted = canHear(voice) ? zone : null;
    if (wanted !== this.wanted) {
      this.wanted = wanted;
      this.settle = SETTLE_SECONDS;
    }
    this.settle = Math.max(0, this.settle - dt);
    this.retryIn = Math.max(0, this.retryIn - dt);
    if (!this.busy && this.settle === 0 && this.retryIn === 0 && this.wanted !== this.zone) void this.switchTo(this.wanted);

    const room = this.room;
    if (!room || room.state !== ConnectionState.Connected) return;
    void this.setMicrophone(room, canSpeak(voice));
    this.listen(room, me, positions);
  }

  /** Leaves voice chat, as when logging out. */
  stop(): void {
    void this.room?.disconnect();
    this.room = null;
    this.zone = null;
  }

  private async switchTo(zone: string | null): Promise<void> {
    this.busy = true;
    try {
      if (this.room) {
        await this.room.disconnect();
        this.room = null;
        this.publishing = false;
        for (const element of this.audio.values()) element.remove();
        this.audio.clear();
      }
      this.zone = zone;
      if (!zone) {
        this.status = 'off';
        return;
      }
      this.status = 'connecting';
      const grant = await api.voiceToken();
      const room = new Room({ adaptiveStream: false, dynacast: false });
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach();
        element.hidden = true;
        document.body.append(element);
        this.audio.get(participant.identity)?.remove();
        this.audio.set(participant.identity, element);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        track.detach().forEach((element) => element.remove());
        this.audio.delete(participant.identity);
      });
      room.on(RoomEvent.Disconnected, () => {
        if (this.room !== room) return;
        // The server took this player out (they left the zone, or got into the bath): join again when allowed.
        this.room = null;
        this.zone = null;
        this.status = 'off';
      });
      await room.connect(grant.url, grant.token, { autoSubscribe: false });
      this.room = room;
      this.status = 'on';
    } catch (error) {
      this.zone = null;
      if (error instanceof ApiError && error.status === 503) {
        this.status = 'unavailable';
        return;
      }
      this.status = 'off';
      this.retryIn = RETRY_SECONDS;
      if (!(error instanceof ApiError && error.status === 403)) this.onProblem('Voice chat could not connect. Trying again soon.');
    } finally {
      this.busy = false;
    }
  }

  private async setMicrophone(room: Room, on: boolean): Promise<void> {
    if (on === this.publishing) return;
    this.publishing = on;
    try {
      await room.localParticipant.setMicrophoneEnabled(on);
    } catch {
      this.publishing = false;
      this.onProblem('The microphone could not be used. Check the browser lets this page use it.');
    }
  }

  /** Picks whom to listen to and how loud: everyone in a room, the nearest few in an open area. */
  private listen(room: Room, me: { x: number; z: number }, positions: ReadonlyMap<string, { x: number; z: number }>): void {
    const open = ZONES.find((zone) => zone.id === this.zone)?.kind !== 'room';
    const others: { participant: RemoteParticipant; distance: number }[] = [];
    for (const participant of room.remoteParticipants.values()) {
      const at = positions.get(participant.identity);
      const distance = at ? Math.hypot(at.x - me.x, at.z - me.z) : Infinity;
      others.push({ participant, distance: open ? distance : 0 });
    }
    others.sort((a, b) => a.distance - b.distance);
    others.forEach(({ participant, distance }, rank) => {
      const listen = rank < MAX_STREAMS && distance < VOICE_FALLOFF.listen;
      for (const publication of participant.audioTrackPublications.values()) {
        (publication as RemoteTrackPublication).setSubscribed(listen);
      }
      if (listen) participant.setVolume(open ? voiceVolume(distance) : 1);
    });
  }
}
