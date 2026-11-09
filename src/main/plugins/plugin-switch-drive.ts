import type { Disposable } from '../../contracts/disposable';
import type { DriveHost } from '../../contracts/plugin';
import type {
  ConfigWriteResult,
  UserConfig,
} from '../../contracts/user-config';
import { createRegistrations } from '../../shared/registrations';
import type { PluginSwitch } from './plugin-switch';

export interface PluginSwitchActionDeps {
  pluginSwitch: Pick<PluginSwitch, 'restart' | 'settled'>;
  userConfig: Pick<UserConfig, 'read' | 'writeSettings'>;
  // The ids of the plugins the config holds now.
  ids(): readonly string[];
  // Loads plugin `id` again from its folder; rejects with `No plugin "<id>"`
  // for an unknown id and with its own text for a built-in.
  reload(id: string): Promise<void>;
  // The `plugins.disabled` the config serves now.
  disabled(): readonly string[];
}

const ID_ARGS = '{ id: string }';

// The id `args` carries; throws for args that are not `{ id: string }`.
function idArgOf(name: string, args: unknown): string {
  const isIdArgs =
    typeof args === 'object' &&
    args !== null &&
    typeof (args as { id?: unknown }).id === 'string';
  if (!isIdArgs) {
    throw new Error(`${name} takes ${ID_ARGS}`);
  }
  return (args as { id: string }).id;
}

// The id `args` carries; throws for args that are not `{ id: string }` or an id `ids` does not hold.
function pluginIdOf(
  name: string,
  args: unknown,
  ids: readonly string[],
): string {
  const id = idArgOf(name, args);
  if (!ids.includes(id)) {
    throw new Error(`No plugin "${id}"`);
  }
  return id;
}

// Writes `settings.json`'s `plugins.disabled` as `change` makes it from the list it holds now (the
// config's when the file sets none); an unchanged list writes nothing.
async function writeDisabled(
  deps: PluginSwitchActionDeps,
  change: (disabled: readonly string[]) => readonly string[],
): Promise<ConfigWriteResult> {
  const { settings } = await deps.userConfig.read();
  if (settings.state === 'broken') {
    throw new Error(`settings.json is broken: ${settings.problem}`);
  }
  const layer = settings.layer ?? {};
  const plugins = (layer.plugins ?? {}) as Record<string, unknown>;
  const disabled = Array.isArray(plugins.disabled)
    ? (plugins.disabled as string[])
    : deps.disabled();
  const next = change(disabled);
  const isUnchanged =
    next.length === disabled.length &&
    next.every((id, index) => id === disabled[index]);
  if (isUnchanged) {
    return { type: 'written' };
  }
  return deps.userConfig.writeSettings(
    { ...layer, plugins: { ...plugins, disabled: next } },
    settings.text,
  );
}

// The drive actions `stopPlugin` and `startPlugin`, which write `plugins.disabled` in `settings.json` so the
// config's change reaches the switch, `restartPlugin`, which restarts through the switch, and `reloadPlugin`,
// which loads a user plugin again and waits for the switch to act on it.
export function addPluginSwitchActions(
  drive: DriveHost,
  deps: PluginSwitchActionDeps,
): Disposable {
  const registrations = createRegistrations();
  registrations.track(
    drive.add('stopPlugin', {
      description:
        'Switches plugin id off: adds it to plugins.disabled in settings.json.',
      args: ID_ARGS,
      run: async (args) => {
        const id = pluginIdOf('stopPlugin', args, deps.ids());
        return writeDisabled(deps, (disabled) =>
          disabled.includes(id) ? disabled : [...disabled, id],
        );
      },
    }),
  );
  registrations.track(
    drive.add('startPlugin', {
      description:
        'Switches plugin id on: removes it from plugins.disabled in settings.json.',
      args: ID_ARGS,
      run: async (args) => {
        const id = pluginIdOf('startPlugin', args, deps.ids());
        return writeDisabled(deps, (disabled) =>
          disabled.filter((each) => each !== id),
        );
      },
    }),
  );
  registrations.track(
    drive.add('restartPlugin', {
      description:
        'Stops plugin id and the plugins that depend on it, then starts them again; their slots are kept.',
      args: ID_ARGS,
      run: async (args) => {
        const id = pluginIdOf('restartPlugin', args, deps.ids());
        await deps.pluginSwitch.restart(id);
        return null;
      },
    }),
  );
  registrations.track(
    drive.add('reloadPlugin', {
      description:
        'Loads user plugin id again from its folder with no file change, stopping and starting its dependents.',
      args: ID_ARGS,
      run: async (args) => {
        const id = idArgOf('reloadPlugin', args);
        await deps.reload(id);
        await deps.pluginSwitch.settled();
        return null;
      },
    }),
  );
  return registrations;
}
