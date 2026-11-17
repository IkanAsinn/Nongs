/**
 * The cooking minigame, seen in first person. The cook works at a counter and
 * then at the stove, one recipe step at a time. Each step is a mouse gesture
 * (chop, circle, drag, shake, flip) on the cooking kit modelled in Blender
 * (tools/blender/build_kitchen_kit.py). Steps on the stove are timed by the
 * shared rules: too slow and the food burns, and the cook has to start over.
 *
 * The mouse stays captured. Its movement drives a hand cursor on the screen
 * instead of the camera, and the left button does the gestures.
 */
import { mixer } from '../audio/mixer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  FURNITURE_MODELS,
  closeness,
  heatAt,
  isTimed,
  pieceToWorld,
  stars,
  stepCount,
  type CookStep,
  type Furniture,
  type PanFood,
  type Place,
  type Recipe,
} from '@nongs/shared';
import { stationAt, type Station } from './game';

const kitUrls = import.meta.glob('../../../../assets/converted/cooking_kit.glb', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The kit's models by name (kit_board, kit_knife, …). Copies are taken from these. */
export type Kit = ReadonlyMap<string, THREE.Object3D>;

export async function loadKit(): Promise<Kit> {
  const url = Object.values(kitUrls)[0];
  if (!url) throw new Error('Missing asset: cooking_kit.glb (run tools/blender/build_kitchen_kit.py in Blender)');
  const gltf = await new GLTFLoader().loadAsync(url);
  const kit = new Map<string, THREE.Object3D>();
  for (const child of gltf.scene.children) {
    child.position.set(0, 0, 0);
    kit.set(child.name, child);
  }
  return kit;
}

/** The game's side of cooking: where the body stands, and what happens at the end. */
export interface Cook {
  stand(station: Station): void;
  served(recipe: Recipe, rating: 1 | 2 | 3): void;
  spoiled(): void;
  stopped(): void;
}

/** The mouse this frame: movement in pixels and the left button. */
export interface Pointer {
  dx: number;
  dy: number;
  held: boolean;
  pressed: boolean;
  released: boolean;
}

/** The parts of the page the minigame draws on. */
export interface CookingHud {
  root: HTMLElement;
  name: HTMLElement;
  steps: HTMLOListElement;
  hint: HTMLElement;
  hintText: HTMLElement;
  gesture: HTMLElement;
  heat: HTMLElement;
  heatFill: HTMLElement;
  heatReady: HTMLElement;
  heatText: HTMLElement;
  banner: HTMLElement;
  cursor: HTMLElement;
  path: SVGPathElement;
}

// ---- numbers that shape the feel ----
/** Where the camera looks from, against the place the body stands: back a little and above the head. */
const EYE_BACK = 0.12;
const EYE_HEIGHT = 1.62;
const CAMERA_EASE = 5;
/** How far a dragged thing is lifted, and how near its target it must be dropped (metres). */
const LIFT = 0.13;
const DROP_REACH = 0.24;
const GRAB_REACH: Record<Place, number> = { board: 0.24, bowl: 0.17, rice: 0.13, vessel: 0.22, plate: 0.2 };
/** Chop: a full push of the knife is this share of the screen's height. */
const CHOP_PUSH = 0.09;
/** Circle: stirring counts within this distance of the middle of the bowl or pan. */
const CIRCLE_REACH = 0.26;
/** Shake: a swing this wide (share of the screen's height) counts as one shake. */
const SHAKE_SWING = 0.03;
/** Flip: an upward flick of this much of the screen's height within FLICK_TIME seconds. */
const FLICK = 0.11;
const FLICK_TIME = 0.28;
/** Seconds a content takes to look fully cooked on the heat. */
const COOK_LOOK_SECONDS = 5;
/** From this share of the burn time on, the food darkens and smokes. */
const SMOKE_FROM = 0.6;
const BANNER_SECONDS = 2.4;
/** The hint's middle stays right of the recipe card (16 + 250 px wide) and half its own width. */
const HINT_LEFT = 16 + 250 + 16 + 180;

/**
 * Where things stand around the cook, as (to the body's left, away from the body) in metres
 * from the working spot. At the stove the board and bowl sit on the counter to the left,
 * the plate and rice on the counter to the right.
 */
type Spot = 'board' | 'bowl' | 'rice' | 'plate' | 'salt' | 'soy';
const LAYOUT: Record<'board' | 'stove', Record<Spot, [number, number]>> = {
  board: { board: [0, 0], bowl: [0.43, 0.06], plate: [-0.45, 0.02], rice: [0.4, 0.3], salt: [-0.3, 0.26], soy: [-0.4, 0.3] },
  stove: { board: [0.64, 0.02], bowl: [0.6, 0.32], plate: [-0.62, 0.02], rice: [-0.6, 0.32], salt: [-0.34, 0.3], soy: [-0.42, 0.33] },
};

const RAW_TO_COOKED: Record<PanFood, [number, number] | null> = {
  scramble: [0xf7dc6a, 0xf0bf3e],
  rice_pile: [0xfaf6ea, 0xe3b462],
  pancake: [0xf6e3b0, 0xd08f45],
  steak: [0xc24a4a, 0x7a4a33],
  omelette: [0xf9e08a, 0xeebb45],
  soup: [0xe0663f, 0xc9502c],
  veg: null,
};
const BURNT = new THREE.Color(0x231a16);
const FILL_COLOR = { egg: 0xf3c445, batter: 0xf3dfae } as const;
/** Height of the food above the bottom of each vessel. */
const FOOD_LIFT = { pan: 0.012, pot: 0.015, bowl: 0.03 } as const;
const SOUP_LEVEL = 0.1;
const LONG_ITEMS = new Set(['carrot', 'cucumber', 'scallion']);
const DISH: Record<Recipe['id'], string> = {
  fried_rice: 'kit_dish_fried_rice',
  pancakes: 'kit_dish_pancakes',
  steak: 'kit_dish_steak',
  omelette: 'kit_dish_omelette',
  soup: 'kit_dish_soup',
  salad: 'kit_dish_salad',
};
const SLICE: Record<string, string> = {
  carrot: 'kit_carrot_slice',
  tomato: 'kit_tomato_slice',
  cucumber: 'kit_cucumber_slice',
  scallion: 'kit_scallion_slice',
  lettuce: 'kit_lettuce_piece',
  mushroom: 'kit_mushroom_slice',
};

/** Little pictures for the hints: a mouse with its left button held, and the motion to make. */
const MOUSE = `<svg class="g-mouse" viewBox="0 0 24 34"><rect x="1.5" y="1.5" width="21" height="31" rx="10.5"/><path class="g-button" d="M12 1.5v12H1.5V12A10.5 10.5 0 0 1 12 1.5z"/><line x1="12" y1="1.5" x2="12" y2="13.5"/></svg>`;
const MOTION: Record<CookStep['gesture'], string> = {
  chop: `<svg class="g-motion g-chop" viewBox="0 0 40 40"><path d="M20 4v26m-9-9 9 9 9-9"/></svg>`,
  circle: `<svg class="g-motion g-circle" viewBox="0 0 40 40"><path d="M33 20a13 13 0 1 1-4-9.4"/><path d="M30 4v7h-7"/></svg>`,
  drag: `<svg class="g-motion g-drag" viewBox="0 0 40 40"><path d="M5 30 33 10m-9 0h9v9"/></svg>`,
  shake: `<svg class="g-motion g-shake" viewBox="0 0 40 40"><path d="M4 20h32M10 14l-6 6 6 6M30 14l6 6-6 6"/></svg>`,
  flip: `<svg class="g-motion g-flip" viewBox="0 0 40 40"><path d="M20 36V6m-9 9 9-9 9 9"/></svg>`,
};
const GESTURE_HELP: Record<CookStep['gesture'], string> = {
  chop: 'Hold the left button and push the mouse down to cut',
  circle: 'Hold the left button and draw circles',
  drag: 'Hold the left button on it, carry it over, let go',
  shake: 'Hold the left button and shake the mouse left and right',
  flip: 'Hold the left button and flick the mouse up',
};

/** Small sounds made on the spot, so nothing has to be downloaded. */
class Sounds {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private sizzle: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

  private get audio(): AudioContext | null {
    if (!this.context) {
      try {
        const audio = mixer.audio;
        if (!audio) return null;
        this.context = audio;
        const buffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
        this.noise = buffer;
      } catch {
        return null;
      }
    }
    return this.context;
  }

  private burst(seconds: number, frequency: number, volume: number, type: BiquadFilterType = 'bandpass'): void {
    const audio = this.audio;
    if (!audio || !this.noise) return;
    const source = audio.createBufferSource();
    source.buffer = this.noise;
    const filter = audio.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + seconds);
    source.connect(filter).connect(gain).connect(mixer.effects!);
    source.start();
    source.stop(audio.currentTime + seconds);
  }

  private tone(frequencies: number[], seconds: number, volume: number, type: OscillatorType = 'sine'): void {
    const audio = this.audio;
    if (!audio) return;
    frequencies.forEach((frequency, i) => {
      const at = audio.currentTime + i * seconds * 0.6;
      const oscillator = audio.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      oscillator.connect(gain).connect(mixer.effects!);
      oscillator.start(at);
      oscillator.stop(at + seconds);
    });
  }

  chop = () => this.burst(0.07, 1800, 0.5);
  shake = () => this.burst(0.06, 6000, 0.12, 'highpass');
  whoosh = () => this.burst(0.18, 900, 0.18);
  step = () => this.tone([880], 0.12, 0.08);
  served = () => this.tone([660, 880, 1320], 0.22, 0.12, 'triangle');
  burnt = () => this.tone([300, 220], 0.35, 0.12, 'square');
  early = () => this.tone([240], 0.12, 0.08, 'square');

  /** A steady sizzle while something is on the heat: 0 is silent. */
  setSizzle(level: number): void {
    if (level <= 0 && !this.sizzle) return;
    const audio = this.audio;
    if (!audio || !this.noise) return;
    if (!this.sizzle) {
      const source = audio.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = audio.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 3500;
      const gain = audio.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(mixer.effects!);
      source.start();
      this.sizzle = { source, gain };
    }
    this.sizzle.gain.gain.setTargetAtTime(Math.min(level, 1) * 0.07, audio.currentTime, 0.1);
  }
}

