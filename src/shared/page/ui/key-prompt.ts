import './key-prompt.css';
import type { Platform } from '../../../contracts/platform';
import { element } from '../dom';
import { kbd } from './kbd';

// The Kbd of `keys` for `platform`, then `label` after it when given: the one
// thing the keys plugin draws into an anchor.
export function keyPrompt(
  keys: string,
  platform: Platform,
  label?: string,
): HTMLElement {
  const node = element('span', 'ui-key-prompt');
  node.append(kbd(keys, platform));
  if (label !== undefined) {
    node.append(element('span', 'ui-key-prompt-label', label));
  }
  return node;
}
