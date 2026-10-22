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

// The KeyboardEvent.key value of each vim key name a hint prints its own way,
// by its lowercase spelling, as vim reads names in any case.
const VIM_KEY_NAMES: Partial<Record<string, string>> = {
  space: ' ',
  esc: 'Escape',
  cr: 'Enter',
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  bs: 'Backspace',
  del: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  lt: '<',
  bar: '|',
  bslash: '\\',
};

// The KeyboardEvent.key value of each Electron accelerator key name a hint
// prints its own way, by its lowercase spelling.
const ACCELERATOR_KEY_NAMES: Partial<Record<string, string>> = {
  space: ' ',
  plus: '+',
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
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

// How each platform prints a key: a chord's modifier names in the order
// Control, Alt, Shift, Meta, the text between them and the key, and the name
// of each named key, by its KeyboardEvent.key value, alone or in a chord.
interface ChordStyle {
  modifiers: { ctrl: string; alt: string; shift: string; meta: string };
  joiner: string;
  keyNames: Partial<Record<string, string>>;
}

const MAC_CHORDS: ChordStyle = {
  modifiers: { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' },
  joiner: '',
  keyNames: {
    ' ': 'Space',
    Enter: '↩',
    Tab: '⇥',
    Escape: '⎋',
    Backspace: '⌫',
    Delete: '⌦',
    ArrowLeft: '←',
    ArrowUp: '↑',
    ArrowRight: '→',
    ArrowDown: '↓',
  },
};

const PC_CHORDS: ChordStyle = {
  modifiers: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' },
  joiner: '+',
  keyNames: {
    ' ': 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowLeft: 'Left',
    ArrowUp: 'Up',
    ArrowRight: 'Right',
    ArrowDown: 'Down',
  },
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
// `z a`, `⌥O`, or `Escape` as `⎋` on macOS and `Esc` elsewhere.
export function formatKeys(keys: string[], platform: Platform): string {
  const { keyNames } = CHORD_STYLES[platform];
  return keys
    .map((key) => keyNames[key] ?? formatChord(key, platform))
    .join(' ');
}

// One vim-notation token as the user reads it on `platform`, e.g. `<Space>` as
// `Space`, `<Tab>` as `⇥` on macOS and `Tab` elsewhere, `<M-x>` as `⌘X` on
// macOS and `Win+X` elsewhere. A token that is neither a `<…>` key nor a
// chord, such as `w` or `<X-a>`, returns as it is.
export function formatVimToken(token: string, platform: Platform): string {
  const chord = vimChord(token);
  if (chord !== null) {
    return printChord(chord, platform);
  }
  const parts = VIM_KEY.exec(token);
  if (parts === null || parts[1] !== '') {
    return token;
  }
  const key = VIM_KEY_NAMES[parts[2].toLowerCase()] ?? parts[2];
  return CHORD_STYLES[platform].keyNames[key] ?? key;
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

// An intercepted chord as the user reads it on `platform`, e.g. Control+Tab
// as `⌃⇥` on macOS and `Ctrl+Tab` elsewhere.
export function chordName(bind: InterceptBind, platform: Platform): string {
  return printChord(
    {
      ctrl: bind.control ?? false,
      alt: bind.alt ?? false,
      shift: bind.shift ?? false,
      meta: bind.meta ?? false,
      key: bind.key,
    },
    platform,
  );
}

// An Electron accelerator as the user reads it on `platform`, e.g.
// `CommandOrControl+Shift+K` as `⇧⌘K` on macOS and `Ctrl+Shift+K` elsewhere.
// An accelerator with a modifier a chord cannot hold, such as AltGr, returns
// as it is.
export function formatAccelerator(
  accelerator: string,
  platform: Platform,
): string {
  const parts = accelerator.split('+');
  const key = parts[parts.length - 1];
  const chord: Chord = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: ACCELERATOR_KEY_NAMES[key.toLowerCase()] ?? key,
  };
  for (const modifier of parts.slice(0, -1)) {
    const flag = acceleratorModifier(modifier, platform);
    if (flag === null) {
      return accelerator;
    }
    chord[flag] = true;
  }
  return printChord(chord, platform);
}

// The chord flag an accelerator modifier sets on `platform`; null for AltGr or
// an unknown modifier.
function acceleratorModifier(
  modifier: string,
  platform: Platform,
): keyof Omit<Chord, 'key'> | null {
  switch (modifier.toLowerCase()) {
    case 'control':
    case 'ctrl':
      return 'ctrl';
    case 'alt':
    case 'option':
      return 'alt';
    case 'shift':
      return 'shift';
    case 'command':
    case 'cmd':
    case 'super':
    case 'meta':
      return 'meta';
    case 'commandorcontrol':
    case 'cmdorctrl':
      return platform === 'macos' ? 'meta' : 'ctrl';
    default:
      return null;
  }
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
// range, e.g. `1–9` or `Space 1–9`.
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
