import type { Keymap } from '../../../contracts/keymap';
import type { Platform } from '../../../contracts/platform';
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

// Every bound key, for the help overlay: for each scope in `scopes` order, its
// page binds under its title and then its text box binds; then the text box's
// remaps and the app's and system's chords. Page chords print for
// `platform`. Sections with no binds are left out.
export function helpSections(
  keymap: Keymap,
  scopes: readonly ScopeInfo[],
  label: CommandLabel,
  platform: Platform,
): HelpSection[] {
  const sections: HelpSection[] = [
    ...scopes.flatMap((info) => [
      {
        title: info.title,
        hints: mergeHints(
          keymap.page
            .filter((bind) => bind.scope === info.id)
            .map((bind) => ({
              keys: formatKeys(bind.keys, platform),
              command: bind.command,
            })),
          label,
        ),
      },
      {
        title: `${info.title}, in a text box`,
        hints: editorHints(
          {
            ...keymap.editor,
            binds: keymap.editor.binds.filter((bind) => bind.scope === info.id),
          },
          label,
        ),
      },
    ]),
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
