/** The reaction bar: T opens it, a number key plays that reaction. */
import { REACTIONS, type Reaction } from '../player/avatar';

const LABELS: Record<Reaction, { icon: string; name: string }> = {
  wave: { icon: '👋', name: 'Wave' },
  clap: { icon: '👏', name: 'Clap' },
  cheer: { icon: '🙌', name: 'Cheer' },
  shrug: { icon: '🤷', name: 'Shrug' },
  laugh: { icon: '😂', name: 'Laugh' },
  dance: { icon: '💃', name: 'Dance' },
  blow_kiss: { icon: '😘', name: 'Blow a kiss' },
};

export class ReactionBar {
  constructor(private readonly root: HTMLElement) {
    root.innerHTML = REACTIONS.map(
      (reaction, i) =>
        `<div class="reaction"><span class="reaction-icon">${LABELS[reaction].icon}</span><span class="reaction-name">${LABELS[reaction].name}</span><kbd>${i + 1}</kbd></div>`,
    ).join('');
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
  }

  /** The reaction for a pressed number key (1 is the first), or null. */
  pick(number: number): Reaction | null {
    return REACTIONS[number - 1] ?? null;
  }
}
