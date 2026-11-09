import type { CommandArg } from '../../../contracts/commands';
import type {
  KeyGroups,
  UserKeymap,
  ViewScope,
} from '../../../contracts/keymap';
import type { OsName } from '../../../contracts/platform';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import { isSameJson } from '../../../shared/json';
import {
  compareKeysUnder,
  compareText,
  formatVimKeys,
  normalLeaderKeys,
  normalVimKeys,
  unnamedGroupName,
  vimTokens,
} from '../../../shared/key-hints';
import {
  type BindLine,
  firesAnywhere,
  keymapLeader,
  keymapRows,
} from './keymap-rows';

// The prefix of the top level, and the first token of every leader bind.
export const LEADER = '<Leader>';

const TOP_LEVEL_NAME = 'Top level';

const FREE_KEY_CANDIDATES = [...'abcdefghijklmnopqrstuvwxyz0123456789'];

// One bind directly under a group: `key` the one token after the group's
// prefix as the bind writes it (`d`, `<Leader>`, `;`), `keys` the bind's whole
// keys.
export interface LeaderItem {
  key: string;
  keys: string;
  line: BindLine;
  command: CommandInfo;
  arg?: CommandArg;
}

export type LeaderEntry =
  | { type: 'item'; item: LeaderItem }
  | { type: 'group'; key: string; prefix: string };

// A group of the leader tree: `prefix` is `<Leader>` for the top level, else
// `<Leader>` and the `path` (`<Leader>b`, `<Leader>zl`). `isNamed` while a
// `groups` entry names it, `isSet` while the user's does; an unnamed group's
// `name` is its commands' manifest groups. `entries` in key order.
export interface LeaderGroup {
  prefix: string;
  path: readonly string[];
  name: string;
  isNamed: boolean;
  isSet: boolean;
  entries: readonly LeaderEntry[];
}

export type KeyTaken =
  | { type: 'item'; item: LeaderItem }
  | { type: 'group'; group: LeaderGroup };

interface Draft {
  path: string[];
  items: LeaderItem[];
  children: Draft[];
}

// The tokens of `keys` after its leading `<Leader>`, or null when `keys`
// does not start with the leader or holds nothing after it.
function tokensAfterLeader(keys: string): string[] | null {
  const tokens = vimTokens(keys, LEADER);
  const isUnderLeader =
    tokens.length >= 2 && tokens[0].toLowerCase() === LEADER.toLowerCase();
  return isUnderLeader ? tokens.slice(1) : null;
}

// Whether `line` fires and sits under the leader, as which-key lists it.
function isLeaderLine(line: BindLine): boolean {
  return firesAnywhere(line) && tokensAfterLeader(line.bind.keys) !== null;
}

// The name `groups` gives `prefix`, matching the keys through
// `normalLeaderKeys` under `leader`.
export function groupNameIn(
  groups: KeyGroups,
  prefix: string,
  leader: string,
): string | undefined {
  const normal = normalLeaderKeys(prefix, leader);
  return Object.entries(groups).find(
    ([keys]) => normalLeaderKeys(keys, leader) === normal,
  )?.[1];
}

// The tokens of a `groups` entry's keys after the leader, spelled `<Leader>`
// or as `leader`, or null when the keys do not run past the leader.
function groupTokensAfterLeader(keys: string, leader: string): string[] | null {
  const afterLeader = tokensAfterLeader(keys);
  if (afterLeader !== null) {
    return afterLeader;
  }
  const tokens = vimTokens(keys, leader);
  const leaderLength = vimTokens(leader, leader).length;
  const isUnderLeader =
    tokens.length > leaderLength &&
    normalVimKeys(tokens.slice(0, leaderLength).join('')) ===
      normalVimKeys(leader);
  return isUnderLeader ? tokens.slice(leaderLength) : null;
}

function pathId(path: readonly string[]): string {
  return normalVimKeys(path.join(''));
}

