import type { CommandId } from '../../../contracts/commands';
import type { Keymap, ViewScope } from '../../../contracts/keymap';
import type { Platform } from '../../../contracts/platform';
import { formatKeys, formatVimKeys } from '../../../shared/key-hints';
import type { HintWhere } from '../contract';
import { isVimKeys, pageVimKeys } from './vim-keys';

// Whether a bind runs `command` in `scope`, `any` binds included, or in any
// scope when `scope` is undefined.
function firesIn(
  bind: { command: CommandId; scope: ViewScope },
  command: CommandId,
  scope: ViewScope | undefined,
): boolean {
  return (
    bind.command === command &&
    (scope === undefined || bind.scope === scope || bind.scope === 'any')
  );
}

// The first bind in `keymap` that runs `command` in `scope`, `any` binds
// included, or in any scope when `scope` is undefined, formatted as help and
// the anchors show it on `platform`; null when none is bound. `where` picks
// the page's binds or the binds inside a text box.
export function keysFor(
  keymap: Keymap,
  command: CommandId,
  scope: ViewScope | undefined,
  platform: Platform,
  where: HintWhere = 'page',
): string | null {
  if (where === 'box') {
    const bind = keymap.editor.binds.find((each) =>
      firesIn(each, command, scope),
    );
    return bind === undefined
      ? null
      : formatVimKeys(bind.keys, keymap.editor.leader, platform);
  }
  const bind = keymap.page.find((each) => firesIn(each, command, scope));
  return bind === undefined ? null : formatKeys(bind.keys, platform);
}

// The keys an anchor's prompt shows, read as `keysFor` reads them: the first
// such bind whose keys are not vim's own keys, or the first bind when every
// one is; null when none is bound.
export function promptKeysFor(
  keymap: Keymap,
  command: CommandId,
  scope: ViewScope | undefined,
  platform: Platform,
  where: HintWhere,
): string | null {
  if (where === 'box') {
    const binds = keymap.editor.binds.filter((each) =>
      firesIn(each, command, scope),
    );
    const bind = binds.find((each) => !isVimKeys(each.keys)) ?? binds[0];
    return bind === undefined
      ? null
      : formatVimKeys(bind.keys, keymap.editor.leader, platform);
  }
  const binds = keymap.page.filter((each) => firesIn(each, command, scope));
  const bind =
    binds.find((each) => !isVimKeys(pageVimKeys(each.keys))) ?? binds[0];
  return bind === undefined ? null : formatKeys(bind.keys, platform);
}
