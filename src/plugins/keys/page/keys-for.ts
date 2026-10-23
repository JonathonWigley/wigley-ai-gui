import type { CommandId } from '../../../contracts/commands';
import type { Keymap, ViewScope } from '../../../contracts/keymap';
import type { Platform } from '../../../contracts/platform';
import { formatKeys, formatVimKeys } from '../../../shared/key-hints';
import type { HintWhere } from '../contract';

// The first bind in `keymap` that runs `command` in `scope`, `any` binds
// included, or in any scope when `scope` is undefined, formatted as help and
// the key bar show it on `platform`; null when none is bound. `where` picks
// the page's binds or the binds inside a text box.
export function keysFor(
  keymap: Keymap,
  command: CommandId,
  scope: ViewScope | undefined,
  platform: Platform,
  where: HintWhere = 'page',
): string | null {
  const firesIn = (bind: { command: CommandId; scope: ViewScope }) =>
    bind.command === command &&
    (scope === undefined || bind.scope === scope || bind.scope === 'any');
  if (where === 'box') {
    const bind = keymap.editor.binds.find(firesIn);
    return bind === undefined
      ? null
      : formatVimKeys(bind.keys, keymap.editor.leader, platform);
  }
  const bind = keymap.page.find(firesIn);
  return bind === undefined ? null : formatKeys(bind.keys, platform);
}
