import type { CommandArg, CommandId } from '../contracts/commands';
import type { HintWhere, Keymap, ViewScope } from '../contracts/keymap';
import type { OsName } from '../contracts/platform';
import { isSameJson } from './json';
import { formatKeys, formatVimKeys } from './key-hints';
import { isVimKeys, pageVimKeys } from './vim-keys';

// Whether a bind runs `command` in `scope`, `any` binds included, or in any
// scope when `scope` is undefined; with `arg` given, a bind carrying that `arg`.
function firesIn(
  bind: { command: CommandId; scope: ViewScope; arg?: CommandArg },
  command: CommandId,
  scope: ViewScope | undefined,
  arg: CommandArg | undefined,
): boolean {
  return (
    bind.command === command &&
    (scope === undefined || bind.scope === scope || bind.scope === 'any') &&
    (arg === undefined || isSameJson(bind.arg, arg))
  );
}

// The first bind in `keymap` that runs `command` in `scope`, `any` binds
// included, or in any scope when `scope` is undefined, formatted as help and
// the anchors show it on `platform`; null when none is bound. `where` picks
// the page's binds or the binds inside a text box; `arg` narrows to the binds
// carrying it.
export function keysFor(
  keymap: Keymap,
  command: CommandId,
  scope: ViewScope | undefined,
  platform: OsName,
  where: HintWhere = 'page',
  arg?: CommandArg,
): string | null {
  if (where === 'box') {
    const bind = keymap.editor.binds.find((each) =>
      firesIn(each, command, scope, arg),
    );
    return bind === undefined
      ? null
      : formatVimKeys(bind.keys, keymap.editor.leader, platform);
  }
  const bind = keymap.page.find((each) => firesIn(each, command, scope, arg));
  return bind === undefined ? null : formatKeys(bind.keys, platform);
}

// The keys an anchor's prompt shows, read as `keysFor` reads them: the first
// such bind whose keys are not vim's own keys, or the first bind when every
// one is; null when none is bound.
export function promptKeysFor(
  keymap: Keymap,
  command: CommandId,
  scope: ViewScope | undefined,
  platform: OsName,
  where: HintWhere,
  arg?: CommandArg,
): string | null {
  if (where === 'box') {
    const binds = keymap.editor.binds.filter((each) =>
      firesIn(each, command, scope, arg),
    );
    const bind = binds.find((each) => !isVimKeys(each.keys)) ?? binds[0];
    return bind === undefined
      ? null
      : formatVimKeys(bind.keys, keymap.editor.leader, platform);
  }
  const binds = keymap.page.filter((each) =>
    firesIn(each, command, scope, arg),
  );
  const bind =
    binds.find((each) => !isVimKeys(pageVimKeys(each.keys))) ?? binds[0];
  return bind === undefined ? null : formatKeys(bind.keys, platform);
}
