import type { CommandId } from './commands';
import type { Disposable } from './disposable';
import type {
  AcceleratorBind,
  InterceptBind,
  KeyBind,
  KeyGroups,
  UserKeymap,
} from './keymap';
import type { CommandInfo, ScopeInfo } from './plugin';

// How a row edits a leaf setting. `kind` is the id of a control kind the
// settings page registers: a built-in (`number`, `string`, `boolean`,
// `choice`, `theme`, `json`) or a plugin's. `choices` holds the only strings
// a closed setting takes, null for any other.
export interface SettingControl {
  kind: string;
  choices: readonly string[] | null;
}

// `path` nests as settings.json does: core `fonts.ui`, plugin `forms.autosaveDelayMs`.
// `fallback` null: the defaults leave it unset (`fonts.ui`); otherwise the default, null included.
export interface SettingLeaf {
  path: string;
  label: string;
  description: string;
  control: SettingControl;
  fallback: { value: unknown } | null;
}

// `id` is `core` or the plugin id; `title` is `Core` or the id with its first letter upper-cased.
export interface SettingSection {
  id: string;
  title: string;
  leaves: readonly SettingLeaf[];
}

// `sections`: core first, then each plugin with at least one leaf, in manifest order.
// `defaultBindLayers`: the binds of each default layer unmerged, the default keymap's then each manifest's `keys.binds`,
// qualified, in merge order; a later layer's bind replacing an earlier one depends on the user's leader, so the reader
// merges them (`defaultBindLines`).
// `defaultAccelerators`: the same layers' `app`, `global` and `intercept` binds merged, a later layer's replacing an
// earlier one on the same chord; main commands run on them.
// `defaultGroups`: the same layers' `groups` names, a later layer's name replacing an earlier one's on the same prefix.
export interface UserConfigSchema {
  sections: readonly SettingSection[];
  commands: Readonly<Record<CommandId, CommandInfo>>;
  scopes: readonly ScopeInfo[];
  defaultBindLayers: readonly (readonly KeyBind[])[];
  defaultAccelerators: {
    app: readonly AcceleratorBind[];
    global: readonly AcceleratorBind[];
    intercept: readonly InterceptBind[];
  };
  defaultGroups: KeyGroups;
  defaultLeader: string;
}

// `text` null: no file. `layer` null with state `ok`: no file.
export type ConfigFileRead<L> =
  | { state: 'ok'; layer: L | null; text: string | null }
  | { state: 'broken'; problem: string; text: string | null };

// `themes`: every theme name, built-ins first, then the user's by name.
export interface UserConfigRead {
  settings: ConfigFileRead<Record<string, unknown>>;
  keymap: ConfigFileRead<UserKeymap>;
  themes: readonly string[];
}

export type ConfigWriteResult =
  | { type: 'written' }
  | { type: 'refused'; problem: string }
  | { type: 'changedOnDisk' };

// The user's own layers of settings.json and keymap.json. A write runs the
// ConfigStore's check of that file on `layer` and refuses one that fails; it
// refuses as `changedOnDisk` when the file's text is no longer `expectedText`
// (null: no file). `onChanged` hears each config the ConfigStore serves.
export interface UserConfig {
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
  onChanged(listener: () => void): Disposable;
}
