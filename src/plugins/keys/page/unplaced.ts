import type { CommandArg, CommandId } from '../../../contracts/commands';
import type { Keymap, ViewScope } from '../../../contracts/keymap';
import { commandTarget } from '../../../shared/command-args';
import { vimTokens } from '../../../shared/key-hints';
import { pageKeysFor } from '../../../shared/key-notation';
import { UNPLACED_MESSAGE_START } from '../../../shared/placement-check';
import { isVimKeys, pageVimKeys } from '../../../shared/vim-keys';

// A bind with no anchor: its keys in vim notation and the command they run, with
// its argument.
export interface UnplacedBind {
  keys: string;
  command: CommandId;
  arg?: CommandArg;
}

// The binds firing in `scope` (`any` binds included) whose `commandTarget` `placed`
// does not hold: page binds, then box binds, each pair once. Leader sequences,
// which which-key shows, and vim's own keys are left out.
export function unplacedBinds(
  keymap: Keymap,
  scope: ViewScope,
  placed: ReadonlySet<string>,
): UnplacedBind[] {
  const { leader } = keymap.editor;
  const pageLeader = pageKeysFor(leader, leader)[0];
  const firesInScope = (bind: { scope: ViewScope }) =>
    bind.scope === scope || bind.scope === 'any';
  const pageBinds = keymap.page
    .filter((bind) => firesInScope(bind) && bind.keys[0] !== pageLeader)
    .map((bind) => ({
      keys: pageVimKeys(bind.keys),
      command: bind.command,
      ...(bind.arg !== undefined && { arg: bind.arg }),
    }));
  const boxBinds = keymap.editor.binds
    .filter(
      (bind) =>
        firesInScope(bind) && vimTokens(bind.keys, leader)[0] !== leader,
    )
    .map((bind) => ({
      keys: bind.keys,
      command: bind.command,
      ...(bind.arg !== undefined && { arg: bind.arg }),
    }));
  const listed = new Set<string>();
  const unplaced: UnplacedBind[] = [];
  for (const bind of [...pageBinds, ...boxBinds]) {
    const target = commandTarget(bind.command, bind.arg);
    const pair = `${bind.keys} ${target}`;
    const isLeftOut =
      isVimKeys(bind.keys) || placed.has(target) || listed.has(pair);
    if (!isLeftOut) {
      listed.add(pair);
      unplaced.push(bind);
    }
  }
  return unplaced;
}

// The log line, under `[keys]`, for a bind firing in `scope` with no anchor.
export function unplacedLine(bind: UnplacedBind, scope: ViewScope): string {
  return `${UNPLACED_MESSAGE_START}${bind.keys} ${commandTarget(bind.command, bind.arg)} in ${scope}`;
}