/** Food in the pan or pot, with its materials so it can be tinted as it cooks. */
interface Content {
  object: THREE.Object3D;
  materials: { material: THREE.MeshStandardMaterial; raw: THREE.Color; cooked: THREE.Color }[];
  /** Seconds on the heat. */
  heat: number;
}

/** A soft round puff for smoke and steam. */
function puffTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  grow: number;
}

/**
 * The place to work at a worktop, always at its front: across from the point
 * nearest (x, z) along the front edge, kept clear of the ends.
 */
function inFront(piece: Furniture, x: number, z: number): Station {
  const model = FURNITURE_MODELS[piece.model];
  const along = (x - piece.x) * Math.cos(piece.yaw) - (z - piece.z) * Math.sin(piece.yaw);
  const margin = Math.max(0, model.width / 2 - 0.3);
  const front = pieceToWorld(piece, THREE.MathUtils.clamp(along, -margin, margin), model.depth / 2 + 0.4);
  return stationAt(piece, front.x, front.z);
}

/** Makes a copy of a kit model whose materials can be changed without touching the others. */
function own(object: THREE.Object3D): THREE.Object3D {
  const copy = object.clone();
  copy.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = Array.isArray(child.material)
        ? child.material.map((m: THREE.Material) => m.clone())
        : (child.material as THREE.Material).clone();
    }
  });
  return copy;
}

