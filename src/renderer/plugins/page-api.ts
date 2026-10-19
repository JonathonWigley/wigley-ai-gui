import type { Bridge } from '../../contracts/bridge';
import type { CommandId } from '../../contracts/commands';
import type { Keymap } from '../../contracts/keymap';
import type {
  Area,
  AreaName,
  ChannelShape,
  PageApi,
  PageCommandContext,
  PageServices,
  PluginManifest,
} from '../../contracts/plugin';
import { qualify } from '../../shared/plugin-manifests';

// What the page core shares with every plugin's API. `setScope` takes a
// qualified scope; `keymap` is the merged keymap.
export interface PageApiDeps {
  areas: Record<AreaName, Area>;
  bridge: Bridge;
  setScope(qualified: string): void;
  keymap: Keymap;
  label(id: CommandId): string;
  settings: object;
  services: PageServices;
  run(id: CommandId, context?: PageCommandContext): void;
  dependency<E>(pluginId: string): E;
}

// One plugin's page API: its channel runs under the manifest's id, and the
// scopes it sets are qualified by it.
export function createPageApi(
  manifest: PluginManifest,
  deps: PageApiDeps,
): PageApi<PluginManifest, ChannelShape> {
  return {
    areas: deps.areas,
    channel: {
      invoke: (method, ...args) =>
        deps.bridge.invoke(manifest.id, method, args),
      on: (message, listener) =>
        deps.bridge.onMessage(manifest.id, message, listener),
    },
    keys: {
      setScope: (scope) => deps.setScope(qualify(manifest.id, scope)),
      keymap: deps.keymap,
      label: deps.label,
    },
    settings: deps.settings,
    commands: { run: deps.run },
    services: deps.services,
    dependency: deps.dependency,
  };
}
