import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../contracts/ambient';
import type { Bridge } from '../../contracts/bridge';
import type { Disposable } from '../../contracts/disposable';
import type {
  DocumentEditor,
  DocumentEditorEvents,
  DocumentOptions,
  EditorEvents,
  EditorHost,
  TextEditor,
} from '../../contracts/editor';
import type {
  FenceContribution,
  MarkdownRenderer,
} from '../../contracts/markdown';
import type { HintWhere, Keymap } from '../../contracts/keymap';
import type {
  FocusTarget,
  OuterPanes,
  ResizeTarget,
} from '../../contracts/panes';
import type {
  Area,
  Mode,
  ModeHandle,
  Modes,
  PageChannel,
  PageCommandContext,
  PageTransparency,
  PluginManifest,
  ShellLayout,
} from '../../contracts/plugin';
import type { AppConfig } from '../../contracts/settings';
import {
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
  type RuntimeCatalog,
} from '../../contracts/core-state';
import type { SlotKey } from '../../contracts/state';
import type { PageLayouts } from '../../shared/page/layout-host/show-layouts';
import { CommandRegistry } from '../../shared/command-registry';
import { createEventBus, type EventBus } from '../../shared/event-bus';
import { fakeFuzzyMatcher } from '../../shared/fake-fuzzy-matcher.test-support';
import { createListeners } from '../../shared/listeners';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../shared/page/test-dom';
import { fakePlatform } from '../../shared/platform.test-support';
import { createRegistrations } from '../../shared/registrations';
import {
  createRuntimeCommands,
  EMPTY_RUNTIME_CATALOG,
} from '../../shared/runtime-commands';
import { createSlotStore, type SlotStore } from '../../shared/state/slot-store';
import { createAnchors } from '../key-anchors';
import { createScopeStack, type ScopeStack } from '../key-scope';
import { createLiveConfig } from '../live-config';
import { createPageRestores } from '../page-restores';
import { registerPickerCommands } from '../picker-commands';
import { createPageUiState } from '../ui-state';
import {
  createPageApi,
  type PageApiDeps,
  type PageApiServices,
} from './page-api';

const manifest: PluginManifest = {
  id: 'p',
  label: 'p',
  description: 'A test plugin.',
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
  commands: {},
  scopes: { review: 'In review' },
  settings: {},
  settingInfo: {},
  themeTokens: {},
};

interface TestChannel {
  invoke: { save(a: number, b: number): string };
  messages: { shown: string; other: string };
}

// A Bridge recording the plugin calls it receives, whose `send` delivers a
// message as main would; the rest is unused here.
const ownSlot: SlotKey<number, 'page', 'p'> = {
  id: 'p.v',
  process: 'page',
  kind: 'value',
};

function fakeBridge() {
  const invoked: [string, string, unknown[]][] = [];
  const listeners: [string, string, (data: unknown) => void][] = [];
  const bridge = {
    invoke: (pluginId, method, args) => {
      invoked.push([pluginId, method, args]);
      return Promise.resolve('done');
    },
    onMessage: (pluginId, message, listener) => {
      const entry: (typeof listeners)[number] = [pluginId, message, listener];
      listeners.push(entry);
      return { dispose: () => listeners.splice(listeners.indexOf(entry), 1) };
    },
  } as Pick<Bridge, 'invoke' | 'onMessage'> as Bridge;
  const send = (pluginId: string, message: string, data: unknown) => {
    for (const [toPlugin, sent, listener] of listeners) {
      if (toPlugin === pluginId && sent === message) {
        listener(data);
      }
    }
  };
  return { bridge, invoked, listeners, send };
}

function testChannel(bridge: Bridge): PageChannel<TestChannel> {
  return createPageApi(manifest, deps({ bridge })).channel;
}

function keymap(command: string): Keymap {
  return {
    page: [{ keys: ['j'], scope: 'any', command }],
    editor: { leader: '<Space>', remaps: [], binds: [] },
    app: [],
    intercept: [],
    global: [],
    groups: {},
  };
}

// A served config carrying what the page API reads; the rest is unused here.
function appConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    settings: { keySequenceTimeoutMs: 1000 },
    keymap: keymap('p.down'),
    commands: {},
    scopes: [],
    pluginSettings: { p: { delayMs: 1 }, q: { delayMs: 1 } },
    platform: fakePlatform('macos'),
    problems: [],
    ...overrides,
  } as AppConfig;
}

function liveConfig(initial: AppConfig = appConfig()) {
  return createLiveConfig(initial, () => {});
}

// The page's commands over `state`, served `served` and sending remote runs to
// `remote`.
function pageCommandsOver(
  state: SlotStore,
  served: AppConfig['commands'] = {},
  remote: (id: string, arg: unknown) => Promise<void> = () => Promise.resolve(),
) {
  return createRuntimeCommands<PageCommandContext<any>>({
    process: 'page',
    registry: new CommandRegistry(() => {}),
    writer: state.publish(coreRuntimePageSlot),
    other: state.read(coreRuntimeMainSlot, 'core'),
    served: () => served,
    leader: () => '<Space>',
    remote,
  });
}

