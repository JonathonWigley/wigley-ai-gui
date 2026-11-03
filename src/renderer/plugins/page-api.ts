import type { Bridge } from '../../contracts/bridge';
import type { CommandId } from '../../contracts/commands';
import type { Disposable, Registrations } from '../../contracts/disposable';
import type { PageDrops } from '../../contracts/drops';
import type { EditorHost } from '../../contracts/editor';
import type { MarkdownRenderer } from '../../contracts/markdown';
import type {
  FocusTarget,
  OuterPanes,
  ResizeTarget,
} from '../../contracts/panes';
import type {
  Area,
  AreaName,
  ChannelShape,
  DependencyKey,
  PageChannel,
  Modes,
  PageApi,
  PageCommandContext,
  PageServices,
  PluginAreas,
  PageTransparency,
  PluginManifest,
  PushedScope,
  ShellLayout,
  UntypedEvents,
} from '../../contracts/plugin';
import type { AppConfig } from '../../contracts/settings';
import type { UiState } from '../../contracts/ui-state';
import { dataUrl } from '../../shared/data-url';
import { type EventBus, pluginEvents } from '../../shared/event-bus';
import type { PageLayouts } from '../../shared/page/layout-host/show-layouts';
import { qualify } from '../../shared/plugin-manifests';
import { createRegistrations } from '../../shared/registrations';
import { trackedTimers } from '../../shared/tracked-timers';
import type { ScopeStack } from '../key-scope';
import type { LiveConfig } from '../live-config';
import type { PaneTargets } from '../pane-targets';
import type { PendingKeysHub } from '../pending-keys';

// What the page core shares with every plugin's API. `scopeStack` holds
// qualified scopes; `pendingKeys` is the page's one pending-key report;
// `config` is the config main serves now, which the keymap, commands, scopes
// and settings are read from at each call; `bus` is the page load's event bus;
// `modes` is the core's mode registry, which takes qualified ids. `areas`
// holds every area; plugins get the title bar, panel, status bar, right bar
// and overlay.
// `setLayout` replaces the shell's layout. `transparency` is the page's one
// transparency override. `services` are the ones every plugin shares; `uiState`
// gives each plugin its own scope of the ui state. `layouts` shows each owner's
// layouts. `paneTargets` takes the resize and focus targets and the outer panes
// a plugin hands the pane commands, and releases them. `drops` is the page's one
// drop registry. `registrations` is the part's own store, which the host
// disposes when the part stops.
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
  dependency(pluginId: string): unknown;
  registrations: Registrations;
  bus: EventBus;
  layouts: PageLayouts;
  paneTargets: Pick<
    PaneTargets,
    'setResizeTarget' | 'setFocusTarget' | 'setOuterPanes' | 'release'
  >;
  drops: PageDrops;
}

