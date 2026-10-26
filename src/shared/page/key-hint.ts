import type { Platform } from '../../contracts/platform';
import { kbd } from './ui/kbd';

// The hint of `keys` as the keymap prints them, drawn for `platform`; null
// for null keys, which draw nothing.
export function keyHint(
  keys: string | null,
  platform: Platform,
): HTMLElement | null {
  return keys === null ? null : kbd(keys, platform);
}

// Appends the hint of `readKeys()` to the end of `control`, and returns the
// redraw that shows `readKeys()` there again in its place, leaving the hint
// alone while the keys read the same.
export function appendKeyHint(
  control: HTMLElement,
  readKeys: () => string | null,
  platform: Platform,
): () => void {
  let shownKeys = readKeys();
  let hint = keyHint(shownKeys, platform);
  if (hint !== null) {
    control.append(hint);
  }
  return () => {
    const keys = readKeys();
    if (keys === shownKeys) {
      return;
    }
    hint?.remove();
    shownKeys = keys;
    hint = keyHint(keys, platform);
    if (hint !== null) {
      control.append(hint);
    }
  };
}
