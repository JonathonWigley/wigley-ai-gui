import { element } from '../../../shared/page/dom';

// Keys a docs text box leaves to the page's binds; every other key, Space
// included, stays in the box.
const BOX_KEYS = new Set(['Tab', 'Enter', 'Escape']);

// A one-line docs text box. Typed keys never reach the page keys; Tab, Enter,
// Escape and every chord do, so the box's binds in scope `box` run.
export function textBoxInput(className: string): HTMLInputElement {
  const input = element('input', className);
  input.type = 'text';
  input.spellcheck = false;
  input.addEventListener('keydown', (event) => {
    const isChord = event.ctrlKey || event.altKey || event.metaKey;
    if (!isChord && !BOX_KEYS.has(event.key)) {
      event.stopPropagation();
    }
  });
  return input;
}
