import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  BIRTHDAY_CAKE,
  FURNITURE,
  LOW_STAT,
  POOL,
  RECIPES,
  SPAWN,
  ZONES,
  canHear,
  canSpeak,
  doorBlockedBy,
  doorChoices,
  DEFAULT_AVATAR,
  inPool,
  layoutWith,
  poolFloorAt,
  ridersOf,
  voiceSigns,
  zoneAt,
  type AvatarConfig,
  type Furniture,
  type SavedLayout,
} from '@nongs/shared';
import { mixer } from './audio/mixer';
import { Music } from './audio/music';
import { api } from './net/api';
import { HouseLink, type HouseView } from './net/house';
import { RemotePlayers } from './net/remotes';
import { VoiceChat } from './net/voice';
import { BLOW_SECONDS, BlowListener, Candles } from './game/candles';
import { NameTag } from './player/nameTag';
import { AuthPanel } from './ui/auth';
import { SettingsPanel } from './ui/settings';
import { Kitchen, loadKit, type Cook } from './game/cooking';
import { Decorator } from './game/decorate';
import { Game, type HouseActions, type KitchenLink } from './game/game';
import { GameView, loadLitter } from './game/view';
import { Input } from './input';
import { Avatar, REACTIONS, type AnimationName, type Gender, type Gesture, type Reaction } from './player/avatar';
import { Player } from './player/player';
import { buildHouse, type DoorInstance } from './world/buildHouse';
import { playKnock, playLockClick } from './audio/knock';
import { LoadingScreen } from './ui/loading';
import { ReactionBar } from './ui/reactions';
import { RecipePicker } from './ui/recipes';
import { WardrobePanel } from './ui/wardrobe';
import { buildFurniture, loadFurnitureModels } from './world/furniture';
import { Pictures } from './world/pictures';
import { RoomVisibility, drawZoneAt } from './world/visibility';
import { FurnitureBatches } from './world/batches';

const DOOR_REACH = 1.6;
const MAX_FRAME_TIME = 1 / 20;
/** How high the username floats over the feet, in metres. */
const NAME_HEIGHT = 1.62;
/** How the camera looks at the character in front of the wardrobe. */
const DRESSING_PITCH = -0.08;
/** A tired player yawns once in this many seconds of standing about. */
const YAWN_EVERY = { min: 12, max: 25 };
const SKY = 0xcfe6f5;
/** Haze from this far out, until the sky colour hides everything; the camera sees no further. */
const FOG = { near: 140, far: 470 };
const VIEW_DISTANCE = 480;
/** The sharpest the picture is drawn (1 pixel per screen pixel), and the softest it may drop to on a slow computer. */
const PIXEL_RATIO = { max: 1, min: 0.75, step: 0.125 };
/** Below this many frames a second for a couple of seconds, the picture gets softer; above the second, sharper again. */
const FPS_BAND = { low: 45, high: 57 };
/** How long, in seconds, frame rates are averaged before the resolution changes. */
const RESOLUTION_WINDOW = 2;
/** How long a short message stays in the prompt line, in seconds. */
const NOTICE_SECONDS = 5;
/** A swimmer this close to the side of the pool can climb out there. */
const POOL_SIDE_REACH = 0.6;
/** Where climbing out puts the player: this far from the water's edge. */
const POOL_SIDE_STAND = 0.55;
/** Clothes come off once the water is this deep on the body. */
const SWIMWEAR_DEPTH = 0.4;

/** The nearest point on the poolside to climb out at, for a swimmer close to a side; null out of reach. */
function poolSide(x: number, z: number): { x: number; z: number } | null {
  // The south end has the steps, so there is nothing to climb there.
  const sides = [
    { gap: x - POOL.minX, x: POOL.minX - POOL_SIDE_STAND, z },
    { gap: POOL.maxX - x, x: POOL.maxX + POOL_SIDE_STAND, z },
    { gap: z - POOL.minZ, x, z: POOL.minZ - POOL_SIDE_STAND },
  ];
  const nearest = sides.reduce((best, side) => (side.gap < best.gap ? side : best));
  return nearest.gap < POOL_SIDE_REACH ? { x: nearest.x, z: nearest.z } : null;
}

