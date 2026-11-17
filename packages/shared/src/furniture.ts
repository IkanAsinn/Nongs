/**
 * Furniture: which models exist, and where each piece stands in the house.
 * Units are metres. The numbers live in furniture.data.json, which the Blender
 * script (tools/blender/build_house.py) reads too, so the game and the .blend
 * always show the same rooms. Later the server will own the placements so
 * players can redecorate.
 */
import data from './furniture.data.json';

/** The footprint and height of a model as it stands at yaw 0. */
export interface FurnitureModel {
  /** Size along X. */
  width: number;
  /** Size along Z. */
  depth: number;
  height: number;
  /** False for things players walk through: rugs, pictures, small objects. */
  solid: boolean;
}

/** A model name is also its GLB file name (without `.glb`) in assets/converted. */
export type FurnitureModelId = keyof typeof data.models;

export const FURNITURE_MODELS: Record<FurnitureModelId, FurnitureModel> = data.models;

export interface Furniture {
  id: string;
  model: FurnitureModelId;
  /** Centre of the piece on the floor. */
  x: number;
  z: number;
  /**
   * Turn around the up axis, in radians. At 0 the front faces +Z (south);
   * at π/2 it faces +X (east). A bed's head is at its back.
   */
  yaw: number;
  /** Height of the base above the floor: 0 unless it stands on a table or hangs on a wall. */
  elevation: number;
}

interface PieceData {
  id: string;
  model: string;
  x: number;
  z: number;
  /** Quarter turns: 0 faces south, 1 east, 2 north, −1 west. */
  turns: number;
  y?: number;
}

export const FURNITURE: readonly Furniture[] = (data.pieces as readonly PieceData[]).map((piece) => ({
  id: piece.id,
  model: piece.model as FurnitureModelId,
  x: piece.x,
  z: piece.z,
  yaw: (piece.turns * Math.PI) / 2,
  elevation: piece.y ?? 0,
}));

/** The floor rectangle a piece covers, allowing for quarter turns. */
export function furnitureFootprint(piece: Furniture): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const model = FURNITURE_MODELS[piece.model];
  const sideways = Math.abs(Math.sin(piece.yaw)) > 0.5;
  const halfX = (sideways ? model.depth : model.width) / 2;
  const halfZ = (sideways ? model.width : model.depth) / 2;
  return { minX: piece.x - halfX, maxX: piece.x + halfX, minZ: piece.z - halfZ, maxZ: piece.z + halfZ };
}

/**
 * A point given relative to a piece, as a point in the house.
 * `side` runs to the piece's left as you face its front; `front` runs out of its front.
 */
export function pieceToWorld(piece: Furniture, side: number, front: number): { x: number; z: number } {
  const sin = Math.sin(piece.yaw);
  const cos = Math.cos(piece.yaw);
  return { x: piece.x + side * cos + front * sin, z: piece.z - side * sin + front * cos };
}

/** How far a point on the floor is from a piece's footprint; 0 when it is inside. */
export function distanceToPiece(piece: Furniture, x: number, z: number): number {
  const box = furnitureFootprint(piece);
  const dx = Math.max(box.minX - x, 0, x - box.maxX);
  const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
  return Math.hypot(dx, dz);
}