// `any` first, then the scopes in `schema.scopes` order, then unknown scopes
// by id.
function compareScopes(
  schema: UserConfigSchema,
  a: ViewScope,
  b: ViewScope,
): number {
  const rank = (scope: ViewScope) => {
    if (scope === 'any') {
      return -1;
    }
    const index = schema.scopes.findIndex((info) => info.id === scope);
    return index === -1 ? schema.scopes.length : index;
  };
  return rank(a) - rank(b) || compareText(a, b);
}

function entryKey(entry: LeaderEntry): string {
  return entry.type === 'item' ? entry.item.key : entry.key;
}

// Every node of the tree by its path's id, the top level under `''`; a node
// is made with every node above it, each linked to its parent.
function draftTree(): {
  nodes: Map<string, Draft>;
  nodeAt(path: readonly string[]): Draft;
} {
  const top: Draft = { path: [], items: [], children: [] };
  const nodes = new Map<string, Draft>([['', top]]);
  const nodeAt = (path: readonly string[]): Draft => {
    let node = top;
    for (let depth = 1; depth <= path.length; depth++) {
      const at = path.slice(0, depth);
      const id = pathId(at);
      let child = nodes.get(id);
      if (child === undefined) {
        child = { path: at, items: [], children: [] };
        nodes.set(id, child);
        node.children.push(child);
      }
      node = child;
    }
    return node;
  };
  return { nodes, nodeAt };
}

function sortedEntries(
  schema: UserConfigSchema,
  node: Draft,
  leader: string,
): LeaderEntry[] {
  const entries: LeaderEntry[] = [
    ...node.items.map((item): LeaderEntry => ({ type: 'item', item })),
    ...node.children.map((child): LeaderEntry => ({
      type: 'group',
      key: child.path[child.path.length - 1],
      prefix: LEADER + child.path.join(''),
    })),
  ];
  return entries.sort((a, b) => {
    const byKey = compareKeysUnder(entryKey(a), entryKey(b), leader);
    if (byKey !== 0) {
      return byKey;
    }
    if (a.type !== b.type) {
      return a.type === 'item' ? -1 : 1;
    }
    if (a.type === 'item' && b.type === 'item') {
      return compareScopes(
        schema,
        a.item.line.bind.scope,
        b.item.line.bind.scope,
      );
    }
    return 0;
  });
}

// The command groups of every item under `node` at any depth, in the tree's
// order.
function commandGroupsUnder(
  node: Draft,
  entriesOf: (node: Draft) => readonly LeaderEntry[],
  nodeOf: (prefix: string) => Draft,
): (string | undefined)[] {
  const groups: (string | undefined)[] = [];
  const pending: LeaderEntry[] = [...entriesOf(node)].reverse();
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    if (entry.type === 'item') {
      groups.push(entry.item.command.group);
    } else {
      pending.push(...[...entriesOf(nodeOf(entry.prefix))].reverse());
    }
  }
  return groups;
}

// The leader tree as which-key shows it: every bind in force whose keys start
// with `<Leader>` and run past it, each prefix such a bind runs past as a
// group, plus each prefix the user's `groups` names. The top level first,
// then every group depth-first, children in key order (`compareKeysUnder`).
// Tokens compare through `normalVimKeys`, the first spelling seen kept; a
// `groups` entry matches by `normalLeaderKeys`.
export function leaderTree(
  schema: UserConfigSchema,
  layer: UserKeymap | null,
): LeaderGroup[] {
  const { nodes, nodeAt } = draftTree();
  const leader = keymapLeader(schema, layer);
  for (const row of keymapRows(schema, layer).flatMap((group) => group.rows)) {
    for (const line of row.binds.filter(isLeaderLine)) {
      const tokens = tokensAfterLeader(line.bind.keys) ?? [];
      nodeAt(tokens.slice(0, -1)).items.push({
        key: tokens[tokens.length - 1],
        keys: line.bind.keys,
        line,
        command: row.command,
        ...(row.arg !== undefined && { arg: row.arg }),
      });
    }
  }
  const userGroups = layer?.groups ?? {};
  for (const keys of Object.keys(userGroups)) {
    const tokens = groupTokensAfterLeader(keys, leader);
    if (tokens !== null) {
      nodeAt(tokens);
    }
  }
  const entries = new Map<Draft, LeaderEntry[]>();
  const entriesOf = (node: Draft) => {
    let held = entries.get(node);
    if (held === undefined) {
      held = sortedEntries(schema, node, leader);
      entries.set(node, held);
    }
    return held;
  };
  const nodeOf = (prefix: string): Draft => {
    const node = nodes.get(normalVimKeys(prefix.slice(LEADER.length)));
    if (node === undefined) {
      throw new Error(`No leader group ${prefix}`);
    }
    return node;
  };
  const tree: LeaderGroup[] = [];
  const pending: Draft[] = [nodeAt([])];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    tree.push(
      leaderGroup(schema, userGroups, leader, node, entriesOf(node), () =>
        unnamedGroupName(commandGroupsUnder(node, entriesOf, nodeOf)),
      ),
    );
    const children = entriesOf(node).flatMap((entry) =>
      entry.type === 'group' ? [nodeOf(entry.prefix)] : [],
    );
    pending.push(...children.reverse());
  }
  return tree;
}

