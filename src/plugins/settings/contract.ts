// The settings plugin's channel between its main and page parts: the user
// config's schema, reads and guarded layer writes, and the plugin switch's
// ask before a switch-off, served from main. Its page part's exports register
// the control kinds setting rows draw and edit with.

import type { CommandKey } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type { UserKeymap } from '../../contracts/keymap';
import type { ChannelShape, DependencyKey } from '../../contracts/plugin';
import type { SlotKey } from '../../contracts/state';
import type {
  ConfigWriteResult,
  SettingLeaf,
  UserConfigRead,
  UserConfigSchema,
} from '../../contracts/user-config';

// What a box's text commits as: a value, the setting left unset, or a problem
// shown under the box.
export type SettingBoxValue =
  | { type: 'value'; value: unknown }
  | { type: 'unset' }
  | { type: 'problem'; problem: string };

// What a picker kind reads for its items: the row's leaf and the user config
// last read.
export interface SettingKindRead {
  leaf: SettingLeaf;
  config: UserConfigRead;
}

// How a kind edits its row. A `box` opens a text box under the row: `line` is
// one line, `document` the document editor over `<path>.json`; `text` is the
// text it opens with for a set value (the box opens empty for an unset or null
// one), and `parse` reads its text back. A `picker` opens the list picker on
// `items`, each row's line its `label`, the cursor on the row's value; the open
// list reads `items` again on each newer user config read.
export type SettingKindEditor =
  | {
      type: 'box';
      box: 'line' | 'document';
      text(value: unknown): string;
      parse(text: string): SettingBoxValue;
    }
  | {
      type: 'picker';
      items(read: SettingKindRead): readonly unknown[];
      label(item: unknown): string;
    };

// A control kind: `id` is the kind a setting's `control.kind` names; `text`
// prints a set value on the row's one line (an unset or null one prints
// `Not set`, with no call).
export interface SettingControlKind {
  id: string;
  text(value: unknown): string;
  edit: SettingKindEditor;
}

// The settings page part's exports. `addControlKind` registers `kind` until
// its `dispose` or the dependent's stop, the open section redrawing with it
// each time; it throws `control kind <id> is already registered` for an id a
// registration holds, the built-ins' included. A row whose kind no
// registration holds draws its value as JSON and only resets.
export interface SettingsPageExports {
  addControlKind(kind: SettingControlKind): Disposable;
}

export const settingsPageKey: DependencyKey<
  SettingsPageExports,
  'page',
  'settings'
> = { id: 'settings', process: 'page' };

// Every method rejects with main's own error text when its handler throws.
export interface SettingsChannel extends ChannelShape {
  invoke: {
    schema(): UserConfigSchema;
    read(): Promise<UserConfigRead>;
    writeSettings(
      layer: Record<string, unknown>,
      expectedText: string | null,
    ): Promise<ConfigWriteResult>;
    writeKeymap(
      layer: UserKeymap,
      expectedText: string | null,
    ): Promise<ConfigWriteResult>;
    // The reason turning plugin pluginId off would be refused now, or null.
    mayDisable(pluginId: string): Promise<string | null>;
  };
  messages: {
    // The ConfigStore served a new config: read again.
    changed: null;
    // Show Settings mode (`Cmd+,`).
    show: null;
  };
}

// Moves the cursor to the row `arg` keys and focuses the rows, as a click on
// the row does; in the Leader menu, the cursor and focus of the pane holding
// the row.
export const settingsMoveToRowCommand: CommandKey<
  string,
  'settings.moveToRow'
> = { id: 'settings.moveToRow' };

// Opens the section at index `arg` of the side bar's list, as a click on it
// does.
export const settingsOpenSectionAtCommand: CommandKey<
  number,
  'settings.openSectionAt'
> = { id: 'settings.openSectionAt' };

// The Leader menu's cursors: each pane's cursor row key, null for none.
export interface LeaderCursors {
  groups: string | null;
  items: string | null;
}

// Where the user was in Settings mode, so a page reload puts them back: the
// side bar's cursor, the open section, the cursor row's key, the filter and
// the Leader menu's cursors.
export interface SettingsPlace {
  sectionsCursor: number;
  openSectionId: string;
  cursorKey: string | null;
  filter: string;
  leaderCursors: LeaderCursors;
}

export const settingsPlaceSlot: SlotKey<SettingsPlace, 'page', 'settings'> = {
  id: 'settings.place',
  process: 'page',
  kind: 'value',
};
