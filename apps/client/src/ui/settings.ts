/** Settings: music and sound-effect volume, who is logged in, and logging out. */
import { mixer } from '../audio/mixer';

export class SettingsPanel {
  private readonly who: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    onClose: () => void,
    onLogout: () => void,
  ) {
    root.innerHTML = `
      <h2>Settings</h2>
      <label class="settings-slider">Music
        <input type="range" name="music" min="0" max="100" step="1" />
        <output></output>
      </label>
      <label class="settings-slider">Sound effects
        <input type="range" name="effects" min="0" max="100" step="1" />
        <output></output>
      </label>
      <p class="settings-who">Logged in as <b></b></p>
      <div class="settings-buttons">
        <button type="button" class="settings-logout">Log out</button>
        <button type="button" class="settings-close">Back to the game</button>
      </div>
      <p class="settings-hint"><kbd>O</kbd> or <kbd>Esc</kbd> closes this</p>`;
    this.who = root.querySelector('.settings-who b')!;
    for (const name of ['music', 'effects'] as const) {
      const slider = root.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
      const value = slider.nextElementSibling as HTMLOutputElement;
      const show = () => (value.textContent = `${slider.value}%`);
      slider.value = String(Math.round(mixer.settings[name] * 100));
      show();
      slider.addEventListener('input', () => {
        mixer.setVolumes({ [name]: Number(slider.value) / 100 });
        show();
      });
    }
    root.querySelector('.settings-close')!.addEventListener('click', onClose);
    root.querySelector('.settings-logout')!.addEventListener('click', onLogout);
    // Keys pressed on the sliders belong to the panel, not the game; O and Esc still close it.
    root.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyO' && event.code !== 'Escape') event.stopPropagation();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(username: string): void {
    this.who.textContent = username;
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }
}
