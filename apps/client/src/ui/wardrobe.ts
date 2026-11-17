/** The panel that opens at a wardrobe: pick a body, skin, hair and clothes. */
import {
  BOTTOM_STYLES,
  CLOTHING_COLORS,
  DEFAULT_HAIR,
  GENDERS,
  GLASSES_STYLES,
  HAT_STYLES,
  HAIR_COLORS,
  HAIR_FOR,
  HAIR_STYLES,
  SHOE_STYLES,
  SKIN_TONES,
  TOP_PATTERNS,
  TOP_STYLES,
  type AvatarConfig,
} from '@nongs/shared';

/** The fields that hold one of a fixed list of styles, and the fields that hold a colour. */
type StyleField = 'gender' | 'hair' | 'top' | 'topPattern' | 'bottom' | 'shoes' | 'hat' | 'glasses';
type ColorField = 'skin' | 'hairColor' | 'topColor' | 'bottomColor' | 'shoesColor' | 'hatColor';

const NAMES: { [Field in StyleField]: Record<AvatarConfig[Field], string> } = {
  gender: { female: 'Female', male: 'Male' },
  hair: {
    none: 'None',
    short: 'Short',
    bob: 'Bob',
    long: 'Long',
    ponytail: 'Ponytail',
    buns: 'Buns',
    buzz: 'Buzz cut',
    sidepart: 'Side part',
    quiff: 'Quiff',
    curly: 'Curly',
  },
  top: { tshirt: 'T-shirt', tank: 'Tank top', sweater: 'Sweater' },
  topPattern: { plain: 'Plain', stripes: 'Stripes' },
  bottom: { shorts: 'Shorts', trousers: 'Trousers' },
  shoes: { none: 'Barefoot', sneakers: 'Sneakers', boots: 'Boots' },
  hat: { none: 'No hat', beanie: 'Beanie', cap: 'Cap' },
  glasses: { none: 'No glasses', round: 'Round', square: 'Square', sun: 'Sunglasses' },
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export class WardrobePanel {
  private config: AvatarConfig;
  /** Marks the chosen button in each row again after a change. */
  private readonly refreshers: (() => void)[] = [];
  private readonly done: HTMLButtonElement;

  constructor(
    private readonly root: HTMLElement,
    config: AvatarConfig,
    private readonly onChange: (config: AvatarConfig) => void,
    onDone: () => void,
  ) {
    this.config = { ...config };
    root.append(make('h2', undefined, 'Wardrobe'), make('p', 'wardrobe-hint', 'Press A or D to turn around.'));

    this.section('Body', this.styles('gender', GENDERS), this.colors('skin', SKIN_TONES, 'Skin'));
    this.section('Hair', this.styles('hair', HAIR_STYLES), this.colors('hairColor', HAIR_COLORS, 'Hair colour'));
    this.section(
      'Top',
      this.styles('top', TOP_STYLES),
      this.styles('topPattern', TOP_PATTERNS),
      this.colors('topColor', CLOTHING_COLORS, 'Top colour'),
    );
    this.section('Bottom', this.styles('bottom', BOTTOM_STYLES), this.colors('bottomColor', CLOTHING_COLORS, 'Bottom colour'));
    this.section('Shoes', this.styles('shoes', SHOE_STYLES), this.colors('shoesColor', CLOTHING_COLORS, 'Shoe colour'));
    this.section('Hat', this.styles('hat', HAT_STYLES), this.colors('hatColor', CLOTHING_COLORS, 'Hat colour'));
    this.section('Glasses', this.styles('glasses', GLASSES_STYLES));

    const done = make('button', 'wardrobe-done', 'Done');
    this.done = done;
    done.type = 'button';
    done.addEventListener('click', onDone);
    root.append(done);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** @param doneLabel What the button that closes the panel says. */
  open(config: AvatarConfig, doneLabel = 'Done'): void {
    this.config = { ...config };
    this.done.textContent = doneLabel;
    for (const refresh of this.refreshers) refresh();
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  private section(title: string, ...rows: HTMLElement[]): void {
    const section = make('section');
    section.append(make('h3', undefined, title), ...rows);
    this.root.append(section);
  }

  private set<Field extends keyof AvatarConfig>(field: Field, value: AvatarConfig[Field]): void {
    this.config = { ...this.config, [field]: value };
    // Each body has its own hair styles: a style the new body does not have becomes its usual one.
    const { gender, hair } = this.config;
    if (!HAIR_FOR[gender].includes(hair)) this.config.hair = DEFAULT_HAIR[gender];
    for (const refresh of this.refreshers) refresh();
    this.onChange(this.config);
  }

  /** A row of named buttons for one style field. */
  private styles<Field extends StyleField>(field: Field, options: readonly AvatarConfig[Field][]): HTMLElement {
    const row = make('div', 'wardrobe-row');
    for (const option of options) {
      const button = make('button', 'wardrobe-style', NAMES[field][option]);
      button.type = 'button';
      button.addEventListener('click', () => this.set(field, option));
      this.refreshers.push(() => {
        button.setAttribute('aria-pressed', String(this.config[field] === option));
        if (field === 'hair') button.hidden = !HAIR_FOR[this.config.gender].includes(option as AvatarConfig['hair']);
      });
      row.append(button);
    }
    return row;
  }

  /** A row of colour swatches for one colour field. */
  private colors(field: ColorField, options: readonly string[], label: string): HTMLElement {
    const row = make('div', 'wardrobe-row');
    for (const color of options) {
      const button = make('button', 'wardrobe-swatch');
      button.type = 'button';
      button.style.background = color;
      button.setAttribute('aria-label', `${label} ${color}`);
      button.addEventListener('click', () => this.set(field, color));
      this.refreshers.push(() => button.setAttribute('aria-pressed', String(this.config[field] === color)));
      row.append(button);
    }
    return row;
  }
}
