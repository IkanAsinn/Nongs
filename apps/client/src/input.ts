/** Larger movements in a single mouse event are browser glitches, not the player. */
const MAX_MOVE = 200;

/** Keyboard and mouse state for one canvas. */
export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private skipMoves = 0;
  /** The left mouse button: held now, went down this frame, came up this frame. */
  mouseHeld = false;
  mousePressed = false;
  mouseReleased = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      // F1 shows the game's own help, not the browser's.
      if (e.code === 'F1') e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouseHeld = false;
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.locked) return;
      this.mouseHeld = true;
      this.mousePressed = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !this.mouseHeld) return;
      this.mouseHeld = false;
      this.mouseReleased = true;
    });
    // Just after the mouse is captured, the browser can report the distance
    // from the old pointer position as one movement; those events are dropped.
    document.addEventListener('pointerlockchange', () => {
      this.skipMoves = 2;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (this.skipMoves > 0) {
        this.skipMoves -= 1;
        return;
      }
      // Chrome on Windows sometimes sends one huge movement, often on a click.
      // No real hand moves that far between two mouse events.
      if (Math.abs(e.movementX) > MAX_MOVE || Math.abs(e.movementY) > MAX_MOVE) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Captures the mouse. Must be called from a click or key handler. */
  lock(): void {
    // Browsers reject the request if it comes too soon after Esc; that is fine.
    void Promise.resolve(this.canvas.requestPointerLock()).catch(() => {});
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  /** True once for each key press. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Mouse movement in pixels since the last call. */
  consumeLook(): { x: number; y: number } {
    const look = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.mousePressed = false;
    this.mouseReleased = false;
  }
}
