/**
 * Birthday candles on the cake, and blowing them out. The flames flicker while
 * they are lit; blowing them out leaves a puff of smoke for everyone.
 *
 * Blowing is heard through the microphone: a breath on the microphone is loud
 * and low (most of its sound is under about 500 Hz), unlike talking or music.
 * Holding a key works too, for anyone without a microphone.
 */
import * as THREE from 'three';

const CANDLES = 6;
const CANDLE = { radius: 0.007, height: 0.07 };
const COLOURS = [0xf6a5c0, 0x9fd3f2, 0xfbe08a, 0xb9e4a8, 0xd7b8f0, 0xffc29a];
const SMOKE_PUFFS = 14;
const SMOKE_SECONDS = 2.2;

/** How long a breath (or the key) must last to put the candles out, in seconds. */
export const BLOW_SECONDS = 0.8;

export class Candles {
  readonly group = new THREE.Group();
  private readonly flames: THREE.Mesh[] = [];
  private readonly smoke: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[] = [];
  private smokeAge = Infinity;
  private time = 0;
  private placedOn: THREE.Object3D | null = null;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const wax = new THREE.CylinderGeometry(CANDLE.radius, CANDLE.radius, CANDLE.height, 8);
    const flame = new THREE.SphereGeometry(0.009, 8, 6);
    flame.scale(1, 1.9, 1);
    const glow = new THREE.MeshBasicMaterial({ color: 0xffc54d, transparent: true, opacity: 0.95, fog: false });
    for (let i = 0; i < CANDLES; i += 1) {
      const candle = new THREE.Mesh(wax, new THREE.MeshStandardMaterial({ color: COLOURS[i % COLOURS.length], roughness: 0.6 }));
      const angle = (i / CANDLES) * Math.PI * 2;
      candle.userData.angle = angle;
      const fire = new THREE.Mesh(flame, glow);
      fire.position.y = CANDLE.height / 2 + 0.014;
      candle.add(fire);
      this.flames.push(fire);
      this.group.add(candle);
    }
    const puff = new THREE.SphereGeometry(0.02, 8, 6);
    for (let i = 0; i < SMOKE_PUFFS; i += 1) {
      const mesh = new THREE.Mesh(puff, new THREE.MeshBasicMaterial({ color: 0xdcdcdc, transparent: true, opacity: 0, depthWrite: false }));
      mesh.visible = false;
      this.group.add(mesh);
      this.smoke.push({ mesh, velocity: new THREE.Vector3() });
    }
  }

  /** Smoke rises from every wick. */
  puff(): void {
    this.smokeAge = 0;
    this.smoke.forEach((puff, i) => {
      const candle = this.group.children[i % CANDLES]!;
      puff.mesh.position.set(candle.position.x, candle.position.y + CANDLE.height / 2 + 0.02, candle.position.z);
      puff.velocity.set((Math.random() - 0.5) * 0.04, 0.12 + Math.random() * 0.08, (Math.random() - 0.5) * 0.04);
      puff.mesh.visible = true;
    });
  }

  /**
   * Puts the candles on top of the cake, lit or not, and runs the flicker and
   * the smoke. `cake` is null when there is no cake to stand on.
   */
  update(dt: number, cake: THREE.Object3D | null, lit: boolean): void {
    this.time += dt;
    this.group.visible = cake !== null && cake.visible;
    if (!cake || !cake.visible) return;
    if (this.placedOn !== cake) this.stand(cake);
    this.flames.forEach((flame, i) => {
      flame.visible = lit;
      const flicker = 1 + Math.sin(this.time * 17 + i * 1.7) * 0.12 + Math.sin(this.time * 31 + i) * 0.06;
      flame.scale.set(1, flicker, 1);
    });
    if (this.smokeAge < SMOKE_SECONDS) {
      this.smokeAge += dt;
      const fade = 1 - this.smokeAge / SMOKE_SECONDS;
      for (const puff of this.smoke) {
        puff.mesh.position.addScaledVector(puff.velocity, dt);
        puff.mesh.scale.setScalar(1 + this.smokeAge * 1.5);
        (puff.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * fade;
        puff.mesh.visible = fade > 0;
      }
    }
  }

  /** Spaces the candles in a ring on the cake's top, measured from the model. */
  private stand(cake: THREE.Object3D): void {
    cake.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(cake);
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.min(box.max.x - box.min.x, box.max.z - box.min.z) * 0.28;
    this.group.position.set(centre.x, box.max.y + CANDLE.height / 2 - 0.004, centre.z);
    for (const candle of this.group.children.slice(0, CANDLES)) {
      const angle = candle.userData.angle as number;
      candle.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    }
    this.placedOn = cake;
  }
}

/**
 * Listens for a breath on the microphone. `level` is how sure it is that
 * someone is blowing right now, from 0 to 1. Asks for the microphone the first
 * time `start` is called; without one, `level` stays 0 and the key does it.
 */
export class BlowListener {
  level = 0;
  private analyser: AnalyserNode | null = null;
  private bins: Float32Array<ArrayBuffer> | null = null;
  private starting = false;

  start(): void {
    if (this.analyser || this.starting || !navigator.mediaDevices?.getUserMedia) return;
    this.starting = true;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((stream) => {
        const audio = new AudioContext();
        const analyser = audio.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.3;
        audio.createMediaStreamSource(stream).connect(analyser);
        this.analyser = analyser;
        this.bins = new Float32Array(analyser.frequencyBinCount);
      })
      .catch(() => undefined)
      .finally(() => {
        this.starting = false;
      });
  }

  update(): void {
    const analyser = this.analyser;
    const bins = this.bins;
    if (!analyser || !bins) {
      this.level = 0;
      return;
    }
    analyser.getFloatFrequencyData(bins);
    const hz = analyser.context.sampleRate / analyser.fftSize;
    let low = 0;
    let high = 0;
    for (let i = 1; i < bins.length; i += 1) {
      const power = 10 ** (bins[i]! / 10);
      if (i * hz < 500) low += power;
      else if (i * hz < 4000) high += power;
    }
    const loudness = 10 * Math.log10(low + 1e-12);
    // A breath: loud in the low band, and mostly there rather than in the voice band.
    const loud = THREE.MathUtils.clamp((loudness + 30) / 20, 0, 1);
    const lowShare = low / (low + high + 1e-12);
    this.level = lowShare > 0.6 ? loud : 0;
  }
}
