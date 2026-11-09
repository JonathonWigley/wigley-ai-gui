import type { PluginStatus } from '../../../contracts/core-state';
import type { FuzzyMatcher } from '../../../contracts/fuzzy';
import type { PluginOrigin } from '../../../contracts/plugin-catalog';
import type { SettingLeaf } from '../../../contracts/user-config';
import { settingsManifest } from '../manifest';
import { withSetting } from './setting-edits';
import { userValue } from './setting-rows';

// The core setting the Plugins section writes.
export const PLUGIN_LIST_PATH = 'plugins.disabled';

// What Settings' own row shows while it runs: switched off from its own
// section, it could come back only by a hand edit.
export const SETTINGS_LOCKED_TEXT = 'Edit settings.json to turn off';

// `Needed by <label>, <label>` for a plugin that runs and that running plugins
// depend on, and `Edit settings.json to turn off` on Settings' own row while
// it runs; else null.
export function lockedText(
  status: PluginStatus,
  statuses: readonly PluginStatus[],
): string | null {
  if (!status.on) {
    return null;
  }
  if (status.id === settingsManifest.id) {
    return SETTINGS_LOCKED_TEXT;
  }
  if (status.neededBy.length === 0) {
    return null;
  }
  const labels = status.neededBy.map(
    (id) => statuses.find((each) => each.id === id)?.label ?? id,
  );
  return `Needed by ${labels.join(', ')}`;
}

// The origin Tag's text: `user` for a plugin from the user's folder,
// `replaces built-in` for one that replaces a built-in plugin, null for a
// built-in plugin, which draws no origin Tag.
export function originText(origin: PluginOrigin): string | null {
  switch (origin) {
    case 'user':
      return 'user';
    case 'replaces-built-in':
      return 'replaces built-in';
    case 'built-in':
      return null;
  }
}

// `layer` with `pluginId` switched on or off in the `plugins.disabled` list.
export function withPluginSwitched(
  layer: Record<string, unknown> | null,
  leaf: SettingLeaf,
  pluginId: string,
  isOn: boolean,
): Record<string, unknown> {
  const user = userValue(layer, leaf.path);
  const listed =
    user.isSet && Array.isArray(user.value) ? user.value : leaf.fallback?.value;
  if (!Array.isArray(listed)) {
    throw new Error(`${leaf.path} holds no list to switch ${pluginId} in`);
  }
  if (isOn) {
    return withSetting(
      layer,
      leaf,
      listed.filter((id) => id !== pluginId),
    );
  }
  return withSetting(
    layer,
    leaf,
    listed.includes(pluginId) ? listed : [...listed, pluginId],
  );
}

// Whether `query` fuzzily matches the plugin's label or id.
export function matchesPlugin(
  status: PluginStatus,
  query: string,
  matcher: FuzzyMatcher,
): boolean {
  return (
    matcher.matches(query, status.label) || matcher.matches(query, status.id)
  );
}
