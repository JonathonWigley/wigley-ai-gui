// Key hints as the user reads them: the formatting which-key, help and the
// status bar's key list share.

import type { CommandId } from '../contracts/commands';
import type {
  EditorKeymap,
  InterceptBind,
  PageBind,
  ViewScope,
} from '../contracts/keymap';

export interface KeyHint {
  keys: string;
  label: string;
}

// What a command is called in hints and help; a command with no label reads
// as its id.
export type CommandLabel = (id: CommandId) => string;

interface BoundKeys {
  keys: string;
  command: CommandId;
}

const KEY_NAMES: Partial<Record<string, string>> = {
  ' ': 'Space',
  Escape: 'Esc',
};

const VIM_TOKEN_NAMES: Partial<Record<string, string>> = {
  '<Space>': 'Space',
  '<Esc>': 'Esc',
  '<CR>': 'Enter',
};

const VIM_TOKEN = /<[^<>]+>|./gu;

const DIGIT_SUFFIX = /^(.*?)(\d)$/;

// A page key sequence as the user reads it, e.g. `Space Space` or `z a`.
export function formatKeys(keys: string[]): string {
  return keys.map((key) => KEY_NAMES[key] ?? key).join(' ');
}

// One vim-notation token as the user reads it, e.g. `<Space>` as `Space`.
export function formatVimToken(token: string): string {
  return VIM_TOKEN_NAMES[token] ?? token;
}

// A vim-notation key string as its tokens, a `<…>` group or one character
// each, every `<Leader>` spelled as `leader`.
export function vimTokens(keys: string, leader: string): string[] {
  return withLeader(keys, leader).match(VIM_TOKEN) ?? [];
}

// The page keys that fire in the qualified `scope`, `any` binds included.
export function pageHints(
  binds: PageBind[],
  scope: ViewScope,
  label: CommandLabel,
): KeyHint[] {
  return mergeHints(
    binds
      .filter((bind) => bind.scope === scope || bind.scope === 'any')
      .map((bind) => ({ keys: formatKeys(bind.keys), command: bind.command })),
    label,
  );
}

// The binds inside a text box, `<Leader>` spelled as the leader key.
export function editorHints(
  editor: EditorKeymap,
  label: CommandLabel,
): KeyHint[] {
  return mergeHints(
    editor.binds.map((bind) => ({
      keys: withLeader(bind.keys, editor.leader),
      command: bind.command,
    })),
    label,
  );
}

export function withLeader(keys: string, leader: string): string {
  return keys.replaceAll('<Leader>', leader);
}

// An intercepted chord as the user reads it, e.g. `Control+Tab`.
export function chordName(bind: InterceptBind): string {
  const modifiers = [
    bind.control && 'Control',
    bind.alt && 'Alt',
    bind.shift && 'Shift',
    bind.meta && 'Command',
  ].filter(Boolean);
  return [...modifiers, bind.key].join('+');
}

// Neighbouring binds with one label become one hint.
export function mergeHints(bound: BoundKeys[], label: CommandLabel): KeyHint[] {
  const groups: { keys: string[]; label: string }[] = [];
  for (const { keys, command } of bound) {
    const commandLabel = label(command);
    const last = groups.at(-1);
    if (last?.label === commandLabel) {
      last.keys.push(keys);
    } else {
      groups.push({ keys: [keys], label: commandLabel });
    }
  }
  return groups.map((group) => ({
    keys: joinKeys(group.keys),
    label: group.label,
  }));
}

// Three or more keys ending in consecutive digits after one prefix read as a
// range, e.g. `1–9` or `<Space>1–9`.
export function joinKeys(keys: string[]): string {
  const first = DIGIT_SUFFIX.exec(keys[0]);
  if (first === null || keys.length < 3) {
    return keys.join(' / ');
  }
  const [, prefix, digit] = first;
  const isDigitRun = keys.every(
    (key, i) => key === `${prefix}${Number(digit) + i}`,
  );
  return isDigitRun
    ? `${keys[0]}–${Number(digit) + keys.length - 1}`
    : keys.join(' / ');
}
