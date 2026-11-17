import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FURNITURE_MODELS, type Furniture, type FurnitureModelId, type Placement } from '@nongs/shared';

const modelUrls = import.meta.glob('../../../../assets/converted/{prop,shoes}_*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function modelUrl(model: FurnitureModelId): string {
  const key = Object.keys(modelUrls).find((path) => path.endsWith(`/${model}.glb`));
  const url = key ? modelUrls[key] : undefined;
  if (!url) throw new Error(`Missing asset: ${model}.glb (run tools/blender/build_props.py in Blender)`);
  return url;
}

const modelCache = new Map<FurnitureModelId, Promise<THREE.Object3D>>();
const loader = new GLTFLoader();

/** Starts loading models before the pieces are known, so placing them later is quick. */
export function loadFurnitureModels(models: Iterable<FurnitureModelId>): Promise<THREE.Object3D[]> {
  return Promise.all(
    [...new Set(models)].map((model) => {
      let found = modelCache.get(model);
      if (!found) {
        found = loader.loadAsync(modelUrl(model)).then((gltf) => gltf.scene);
        modelCache.set(model, found);
      }
      return found;
    }),
  );
}

export interface FurnitureView {
  readonly group: THREE.Group;
  /** The object shown for each piece, by piece id. */
  readonly objects: ReadonlyMap<string, THREE.Object3D>;
  /** Puts a piece's model and its collider where the piece now stands. */
  place(piece: Furniture): void;
  /** Shows a piece's model somewhere else for a moment. Its collider stays where it is. */
  show(piece: Furniture, at: Placement): void;
  /** Lets players walk through a solid piece, or stops them again. */
  setSolid(piece: Furniture, solid: boolean): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Places every piece of furniture: a copy of its model, and a box collider if it is solid. */
export async function buildFurniture(world: RAPIER.World, pieces: readonly Furniture[]): Promise<FurnitureView> {
  const used = [...new Set(pieces.map((piece) => piece.model))];
  const loaded = await loadFurnitureModels(used);
  const models = new Map(used.map((model, i) => [model, loaded[i]!]));

  const group = new THREE.Group();
  const objects = new Map<string, THREE.Object3D>();
  const colliders = new Map<string, RAPIER.Collider>();
  const turn = new THREE.Quaternion();

  const show = (piece: Furniture, at: Placement) => {
    const object = objects.get(piece.id);
    if (!object) return;
    object.position.set(at.x, at.elevation, at.z);
    object.rotation.set(0, at.yaw, 0);
  };
  const place = (piece: Furniture) => {
    show(piece, piece);
    const collider = colliders.get(piece.id);
    if (!collider) return;
    turn.setFromAxisAngle(UP, piece.yaw);
    collider.setTranslation({ x: piece.x, y: piece.elevation + FURNITURE_MODELS[piece.model].height / 2, z: piece.z });
    collider.setRotation({ x: turn.x, y: turn.y, z: turn.z, w: turn.w });
  };

  for (const piece of pieces) {
    // Copies share geometry and materials with the loaded model.
    const object = models.get(piece.model)!.clone();
    object.name = piece.id;
    group.add(object);
    objects.set(piece.id, object);

    const size = FURNITURE_MODELS[piece.model];
    if (size.solid) {
      colliders.set(piece.id, world.createCollider(RAPIER.ColliderDesc.cuboid(size.width / 2, size.height / 2, size.depth / 2)));
    }
    place(piece);
  }

  return {
    group,
    objects,
    place,
    show,
    setSolid: (piece, solid) => colliders.get(piece.id)?.setEnabled(solid),
  };
}