function deps(overrides: Partial<PageApiDeps>): PageApiDeps {
  return {
    areas: {} as PageApiDeps['areas'],
    modes: {} as Modes,
    setLayout: () => ({ dispose: () => {} }),
    transparency: { override: () => {}, overridden: () => null },
    bridge: fakeBridge().bridge,
    scopeStack: createScopeStack('any'),
    pendingKeys: {
      onPending: () => ({ dispose: () => {} }),
      hold: () => {},
      cancel: () => {},
    },
    config: liveConfig(),
    services: {} as PageApiServices,
    uiState: createPageUiState({}, () => {}),
    commands: pageCommandsOver(createSlotStore(() => {})),
    dependency: () => undefined,
    registrations: createRegistrations(),
    bus: createEventBus(),
    layouts: {} as PageLayouts,
    paneTargets: {
      setResizeTarget: () => {},
      setFocusTarget: () => {},
      setOuterPanes: () => {},
      release: () => {},
    },
    drops: {
      addTarget: () => ({ dispose: () => {} }),
      savePasted: async () => '',
    },
    restores: createPageRestores({
      timers: { set: () => 0, clear: () => undefined },
      log: () => undefined,
    }),
    state: createSlotStore(() => {}),
    anchors: createAnchors({
      keysFor: () => null,
      label: (id) => id,
      scope: () => 'any',
      platform: 'macos',
    }),
    boxFocus: { where: () => 'page', onChanged: () => ({ dispose: () => {} }) },
    pickerCommands: { track: () => ({ dispose: () => {} }) },
    ...overrides,
  };
}

