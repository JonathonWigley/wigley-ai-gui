// Key hints as the user reads them: the formatting which-key, help and the
// status bar's key list share.

import type { CommandId } from '../contracts/commands';
import type {
  EditorBind,
  EditorKeymap,
  EditorMode,
  InterceptBind,
  PageBind,
  ViewScope,
} from '../contracts/keymap';
import type { Platform } from '../contracts/platform';
import { parseChord } from './chord-notation';

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

// How each platform prints a chord: its modifier names in the order Control,
// Alt, Shift, Meta, the text between them and the key, and the name of each
// key that is not a letter or digit.
interface ChordStyle {
  modifiers: { ctrl: string; alt: string; shift: string; meta: string };
  joiner: string;
  keyNames: Partial<Record<string, string>>;
}

const MAC_CHORDS: ChordStyle = {
  modifiers: { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' },
  joiner: '',
  keyNames: { Enter: '↩' },
};

const PC_CHORDS: ChordStyle = {
  modifiers: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' },
  joiner: '+',
  keyNames: { Enter: 'Enter' },
};

const CHORD_STYLES: Record<Platform, ChordStyle> = {
  macos: MAC_CHORDS,
  windows: PC_CHORDS,
  linux: PC_CHORDS,
};

// A page-notation chord as the user reads it on `platform`, e.g. `<S-D-k>` as
// `⇧⌘K` on macOS and `Shift+Win+K` elsewhere. A token that is no chord returns
// as it is.
export function formatChord(token: string, platform: Platform): string {
  const chord = parseChord(token);
  if (chord === null) {
    return token;
  }
  const style = CHORD_STYLES[platform];
  const { modifiers } = style;
  const held = [
    chord.ctrl && modifiers.ctrl,
    chord.alt && modifiers.alt,
    chord.shift && modifiers.shift,
    chord.meta && modifiers.meta,
  ].filter((name): name is string => name !== false);
  const key = style.keyNames[chord.key] ?? chord.key.toUpperCase();
  return [...held, key].join(style.joiner);
}

// A page key sequence as the user reads it on `platform`, e.g. `Space Space`,
// `z a` or `⌥O`.
export function formatKeys(keys: string[], platform: Platform): string {
  return keys
    .map((key) => KEY_NAMES[key] ?? formatChord(key, platform))
    .join(' ');
}

// One vim-notation token as the user reads it on `platform`, e.g. `<Space>` as
// `Space`.
export function formatVimToken(token: string, platform: Platform): string {
  return VIM_TOKEN_NAMES[token] ?? formatChord(token, platform);
}

// A vim-notation key string as its tokens, a `<…>` group or one character
// each, every `<Leader>` spelled as `leader`.
export function vimTokens(keys: string, leader: string): string[] {
  return withLeader(keys, leader).match(VIM_TOKEN) ?? [];
}

// The vim mode an editor bind fires in; normal when the bind names none.
export function editorBindMode(bind: EditorBind): EditorMode {
  return bind.mode ?? 'normal';
}

// The page keys that fire in the qualified `scope`, `any` binds included,
// chords printed for `platform`.
export function pageHints(
  binds: PageBind[],
  scope: ViewScope,
  label: CommandLabel,
  platform: Platform,
): KeyHint[] {
  return mergeHints(
    binds
      .filter((bind) => bind.scope === scope || bind.scope === 'any')
      .map((bind) => ({
        keys: formatKeys(bind.keys, platform),
        command: bind.command,
      })),
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

// Neighbouring binds with one label become one hint, each key listed once.
export function mergeHints(bound: BoundKeys[], label: CommandLabel): KeyHint[] {
  const groups: { keys: string[]; label: string }[] = [];
  for (const { keys, command } of bound) {
    const commandLabel = label(command);
    const last = groups.at(-1);
    const isRepeat = last?.label === commandLabel && last.keys.includes(keys);
    if (isRepeat) {
      continue;
    }
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
