import type { CommandArg, CommandId } from '../../../contracts/commands';
import type { Keymap, PageBind, ViewScope } from '../../../contracts/keymap';
import type { OsName } from '../../../contracts/platform';
import {
  type CommandLabel,
  formatKeys,
  joinKeys,
} from '../../../shared/key-hints';
import { isSameJson } from '../../../shared/json';
import { pageKeysFor } from '../../../shared/key-notation';
import { qualify } from '../../../shared/plugin-manifests';
import { keysManifest } from '../manifest';

// One row of the leader search: a command with its bind's `arg`, its label,
// and every leader key that runs it, printed for the platform.
export interface LeaderAction {
  command: CommandId;
  arg?: CommandArg;
  label: string;
  keys: string;
}

const SEARCH_LEADER = qualify(keysManifest.id, 'searchLeader');

// The leader actions firing in `scope`: the page binds starting with the
// leader's page key whose scope is `scope` or `any`, the search's own bind
// left out. A bind only a box holds is no page bind, so it is never listed.
// One row per command and arg (compared as JSON data), in
// keymap order of its first bind; its keys are each bind's, joined.
export function leaderActions(
  keymap: Keymap,
  scope: ViewScope,
  label: CommandLabel,
  platform: OsName,
): LeaderAction[] {
  const [leaderKey] = pageKeysFor('<Leader>', keymap.editor.leader);
  const rows: { bind: PageBind; keys: string[] }[] = [];
  for (const bind of keymap.page) {
    const isLeaderActionInForce =
      bind.keys[0] === leaderKey &&
      (bind.scope === scope || bind.scope === 'any') &&
      bind.command !== SEARCH_LEADER;
    if (!isLeaderActionInForce) {
      continue;
    }
    const keys = formatKeys(bind.keys, platform);
    const row = rows.find(
      (each) =>
        each.bind.command === bind.command &&
        isSameJson(each.bind.arg, bind.arg),
    );
    if (row === undefined) {
      rows.push({ bind, keys: [keys] });
    } else {
      row.keys.push(keys);
    }
  }
  return rows.map(({ bind, keys }) => ({
    command: bind.command,
    ...(bind.arg === undefined ? {} : { arg: bind.arg }),
    label: label(bind.command),
    keys: joinKeys(keys),
  }));
}
