import type { AppConfig } from '../contracts/settings';
import { withoutPluginBinds } from '../shared/plugin-manifests';

// `config` as the page runs it: without the editor and page binds of the
// plugins in `loadList`, the ones this page did not start, every other field
// as it was.
export function startedPluginsConfig(
  config: AppConfig,
  loadList: readonly string[],
): AppConfig {
  return {
    ...config,
    keymap: withoutPluginBinds(
      config.keymap,
      config.commands,
      loadList,
      'page',
    ),
  };
}
