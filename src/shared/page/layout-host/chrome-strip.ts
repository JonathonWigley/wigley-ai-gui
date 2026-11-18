import { element } from '../dom';

// What a chrome strip's draw returns: its root, and the elements its kit drew
// that the app marks `is-no-target` (a head's row steps, a pager's edges);
// empty for a strip with none.
export interface DrawnStrip {
  element: HTMLElement;
  noTargets: HTMLElement[];
}

// One draw of a strip: what it built, and the dispose of every anchor, mount
// and box it made.
export interface StripDraw {
  built: DrawnStrip;
  dispose(): void;
}

// A strip of an owner's chrome: the slot it draws into, built once, its last
// draw and the input that draw took, both null before the first draw.
export interface ChromeStrip<Input extends object, Draw extends StripDraw> {
  slot: HTMLElement;
  drawn: Draw | null;
  input: Input | null;
}

// A strip whose slot is `div.<slotClass>`, with nothing drawn yet.
export function chromeStrip<Input extends object, Draw extends StripDraw>(
  slotClass: string,
): ChromeStrip<Input, Draw> {
  return { slot: element('div', slotClass), drawn: null, input: null };
}

// Draws the strip again with `draw` when it has no draw, a field of `input`
// differs from the last draw's, or `force` is set: the last draw disposed, the
// slot emptied, then drawn, and `input` kept.
export function showStrip<Input extends object, Draw extends StripDraw>(
  strip: ChromeStrip<Input, Draw>,
  input: Input,
  draw: (input: Input) => Draw,
  force = false,
): void {
  if (!force && isSameInput(strip.input, input)) {
    return;
  }
  strip.drawn?.dispose();
  strip.slot.replaceChildren();
  strip.drawn = draw(input);
  strip.input = input;
}

// Disposes the strip's last draw; the next `showStrip` draws it again.
export function disposeStrip(strip: ChromeStrip<object, StripDraw>): void {
  strip.drawn?.dispose();
  strip.drawn = null;
  strip.input = null;
}

// Toggles `is-no-target` on each no-target element of the strip's last draw.
export function markNoTargets(
  strip: Pick<ChromeStrip<object, StripDraw>, 'drawn'>,
  isNoTarget: boolean,
): void {
  for (const noTarget of strip.drawn?.built.noTargets ?? []) {
    noTarget.classList.toggle('is-no-target', isNoTarget);
  }
}

// Whether every field of `next` equals that field of `drawn`.
function isSameInput<Input extends object>(
  drawn: Input | null,
  next: Input,
): boolean {
  if (drawn === null) {
    return false;
  }
  return (Object.keys(next) as (keyof Input)[]).every(
    (field) => drawn[field] === next[field],
  );
}
