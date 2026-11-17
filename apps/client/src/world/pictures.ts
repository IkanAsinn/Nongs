/**
 * Players' own pictures in the picture frames. A chosen image file is cut to
 * the shape of the frame and made small in the browser, then sent to the
 * server, which re-encodes it and tells everybody in the house. Anyone can
 * take a picture down again, so a bad one does not stay up.
 */
import * as THREE from 'three';
import type { Furniture } from '@nongs/shared';
import { api } from '../net/api';
import type { Synced } from '../net/house';
import type { FurnitureView } from './furniture';

/** Where pictures were kept in the browser before the server had them. They are sent up once, then forgotten. */
const PICTURES_KEY = 'nongs.pictures';
/** The painted area inside the frame of prop_picture, in metres from the model's origin. */
const ART = { width: 0.65, height: 0.4625, centreY: 0.281, front: 0.025 };
/** The stored image: the same shape as the painted area. */
const PIXELS = { width: 512, height: 364 };
const JPEG_QUALITY = 0.85;
const LARGEST_FILE = 20 * 1024 * 1024;
const STORED = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const FRAME_MATERIAL = 'Prop Wood';
const OWN = 'own-picture';

export class Pictures {
  /** Called with a short message when an image cannot be used or kept. */
  onProblem: (message: string) => void = () => {};

  /** The version of the picture shown in each frame: the server's, or 'local' while an upload is on its way. */
  private readonly shown = new Map<string, string>();
  private versions: Synced<string> | null = null;
  private readonly frames: Set<string>;
  private readonly chooser = document.createElement('input');
  private readonly plane = new THREE.PlaneGeometry(ART.width, ART.height);
  private choosingFor: string | null = null;

  constructor(
    private readonly furniture: FurnitureView,
    pieces: readonly Furniture[],
  ) {
    this.chooser.type = 'file';
    this.chooser.accept = 'image/png,image/jpeg,image/webp,image/gif';
    this.chooser.hidden = true;
    document.body.append(this.chooser);
    this.chooser.addEventListener('change', () => {
      const file = this.chooser.files?.[0];
      const id = this.choosingFor;
      this.chooser.value = '';
      if (file && id) void this.use(id, file);
    });

    this.frames = new Set(pieces.filter((piece) => piece.model === 'prop_picture').map((piece) => piece.id));
  }

  has(id: string): boolean {
    return this.versions?.has(id) ?? false;
  }

  /** Shows what the server has in each frame. Call every frame; it only loads what changed. */
  sync(versions: Synced<string>): void {
    if (!this.versions) {
      this.versions = versions;
      void this.sendUpOld(versions);
    }
    versions.forEach((version, id) => {
      if (this.shown.get(id) === version || !this.frames.has(id)) return;
      this.hide(id);
      this.show(id, api.pictureUrl(id, version));
      this.shown.set(id, version);
    });
    for (const id of [...this.shown.keys()]) {
      if (this.shown.get(id) !== 'local' && !versions.has(id)) {
        this.hide(id);
        this.shown.delete(id);
      }
    }
  }

  /** Opens the file chooser for one frame. Must follow a key press or click. */
  choose(id: string): void {
    this.choosingFor = id;
    this.chooser.click();
  }

  /** Takes the picture down for everybody, so the frame shows its own painting again. */
  clear(id: string): void {
    this.hide(id);
    this.shown.delete(id);
    api.removePicture(id).catch(() => this.onProblem('The picture could not be taken down. Try again.'));
  }

  private async use(id: string, file: File): Promise<void> {
    try {
      if (!file.type.startsWith('image/')) throw new Error('not an image');
      if (file.size > LARGEST_FILE) {
        this.onProblem('That picture is too large. Choose one under 20 MB.');
        return;
      }
      const image = await this.shrink(file);
      // Shown at once; everybody else sees it when the server has it.
      this.hide(id);
      this.show(id, image);
      this.shown.set(id, 'local');
      try {
        await api.putPicture(id, image);
      } catch (error) {
        this.hide(id);
        this.shown.delete(id);
        this.onProblem(error instanceof Error ? error.message : 'The picture could not be put up. Try again.');
      }
    } catch {
      this.onProblem('That file could not be read as a picture.');
    }
  }

  /** Pictures from before the server kept them go up once, into frames that are still empty. */
  private async sendUpOld(versions: Synced<string>): Promise<void> {
    let stored: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(PICTURES_KEY) ?? '{}');
      if (typeof parsed === 'object' && parsed !== null) stored = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    for (const [id, image] of Object.entries(stored)) {
      if (!this.frames.has(id) || versions.has(id) || typeof image !== 'string' || !STORED.test(image)) continue;
      await api.putPicture(id, image).catch(() => undefined);
    }
    try {
      localStorage.removeItem(PICTURES_KEY);
    } catch {
      // Nothing to do: it would only be sent up again next time.
    }
  }

  /** Cuts the middle of the image to the frame's shape and returns it as a small JPEG. */
  private async shrink(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = PIXELS.width;
    canvas.height = PIXELS.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    const scale = Math.max(PIXELS.width / bitmap.width, PIXELS.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    // A see-through image gets a white background, as JPEG has no transparency.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, PIXELS.width, PIXELS.height);
    context.drawImage(bitmap, (PIXELS.width - width) / 2, (PIXELS.height - height) / 2, width, height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  private show(id: string, image: string): void {
    const frame = this.furniture.objects.get(id);
    if (!frame) return;
    // The frame's own painting makes way for the player's picture.
    frame.traverse((child) => {
      if (child instanceof THREE.Mesh && (child.material as THREE.Material).name !== FRAME_MATERIAL) child.visible = false;
    });
    const texture = new THREE.TextureLoader().load(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(this.plane, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0 }));
    mesh.name = OWN;
    mesh.position.set(0, ART.centreY, ART.front);
    frame.add(mesh);
  }

  private hide(id: string): void {
    const frame = this.furniture.objects.get(id);
    const mesh = frame?.getObjectByName(OWN);
    if (!frame || !(mesh instanceof THREE.Mesh)) return;
    frame.remove(mesh);
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.map?.dispose();
    material.dispose();
    frame.traverse((child) => {
      if (child instanceof THREE.Mesh) child.visible = true;
    });
  }
}
