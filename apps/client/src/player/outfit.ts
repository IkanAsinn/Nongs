/**
 * Skin, hair and clothes for one body.
 *
 * Clothes and the hair cap are **shells**: the body's own mesh drawn again,
 * pushed out a few millimetres along its normals and cut to the garment's
 * shape. A shell shares the body's skeleton and skin weights, so it fits and
 * moves exactly like the body and never clips through it. The cut is made per
 * pixel from the vertex positions in the bind pose (a T-pose), which gives
 * clean hems on a coarse mesh. Hair that stands away from the head (a
 * ponytail, buns) is ordinary geometry fixed to the head bone.
 *
 * Shell shapes are described in "body metres": X to the body's left, Y up
 * from the floor, Z to the front, measured on the T-pose.
 *
 * The voice switches show on the head: tape over the mouth is a shell too, so
 * it lies on the face, and headphones are a model fixed to the head bone.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AvatarConfig, BottomStyle, HairStyle, ShoeStyle, TopStyle, VoiceSigns } from '@nongs/shared';

/** A box in body metres: distance from the body's centre line, and height. */
interface Rect {
  sideMin: number;
  sideMax: number;
  heightMin: number;
  heightMax: number;
}

/** Heights and widths of the joints on the T-pose, in body metres. */
interface Landmarks {
  ankle: number;
  knee: number;
  crotch: number;
  hips: number;
  neck: number;
  /** Height of the outstretched arms. */
  arm: number;
  shoulder: number;
  elbow: number;
  wrist: number;
}

interface HairShape {
  /** The hairline as an angle above the middle of the head (radians): over the face, and around the sides and back. */
  front: number;
  back: number;
  /** Half the width of the face opening, as an angle from straight ahead. */
  face: number;
  /** How far the fringe dips, and how many locks it has. */
  fringe: number;
  locks: number;
  /** Where the fringe hangs lowest, as an angle from straight ahead. Not 0 for a fringe swept to one side. */
  part: number;
  thickness: number;
}

const HAIR: Record<Exclude<HairStyle, 'none'>, HairShape> = {
  short: { front: 0.42, back: -0.2, face: 1.3, fringe: 0, locks: 0, part: 0, thickness: 0.016 },
  bob: { front: 0.5, back: -0.8, face: 1.0, fringe: 0.3, locks: 5, part: 0, thickness: 0.026 },
  long: { front: 0.5, back: -0.85, face: 1.0, fringe: 0.3, locks: 5, part: 0, thickness: 0.026 },
  ponytail: { front: 0.45, back: -0.3, face: 1.25, fringe: 0.14, locks: 3, part: 0, thickness: 0.02 },
  buns: { front: 0.45, back: -0.3, face: 1.25, fringe: 0.14, locks: 3, part: 0, thickness: 0.02 },
  // Cut close to the head all over.
  buzz: { front: 0.42, back: -0.3, face: 1.32, fringe: 0, locks: 0, part: 0, thickness: 0.004 },
  // One sweep of fringe from a parting on the right down to the left temple.
  sidepart: { front: 0.68, back: -0.22, face: 1.3, fringe: 0.46, locks: 1, part: 0.9, thickness: 0.026 },
  // Short at the sides, with a tuft standing up at the front.
  quiff: { front: 0.52, back: -0.18, face: 1.3, fringe: 0, locks: 0, part: 0, thickness: 0.014 },
  // A head of curls.
  curly: { front: 0.5, back: -0.3, face: 1.2, fringe: 0.12, locks: 7, part: 0, thickness: 0.024 },
};

/**
 * Mouth tape: two strips crossed over the mouth. Lengths are in "head units",
 * where the head's half-width and half-height are 1.
 */
const TAPE = {
  color: 0xc9cbcf,
  /** How far each strip is turned from level, in radians. */
  angle: 0.42,
  halfLength: 0.36,
  halfWidth: 0.085,
  /** How far it stands off the skin, in metres. */
  thickness: 0.005,
};

/** Shells get thinner towards their edge over this distance, so a hem lies on the skin. */
const TAPER = 0.025;
/** Triangles this far outside a shell's shape are still kept, for the cut to trim. */
const KEEP_MARGIN = 0.03;
const NO_RECT: Rect = { sideMin: 1, sideMax: 0, heightMin: 1, heightMax: 0 };
const STRIPE_HEIGHT = 0.045;
const WHITE = new THREE.Color(0xffffff);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const SCRATCH_COLOR = new THREE.Color();
/** How many rectangles a garment's shape is made of at most, and how many garments are worn. */
const RECTS = 3;
const GARMENTS = 3;
/** Skin this far inside a garment is not drawn. */
const HIDE_SKIN_MARGIN = 0.02;
/** How far above the hips shorts and trousers reach, and how far they stand off the skin. */
const WAISTBAND = 0.06;
const BOTTOM_THICKNESS = 0.009;
/** How far the armpits are below the middle of the outstretched arms. */
const ARMPIT = 0.07;