describe('createPageApi', () => {
  // An API over real anchors, one revealed anchor in them, and its hidden state.
  function hintsApi() {
    const anchors = createAnchors({
      keysFor: () => null,
      label: (id) => id,
      scope: () => 'any',
      platform: 'macos',
    });
    const span = new FakeElement('span');
    const registrations = createRegistrations();
    anchors.reveal();
    anchors.anchor(asHtml(span), 'p.x');
    const api = createPageApi(manifest, deps({ anchors, registrations }));
    const isHidden = () => span.classList.contains('is-hint-hidden');
    return { api, isHidden, registrations };
  }

  it('setHintsShown_PartStops_ShowsHintsAgain', () => {
    const { api, isHidden, registrations } = hintsApi();

    api.keys.setHintsShown(false);
    expect(isHidden()).toBe(true);

    registrations.dispose();

    expect(isHidden()).toBe(false);
  });

  it('setHintsShown_OldHandleDisposedAfterNewCall_KeepsTheNewValue', () => {
    const { api, isHidden } = hintsApi();
    const first = api.keys.setHintsShown(true);
    const second = api.keys.setHintsShown(false);

    first.dispose();
    expect(isHidden()).toBe(true);

    second.dispose();
    expect(isHidden()).toBe(false);
  });

  it('onWhereChanged_PartStops_HearsNothing', () => {
    const moved = createListeners<HintWhere>();
    const registrations = createRegistrations();
    const api = createPageApi(
      manifest,
      deps({
        registrations,
        boxFocus: { where: () => 'box', onChanged: moved.add },
      }),
    );
    const heard: HintWhere[] = [];
    api.keys.onWhereChanged((where) => heard.push(where));

    moved.tell('page');
    registrations.dispose();
    moved.tell('box');

    expect(api.keys.where()).toBe('box');
    expect(heard).toEqual(['page']);
  });

  it('qualifies the scope a plugin sets', () => {
    const scopeStack = createScopeStack('any');
    const api = createPageApi(manifest, deps({ scopeStack }));

    api.keys.setScope('review');

    expect(scopeStack.current()).toBe('p.review');
  });

  it('qualifies the scope a plugin pushes, until its pop', () => {
    const scopeStack = createScopeStack('any');
    const api = createPageApi(manifest, deps({ scopeStack }));

    const pushed = api.keys.pushScope('review');
    expect(api.keys.scope()).toBe('p.review');

    pushed.pop();
    expect(api.keys.scope()).toBe('any');
  });

  it('tells a pushed scope when the set scope under it changes', () => {
    const api = createPageApi(manifest, deps({}));
    const heard: string[] = [];
    const pushed = api.keys.pushScope('review');
    pushed.onBaseChanged((base) => heard.push(base));

    api.keys.setScope('review');

    expect(heard).toEqual(['p.review']);
  });

  it('hands the resize and focus targets and the outer panes to the pane targets', () => {
    const handed: [string, ResizeTarget | FocusTarget | OuterPanes | null][] =
      [];
    const api = createPageApi(
      manifest,
      deps({
        paneTargets: {
          setResizeTarget: (target) => handed.push(['resize', target]),
          setFocusTarget: (target) => handed.push(['focus', target]),
          setOuterPanes: (panes) => handed.push(['outer', panes]),
          release: () => {},
        },
      }),
    );
    const resize: ResizeTarget = { nudge: () => true };
    const focus: FocusTarget = { move: () => true };
    const outer: OuterPanes = { focus, resize };

    api.panes.setResizeTarget(resize);
    api.panes.setFocusTarget(focus);
    api.panes.setOuterPanes(outer);
    api.panes.setOuterPanes(null);

    expect(handed).toEqual([
      ['resize', resize],
      ['focus', focus],
      ['outer', outer],
      ['outer', null],
    ]);
  });

  it("routes channel calls under the plugin's id", async () => {
    const { bridge, invoked } = fakeBridge();
    const channel = testChannel(bridge);

    const result = await channel.invoke('save', 1, 2);

    expect(invoked).toEqual([['p', 'save', [1, 2]]]);
    expect(result).toBe('done');
  });

  it("hands a listener the plugin's own messages of its name", () => {
    const { bridge, send } = fakeBridge();
    const channel = testChannel(bridge);
    const heard: string[] = [];
    channel.on('shown', (data) => heard.push(data));

    send('p', 'shown', 'a');
    send('p', 'other', 'b');
    send('q', 'shown', 'c');

    expect(heard).toEqual(['a']);
  });

  it('stops a listener once its registration is disposed, leaving the others', () => {
    const { bridge, send } = fakeBridge();
    const channel = testChannel(bridge);
    const heard: string[] = [];
    const first = channel.on('shown', (data) => heard.push(`first ${data}`));
    channel.on('shown', (data) => heard.push(`second ${data}`));

    send('p', 'shown', 'a');
    first.dispose();
    first.dispose();
    send('p', 'shown', 'b');

    expect(heard).toEqual(['first a', 'second a', 'second b']);
  });

  it('keeps one registration of a listener listened with twice when the other is removed', () => {
    const { bridge, send } = fakeBridge();
    const channel = testChannel(bridge);
    const heard: string[] = [];
    const listener = (data: string) => heard.push(data);
    const first = channel.on('shown', listener);
    channel.on('shown', listener);

    first.dispose();
    send('p', 'shown', 'a');

    expect(heard).toEqual(['a']);
  });

  it('skips a listener removed by an earlier listener of the same message', () => {
    const { bridge, send } = fakeBridge();
    const channel = testChannel(bridge);
    const heard: string[] = [];
    channel.on('shown', () => second.dispose());
    const second = channel.on('shown', (data) => heard.push(data));

    send('p', 'shown', 'a');

    expect(heard).toEqual([]);
  });

  it('takes one bridge listener per message name however many listen', () => {
    const { bridge, listeners } = fakeBridge();
    const channel = testChannel(bridge);

    channel.on('shown', () => {});
    channel.on('shown', () => {}).dispose();
    channel.on('shown', () => {});

    expect(listeners.map(([pluginId, message]) => [pluginId, message])).toEqual(
      [['p', 'shown']],
    );
  });

  it("services.log logs a one-argument line under the plugin's id", () => {
    const logged: string[][] = [];
    const api = createPageApi(
      manifest,
      deps({
        services: {
          log: (source: string, message: string) =>
            logged.push([source, message]),
        } as unknown as PageApiServices,
      }),
    );

    api.services.log('hello');

    expect(logged).toEqual([['p', 'hello']]);
  });

  it('gives the plugin events under its id', () => {
    const bus = createEventBus();
    const emitted: unknown[] = [];
    const heard: unknown[] = [];
    bus.on('p.x', (data) => emitted.push(data));
    const api = createPageApi(manifest, deps({ bus }));
    api.events.on('q.y', (data) => heard.push(data));

    api.events.emit('x', 3);
    bus.emit('q.y', 4);

    expect(emitted).toEqual([3]);
    expect(heard).toEqual([4]);
  });

  it('hands the plugin the title bar, panel, status bar, right bar and overlay areas', () => {
    const area = (): Area => ({ contribute: () => ({ dispose: () => {} }) });
    const areas: PageApiDeps['areas'] = {
      titleBar: area(),
      activityBar: area(),
      sideBar: area(),
      main: area(),
      rightBar: area(),
      panel: area(),
      statusBar: area(),
      overlay: area(),
    };

    const api = createPageApi(manifest, deps({ areas }));

    expect(Object.keys(api.areas).sort()).toEqual([
      'overlay',
      'panel',
      'rightBar',
      'statusBar',
      'titleBar',
    ]);
  });

  it("qualifies a mode's id by the plugin", () => {
    const added: Mode[] = [];
    const modes = {
      add: (mode) => {
        added.push(mode);
        return { dispose: () => {} } as ModeHandle;
      },
    } as Pick<Modes, 'add'> as Modes;
    const api = createPageApi(manifest, deps({ modes }));
    const element = {} as HTMLElement;
    const shown = () => {};
    const hidden = () => {};
    const focusMain = () => {};

    api.modes.add({
      id: 'browse',
      title: 'Browse',
      icon: 'x',
      element,
      shown,
      hidden,
      focusMain,
    });

    expect(added).toEqual([
      {
        id: 'p.browse',
        title: 'Browse',
        icon: 'x',
        element,
        shown,
        hidden,
        focusMain,
      },
    ]);
  });

  it('settings() reads the current config', () => {
    const config = liveConfig();
    const api = createPageApi(manifest, deps({ config }));

    config.replace(
      appConfig({ pluginSettings: { p: { delayMs: 5 }, q: { delayMs: 1 } } }),
    );

    expect(api.settings()).toEqual({ delayMs: 5 });
  });

  it('onSettingsChanged fires only for the plugin whose settings changed', () => {
    const config = liveConfig();
    const heard: [string, object][] = [];
    const p = createPageApi(manifest, deps({ config }));
    const q = createPageApi({ ...manifest, id: 'q' }, deps({ config }));
    p.onSettingsChanged((settings) => heard.push(['p', settings]));
    q.onSettingsChanged((settings) => heard.push(['q', settings]));

    config.replace(
      appConfig({ pluginSettings: { p: { delayMs: 1 }, q: { delayMs: 9 } } }),
    );

    expect(heard).toEqual([['q', { delayMs: 9 }]]);
  });

  it('onKeymapChanged fires when the keymap changes and not for a settings-only change', () => {
    const config = liveConfig();
    const heard: Keymap[] = [];
    const api = createPageApi(manifest, deps({ config }));
    api.keys.onKeymapChanged((changed) => heard.push(changed));

    config.replace(
      appConfig({ pluginSettings: { p: { delayMs: 3 }, q: { delayMs: 1 } } }),
    );
    config.replace(appConfig({ keymap: keymap('p.up') }));

    expect(heard).toEqual([keymap('p.up')]);
    expect(api.keys.keymap()).toEqual(keymap('p.up'));
  });

  it('hands each plugin uiState scoped to its id', () => {
    const writes: [string, unknown][] = [];
    const uiState = createPageUiState({}, (key, value) =>
      writes.push([key, value]),
    );
    const api = createPageApi({ ...manifest, id: 'forms' }, deps({ uiState }));

    api.services.uiState.set('rail', 300);

    expect(writes).toEqual([['forms.rail', 300]]);
  });

  it('createPageApi_LayoutsShow_RunsUnderThePluginId', () => {
    const calls: string[] = [];
    const layouts: PageLayouts = {
      show: (owner) => {
        calls.push(`show ${owner}`);
        return {
          refresh: () => calls.push('refresh'),
          dispose: () => calls.push('dispose'),
        };
      },
    };
    const api = createPageApi(manifest, deps({ layouts }));

    const show = api.layouts.show({
      defaultLayout: {},
      defaultStylesheet: null,
      read: () => ({}),
      userLayout: () => 'default',
      setLayouts: () => undefined,
    });
    show.dispose();

    expect(calls).toEqual(['show p', 'dispose']);
  });

  it('dependency asks the host for the plugin a key names', () => {
    const asked: string[] = [];
    const api = createPageApi(
      manifest,
      deps({
        dependency: (pluginId) => {
          asked.push(pluginId);
          return { n: 1 };
        },
      }),
    );

    const received = api.dependency({ id: 'a', process: 'page' } as const);

    expect(received).toEqual({ n: 1 });
    expect(asked).toEqual(['a']);
  });
});

