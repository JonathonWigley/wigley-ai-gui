import type { CommandId } from '../../../contracts/commands';
import type {
  EditorKeymap,
  InterceptBind,
  Keymap,
  PageBind,
  ViewScope,
} from '../../../contracts/keymap';

export interface KeyHint {
  keys: string;
  label: string;
}

export interface HelpSection {
  title: string;
  hints: KeyHint[];
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

// By qualified scope, in help-overlay order.
const SCOPE_TITLES: Record<ViewScope, string> = {
  'forms.forms': 'In the form',
  'forms.review': 'In the review',
  'forms.confirm': 'In the cancel confirmation',
  'forms.help': 'In help',
  'forms.idle': 'With no round open',
  any: 'Everywhere',
};

const DIGIT_SUFFIX = /^(.*?)(\d)$/;

// A page key sequence as the user reads it, e.g. `Space Space` or `z a`.
export function formatKeys(keys: string[]): string {
  return keys.map((key) => KEY_NAMES[key] ?? key).join(' ');
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
      .map(pageKeys),
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

// Every bound key, for the help overlay; sections with no binds are left out.
export function helpSections(
  keymap: Keymap,
  label: CommandLabel,
): HelpSection[] {
  const scopes = Object.keys(SCOPE_TITLES) as ViewScope[];
  const sections: HelpSection[] = [
    ...scopes.map((scope) => ({
      title: SCOPE_TITLES[scope],
      hints: mergeHints(
        keymap.page.filter((bind) => bind.scope === scope).map(pageKeys),
        label,
      ),
    })),
    {
      title: 'In a text box (vim normal mode)',
      hints: editorHints(keymap.editor, label),
    },
    {
      title: 'Remaps in a text box',
      hints: keymap.editor.remaps.map((remap) => ({
        keys: withLeader(remap.keys, keymap.editor.leader),
        label: `sends ${remap.to} in ${remap.mode} mode`,
      })),
    },
    {
      title: 'App chords',
      hints: mergeHints(
        [
          ...keymap.app.map((bind) => ({
            keys: bind.accelerator,
            command: bind.command,
          })),
          ...keymap.intercept.map((bind) => ({
            keys: chordName(bind),
            command: bind.command,
          })),
        ],
        label,
      ),
    },
    {
      title: 'System-wide chords',
      hints: mergeHints(
        keymap.global.map((bind) => ({
          keys: bind.accelerator,
          command: bind.command,
        })),
        label,
      ),
    },
  ];
  return sections.filter((section) => section.hints.length > 0);
}

function pageKeys(bind: PageBind): BoundKeys {
  return { keys: formatKeys(bind.keys), command: bind.command };
}

function withLeader(keys: string, leader: string): string {
  return keys.replaceAll('<Leader>', leader);
}

function chordName(bind: InterceptBind): string {
  const modifiers = [
    bind.control && 'Control',
    bind.alt && 'Alt',
    bind.shift && 'Shift',
    bind.meta && 'Command',
  ].filter(Boolean);
  return [...modifiers, bind.key].join('+');
}

// Neighbouring binds with one label become one hint.
function mergeHints(bound: BoundKeys[], label: CommandLabel): KeyHint[] {
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
function joinKeys(keys: string[]): string {
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
