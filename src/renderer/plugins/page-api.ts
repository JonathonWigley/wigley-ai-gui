import type { Bridge } from '../../contracts/bridge';
import type { CommandId } from '../../contracts/commands';
import type { Keymap } from '../../contracts/keymap';
import type {
  Area,
  AreaName,
  ChannelShape,
  CommandInfo,
  PageApi,
  PageCommandContext,
  PageServices,
  PluginManifest,
  ScopeInfo,
  UntypedEvents,
} from '../../contracts/plugin';
import { type EventBus, pluginEvents } from '../../shared/event-bus';
import { qualify } from '../../shared/plugin-manifests';
import type { ScopeStack } from '../key-scope';
import type { PendingKeysHub } from '../pending-keys';

// What the page core shares with every plugin's API. `scopeStack` holds
// qualified scopes; `pendingKeys` is the page's one pending-key report;
// `keymap` is the merged keymap; `commandInfo` and `scopes` are as main serves
// them; `bus` is the page load's event bus.
export interface PageApiDeps {
  areas: Record<AreaName, Area>;
  bridge: Bridge;
  scopeStack: ScopeStack;
  pendingKeys: Pick<PendingKeysHub, 'onPending' | 'hold' | 'cancel'>;
  keymap: Keymap;
  label(id: CommandId): string;
  commandInfo: Record<CommandId, CommandInfo>;
  scopes: readonly ScopeInfo[];
  settings: object;
  services: PageServices;
  run(id: CommandId, context?: PageCommandContext): void;
  dependency<E>(pluginId: string): E;
  bus: EventBus;
}

// One plugin's page API: its channel and its events run under the manifest's
// id, and the scopes it sets and pushes are qualified by it.
export function createPageApi(
  manifest: PluginManifest,
  deps: PageApiDeps,
): PageApi<PluginManifest, ChannelShape, UntypedEvents, UntypedEvents> {
  return {
    areas: deps.areas,
    channel: {
      invoke: (method, ...args) =>
        deps.bridge.invoke(manifest.id, method, args),
      on: (message, listener) =>
        deps.bridge.onMessage(manifest.id, message, listener),
    },
    events: pluginEvents(deps.bus, manifest.id),
    keys: {
      setScope: (scope) => deps.scopeStack.setBase(qualify(manifest.id, scope)),
      pushScope: (scope) => deps.scopeStack.push(qualify(manifest.id, scope)),
      scope: () => deps.scopeStack.current(),
      onScopeChanged: (listener) => deps.scopeStack.onChange(listener),
      onPending: (listener) => deps.pendingKeys.onPending(listener),
      holdPending: () => deps.pendingKeys.hold(),
      cancelPending: () => deps.pendingKeys.cancel(),
      keymap: deps.keymap,
      label: deps.label,
      command: (id) => deps.commandInfo[id],
      scopes: deps.scopes,
    },
    settings: deps.settings,
    commands: { run: deps.run },
    services: deps.services,
    dependency: deps.dependency,
  };
}
