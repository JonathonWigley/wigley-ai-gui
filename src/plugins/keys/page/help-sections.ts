import type { Keymap } from '../../../contracts/keymap';
import type { OsName } from '../../../contracts/platform';
import type { ScopeInfo } from '../../../contracts/plugin';
import {
  type CommandLabel,
  type KeyHint,
  chordName,
  editorHints,
  formatAccelerator,
  formatKeys,
  formatVimKeys,
  mergeHints,
} from '../../../shared/key-hints';

export interface HelpSection {
  title: string;
  hints: KeyHint[];
}

// Every bound key, for the help overlay: for each scope in `scopes` order, its
// page binds under its title and then its text box binds; then the text box's
// remaps and the app's and system's chords. Every key prints for `platform`.
// Sections with no binds are left out.
export function helpSections(
  keymap: Keymap,
  scopes: readonly ScopeInfo[],
  label: CommandLabel,
  platform: OsName,
): HelpSection[] {
  const readVimKeys = (keys: string) =>
    formatVimKeys(keys, keymap.editor.leader, platform);
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
          platform,
        ),
      },
    ]),
    {
      title: 'Remaps in a text box',
      hints: keymap.editor.remaps.map((remap) => ({
        keys: readVimKeys(remap.keys),
        label: `sends ${readVimKeys(remap.to)} in ${remap.mode} mode`,
      })),
    },
    {
      title: 'App chords',
      hints: mergeHints(
        [
          ...keymap.app.map((bind) => ({
            keys: formatAccelerator(bind.accelerator, platform),
            command: bind.command,
          })),
          ...keymap.intercept.map((bind) => ({
            keys: chordName(bind, platform),
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
          keys: formatAccelerator(bind.accelerator, platform),
          command: bind.command,
        })),
        label,
      ),
    },
  ];
  return sections.filter((section) => section.hints.length > 0);
}
