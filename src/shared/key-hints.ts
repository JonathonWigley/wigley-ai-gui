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
import { type Chord, parseChord } from './chord-notation';

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

// The vim key names a hint spells its own way, by their lowercase spelling, as
// vim reads names in any case.
const VIM_KEY_NAMES: Partial<Record<string, string>> = {
  space: 'Space',
  esc: 'Esc',
  cr: 'Enter',
  enter: 'Enter',
  return: 'Enter',
  lt: '<',
  bar: '|',
  bslash: '\\',
};

const VIM_TOKEN = /<[^<>]+>|./gu;

// A vim `<…>` key: its modifier prefixes, each one letter and a dash, then the
// key.
const VIM_KEY = /^<((?:[a-z]-)*)(.+)>$/iu;

// The flag each vim modifier sets on a chord. `M-` is what
// @replit/codemirror-vim names the Meta key (Command on macOS, Windows
// elsewhere); `D-` is vim's Command.
const VIM_MODIFIERS: Partial<Record<string, keyof Omit<Chord, 'key'>>> = {
  c: 'ctrl',
  a: 'alt',
  s: 'shift',
  m: 'meta',
  d: 'meta',
};

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
  return chord === null ? token : printChord(chord, platform);
}

// `chord` as the user reads it on `platform`: one character as its capital, a
// named key by the platform's name for it or as it is spelled.
function printChord(chord: Chord, platform: Platform): string {
  const style = CHORD_STYLES[platform];
  const { modifiers } = style;
  const held = [
    chord.ctrl && modifiers.ctrl,
    chord.alt && modifiers.alt,
    chord.shift && modifiers.shift,
    chord.meta && modifiers.meta,
  ].filter((name): name is string => name !== false);
  const key =
    style.keyNames[chord.key] ??
    (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return [...held, key].join(style.joiner);
}

// The chord a vim `<…>` key with at least one modifier writes, its modifiers
// in any order and case, e.g. `<S-C-a>`; a capital letter holds Shift, so
// `<A-O>` is Alt+Shift+O. Null for a plain key, a `<…>` key with no modifier,
// or an unknown modifier.
function vimChord(token: string): Chord | null {
  const parts = VIM_KEY.exec(token);
  if (parts === null || parts[1] === '') {
    return null;
  }
  const chord: Chord = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: parts[2],
  };
  for (const prefix of parts[1].toLowerCase().split('-').slice(0, -1)) {
    const flag = VIM_MODIFIERS[prefix];
    if (flag === undefined) {
      return null;
    }
    chord[flag] = true;
  }
  const isCapitalLetter =
    chord.key.length === 1 && chord.key !== chord.key.toLowerCase();
  if (isCapitalLetter) {
    chord.shift = true;
    chord.key = chord.key.toLowerCase();
  }
  chord.key = VIM_KEY_NAMES[chord.key.toLowerCase()] ?? chord.key;
  return chord;
}

// A page key sequence as the user reads it on `platform`, e.g. `Space Space`,
// `z a` or `⌥O`.
export function formatKeys(keys: string[], platform: Platform): string {
  return keys
    .map((key) => KEY_NAMES[key] ?? formatChord(key, platform))
    .join(' ');
}

// One vim-notation token as the user reads it on `platform`, e.g. `<Space>` as
// `Space`, `<Tab>` as `Tab`, `<M-x>` as `⌘X` on macOS and `Win+X` elsewhere. A
// token that is neither a `<…>` key nor a chord, such as `w` or `<X-a>`,
// returns as it is.
export function formatVimToken(token: string, platform: Platform): string {
  const chord = vimChord(token);
  if (chord !== null) {
    return printChord(chord, platform);
  }
  const parts = VIM_KEY.exec(token);
  if (parts === null || parts[1] !== '') {
    return token;
  }
  return VIM_KEY_NAMES[parts[2].toLowerCase()] ?? parts[2];
}

// A vim-notation key string as the user reads it on `platform`, its tokens
// spaced as page keys are, e.g. `<Leader>w` with leader `<Space>` as `Space w`.
export function formatVimKeys(
  keys: string,
  leader: string,
  platform: Platform,
): string {
  return vimTokens(keys, leader)
    .map((token) => formatVimToken(token, platform))
    .join(' ');
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

// The binds inside a text box, `<Leader>` spelled as the leader key and
// chords printed for `platform`.
export function editorHints(
  editor: EditorKeymap,
  label: CommandLabel,
  platform: Platform,
): KeyHint[] {
  return mergeHints(
    editor.binds.map((bind) => ({
      keys: formatVimKeys(bind.keys, editor.leader, platform),
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
