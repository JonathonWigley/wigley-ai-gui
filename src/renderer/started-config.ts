import type { AppConfig } from '../contracts/settings';
import type { CommandId } from '../contracts/commands';
import {
  withoutPluginBinds,
  withoutUnhandledRuntimeBinds,
} from '../shared/plugin-manifests';

// `config` as the page runs it: without the page and editor binds of the
// plugins in `notStarted` and of the runtime commands `has` finds no handler
// for, every other field as it was. Main has already removed the binds of the
// plugins that are off.
export function startedPluginsConfig(
  config: AppConfig,
  notStarted: readonly string[],
  has: (id: CommandId) => boolean,
): AppConfig {
  return {
    ...config,
    keymap: withoutUnhandledRuntimeBinds(
      withoutPluginBinds(config.keymap, config.commands, notStarted, 'page'),
      config.commands,
      has,
      'page',
    ),
  };
}
