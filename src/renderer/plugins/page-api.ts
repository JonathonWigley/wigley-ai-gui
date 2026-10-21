import type { Bridge } from '../../contracts/bridge';
import type { CommandId } from '../../contracts/commands';
import type { Keymap } from '../../contracts/keymap';
import type {
  Area,
  AreaName,
  ChannelShape,
  PageChannel,
  CommandInfo,
  Modes,
  PageApi,
  PageCommandContext,
  PageServices,
  PluginAreas,
  PluginManifest,
  ScopeInfo,
  UntypedEvents,
} from '../../contracts/plugin';
import { dataUrl } from '../../shared/data-url';
import { type EventBus, pluginEvents } from '../../shared/event-bus';
import { qualify } from '../../shared/plugin-manifests';
import type { ScopeStack } from '../key-scope';
import type { PendingKeysHub } from '../pending-keys';

// What the page core shares with every plugin's API. `scopeStack` holds
// qualified scopes; `pendingKeys` is the page's one pending-key report;
// `keymap` is the merged keymap; `commandInfo` and `scopes` are as main serves
// them; `bus` is the page load's event bus; `modes` is the core's mode
// registry, which takes qualified ids. `areas` holds every area, `main`
// included; plugins get every area but `main`.
export interface PageApiDeps {
  areas: Record<AreaName, Area>;
  modes: Modes;
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
// id, and the scopes it sets and pushes and the modes it adds are qualified by
// it. Its areas leave out `main`, which only the mode registry fills.
export function createPageApi(
  manifest: PluginManifest,
  deps: PageApiDeps,
): PageApi<PluginManifest, ChannelShape, UntypedEvents, UntypedEvents> {
  return {
    areas: pluginAreas(deps.areas),
    channel: pageChannel(manifest.id, deps.bridge),
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
    modes: {
      add: (mode) =>
        deps.modes.add({ ...mode, id: qualify(manifest.id, mode.id) }),
      shown: () => deps.modes.shown(),
      onChanged: (listener) => deps.modes.onChanged(listener),
    },
    settings: deps.settings,
    commands: { run: deps.run },
    services: deps.services,
    dependency: deps.dependency,
    dataUrl: (path, revision) => dataUrl(manifest.id, revision, path),
  };
}

// Plugin `pluginId`'s channel over the bridge. The bridge has no way to drop
// a listener, so the channel takes one bridge listener per message name, the
// first time it is listened to, and hands each message to the registrations
// not yet removed, in the order they were made.
function pageChannel(
  pluginId: string,
  bridge: Bridge,
): PageChannel<ChannelShape> {
  type Registration = { listener: (data: unknown) => void };
  const registrations = new Map<string, Set<Registration>>();
  const registrationsFor = (message: string): Set<Registration> => {
    let forMessage = registrations.get(message);
    if (forMessage === undefined) {
      const created = new Set<Registration>();
      bridge.onMessage(pluginId, message, (data) => {
        // A registration added while this message is delivered waits for the
        // next one; one removed meanwhile hears no more.
        for (const registration of Array.from(created)) {
          if (created.has(registration)) {
            registration.listener(data);
          }
        }
      });
      registrations.set(message, created);
      forMessage = created;
    }
    return forMessage;
  };
  return {
    invoke: (method, ...args) => bridge.invoke(pluginId, method, args),
    on: (message, listener) => {
      const forMessage = registrationsFor(message);
      const registration: Registration = {
        listener: listener as (data: unknown) => void,
      };
      forMessage.add(registration);
      return {
        remove: () => {
          forMessage.delete(registration);
        },
      };
    },
  };
}

function pluginAreas(areas: Record<AreaName, Area>): PluginAreas {
  return {
    activityBar: areas.activityBar,
    sideBar: areas.sideBar,
    panel: areas.panel,
    statusBar: areas.statusBar,
    overlay: areas.overlay,
  };
}
