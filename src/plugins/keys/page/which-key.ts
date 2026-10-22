import type { CommandId } from '../../../contracts/commands';
import type { Keymap, PendingKeys } from '../../../contracts/keymap';
import type { Platform } from '../../../contracts/platform';
import type { CommandInfo } from '../../../contracts/plugin';
import { vimTokenForPageKey } from '../../../shared/key-notation';
import {
  type CommandLabel,
  formatKeys,
  formatVimToken,
  joinKeys,
  vimTokens,
} from '../../../shared/key-hints';

// One key that continues the pending sequence: a `command` it runs, or a
// `prefix` that leads to more keys.
export interface WhichKeyEntry {
  keys: string;
  label: string;
  kind: 'command' | 'prefix';
}

// `title` is the pending keys as the user reads them, e.g. `Space a`.
export interface WhichKeyModel {
  title: string;
  entries: WhichKeyEntry[];
}

interface Candidate {
  keys: string[];
  command: CommandId;
}

// The keys that continue `pending`, in keymap order: those firing in the
// pending scope (or `any`), on the page or in a box. A prefix the keymap's
// `groups` names is labelled with that name.
// Neighbouring entries of one kind and label merge into one, and chords print
// for `platform`. Null when no bind continues the sequence.
export function whichKeyModel(
  pending: PendingKeys,
  keymap: Keymap,
  command: (id: CommandId) => CommandInfo | undefined,
  label: CommandLabel,
  platform: Platform,
): WhichKeyModel | null {
  const candidates = continuations(pending.keys, bindsFor(pending, keymap));
  if (candidates.length === 0) {
    return null;
  }
  const readKey =
    pending.where === 'page'
      ? (key: string) => formatKeys([key], platform)
      : (token: string) => formatVimToken(token, platform);
  const vimToken =
    pending.where === 'page' ? vimTokenForPageKey : (token: string) => token;
  const pendingTokens = pending.keys.map(vimToken);
  const entries = byNextKey(candidates, pending.keys.length).map(
    ([key, binds]) =>
      entry(
        readKey(key),
        binds,
        pending.keys.length,
        groupName([...pendingTokens, vimToken(key)], keymap),
        command,
        label,
      ),
  );
  return {
    title: pending.keys.map(readKey).join(' '),
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

// The `groups` name of the prefix `tokens` (vim tokens), if any.
function groupName(tokens: string[], keymap: Keymap): string | undefined {
  for (const [keys, name] of Object.entries(keymap.groups)) {
    const groupTokens = vimTokens(keys, keymap.editor.leader);
    const isThisPrefix =
      groupTokens.length === tokens.length &&
      groupTokens.every((token, i) => token === tokens[i]);
    if (isThisPrefix) {
      return name;
    }
  }
  return undefined;
}

// A key with any bind running past it is a prefix, labelled `+` and its
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
    return { keys, label: `+${groupName}`, kind: 'prefix' };
  }
  const groups = new Set<string>();
  for (const bind of binds) {
    const group = command(bind.command)?.group;
    if (group !== undefined) {
      groups.add(group);
    }
  }
  return { keys, label: `+${[...groups].join(', ')}`, kind: 'prefix' };
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
