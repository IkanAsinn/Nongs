/**
 * The full-screen loading page: the logo with the Nongs around it, a progress
 * bar and a line saying what is being loaded. Once everything is in, it holds
 * the log in and register form, then a play button (the browser only captures
 * the mouse after a click), and fades away when the game starts.
 */
export class LoadingScreen {
  private readonly root = byId('loading');
  private readonly fill = byId('loading-fill');
  private readonly text = byId('loading-step');
  private readonly play = byId<HTMLButtonElement>('loading-play');
  private readonly welcome = byId('loading-welcome');
  private readonly switchUser = byId<HTMLButtonElement>('loading-switch');
  private done = false;

  /** Shows what is loading now, and how far along everything is (0–1). */
  step(text: string, progress: number): void {
    this.text.textContent = text;
    this.fill.style.width = `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%`;
  }

  /** Everything is loaded: the progress makes way for the sign-in form. */
  loaded(): void {
    this.step('Ready', 1);
    this.root.classList.add('loaded');
  }

  /**
   * Shows the button that starts the game, with a greeting above it.
   * @param onSwitch shown as "Not you? Log out" when given.
   */
  ready(greeting: string, label: string, onPlay: () => void, onSwitch?: () => void): void {
    this.loaded();
    this.root.classList.add('ready');
    this.welcome.textContent = greeting;
    this.play.textContent = label;
    this.play.hidden = false;
    this.switchUser.hidden = !onSwitch;
    if (onSwitch) {
      this.switchUser.onclick = (event) => {
        event.stopPropagation();
        onSwitch();
      };
    }
    this.play.onclick = (event) => {
      event.stopPropagation();
      if (this.done) return;
      onPlay();
      this.finish();
    };
  }

  /** Fades the page out. */
  finish(): void {
    if (this.done) return;
    this.done = true;
    this.root.classList.add('done');
    window.setTimeout(() => this.root.remove(), 700);
  }

  get finished(): boolean {
    return this.done;
  }

  /** Loading broke: says so on the page instead of a progress line. */
  static fail(message: string): void {
    const root = document.getElementById('loading');
    const text = document.getElementById('loading-step');
    root?.classList.remove('loaded', 'ready');
    root?.classList.add('failed');
    if (text) text.textContent = message;
  }
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} is missing from index.html`);
  return found as T;
}
