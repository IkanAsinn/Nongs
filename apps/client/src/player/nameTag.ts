/**
 * A player's username floating above their head: a rounded label drawn once
 * onto a canvas and shown on a sprite, so it always faces the camera.
 */
import * as THREE from 'three';

/** Height of the label in metres. Its width follows the name. */
const LABEL_HEIGHT = 0.2;
const PIXELS_PER_METRE = 640;

export class NameTag {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;

  constructor(name: string, height: number) {
    this.material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.position.y = height;
    // Drawn after the house so walls in front still hide it, but it is never cut by the body itself.
    this.sprite.renderOrder = 10;
    this.setName(name);
  }

  setName(name: string): void {
    const height = Math.round(LABEL_HEIGHT * PIXELS_PER_METRE);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const font = `600 ${Math.round(height * 0.56)}px Fredoka, ui-rounded, 'Segoe UI', system-ui, sans-serif`;
    context.font = font;
    const padding = height * 0.45;
    const width = Math.ceil(context.measureText(name).width + padding * 2);
    canvas.width = width;
    canvas.height = height;
    context.font = font;
    context.fillStyle = 'rgba(59, 47, 42, 0.72)';
    context.beginPath();
    context.roundRect(0, 0, width, height, height / 2);
    context.fill();
    context.fillStyle = '#fff8ee';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, width / 2, height * 0.54);

    this.material.map?.dispose();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.material.map = texture;
    this.material.needsUpdate = true;
    this.sprite.scale.set(width / PIXELS_PER_METRE, LABEL_HEIGHT, 1);
  }

  set visible(visible: boolean) {
    this.sprite.visible = visible;
  }
}