function leaderGroup(
  schema: UserConfigSchema,
  userGroups: KeyGroups,
  leader: string,
  node: Draft,
  entries: readonly LeaderEntry[],
  unnamed: () => string,
): LeaderGroup {
  const prefix = LEADER + node.path.join('');
  if (node.path.length === 0) {
    return {
      prefix,
      path: [],
      name: TOP_LEVEL_NAME,
      isNamed: false,
      isSet: false,
      entries,
    };
  }
  const userName = groupNameIn(userGroups, prefix, leader);
  const name = userName ?? groupNameIn(schema.defaultGroups, prefix, leader);
  return {
    prefix,
    path: node.path,
    name: name ?? unnamed(),
    isNamed: name !== undefined,
    isSet: userName !== undefined,
    entries,
  };
}

function isSameLine(a: BindLine, b: BindLine): boolean {
  return a.origin === b.origin && isSameJson(a.bind, b.bind);
}

// Whether a bind in `a` and one in `b` can fire together: equal scopes, or
// either `any`; no scope chosen yet (null) meets only `any`.
function scopesOverlap(a: ViewScope, b: ViewScope | null): boolean {
  if (b === null) {
    return a === 'any';
  }
  return a === b || a === 'any' || b === 'any';
}

// What holds `key` in `group` for a bind in `scope`: the first item on it,
// other than the `excluded` lines the edit moves or removes, whose scope
// overlaps; else a nested group on it; else null.
export function keyTaken(
  tree: readonly LeaderGroup[],
  group: LeaderGroup,
  key: string,
  scope: ViewScope | null,
  excluded: readonly BindLine[],
): KeyTaken | null {
  const normal = normalVimKeys(key);
  const isOnKey = (entry: LeaderEntry) =>
    normalVimKeys(entryKey(entry)) === normal;
  for (const entry of group.entries) {
    const isTakingItem =
      entry.type === 'item' &&
      isOnKey(entry) &&
      !excluded.some((line) => isSameLine(entry.item.line, line)) &&
      scopesOverlap(entry.item.line.bind.scope, scope);
    if (isTakingItem) {
      return { type: 'item', item: entry.item };
    }
  }
  const nested = group.entries.find(
    (entry) => entry.type === 'group' && isOnKey(entry),
  );
  if (nested?.type !== 'group') {
    return null;
  }
  const found = tree.find((each) => each.prefix === nested.prefix);
  return found === undefined ? null : { type: 'group', group: found };
}

// The letters `a`…`z`, then the digits, that no entry of `group` holds in
// any scope.
export function freeKeys(group: LeaderGroup): string[] {
  const held = new Set(
    group.entries.map((entry) => normalVimKeys(entryKey(entry))),
  );
  return FREE_KEY_CANDIDATES.filter((key) => !held.has(key));
}

// `Top level`, else the path printed for `platform` and the name:
// `b — session`, `z l — layout previews`.
export function groupTitle(
  group: LeaderGroup,
  leader: string,
  platform: OsName,
): string {
  if (group.path.length === 0) {
    return TOP_LEVEL_NAME;
  }
  return `${formatVimKeys(group.path.join(''), leader, platform)} — ${group.name}`;
}