function materialsOf(object: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const found: THREE.MeshStandardMaterial[] = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
      if (m instanceof THREE.MeshStandardMaterial) found.push(m);
    }
  });
  return found;
}

export class Kitchen {
  /** True while the cook is busy with a recipe, including the closing moment. */
  get active(): boolean {
    return this.recipe !== null;
  }

  private readonly root = new THREE.Group();
  private readonly sounds = new Sounds();
  private cook: Cook | null = null;
  private recipe: Recipe | null = null;
  private index = 0;
  private seconds = 0;
  private done = 0;
  private closenesses: number[] = [];
  private ending: { kind: 'served' | 'burnt'; seconds: number; rating: 1 | 2 | 3 } | null = null;
  private message: { text: string; seconds: number } | null = null;

  private stations!: Record<'board' | 'stove', Station>;
  private at: 'board' | 'stove' = 'board';

  // The kit on the worktops.
  private readonly things = new Map<Spot | 'vessel', THREE.Object3D>();
  private readonly home = new Map<THREE.Object3D, THREE.Vector3>();
  private knife!: THREE.Object3D;
  private whisk!: THREE.Object3D;
  private stirrer!: THREE.Object3D;
  private bowlFill!: THREE.Object3D;
  private item: THREE.Object3D | null = null;
  private itemName = '';
  /** The cut pieces on the board, and the steak before it goes in the pan. */
  private readonly onBoard = new THREE.Group();
  /** What is in the bowl besides the mix: salad pieces. */
  private readonly inBowl = new THREE.Group();
  private readonly contents = new Map<PanFood, Content>();
  private readonly inVessel = new THREE.Group();
  /** Cut pieces in the pan or pot: they blacken with the rest when it burns. */
  private scorchable: { material: THREE.MeshStandardMaterial; raw: THREE.Color }[] = [];
  private itemSize = new THREE.Vector3();
  private dish: THREE.Object3D | null = null;
  private vesselKind: 'pan' | 'pot' | 'bowl' = 'pan';

  // Gesture state.
  private readonly cursor = { x: 0, y: 0 };
  private readonly hit = new THREE.Vector3();
  private hitValid = false;
  private knifeLift = 1;
  /** True from pressing the button over the board until it is let go. */
  private chopping = false;
  private knifeArmed = true;
  private circleAngle: number | null = null;
  private circleTravel = 0;
  private carrying: { place: Place; object: THREE.Object3D } | null = null;
  private shakeDirection = 0;
  private shakeTravel = 0;
  private flicks: { t: number; y: number }[] = [];
  private flickY = 0;
  private flipping = 0;
  private time = 0;

  // Camera.
  private readonly eye = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly wantedEye = new THREE.Vector3();
  private readonly wantedLook = new THREE.Vector3();

