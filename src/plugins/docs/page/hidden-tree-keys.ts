import type { CommandId } from '../../../contracts/commands';
import type { Keymap, ViewScope } from '../../../contracts/keymap';
import { firesIn, startsWith } from '../../../shared/keymap-checks';

// The command the page keys of `command` firing in `fromScope` run in
// `toScope` by the merged `keymap`. A command handler is not told which of its
// keys was pressed, so every such key must agree: null when they run
// different commands there, when none runs one, or when `command` has no key
// firing in `fromScope`.
export function commandOfKeysIn(
  keymap: Keymap,
  command: CommandId,
  fromScope: ViewScope,
  toScope: ViewScope,
): CommandId | null {
  const keySets = keymap.page
    .filter((bind) => bind.command === command && firesIn(bind, fromScope))
    .map((bind) => bind.keys);
  const commandsThere = new Set(
    keySets.map(
      (keys) =>
        keymap.page.find(
          (bind) =>
            bind.keys.length === keys.length &&
            startsWith(bind.keys, keys) &&
            firesIn(bind, toScope),
        )?.command ?? null,
    ),
  );
  const [only] = commandsThere;
  return commandsThere.size === 1 ? only : null;
}
