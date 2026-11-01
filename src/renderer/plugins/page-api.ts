import type { Bridge } from '../../contracts/bridge';
import type { CommandId } from '../../contracts/commands';
import type { Disposable } from '../../contracts/disposable';
import type {
  Area,
  AreaName,
  ChannelShape,
  PageChannel,
  Modes,
  PageApi,
  PageCommandContext,
  PageServices,
  PluginAreas,
  PageTransparency,
  PluginManifest,
  ShellLayout,
  UntypedEvents,
} from '../../contracts/plugin';
import type { AppConfig } from '../../contracts/settings';
import type { UiState } from '../../contracts/ui-state';
import { dataUrl } from '../../shared/data-url';
import { type EventBus, pluginEvents } from '../../shared/event-bus';
import type { PageLayouts } from '../../shared/page/layout-host/show-layouts';
import { qualify } from '../../shared/plugin-manifests';
import type { ScopeStack } from '../key-scope';
import type { LiveConfig } from '../live-config';
import type { PaneTargets } from '../pane-targets';
import type { PendingKeysHub } from '../pending-keys';

// What the page core shares with every plugin's API. `scopeStack` holds
// qualified scopes; `pendingKeys` is the page's one pending-key report;
// `config` is the config main serves now, which the keymap, commands, scopes
// and settings are read from at each call; `bus` is the page load's event bus;
// `modes` is the core's mode registry, which takes qualified ids. `areas`
// holds every area; plugins get the title bar, panel, status bar and overlay.
// `setLayout` replaces the shell's layout. `transparency` is the page's one
// transparency override, handed to every plugin as it is. `services` are the
// ones every plugin shares; `uiState` gives each plugin its own scope of the
// ui state. `layouts` shows each owner's layouts. `paneTargets` takes the
// resize and focus targets and the outer panes a plugin hands the pane commands.
export interface PageApiDeps {
  areas: Record<AreaName, Area>;
  modes: Modes;
  setLayout(layout: ShellLayout): Disposable;
  transparency: PageTransparency;
  bridge: Bridge;
  scopeStack: ScopeStack;
  pendingKeys: Pick<PendingKeysHub, 'onPending' | 'hold' | 'cancel'>;
  config: LiveConfig;
  services: Omit<PageServices, 'uiState'>;
  uiState: { scoped(prefix: string): UiState };
  run(id: CommandId, context?: PageCommandContext): void;
  dependency<E>(pluginId: string): E;
  bus: EventBus;
  layouts: PageLayouts;
  paneTargets: Pick<
    PaneTargets,
    'setResizeTarget' | 'setFocusTarget' | 'setOuterPanes'
  >;
}

// One plugin's page API: its channel and its events run under the manifest's
// id, and the scopes it sets and pushes and the modes it adds are qualified by
// it. Its areas leave out `main`, which only the mode registry fills, and the
// activity bar and side bar, which the core draws from the modes. Its
// settings are its own entry in the config's plugin settings, and its ui state
// is scoped to its id. Its layout shows run under its id.
export function createPageApi(
  manifest: PluginManifest,
  deps: PageApiDeps,
): PageApi<PluginManifest, ChannelShape, UntypedEvents, UntypedEvents> {
  const { config } = deps;
  const settingsOf = (served: AppConfig) => served.pluginSettings[manifest.id];
  return {
    areas: pluginAreas(deps.areas),
    channel: pageChannel(manifest.id, deps.bridge),
    events: pluginEvents(deps.bus, manifest.id, deps.services.log),
    keys: {
      setScope: (scope) => deps.scopeStack.setBase(qualify(manifest.id, scope)),
      pushScope: (scope) => deps.scopeStack.push(qualify(manifest.id, scope)),
      scope: () => deps.scopeStack.current(),
      onScopeChanged: (listener) => deps.scopeStack.onChange(listener),
      onPending: (listener) => deps.pendingKeys.onPending(listener),
      holdPending: () => deps.pendingKeys.hold(),
      cancelPending: () => deps.pendingKeys.cancel(),
      keymap: () => config.current().keymap,
      onKeymapChanged: (listener) =>
        onChangedPart(config, (served) => served.keymap, listener),
      label: (id) => config.current().commands[id]?.label ?? id,
      command: (id) => config.current().commands[id],
      get scopes() {
        return config.current().scopes;
      },
    },
    modes: {
      add: (mode) =>
        deps.modes.add({ ...mode, id: qualify(manifest.id, mode.id) }),
      shown: () => deps.modes.shown(),
      onChanged: (listener) => deps.modes.onChanged(listener),
    },
    shell: { setLayout: (layout) => deps.setLayout(layout) },
    transparency: deps.transparency,
    panes: {
      setResizeTarget: (target) => deps.paneTargets.setResizeTarget(target),
      setFocusTarget: (target) => deps.paneTargets.setFocusTarget(target),
      setOuterPanes: (panes) => deps.paneTargets.setOuterPanes(panes),
    },
    settings: () => settingsOf(config.current()),
    onSettingsChanged: (listener) =>
      onChangedPart(config, settingsOf, listener),
    platform: config.current().platform,
    commands: { run: deps.run },
    services: { ...deps.services, uiState: deps.uiState.scoped(manifest.id) },
    dependency: deps.dependency,
    dataUrl: (path, revision) => dataUrl(manifest.id, revision, path),
    layouts: { show: (options) => deps.layouts.show(manifest.id, options) },
  };
}

// Calls `listener` with the part of each new config `part` reads, only when
// it differs from the previous config's, compared as JSON.
function onChangedPart<T>(
  config: LiveConfig,
  part: (served: AppConfig) => T,
  listener: (changed: T) => void,
): Disposable {
  return config.onChanged((next, previous) => {
    const changed = part(next);
    if (JSON.stringify(changed) !== JSON.stringify(part(previous))) {
      listener(changed);
    }
  });
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
    titleBar: areas.titleBar,
    panel: areas.panel,
    statusBar: areas.statusBar,
    overlay: areas.overlay,
  };
}