  // Smoke, steam and seasoning.
  private readonly particles: Particle[] = [];
  private readonly puff = puffTexture();
  private smokeDebt = 0;

  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly scratch = new THREE.Vector3();
  private readonly scratch2 = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly kit: Kit,
    private readonly hud: CookingHud,
  ) {
    this.root.visible = false;
    scene.add(this.root);
  }

  private model(name: string): THREE.Object3D {
    const found = this.kit.get(name);
    if (!found) throw new Error(`cooking_kit.glb has no ${name}`);
    return found.clone();
  }

  /**
   * Starts a recipe. The cook begins at the counter where they stand; the
   * stove steps happen at the given stove.
   */
  start(cook: Cook, recipe: Recipe, counter: Furniture, stove: Furniture | null, x: number, z: number, camera: THREE.Camera): void {
    this.cook = cook;
    this.recipe = recipe;
    this.index = 0;
    this.done = 0;
    this.closenesses = [];
    this.ending = null;
    this.message = null;
    const board = inFront(counter, x, z);
    this.stations = { board, stove: stove ? inFront(stove, stove.x, stove.z) : board };
    this.vesselKind = recipe.vessel;
    this.build(recipe);
    this.at = recipe.steps[0]!.at;
    this.arrange(true);
    this.cook.stand(this.stations[this.at]);
    this.eye.copy(camera.position);
    camera.getWorldDirection(this.look).add(camera.position);
    this.cursor.x = window.innerWidth / 2;
    this.cursor.y = window.innerHeight * 0.55;
    this.root.visible = true;
    this.hud.root.hidden = false;
    this.hud.name.textContent = recipe.name;
    this.hud.steps.replaceChildren(
      ...recipe.steps.map((step) => {
        const li = document.createElement('li');
        li.textContent = step.text;
        return li;
      }),
    );
    this.beginStep();
  }

  /** Q: stop cooking. The ingredients are lost. */
  quit(): void {
    if (!this.recipe || this.ending) return;
    const cook = this.cook;
    this.finish();
    cook?.stopped();
  }

  /** The line the prompt shows while cooking. */
  get prompt(): string {
    return this.ending ? '' : 'Q — stop cooking (the ingredients are lost)';
  }

  // ---- setting the scene ----
  private build(recipe: Recipe): void {
    this.root.clear();
    this.things.clear();
    this.home.clear();
    this.contents.clear();
    this.onBoard.clear();
    this.inBowl.clear();
    this.inVessel.clear();
    this.particles.length = 0;
    this.scorchable = [];
    this.item = null;
    this.dish = null;

    const add = (spot: Spot | 'vessel', object: THREE.Object3D) => {
      this.things.set(spot, object);
      this.root.add(object);
    };
    const board = this.model('kit_board');
    board.add(this.onBoard);
    this.onBoard.position.y = 0.027;
    add('board', board);

    const bowl = this.model('kit_bowl');
    this.bowlFill = own(this.model('kit_bowl_fill'));
    this.bowlFill.visible = false;
    bowl.add(this.bowlFill, this.inBowl);
    this.inBowl.position.y = 0.04;
    add('bowl', bowl);

    add('plate', this.model('kit_plate'));
    add('salt', this.model('kit_shaker'));
    add('soy', this.model('kit_soy'));
    if (recipe.steps.some((step) => step.from === 'rice')) add('rice', this.model('kit_rice'));

    if (recipe.vessel !== 'bowl') {
      const vessel = this.model(recipe.vessel === 'pot' ? 'kit_pot' : 'kit_pan');
      vessel.add(this.inVessel);
      this.inVessel.position.y = FOOD_LIFT[recipe.vessel];
      add('vessel', vessel);
    }
    if (recipe.onBoard === 'steak') this.onBoard.add(this.model('kit_steak'));

    this.knife = this.model('kit_knife');
    this.whisk = this.model('kit_whisk');
    this.stirrer = this.model(recipe.vessel === 'pot' ? 'kit_spoon' : 'kit_spatula');
    for (const tool of [this.knife, this.whisk, this.stirrer]) {
      tool.visible = false;
      this.root.add(tool);
    }
  }

  /** A point on the worktop beside a station: `side` to the body's left, `depth` away from it. */
  private spot(station: Station, side: number, depth: number, target = new THREE.Vector3()): THREE.Vector3 {
    const left = Math.cos(station.facing);
    const leftZ = -Math.sin(station.facing);
    return target.set(
      station.top.x + left * side + Math.sin(station.facing) * depth,
      station.top.y,
      station.top.z + leftZ * side + Math.cos(station.facing) * depth,
    );
  }

  /** Puts everything where it belongs for the station the cook is at. */
  private arrange(instant: boolean): void {
    const station = this.stations[this.at];
    for (const [name, object] of this.things) {
      const target =
        name === 'vessel'
          ? this.spot(this.stations.stove, 0, 0.04)
          : this.spot(station, LAYOUT[this.at][name][0], LAYOUT[this.at][name][1]);
      this.home.set(object, target.clone());
      if (instant || !object.parent) object.position.copy(target);
      object.rotation.set(0, station.facing, 0);
    }
    this.wantedLook.copy(station.top).add(this.scratch.set(Math.sin(station.facing), 0, Math.cos(station.facing)).multiplyScalar(0.06));
    this.wantedEye.set(
      station.x - Math.sin(station.facing) * EYE_BACK,
      station.top.y - 1 + EYE_HEIGHT,
      station.z - Math.cos(station.facing) * EYE_BACK,
    );
  }

  private get step(): CookStep | null {
    return this.recipe?.steps[this.index] ?? null;
  }

  private beginStep(): void {
    const step = this.step;
    if (!step) return;
    this.seconds = 0;
    this.done = 0;
    this.circleAngle = null;
    this.circleTravel = 0;
    this.shakeTravel = 0;
    this.shakeDirection = 0;
    this.flicks = [];
    this.knifeLift = 1;
    this.chopping = false;
    this.knifeArmed = true;
    if (step.at !== this.at) {
      this.at = step.at;
      this.arrange(false);
      this.cook?.stand(this.stations[this.at]);
      this.sounds.whoosh();
    }
    if (step.fill) {
      this.bowlFill.visible = true;
      for (const m of materialsOf(this.bowlFill)) m.color.setHex(FILL_COLOR[step.fill]);
    }
    if (step.gesture === 'chop' && step.item) this.layItem(step.item);
    Array.from(this.hud.steps.children).forEach((li, i) => {
      li.classList.toggle('done', i < this.index);
      li.classList.toggle('now', i === this.index);
    });
    this.hud.gesture.innerHTML = MOUSE + MOTION[step.gesture];
    this.hud.gesture.dataset.gesture = step.gesture;
  }

  /** Lays a whole ingredient on the board, pushing what was cut before to the back. */
  private layItem(name: string): void {
    for (const piece of this.onBoard.children) piece.position.z = Math.max(piece.position.z, 0.03) + 0.05;
    this.item = this.model(`kit_${name}`);
    this.itemName = name;
    new THREE.Box3().setFromObject(this.kit.get(`kit_${name}`)!).getSize(this.itemSize);
    this.item.position.set(0.03, 0, -0.02);
    this.onBoard.add(this.item);
  }

  // ---- every frame ----
  update(dt: number, pointer: Pointer, camera: THREE.PerspectiveCamera): void {
    if (!this.recipe) return;
    this.time += dt;
    const step = this.step;

    // The cursor: the mouse moves it instead of the camera.
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.cursor.x = THREE.MathUtils.clamp(this.cursor.x + pointer.dx, 0, width);
    this.cursor.y = THREE.MathUtils.clamp(this.cursor.y + pointer.dy, 0, height);
    this.flickY += pointer.dy;

    // The camera glides to the station and looks down at the work.
    const ease = 1 - Math.exp(-CAMERA_EASE * dt);
    this.eye.lerp(this.wantedEye, ease);
    this.look.lerp(this.wantedLook, ease);
    camera.position.copy(this.eye);
    camera.lookAt(this.look);
    camera.updateMatrixWorld();

    // Where the cursor points on the worktop.
    this.raycaster.setFromCamera(new THREE.Vector2((this.cursor.x / width) * 2 - 1, -(this.cursor.y / height) * 2 + 1), camera);
    this.plane.constant = -this.stations[this.at].top.y;
    this.hitValid = this.raycaster.ray.intersectPlane(this.plane, this.hit) !== null;

    if (this.ending) this.updateEnding(dt);
    else if (step) {
      if (isTimed(step)) {
        this.seconds += dt;
        if (heatAt(step, this.seconds) === 'burnt') this.burn();
      }
      if (!this.ending) this.gesture(step, pointer, height, dt);
    }
    this.animate(dt);
    this.updateHud(camera, width, height);
  }

  private gesture(step: CookStep, pointer: Pointer, height: number, dt: number): void {
    switch (step.gesture) {
      case 'chop': {
        const board = this.things.get('board')!;
        const near = this.hitValid && this.hit.distanceTo(board.position) < GRAB_REACH.board + 0.08;
        // A cut starts with the button pressed over the board and lasts until it is let go,
        // so the downward stroke may carry the cursor off the board.
        if (!pointer.held) this.chopping = false;
        else if (near) this.chopping = true;
        if (this.chopping) this.knifeLift = THREE.MathUtils.clamp(this.knifeLift - pointer.dy / (height * CHOP_PUSH), 0, 1);
        else this.knifeLift = Math.min(1, this.knifeLift + dt * 4);
        if (this.knifeLift > 0.6) this.knifeArmed = true;
        if (this.knifeLift <= 0 && this.knifeArmed) {
          this.knifeArmed = false;
          this.cut(step);
        }
        break;
      }
      case 'circle': {
        const target = step.on === 'vessel' ? this.things.get('vessel')! : this.things.get('bowl')!;
        const dx = this.hit.x - target.position.x;
        const dz = this.hit.z - target.position.z;
        const distance = Math.hypot(dx, dz);
        if (pointer.held && this.hitValid && distance > 0.015 && distance < CIRCLE_REACH) {
          const angle = Math.atan2(dz, dx);
          if (this.circleAngle !== null) {
            const turn = Math.atan2(Math.sin(angle - this.circleAngle), Math.cos(angle - this.circleAngle));
            this.circleTravel += Math.abs(turn);
            const spin = step.on === 'vessel' ? this.inVessel : this.inBowl;
            spin.rotation.y -= turn * 0.6;
            if (step.on === 'bowl') this.bowlFill.rotation.y -= turn * 0.6;
          }
          this.circleAngle = angle;
          const turns = Math.floor(this.circleTravel / (2 * Math.PI));
          if (turns > this.done) {
            this.done = turns;
            this.sounds.step();
            if (this.done >= stepCount(step)) this.complete();
          }
        } else this.circleAngle = null;
        break;
      }
      case 'drag':
        this.drag(step, pointer);
        break;
      case 'shake': {
        const target = this.placeObject(step.on ?? 'vessel');
        const near = this.hitValid && Math.hypot(this.hit.x - target.position.x, this.hit.z - target.position.z) < 0.32;
        if (pointer.held && near && pointer.dx !== 0) {
          const direction = Math.sign(pointer.dx);
          if (direction !== this.shakeDirection) {
            if (this.shakeTravel > SHAKE_SWING * height && this.shakeDirection !== 0) {
              this.done += 1;
              this.sprinkle(target.position, step.seasoning === 'soy' ? 0x3a2219 : 0xffffff);
              this.sounds.shake();
              if (this.done >= stepCount(step) * 2) this.complete();
            }
            this.shakeDirection = direction;
            this.shakeTravel = 0;
          }
          this.shakeTravel += Math.abs(pointer.dx);
        }
        break;
      }
      case 'flip': {
        this.flicks.push({ t: this.time, y: this.flickY });
        while (this.flicks.length > 0 && this.time - this.flicks[0]!.t > FLICK_TIME) this.flicks.shift();
        // Measured from the lowest point in the window, so a dip before the flick does not cancel it.
        const lowest = Math.max(...this.flicks.map((sample) => sample.y));
        if (pointer.held && lowest - this.flickY > FLICK * height) {
          this.flicks = [];
          if (heatAt(step, this.seconds) === 'early') {
            this.say('Not yet! Wait until it browns.');
            this.sounds.early();
          } else {
            this.flipping = 1;
            this.sounds.whoosh();
            for (const content of this.contents.values()) content.heat *= 0.35;
            this.complete();
          }
        }
        break;
      }
    }
  }

  private cut(step: CookStep): void {
    const item = this.item;
    if (!item) return;
    this.done += 1;
    this.sounds.chop();
    const count = stepCount(step);
    const left = this.done / count;
    const long = LONG_ITEMS.has(this.itemName);
    const size = this.itemSize;
    if (long) {
      // The knife works in from the right-hand end (−X); the left end stays put.
      const keep = 1 - 0.85 * left;
      item.scale.x = keep;
      item.position.x = 0.03 + (size.x / 2) * (1 - keep);
    } else item.scale.setScalar(1 - 0.55 * left);
    const pieces = long ? 2 : 3;
    const edge = item.position.x - (size.x / 2) * item.scale.x;
    for (let i = 0; i < pieces; i += 1) {
      const piece = this.model(SLICE[this.itemName]!);
      piece.position.set(edge - 0.03 - Math.random() * 0.07, 0.003 * i, -0.06 + Math.random() * 0.1);
      piece.rotation.y = Math.random() * Math.PI * 2;
      this.onBoard.add(piece);
    }
    if (this.done >= count) {
      this.onBoard.remove(item);
      this.item = null;
      this.complete();
    }
  }

  private placeObject(place: Place): THREE.Object3D {
    if (place === 'vessel') return this.things.get('vessel') ?? this.things.get('bowl')!;
    return this.things.get(place)!;
  }

  private drag(step: CookStep, pointer: Pointer): void {
    const from = step.from!;
    const to = step.to!;
    if (!this.carrying && pointer.pressed && this.hitValid) {
      const object = this.placeObject(from);
      if (this.hit.distanceTo(object.position) < GRAB_REACH[from]) {
        if (heatAt(step, this.seconds) === 'early') {
          this.say(to === 'plate' ? 'Not ready yet — let it cook a little longer.' : 'Not yet!');
          this.sounds.early();
        } else this.carrying = { place: from, object };
      }
    }
    const carrying = this.carrying;
    if (!carrying) return;
    const target = this.placeObject(to);
    const over = this.hitValid && Math.hypot(this.hit.x - target.position.x, this.hit.z - target.position.z) < DROP_REACH;
    if (pointer.released || !pointer.held) {
      this.carrying = null;
      carrying.object.rotation.set(0, this.stations[this.at].facing, 0);
      if (over) {
        this.sounds.whoosh();
        this.pour(step);
        this.complete();
      }
    }
    // The carried thing tips towards the target while it is over it.
    const facing = this.stations[this.at].facing;
    carrying.object.rotation.set(0, facing, 0);
    if (over && this.carrying) {
      const tipX = target.position.x - carrying.object.position.x;
      const tipZ = target.position.z - carrying.object.position.z;
      carrying.object.rotation.set(0, Math.atan2(tipX, tipZ), 0);
      carrying.object.rotateX(0.7);
    }
  }

  /** What a successful drag does: food moves from one thing to the other. */
  private pour(step: CookStep): void {
    const from = step.from!;
    const to = step.to!;
    if (to === 'plate') {
      this.inVessel.clear();
      this.contents.clear();
      this.dish = this.model(DISH[this.recipe!.id]);
      this.dish.scale.setScalar(0.92);
      this.things.get('plate')!.add(this.dish);
      return;
    }
    const into = to === 'bowl' ? this.inBowl : this.inVessel;
    if (from === 'board') {
      const pieces = [...this.onBoard.children];
      const steak = this.recipe?.onBoard === 'steak' && step.puts === 'steak';
      if (!steak) {
        const radius = to === 'bowl' ? 0.08 : this.vesselKind === 'pot' ? 0.1 : 0.11;
        for (const piece of pieces) {
          const angle = Math.random() * Math.PI * 2;
          const r = radius * Math.sqrt(Math.random());
          piece.position.set(Math.cos(angle) * r, Math.random() * 0.02, Math.sin(angle) * r);
          if (step.puts === 'soup') piece.position.y += SOUP_LEVEL - 0.01;
          into.add(piece);
          if (into === this.inVessel) {
            const copy = own(piece);
            into.remove(piece);
            into.add(copy);
            for (const material of materialsOf(copy)) this.scorchable.push({ material, raw: material.color.clone() });
          }
        }
      } else this.onBoard.clear();
    }
    if (from === 'bowl') this.bowlFill.visible = false;
    if (from === 'rice') this.things.get('rice')!.visible = false;
    if (step.puts && step.puts !== 'veg') this.addContent(step.puts);
  }

  private addContent(food: PanFood): void {
    const object = own(this.model(`kit_${food}`));
    if (food === 'soup') object.position.y = SOUP_LEVEL - this.inVessel.position.y;
    const colours = RAW_TO_COOKED[food];
    const list = materialsOf(object);
    // One material takes the raw and cooked colours; several (the steak's meat and fat) are each browned.
    const materials = list.map((material) => {
      const raw = colours && list.length === 1 ? new THREE.Color(colours[0]) : material.color.clone();
      const cooked = colours ? raw.clone().lerp(new THREE.Color(colours[1]), 0.85) : raw.clone().multiplyScalar(0.85);
      material.color.copy(raw);
      return { material, raw, cooked };
    });
    this.inVessel.add(object);
    this.contents.set(food, { object, materials, heat: 0 });
  }

  private complete(): void {
    const step = this.step;
    if (!step || !this.recipe) return;
    if (isTimed(step)) this.closenesses.push(closeness(step, this.seconds));
    this.index += 1;
    this.sounds.step();
    if (this.index >= this.recipe.steps.length) {
      if (this.recipe.vessel === 'bowl') {
        // A salad is served in its bowl: the finished dish takes the bowl's place.
        const bowl = this.things.get('bowl')!;
        bowl.visible = false;
        this.dish = this.model(DISH[this.recipe.id]);
        this.dish.position.copy(bowl.position);
        this.dish.rotation.copy(bowl.rotation);
        this.root.add(this.dish);
      }
      this.ending = { kind: 'served', seconds: BANNER_SECONDS, rating: stars(this.closenesses) };
      this.sounds.served();
      this.sounds.setSizzle(0);
      return;
    }
    this.beginStep();
  }

  private burn(): void {
    this.ending = { kind: 'burnt', seconds: BANNER_SECONDS + 0.6, rating: 1 };
    this.carrying = null;
    this.sounds.burnt();
    this.sounds.setSizzle(0);
  }

  private updateEnding(dt: number): void {
    const ending = this.ending!;
    ending.seconds -= dt;
    if (ending.seconds > 0) return;
    const cook = this.cook;
    const recipe = this.recipe!;
    this.finish();
    if (ending.kind === 'served') cook?.served(recipe, ending.rating);
    else cook?.spoiled();
  }

  private finish(): void {
    this.recipe = null;
    this.cook = null;
    this.ending = null;
    this.carrying = null;
    this.root.visible = false;
    this.root.clear();
    this.hud.root.hidden = true;
    this.sounds.setSizzle(0);
  }

  private say(text: string): void {
    this.message = { text, seconds: 1.6 };
  }

  /**
   * The point at `height` that is under the cursor: where the line from the eye
   * through the cursor crosses that height. A tool held above the worktop goes
   * here, so on screen it stays on the cursor however high it is held.
   */
  private underCursor(height: number): THREE.Vector3 {
    const ray = this.raycaster.ray;
    const point = this.scratch.copy(this.hit).setY(height);
    if (Math.abs(ray.direction.y) > 1e-4) {
      const t = (height - ray.origin.y) / ray.direction.y;
      if (t > 0) point.copy(ray.origin).addScaledVector(ray.direction, t);
    }
    return point;
  }

  // ---- what moves on its own ----
  private animate(dt: number): void {
    const step = this.step;
    const station = this.stations[this.at];
    const ease = 1 - Math.exp(-12 * dt);

    // Things go back home, or follow the cursor while carried.
    for (const [object, home] of this.home) {
      if (this.carrying?.object === object && this.hitValid) {
        object.position.lerp(this.scratch.copy(this.hit).setY(home.y + LIFT), ease);
      } else {
        object.position.lerp(home, ease);
        if (this.carrying?.object !== object) {
          object.rotation.x *= 1 - ease;
          object.rotation.z *= 1 - ease;
        }
      }
    }

    // The tool in hand follows the cursor.
    const gesture = this.ending ? null : step?.gesture;
    this.knife.visible = gesture === 'chop';
    this.whisk.visible = gesture === 'circle' && step?.on === 'bowl';
    this.stirrer.visible = (gesture === 'circle' && step?.on === 'vessel') || gesture === 'flip';
    for (const seasoning of ['salt', 'soy'] as const) {
      const object = this.things.get(seasoning)!;
      const held = gesture === 'shake' && step?.seasoning === seasoning && this.hitValid;
      if (held) {
        object.position.lerp(this.underCursor(station.top.y + 0.26), ease);
        object.rotation.set(0, station.facing, Math.PI * 0.82 + Math.sin(this.time * 30) * (this.shakeTravel > 0 ? 0.1 : 0));
      }
    }
    if (this.hitValid) {
      if (this.knife.visible) {
        // The knife stays under the cursor; pushing the mouse down brings the blade down.
        const surface = this.things.get('board')!.position.y + 0.027;
        const item = this.item;
        const tall = item ? this.itemSize.y * item.scale.y : 0;
        this.knife.position.lerp(this.underCursor(surface + (tall + 0.07) * this.knifeLift), Math.min(1, ease * 2));
        this.knife.rotation.set(0, station.facing, 0);
        this.knife.rotateX(-0.3 * this.knifeLift);
        this.knife.rotateZ(0.5);
      }
      if (this.whisk.visible || this.stirrer.visible) {
        const tool = this.whisk.visible ? this.whisk : this.stirrer;
        const down = step?.gesture === 'circle' && this.circleAngle !== null;
        tool.position.lerp(this.underCursor(station.top.y + (down ? 0.03 : 0.1)), ease);
        tool.rotation.set(0, station.facing, 0);
        tool.rotateX(-0.35);
      }
    }

    // A flip throws the food up and over.
    if (this.flipping > 0) {
      this.flipping = Math.max(0, this.flipping - dt * 2.2);
      const t = 1 - this.flipping;
      for (const content of this.contents.values()) {
        content.object.position.y = Math.sin(Math.PI * t) * 0.16;
        content.object.rotation.x = Math.PI * 2 * t;
      }
    }

    // Food on the heat cooks, darkens near the burn time, and smokes.
    const timed = step && isTimed(step) && !this.ending;
    const danger = this.ending?.kind === 'burnt' ? 1 : timed ? this.seconds / step.burn! : 0;
    const scorch = THREE.MathUtils.clamp((danger - SMOKE_FROM) / (1 - SMOKE_FROM), 0, 1);
    const onHeat = this.at === 'stove' && (timed || this.ending?.kind === 'burnt');
    for (const content of this.contents.values()) {
      if (onHeat) content.heat += dt;
      const cooked = Math.min(content.heat / COOK_LOOK_SECONDS, 1);
      for (const { material, raw, cooked: done } of content.materials) {
        material.color.copy(raw).lerp(done, cooked).lerp(BURNT, scorch * 0.9);
      }
    }
    for (const { material, raw } of this.scorchable) material.color.copy(raw).lerp(BURNT, scorch * 0.9);
    const vessel = this.things.get('vessel');
    if (vessel && onHeat && (this.contents.size > 0 || this.inVessel.children.length > 0)) {
      this.smokeDebt += dt * (2 + scorch * 26);
      while (this.smokeDebt >= 1) {
        this.smokeDebt -= 1;
        this.emit(vessel.position, scorch > 0.05 ? 0x55504c : 0xffffff, scorch > 0.05 ? 0.75 : 0.35);
      }
    }
    this.sounds.setSizzle(onHeat && this.contents.size > 0 ? 0.4 + scorch : 0);

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i]!;
      particle.age += dt;
      const t = particle.age / particle.life;
      if (t >= 1) {
        this.root.remove(particle.sprite);
        this.particles.splice(i, 1);
        continue;
      }
      particle.sprite.position.addScaledVector(particle.velocity, dt);
      particle.sprite.scale.setScalar(0.05 + particle.grow * t);
      (particle.sprite.material as THREE.SpriteMaterial).opacity = (1 - t) * 0.6;
    }

    if (this.message) {
      this.message.seconds -= dt;
      if (this.message.seconds <= 0) this.message = null;
    }
  }

  private emit(at: THREE.Vector3, colour: number, opacity: number): void {
    const material = new THREE.SpriteMaterial({ map: this.puff, color: colour, transparent: true, opacity, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(at.x + (Math.random() - 0.5) * 0.15, at.y + 0.06, at.z + (Math.random() - 0.5) * 0.15);
    this.root.add(sprite);
    this.particles.push({
      sprite,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.05, 0.25 + Math.random() * 0.15, (Math.random() - 0.5) * 0.05),
      age: 0,
      life: 1.2 + Math.random() * 0.6,
      grow: 0.18,
    });
  }

  private sprinkle(at: THREE.Vector3, colour: number): void {
    for (let i = 0; i < 6; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puff, color: colour, transparent: true, depthWrite: false }));
      sprite.position.set(at.x + (Math.random() - 0.5) * 0.08, at.y + 0.2, at.z + (Math.random() - 0.5) * 0.08);
      this.root.add(sprite);
      this.particles.push({
        sprite,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.1, -0.5 - Math.random() * 0.2, (Math.random() - 0.5) * 0.1),
        age: 0,
        life: 0.35,
        grow: -0.03,
      });
    }
  }

  // ---- the page ----
  private screen(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number): { x: number; y: number } {
    const p = this.scratch2.copy(point).project(camera);
    return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
  }

  private updateHud(camera: THREE.Camera, width: number, height: number): void {
    const hud = this.hud;
    const step = this.step;
    hud.cursor.style.transform = `translate(${this.cursor.x}px, ${this.cursor.y}px)`;
    hud.cursor.classList.toggle('pressing', this.carrying !== null || (step?.gesture === 'chop' && this.knifeLift < 1));

    if (this.ending) {
      hud.banner.hidden = false;
      hud.banner.className = this.ending.kind;
      hud.banner.innerHTML =
        this.ending.kind === 'served'
          ? `<b>Served: ${this.recipe!.name}!</b><span class="stars">${'★'.repeat(this.ending.rating)}${'☆'.repeat(3 - this.ending.rating)}</span><small>Q to eat it</small>`
          : `<b>Burnt!</b><small>It was on the heat too long. Get fresh ingredients from the fridge and start over.</small>`;
      hud.hint.hidden = true;
      hud.heat.hidden = true;
      hud.path.parentElement!.style.display = 'none';
      return;
    }
    hud.banner.hidden = true;
    if (!step) return;

    // The hint sits beside the thing to work on.
    const anchorPlace: Place = step.gesture === 'drag' ? step.from! : step.gesture === 'chop' ? 'board' : (step.on ?? 'vessel');
    const anchor = this.screen(this.placeObject(anchorPlace).position, camera, width, height);
    hud.hint.hidden = false;
    const hintX = THREE.MathUtils.clamp(anchor.x, HINT_LEFT, Math.max(HINT_LEFT, width - 190));
    const hintY = Math.max(110, anchor.y - height * 0.2);
    hud.hint.style.transform = `translate(${Math.round(hintX)}px, ${Math.round(hintY)}px)`;
    const count = stepCount(step);
    const progress = step.gesture === 'shake' ? Math.floor(this.done / 2) : this.done;
    const tally = count > 1 ? ` <b>${progress}/${count}</b>` : '';
    hud.hintText.innerHTML = this.message ? `<em>${this.message.text}</em>` : `${step.text}${tally}<small>${GESTURE_HELP[step.gesture]}</small>`;

    // A dotted line shows where to carry things.
    const svg = hud.path.parentElement!;
    if (step.gesture === 'drag') {
      const from = this.screen(this.placeObject(step.from!).position, camera, width, height);
      const to = this.screen(this.placeObject(step.to!).position, camera, width, height);
      const lift = Math.min(120, Math.hypot(to.x - from.x, to.y - from.y) * 0.4);
      hud.path.setAttribute('d', `M${from.x},${from.y} Q${(from.x + to.x) / 2},${Math.min(from.y, to.y) - lift} ${to.x},${to.y}`);
      svg.style.display = '';
    } else svg.style.display = 'none';

    // The heat bar for steps on the stove.
    if (isTimed(step)) {
      const burn = step.burn!;
      const ready = (step.ready ?? 0) / burn;
      const share = Math.min(this.seconds / burn, 1);
      const heat = heatAt(step, this.seconds);
      hud.heat.hidden = false;
      hud.heatFill.style.width = `${share * 100}%`;
      hud.heatReady.style.left = `${ready * 100}%`;
      hud.heatReady.style.width = `${Math.max(0, SMOKE_FROM - ready) * 100}%`;
      hud.heat.dataset.state = heat === 'early' ? 'early' : share > SMOKE_FROM ? 'hurry' : 'ready';
      hud.heatText.textContent = heat === 'early' ? 'Cooking… wait' : share > SMOKE_FROM ? 'Hurry — it is burning!' : step.ready ? 'Now!' : 'On the heat';
    } else hud.heat.hidden = true;
  }
}
