import type { Keymap } from '../../../contracts/keymap';
import type { ScopeInfo } from '../../../contracts/plugin';
import {
  type CommandLabel,
  type KeyHint,
  chordName,
  editorHints,
  formatKeys,
  mergeHints,
  withLeader,
} from '../../../shared/key-hints';

export interface HelpSection {
  title: string;
  hints: KeyHint[];
}

// Every bound key, for the help overlay: a section per scope in `scopes`
// order under its title, then the text box's binds and remaps and the app's
// and system's chords. Sections with no binds are left out.
export function helpSections(
  keymap: Keymap,
  scopes: readonly ScopeInfo[],
  label: CommandLabel,
): HelpSection[] {
  const sections: HelpSection[] = [
    ...scopes.map((info) => ({
      title: info.title,
      hints: mergeHints(
        keymap.page
          .filter((bind) => bind.scope === info.id)
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
