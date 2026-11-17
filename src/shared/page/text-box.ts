import { isChordPress } from './chord-press';
import { element } from './dom';

// Keys a plugin's text box leaves to the page's binds; every other key, Space
// included, stays in the box.
const BOX_KEYS = new Set(['Tab', 'Enter', 'Escape']);

// A one-line text box for a plugin's own small box (docs' filter and dialogs,
// Settings mode's boxes). Typed keys never reach the page keys; Tab, Enter,
// Escape and every chord do, so the binds of the box scope the plugin pushes
// run. An AltGr press types, so it stays in the box.
export function textBoxInput(className: string): HTMLInputElement {
  const input = element('input', className);
  input.type = 'text';
  input.spellcheck = false;
  input.addEventListener('keydown', (event) => {
    if (!isChordPress(event) && !BOX_KEYS.has(event.key)) {
      event.stopPropagation();
    }
  });
  return input;
}
