// The one place a key hint is drawn.
import './kbd.css';
import type { OsName } from '../../../contracts/platform';
import { formatChord } from '../../key-hints';
import { element } from '../dom';
import { kbdParts } from './kbd-parts';

// `keys`, a hint string as the keymap prints it, with each vim chord printed
// for `platform`.
export function kbd(keys: string, platform: OsName): HTMLElement {
  const node = element('kbd', 'ui-kbd');
  for (const part of kbdParts(keys)) {
    if (part.kind === 'or') {
      node.append(element('span', 'ui-kbd-or', part.text));
    } else {
      const text =
        part.kind === 'chord' ? formatChord(part.text, platform) : part.text;
      node.append(element('span', 'ui-kbd-key', text));
    }
  }
  return node;
}