// One member of the page API that returns a handle: `register` makes the
// registration through `api`, over deps whose handle-returning member is
// `dep`'s, which hands back `handle`.
type RecordedRow = {
  member: string;
  dep(handle: Disposable): Partial<PageApiDeps>;
  register(api: ReturnType<typeof createPageApi>): unknown;
};

function areaRow(
  name: 'titleBar' | 'panel' | 'statusBar' | 'rightBar' | 'overlay',
): RecordedRow {
  return {
    member: `areas.${name}.contribute`,
    dep: (handle) => ({
      areas: {
        [name]: { contribute: () => handle },
      } as unknown as PageApiDeps['areas'],
    }),
    register: (api) => api.areas[name].contribute({} as HTMLElement),
  };
}

const RECORDED_ROWS: RecordedRow[] = [
  areaRow('titleBar'),
  areaRow('panel'),
  areaRow('statusBar'),
  areaRow('rightBar'),
  areaRow('overlay'),
  {
    member: 'shell.setLayout',
    dep: (handle) => ({ setLayout: () => handle }),
    register: (api) => api.shell.setLayout({} as ShellLayout),
  },
  {
    member: 'drops.addTarget',
    dep: (handle) => ({
      drops: { addTarget: () => handle, savePasted: async () => '' },
    }),
    register: (api) =>
      api.drops.addTarget({ element: {} as HTMLElement, take: () => {} }),
  },
  {
    member: 'layouts.show',
    dep: (handle) => ({
      layouts: {
        show: () => ({ refresh: () => {}, dispose: () => handle.dispose() }),
      },
    }),
    register: (api) =>
      api.layouts.show({
        defaultLayout: {},
        defaultStylesheet: null,
        read: () => ({}),
        userLayout: () => 'default',
        setLayouts: () => undefined,
      }),
  },
  {
    member: 'modes.add',
    dep: (handle) => ({
      modes: { add: () => handle } as unknown as Modes,
    }),
    register: (api) => api.modes.add({ id: 'browse' } as Mode),
  },
  {
    member: 'state.publish',
    dep: (handle) => ({
      state: { publish: () => handle } as unknown as SlotStore,
    }),
    register: (api) => api.state.publish(ownSlot),
  },
  {
    member: 'keys.onPending',
    dep: (handle) => ({
      pendingKeys: {
        onPending: () => handle,
        hold: () => {},
        cancel: () => {},
      },
    }),
    register: (api) => api.keys.onPending(() => {}),
  },
  {
    member: 'services.markdown.addFence',
    dep: (handle) => ({
      services: {
        markdown: { addFence: () => handle } as unknown as MarkdownRenderer,
      } as PageApiDeps['services'],
    }),
    register: (api) => api.services.markdown.addFence({} as FenceContribution),
  },
  {
    member: 'services.editor.onPendingKeys',
    dep: (handle) => ({
      services: {
        editor: { onPendingKeys: () => handle } as unknown as EditorHost,
      } as PageApiDeps['services'],
    }),
    register: (api) => api.services.editor.onPendingKeys(() => {}),
  },
];

// One listener registered through `api`, and what makes the source speak:
// the registration is disposed in between, so `heard` stays empty.
type HearingWorld = {
  api: ReturnType<typeof createPageApi>;
  send: ReturnType<typeof fakeBridge>['send'];
  bus: EventBus;
  config: ReturnType<typeof liveConfig>;
  state: SlotStore;
};

const HEARING_ROWS: {
  member: string;
  listen(world: HearingWorld, heard: (data: unknown) => void): void;
  speak(world: HearingWorld): void;
}[] = [
  {
    member: 'channel.on',
    listen: ({ api }, heard) => api.channel.on('shown', heard),
    speak: ({ send }) => send('p', 'shown', 'a'),
  },
  {
    member: 'events.on',
    listen: ({ api }, heard) => api.events.on('q.done', heard),
    speak: ({ bus }) => bus.emit('q.done', 1),
  },
  {
    member: 'state.read().on',
    listen: ({ api }, heard) => api.state.read(ownSlot).on(heard),
    speak: ({ state }) =>
      state.applyRemote({ id: 'p.v', kind: 'value', value: 1 }),
  },
  {
    member: 'state.forLayouts.read().on',
    listen: ({ api }, heard) =>
      api.state.forLayouts.read('p.v').on((value) => heard(value)),
    speak: ({ state }) =>
      state.applyRemote({ id: 'p.v', kind: 'value', value: 1 }),
  },
  {
    member: 'keys.onKeymapChanged',
    listen: ({ api }, heard) => api.keys.onKeymapChanged(heard),
    speak: ({ config }) =>
      config.replace(appConfig({ keymap: keymap('p.up') })),
  },
  {
    member: 'onSettingsChanged',
    listen: ({ api }, heard) => api.onSettingsChanged(heard),
    speak: ({ config }) =>
      config.replace(
        appConfig({ pluginSettings: { p: { delayMs: 2 }, q: { delayMs: 1 } } }),
      ),
  },
];

