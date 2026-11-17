/**
 * The other players in the house. Each one is a full character, dressed as
 * they chose, with their name over the head. Positions come from the server
 * 20 times a second; the characters are drawn a little behind, between the two
 * latest updates, so they move smoothly instead of hopping.
 */
import * as THREE from 'three';
import { sanitizeAvatar, voiceSigns, type AvatarConfig, type Gender } from '@nongs/shared';
import { Avatar, type AnimationName, type Gesture } from '../player/avatar';
import { NameTag } from '../player/nameTag';
import type { HouseView, PlayerView } from './house';

/** How far behind the latest update the others are drawn, in seconds: two updates and a bit. */
const DELAY = 0.12;
const KEEP_SAMPLES = 12;

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  facing: number;
}

function angleLerp(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

class Remote {
  readonly root = new THREE.Group();
  readonly tag: NameTag;
  avatar: Avatar | null = null;
  private gender: Gender | null = null;
  private look = '';
  private loading: Promise<void> | null = null;
  private readonly samples: Sample[] = [];
  private lastAnimation: AnimationName = 'idle';
  private pendingGesture: Gesture | null = null;

  constructor(
    readonly name: string,
    private readonly nameHeight: number,
  ) {
    this.tag = new NameTag(name, nameHeight);
    this.root.visible = false;
  }

  /** Where they are drawn now. */
  get position(): THREE.Vector3 {
    return this.root.position;
  }

  react(name: Gesture): void {
    if (this.avatar) this.avatar.react(name);
    else this.pendingGesture = name;
  }

  update(view: PlayerView, now: number, dt: number): void {
    this.dress(view.look);
    const last = this.samples[this.samples.length - 1];
    if (!last || last.x !== view.x || last.y !== view.y || last.z !== view.z || last.facing !== view.facing) {
      this.samples.push({ t: now, x: view.x, y: view.y, z: view.z, facing: view.facing });
      if (this.samples.length > KEEP_SAMPLES) this.samples.shift();
    }
    this.place(now - DELAY);
    this.root.visible = view.anim !== '';
    this.tag.sprite.position.set(this.root.position.x, this.root.position.y + this.nameHeight, this.root.position.z);
    this.tag.visible = this.root.visible;

    const avatar = this.avatar;
    if (!avatar || view.anim === '') return;
    const animation = view.anim;
    avatar.setRecline(view.recline);
    avatar.setSwim(view.swim === '' ? null : view.swim);
    const cut = animation !== this.lastAnimation && (animation === 'sleep' || this.lastAnimation === 'sleep');
    avatar.play(animation, view.speed, cut ? 0 : undefined);
    this.lastAnimation = animation;
    avatar.bare(view.bare);
    avatar.showVoice(voiceSigns({ muted: view.muted, deafened: view.deafened, inPrivate: view.inPrivate }));
    avatar.update(dt);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.tag.sprite.removeFromParent();
  }

  /** Puts the body where it was at time `t`, between the two updates either side of it. */
  private place(t: number): void {
    const samples = this.samples;
    if (samples.length === 0) return;
    let before = samples[0]!;
    let after = before;
    for (const sample of samples) {
      if (sample.t <= t) before = sample;
      if (sample.t >= t) {
        after = sample;
        break;
      }
      after = sample;
    }
    const span = after.t - before.t;
    const k = span > 0 ? THREE.MathUtils.clamp((t - before.t) / span, 0, 1) : 1;
    this.root.position.set(
      THREE.MathUtils.lerp(before.x, after.x, k),
      THREE.MathUtils.lerp(before.y, after.y, k),
      THREE.MathUtils.lerp(before.z, after.z, k),
    );
    this.root.rotation.y = angleLerp(before.facing, after.facing, k);
  }

  /** Puts on their look, loading the other body if they changed it. */
  private dress(lookJson: string): void {
    if (lookJson === this.look || this.loading) return;
    let config: AvatarConfig;
    try {
      config = sanitizeAvatar(JSON.parse(lookJson));
    } catch {
      config = sanitizeAvatar(null);
    }
    if (config.gender === this.gender && this.avatar) {
      this.look = lookJson;
      this.avatar.wear(config);
      return;
    }
    this.loading = Avatar.load(config.gender)
      .then((avatar) => {
        this.avatar?.root.removeFromParent();
        this.avatar = avatar;
        this.gender = config.gender;
        this.look = lookJson;
        avatar.wear(config);
        this.root.add(avatar.root);
        if (this.pendingGesture) avatar.react(this.pendingGesture);
        this.pendingGesture = null;
      })
      .catch((error: unknown) => console.error(`Could not load ${this.name}'s character`, error))
      .finally(() => {
        this.loading = null;
      });
  }
}

export class RemotePlayers {
  private readonly remotes = new Map<string, Remote>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly nameHeight: number,
  ) {}

  /** The other players drawn now, by session id. */
  get all(): ReadonlyMap<string, Remote> {
    return this.remotes;
  }

  /** Brings the characters in line with the server's copy of the house. */
  update(state: HouseView, me: string, dt: number): void {
    const now = performance.now() / 1000;
    const seen = new Set<string>();
    state.players.forEach((view, sessionId) => {
      if (sessionId === me) return;
      seen.add(sessionId);
      let remote = this.remotes.get(sessionId);
      if (!remote) {
        remote = new Remote(view.name, this.nameHeight);
        this.remotes.set(sessionId, remote);
        this.scene.add(remote.root, remote.tag.sprite);
      }
      remote.update(view, now, dt);
    });
    for (const [sessionId, remote] of this.remotes) {
      if (seen.has(sessionId)) continue;
      remote.dispose();
      this.remotes.delete(sessionId);
    }
  }

  react(sessionId: string, name: Gesture): void {
    this.remotes.get(sessionId)?.react(name);
  }

  /** Hides the players in rooms that cannot be seen from here (see world/visibility.ts). */
  cull(inView: (x: number, z: number) => boolean): void {
    for (const remote of this.remotes.values()) {
      if (inView(remote.position.x, remote.position.z)) continue;
      remote.root.visible = false;
      remote.tag.visible = false;
    }
  }
}
