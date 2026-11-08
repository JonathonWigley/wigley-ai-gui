// The settings plugin's channel between its main and page parts: the user
// config's schema, reads and guarded layer writes, and the plugin switch's
// ask before a switch-off, served from main.

import type { CommandKey } from '../../contracts/commands';
import type { UserKeymap } from '../../contracts/keymap';
import type { ChannelShape } from '../../contracts/plugin';
import type { SlotKey } from '../../contracts/state';
import type {
  ConfigWriteResult,
  UserConfigRead,
  UserConfigSchema,
} from '../../contracts/user-config';

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
// the row does.
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

// Where the user was in Settings mode, so a page reload puts them back: the
// side bar's cursor, the open section, the cursor row's key and the filter.
export interface SettingsPlace {
  sectionsCursor: number;
  openSectionId: string;
  cursorKey: string | null;
  filter: string;
}

export const settingsPlaceSlot: SlotKey<SettingsPlace, 'page', 'settings'> = {
  id: 'settings.place',
  process: 'page',
  kind: 'value',
};
