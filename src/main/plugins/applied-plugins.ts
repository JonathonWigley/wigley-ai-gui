import type { CommandId } from '../../contracts/commands';
import type { CommandInfo } from '../../contracts/plugin';
import type { AppConfig } from '../../contracts/settings';
import { withoutPluginBinds } from '../../shared/plugin-manifests';

// The applied list: the plugins whose parts do not run, which the served
// config carries as `plugins.disabled`.
export interface AppliedPlugins {
  disabled(): readonly string[];
  // Keeps its own copy of `disabled`; nothing listens.
  set(disabled: readonly string[]): void;
}

// The applied list, `initial` until the first `set`.
export function createAppliedPlugins(
  initial: readonly string[],
): AppliedPlugins {
  let current: readonly string[] = [...initial];
  return {
    disabled: () => current,
    set(disabled) {
      current = [...disabled];
    },
  };
}

// `config` as main serves it: `disabled` as its `plugins.disabled`, in place of
// the user's list, and without the binds and commands of the plugins in it,
// every other field as it was.
export function withAppliedList(
  config: AppConfig,
  disabled: readonly string[],
): AppConfig {
  const mainKept = withoutPluginBinds(
    config.keymap,
    config.commands,
    disabled,
    'main',
  );
  return {
    ...config,
    settings: { ...config.settings, plugins: { disabled: [...disabled] } },
    keymap: withoutPluginBinds(mainKept, config.commands, disabled, 'page'),
    commands: appliedCommands(config.commands, disabled),
  };
}

// `commands` without the commands of the plugins in `disabled`.
export function appliedCommands(
  commands: Readonly<Record<CommandId, CommandInfo>>,
  disabled: readonly string[],
): Record<CommandId, CommandInfo> {
  return Object.fromEntries(
    Object.entries(commands).filter(
      ([, info]) => !disabled.includes(info.plugin),
    ),
  );
}
