import type { CommandId } from '../../../contracts/commands';
import type { Keymap, ViewScope } from '../../../contracts/keymap';
import type { Platform } from '../../../contracts/platform';
import { formatKeys } from '../../../shared/key-hints';

// The first page bind in `keymap` that runs `command` in `scope`, `any` binds
// included, or in any scope when `scope` is undefined, formatted as help and
// the key bar show it on `platform`; null when none is bound.
export function keysFor(
  keymap: Keymap,
  command: CommandId,
  scope: ViewScope | undefined,
  platform: Platform,
): string | null {
  const bind = keymap.page.find(
    (candidate) =>
      candidate.command === command &&
      (scope === undefined ||
        candidate.scope === scope ||
        candidate.scope === 'any'),
  );
  return bind === undefined ? null : formatKeys(bind.keys, platform);
}
