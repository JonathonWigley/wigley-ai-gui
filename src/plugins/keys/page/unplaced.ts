import type { CommandId } from '../../../contracts/commands';
import type { Keymap, ViewScope } from '../../../contracts/keymap';
import { vimTokens } from '../../../shared/key-hints';
import { pageKeysFor } from '../../../shared/key-notation';
import { isVimKeys, pageVimKeys } from './vim-keys';

// A bind with no anchor: its keys in vim notation and the command they run.
export interface UnplacedBind {
  keys: string;
  command: CommandId;
}

// The binds firing in `scope` (`any` binds included) whose command `placed`
// does not hold: page binds, then box binds, each pair once. Leader sequences,
// which which-key shows, and vim's own keys are left out.
export function unplacedBinds(
  keymap: Keymap,
  scope: ViewScope,
  placed: ReadonlySet<CommandId>,
): UnplacedBind[] {
  const { leader } = keymap.editor;
  const pageLeader = pageKeysFor(leader, leader)[0];
  const firesInScope = (bind: { scope: ViewScope }) =>
    bind.scope === scope || bind.scope === 'any';
  const pageBinds = keymap.page
    .filter((bind) => firesInScope(bind) && bind.keys[0] !== pageLeader)
    .map((bind) => ({ keys: pageVimKeys(bind.keys), command: bind.command }));
  const boxBinds = keymap.editor.binds
    .filter(
      (bind) =>
        firesInScope(bind) && vimTokens(bind.keys, leader)[0] !== leader,
    )
    .map((bind) => ({ keys: bind.keys, command: bind.command }));
  const listed = new Set<string>();
  const unplaced: UnplacedBind[] = [];
  for (const bind of [...pageBinds, ...boxBinds]) {
    const pair = `${bind.keys} ${bind.command}`;
    const isLeftOut =
      isVimKeys(bind.keys) || placed.has(bind.command) || listed.has(pair);
    if (!isLeftOut) {
      listed.add(pair);
      unplaced.push(bind);
    }
  }
  return unplaced;
}

// The log line, under `[keys]`, for a bind firing in `scope` with no anchor.
export function unplacedLine(bind: UnplacedBind, scope: ViewScope): string {
  return `unplaced ${bind.keys} ${bind.command} in ${scope}`;
}
