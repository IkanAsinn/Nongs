/**
 * Draws all the furniture with one draw call per material instead of one per
 * mesh: about 45 calls in place of several hundred.
 *
 * The furniture objects stay where they are, so everything else keeps working
 * on them as before (moving, turning, hiding rooms, picking with a ray, the
 * broom in a player's hand). They are only taken off the camera's layer; every
 * frame, each one's place and visibility is copied into a `BatchedMesh` for
 * its material, which three.js draws in one go and culls piece by piece.
 */
import * as THREE from 'three';

/** The layer the stand-in meshes move to. Rays that should still hit furniture must test it. */
export const PROXY_LAYER = 1;

interface Entry {
  proxy: THREE.Mesh;
  batch: THREE.BatchedMesh;
  instance: number;
}

/** A copy of a geometry with exactly these float attributes (missing ones filled in) and an index. */
function plainGeometry(source: THREE.BufferGeometry, names: readonly string[], sizes: ReadonlyMap<string, number>): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const count = source.getAttribute('position').count;
  for (const name of names) {
    const size = sizes.get(name)!;
    const array = new Float32Array(count * size);
    const attribute = source.getAttribute(name);
    if (attribute) {
      for (let i = 0; i < count; i += 1) for (let c = 0; c < size; c += 1) array[i * size + c] = attribute.getComponent(i, c);
    } else if (name === 'color') array.fill(1);
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  const index = source.getIndex();
  const indices = new Uint32Array(index ? index.count : count);
  for (let i = 0; i < indices.length; i += 1) indices[i] = index ? index.getX(i) : i;
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

export class FurnitureBatches {
  readonly group = new THREE.Group();
  private readonly entries: Entry[] = [];

  /** Batches every plain mesh under `root`. Meshes added to it later (a picture in a frame) are drawn as usual. */
  constructor(private readonly root: THREE.Object3D) {
    this.group.name = 'furniture-batches';
    // Every prop file carries its own copy of the shared materials (wood, fabric…), made by the same
    // Blender script under the same name. One batch per name draws them all with one copy of the textures.
    const byMaterial = new Map<string, { material: THREE.Material; meshes: THREE.Mesh[] }>();
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(mesh.material)) return;
      const key = mesh.material.name || mesh.material.uuid;
      const found = byMaterial.get(key) ?? { material: mesh.material, meshes: [] };
      found.meshes.push(mesh);
      byMaterial.set(key, found);
    });

    for (const { material, meshes } of byMaterial.values()) {
      const geometries = [...new Set(meshes.map((mesh) => mesh.geometry))];
      const sizes = new Map<string, number>();
      for (const geometry of geometries) {
        for (const [name, attribute] of Object.entries(geometry.attributes)) sizes.set(name, attribute.itemSize);
      }
      const names = [...sizes.keys()].sort();
      const plain = new Map(geometries.map((geometry) => [geometry, plainGeometry(geometry, names, sizes)]));
      let vertices = 0;
      let indices = 0;
      for (const geometry of plain.values()) {
        vertices += geometry.getAttribute('position').count;
        indices += geometry.getIndex()!.count;
      }
      const batch = new THREE.BatchedMesh(meshes.length, vertices, indices, material);
      batch.name = `batch:${material.name}`;
      // Each piece is culled on its own; the batch as a whole always takes part.
      batch.frustumCulled = false;
      const ids = new Map([...plain].map(([source, geometry]) => [source, batch.addGeometry(geometry)]));
      for (const mesh of meshes) {
        const instance = batch.addInstance(ids.get(mesh.geometry)!);
        this.entries.push({ proxy: mesh, batch, instance });
        mesh.layers.set(PROXY_LAYER);
      }
      for (const geometry of plain.values()) geometry.dispose();
      this.group.add(batch);
    }
  }

  /** Copies each piece's place and visibility into the batches. Call once a frame, before drawing. */
  sync(): void {
    this.root.updateMatrixWorld();
    for (const { proxy, batch, instance } of this.entries) {
      let visible = true;
      for (let object: THREE.Object3D | null = proxy; object && visible; object = object.parent) {
        visible = object.visible;
        if (object === this.root) break;
      }
      batch.setVisibleAt(instance, visible);
      if (visible) batch.setMatrixAt(instance, proxy.matrixWorld);
    }
  }
}