// Timers numbering their handles from 1, recording each clear.
function fakeTimers() {
  const cleared: number[] = [];
  let last = 0;
  const timers: Timers = {
    set: () => {
      last += 1;
      return last;
    },
    clear: (handle) => cleared.push(handle),
  };
  return { timers, cleared };
}

// An editor host whose editors count their `destroy`, in creation order.
function countingEditors() {
  const destroys: number[] = [];
  const counted = <E>(): E => {
    const index = destroys.push(0) - 1;
    return {
      destroy: () => {
        destroys[index] += 1;
      },
    } as E;
  };
  const editor = {
    create: () => counted<TextEditor>(),
    createDocument: () => counted<DocumentEditor>(),
  } as unknown as EditorHost;
  return { editor, destroys };
}

describe('createPageApi services.picker', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const REQUEST = {
    title: 'T',
    items: ['a'],
    label: (item: string) => item,
    chosen: () => {},
  };

  // A plugin's API over a real scope stack and store, its overlay holding what
  // the plugin placed, its editor host recording each editor and its anchors
  // recording each anchor.
  function pickerApi() {
    const scopeStack = createScopeStack('any');
    const anchored: {
      element: HTMLElement;
      command: string;
      scope: string | undefined;
    }[] = [];
    const anchors = {
      anchor(element: HTMLElement, command: string, options = {}) {
        anchored.push({
          element,
          command,
          scope: (options as { scope?: string }).scope,
        });
        return { dispose: () => {} };
      },
    } as unknown as PageApiDeps['anchors'];
    const registrations = createRegistrations();
    const overlay: HTMLElement[] = [];
    const destroyEditor = vi.fn();
    let editorsCreated = 0;
    const api = createPageApi(
      {
        ...manifest,
        scopes: { picker: 'In a list', resume: 'In a session list' },
      },
      deps({
        scopeStack,
        registrations,
        anchors,
        areas: {
          overlay: {
            contribute(element: HTMLElement) {
              overlay.push(element);
              return {
                dispose: () => overlay.splice(overlay.indexOf(element), 1),
              };
            },
          },
        } as unknown as PageApiDeps['areas'],
        services: {
          log: () => {},
          fuzzy: fakeFuzzyMatcher,
          editor: {
            create() {
              editorsCreated += 1;
              return {
                setText: () => {},
                blur: () => {},
                destroy: destroyEditor,
              };
            },
          },
        } as unknown as PageApiServices,
      }),
    );
    return {
      picker: api.services.picker,
      scopeStack,
      registrations,
      overlay,
      destroyEditor,
      editorsCreated: () => editorsCreated,
      anchored,
    };
  }

  // Opens `list` three times, the third in scope `resume`, and returns the
  // first filter hint drawn in it at each open, or null.
  function hintsAcrossOpens(
    list: ReturnType<ReturnType<typeof pickerApi>['picker']['create']>,
    setScope: (scope: string) => void,
  ) {
    const hintIn = () =>
      findAll(asFake(list.element), 'ui-picker-key')[0] ?? null;
    list.open(REQUEST);
    const pickerHint = hintIn();
    list.close();
    list.open(REQUEST);
    const pickerHintAgain = hintIn();
    list.close();
    setScope('resume');
    list.open(REQUEST);
    return { pickerHint, pickerHintAgain, resumeHint: hintIn() };
  }

  it('picker_WithFilter_AnchorsOneFilterHintPerScope', () => {
    const { picker, anchored } = pickerApi();
    let scope = 'picker';
    const list = picker.create({ scope: () => scope, filter: true });

    const { pickerHint, pickerHintAgain, resumeHint } = hintsAcrossOpens(
      list,
      (next) => {
        scope = next;
      },
    );

    expect(
      anchored.map(({ command, scope: anchoredIn }) => [command, anchoredIn]),
    ).toEqual([
      ['p.pickerFilter', 'p.picker'],
      ['p.pickerFilter', 'p.resume'],
    ]);
    expect(pickerHintAgain).toBe(pickerHint);
    expect(anchored.map(({ element }) => asFake(element))).toEqual([
      pickerHint,
      resumeHint,
    ]);
  });

  it('picker_WithNoFilter_AnchorsNoFilterHint', () => {
    const { picker, anchored } = pickerApi();
    let scope = 'picker';
    const list = picker.create({ scope: () => scope, filter: false });

    const { pickerHint, resumeHint } = hintsAcrossOpens(list, (next) => {
      scope = next;
    });

    expect(anchored).toEqual([]);
    expect([pickerHint, resumeHint]).toEqual([null, null]);
  });

  it.each([
    { case: 'the overlay', hasParent: false, inOverlay: 1, inParent: 0 },
    { case: 'a parent', hasParent: true, inOverlay: 0, inParent: 1 },
  ])(
    'picker_Create_PushesTheQualifiedScopeAndPlacesInOverlay: $case',
    ({ hasParent, inOverlay, inParent }) => {
      const { picker, scopeStack, overlay } = pickerApi();
      const parent = asHtml(new FakeElement('div'));

      const list = picker.create(hasParent ? { parent } : undefined);
      list.open(REQUEST);

      expect(scopeStack.current()).toBe('p.picker');
      expect(overlay.filter((held) => held === list.element)).toHaveLength(
        inOverlay,
      );
      expect(asFake(parent).children).toHaveLength(inParent);
    },
  );

  it('picker_ScopeFunction_ReadAtEachPush', () => {
    const { picker, scopeStack } = pickerApi();
    let scope = 'picker';
    const list = picker.create({ scope: () => scope });

    list.open(REQUEST);
    const first = scopeStack.current();
    list.close();
    scope = 'resume';
    list.open(REQUEST);

    expect([first, scopeStack.current()]).toEqual(['p.picker', 'p.resume']);
  });

  it.each([
    { case: 'a string', scope: 'nope' },
    { case: 'a function', scope: () => 'nope' },
  ])('picker_UndeclaredScope_ThrowsAtCreate: $case', ({ scope }) => {
    const { picker, overlay } = pickerApi();

    expect(() => picker.create({ scope })).toThrow(/"p".*"nope"/);
    expect(overlay).toEqual([]);
  });

  it('picker_ScopeFunctionLaterBadValue_ThrowsAtThePushAndLeavesItClosed', () => {
    const { picker, scopeStack } = pickerApi();
    let scope = 'picker';
    const list = picker.create({ scope: () => scope });
    scope = 'nope';

    expect(() => list.open(REQUEST)).toThrow(/"nope"/);

    expect(list.isOpen()).toBe(false);
    expect(asFake(list.element).hidden).toBe(true);
    expect(scopeStack.current()).toBe('any');
  });

  // A plugin's picker API over the page's real router, with the core's picker
  // commands registered in its registry and `picker.chooseRow` served.
  function routedPickerApi() {
    const served: AppConfig['commands'] = {
      'picker.chooseRow': {
        id: 'picker.chooseRow',
        plugin: 'core',
        label: 'choose the row',
        group: 'picker',
        runsIn: 'page',
        arg: { owner: 'string', index: 'number' },
      },
    };
    const commands = pageCommandsOver(
      createSlotStore(() => {}),
      served,
    );
    const registrations = createRegistrations();
    const api = createPageApi(
      { ...manifest, scopes: { picker: 'In a list' } },
      deps({
        commands,
        registrations,
        pickerCommands: registerPickerCommands(commands.registry),
        areas: {
          overlay: { contribute: () => ({ dispose: () => {} }) },
        } as unknown as PageApiDeps['areas'],
        services: {
          log: () => {},
          fuzzy: fakeFuzzyMatcher,
        } as unknown as PageApiServices,
      }),
    );
    return { picker: api.services.picker, registrations };
  }

  it('picker_RowClick_RunsChooseRowWithThePluginAsOwner', () => {
    const { picker } = routedPickerApi();
    const chosen = vi.fn();
    const list = picker.create();
    list.open({ ...REQUEST, items: ['a', 'b'], chosen });

    findAll(asFake(list.element), 'ui-row')[1].click();

    expect(chosen).toHaveBeenCalledWith('b');
  });

  it('picker_PartRestarts_OwnerIsFreeAgain', () => {
    const { picker, registrations } = routedPickerApi();
    picker.create();
    expect(() => picker.create()).toThrow('picker owner p is taken');

    registrations.dispose();

    expect(() => picker.create()).not.toThrow();
  });

  it('picker_PartStops_ClosesWithNoCancel', () => {
    const { picker, scopeStack, registrations, overlay } = pickerApi();
    const cancelled = vi.fn();
    const list = picker.create();
    list.open({ ...REQUEST, cancelled });

    registrations.dispose();

    expect(list.isOpen()).toBe(false);
    expect(scopeStack.current()).toBe('any');
    expect(cancelled).not.toHaveBeenCalled();
    expect(overlay).toEqual([]);
  });

  it.each([
    { case: 'with a filter', filter: true, boxes: 1 },
    { case: 'with no filter', filter: false, boxes: 0 },
  ])('picker_FilterOption_UsesThePluginsEditor: $case', ({ filter, boxes }) => {
    const { picker, registrations, destroyEditor, editorsCreated } =
      pickerApi();

    picker.create({ filter });
    registrations.dispose();

    expect(editorsCreated()).toBe(boxes);
    expect(destroyEditor).toHaveBeenCalledTimes(boxes);
  });

  it.each([
    {
      case: 'chooseFolder',
      call: (api: ReturnType<typeof createPageApi>) =>
        api.services.chooseFolder(),
      expected: ['chooseFolder'],
    },
    {
      case: 'openExternal',
      call: (api: ReturnType<typeof createPageApi>) =>
        api.services.openExternal('https://example.invalid'),
      expected: ['openExternal', 'https://example.invalid'],
    },
  ])(
    'chooseFolder_And_openExternal_ReachTheBridge: $case',
    async ({ call, expected }) => {
      const calls: unknown[][] = [];
      const bridge = {
        ...fakeBridge().bridge,
        chooseFolder: async () => {
          calls.push(['chooseFolder']);
          return null;
        },
        openExternal: async (url: string) => {
          calls.push(['openExternal', url]);
        },
      };
      const api = createPageApi(
        manifest,
        deps({
          bridge,
          services: {
            log: () => {},
            editor: {},
            chooseFolder: () => bridge.chooseFolder(),
            openExternal: (url: string) => bridge.openExternal(url),
          } as unknown as PageApiServices,
        }),
      );

      await call(api);

      expect(calls).toEqual([expected]);
    },
  );
});

