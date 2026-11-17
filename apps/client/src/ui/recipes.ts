/** The fridge's recipe list: pick a dish with a number key. */
import { RECIPES, type Recipe } from '@nongs/shared';

export class RecipePicker {
  isOpen = false;

  constructor(private readonly panel: HTMLElement) {
    panel.innerHTML = `
      <h2>What shall we cook?</h2>
      <ol>${RECIPES.map(
        (recipe, i) => `
        <li>
          <kbd>${i + 1}</kbd>
          <div>
            <b>${recipe.name}</b>
            <span class="level" title="How busy it gets">${'●'.repeat(recipe.difficulty)}${'○'.repeat(3 - recipe.difficulty)}</span>
            <small>${recipe.blurb}</small>
            <small class="facts">${recipe.steps.length} steps · ${recipe.vessel === 'bowl' ? 'no stove' : `on the stove, ${recipe.vessel}`} · fills ${recipe.hunger}</small>
          </div>
        </li>`,
      ).join('')}</ol>
      <p class="keys"><kbd>1</kbd>–<kbd>${RECIPES.length}</kbd> take the ingredients · <kbd>Esc</kbd> close</p>`;
  }

  open(): void {
    this.isOpen = true;
    this.panel.hidden = false;
  }

  close(): void {
    this.isOpen = false;
    this.panel.hidden = true;
  }

  /** The recipe for a pressed digit key ("Digit1" …), if there is one. */
  pick(code: string): Recipe | null {
    const match = /^(?:Digit|Numpad)(\d)$/.exec(code);
    return match ? (RECIPES[Number(match[1]) - 1] ?? null) : null;
  }
}