const SHARED_VERTEX = /* glsl */ `
  uniform vec3 uOrigin;
  uniform float uUnits;
  uniform float uInflate;
  uniform vec2 uOver; // below this height the shell stands this much further out
  attribute float headWeight;
  attribute vec3 shellNormal;
  varying vec3 vBody;
  varying float vHead;
`;

const GARMENT_REGION = /* glsl */ `
  uniform vec4 uRects[${RECTS}];
  // How far inside the garment a point is, in metres; negative outside.
  float regionMargin(vec3 body) {
    float side = abs(body.x);
    float margin = -1.0;
    for (int i = 0; i < ${RECTS}; i++) {
      vec4 rect = uRects[i];
      margin = max(margin, min(min(side - rect.x, rect.y - side), min(body.y - rect.z, rect.w - body.y)));
    }
    return margin;
  }
`;

const HAIR_REGION = /* glsl */ `
  uniform vec3 uHead;
  uniform vec3 uHeadSize;
  uniform vec4 uHairline; // front, back, face half-width, fringe depth
  uniform float uLocks;
  uniform float uPart;
  float regionMargin(vec3 body) {
    vec3 direction = normalize((body - uHead) / uHeadSize);
    float up = asin(clamp(direction.y, -1.0, 1.0));
    float around = atan(direction.x, direction.z);
    float behind = smoothstep(uHairline.z - 0.22, uHairline.z + 0.22, abs(around));
    float front = uHairline.x - uHairline.w * (0.5 + 0.5 * cos(around * uLocks - uPart));
    float line = mix(front, uHairline.y, behind);
    return (up - line) * uHeadSize.y;
  }
`;

// Each strip is a rectangle turned about the mouth, with torn ends.
const TAPE_REGION = /* glsl */ `
  uniform vec3 uHead;
  uniform vec3 uHeadSize;
  uniform float uMouth;
  float strip(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    float along = c * p.x + s * p.y;
    float across = -s * p.x + c * p.y;
    float torn = 0.035 * abs(fract(across * 14.0) - 0.5);
    return min(${TAPE.halfLength.toFixed(3)} - torn - abs(along), ${TAPE.halfWidth.toFixed(3)} - abs(across));
  }
  float regionMargin(vec3 body) {
    vec3 p = (body - uHead) / uHeadSize;
    if (p.z < 0.2) return -1.0;
    vec2 q = vec2(p.x, p.y - uMouth);
    return max(strip(q, ${TAPE.angle.toFixed(3)}), strip(q, ${(-TAPE.angle).toFixed(3)})) * uHeadSize.y;
  }
`;

