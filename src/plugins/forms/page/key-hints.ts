import type { Keymap, ViewScope } from '../../../contracts/keymap';
import {
  type CommandLabel,
  chordName,
  editorHints,
  formatKeys,
  type KeyHint,
  mergeHints,
  withLeader,
} from '../../../shared/key-hints';
import { type FormsScopeName, formsScope } from '../ids';

export interface HelpSection {
  title: string;
  hints: KeyHint[];
}

type HelpScope = FormsScopeName | 'any';

// By short scope name, in help-overlay order; every forms scope needs a title,
// or its binds drop out of the help overlay.
const SCOPE_TITLES: Record<HelpScope, string> = {
  forms: 'In the form',
  review: 'In the review',
  confirm: 'In the cancel confirmation',
  help: 'In help',
  idle: 'With no round open',
  any: 'Everywhere',
};

function qualifiedScope(scope: HelpScope): ViewScope {
  return scope === 'any' ? 'any' : formsScope(scope);
}

// Every bound key, for the help overlay; sections with no binds are left out.
export function helpSections(
  keymap: Keymap,
  label: CommandLabel,
): HelpSection[] {
  const scopes = Object.keys(SCOPE_TITLES) as HelpScope[];
  const sections: HelpSection[] = [
    ...scopes.map((scope) => ({
      title: SCOPE_TITLES[scope],
      hints: mergeHints(
        keymap.page
          .filter((bind) => bind.scope === qualifiedScope(scope))
          .map((bind) => ({
            keys: formatKeys(bind.keys),
            command: bind.command,
          })),
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
