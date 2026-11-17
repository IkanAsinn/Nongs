import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PLAYER_HEIGHT, type Avatar, type Locomotion } from './avatar';

export { PLAYER_HEIGHT };

const RADIUS = 0.25;
const EYE_HEIGHT = 1.22;
const WALK_SPEED = 1.8;
const RUN_SPEED = 3.4;
/** Below this real speed (m/s) the character counts as standing still. */
const MOVING_THRESHOLD = 0.3;
const GRAVITY = -9.81;
/** Upward speed at take-off, in m/s. Gives a jump about 0.65 m high. */
const JUMP_SPEED = 3.6;
const TURN_SPEED = 12; // how fast the body turns to face its movement
const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = 1.3;

/** In water the body floats with the surface this far above the feet: at the neck. */
export const FLOAT_DEPTH = 0.85;
const SWIM_SPEED = 1.1;
const SWIM_FAST_SPEED = 1.9;
/** How strongly the water pushes the body to floating height, and how quickly it stops a fall. */
const BUOYANCY = 5;
const WATER_DRAG = 6;
const MAX_FLOAT_SPEED = 1.2;
const SNAP_TO_GROUND = 0.3;

const CAMERA_DISTANCE = 3;
const CAMERA_TARGET_HEIGHT = 1.2;
const CAMERA_WALL_MARGIN = 0.2;
const CAMERA_MIN_DISTANCE = 0.3;

export type ViewMode = 'tpv' | 'fpv';

export interface MoveInput {
  /** −1 (back) to 1 (forward). */
  forward: number;
  /** −1 (left) to 1 (right). */
  right: number;
  run: boolean;
  /** True on the frame the jump key goes down. */
  jump: boolean;
  /** Mouse movement in pixels. */
  lookX: number;
  lookY: number;
  /** 1 normally; lower when the player is tired or hungry. */
  speedScale: number;
  /** Height of the water surface where the player is, or null on dry land. */
  waterLevel: number | null;
}

export class Player {
  /** Sits at the player's feet. */
  readonly root = new THREE.Group();
  view: ViewMode = 'tpv';
  yaw: number;
  pitch = -0.25;
  /** What the body is doing, from its real speed. */
  locomotion: Locomotion = 'idle';
  /** Real horizontal speed in m/s. */
  speed = 0;
  /** True while the water is deep enough to carry the body. */
  swimming = false;
  /**
   * Set while the body rests on furniture: the feet origin and facing to show,
   * where the eyes are, and the point the third-person camera looks at.
   * The physics body stays where the player stood, so they get up in the same spot.
   */
  pinned: {
    position: THREE.Vector3;
    facing: number;
    eye: THREE.Vector3;
    focus: THREE.Vector3;
    /** How far back the third-person camera sits; the usual distance when left out. */
    distance?: number;
  } | null = null;