/** ?birthday in the address makes it this player's birthday, to try the event (development servers only). */
const TEST_BIRTHDAY = new URLSearchParams(location.search).has('birthday');
/** A piece the player just moved is left alone this long while the server takes it in, in ms. */
const PLACE_WAIT_MS = 2000;
const quarterTurns = (yaw: number) => ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;

/** The furniture as the server has it: where the house was built with it, with everyone's moves on top. */
function layoutFrom(state: HouseView): Furniture[] {
  const saved: SavedLayout = {};
  state.layout.forEach((at, id) => {
    saved[id] = { x: at.x, z: at.z, turns: at.turns, y: at.y };
  });
  return layoutWith(FURNITURE, saved);
}

/** Ends the session and starts again at the log in form. */
async function logOut(): Promise<void> {
  await api.logout().catch(() => undefined);
  location.reload();
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

function litterWord(pieces: number): string {
  if (pieces === 0) return 'clean';
  return pieces === 1 ? '1 piece of litter' : `${pieces} pieces of litter`;
}

async function start(): Promise<void> {
  const canvas = element<HTMLCanvasElement>('game');
  const zoneChip = element('zone');
  const viewChip = element('view');
  const fpsChip = element('fps');
  const prompt = element('prompt');
  const energyBar = element('energy');
  const foodBar = element('food');
  const carriedChip = element('carried');
  const birthdayChip = element('birthday');
  const dirtChip = element('dirt');
  const micChip = element('mic');
  const soundChip = element('sound');
  const decorChip = element('decorating');
  const aim = element('aim');
  const help = element('help');
  const shade = element('shade');
  const underwater = element('underwater');
  const startOverlay = element('start');
  const loading = new LoadingScreen();

  loading.step('Waking up the physics', 0.05);
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio, PIXEL_RATIO.max);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  // The far mountains fade into the sky; nothing near the house is touched.
  scene.fog = new THREE.Fog(SKY, FOG.near, FOG.far);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xf0e6d8, 1.9));
  const sun = new THREE.DirectionalLight(0xfff1dc, 0.7);
  sun.position.set(4, 10, 6);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, VIEW_DISTANCE);

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  loading.step('Building the house', 0.15);
  const house = await buildHouse(world);
  scene.add(house.group);
  loading.step('Moving the furniture in', 0.4);
  await loadFurnitureModels([...FURNITURE.map((piece) => piece.model), BIRTHDAY_CAKE.model]);

  // Both bodies load up front so switching is instant.
  loading.step('Waking up the Nongs', 0.6);
  const avatars: Record<Gender, Avatar> = {
    female: await Avatar.load('female'),
    male: await Avatar.load('male'),
  };
  loading.step('Stocking the fridge', 0.85);
  const kit = await loadKit();
  const litterModels = await loadLitter();

  // Everything is in: the player logs in (or is still logged in) before the house is set up.
  loading.loaded();
  const account = (await api.me().catch(() => null)) ?? (await new AuthPanel(element('auth')).ask());
  const firstVisit = account.avatar === null;

  // Into the shared house. Without it there is no game, so a refusal ends here with a message.
  let link: HouseLink;
  try {
    link = await HouseLink.join({ birthday: TEST_BIRTHDAY });
  } catch (error) {
    LoadingScreen.fail(error instanceof Error ? error.message : 'The house could not be reached.');
    return;
  }
  // The furniture as everyone arranged it. Decorating changes these pieces in place.
  // The cake is always there but only shows on a birthday.
  const pieces = layoutFrom(link.state);
  pieces.push({ ...BIRTHDAY_CAKE });
  const furniture = await buildFurniture(world, pieces);
  scene.add(furniture.group);
  // The furniture is drawn in batches, one per material; the pieces themselves stay for moving and picking.
  const batches = new FurnitureBatches(furniture.group);
  scene.add(batches.group);

  const player = new Player(world, SPAWN);
  scene.add(player.root);
  const nameTag = new NameTag(account.username, NAME_HEIGHT);
  scene.add(nameTag.sprite);

  let look: AvatarConfig = account.avatar ?? DEFAULT_AVATAR;
  let gender: Gender = look.gender;
  const wear = (config: AvatarConfig) => {
    look = config;
    avatars.female.wear(config);
    avatars.male.wear(config);
    if (config.gender !== gender || !avatars[gender].root.parent) {
      gender = config.gender;
      player.setAvatar(avatars[gender]);
    }
  };
  wear(look);

  // A short message in the prompt line, for things that went wrong away from the game.
  let notice = '';
  let noticeSeconds = 0;
  const pictures = new Pictures(furniture, pieces);
  pictures.onProblem = (message) => {
    notice = message;
    noticeSeconds = NOTICE_SECONDS;
  };

  const kitchen = new Kitchen(scene, kit, {
    root: element('cook'),
    name: element('cook-name'),
    steps: element<HTMLOListElement>('cook-steps'),
    hint: element('cook-hint'),
    hintText: element('cook-hint-text'),
    gesture: element('cook-gesture'),
    heat: element('cook-heat'),
    heatFill: element('cook-heat-fill'),
    heatReady: element('cook-heat-ready'),
    heatText: element('cook-heat-text'),
    banner: element('cook-banner'),
    cursor: element('cook-cursor'),
    path: document.querySelector<SVGPathElement>('#cook-path path')!,
  });
  // Cooking is seen in first person; the view the player had comes back afterwards.
  let viewBeforeCooking = player.view;
  const stopCookingView = () => {
    player.view = viewBeforeCooking;
    player.pitch = -0.25;
  };
  const cook: Cook = {
    stand: (station) => game.standAt(station, player),
    served: (recipe, rating) => {
      game.served(recipe, rating, player);
      stopCookingView();
    },
    spoiled: () => {
      game.spoiled(player);
      stopCookingView();
    },
    stopped: () => {
      game.stoppedCooking(player);
      stopCookingView();
    },
  };
  const kitchenLink: KitchenLink = {
    get active() {
      return kitchen.active;
    },
    get prompt() {
      return kitchen.prompt;
    },
    begin: (recipe, counter, stove, x, z) => {
      viewBeforeCooking = player.view;
      player.view = 'fpv';
      kitchen.start(cook, recipe, counter, stove, x, z, camera);
    },
    quit: () => kitchen.quit(),
  };
  const houseActions: HouseActions = {
    swept: (id) => link.send('swept', { id }),
    slice: () => link.send('slice', {}),
    ate: (food, recipe, rating) => link.send('eat', { food, recipe, rating }),
  };
  const game = new Game(pieces, pictures, kitchenLink, houseActions);
  game.onNotice = (message) => {
    notice = message;
    noticeSeconds = NOTICE_SECONDS;
  };
  const view = new GameView(scene, furniture, pieces, kit, litterModels);
  const picker = new RecipePicker(element('recipes'));
  const reactionBar = new ReactionBar(element('reactions'));
  // A piece put down goes to the server, which checks it and tells everybody. Until it answers,
  // the piece (and what stands on it) stays where this player put it.
  const placing = new Map<string, number>();
  const decorator = new Decorator(scene, pieces, furniture, (piece) => {
    const now = performance.now();
    for (const moved of [piece, ...ridersOf(piece, pieces)]) placing.set(moved.id, now);
    link.send('place', { id: piece.id, x: piece.x, z: piece.z, turns: quarterTurns(piece.yaw), y: piece.elevation });
  }, (piece) => {
    placing.set(piece.id, performance.now());
    link.send('store', { id: piece.id });
  });
  const remotes = new RemotePlayers(scene, NAME_HEIGHT);
  const rooms = new RoomVisibility(pieces, furniture.objects, house.doors);
  let resolutionTime = 0;
  let resolutionFrames = 0;
  const voiceChat = new VoiceChat();
  voiceChat.onProblem = (message) => say(message, 4);
  const voicePositions = new Map<string, { x: number; z: number }>();
  let clickedIn = false;
  const candles = new Candles(scene);
  const blowListener = new BlowListener();
  let blowing = 0;
  const say = (message: string, seconds = NOTICE_SECONDS) => {
    notice = message;
    noticeSeconds = seconds;
  };
  link.handlers.react = ({ sessionId, name }) => remotes.react(sessionId, name as Gesture);
  link.handlers.knock = ({ by }) => {
    playKnock();
    say(`${by} is knocking on the door.`, 3);
  };
  link.handlers.refused = ({ message }) => say(message, 3);
  link.handlers.correct = ({ x, z }) => player.place(x, z);
  link.handlers.blown = ({ by }) => {
    candles.puff();
    say(`${by} blew out the candles! Happy birthday!`, 4);
  };
  link.onClosed = (message) => LoadingScreen.fail(message);
  /** The server's numbers for this player's energy and hunger, last time they changed. */
  let serverStats = '';
  let lastAnimation: AnimationName = 'idle';
  let yawnIn = 0;

  const input = new Input(canvas);
  const music = new Music();
  music.start();
  /** The pause card shows whenever the mouse is free, except at the wardrobe and in Settings. */
  const showPause = () => {
    startOverlay.hidden = input.locked || game.dressing !== null || settings.isOpen || !loading.finished;
  };
  if (firstVisit) {
    // A new player makes their character before anything else, at the front door.
    loading.ready(`Hi ${account.username}! First, make your Nong.`, 'Make my Nong', () => {
      game.dressing = { x: SPAWN.x, z: SPAWN.z, facing: SPAWN.yaw, cameraYaw: SPAWN.yaw };
    });
  } else {
    loading.ready(
      `Welcome back, ${account.username}!`,
      'Click to play',
      () => {
        input.lock();
        // If the browser would not capture the mouse, the usual pause card asks again.
        window.setTimeout(showPause, 400);
      },
      () => void logOut(),
    );
  }
  startOverlay.addEventListener('click', () => input.lock());
  document.addEventListener('pointerlockchange', showPause);

  const settings = new SettingsPanel(element('settings'), () => closeSettings(), () => void logOut());
  const openSettings = () => {
    settings.open(account.username);
    document.exitPointerLock();
    showPause();
  };
  const closeSettings = () => {
    settings.close();
    input.lock();
    window.setTimeout(showPause, 300);
  };
  element('start-settings').addEventListener('click', (event) => {
    event.stopPropagation();
    openSettings();
  });

  const wardrobe = new WardrobePanel(
    element('wardrobe'),
    look,
    (config) => wear(config),
    () => game.stopDressing(player),
  );
  let viewBeforeDressing = player.view;
  /** Moves the picture left so the character is not behind the wardrobe panel. */
  const frameBesidePanel = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const panel = element('wardrobe').offsetWidth;
    if (wardrobe.isOpen) camera.setViewOffset(width, height, panel / 2, 0, width, height);
    else camera.clearViewOffset();
  };
  window.addEventListener('resize', frameBesidePanel);
  let lookWhenOpened = look;
  let firstDressing = firstVisit;
  const openWardrobe = (cameraYaw: number) => {
    lookWhenOpened = look;
    wardrobe.open(look, firstDressing ? 'Start playing' : 'Done');
    document.exitPointerLock();
    viewBeforeDressing = player.view;
    player.view = 'tpv';
    player.yaw = cameraYaw;
    player.pitch = DRESSING_PITCH;
    frameBesidePanel();
  };
  const closeWardrobe = () => {
    wardrobe.close();
    // The character is kept on the account. A new player's first look is saved even if unchanged.
    if (firstDressing || JSON.stringify(look) !== JSON.stringify(lookWhenOpened)) {
      api
        .saveAvatar(look)
        .then(() => link.send('look', {}))
        .catch(() => {
          notice = 'Your new look could not be saved. It will be lost when you leave.';
          noticeSeconds = NOTICE_SECONDS;
        });
    }
    firstDressing = false;
    player.view = viewBeforeDressing;
    frameBesidePanel();
    // Closing with a key or the button counts as a click, so the mouse can be taken again.
    input.lock();
    window.setTimeout(showPause, 300);
  };

  let knockWait = 0;
  const roomName = (door: DoorInstance) => door.def.label ?? ZONES.find((z) => z.id === door.def.zoneId)?.name ?? '';

  const feet = new THREE.Vector3();
  const nearestDoor = (): DoorInstance | null => {
    let best: DoorInstance | null = null;
    let bestDistance = DOOR_REACH;
    for (const door of house.doors) {
      const distance = Math.hypot(feet.x - door.def.x, feet.z - door.def.z);
      if (distance < bestDistance) {
        best = door;
        bestDistance = distance;
      }
    }
    return best;
  };

  const homes = new Map(FURNITURE.map((piece) => [piece.id, piece]));
  /** Brings the house in line with the server's copy: doors, litter, furniture, pictures, the cake and this player's stats. */
  const syncHouse = (state: HouseView) => {
    for (const door of house.doors) {
      const open = state.doors.get(door.def.id) ?? false;
      if (open !== door.isOpen) door.setOpen(open);
    }
    const litter: { id: string; kind: string; zone: string; x: number; z: number; yaw: number }[] = [];
    state.litter.forEach((piece, id) => litter.push({ id, kind: piece.kind, zone: piece.zone, x: piece.x, z: piece.z, yaw: piece.yaw }));
    game.syncLitter(litter);

    const now = performance.now();
    const inHand = decorator.inHand;
    for (const piece of pieces) {
      const home = homes.get(piece.id);
      const waiting = placing.get(piece.id);
      if (!home || inHand.includes(piece.id) || (waiting !== undefined && now - waiting < PLACE_WAIT_MS)) continue;
      const at = state.layout.get(piece.id);
      const x = at?.x ?? home.x;
      const z = at?.z ?? home.z;
      const yaw = at ? (at.turns * Math.PI) / 2 : home.yaw;
      const elevation = at?.y ?? home.elevation;
      const moved =
        Math.abs(piece.x - x) > 1e-3 ||
        Math.abs(piece.z - z) > 1e-3 ||
        Math.abs(piece.elevation - elevation) > 1e-3 ||
        quarterTurns(piece.yaw) !== quarterTurns(yaw);
      if (!moved) continue;
      Object.assign(piece, { x, z, yaw, elevation });
      furniture.place(piece);
    }
    pictures.sync(state.pictures);

    const mine = state.birthday.split(', ').includes(account.username);
    game.cake = { birthday: state.birthday, mine, slices: state.cakeSlices, candlesLit: state.candlesLit };
    birthdayChip.hidden = !state.birthday;
    birthdayChip.textContent = mine
      ? 'Happy birthday! There is cake in the living room'
      : `It is ${state.birthday}'s birthday! There is cake in the living room`;

    const me = link.me;
    const stats = me ? `${me.energy}/${me.hunger}` : '';
    if (me && stats !== serverStats) {
      serverStats = stats;
      game.stats = { energy: me.energy, hunger: me.hunger };
    }
  };
  /** True when anybody stands where the door would shut on them. */
  const doorwayTaken = (door: DoorInstance) => {
    if (doorBlockedBy(door.def, feet.x, feet.z)) return true;
    for (const remote of remotes.all.values()) if (doorBlockedBy(door.def, remote.position.x, remote.position.z)) return true;
    return false;
  };

  let last = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;

  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, MAX_FRAME_TIME);
    last = now;

    if (input.wasPressed('F1')) help.hidden = !help.hidden;
    if (input.wasPressed('KeyV') && !game.dressing && !game.cooking) player.toggleView();
    if (input.wasPressed('Escape')) game.stopDressing(player);
    if (input.wasPressed('KeyO') && !settings.isOpen && !game.dressing) openSettings();
    else if (settings.isOpen && (input.wasPressed('KeyO') || input.wasPressed('Escape'))) closeSettings();

    // T opens the reaction bar; a number key then plays one, if the body is free to.
    let reaction: Reaction | null = null;
    if (input.wasPressed('KeyT') && !picker.isOpen && !game.dressing) reactionBar.toggle();
    if (reactionBar.isOpen) {
      if (input.wasPressed('Escape')) reactionBar.close();
      for (let i = 1; i <= REACTIONS.length; i += 1) {
        if (!input.wasPressed(`Digit${i}`) && !input.wasPressed(`Numpad${i}`)) continue;
        reaction = reactionBar.pick(i);
        reactionBar.close();
      }
    }

    // The fridge's recipe list takes the number keys while it is open.
    if (game.choosing && !picker.isOpen) picker.open();
    let pickerKey = false;
    if (picker.isOpen) {
      pickerKey = ['Escape', 'KeyE', 'KeyQ'].some((code) => input.wasPressed(code));
      for (let i = 1; i <= RECIPES.length; i += 1) {
        if (!input.wasPressed(`Digit${i}`) && !input.wasPressed(`Numpad${i}`)) continue;
        const recipe = picker.pick(`Digit${i}`);
        if (recipe) game.takeIngredients(recipe);
      }
      if (pickerKey) game.choosing = false;
      if (!game.choosing) picker.close();
    }
    if (input.wasPressed('KeyB')) {
      if (decorator.active) decorator.stop();
      else if (game.canDecorate) decorator.start();
    }
    const decorating = decorator.active;
    syncHouse(link.state);

    const forward = Number(input.isHeld('KeyW')) - Number(input.isHeld('KeyS'));
    const right = Number(input.isHeld('KeyD')) - Number(input.isHeld('KeyA'));
    const jump = input.wasPressed('Space');

    // Furniture comes first: E works a door only when nothing else wants the key.
    // While decorating, E and Q belong to the piece of furniture in hand.
    const usedKey = game.update(dt, player, {
      use: !decorating && !pickerKey && input.wasPressed('KeyE'),
      alt: !decorating && !pickerKey && input.wasPressed('KeyQ'),
      sweep: input.isHeld('KeyF'),
      wantsToMove: forward !== 0 || right !== 0 || jump,
      forward,
      turn: right,
      mute: input.wasPressed('KeyM'),
      deafen: input.wasPressed('KeyN'),
    });
    if (game.dressing && !wardrobe.isOpen) openWardrobe(game.dressing.cameraYaw);
    else if (!game.dressing && wardrobe.isOpen) closeWardrobe();
    player.standing(feet);
    const door = game.offer || decorating ? null : nearestDoor();
    const here = zoneAt(feet.x, feet.z);
    // The server keeps the locks: a lock comes undone once nobody is left in its room.
    const locks = link.state.locks;
    knockWait = Math.max(0, knockWait - dt);
    const choices = door
      ? doorChoices(door.def, { isOpen: door.isOpen, locked: locks.has(door.def.id), inside: here?.id === door.def.zoneId })
      : null;
    if (door && choices && !usedKey && input.wasPressed('KeyE')) {
      if (choices.use === 'knock') {
        if (knockWait === 0) {
          playKnock();
          link.send('knock', { id: door.def.id });
          knockWait = 1.2;
          notice = `You knocked on the ${roomName(door)} door.`;
          noticeSeconds = 2.5;
        }
      } else if (choices.use === 'close' && doorwayTaken(door)) {
        say('Someone is in the doorway.', 2);
      } else {
        // Opening from inside always works: it unlocks the door first.
        if (choices.use === 'open' && locks.has(door.def.id)) playLockClick();
        link.send('door', { id: door.def.id, open: choices.use === 'open' });
      }
    }
    if (door && choices?.lock && !decorating && input.wasPressed('KeyL')) {
      link.send('lock', { id: door.def.id, locked: choices.lock === 'lock' });
      playLockClick();
      notice = choices.lock === 'lock' ? `Locked. Nobody can come into the ${roomName(door)} until you open the door or leave.` : 'Unlocked.';
      noticeSeconds = 3;
    }

    // The pool: the water carries the body where it is deep, and a swimmer at the side can climb out.
    const overPool = inPool(feet.x, feet.z);
    const wet = overPool && feet.y < POOL.water - SWIMWEAR_DEPTH;
    const climbOut = player.swimming && !game.offer && !decorating ? poolSide(feet.x, feet.z) : null;
    if (climbOut && !usedKey && input.wasPressed('KeyE')) player.place(climbOut.x, climbOut.z);

    const look = input.consumeLook();
    const free = game.canMove;
    // While cooking the mouse moves the hand on the worktop, not the camera.
    const cooking = game.cooking;
    player.update(dt, {
      forward: free ? forward : 0,
      right: free ? right : 0,
      run: input.isHeld('ShiftLeft') || input.isHeld('ShiftRight'),
      jump: free && jump,
      lookX: cooking ? 0 : look.x,
      lookY: cooking ? 0 : look.y,
      speedScale: game.speedScale,
      // On the steps the water is too shallow to float in, so there the feet stay on them.
      waterLevel: overPool && poolFloorAt(feet.z) < POOL.water - 0.5 ? POOL.water : null,
    });

    world.timestep = dt;
    world.step();
    const avatar = avatars[gender];
    const animation = game.animation ?? player.locomotion;
    avatar.setRecline(game.recline);
    avatar.setSwim(player.swimming && !game.animation ? (player.speed > 0.25 ? 'stroke' : 'tread') : null);
    // Lying down and getting up switch at once: a blend would show a body half way between.
    const cut = animation !== lastAnimation && (animation === 'sleep' || lastAnimation === 'sleep');
    avatar.play(animation, game.animationSpeed ?? player.speed, cut ? 0 : undefined);
    if (reaction) {
      if (animation === 'idle' && game.canMove && !player.swimming && !game.carried) {
        avatar.react(reaction);
        link.send('react', { name: reaction });
      } else {
        notice = 'Stand still on your feet, with empty hands, to react.';
        noticeSeconds = 2.5;
      }
    }
    // A tired Nong standing about yawns now and then.
    const canYawn = game.stats.energy < LOW_STAT && animation === 'idle' && game.canMove && !player.swimming && !game.carried;
    if (canYawn && !avatar.reaction) {
      yawnIn -= dt;
      if (yawnIn <= 0) {
        avatar.react('yawn');
        link.send('react', { name: 'yawn' });
        yawnIn = YAWN_EVERY.min + Math.random() * (YAWN_EVERY.max - YAWN_EVERY.min);
      }
    } else if (!canYawn) yawnIn = Math.min(yawnIn, YAWN_EVERY.min / 3);
    lastAnimation = animation;
    avatar.bare(game.bathing || wet);
    avatar.showVoice(voiceSigns(game.voice));
    avatar.update(dt);
    game.pin(player, avatar);
    player.syncFromPhysics();
    player.updateCamera(camera);
    const swim = player.swimming && !game.animation ? (player.speed > 0.25 ? 'stroke' : 'tread') : '';
    link.sendMotion(
      {
        x: player.root.position.x,
        y: player.root.position.y,
        z: player.root.position.z,
        facing: player.root.rotation.y,
        anim: animation,
        speed: game.animationSpeed ?? player.speed,
        recline: game.recline,
        swim,
        bare: game.bathing || wet,
        carrying: game.carried ?? '',
        muted: game.voice.muted,
        deafened: game.voice.deafened,
        inPrivate: game.voice.inPrivate,
      },
      dt,
    );
    remotes.update(link.state, link.sessionId, dt);
    voicePositions.clear();
    for (const remote of remotes.all.values()) voicePositions.set(remote.name, remote.position);
    // Voice waits for the first click into the game: browsers only allow sound and the microphone after one.
    if (input.locked || game.dressing) clickedIn = true;
    if (clickedIn) voiceChat.update(dt, link.me?.zone || null, game.voice, feet, voicePositions);

    // The birthday candles: the birthday Nong blows them out at the cake, into the microphone or by holding F.
    candles.update(dt, furniture.objects.get(BIRTHDAY_CAKE.id) ?? null, game.cake.candlesLit);
    const atCake = Math.hypot(feet.x - BIRTHDAY_CAKE.x, feet.z - BIRTHDAY_CAKE.z) < 2.2;
    if (game.cake.candlesLit && game.cake.mine && atCake && game.canMove) {
      blowListener.start();
      blowListener.update();
      const breath = blowListener.level > 0.5 || input.isHeld('KeyF');
      blowing = breath ? blowing + dt : Math.max(0, blowing - dt / 2);
      if (blowing >= BLOW_SECONDS) {
        link.send('blow', {});
        blowing = 0;
      }
    } else blowing = 0;
    kitchen.update(
      dt,
      { dx: look.x, dy: look.y, held: input.mouseHeld, pressed: input.mousePressed, released: input.mouseReleased },
      camera,
    );
    house.update(dt);
    // Only the rooms that can be seen from here are drawn.
    const inView = rooms.update(feet.x, feet.z);
    remotes.cull((x, z) => inView.has(drawZoneAt(x, z)));
    view.sync(game, player, avatar, dt);
    decorator.update(camera, player, {
      use: input.wasPressed('KeyE'),
      turn: input.wasPressed('KeyR'),
      cancel: input.wasPressed('KeyQ'),
      store: input.wasPressed('KeyX'),
      takeOut: input.wasPressed('KeyC'),
    });

    // HUD
    const zone = zoneAt(feet.x, feet.z);
    zoneChip.textContent = overPool ? 'Pool' : (zone?.name ?? 'Outside');
    viewChip.textContent = player.view === 'tpv' ? 'Third person' : 'First person';
    energyBar.style.width = `${game.stats.energy}%`;
    foodBar.style.width = `${game.stats.hunger}%`;
    energyBar.classList.toggle('low', game.stats.energy < LOW_STAT);
    foodBar.classList.toggle('low', game.stats.hunger < LOW_STAT);
    carriedChip.textContent = game.carriedHint ?? '';
    carriedChip.hidden = !game.carriedHint;
    const litter = zone ? game.litter.get(zone.id)?.length : undefined;
    dirtChip.hidden = litter === undefined;
    if (litter !== undefined) dirtChip.textContent = `Floor: ${litterWord(litter)}`;
    shade.classList.toggle('asleep', game.resting?.kind === 'sleep');
    underwater.hidden = !(camera.position.y < POOL.water && inPool(camera.position.x, camera.position.z));

    const speaking = canSpeak(game.voice);
    const hearing = canHear(game.voice);
    mixer.setMuted(!hearing);
    nameTag.sprite.position.set(player.root.position.x, player.root.position.y + NAME_HEIGHT, player.root.position.z);
    nameTag.visible = player.view === 'tpv' && game.dressing === null;
    micChip.textContent = voiceChat.status === 'unavailable' ? 'No voice chat' : speaking ? 'Mic on' : 'Mic off';
    soundChip.textContent = hearing ? 'Sound on' : 'Sound off';
    micChip.classList.toggle('chip-off', !speaking);
    soundChip.classList.toggle('chip-off', !hearing);
    decorChip.hidden = !decorating;
    aim.hidden = !decorating;

    noticeSeconds = Math.max(0, noticeSeconds - dt);
    let line: string | null = null;
    if (decorating) line = decorator.prompt;
    else if (noticeSeconds > 0) line = notice;
    else if (game.offer) line = game.offer.label;
    else if (climbOut) line = 'E — climb out of the pool';
    else if (door && choices) {
      const room = roomName(door);
      const locked = link.state.locks.has(door.def.id);
      if (choices.use === 'knock') line = `The ${room} is locked · E — knock`;
      else {
        line = `E — ${choices.use} the ${room} door`;
        if (choices.lock === 'lock') line += ' · L — lock it';
        else if (choices.lock === 'unlock') line += ' · L — unlock it';
        if (locked && choices.use === 'open') line = `Locked · E — unlock and open the ${room} door · L — unlock it`;
      }
    }
    if (line) prompt.textContent = line;
    prompt.hidden = !line || game.dressing !== null || picker.isOpen;

    fpsFrames += 1;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      fpsChip.textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
      fpsFrames = 0;
      fpsTime = 0;
    }

    // A slow computer draws fewer pixels rather than fewer frames, down to three quarters.
    resolutionTime += dt;
    resolutionFrames += 1;
    if (resolutionTime >= RESOLUTION_WINDOW) {
      const fps = resolutionFrames / resolutionTime;
      const cap = Math.min(window.devicePixelRatio, PIXEL_RATIO.max);
      let next = pixelRatio;
      if (fps < FPS_BAND.low) next = Math.max(PIXEL_RATIO.min, pixelRatio - PIXEL_RATIO.step);
      else if (fps > FPS_BAND.high) next = Math.min(cap, pixelRatio + PIXEL_RATIO.step);
      if (next !== pixelRatio) {
        pixelRatio = next;
        renderer.setPixelRatio(pixelRatio);
        resize();
      }
      resolutionTime = 0;
      resolutionFrames = 0;
    }

    batches.sync();
    renderer.render(scene, camera);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    Object.assign(window, {
      __nongs: { player, house, camera, renderer, avatars, furniture, game, scene, decorator, pieces, pictures, kitchen, link, remotes },
    });
  }
}

start().catch((error: unknown) => {
  console.error(error);
  LoadingScreen.fail('Something went wrong while loading. See the console.');
});
