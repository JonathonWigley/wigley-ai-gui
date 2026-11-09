import type { CommandId } from '../../../contracts/commands';
import type { Keymap, PendingKeys } from '../../../contracts/keymap';
import type { OsName } from '../../../contracts/platform';
import type { CommandInfo } from '../../../contracts/plugin';
import { pageKeysFor } from '../../../shared/key-notation';
import {
  type CommandLabel,
  formatKeys,
  formatVimToken,
  joinKeys,
  unnamedGroupName,
  vimTokens,
} from '../../../shared/key-hints';

// One key that continues the pending sequence: a `command` it runs, or a
// `prefix` that leads to more keys.
export interface WhichKeyEntry {
  keys: string;
  label: string;
  kind: 'command' | 'prefix';
}

// `title` is the pending keys as the user reads them, e.g. `Space a`;
// `name` is the keymap's `groups` name for those keys, null when none names
// them.
export interface WhichKeyModel {
  title: string;
  name: string | null;
  entries: WhichKeyEntry[];
}

interface Candidate {
  keys: string[];
  command: CommandId;
}

// The keys that continue `pending`, in keymap order: those firing in the
// pending scope (or `any`), on the page or in a box. A prefix the keymap's
// `groups` names is labelled with that name, matched in the pending keys'
// own spelling: page keys on the page, vim tokens in a box; the model's
// `name` is the pending keys' own group name. Neighbouring entries of one
// kind and label merge into one, and chords print for `platform`. Null when
// no bind continues the sequence.
export function whichKeyModel(
  pending: PendingKeys,
  keymap: Keymap,
  command: (id: CommandId) => CommandInfo | undefined,
  label: CommandLabel,
  platform: OsName,
): WhichKeyModel | null {
  const candidates = continuations(pending.keys, bindsFor(pending, keymap));
  if (candidates.length === 0) {
    return null;
  }
  const readKey =
    pending.where === 'page'
      ? (key: string) => formatKeys([key], platform)
      : (token: string) => formatVimToken(token, platform);
  const groups = groupPrefixes(pending.where, keymap);
  const entries = byNextKey(candidates, pending.keys.length).map(
    ([key, binds]) =>
      entry(
        readKey(key),
        binds,
        pending.keys.length,
        groupName([...pending.keys, key], groups),
        command,
        label,
      ),
  );
  return {
    title: pending.keys.map(readKey).join(' '),
    name: groupName(pending.keys, groups) ?? null,
    entries: mergeNeighbours(entries),
  };
}

function bindsFor(pending: PendingKeys, keymap: Keymap): Candidate[] {
  const firesInPendingScope = (bind: { scope: string }) =>
    bind.scope === pending.scope || bind.scope === 'any';
  if (pending.where === 'editor') {
    return keymap.editor.binds.filter(firesInPendingScope).map((bind) => ({
      keys: vimTokens(bind.keys, keymap.editor.leader),
      command: bind.command,
    }));
  }
  return keymap.page.filter(firesInPendingScope);
}

function continuations(pending: string[], binds: Candidate[]): Candidate[] {
  return binds.filter(
    (bind) =>
      bind.keys.length > pending.length &&
      pending.every((key, i) => bind.keys[i] === key),
  );
}

// Each next key with its binds, in the order the key first appears.
function byNextKey(
  candidates: Candidate[],
  depth: number,
): [string, Candidate[]][] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = candidate.keys[depth];
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [candidate]);
    } else {
      group.push(candidate);
    }
  }
  return [...groups];
}

interface GroupPrefix {
  keys: string[];
  name: string;
}

// The keymap's `groups`, each prefix spelled as `where` reports pending keys:
// page keys on the page, vim tokens in a box. A prefix holding a key the page
// cannot press names no page group.
function groupPrefixes(
  where: PendingKeys['where'],
  keymap: Keymap,
): GroupPrefix[] {
  const { leader } = keymap.editor;
  const prefixes: GroupPrefix[] = [];
  for (const [keys, name] of Object.entries(keymap.groups)) {
    const prefix =
      where === 'page'
        ? pressablePageKeys(keys, leader)
        : vimTokens(keys, leader);
    if (prefix !== null) {
      prefixes.push({ keys: prefix, name });
    }
  }
  return prefixes;
}

// The page keys `keys` press, or null when it holds a `<…>` token the page
// has no key for.
function pressablePageKeys(keys: string, leader: string): string[] | null {
  try {
    return pageKeysFor(keys, leader);
  } catch {
    return null;
  }
}

// The name of the group prefix equal to `keys`, if any.
function groupName(keys: string[], groups: GroupPrefix[]): string | undefined {
  for (const group of groups) {
    const isThisPrefix =
      group.keys.length === keys.length &&
      group.keys.every((key, i) => key === keys[i]);
    if (isThisPrefix) {
      return group.name;
    }
  }
  return undefined;
}

// A key with any bind running past it is a prefix, labelled with its
// `groupName`, or without one its binds' command groups; otherwise it runs
// its command.
function entry(
  keys: string,
  binds: Candidate[],
  depth: number,
  groupName: string | undefined,
  command: (id: CommandId) => CommandInfo | undefined,
  label: CommandLabel,
): WhichKeyEntry {
  const isPrefix = binds.some((bind) => bind.keys.length > depth + 1);
  if (!isPrefix) {
    return { keys, label: label(binds[0].command), kind: 'command' };
  }
  if (groupName !== undefined) {
    return { keys, label: groupName, kind: 'prefix' };
  }
  return {
    keys,
    label: unnamedGroupName(binds.map((bind) => command(bind.command)?.group)),
    kind: 'prefix',
  };
}

function mergeNeighbours(entries: WhichKeyEntry[]): WhichKeyEntry[] {
  const runs: { keys: string[]; label: string; kind: WhichKeyEntry['kind'] }[] =
    [];
  for (const { keys, label, kind } of entries) {
    const last = runs.at(-1);
    if (last?.kind === kind && last.label === label) {
      last.keys.push(keys);
    } else {
      runs.push({ keys: [keys], label, kind });
    }
  }
  return runs.map((run) => ({
    keys: joinKeys(run.keys),
    label: run.label,
    kind: run.kind,
  }));
}