// One plugin's page API: its channel and its events run under the manifest's
// id, and the scopes it sets and pushes and the modes it adds are qualified by
// it. Its areas are the title bar, panel, status bar, right bar and overlay:
// they leave out `main`, which only the mode registry fills, and the activity
// bar and side bar, which the core draws from the modes. Its
// settings are its own entry in the config's plugin settings, and its ui state
// is scoped to its id. Its layout shows run under its id. Every registration it
// makes through the API is filed in `deps.registrations`. Editors, timers, pane
// targets and the transparency override are held per plugin and filed as one
// entry each, so a destroyed editor or a run timer leaves nothing in the store;
// `services.visualFrames`, `services.markup` and `uiState` are not recorded,
// and the plugin closes what it opens through them.
export function createPageApi(
  manifest: PluginManifest,
  deps: PageApiDeps,
): PageApi<PluginManifest, ChannelShape, UntypedEvents, UntypedEvents> {
  const { config, registrations } = deps;
  const settingsOf = (served: AppConfig) => served.pluginSettings[manifest.id];
  const channel = pageChannel(manifest.id, deps.bridge);
  const events = pluginEvents(deps.bus, manifest.id, deps.services.log);
  return {
    areas: pluginAreas(deps.areas, registrations),
    channel: {
      invoke: channel.invoke,
      on: (message, listener) =>
        registrations.track(channel.on(message, listener)),
    },
    events: {
      emit: events.emit,
      on: (qualifiedEvent, listener) =>
        registrations.track(events.on(qualifiedEvent, listener)),
    },
    keys: {
      setScope: (scope) => deps.scopeStack.setBase(qualify(manifest.id, scope)),
      pushScope: (scope) =>
        trackedPushedScope(
          deps.scopeStack.push(qualify(manifest.id, scope)),
          registrations,
        ),
      scope: () => deps.scopeStack.current(),
      onScopeChanged: (listener) =>
        registrations.track(deps.scopeStack.onChange(listener)),
      onPending: (listener) =>
        registrations.track(deps.pendingKeys.onPending(listener)),
      holdPending: () => deps.pendingKeys.hold(),
      cancelPending: () => deps.pendingKeys.cancel(),
      keymap: () => config.current().keymap,
      onKeymapChanged: (listener) =>
        registrations.track(
          onChangedPart(config, (served) => served.keymap, listener),
        ),
      label: (id) => config.current().commands[id]?.label ?? id,
      command: (id) => config.current().commands[id],
      get scopes() {
        return config.current().scopes;
      },
    },
    modes: {
      add: (mode) =>
        registrations.track(
          deps.modes.add({ ...mode, id: qualify(manifest.id, mode.id) }),
        ),
      shown: () => deps.modes.shown(),
      onChanged: (listener) =>
        registrations.track(deps.modes.onChanged(listener)),
    },
    shell: {
      setLayout: (layout) => registrations.track(deps.setLayout(layout)),
    },
    transparency: trackedTransparency(deps.transparency, registrations),
    panes: trackedPanes(deps.paneTargets, registrations),
    drops: {
      addTarget: (target) => registrations.track(deps.drops.addTarget(target)),
      savePasted: (file) => deps.drops.savePasted(file),
    },
    settings: () => settingsOf(config.current()),
    onSettingsChanged: (listener) =>
      registrations.track(onChangedPart(config, settingsOf, listener)),
    platform: config.current().platform,
    commands: { run: deps.run },
    services: {
      ...deps.services,
      editor: trackedEditor(deps.services.editor, registrations),
      markdown: trackedMarkdown(deps.services.markdown, registrations),
      timers: trackedTimers(deps.services.timers, registrations),
      uiState: deps.uiState.scoped(manifest.id),
    },
    dependency: ((keyOrId: DependencyKey<unknown> | string) =>
      deps.dependency(
        typeof keyOrId === 'string' ? keyOrId : keyOrId.id,
      )) as PageApi<PluginManifest, ChannelShape>['dependency'],
    dataUrl: (path, revision) => dataUrl(manifest.id, revision, path),
    layouts: {
      show: (options) =>
        registrations.track(deps.layouts.show(manifest.id, options)),
    },
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

// A pushed scope the store forgets at its `pop`: the stack's `pop` throws on a
// second call, then the tracked `dispose` finds nothing left to pop.
function trackedPushedScope(
  pushed: PushedScope,
  registrations: Registrations,
): PushedScope {
  const view: PushedScope = {
    pop() {
      pushed.pop();
      view.dispose();
    },
    onBaseChanged: (listener) => pushed.onBaseChanged(listener),
    dispose: () => pushed.dispose(),
  };
  return registrations.track(view);
}

// The live editors are one store entry, so a destroyed editor's view is not
// held. An editor made after the store's `dispose` is destroyed at once, and an
// editor's `destroy` runs its own once.
function trackedEditor(
  editor: EditorHost,
  registrations: Registrations,
): EditorHost {
  const live = registrations.track(createRegistrations());
  const recorded = <E extends { destroy(): void }>(created: E): E => {
    const ownDestroy = created.destroy;
    const entry = live.track({ dispose: () => ownDestroy.call(created) });
    created.destroy = () => entry.dispose();
    return created;
  };
  return {
    ...editor,
    create: (...args) => recorded(editor.create(...args)),
    createDocument: (...args) => recorded(editor.createDocument(...args)),
    onPendingKeys: (listener) =>
      registrations.track(editor.onPendingKeys(listener)),
  };
}

function trackedMarkdown(
  markdown: MarkdownRenderer,
  registrations: Registrations,
): MarkdownRenderer {
  return {
    ...markdown,
    addFence: (fence) => registrations.track(markdown.addFence(fence)),
  };
}

// Keeps the last value this plugin handed each slot, and releases the non-null
// ones when disposed; a slot holding something else by then stays.
function trackedPanes(
  paneTargets: PageApiDeps['paneTargets'],
  registrations: Registrations,
): PageApi<PluginManifest, ChannelShape>['panes'] {
  let resize: ResizeTarget | null = null;
  let focus: FocusTarget | null = null;
  let outer: OuterPanes | null = null;
  registrations.track({
    dispose() {
      for (const target of [resize, focus, outer]) {
        if (target !== null) {
          paneTargets.release(target);
        }
      }
    },
  });
  return {
    setResizeTarget(target) {
      resize = target;
      paneTargets.setResizeTarget(target);
    },
    setFocusTarget(target) {
      focus = target;
      paneTargets.setFocusTarget(target);
    },
    setOuterPanes(panes) {
      outer = panes;
      paneTargets.setOuterPanes(panes);
    },
  };
}

// Clears the override when disposed only while it equals the last value this
// plugin passed; a second plugin that set the same value is not told apart.
function trackedTransparency(
  transparency: PageTransparency,
  registrations: Registrations,
): PageTransparency {
  let lastSet: ReturnType<PageTransparency['overridden']> = null;
  registrations.track({
    dispose() {
      if (lastSet !== null && transparency.overridden() === lastSet) {
        transparency.override(null);
      }
    },
  });
  return {
    override(value) {
      lastSet = value;
      transparency.override(value);
    },
    overridden: () => transparency.overridden(),
  };
}

// Plugin `pluginId`'s channel over the bridge. The channel takes one bridge
// listener per message name, the first time it is listened to, and hands each
// message to the registrations not yet disposed, in the order they were made.
// Disposing a message's last registration disposes its bridge listener and
// forgets it, so a later `on` takes a new one.
function pageChannel(
  pluginId: string,
  bridge: Bridge,
): PageChannel<ChannelShape> {
  type Registration = { listener: (data: unknown) => void };
  type Listening = {
    registrations: Set<Registration>;
    bridgeListener: Disposable;
  };
  const listening = new Map<string, Listening>();
  const listeningTo = (message: string): Listening => {
    let forMessage = listening.get(message);
    if (forMessage === undefined) {
      const created = new Set<Registration>();
      forMessage = {
        registrations: created,
        bridgeListener: bridge.onMessage(pluginId, message, (data) => {
          // A registration added while this message is delivered waits for the
          // next one; one disposed meanwhile hears no more.
          for (const registration of Array.from(created)) {
            if (created.has(registration)) {
              registration.listener(data);
            }
          }
        }),
      };
      listening.set(message, forMessage);
    }
    return forMessage;
  };
  return {
    invoke: (method, ...args) => bridge.invoke(pluginId, method, args),
    on: (message, listener) => {
      const forMessage = listeningTo(message);
      const registration: Registration = {
        listener: listener as (data: unknown) => void,
      };
      forMessage.registrations.add(registration);
      return {
        dispose: () => {
          const wasListening = forMessage.registrations.delete(registration);
          if (wasListening && forMessage.registrations.size === 0) {
            forMessage.bridgeListener.dispose();
            listening.delete(message);
          }
        },
      };
    },
  };
}

function pluginAreas(
  areas: Record<AreaName, Area>,
  registrations: Registrations,
): PluginAreas {
  const tracked = (area: Area): Area => ({
    contribute: (element, options) =>
      registrations.track(area.contribute(element, options)),
  });
  return {
    titleBar: tracked(areas.titleBar),
    panel: tracked(areas.panel),
    statusBar: tracked(areas.statusBar),
    rightBar: tracked(areas.rightBar),
    overlay: tracked(areas.overlay),
  };
}
