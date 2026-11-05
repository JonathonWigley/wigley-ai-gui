import type { AppConfig } from '../contracts/settings';
import type { CommandId } from '../contracts/commands';
import {
  withoutPluginBinds,
  withoutUnhandledRuntimeBinds,
} from '../shared/plugin-manifests';

// `config` as the page runs it: without the editor and page binds of the
// plugins in `loadList`, the ones this page did not start, and of the runtime
// commands `has` finds no handler for, every other field as it was.
export function startedPluginsConfig(
  config: AppConfig,
  loadList: readonly string[],
  has: (id: CommandId) => boolean,
): AppConfig {
  return {
    ...config,
    keymap: withoutUnhandledRuntimeBinds(
      withoutPluginBinds(config.keymap, config.commands, loadList, 'page'),
      config.commands,
      has,
      'page',
    ),
  };
}
