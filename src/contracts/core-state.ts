import type { ViewScope } from './keymap';
import type { SlotKey } from './state';

// The shown mode's qualified id, written at each change of the shown mode. `''`
// means no change has been told yet: `modes.shown()` throws while no mode shows, so
// no real id is available as the page starts, and adding the first mode tells no
// change. `modes.shown()` reads the mode showing now.
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

// `pageReady` is emitted once per page load on the page bus, after each page part
// has started and heard the current config. A part hears it by naming
// `QualifiedEvents<'core', CoreEvents>` in its `Heard`, with no `dependsOn` entry.
export interface CoreEvents {
  pageReady: null;
}