describe('createPageApi recording', () => {
  it.each(RECORDED_ROWS)(
    "disposes what $member returned when the plugin's registrations are disposed",
    ({ member, dep, register }) => {
      const disposed: string[] = [];
      const registrations = createRegistrations();
      const api = createPageApi(
        manifest,
        deps({
          registrations,
          ...dep({ dispose: () => disposed.push(member) }),
        }),
      );

      register(api);
      expect(disposed).toEqual([]);

      registrations.dispose();
      expect(disposed).toEqual([member]);
    },
  );

  it.each(HEARING_ROWS)(
    "stops $member hearing once the plugin's registrations are disposed",
    ({ listen, speak }) => {
      const { bridge, send } = fakeBridge();
      const bus = createEventBus();
      const config = liveConfig();
      const registrations = createRegistrations();
      const state = createSlotStore(() => {});
      const api = createPageApi(
        manifest,
        deps({ bridge, bus, config, registrations, state }),
      );
      const world = { api, send, bus, config, state };
      const heard: unknown[] = [];
      listen(world, (data) => heard.push(data));

      registrations.dispose();
      speak(world);

      expect(heard).toEqual([]);
    },
  );

  it('pops the scopes the plugin pushed when its registrations are disposed', () => {
    const scopeStack = createScopeStack('any');
    const registrations = createRegistrations();
    const api = createPageApi(manifest, deps({ scopeStack, registrations }));

    api.keys.pushScope('review');
    registrations.dispose();

    expect(scopeStack.current()).toBe('any');
  });

  it('forgets a pushed scope the plugin popped', () => {
    const real = createScopeStack('any');
    const handled: string[] = [];
    const scopeStack: ScopeStack = {
      ...real,
      push(scope) {
        const pushed = real.push(scope);
        return {
          ...pushed,
          pop() {
            handled.push('pop');
            pushed.pop();
          },
          dispose() {
            handled.push('dispose');
            pushed.dispose();
          },
        };
      },
    };
    const registrations = createRegistrations();
    const api = createPageApi(manifest, deps({ scopeStack, registrations }));

    const pushed = api.keys.pushScope('review');
    pushed.pop();
    const handledByThePop = [...handled];
    registrations.dispose();

    expect(scopeStack.current()).toBe('any');
    expect(handled.filter((call) => call === 'pop')).toEqual(['pop']);
    expect(handled).toEqual(handledByThePop);
    expect(() => pushed.pop()).toThrow('Scope p.review was already popped');
  });

  it("clears the plugin's pending timer when its registrations are disposed", () => {
    const { timers, cleared } = fakeTimers();
    const registrations = createRegistrations();
    const api = createPageApi(
      manifest,
      deps({
        registrations,
        services: { timers } as PageApiDeps['services'],
      }),
    );

    api.services.timers.set(() => {}, 10);
    registrations.dispose();

    expect(cleared).toEqual([1]);
  });

  it('destroys the editors the plugin created and has not destroyed when its registrations are disposed', () => {
    const { editor, destroys } = countingEditors();
    const registrations = createRegistrations();
    const api = createPageApi(
      manifest,
      deps({
        registrations,
        services: { editor } as PageApiDeps['services'],
      }),
    );
    const parent = {} as HTMLElement;

    const first = api.services.editor.create(parent, '', {} as EditorEvents);
    api.services.editor.create(parent, '', {} as EditorEvents);
    api.services.editor.createDocument(
      parent,
      '',
      {} as DocumentOptions,
      {} as DocumentEditorEvents,
    );
    first.destroy();
    registrations.dispose();
    expect(destroys).toEqual([1, 1, 1]);

    api.services.editor.create(parent, '', {} as EditorEvents);
    expect(destroys).toEqual([1, 1, 1, 1]);
  });

  it('releases each pane target the plugin set when its registrations are disposed', () => {
    const released: unknown[] = [];
    const registrations = createRegistrations();
    const api = createPageApi(
      manifest,
      deps({
        registrations,
        paneTargets: {
          setResizeTarget: () => {},
          setFocusTarget: () => {},
          setOuterPanes: () => {},
          release: (target) => released.push(target),
        },
      }),
    );
    const resize: ResizeTarget = { nudge: () => true };
    const focus: FocusTarget = { move: () => true };
    const outer: OuterPanes = { focus, resize };

    api.panes.setResizeTarget(resize);
    api.panes.setFocusTarget(focus);
    api.panes.setOuterPanes(outer);
    api.panes.setFocusTarget(null);
    registrations.dispose();

    expect(released).toEqual([resize, outer]);
  });

  it.each<{
    case: string;
    act(p: PageTransparency, q: PageTransparency): void;
    calls: ('full' | 'reduced' | null)[];
  }>([
    {
      case: 'still holds',
      act: (p) => p.override('full'),
      calls: [null],
    },
    {
      case: 'another plugin replaced it',
      act(p, q) {
        p.override('full');
        q.override('reduced');
      },
      calls: [],
    },
    {
      case: 'the plugin handed it back',
      act(p) {
        p.override('full');
        p.override(null);
      },
      calls: [],
    },
  ])(
    "clears the transparency override at dispose only while it holds the plugin's value ($case)",
    ({ act, calls: expected }) => {
      let value: 'full' | 'reduced' | null = null;
      const calls: ('full' | 'reduced' | null)[] = [];
      const transparency: PageTransparency = {
        override(next) {
          value = next;
          calls.push(next);
        },
        overridden: () => value,
      };
      const registrations = createRegistrations();
      const p = createPageApi(manifest, deps({ transparency, registrations }));
      const q = createPageApi({ ...manifest, id: 'q' }, deps({ transparency }));
      act(p.transparency, q.transparency);
      calls.length = 0;

      registrations.dispose();

      expect(calls).toEqual(expected);
    },
  );

  it('drops the bridge listener of a message once its last registration is disposed, and takes a new one when listened again', () => {
    const { bridge, listeners } = fakeBridge();
    const channel = testChannel(bridge);
    const a = channel.on('shown', () => {});
    const b = channel.on('shown', () => {});

    a.dispose();
    expect(listeners.length).toBe(1);

    b.dispose();
    expect(listeners.length).toBe(0);

    channel.on('shown', () => {});
    expect(listeners.length).toBe(1);
  });
});

