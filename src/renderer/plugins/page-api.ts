import type { Bridge } from '../../contracts/bridge';
import type { CommandArg, CommandId } from '../../contracts/commands';
import type { Disposable, Registrations } from '../../contracts/disposable';
import type { PageDrops } from '../../contracts/drops';
import type { EditorHost } from '../../contracts/editor';
import type { FuzzyMatcher } from '../../contracts/fuzzy';
import type { ListPickerService } from '../../contracts/list-picker';
import type { Log, PluginLog } from '../../contracts/log';
import type {
  FocusTarget,
  OuterPanes,
  ResizeTarget,
} from '../../contracts/panes';
import type {
  Area,
  ChannelShape,
  ContributeOptions,
  DependencyKey,
  KeyHints,
  PageChannel,
  Modes,
  PageApi,
  PageCommandContext,
  PageRestores,
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
import { keysFor } from '../../shared/keys-for';
import { element } from '../../shared/page/dom';
import { createListPicker } from '../../shared/page/list-picker';
import {
  ownerKitServicesOf,
  ownerLayoutShow,
} from '../../shared/page/layout-host/owner-show';
import type { PageLayouts } from '../../shared/page/layout-host/show-layouts';
import { pluginLog } from '../../shared/plugin-log';
import {
  commandLabel,
  qualify,
  requireDeclaredScope,
} from '../../shared/plugin-manifests';
import {
  trackedEditor,
  trackedMarkdown,
} from '../../shared/plugin-service-views';
import { createRegistrations } from '../../shared/registrations';
import {
  layoutState,
  pluginState,
  type SlotStore,
} from '../../shared/state/slot-store';
import type { RuntimeCommands } from '../../shared/runtime-commands';
import { trackedTimers } from '../../shared/tracked-timers';
import type { BoxFocus } from '../box-focus';
import type { Anchors } from '../key-anchors';
import type { ScopeStack } from '../key-scope';
import { type LiveConfig, onChangedPart } from '../live-config';
import type { PaneTargets } from '../pane-targets';
import type { PendingKeysHub } from '../pending-keys';
import type { ShellAreas } from '../shell/shell';
import type { PickerCommands } from '../picker-commands';

// The services the page core hands the plugin APIs: each plugin's `uiState`,
// `picker` and scoped `log` are made from these, `log` being the core's own.
export type PageApiServices = Omit<
  PageServices,
  'uiState' | 'log' | 'picker'
> & {
  log: Log;
};

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
// drop registry, and `restores` the page's restore windows. `registrations` is the part's own store, which the host
// disposes when the part stops. `state` is the page load's slot store, and
// `commands` the page's commands, which each plugin reaches under its id.
// `anchors` holds every key hint of the page load, and `boxFocus` tells whether
// focus is in a text box. `pickerCommands` tracks each plugin's list picker for
// the core's picker commands.
export interface PageApiDeps {
  areas: ShellAreas;
  modes: Modes;
  setLayout(layout: ShellLayout): Disposable;
  transparency: PageTransparency;
  bridge: Bridge;
  scopeStack: ScopeStack;
  pendingKeys: Pick<PendingKeysHub, 'onPending' | 'hold' | 'cancel'>;
  config: LiveConfig;
  services: PageApiServices;
  uiState: { scoped(prefix: string): UiState };
  commands: RuntimeCommands<PageCommandContext<any>>;
  dependency(pluginId: string): unknown;
  registrations: Registrations;
  bus: EventBus;
  layouts: PageLayouts;
  paneTargets: Pick<
    PaneTargets,
    'setResizeTarget' | 'setFocusTarget' | 'setOuterPanes' | 'release'
  >;
  drops: PageDrops;
  restores: PageRestores;
  state: SlotStore;
  anchors: Anchors;
  boxFocus: BoxFocus;
  pickerCommands: PickerCommands;
}

// `KeyHints['keysFor']` over the config served now, read at each call.
export function liveKeysFor(
  config: Pick<LiveConfig, 'current'>,
): KeyHints['keysFor'] {
  return (command, scope, where, arg) => {
    const { keymap, platform } = config.current();
    return keysFor(keymap, command, scope, platform.os, where, arg);
  };
}

// One plugin's page API: its channel and its events run under the manifest's
// id, and the scopes it sets and pushes and the modes it adds are qualified by
// it. Its areas are the title bar, panel, status bar, right bar and overlay:
// they leave out `main`, which only the mode registry fills, and the activity
// bar and side bar, which the core draws from the modes. Its
// settings are its own entry in the config's plugin settings, and its ui state
// and `services.log` are scoped to its id. Its layout shows run under its id,
// and each show's `draw` draws with a base kit made from this API's own
// markdown, key hints, commands, platform, layout state and log.
// Every registration it makes through the API is filed in
// `deps.registrations`. Editors, timers, pane targets and the transparency
// override are held per plugin and filed as one entry each, so a destroyed editor or a run timer leaves nothing in the store;
// `services.picker` builds lists under its scopes, log, editor and overlay,
// owned by its id for the picker commands;
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
  const track = <T extends Disposable>(handle: T) =>
    registrations.track(handle);
  const pluginCommands = deps.commands.forPlugin(manifest.id, track);
  const areas = pluginAreas(deps.areas, registrations);
  const log = pluginLog(deps.services.log, manifest.id);
  const editor = trackedEditor(deps.services.editor, registrations);
  const api: PageApi<
    PluginManifest,
    ChannelShape,
    UntypedEvents,
    UntypedEvents
  > = {
    areas,
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
      onPending: (listener) =>
        registrations.track(deps.pendingKeys.onPending(listener)),
      holdPending: () => deps.pendingKeys.hold(),
      cancelPending: () => deps.pendingKeys.cancel(),
      keymap: () => config.current().keymap,
      onKeymapChanged: (listener) =>
        registrations.track(
          onChangedPart(config, (served) => served.keymap, listener),
        ),
      label: (id) => commandLabel(config.current().commands, id),
      command: (id) => deps.commands.infoOf(id),
      get scopes() {
        return config.current().scopes;
      },
      bind: pluginCommands.bind,
      keysFor: liveKeysFor(config),
      anchor: (element, command, options) =>
        track(deps.anchors.anchor(element, command, options)),
      where: () => deps.boxFocus.where(),
      onWhereChanged: (listener) => track(deps.boxFocus.onChanged(listener)),
      setHintsShown: (shown) => track(deps.anchors.holdShown(shown)),
      placedIn: (scope) => deps.anchors.placedIn(scope),
    },
    modes: {
      add: (mode) =>
        registrations.track(
          deps.modes.add({ ...mode, id: qualify(manifest.id, mode.id) }),
        ),
      shown: () => deps.modes.shown(),
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
    restores: {
      track: (restore) => deps.restores.track(restore),
      onSettled: (listener) => track(deps.restores.onSettled(listener)),
    },
    settings: () => settingsOf(config.current()),
    onSettingsChanged: (listener) =>
      registrations.track(onChangedPart(config, settingsOf, listener)),
    platform: config.current().platform,
    commands: pluginCommands.commands,
    services: {
      ...deps.services,
      log,
      editor,
      picker: pluginPicker(manifest, {
        scopeStack: deps.scopeStack,
        log,
        matcher: deps.services.fuzzy,
        editor,
        overlay: areas.overlay,
        anchors: deps.anchors,
        registrations,
        run: (command, arg) => void deps.commands.router.run(command, arg, {}),
        pickerCommands: deps.pickerCommands,
      }),
      markdown: trackedMarkdown(deps.services.markdown, registrations),
      timers: trackedTimers(deps.services.timers, registrations),
      uiState: deps.uiState.scoped(manifest.id),
    },
    dependency: <E>(key: DependencyKey<E, 'page'>) =>
      deps.dependency(key.id) as E,
    dataUrl: (path, revision) => dataUrl(manifest.id, revision, path),
    layouts: {
      show: (options) =>
        track(
          ownerLayoutShow({
            manifest,
            kit: ownerKitServicesOf(api),
            log,
            options,
            show: (shown) => deps.layouts.show(manifest.id, shown),
          }),
        ),
    },
    state: {
      ...pluginState(deps.state, manifest.id, 'page', track),
      forLayouts: layoutState(deps.state, manifest.id, track),
    },
  };
  return api;
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

// One plugin's list pickers, each owned by the plugin's id. `pushedScopes` is
// filed ahead of each list's close, because the store disposes in reverse: the
// close pops the scope it holds, and a second pop throws. The owner's tracking is
// filed beside the close, so the part's stop frees the owner. A list with a
// filter anchors its `/ filter` key to the plugin's `pickerFilter`, one hint per
// scope it opens in.
function pluginPicker(
  manifest: PluginManifest,
  deps: {
    scopeStack: ScopeStack;
    log: PluginLog;
    matcher: FuzzyMatcher;
    editor: EditorHost;
    overlay: Area;
    anchors: Anchors;
    registrations: Registrations;
    run(command: CommandId, arg: CommandArg): void;
    pickerCommands: PickerCommands;
  },
): ListPickerService {
  return {
    create({ scope = 'picker', filter = false, parent } = {}) {
      const scopeName = typeof scope === 'string' ? () => scope : scope;
      requireDeclaredScope(manifest, scopeName());
      const filterHints = new Map<string, HTMLElement>();
      const filterHint = () => {
        const name = scopeName();
        let hint = filterHints.get(name);
        if (hint === undefined) {
          hint = element('span', 'ui-picker-key');
          deps.registrations.track(
            deps.anchors.anchor(hint, qualify(manifest.id, 'pickerFilter'), {
              scope: qualify(manifest.id, name),
              label: 'filter',
            }),
          );
          filterHints.set(name, hint);
        }
        return hint;
      };
      const pushedScopes = deps.registrations.track(createRegistrations());
      const picker = createListPicker({
        owner: manifest.id,
        run: deps.run,
        pushScope() {
          const name = scopeName();
          requireDeclaredScope(manifest, name);
          return trackedPushedScope(
            deps.scopeStack.push(qualify(manifest.id, name)),
            pushedScopes,
          );
        },
        log: deps.log,
        matcher: deps.matcher,
        filterEditor: filter ? deps.editor : undefined,
        filterHint: filter ? filterHint : undefined,
      });
      if (parent === undefined) {
        deps.overlay.contribute(picker.element);
      } else {
        parent.append(picker.element);
      }
      deps.registrations.track({ dispose: () => picker.close() });
      deps.registrations.track(deps.pickerCommands.track(manifest.id, picker));
      return picker;
    },
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
  areas: ShellAreas,
  registrations: Registrations,
): PluginAreas {
  const tracked = <Options extends ContributeOptions>(area: {
    contribute(element: HTMLElement, options?: Options): Disposable;
  }) => ({
    contribute: (element: HTMLElement, options?: Options) =>
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