function shellMaterial(region: string, uniforms: Record<string, THREE.IUniform>, key: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SHARED_VERTEX}\n${region}`)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vBody = (position - uOrigin) / uUnits;
        vHead = headWeight;
        float lift = uInflate * clamp(regionMargin(vBody) / ${TAPER.toFixed(3)}, 0.15, 1.0);
        lift += uOver.y * (1.0 - smoothstep(uOver.x, uOver.x + ${TAPER.toFixed(3)}, vBody.y));
        transformed += shellNormal * lift * uUnits;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vBody;
        varying float vHead;
        uniform float uOnHead;
        uniform vec3 uStripe;
        uniform float uStriped;
        uniform vec4 uSleeve; // where the arms begin (distance to the side, height of the armpit), and where the stripes start on the arms and on the body
        ${region}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        /* glsl */ `#include <clipping_planes_fragment>
        // Hair is only on the head and clothes never are. The head is wider than
        // the shoulders, so the shape alone cannot tell a sleeve from an ear.
        if ((vHead > 0.5) != (uOnHead > 0.5)) discard;
        if (regionMargin(vBody) < 0.0) discard;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        // Stripes run around the body, and around the sleeves on the outstretched arms.
        float along = abs(vBody.x) > uSleeve.x && vBody.y > uSleeve.y ? abs(vBody.x) - uSleeve.z : vBody.y - uSleeve.w;
        float band = step(0.5, fract(along / ${(STRIPE_HEIGHT * 2).toFixed(3)}));
        diffuseColor.rgb = mix(diffuseColor.rgb, uStripe, band * uStriped);`,
      );
  };
  material.customProgramCacheKey = () => key;
  return material;
}

/**
 * One normal per place on the body. The mesh is split along the seams of its
 * texture, and a shell pushed out along the split normals would tear there.
 */
function weldedNormals(geometry: THREE.BufferGeometry): Float32Array {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const sums = new Map<string, THREE.Vector3>();
  const keys: string[] = [];
  const normal = new THREE.Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    const key = `${positions.getX(i).toFixed(5)},${positions.getY(i).toFixed(5)},${positions.getZ(i).toFixed(5)}`;
    keys.push(key);
    const sum = sums.get(key) ?? new THREE.Vector3();
    sums.set(key, sum.add(normal.fromBufferAttribute(normals, i)));
  }
  const welded = new Float32Array(positions.count * 3);
  keys.forEach((key, i) => normal.copy(sums.get(key)!).normalize().toArray(welded, i * 3));
  return welded;
}

const insideRect = (rect: Rect, side: number, height: number, margin: number) =>
  side >= rect.sideMin - margin &&
  side <= rect.sideMax + margin &&
  height >= rect.heightMin - margin &&
  height <= rect.heightMax + margin;

function topRects(style: TopStyle, at: Landmarks): Rect[] {
  const hem = at.hips - 0.02;
  const sleeves = (end: number): Rect => ({
    sideMin: at.shoulder - 0.03,
    sideMax: end,
    heightMin: at.arm - 0.2,
    // Not far above the arm: the jaw is beside the shoulders and only partly follows the head.
    heightMax: at.arm + 0.09,
  });
  // The chest stops at the shoulders, where the outstretched arms begin. Below the
  // armpits nothing is in the way, and the hips can be wider than the shoulders.
  // A little above the neck joint, which is no higher than the top of the shoulders.
  const chest = (bottom: number): Rect => ({ sideMin: -1, sideMax: at.shoulder + 0.005, heightMin: bottom, heightMax: at.neck + 0.02 });
  const waist = (bottom: number): Rect => ({ sideMin: -1, sideMax: 1, heightMin: bottom, heightMax: at.arm - ARMPIT });
  switch (style) {
    case 'tank':
      return [chest(hem), waist(hem)];
    case 'tshirt':
      return [chest(hem), waist(hem), sleeves(THREE.MathUtils.lerp(at.shoulder, at.elbow, 0.6))];
    case 'sweater':
      return [chest(hem - 0.02), waist(hem - 0.02), sleeves(at.wrist - 0.005)];
  }
}

function bottomRects(style: BottomStyle, at: Landmarks): Rect[] {
  const hem = style === 'shorts' ? THREE.MathUtils.lerp(at.knee, at.crotch, 0.45) : at.ankle + 0.02;
  // The hands are far above the waist in the T-pose, so no limit to the sides is needed.
  return [{ sideMin: -1, sideMax: 1, heightMin: hem, heightMax: at.hips + WAISTBAND }];
}

function shoeRects(style: Exclude<ShoeStyle, 'none'>, at: Landmarks): Rect[] {
  const top = style === 'sneakers' ? at.ankle + 0.02 : THREE.MathUtils.lerp(at.ankle, at.knee, 0.55);
  return [{ sideMin: -1, sideMax: 1, heightMin: -1, heightMax: top }];
}

interface Garment {
  mesh: THREE.SkinnedMesh;
  material: THREE.MeshStandardMaterial;
  rects: THREE.IUniform<THREE.Vector4[]>;
  inflate: THREE.IUniform<number>;
  stripe: THREE.IUniform<THREE.Color>;
  striped: THREE.IUniform<number>;
  /** What the mesh was last cut for, so it is only rebuilt when the style changes. */
  cutFor: string;
  /** Where this garment's shape starts in the list of what hides the skin. */
  slot: number;
}

export class Outfit {
  private readonly body: THREE.SkinnedMesh;
  /** Vertex positions in body metres, three numbers per vertex. */
  private readonly metres: Float32Array;
  /** How much each vertex follows the head, 0 to 1. */
  private readonly onHead: Float32Array;
  private readonly at: Landmarks;
  private readonly origin = new THREE.Vector3();
  private readonly units: number;
  private readonly headCentre = new THREE.Vector3();
  private readonly headSize = new THREE.Vector3();

  private readonly skinTint = { value: new THREE.Color(1, 1, 1) };
  private readonly skinBase = new THREE.Color();
  private readonly sleeve = new THREE.Vector4();
  /** The shapes of everything worn. The skin well inside them is not drawn, so it cannot poke through. */
  private readonly covered = { value: Array.from({ length: GARMENTS * RECTS }, () => new THREE.Vector4(1, 0, 1, 0)) };
  private readonly top: Garment;
  private readonly bottom: Garment;
  private readonly shoes: Garment;
  private readonly hairCap: THREE.SkinnedMesh;
  private readonly hairMaterial: THREE.MeshStandardMaterial;
  private readonly hairline = { value: new THREE.Vector4() };
  private readonly hairLocks = { value: 0 };
  private readonly hairPart = { value: 0 };
  /** 1 while the body is in the bath: no clothes, and the underwear painted on the body shows. */
  private readonly bare = { value: 0 };
  private shoesWorn = true;
  private readonly hairInflate = { value: 0 };
  /** Loose hair, fixed to the head bone. Its space is body metres from the middle of the head. */
  private readonly hairExtras = new THREE.Group();
  private shownHair: HairStyle | null = null;
  private readonly tape: THREE.SkinnedMesh;
  /** Worn on the head: its space is head units, scaled to this head. */
  private readonly headphones: THREE.Object3D;
  /** Hats and glasses by their name in the model (`hat-cap`, `glasses-round`), all hidden but the ones worn. */
  private readonly accessories = new Map<string, THREE.Object3D>();
  /** The cloth of the hats, a copy per character so each can have its own colour. */
  private readonly hatCloth: THREE.MeshStandardMaterial[] = [];

  /**
   * @param mouth How far below the middle of the head the mouth is painted, as a share of half the head's height.
   * @param headphones The headphones model, made for a head whose half-width, half-height and half-depth are 1.
   */
  constructor(model: THREE.Object3D, height: number, mouth: number, headphones: THREE.Object3D, accessories: THREE.Object3D) {
    let found: THREE.SkinnedMesh | undefined;
    model.traverse((object) => {
      if (!found && object instanceof THREE.SkinnedMesh) found = object;
    });
    if (!found) throw new Error('The body has no skinned mesh');
    const body: THREE.SkinnedMesh = found;
    this.body = body;

    // The body's own material: matt skin instead of the shiny metal it was exported with.
    const skin = body.material as THREE.MeshStandardMaterial;
    skin.metalness = 0;
    skin.roughness = 0.75;

    const geometry = body.geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const positions = geometry.getAttribute('position');
    this.units = (box.max.y - box.min.y) / height;

    // Where each joint is in the bind pose, in the mesh's own space.
    const toMesh = body.bindMatrix.clone().invert();
    const joint = (name: string) => {
      const index = body.skeleton.bones.findIndex((bone) => bone.name.endsWith(name));
      if (index < 0) throw new Error(`The body has no ${name} bone`);
      const bind = body.skeleton.boneInverses[index]!.clone().invert();
      return { index, at: new THREE.Vector3().setFromMatrixPosition(bind).applyMatrix4(toMesh) };
    };
    const hips = joint('Hips');
    this.origin.set(hips.at.x, box.min.y, hips.at.z);
    const metres = (point: THREE.Vector3) => point.clone().sub(this.origin).divideScalar(this.units);
    const of = (name: string) => metres(joint(name).at);
    this.at = {
      ankle: of('LeftFoot').y,
      knee: of('LeftLeg').y,
      crotch: of('LeftUpLeg').y,
      hips: metres(hips.at).y,
      neck: of('Neck').y,
      arm: of('LeftArm').y,
      shoulder: of('LeftArm').x,
      elbow: of('LeftForeArm').x,
      wrist: of('LeftHand').x,
    };

    this.metres = new Float32Array(positions.count * 3);
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i += 1) {
      point.fromBufferAttribute(positions, i).sub(this.origin).divideScalar(this.units).toArray(this.metres, i * 3);
    }

    // The head: every vertex that mostly follows a head bone.
    const headBones = new Set(
      body.skeleton.bones.flatMap((bone, index) => (/Head/.test(bone.name) ? [index] : [])),
    );
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const head = new THREE.Box3();
    this.onHead = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i += 1) {
      let weight = 0;
      for (let k = 0; k < 4; k += 1) {
        if (headBones.has(skinIndex.getComponent(i, k))) weight += skinWeight.getComponent(i, k);
      }
      this.onHead[i] = weight;
      if (weight > 0.5) head.expandByPoint(point.fromArray(this.metres, i * 3));
    }
    geometry.setAttribute('headWeight', new THREE.BufferAttribute(this.onHead, 1));
    geometry.setAttribute('shellNormal', new THREE.BufferAttribute(weldedNormals(geometry), 3));
    head.getCenter(this.headCentre);
    head.getSize(this.headSize).multiplyScalar(0.5);

    this.tintSkin(skin, joint('LeftForeArm').index);

    // Stripes start so that one whole band lies over the shoulders. An edge between
    // two bands there would break up, because the shoulders are nearly level.
    this.sleeve.set(this.at.shoulder, this.at.arm - ARMPIT, this.at.shoulder, this.at.neck + 0.005 - STRIPE_HEIGHT * 1.5);

    // The top hangs over the waistband instead of sinking into it.
    this.top = this.addGarment('top', 0, new THREE.Vector2(this.at.hips + WAISTBAND, BOTTOM_THICKNESS + 0.002));
    this.bottom = this.addGarment('bottom', 1);
    this.shoes = this.addGarment('shoes', 2);

    this.hairMaterial = shellMaterial(
      HAIR_REGION,
      {
        ...this.sharedUniforms(this.hairInflate),
        uHead: { value: this.headCentre },
        uHeadSize: { value: this.headSize },
        uHairline: this.hairline,
        uLocks: this.hairLocks,
        uPart: this.hairPart,
        uOnHead: { value: 1 },
        uStripe: { value: new THREE.Color() },
        uStriped: { value: 0 },
        uSleeve: { value: this.sleeve },
      },
      'shell-hair',
    );
    // Only the head can carry hair, so the cap is cut from the head's triangles once.
    this.hairCap = this.addShell(this.hairMaterial, (vertex) => this.onHead[vertex]! > 0.2);

    const tapeMaterial = shellMaterial(
      TAPE_REGION,
      {
        ...this.sharedUniforms({ value: TAPE.thickness }),
        uHead: { value: this.headCentre },
        uHeadSize: { value: this.headSize },
        uMouth: { value: mouth },
        uOnHead: { value: 1 },
        uStripe: { value: new THREE.Color() },
        uStriped: { value: 0 },
        uSleeve: { value: this.sleeve },
      },
      'shell-tape',
    );
    tapeMaterial.color.set(TAPE.color);
    tapeMaterial.roughness = 0.55;
    // Drawn in front of the skin where the two nearly touch at the tape's edges.
    tapeMaterial.polygonOffset = true;
    tapeMaterial.polygonOffsetFactor = -2;
    tapeMaterial.polygonOffsetUnits = -2;
    const inHead = new THREE.Vector3();
    this.tape = this.addShell(tapeMaterial, (vertex) => {
      if (this.onHead[vertex]! < 0.5) return false;
      inHead.fromArray(this.metres, vertex * 3).sub(this.headCentre).divide(this.headSize);
      return inHead.z > 0.2 && Math.abs(inHead.x) < 0.6 && Math.abs(inHead.y - mouth) < 0.5;
    });
    this.tape.visible = false;

    // Loose hair follows the head bone. This matrix takes body metres from the
    // middle of the head to the bone's own space.
    const headJoint = joint('Head');
    const bone = body.skeleton.bones[headJoint.index]!;
    this.hairExtras.matrixAutoUpdate = false;
    this.hairExtras.matrix
      .copy(body.skeleton.boneInverses[headJoint.index]!)
      .multiply(body.bindMatrix)
      .multiply(new THREE.Matrix4().makeTranslation(this.origin.clone().addScaledVector(this.headCentre, this.units)))
      .multiply(new THREE.Matrix4().makeScale(this.units, this.units, this.units));
    bone.add(this.hairExtras);

    // Headphones sit in the same space as the loose hair, in their own group
    // because the loose hair is rebuilt whenever the style changes.
    const headGear = new THREE.Group();
    headGear.matrixAutoUpdate = false;
    headGear.matrix.copy(this.hairExtras.matrix);
    bone.add(headGear);
    this.headphones = headphones;
    this.headphones.scale.copy(this.headSize);
    this.headphones.visible = false;
    headGear.add(this.headphones);

    // Hats and glasses: the same head units as the headphones.
    for (const piece of [...(accessories.getObjectByName('accessories') ?? accessories).children]) {
      piece.scale.copy(this.headSize);
      piece.visible = false;
      piece.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as THREE.MeshStandardMaterial;
        // Lenses are see-through and must not hide the eyes behind them.
        if (material.transparent) material.depthWrite = false;
        if (material.name === 'Hat Knit' || material.name === 'Cap Cloth') {
          const own = material.clone();
          mesh.material = own;
          this.hatCloth.push(own);
        }
      });
      this.accessories.set(piece.name, piece);
      headGear.add(piece);
    }
  }

  /** Shows the voice switches on the head. */
  showSigns(signs: VoiceSigns): void {
    this.tape.visible = signs.tape;
    this.headphones.visible = signs.headphones;
  }

  /** Shows a look on the body. */
  apply(config: AvatarConfig): void {
    this.skinTint.value.set(config.skin);
    this.skinTint.value.r /= this.skinBase.r;
    this.skinTint.value.g /= this.skinBase.g;
    this.skinTint.value.b /= this.skinBase.b;

    this.wear(this.top, `top-${config.top}`, topRects(config.top, this.at), config.top === 'sweater' ? 0.016 : 0.01, config.topColor);
    this.top.striped.value = config.topPattern === 'stripes' ? 1 : 0;
    // The second stripe is a pale tint of the colour, or a darker shade when the colour is pale itself.
    const stripe = this.top.stripe.value.set(config.topColor);
    const brightness = 0.2126 * stripe.r + 0.7152 * stripe.g + 0.0722 * stripe.b;
    if (brightness > 0.55) stripe.multiplyScalar(0.5);
    else stripe.lerp(WHITE, 0.75);
    this.wear(this.bottom, `bottom-${config.bottom}`, bottomRects(config.bottom, this.at), BOTTOM_THICKNESS, config.bottomColor);
    this.shoesWorn = config.shoes !== 'none';
    this.showClothes();
    if (config.shoes === 'none') this.wear(this.shoes, 'shoes-none', [], 0, config.shoesColor);
    else this.wear(this.shoes, `shoes-${config.shoes}`, shoeRects(config.shoes, this.at), 0.013, config.shoesColor);

    this.hairMaterial.color.set(config.hairColor);
    // Hair cut down to stubble lets the skin show through.
    if (config.hair === 'buzz') this.hairMaterial.color.lerp(SCRATCH_COLOR.set(config.skin), 0.3);
    this.hairCap.visible = config.hair !== 'none';
    if (config.hair !== 'none') {
      const shape = HAIR[config.hair];
      this.hairline.value.set(shape.front, shape.back, shape.face, shape.fringe);
      this.hairLocks.value = shape.locks;
      this.hairPart.value = shape.part;
      this.hairInflate.value = shape.thickness;
    }
    if (config.hair !== this.shownHair) {
      this.shownHair = config.hair;
      this.buildLooseHair(config.hair);
    }

    for (const [name, piece] of this.accessories) {
      piece.visible = name === `hat-${config.hat}` || name === `glasses-${config.glasses}`;
    }
    for (const cloth of this.hatCloth) cloth.color.set(config.hatColor);
    // Buns sit on top of the head, where a hat goes; a ponytail hangs below it and stays.
    this.hairExtras.visible = !(config.hat !== 'none' && config.hair === 'buns');
  }

  /** Takes the clothes off for a bath, or puts them back on. The hair stays. */
  setBare(bare: boolean): void {
    if ((this.bare.value === 1) === bare) return;
    this.bare.value = bare ? 1 : 0;
    this.showClothes();
  }

  private showClothes(): void {
    const dressed = this.bare.value === 0;
    this.top.mesh.visible = dressed;
    this.bottom.mesh.visible = dressed;
    this.shoes.mesh.visible = dressed && this.shoesWorn;
  }

  /**
   * Recolours the skin without touching the eyes and mouth painted on the same
   * texture, and paints over the underwear.
   */
  private tintSkin(skin: THREE.MeshStandardMaterial, forearmBone: number): void {
    this.skinBase.copy(this.sampleSkin(skin, forearmBone));
    const uniforms = {
      uSkinTint: this.skinTint,
      uSkinBase: { value: this.skinBase },
      uBare: this.bare,
      uCovered: this.covered,
      uOrigin: { value: this.origin },
      uUnits: { value: this.units },
    };
    const count = GARMENTS * RECTS;
    skin.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform vec3 uOrigin;
          uniform float uUnits;
          attribute float headWeight;
          varying float vHead;
          varying vec3 vBody;`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          vHead = headWeight;
          vBody = (position - uOrigin) / uUnits;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform vec3 uSkinTint;
          uniform vec3 uSkinBase;
          uniform float uBare;
          uniform vec4 uCovered[${count}];
          varying float vHead;
          varying vec3 vBody;`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          /* glsl */ `#include <clipping_planes_fragment>
          // Skin well inside the clothes is left out, so it cannot poke through them.
          if (vHead < 0.3 && uBare < 0.5) {
            float side = abs(vBody.x);
            for (int i = 0; i < ${count}; i++) {
              vec4 rect = uCovered[i];
              float inside = min(min(side - rect.x, rect.y - side), min(vBody.y - rect.z, rect.w - vBody.y));
              if (inside > ${HIDE_SKIN_MARGIN.toFixed(3)}) discard;
            }
          }`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
          // Skin is the warm part of the texture: more red than blue. The eyes are not, and
          // keep their colour. Below the head only the painted underwear is not, and it
          // becomes plain skin so that it never shows at the edge of the clothes.
          float warmth = (diffuseColor.r - diffuseColor.b) / max(diffuseColor.r, 0.001);
          // In the bath the underwear is what the body wears, so there it is left as painted.
          float onBody = (1.0 - smoothstep(0.3, 0.7, vHead)) * (1.0 - uBare);
          // The underwear is a faintly warm grey, so the line is drawn higher below the head.
          float isSkin = smoothstep(mix(0.02, 0.25, onBody), mix(0.1, 0.42, onBody), warmth);
          vec3 painted = mix(diffuseColor.rgb, uSkinBase, onBody * (1.0 - isSkin));
          diffuseColor.rgb = mix(painted, painted * uSkinTint, max(isSkin, onBody));`,
        );
    };
    skin.customProgramCacheKey = () => 'body-skin';
    skin.needsUpdate = true;
  }

  /** The skin colour the texture was painted with, read from the forearm. */
  private sampleSkin(skin: THREE.MeshStandardMaterial, forearmBone: number): THREE.Color {
    const fallback = new THREE.Color(0xf6cfb4);
    const image = skin.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
    const uv = this.body.geometry.getAttribute('uv');
    if (!image || !uv) return fallback;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return fallback;
    context.drawImage(image, 0, 0);

    const skinIndex = this.body.geometry.getAttribute('skinIndex');
    const skinWeight = this.body.geometry.getAttribute('skinWeight');
    const total = new THREE.Color(0, 0, 0);
    const pixel = new THREE.Color();
    let count = 0;
    for (let i = 0; i < uv.count && count < 60; i += 1) {
      if (skinIndex.getComponent(i, 0) !== forearmBone || skinWeight.getComponent(i, 0) < 0.9) continue;
      const x = Math.min(image.width - 1, Math.max(0, Math.floor(uv.getX(i) * image.width)));
      const y = Math.min(image.height - 1, Math.max(0, Math.floor(uv.getY(i) * image.height)));
      const [r, g, b] = context.getImageData(x, y, 1, 1).data;
      total.add(pixel.setRGB(r! / 255, g! / 255, b! / 255, THREE.SRGBColorSpace));
      count += 1;
    }
    return count > 0 ? total.multiplyScalar(1 / count) : fallback;
  }

  private sharedUniforms(inflate: THREE.IUniform<number>, over = new THREE.Vector2()): Record<string, THREE.IUniform> {
    return { uOrigin: { value: this.origin }, uUnits: { value: this.units }, uInflate: inflate, uOver: { value: over } };
  }

  private addGarment(name: string, order: number, over?: THREE.Vector2): Garment {
    const rects = { value: Array.from({ length: RECTS }, () => new THREE.Vector4()) };
    const inflate = { value: 0 };
    const stripe = { value: new THREE.Color() };
    const striped = { value: 0 };
    const material = shellMaterial(
      GARMENT_REGION,
      {
        ...this.sharedUniforms(inflate, over),
        uRects: rects,
        uOnHead: { value: 0 },
        uStripe: stripe,
        uStriped: striped,
        uSleeve: { value: this.sleeve },
      },
      'shell-garment',
    );
    const mesh = this.addShell(material, () => false);
    mesh.name = name;
    return { mesh, material, rects, inflate, stripe, striped, cutFor: '', slot: order * RECTS };
  }

  /** A copy of the body mesh that keeps only the triangles `keep` accepts for one of their corners. */
  private addShell(material: THREE.Material, keep: (vertex: number) => boolean): THREE.SkinnedMesh {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(this.body.geometry.attributes)) geometry.setAttribute(name, attribute);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.position.copy(this.body.position);
    mesh.quaternion.copy(this.body.quaternion);
    mesh.scale.copy(this.body.scale);
    this.body.parent!.add(mesh);
    mesh.bind(this.body.skeleton, this.body.bindMatrix);
    this.cut(mesh, keep);
    return mesh;
  }

  private cut(mesh: THREE.SkinnedMesh, keep: (vertex: number) => boolean): void {
    const source = this.body.geometry.index;
    const count = source ? source.count : this.metres.length / 3;
    const corner = (i: number) => (source ? source.getX(i) : i);
    const kept: number[] = [];
    for (let i = 0; i < count; i += 3) {
      const a = corner(i);
      const b = corner(i + 1);
      const c = corner(i + 2);
      if (keep(a) || keep(b) || keep(c)) kept.push(a, b, c);
    }
    mesh.geometry.setIndex(kept);
  }

  private wear(garment: Garment, key: string, rects: Rect[], inflate: number, color: string): void {
    garment.material.color.set(color);
    garment.inflate.value = inflate;
    if (garment.cutFor === key) return;
    garment.cutFor = key;
    garment.rects.value.forEach((uniform, i) => {
      const rect = rects[i] ?? NO_RECT;
      uniform.set(rect.sideMin, rect.sideMax, rect.heightMin, rect.heightMax);
      this.covered.value[garment.slot + i]!.copy(uniform);
    });
    this.cut(garment.mesh, (vertex) => {
      if (this.onHead[vertex]! > 0.8) return false;
      const side = Math.abs(this.metres[vertex * 3]!);
      const height = this.metres[vertex * 3 + 1]!;
      return rects.some((rect) => insideRect(rect, side, height, KEEP_MARGIN));
    });
  }

  /** Builds the hair that stands away from the head, for styles that have any. */
  private buildLooseHair(style: HairStyle): void {
    for (const child of [...this.hairExtras.children]) {
      this.hairExtras.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    const size = this.headSize;
    const blobs: THREE.BufferGeometry[] = [];
    const place = new THREE.Matrix4();
    const turn = new THREE.Quaternion();
    const blob = (radius: THREE.Vector3Tuple, at: THREE.Vector3Tuple, tilt = 0, detail = 20) => {
      turn.setFromAxisAngle(X_AXIS, tilt);
      place.compose(new THREE.Vector3(...at), turn, new THREE.Vector3(...radius));
      blobs.push(new THREE.SphereGeometry(1, detail, Math.round(detail * 0.7)).applyMatrix4(place));
    };
    if (style === 'long') {
      // A fall of hair behind the neck, down to the shoulder blades.
      blob([size.x * 0.92, size.y * 0.95, size.z * 0.5], [0, -size.y * 0.75, -size.z * 0.62], -0.12);
    } else if (style === 'ponytail') {
      blob([size.x * 0.2, size.y * 0.2, size.z * 0.2], [0, size.y * 0.35, -size.z * 1.05]);
      blob([size.x * 0.26, size.y * 0.6, size.z * 0.26], [0, -size.y * 0.2, -size.z * 1.22], 0.25);
    } else if (style === 'buns') {
      for (const side of [-1, 1]) {
        blob([size.x * 0.3, size.x * 0.3, size.x * 0.3], [side * size.x * 0.6, size.y * 0.88, -size.z * 0.1]);
      }
    } else if (style === 'quiff') {
      // The tuft leans back from the hairline, and a lower mound carries it over the crown.
      blob([size.x * 0.6, size.y * 0.26, size.z * 0.45], [0, size.y * 0.72, size.z * 0.5], -0.6);
      blob([size.x * 0.62, size.y * 0.2, size.z * 0.6], [0, size.y * 0.85, -size.z * 0.05]);
    } else if (style === 'curly') {
      // Curls all over the top and back of the head, spread evenly and left off the face.
      const count = 46;
      for (let i = 0; i < count; i += 1) {
        const up = 1 - (i + 0.5) / count * 1.25;
        const around = i * 2.399963;
        const flat = Math.sqrt(Math.max(0, 1 - up * up));
        const x = Math.sin(around) * flat;
        const z = Math.cos(around) * flat;
        // Lower on the head only at the back and sides.
        if (up < 0.42 && z > -0.1) continue;
        const radius = size.x * (0.23 + 0.05 * Math.sin(i * 1.7));
        blob([radius, radius, radius], [x * size.x * 0.98, up * size.y * 0.98, z * size.z * 0.98], 0, 10);
      }
    }
    if (blobs.length === 0) return;
    this.hairExtras.add(new THREE.Mesh(mergeGeometries(blobs), this.looseMaterial));
    for (const each of blobs) each.dispose();
  }

  /** Loose hair uses a plain material that follows the cap's colour. */
  private get looseMaterial(): THREE.MeshStandardMaterial {
    if (!this.loose) {
      this.loose = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
      this.loose.color = this.hairMaterial.color;
    }
    return this.loose;
  }
  private loose: THREE.MeshStandardMaterial | null = null;
}
