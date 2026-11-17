import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  DOORS,
  DOOR_HEIGHT,
  FENCES,
  HOUSE_BOUNDS,
  LAWN,
  POOL,
  SLIDE,
  WALLS,
  WALL_HEIGHT,
  ZONES,
  buildWallBoxes,
  slideTravel,
  type Door,
} from '@nongs/shared';

const DOOR_THICKNESS = 0.06;
const DOOR_SWING_SPEED = 5; // radians per second
const DOOR_SLIDE_SPEED = 1.6; // metres per second
/** How far the ground reaches down. It has to be deeper than the pool. */
const GROUND_DEPTH = 2;
/** A door will not close while someone stands this close to its centre. */
/** The fence looks 1 m high, but nobody should get over it. */
const FENCE_COLLIDER_HEIGHT = 4;

// The house model is built and exported by tools/blender/build_house.py.
const houseUrls = import.meta.glob('../../../../assets/converted/house.glb', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface DoorInstance {
  readonly def: Door;
  readonly isOpen: boolean;
  /** Opens or closes the door, as the server says. Shutting it on someone is checked before asking. */
  setOpen(open: boolean): void;
}

export interface House {
  readonly group: THREE.Group;
  readonly doors: readonly DoorInstance[];
  update(dt: number): void;
}

/** A door in the game: what it shows, and its part in the frame loop. */
interface WorkingDoor extends DoorInstance {
  update(dt: number): void;
}

class SwingDoor implements WorkingDoor {
  isOpen = false;
  private readonly closedYaw: number;
  private readonly openYaw: number;

  /**
   * @param leaf The door leaf from the house model. Its origin is on the
   *   hinge and it runs from there towards +X (`along: 'x'`) or +Z (`along: 'z'`).
   */
  constructor(
    readonly def: Door,
    private readonly collider: RAPIER.Collider,
    private readonly leaf: THREE.Object3D,
  ) {
    const zone = ZONES.find((z) => z.id === def.zoneId);
    if (!zone) throw new Error(`Door ${def.id} points at unknown zone ${def.zoneId}`);

    // A Y rotation of θ turns +X into (cos θ, 0, −sin θ) and +Z into (sin θ, 0, cos θ).
    // Doors swing into the room they belong to.
    let swing: number;
    if (def.along === 'x') {
      const roomZ = (zone.minZ + zone.maxZ) / 2;
      swing = roomZ < def.z ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const roomX = (zone.minX + zone.maxX) / 2;
      swing = roomX < def.x ? -Math.PI / 2 : Math.PI / 2;
    }
    this.closedYaw = leaf.rotation.y;
    this.openYaw = this.closedYaw + swing;
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.collider.setEnabled(!open);
  }

  update(dt: number): void {
    const target = this.isOpen ? this.openYaw : this.closedYaw;
    const diff = target - this.leaf.rotation.y;
    const step = DOOR_SWING_SPEED * dt;
    this.leaf.rotation.y = Math.abs(diff) <= step ? target : this.leaf.rotation.y + Math.sign(diff) * step;
  }
}

/** A glass door with one fixed panel and one that slides over it. */
class SlideDoor implements WorkingDoor {
  isOpen = false;
  private readonly closedAt: number;
  private readonly openAt: number;

  /**
   * @param leaf The sliding panel from the house model. It covers the high
   *   half of the doorway and slides towards the low half.
   */
  constructor(
    readonly def: Door,
    private readonly collider: RAPIER.Collider,
    private readonly leaf: THREE.Object3D,
  ) {
    this.closedAt = leaf.position[def.along];
    this.openAt = this.closedAt - slideTravel(def);
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.collider.setEnabled(!open);
  }

  update(dt: number): void {
    const target = this.isOpen ? this.openAt : this.closedAt;
    const now = this.leaf.position[this.def.along];
    const step = DOOR_SLIDE_SPEED * dt;
    this.leaf.position[this.def.along] = Math.abs(target - now) <= step ? target : now + Math.sign(target - now) * step;
  }
}

const WATER_VERTEX = /* glsl */ `
  varying vec2 vPlace;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPlace = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Slow crossing waves, drawn as lighter lines on the blue: the look of sunlight on a pool.
const WATER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec2 vPlace;
  float ripple(vec2 p, float t) {
    vec2 q = p + 0.35 * vec2(sin(p.y * 1.3 + t * 0.7), sin(p.x * 1.1 - t * 0.6));
    return sin(q.x * 2.4 + t * 0.9) + sin(q.y * 2.0 - t * 0.8) + sin((q.x + q.y) * 1.5 + t * 0.6);
  }
  void main() {
    float lines = 1.0 - smoothstep(0.0, 0.5, abs(ripple(vPlace, uTime)));
    float soft = 0.5 + 0.5 * sin(ripple(vPlace * 0.5, uTime * 0.7));
    vec3 colour = mix(vec3(0.16, 0.56, 0.74), vec3(0.33, 0.74, 0.86), soft);
    colour = mix(colour, vec3(0.86, 0.97, 1.0), lines * 0.36);
    gl_FragColor = vec4(colour, 0.62 + 0.14 * lines);
    #include <colorspace_fragment>
  }
`;

/**
 * Builds the house. The visuals are the model made in Blender; the collision
 * comes from the shared layout, which the model was built from.
 */
export async function buildHouse(world: RAPIER.World): Promise<House> {
  const houseUrl = Object.values(houseUrls)[0];
  if (!houseUrl) throw new Error('Missing asset: house.glb (run tools/blender/build_house.py in Blender)');
  // house.glb is meshopt-compressed (tools/blender/build_house.py).
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(houseUrl);

  const group = new THREE.Group();
  group.add(gltf.scene);

  /** A solid block between two corners on the floor plan, from `bottom` up to `top`. */
  const block = (minX: number, maxX: number, minZ: number, maxZ: number, bottom: number, top: number) => {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid((maxX - minX) / 2, (top - bottom) / 2, (maxZ - minZ) / 2).setTranslation(
        (minX + maxX) / 2,
        (bottom + top) / 2,
        (minZ + maxZ) / 2,
      ),
    );
  };

  // Ground: under the lawn and the house, in four blocks that leave the pool open.
  const west = LAWN.minX - 1;
  const east = LAWN.maxX + 1;
  const north = LAWN.minZ - 1;
  const south = LAWN.maxZ + 1;
  block(west, POOL.minX, north, south, -GROUND_DEPTH, 0);
  block(POOL.maxX, east, north, south, -GROUND_DEPTH, 0);
  block(POOL.minX, POOL.maxX, north, POOL.minZ, -GROUND_DEPTH, 0);
  block(POOL.minX, POOL.maxX, POOL.maxZ, south, -GROUND_DEPTH, 0);

  // The pool: its bottom, and the steps down from the south end.
  block(POOL.minX, POOL.maxX, POOL.minZ, POOL.maxZ, -GROUND_DEPTH, POOL.floor);
  for (let step = 0; step < POOL.steps.count; step += 1) {
    const near = POOL.maxZ - step * POOL.steps.run;
    block(POOL.minX, POOL.maxX, near - POOL.steps.run, near, POOL.floor, POOL.steps.top - step * POOL.steps.rise);
  }

  // The water slide: its tower (climbed with the ladder, not walked into) and the posts under the chute.
  const tower = SLIDE.tower;
  block(tower.minX, tower.maxX, tower.minZ, tower.maxZ, 0, tower.top + 1);
  for (const index of SLIDE.posts) {
    const [x, y, z] = SLIDE.path[index]!;
    block(x - 0.06, x + 0.06, z - 0.06, z + 0.06, 0, y - 0.1);
  }

  // The water in the model is a flat sheet; here it gets ripples that move.
  const waterTime = { value: 0 };
  const water = gltf.scene.getObjectByName('pool-water');
  if (!(water instanceof THREE.Mesh)) throw new Error('house.glb has no mesh named pool-water');
  water.material = new THREE.ShaderMaterial({
    uniforms: { uTime: waterTime },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });

  // Fence: keeps players on the lawn.
  for (const fence of FENCES) {
    const halfX = Math.abs(fence.x2 - fence.x1) / 2 + 0.05;
    const halfZ = Math.abs(fence.z2 - fence.z1) / 2 + 0.05;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(halfX, FENCE_COLLIDER_HEIGHT / 2, halfZ).setTranslation(
        (fence.x1 + fence.x2) / 2,
        FENCE_COLLIDER_HEIGHT / 2,
        (fence.z1 + fence.z2) / 2,
      ),
    );
  }

  // Ceiling: stops the third-person camera from rising out of the house.
  const { minX, maxX, minZ, maxZ } = HOUSE_BOUNDS;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid((maxX - minX) / 2, 0.1, (maxZ - minZ) / 2).setTranslation(
      (minX + maxX) / 2,
      WALL_HEIGHT + 0.1,
      (minZ + maxZ) / 2,
    ),
  );

  // Walls: one box collider per segment.
  for (const box of buildWallBoxes(WALLS, DOORS)) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.sx / 2, box.sy / 2, box.sz / 2).setTranslation(box.x, box.y, box.z),
    );
  }

  // Doors: a collider each, and the matching leaf from the model to swing or slide.
  const doors = DOORS.map((def): WorkingDoor => {
    const leaf = gltf.scene.getObjectByName(def.id);
    if (!leaf) throw new Error(`house.glb has no object named ${def.id}`);
    /** A door-high sheet in the wall, `length` long, with its middle `offset` along the wall from the door's. */
    const sheet = (length: number, offset: number) => {
      const halfX = def.along === 'x' ? length / 2 : DOOR_THICKNESS / 2;
      const halfZ = def.along === 'x' ? DOOR_THICKNESS / 2 : length / 2;
      return world.createCollider(
        RAPIER.ColliderDesc.cuboid(halfX, DOOR_HEIGHT / 2, halfZ).setTranslation(
          def.x + (def.along === 'x' ? offset : 0),
          DOOR_HEIGHT / 2,
          def.z + (def.along === 'x' ? 0 : offset),
        ),
      );
    };
    if (def.kind === 'slide') {
      sheet(def.width / 2, -def.width / 4); // the fixed panel
      return new SlideDoor(def, sheet(def.width / 2, def.width / 4), leaf);
    }
    return new SwingDoor(def, sheet(def.width, 0), leaf);
  });

  return {
    group,
    doors,
    update(dt) {
      for (const door of doors) door.update(dt);
      waterTime.value += dt;
    },
  };
}
