import type {
  AcceleratorBind,
  InterceptBind,
  KeyBind,
  ViewScope,
} from './keymap';
import type { CommandInfo } from './plugin';
import type { PluginOrigin } from './plugin-catalog';
import type { SlotKey } from './state';

// The shown mode's qualified id, written at each change of the shown mode, the
// first mode's `add` included. `''` means no mode shows: the page has added none
// yet, or every mode is disposed.
export const coreModeSlot: SlotKey<string, 'page', 'core'> = {
  id: 'core.mode',
  process: 'page',
  kind: 'value',
};

// The qualified scope page keys fire in now.
export const coreScopeSlot: SlotKey<ViewScope, 'page', 'core'> = {
  id: 'core.scope',
  process: 'page',
  kind: 'value',
};

// The name of the theme on screen, which is the last good one while the theme
// `settings.json` names fails to resolve.
export const coreThemeSlot: SlotKey<string, 'page', 'core'> = {
  id: 'core.theme',
  process: 'page',
  kind: 'value',
};

export const coreWindowFocusedSlot: SlotKey<boolean, 'main', 'core'> = {
  id: 'core.windowFocused',
  process: 'main',
  kind: 'value',
};

// The commands and binds one process's parts added while they run. `started` is
// true once that process's parts have started, and false again from the first
// write of a new page.
export interface RuntimeCatalog {
  readonly commands: readonly CommandInfo[];
  readonly binds: {
    readonly binds: readonly KeyBind[];
    readonly app: readonly AcceleratorBind[];
    readonly intercept: readonly InterceptBind[];
  };
  readonly started: boolean;
}

export const coreRuntimeMainSlot: SlotKey<RuntimeCatalog, 'main', 'core'> = {
  id: 'core.runtimeMain',
  process: 'main',
  kind: 'value',
};

export const coreRuntimePageSlot: SlotKey<RuntimeCatalog, 'page', 'core'> = {
  id: 'core.runtimePage',
  process: 'page',
  kind: 'value',
};

export interface PluginStatus {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly on: boolean;
  readonly neededBy: readonly string[];
  readonly origin: PluginOrigin;
  readonly problem: string | null;
}

// Every plugin in the catalog, in catalog order, then each plugin that failed
// its first load: its label, its description, its origin, whether a version of
// it runs now, the ids of the plugins that run now and depend on it, and its
// problem or null. Main's plugin switch writes it at start and after each
// change.
export const corePluginsSlot: SlotKey<readonly PluginStatus[], 'main', 'core'> =
  {
    id: 'core.plugins',
    process: 'main',
    kind: 'value',
  };