  private facing: number;
  private verticalSpeed = 0;
  private grounded = false;
  /** True from take-off until the feet are back on the ground. */
  private jumping = false;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  constructor(
    private readonly world: RAPIER.World,
    spawn: { x: number; z: number; yaw: number },
  ) {
    this.yaw = spawn.yaw;
    this.facing = spawn.yaw + Math.PI;

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, PLAYER_HEIGHT / 2 + 0.05, spawn.z),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_HEIGHT / 2 - RADIUS, RADIUS),
      this.body,
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.3, 0.2, true);
    this.controller.enableSnapToGround(SNAP_TO_GROUND);

    this.syncFromPhysics();
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  /** The way the body faces, as a turn about Y (0 faces +Z). */
  get heading(): number {
    return this.pinned?.facing ?? this.facing;
  }

  setAvatar(avatar: Avatar): void {
    this.root.clear();
    this.root.add(avatar.root);
  }

  toggleView(): void {
    this.view = this.view === 'tpv' ? 'fpv' : 'tpv';
  }

  /** Applies input and queues the move. Call before the physics step. */
  update(dt: number, input: MoveInput): void {
    this.yaw -= input.lookX * LOOK_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.lookY * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    if (this.pinned) {
      this.speed = 0;
      this.locomotion = 'idle';
      return;
    }

    // Afloat once the water reaches the neck. From then on the water holds the body up, not the ground.
    const feetY = this.body.translation().y - PLAYER_HEIGHT / 2;
    const floatY = input.waterLevel === null ? -Infinity : input.waterLevel - FLOAT_DEPTH;
    const swimming = feetY < floatY + 0.05;
    if (swimming !== this.swimming) {
      this.swimming = swimming;
      if (swimming) this.controller.disableSnapToGround();
      else this.controller.enableSnapToGround(SNAP_TO_GROUND);
    }

    // At yaw 0 the camera looks down −Z.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let moveX = -sin * input.forward + cos * input.right;
    let moveZ = -cos * input.forward - sin * input.right;
    const length = Math.hypot(moveX, moveZ);
    const moving = length > 1e-3;
    if (moving) {
      const pace = swimming ? (input.run ? SWIM_FAST_SPEED : SWIM_SPEED) : input.run ? RUN_SPEED : WALK_SPEED;
      const speed = pace * input.speedScale;
      moveX = (moveX / length) * speed;
      moveZ = (moveZ / length) * speed;
    }

    if (swimming) {
      const lift = THREE.MathUtils.clamp((floatY - feetY) * BUOYANCY, -MAX_FLOAT_SPEED, MAX_FLOAT_SPEED);
      this.verticalSpeed += (lift - this.verticalSpeed) * Math.min(1, WATER_DRAG * dt);
      this.jumping = false;
    } else {
      if (input.jump && this.grounded) {
        this.verticalSpeed = JUMP_SPEED;
        this.jumping = true;
      }
      this.verticalSpeed += GRAVITY * dt;
    }
    const wantedY = this.verticalSpeed * dt;
    this.controller.computeColliderMovement(this.collider, {
      x: moveX * dt,
      y: wantedY,
      z: moveZ * dt,
    });
    this.grounded = this.controller.computedGrounded();
    const movement = this.controller.computedMovement();
    // Stop falling on the ground, and stop rising when the head hits something.
    const hitHead = wantedY > 0 && movement.y < wantedY - 1e-4;
    if ((this.grounded && !swimming) || hitHead) this.verticalSpeed = 0;
    if (this.grounded) this.jumping = false;

    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });

    // Judge by the real movement, so pushing against a wall counts as standing still.
    this.speed = Math.hypot(movement.x, movement.z) / Math.max(dt, 1e-4);
    if (swimming) this.locomotion = 'idle'; // the swimming itself is posed by the avatar
    else if (this.jumping) this.locomotion = 'jump';
    else this.locomotion = this.speed < MOVING_THRESHOLD ? 'idle' : input.run ? 'run' : 'walk';

    // The model's forward is +Z. In first person it faces where the camera
    // looks; in third person it turns towards its movement.
    if (this.view === 'fpv') {
      this.facing = this.yaw + Math.PI;
    } else if (moving) {
      const target = Math.atan2(moveX, moveZ);
      const diff = Math.atan2(Math.sin(target - this.facing), Math.cos(target - this.facing));
      this.facing += diff * Math.min(1, TURN_SPEED * dt);
    }
  }

  /** Copies the physics position to the visuals. Call after the physics step. */
  syncFromPhysics(): void {
    if (this.pinned) {
      this.root.position.copy(this.pinned.position);
      this.root.rotation.y = this.pinned.facing;
    } else {
      this.standing(this.root.position);
      this.root.rotation.y = this.facing;
    }
    this.root.visible = this.view === 'tpv';
  }

  /** Puts the player down somewhere else, standing on the ground there. */
  place(x: number, z: number): void {
    this.body.setTranslation({ x, y: PLAYER_HEIGHT / 2 + 0.05, z }, true);
    this.verticalSpeed = 0;
  }

  /** Turns the body to face a direction (an angle around the up axis; 0 faces +Z). */
  face(angle: number): void {
    this.facing = angle;
  }

  /** Where the player stands, whatever the body is shown doing. */
  standing(target: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return target.set(t.x, t.y - PLAYER_HEIGHT / 2, t.z);
  }

  updateCamera(camera: THREE.PerspectiveCamera): void {
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const feet = this.root.position;

    if (this.view === 'fpv') {
      if (this.pinned) camera.position.copy(this.pinned.eye);
      else camera.position.set(feet.x, feet.y + EYE_HEIGHT, feet.z);
      return;
    }

    const focus = this.pinned?.focus;
    const target = focus
      ? { x: focus.x, y: focus.y, z: focus.z }
      : { x: feet.x, y: feet.y + CAMERA_TARGET_HEIGHT, z: feet.z };
    const cosPitch = Math.cos(this.pitch);
    // Direction from the player back to the camera.
    const back = {
      x: Math.sin(this.yaw) * cosPitch,
      y: -Math.sin(this.pitch),
      z: Math.cos(this.yaw) * cosPitch,
    };

    // Pull the camera in if a wall, door, floor or ceiling is in the way.
    const wanted = this.pinned?.distance ?? CAMERA_DISTANCE;
    let distance = wanted;
    const hit = this.world.castRay(
      new RAPIER.Ray(target, back),
      wanted + CAMERA_WALL_MARGIN,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
    );
    if (hit) distance = Math.max(CAMERA_MIN_DISTANCE, hit.timeOfImpact - CAMERA_WALL_MARGIN);

    camera.position.set(
      target.x + back.x * distance,
      target.y + back.y * distance,
      target.z + back.z * distance,
    );
  }
}