describe('createPageApi commands', () => {
  const DECL = { label: 'Go', group: 'g', runsIn: 'page' } as const;
  const MAIN_CATALOG: RuntimeCatalog = {
    ...EMPTY_RUNTIME_CATALOG,
    commands: [
      {
        id: 'm.go',
        plugin: 'm',
        label: 'Main go',
        group: 'g',
        runsIn: 'main',
        runtime: true,
      },
    ],
    binds: {
      binds: [{ keys: 'z', scope: 'any', command: 'm.go' }],
      app: [],
      intercept: [],
    },
  };

  function commandsSetup(served: AppConfig['commands'] = {}) {
    const state = createSlotStore(() => {});
    const registrations = createRegistrations();
    const remoteRuns: [string, unknown][] = [];
    const commands = pageCommandsOver(state, served, async (id, arg) => {
      remoteRuns.push([id, arg]);
    });
    const api = createPageApi(
      manifest,
      deps({ state, registrations, commands }),
    );
    const catalog = () => state.read(coreRuntimePageSlot, 'core').get();
    return { api, commands, registrations, state, catalog, remoteRuns };
  }

  it('register_DisposedWithThePart_LeavesRegistryAndSlot', () => {
    const { api, commands, registrations, catalog } = commandsSetup();
    api.commands.register('go', DECL, () => {});
    api.keys.bind({ keys: 'g', scope: 'any', command: 'p.go' });
    expect(commands.registry.has('p.go')).toBe(true);
    expect(catalog()?.commands.map((info) => info.id)).toEqual(['p.go']);

    registrations.dispose();

    expect(commands.registry.has('p.go')).toBe(false);
    expect(catalog()?.commands).toEqual([]);
    expect(catalog()?.binds.binds).toEqual([]);
  });

  it('register_OwnHandleDisposed_TakesItsBindsOut', () => {
    const { api, catalog } = commandsSetup();
    const handle = api.commands.register('go', DECL, () => {});
    api.keys.bind({ keys: 'g', scope: 'any', command: 'p.go' });

    handle.dispose();

    expect(catalog()?.commands).toEqual([]);
    expect(catalog()?.binds.binds).toEqual([]);
  });

  it('register_OtherProcessDecl_Throws', () => {
    const { api } = commandsSetup();

    expect(() =>
      api.commands.register('go', { ...DECL, runsIn: 'main' }, () => {}),
    ).toThrow('p.go runs in main');
  });

  it('register_IdInTheCatalog_Throws', () => {
    const { api } = commandsSetup();
    api.commands.register('go', DECL, () => {});

    expect(() => api.commands.register('go', DECL, () => {})).toThrow(
      'Command "p.go" is already registered',
    );
  });

  it('bind_ClashesWithRuntimeBindOfEitherProcess_ThrowsAtTheCall', () => {
    const { api, state } = commandsSetup();
    state.applyRemote({
      id: coreRuntimeMainSlot.id,
      kind: 'value',
      value: MAIN_CATALOG,
    });
    api.commands.register('go', DECL, () => {});
    api.keys.bind({ keys: 'g', scope: 'any', command: 'p.go' });

    expect(() =>
      api.keys.bind({ keys: 'g', scope: 'any', command: 'p.go' }),
    ).toThrow();
    expect(() =>
      api.keys.bind({ keys: 'z', scope: 'any', command: 'p.go' }),
    ).toThrow();
  });

  it('bind_UnknownCommandOrBadArg_ThrowsAtTheCall', () => {
    const { api } = commandsSetup();
    api.commands.register('pick', { ...DECL, arg: 'number' }, () => {});

    expect(() =>
      api.keys.bind({ keys: 'x', scope: 'any', command: 'p.gone' }),
    ).toThrow('No command is registered as "p.gone"');
    expect(() =>
      api.keys.bind({ keys: 'x', scope: 'any', command: 'p.pick', arg: 'a' }),
    ).toThrow('command "p.pick" needs a number');
  });

  it('bind_OnDefaultOrUserKey_Accepted', () => {
    const { api, catalog } = commandsSetup();
    api.commands.register('go', DECL, () => {});

    api.keys.bind({ keys: 'j', scope: 'any', command: 'p.go' });

    expect(catalog()?.binds.binds).toHaveLength(1);
  });

  it('infoOf_OtherProcessRuntimeCommand_ReadsItsSlotBeforeTheServedConfig', async () => {
    const { api, state, remoteRuns } = commandsSetup();
    state.applyRemote({
      id: coreRuntimeMainSlot.id,
      kind: 'value',
      value: MAIN_CATALOG,
    });

    await api.commands.run('m.go');

    expect(remoteRuns).toEqual([['m.go', undefined]]);
  });

  it('intercept_PartStops_WrapGone', async () => {
    const { api, commands, registrations } = commandsSetup();
    const ran: string[] = [];
    commands.registry.register('p.go', () => void ran.push('handler'), 'p');
    api.commands.intercept('p.go', () => void ran.push('wrap'));

    registrations.dispose();
    await commands.registry.run('p.go', { arg: undefined });

    expect(ran).toEqual(['handler']);
  });

  it('onDidRun_PartStops_ListenerGone', async () => {
    const { api, commands, registrations } = commandsSetup();
    const heard: string[] = [];
    commands.registry.register('p.go', () => {}, 'p');
    api.commands.onDidRun((id) => heard.push(id));

    registrations.dispose();
    await commands.registry.run('p.go', { arg: undefined });

    expect(heard).toEqual([]);
  });

  it('bind_PartStops_LeavesTheCatalog', () => {
    const { commands, registrations, catalog, state } = commandsSetup();
    commands.registry.register('o.go', () => {}, 'o');
    const other = createPageApi(
      { ...manifest, id: 'o' },
      deps({ state, commands }),
    );
    other.commands.register('kept', DECL, () => {});
    const api = createPageApi(
      manifest,
      deps({ state, registrations, commands }),
    );
    api.keys.bind({ keys: 'b', scope: 'any', command: 'o.kept' });

    registrations.dispose();

    expect(catalog()?.binds.binds).toEqual([]);
    expect(catalog()?.commands.map((info) => info.id)).toEqual(['o.kept']);
  });
});
