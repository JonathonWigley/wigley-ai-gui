import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveTime } from '../../../contracts/active-time';
import type { CommandKey } from '../../../contracts/commands';
import type {
  BlurOptions,
  EditorEvents,
  FocusOptions,
  TextEditor,
} from '../../../contracts/editor';
import type {
  FocusTarget,
  PaneDirection,
  ResizeTarget,
} from '../../../contracts/panes';
import type { AgentCommand, ChatEntry } from '../../../contracts/agent';
import { NO_ACTIVE_TIME } from '../../../shared/active-time';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  asFake,
  type FakeElement,
  findAll,
  installFakeDom,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import { createPartStore } from '../../../shared/page/contributed-parts';
import { posixPaths } from '../../../shared/paths/posix-paths';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout } from '../layouts/layout';
import {
  chatCommandsSlot,
  type ChatComposerPart,
  chatControlsSlot,
  chatEntriesSlot,
  chatQueuedSlot,
  chatReturnedSlot,
  type ChatSessionInfo,
  type ChatSessionState,
  chatSessionSlot,
  type ChatSidePart,
  type ComposerStopExits,
  type QueuedMessage,
  type ReturnedMessage,
  type SessionCompaction,
} from '../contract';
import { createChatLayouts, type SurfaceKitDeps } from './chat-layouts';
import {
  type ChatSession,
  type ChatViewDeps,
  mountChatView,
} from './chat-view';
import type { PermissionEntry } from './chat-state';
import type { ComposerPieces } from './composer-kit';
import type { EntryListDeps } from './entry-list';
import { createSideSections, type SideTab } from './side-sections';

// Each call the view makes to a tab's entry list that draws it, by method name.
const listCalls = vi.hoisted(() => [] as string[]);
// What the last tab's `createEntryList` and `createComposerSurface` received.
const built = vi.hoisted(() => ({
  entryList: null as EntryListDeps | null,
  composer: null as ComposerPieces | null,
}));
vi.mock('./entry-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./entry-list')>();
  return {
    ...actual,
    createEntryList(...args: Parameters<typeof actual.createEntryList>) {
      built.entryList = args[0];
      const list = actual.createEntryList(...args);
      return {
        ...list,
        setWorking(...call: Parameters<typeof list.setWorking>) {
          listCalls.push('setWorking');
          list.setWorking(...call);
        },
        setQueued(...call: Parameters<typeof list.setQueued>) {
          listCalls.push('setQueued');
          list.setQueued(...call);
        },
        rebuild(...call: Parameters<typeof list.rebuild>) {
          listCalls.push('rebuild');
          list.rebuild(...call);
        },
      };
    },
  };
});
vi.mock('./composer-kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./composer-kit')>();
  return {
    ...actual,
    createComposerSurface(
      ...args: Parameters<typeof actual.createComposerSurface>
    ) {
      built.composer = args[1];
      return actual.createComposerSurface(...args);
    },
  };
});

const NO_ENTRIES: ChatEntry[] = [];

function stateOf(
  returned: ReturnedMessage[],
  overrides: Partial<ChatSessionState> = {},
): ChatSessionState {
  return {
    sessionId: 'row-1',
    projectDir: '/w/app',
    profile: 'work',
    entries: NO_ENTRIES,
    controls: [],
    activity: 'idle',
    background: 0,
    activeTime: NO_ACTIVE_TIME,
    commands: [],
    running: false,
    queued: [],
    returned,
    repo: 'app',
    branch: 'main',
    worktrees: [],
    headless: false,
    compaction: null,
    ...overrides,
  };
}

const returnedOne: ReturnedMessage = {
  id: 'returned-1',
  text: 'one',
  images: [],
};
const returnedTwo: ReturnedMessage = {
  id: 'returned-2',
  text: 'two',
  images: [],
};

// A mounted view over a real slot store. `writers` writes chat's slots as main
// does: `open` a session's lists and then its key, `setInfo` a new value at its
// key. `pageLoad` writes sessions and then tells the view the page is ready; `open`
// tells it first, so the session arrives on a live view. `rest` is the
// `sessionRested` message. `box` is the one tab's box text, null before a tab
// mounts, `tab` its element, `tabElements` each session's tab element, `invoked`
// each call to main, `activities` each row activity word set, and `toasts` each
// toast. `sideParts` and `composerParts` are the view's part stores, `layouts` its
// chat layouts, `removeSession` closes a session's tab as the sessions plugin
// does, and `setActive` names the focused pane's session. `keyCalls` records
// each `setScope`, `setResizeTarget` and `setFocusTarget` in order, a
// `setScope` reporting its scope in force as the core does, and
// `boxCalls` each `focus` and `blur` on the box with its options, the fake box
// reporting focus and blur as the editor does. `visible` is what every tab's
// `isVisible` answers, `show` runs a session's tab's `shown`, `scopeChanged`
// reports a scope in force, and `sideTabs` holds each tab's hub. `owners` holds
// each session's row owner as `ownerOf` reads it, null for a session it does not
// name and undefined for a row not yet arrived; `rowAdded` sets a row's owner
// and tells the view the row arrived. `addTabs` records each `addTab` session id
// and `otherShown.count` each `otherSessionShown` call.
function mounted(
  firstActiveTimeListener: (
    sessionId: string,
    activeTime: ActiveTime,
  ) => void = () => undefined,
) {
  listCalls.length = 0;
  const listeners = new Map<string, (data: unknown) => void>();
  const invoked: unknown[][] = [];
  const logs: string[] = [];
  const keyRuns: [string, unknown][] = [];
  const toasts: [string, string][] = [];
  const activities: (string | undefined)[] = [];
  const box = { text: null as string | null };
  const tab = { element: null as FakeElement | null };
  const tabElements = new Map<string, FakeElement>();
  const keyCalls: [string, unknown][] = [];
  const boxCalls: [string, FocusOptions | BlurOptions | undefined][] = [];
  const visible = { value: false };
  const shownBy = new Map<string, () => void>();
  let scopeChanged: (scope: string | undefined) => void = () => undefined;
  const sideTabs: SideTab[] = [];
  const sideParts = createPartStore<ChatSidePart>();
  const composerParts = createPartStore<ChatComposerPart>();
  const channel = {
    on(message: string, listener: (data: unknown) => void) {
      listeners.set(message, listener);
      return { remove: () => undefined };
    },
    invoke(method: string, ...args: unknown[]) {
      invoked.push([method, ...args]);
      return Promise.resolve();
    },
  };
  const log = (line: string) => logs.push(line);
  const noEvent = () => undefined;
  const store = createSlotStore((_owner, line) => logs.push(line));
  const writers = {
    session: store.publish(chatSessionSlot),
    entries: store.publish(chatEntriesSlot),
    controls: store.publish(chatControlsSlot),
    commands: store.publish(chatCommandsSlot),
    queued: store.publish(chatQueuedSlot),
    returned: store.publish(chatReturnedSlot),
  };
  const writeSession = (state: ChatSessionState) => {
    const { entries, controls, commands, queued, returned, ...info } = state;
    writers.entries.replace(state.sessionId, entries);
    writers.controls.set(state.sessionId, controls);
    writers.commands.set(state.sessionId, commands);
    writers.queued.set(state.sessionId, queued);
    writers.returned.set(state.sessionId, returned);
    writers.session.set(state.sessionId, info);
  };
  const layouts = createChatLayouts(log);
  const kit = {
    markdown: {},
    keys: { anchor: () => ({ dispose: noEvent }), keysFor: () => null },
    commands: { exists: () => true, argShape: () => undefined, run: noEvent },
    platform: 'macos',
    log,
  } as unknown as SurfaceKitDeps;
  const activeTimeCalls: [string, ActiveTime][] = [];
  // What `activeTime` read while `addTab` ran, as a row drawn then reads it.
  const readDuringAddTab: (ActiveTime | null)[] = [];
  let removeSession: (sessionId: string) => void = noEvent;
  // Each tab's close guard, and each session the end-session confirm opened
  // for; the confirm answers `confirmAnswer.ended`.
  const beforeCloses = new Map<
    string,
    (atOnce: boolean) => boolean | Promise<boolean>
  >();
  const confirmed: string[] = [];
  const confirmAnswer = { ended: false };
  let activeSessionId: string | null = null;
  const owners = new Map<string, string | null | undefined>();
  let rowAdded: (sessionId: string) => void = noEvent;
  const addTabs: string[] = [];
  const otherShown = { count: 0 };
  const view = mountChatView({
    channel,
    slots: {
      session: store.read(chatSessionSlot, 'chat'),
      entries: store.read(chatEntriesSlot, 'chat'),
      controls: store.read(chatControlsSlot, 'chat'),
      commands: store.read(chatCommandsSlot, 'chat'),
      queued: store.read(chatQueuedSlot, 'chat'),
      returned: store.read(chatReturnedSlot, 'chat'),
    },
    paths: posixPaths,
    homeDir: '/w',
    sessions: {
      addTab: (
        sessionId: string,
        added: {
          element: HTMLElement;
          beforeClose(atOnce: boolean): boolean | Promise<boolean>;
          shown: () => void;
        },
      ) => {
        addTabs.push(sessionId);
        readDuringAddTab.push(view.activeTime(sessionId));
        beforeCloses.set(sessionId, added.beforeClose);
        shownBy.set(sessionId, added.shown);
        tab.element = asFake(added.element);
        tabElements.set(sessionId, tab.element);
        return {
          select: noEvent,
          remove: noEvent,
          isVisible: () => visible.value,
        };
      },
      activate: noEvent,
      setActivity: (
        _sessionId: string,
        _source: string,
        activity: { word: string } | null,
      ) => activities.push(activity?.word),
    },
    activeSessionId: () => activeSessionId,
    ownerOf: (sessionId: string) =>
      owners.has(sessionId) ? owners.get(sessionId) : null,
    onRowAdded: (listener: (sessionId: string) => void) => {
      rowAdded = listener;
    },
    otherSessionShown: () => {
      otherShown.count += 1;
    },
    onSessionRemoved: (listener: (sessionId: string) => void) => {
      removeSession = listener;
    },
    onActiveChanged: noEvent,
    onSessionHostChanged: noEvent,
    onScopeChanged: (listener: (scope: string | undefined) => void) => {
      scopeChanged = listener;
    },
    activeTimeListeners: [
      firstActiveTimeListener,
      (sessionId: string, activeTime: ActiveTime) => {
        activeTimeCalls.push([sessionId, activeTime]);
      },
    ],
    editor: {
      create(_element: HTMLElement, _text: string, events: EditorEvents) {
        box.text = '';
        return {
          text: () => box.text,
          setText: (next: string) => {
            box.text = next;
          },
          focus: (options?: FocusOptions) => {
            boxCalls.push(['focus', options]);
            events.focused();
          },
          blur: (options?: BlurOptions) => {
            boxCalls.push(['blur', options]);
            events.blurred();
          },
          destroy: noEvent,
        } as unknown as TextEditor;
      },
    },
    // The core reports the base set as the scope in force, nothing pushed.
    setScope: (scope: string) => {
      keyCalls.push(['setScope', scope]);
      scopeChanged(`chat.${scope}`);
    },
    setResizeTarget: (target: ResizeTarget | null) =>
      keyCalls.push(['setResizeTarget', target]),
    setFocusTarget: (target: FocusTarget | null) =>
      keyCalls.push(['setFocusTarget', target]),
    layouts,
    composerParts,
    statusParts: createPartStore(),
    sideParts,
    sideSections: recordingSideTabs(
      createSideSections({
        layouts,
        kit,
        parts: sideParts,
        uiState: { get: () => undefined, set: noEvent },
        timers: { set: () => 0, clear: noEvent },
        toggleClicked: noEvent,
        log,
      }),
      sideTabs,
    ),
    ...kit,
    run: noEvent,
    runKey: (key: CommandKey<unknown>, arg: unknown) =>
      keyRuns.push([key.id, arg]),
    clock: { now: () => 5000 },
    timers: { set: () => 0, clear: noEvent },
    drops: { addTarget: () => ({ dispose: noEvent }) },
    placeOf: () => ({
      saved: undefined,
      savedImages: [],
      write: noEvent,
      writeImages: noEvent,
    }),
    toast: (text: string, tone: string) => toasts.push([text, tone]),
    visibleSessionRested: noEvent,
    confirm: {
      open: (name: string) => {
        confirmed.push(name);
        return Promise.resolve(confirmAnswer.ended);
      },
      end: noEvent,
      keep: noEvent,
    },
  } as unknown as ChatViewDeps);
  // The page is ready once, however many sessions `open` writes after it.
  let isReady = false;
  const ready = () => {
    if (!isReady) {
      isReady = true;
      view.ready();
    }
  };
  return {
    view,
    owners,
    rowAdded: (sessionId: string, owner: string | null) => {
      owners.set(sessionId, owner);
      rowAdded(sessionId);
    },
    addTabs,
    otherShown,
    keyCalls,
    boxCalls,
    visible,
    show: (sessionId: string) => shownBy.get(sessionId)?.(),
    scopeChanged: (scope: string | undefined) => scopeChanged(scope),
    sideTabs,
    beforeClose: (sessionId: string, atOnce: boolean) =>
      beforeCloses.get(sessionId)?.(atOnce),
    confirmed,
    confirmAnswer,
    activeTimeCalls,
    readDuringAddTab,
    removeSession: (sessionId: string) => removeSession(sessionId),
    setActive: (sessionId: string | null) => {
      activeSessionId = sessionId;
    },
    box,
    tab,
    tabElements,
    layouts,
    sideParts,
    composerParts,
    invoked,
    keyRuns,
    logs,
    toasts,
    activities,
    writers,
    ready,
    pageLoad(states: ChatSessionState[]) {
      states.forEach(writeSession);
      ready();
    },
    open(state: ChatSessionState) {
      ready();
      writeSession(state);
    },
    setInfo(sessionId: string, change: Partial<ChatSessionInfo>) {
      const info = writers.session.get(sessionId) as ChatSessionInfo;
      writers.session.set(sessionId, { ...info, ...change });
    },
    rest: (sessionId: string, error: string | null) =>
      listeners.get('sessionRested')?.({ sessionId, error }),
  };
}

// `sections` with each tab it opens kept in `opened`.
function recordingSideTabs(
  sections: ReturnType<typeof createSideSections>,
  opened: SideTab[],
): Pick<ReturnType<typeof createSideSections>, 'openTab'> {
  return {
    openTab(root, sessionId) {
      const side = sections.openTab(root, sessionId);
      opened.push(side);
      return side;
    },
  };
}

describe('mountChatView returned messages', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const PLACED_BOTH = [
    ['returnedPlaced', 'row-1', ['returned-1', 'returned-2']],
  ];

  it('returned_HeldByMainAtMount_PlacedOnceAndReported', () => {
    const view = mounted();

    view.pageLoad([stateOf([returnedOne, returnedTwo])]);

    expect(view.box.text).toBe('one\ntwo');
    expect(view.invoked).toEqual(PLACED_BOTH);
  });

  it('returned_ArrivingForAMountedTab_PlacedOnceAndReported', () => {
    const view = mounted();
    view.pageLoad([stateOf([])]);
    expect(view.invoked).toEqual([]);

    view.writers.returned.set('row-1', [returnedOne, returnedTwo]);

    expect(view.box.text).toBe('one\ntwo');
    expect(view.invoked).toEqual(PLACED_BOTH);
  });

  it('chatView_ReturnedStillListed_PlacesOnce', () => {
    const view = mounted();
    view.pageLoad([stateOf([returnedOne])]);

    view.writers.returned.set('row-1', [returnedOne, returnedTwo]);
    view.writers.returned.set('row-1', [returnedOne, returnedTwo]);

    expect(view.box.text).toBe('two\none');
    expect(view.invoked).toEqual([
      ['returnedPlaced', 'row-1', ['returned-1']],
      ['returnedPlaced', 'row-1', ['returned-2']],
    ]);
  });
});

describe('mountChatView side parts', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('side parts build per tab, leave with their part, and dispose with their tab', () => {
    const view = mounted();
    view.pageLoad([stateOf([], { sessionId: 'row-1' })]);
    const built: string[] = [];
    const disposed: string[] = [];
    const partOf = (id: string): ChatSidePart => ({
      id,
      title: id,
      order: 10,
      build(parent, sessionId) {
        built.push(`${id} ${sessionId}`);
        parent.textContent = `${id} ${sessionId}`;
        return { dispose: () => disposed.push(`${id} ${sessionId}`) };
      },
    });
    const tabChildren = (sessionId: string) =>
      (view.tabElements.get(sessionId) as FakeElement).children;
    const wrappers = (sessionId: string) =>
      findAll(tabChildren(sessionId)[1], 'chat-side-part');
    const wrapperTexts = (sessionId: string) =>
      wrappers(sessionId).map(
        (wrapper) => findAll(wrapper, 'chat-side-section-body')[0].textContent,
      );

    const first = view.sideParts.add(partOf('first'));
    view.open(stateOf([], { sessionId: 'row-2' }));

    expect(tabChildren('row-1').map((child) => child.className)).toEqual([
      'chat-main',
      'chat-side-parts',
    ]);
    expect(findAll(tabChildren('row-1')[0], 'chat-working-slot')).toHaveLength(
      1,
    );
    expect(built).toEqual(['first row-1', 'first row-2']);
    expect(wrapperTexts('row-1')).toEqual(['first row-1']);
    expect(wrapperTexts('row-2')).toEqual(['first row-2']);
    expect(disposed).toEqual([]);
    const firstWrapper = wrappers('row-1')[0];

    const composerPart = view.composerParts.add({
      id: 'above-the-box',
      build: () => ({}),
    });

    expect(findAll(tabChildren('row-1')[0], 'chat-composer-part')).toHaveLength(
      1,
    );
    expect(built).toEqual(['first row-1', 'first row-2']);
    expect(disposed).toEqual([]);
    composerPart.dispose();

    const second = view.sideParts.add(partOf('second'));

    expect(built).toEqual([
      'first row-1',
      'first row-2',
      'second row-1',
      'second row-2',
    ]);
    expect(disposed).toEqual([]);
    expect(wrapperTexts('row-1')).toEqual(['first row-1', 'second row-1']);
    expect(wrappers('row-1')[0]).toBe(firstWrapper);

    built.length = 0;
    first.dispose();

    expect(built).toEqual([]);
    expect(disposed).toEqual(['first row-1', 'first row-2']);
    expect(wrapperTexts('row-1')).toEqual(['second row-1']);
    expect(wrapperTexts('row-2')).toEqual(['second row-2']);

    disposed.length = 0;
    const firstAgain = view.sideParts.add(partOf('first'));

    expect(disposed).toEqual([]);
    expect(wrapperTexts('row-2')).toEqual(['second row-2', 'first row-2']);

    view.removeSession('row-1');

    expect(disposed).toEqual(['second row-1', 'first row-1']);

    disposed.length = 0;
    second.dispose();
    firstAgain.dispose();

    expect(disposed).toEqual(['second row-2', 'first row-2']);
    expect(wrapperTexts('row-2')).toEqual([]);
  });

  it('a side part whose build throws stays unbuilt in its tab until it is added again', () => {
    const view = mounted();
    view.pageLoad([stateOf([], { sessionId: 'row-1' })]);
    let attempts = 0;
    const failing: ChatSidePart = {
      id: 'failing',
      title: 'Failing',
      order: 10,
      build() {
        attempts += 1;
        throw new Error('build failed');
      },
    };
    const holder = () =>
      (view.tabElements.get('row-1') as FakeElement).children[1];

    const added = view.sideParts.add(failing);
    const other = view.sideParts.add({
      id: 'other',
      title: 'Other',
      order: 20,
      build: () => ({}),
    });

    expect(attempts).toBe(1);
    expect(
      findAll(holder(), 'chat-side-part').map(
        (wrapper) => wrapper.dataset.part,
      ),
    ).toEqual(['other']);

    added.dispose();
    view.sideParts.add(failing);

    expect(attempts).toBe(2);
    other.dispose();
    expect(attempts).toBe(2);
  });

  it('a chat layout change disposes a side part once and builds it again', () => {
    const view = mounted();
    view.pageLoad([stateOf([])]);
    let builds = 0;
    let disposes = 0;
    view.sideParts.add({
      id: 'part',
      title: 'Part',
      order: 10,
      build() {
        builds += 1;
        return {
          dispose: () => {
            disposes += 1;
          },
        };
      },
    });

    view.layouts.set(view.layouts.shown());

    expect({ builds, disposes }).toEqual({ builds: 2, disposes: 1 });
  });
});

describe('mountChatView session facts source', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const COMPOSER_UPDATE_THROWS: ChatLayout = {
    composer(parent, input, kit) {
      const { element } = defaultLayout.composer(parent, input, kit);
      return {
        element,
        update() {
          throw new Error('composer update failed');
        },
      };
    },
  };

  it.each<{ case: string; user: ChatLayout; composerRedrawn: boolean }>([
    { case: 'StatusLineDraws', user: {}, composerRedrawn: false },
    {
      case: 'ComposerUpdateThrows',
      user: COMPOSER_UPDATE_THROWS,
      composerRedrawn: true,
    },
  ])('branchWrite_$case_ListenerRunsOnce', ({ user, composerRedrawn }) => {
    const mount = mounted();
    mount.layouts.set({
      user: 'mine',
      layouts: new Map([
        ['mine', user],
        ['default', defaultLayout],
      ]),
    });
    mount.open(stateOf([]));
    const source = mount.view.sessionFactsSource('row-1');
    const branchesHeard: (string | null)[] = [];
    source?.onChanged(() => branchesHeard.push(source.input().branch));

    mount.setInfo('row-1', { branch: 'feature' });

    expect(branchesHeard).toEqual(['feature']);
    expect(
      mount.logs.some((line) => line.includes('composer update failed')),
    ).toBe(composerRedrawn);
  });

  it('worktreesWrite_ListenerHearsWorktrees', () => {
    const mount = mounted();
    mount.open(stateOf([]));
    const source = mount.view.sessionFactsSource('row-1');
    const worktreesHeard: (readonly string[])[] = [];
    source?.onChanged(() => worktreesHeard.push(source.input().worktrees));

    mount.setInfo('row-1', { worktrees: ['app-fix'] });

    expect(worktreesHeard).toEqual([['app-fix']]);
  });

  it('source_SubscriptionDisposedOrSessionUnheld_HearsNothingAndIsNull', () => {
    const mount = mounted();
    mount.open(stateOf([]));
    const source = mount.view.sessionFactsSource('row-1');
    let heard = 0;
    source
      ?.onChanged(() => {
        heard += 1;
      })
      .dispose();

    mount.setInfo('row-1', { branch: 'b' });
    mount.removeSession('row-1');

    expect(heard).toBe(0);
    expect(mount.view.sessionFactsSource('row-1')).toBeNull();
  });
});

describe('mountChatView active time', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const STARTED: ActiveTime = { totalMs: 65_000, since: null };
  const RUNNING: ActiveTime = { totalMs: 65_000, since: 4000 };

  it('activeTime_SessionStarted_ReadableDuringAddTabAndAtItsOneCall', () => {
    const readAtCall: (ActiveTime | null)[] = [];
    const mount = mounted((sessionId) => {
      readAtCall.push(mount.view.activeTime(sessionId));
    });

    mount.open({ ...stateOf([]), activeTime: STARTED });

    expect(mount.readDuringAddTab).toEqual([STARTED]);
    expect(readAtCall).toEqual([STARTED]);
    expect(mount.activeTimeCalls).toEqual([['row-1', STARTED]]);
  });

  it('activeTime_SessionWrite_KeepsTheRecordAndCallsOnce', () => {
    const mount = mounted();
    mount.open(stateOf([]));
    mount.activeTimeCalls.length = 0;

    mount.setInfo('row-1', { activeTime: RUNNING });

    expect(mount.view.activeTime('row-1')).toEqual(RUNNING);
    expect(mount.view.activeTime('row-2')).toBeNull();
    expect(mount.activeTimeCalls).toEqual([['row-1', RUNNING]]);
  });

  it('activeTime_AListenerThrowsOnAWrite_TheNextStillRuns', () => {
    let isFailing = false;
    const mount = mounted(() => {
      if (isFailing) {
        throw new Error('listener failed');
      }
    });
    mount.open(stateOf([]));
    mount.activeTimeCalls.length = 0;
    isFailing = true;

    mount.setInfo('row-1', { activeTime: RUNNING });

    expect(mount.activeTimeCalls).toEqual([['row-1', RUNNING]]);
    expect(mount.view.activeTime('row-1')).toEqual(RUNNING);
    expect(mount.logs).toContain(
      'chat.session listener failed: listener failed',
    );
  });

  it('activeTime_AListenerThrowsOnArrival_EverySessionStillArrives', () => {
    const mount = mounted(() => {
      throw new Error('listener failed');
    });

    mount.pageLoad([
      { ...stateOf([]), sessionId: 'row-1', activeTime: STARTED },
      { ...stateOf([]), sessionId: 'row-2', activeTime: RUNNING },
    ]);

    expect(mount.activeTimeCalls).toEqual([
      ['row-1', STARTED],
      ['row-2', RUNNING],
    ]);
    expect(mount.view.activeTime('row-2')).toEqual(RUNNING);
    expect(mount.logs).toEqual([
      'chat session arrival failed: listener failed',
    ]);
  });
});

describe('mountChatView mayStop', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const REASON = "Send or clear the draft in gamma 2's chat first";

  it.each([
    { case: 'nothing typed', text: '', hasImage: false, expected: null },
    { case: 'whitespace only', text: ' \n\t', hasImage: false, expected: null },
    {
      case: 'typed and not sent',
      text: 'hi',
      hasImage: false,
      expected: REASON,
    },
    {
      case: 'an image with no text',
      text: '',
      hasImage: true,
      expected: REASON,
    },
  ])('mayStop_$case', ({ text, hasImage, expected }) => {
    const view = mounted();
    view.pageLoad([stateOf([], { sessionId: 's1' })]);

    view.box.text = text;
    if (hasImage) {
      view.view
        .session('s1')
        ?.attachments.add({ mediaType: 'image/png', data: 'AAAA' });
    }

    expect(view.view.mayStop([{ sessionId: 's1', label: 'gamma 2' }])).toBe(
      expected,
    );
  });
});

describe('mountChatView compaction', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const COMPACTION: SessionCompaction = {
    trigger: 'manual',
    reason: null,
    startedAt: 4000,
  };

  it.each<{
    case: string;
    mountedWith: SessionCompaction | null;
    written?: SessionCompaction | null;
    dockState: string | null;
    dockTrigger: string | null;
    isIndicatorIdle: boolean;
  }>([
    {
      case: 'MountedWithOne_ShowsTheDock',
      mountedWith: COMPACTION,
      dockState: 'Compacting…',
      dockTrigger: '/compact',
      isIndicatorIdle: false,
    },
    {
      case: 'Write_ShowsTheDock',
      mountedWith: null,
      written: COMPACTION,
      dockState: 'Compacting…',
      dockTrigger: '/compact',
      isIndicatorIdle: false,
    },
    {
      case: 'NullWrite_ClearsToIdle',
      mountedWith: COMPACTION,
      written: null,
      dockState: null,
      dockTrigger: null,
      isIndicatorIdle: true,
    },
  ])(
    'compaction_$case',
    ({ mountedWith, written, dockState, dockTrigger, isIndicatorIdle }) => {
      const view = mounted();
      view.pageLoad([stateOf([], { running: true, compaction: mountedWith })]);

      if (written !== undefined) {
        view.setInfo('row-1', { compaction: written });
      }

      const root = view.tab.element as FakeElement;
      const textOf = (className: string) =>
        findAll(root, className)[0]?.textContent ?? null;
      expect(findAll(root, 'chat-working-slot')[0].hidden).toBe(
        dockState === null,
      );
      expect(textOf('chat-working-state')).toBe(dockState);
      expect(textOf('chat-working-trigger')).toBe(dockTrigger);
      expect(
        findAll(root, 'chat-running')[0].classList.contains('is-idle'),
      ).toBe(isIndicatorIdle);
    },
  );
});

describe('mountChatView slots', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const NOTICE: ChatEntry = {
    kind: 'notice',
    id: 'n1',
    at: 1000,
    text: 'hello',
    tone: 'info',
    raw: [],
  };
  const QUEUED: QueuedMessage = {
    id: 'queued-1',
    text: 'later',
    images: [],
    sentEntryId: null,
    holdReason: null,
  };
  const COMPACTION: SessionCompaction = {
    trigger: 'manual',
    reason: null,
    startedAt: 4000,
  };
  const COMMAND = { name: 'compact' } as AgentCommand;
  const FULL = stateOf([returnedOne], {
    entries: [NOTICE],
    queued: [QUEUED],
    commands: [COMMAND],
  });

  it('chatView_PageLoad_DrawsEverySessionInMirror', () => {
    const view = mounted();

    view.pageLoad([
      stateOf([], { sessionId: 'row-1' }),
      stateOf([], { sessionId: 'row-2' }),
    ]);

    expect([...view.tabElements.keys()]).toEqual(['row-1', 'row-2']);
  });

  it('chatView_SessionKeyAfterLists_BuildsTabWithThem', () => {
    const view = mounted();

    view.open(FULL);

    expect(view.view.session('row-1')?.state).toEqual(FULL);
    expect(view.box.text).toBe('one');
  });

  it('chatView_ChangeWithNoTab_LosesNothing', () => {
    const view = mounted();
    view.ready();
    const { entries, controls, commands, queued, returned, ...info } = FULL;

    view.writers.entries.put('row-1', NOTICE);
    view.writers.queued.set('row-1', queued);
    view.writers.commands.set('row-1', commands);
    view.writers.returned.set('row-1', returned);
    expect(view.logs).toEqual([]);
    expect(view.invoked).toEqual([]);
    view.writers.controls.set('row-1', controls);
    view.writers.session.set('row-1', info);

    expect(view.view.session('row-1')?.state).toEqual({ ...FULL, entries });
    expect(view.box.text).toBe('one');
    expect(view.invoked).toEqual([['returnedPlaced', 'row-1', ['returned-1']]]);
  });

  it.each(
    (
      [
        'session',
        'entries',
        'controls',
        'commands',
        'queued',
        'returned',
      ] as const
    ).map((slot) => ({ slot })),
  )('chatView_KeyDeleted_TabStaysAsDrawn: $slot', ({ slot }) => {
    const view = mounted();
    view.open(FULL);
    const stateBefore = view.view.session('row-1')?.state;
    const logsBefore = [...view.logs];
    const invokedBefore = [...view.invoked];
    listCalls.length = 0;

    view.writers[slot].delete('row-1');

    expect(view.logs).toEqual(logsBefore);
    expect(view.invoked).toEqual(invokedBefore);
    expect(listCalls).toEqual([]);
    expect(view.view.session('row-1')?.state).toBe(stateBefore);
  });

  it.each<{
    block: string;
    opening?: Partial<ChatSessionState>;
    change: Partial<ChatSessionInfo>;
    lines: (string | RegExp)[];
    workingDraws: number;
    clockCalls: number;
  }>([
    {
      block: 'activity',
      change: { activity: 'working' },
      lines: ['app is working'],
      workingDraws: 1,
      clockCalls: 0,
    },
    {
      block: 'background',
      change: { background: 2 },
      lines: ['app has 2 running in the background'],
      workingDraws: 0,
      clockCalls: 0,
    },
    {
      block: 'activeTime',
      change: { activeTime: { totalMs: 7000, since: 4000 } },
      lines: [],
      workingDraws: 0,
      clockCalls: 1,
    },
    {
      block: 'compaction',
      change: { compaction: COMPACTION },
      lines: [/^app compacting: /],
      workingDraws: 0,
      clockCalls: 0,
    },
    {
      block: 'running, to true',
      change: { running: true },
      lines: ['app running'],
      workingDraws: 1,
      clockCalls: 0,
    },
    {
      block: 'running, to false',
      opening: { running: true },
      change: { running: false },
      lines: [],
      workingDraws: 1,
      clockCalls: 0,
    },
    {
      block: 'branch',
      change: { branch: 'feature' },
      lines: ['app is in app on feature'],
      workingDraws: 0,
      clockCalls: 0,
    },
    {
      block: 'repo',
      change: { repo: 'other' },
      lines: ['app is in other on main'],
      workingDraws: 0,
      clockCalls: 0,
    },
    {
      block: 'worktrees',
      change: { worktrees: ['app-fix'] },
      lines: ['app wrote in worktree app-fix'],
      workingDraws: 0,
      clockCalls: 0,
    },
  ])(
    'chatView_SessionWrite_RunsOnlyChangedBlock: $block',
    ({ opening, change, lines, workingDraws, clockCalls }) => {
      const view = mounted();
      view.open(stateOf([], opening));
      view.logs.length = 0;
      view.activeTimeCalls.length = 0;
      listCalls.length = 0;

      view.setInfo('row-1', change);
      // The same values in a fresh object, as a write over the Bridge arrives.
      const info = view.writers.session.get('row-1') as ChatSessionInfo;
      view.writers.session.set('row-1', structuredClone(info));

      const blockLines = view.logs.filter(
        (line) => !line.startsWith('row activity'),
      );
      expect(blockLines).toEqual(
        lines.map((line) =>
          typeof line === 'string' ? line : expect.stringMatching(line),
        ),
      );
      expect(listCalls.filter((call) => call === 'setWorking')).toHaveLength(
        workingDraws,
      );
      expect(view.activeTimeCalls).toHaveLength(clockCalls);
    },
  );

  it('chatView_ErrorRest_ToastsOnce', () => {
    const view = mounted();
    view.open(stateOf([], { running: true, activity: 'working' }));

    view.setInfo('row-1', { running: false });
    expect(view.toasts).toEqual([]);
    view.rest('row-1', 'boom');

    expect(view.view.session('row-1')?.running).toBe(false);
    expect(view.toasts).toEqual([[expect.stringContaining('boom'), 'error']]);
  });

  it.each<{
    case: string;
    activity: ChatSessionState['activity'];
    error: string | null;
  }>([
    { case: 'ActiveRow', activity: 'working', error: null },
    { case: 'IdleRowWithError', activity: 'idle', error: 'boom' },
  ])('chatView_Rest_DrawsUnseenOnly: $case', ({ activity, error }) => {
    const view = mounted();
    view.open(stateOf([], { running: true, activity }));
    view.setInfo('row-1', { running: false });
    listCalls.length = 0;

    view.rest('row-1', error);
    expect(listCalls).toEqual([]);
    view.setInfo('row-1', { activity: 'idle' });

    expect(view.activities.at(-1)).toBe('error');
  });

  it.each<{ case: string; active: string | null; word: string | undefined }>([
    { case: 'SessionElsewhere_ShowsDone', active: 'row-2', word: 'done' },
    { case: 'SessionFocused_ShowsNothing', active: 'row-1', word: undefined },
  ])('chatView_TurnEnd_$case', ({ active, word }) => {
    const view = mounted();
    view.open(stateOf([], { running: true, activity: 'working' }));
    view.setActive(active);

    view.setInfo('row-1', { activity: 'idle' });

    expect(view.activities.at(-1)).toBe(word);
  });
});

describe('mountChatView click sites', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const PERMISSION: PermissionEntry = {
    kind: 'permission',
    id: 'p1',
    at: 1000,
    toolName: 'Bash',
    input: {},
    answer: null,
    raw: [],
  };

  it.each<{
    site: string;
    click(list: EntryListDeps, composer: ComposerPieces): void;
    run: [string, unknown];
  }>([
    {
      site: 'Allow once',
      click: (list) => list.kit.allow(PERMISSION),
      run: ['chat.allowEntry', { sessionId: 'row-2', entryId: 'p1' }],
    },
    {
      site: 'Deny',
      click: (list) => list.kit.deny(PERMISSION),
      run: ['chat.denyEntry', { sessionId: 'row-2', entryId: 'p1' }],
    },
    {
      site: 'thumbnail',
      click: (list) => list.kit.openImages('u1', 2),
      run: ['chat.openImage', { sessionId: 'row-2', entryId: 'u1', index: 2 }],
    },
    {
      site: 'expander head',
      click: (list) => list.kit.expanderClicked('a1', 1),
      run: [
        'chat.toggleExpander',
        { sessionId: 'row-2', entryId: 'a1', place: 1 },
      ],
    },
    {
      site: 'activity line',
      click: (list) => list.runClicked('activity:t1'),
      run: ['chat.toggleRun', { sessionId: 'row-2', runId: 'activity:t1' }],
    },
    {
      site: 'list click',
      click: (list) => list.stopClicked('n1'),
      run: ['chat.moveFocus', { sessionId: 'row-2', stopId: 'n1' }],
    },
    {
      site: 'pending row',
      click: (list) => list.pullBack('q1'),
      run: ['chat.pullBackMessage', { sessionId: 'row-2', queuedId: 'q1' }],
    },
    {
      site: 'image remove',
      click: (_list, composer) => composer.removeImage(3),
      run: ['chat.removeImageAt', { sessionId: 'row-2', index: 3 }],
    },
  ])('clickSites_RunTheirCommandWithTheirArg: $site', ({ click, run }) => {
    const view = mounted();
    view.open(stateOf([], { sessionId: 'row-2' }));

    click(built.entryList!, built.composer!);

    expect(view.keyRuns).toEqual([run]);
  });
});

describe('mountChatView close guard', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      case: 'idle',
      running: false,
      atOnce: false,
      ended: false,
      closes: true,
      asked: 0,
    },
    {
      case: 'working, user ends it',
      running: true,
      atOnce: false,
      ended: true,
      closes: true,
      asked: 1,
    },
    {
      case: 'working, user keeps it',
      running: true,
      atOnce: false,
      ended: false,
      closes: false,
      asked: 1,
    },
    {
      case: 'working, closed at once',
      running: true,
      atOnce: true,
      ended: false,
      closes: true,
      asked: 0,
    },
  ])('beforeClose_EachState_AnswersTheConfirmsAnswer ($case)', async (test) => {
    const view = mounted();
    view.pageLoad([
      stateOf([], { running: test.running, activity: 'working' }),
    ]);
    view.confirmAnswer.ended = test.ended;

    const closes = await view.beforeClose('row-1', test.atOnce);

    expect(closes).toBe(test.closes);
    expect(view.confirmed).toHaveLength(test.asked);
  });
});

describe('mountChatView pane keys', () => {
  // Each ResizeObserver the view builds: its callback and what it observes.
  interface StubObserver {
    callback: () => void;
    observed: Set<unknown>;
  }
  let observers: StubObserver[];
  beforeEach(() => {
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
    observers = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private record: StubObserver;
        constructor(callback: () => void) {
          this.record = { callback, observed: new Set() };
          observers.push(this.record);
        }
        observe(target: unknown) {
          this.record.observed.add(target);
        }
        disconnect() {
          this.record.observed.clear();
        }
      },
    );
  });
  // Runs each observer of `target`, as the browser does when it resizes.
  const resize = (target: unknown) => {
    for (const { callback, observed } of observers) {
      if (observed.has(target)) {
        callback();
      }
    }
  };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type From =
    | 'transcript'
    | 'box'
    | 'hub from the box'
    | 'hub from the transcript'
    | 'strip';

  // The visible Chat tab of `/w/app`, shown, with one hub section whose head
  // shows and a composer part whose stop takes the cursor on `enterStop`; the
  // hub's holder has a layout box while `isHubReachable`. `target` is the
  // focus target the tab handed over when shown, and `stopExits` the exits the
  // part's last `enter` got.
  function shownTab(isHubReachable = true) {
    const mount = mounted();
    const stopLeaves: string[] = [];
    let stopExits: ComposerStopExits | null = null;
    mount.composerParts.add({
      id: 'strip',
      build: () => ({}),
      stop: {
        enter(_sessionId, exits) {
          mount.keyCalls.push(['setScope', 'strip.own']);
          stopExits = exits;
          return true;
        },
        leave: (sessionId) => stopLeaves.push(sessionId),
      },
    });
    mount.open(stateOf([]));
    mount.sideParts.add({
      id: 'part',
      title: 'Part',
      order: 10,
      build(parent) {
        parent.textContent = 'content';
        return {};
      },
    });
    const root = mount.tab.element as FakeElement;
    findAll(root, 'chat-side-parts')[0].hasLayoutBox = isHubReachable;
    for (const head of findAll(root, 'chat-side-section-head')) {
      head.hasLayoutBox = true;
    }
    mount.visible.value = true;
    mount.show('row-1');
    // The tab hands one focus target, the same one each time.
    const focusTarget = mount.keyCalls.findLast(
      ([call]) => call === 'setFocusTarget',
    )?.[1] as FocusTarget;
    const target = () => focusTarget;
    const session = () => mount.view.session('row-1') as ChatSession;
    const clear = () => {
      mount.keyCalls.length = 0;
      mount.boxCalls.length = 0;
      mount.logs.length = 0;
    };
    const putFocus = (from: From) => {
      if (from === 'box' || from === 'hub from the box') {
        session().box.focus();
      }
      if (from === 'strip') {
        session().enterStop();
      }
      if (from === 'hub from the box' || from === 'hub from the transcript') {
        target().move('right');
      }
    };
    return {
      mount,
      root,
      target,
      session,
      clear,
      putFocus,
      stopLeaves,
      stopExits: () => stopExits as ComposerStopExits | null,
    };
  }

  // The hub's holder losing its layout box, as a hidden or narrowed hub does,
  // and every section head losing its own.
  const hideHub = (root: FakeElement) => {
    findAll(root, 'chat-side-parts')[0].hasLayoutBox = false;
  };
  const hideHeads = (root: FakeElement) => {
    for (const head of findAll(root, 'chat-side-section-head')) {
      head.hasLayoutBox = false;
    }
  };

  const FOCUS_BOX = [['focus', undefined]];
  const BLUR_TO_NORMAL = [['blur', { toNormal: true }]];

  it.each<{
    from: From;
    direction: PaneDirection;
    isHubReachable?: boolean;
    returned: boolean;
    scope?: string;
    line?: string;
    box?: unknown[][];
    isBoxFocused?: boolean;
    leftStop?: boolean;
  }>([
    {
      from: 'transcript',
      direction: 'right',
      returned: true,
      scope: 'hub',
      line: 'focused the session hub in app',
    },
    {
      from: 'transcript',
      direction: 'right',
      isHubReachable: false,
      returned: false,
    },
    {
      from: 'transcript',
      direction: 'down',
      returned: true,
      scope: 'chat',
      line: 'focused the box in app',
      box: FOCUS_BOX,
      isBoxFocused: true,
    },
    { from: 'transcript', direction: 'left', returned: false },
    { from: 'transcript', direction: 'up', returned: false },
    {
      from: 'box',
      direction: 'up',
      returned: true,
      scope: 'chat',
      line: 'left the box',
      box: BLUR_TO_NORMAL,
    },
    {
      from: 'box',
      direction: 'right',
      returned: true,
      scope: 'hub',
      line: 'focused the session hub in app',
      box: BLUR_TO_NORMAL,
    },
    { from: 'box', direction: 'down', returned: false, isBoxFocused: true },
    { from: 'box', direction: 'left', returned: false, isBoxFocused: true },
    {
      from: 'hub from the box',
      direction: 'left',
      returned: true,
      scope: 'chat',
      line: 'focused the box in app',
      box: FOCUS_BOX,
      isBoxFocused: true,
    },
    {
      from: 'hub from the transcript',
      direction: 'left',
      returned: true,
      scope: 'chat',
      line: 'cursor back on the entries in app',
    },
    { from: 'hub from the transcript', direction: 'right', returned: false },
    { from: 'hub from the transcript', direction: 'up', returned: false },
    { from: 'hub from the transcript', direction: 'down', returned: false },
    {
      from: 'strip',
      direction: 'down',
      returned: true,
      scope: 'chat',
      line: 'focused the box in app',
      box: FOCUS_BOX,
      isBoxFocused: true,
      leftStop: true,
    },
    {
      from: 'strip',
      direction: 'up',
      returned: true,
      scope: 'chat',
      line: 'cursor back on the entries in app',
      leftStop: true,
    },
    {
      from: 'strip',
      direction: 'right',
      returned: true,
      scope: 'hub',
      line: 'focused the session hub in app',
      leftStop: true,
    },
    {
      from: 'strip',
      direction: 'right',
      isHubReachable: false,
      returned: false,
    },
  ])(
    'chatView_FocusMove_MovesBetweenTheTabsPanes: $from $direction (hub reachable: $isHubReachable)',
    (row) => {
      const tab = shownTab(row.isHubReachable ?? true);
      tab.putFocus(row.from);
      tab.stopLeaves.length = 0;
      tab.clear();

      const returned = tab.target().move(row.direction);

      const scopes = tab.mount.keyCalls.filter(([call]) => call === 'setScope');
      expect({
        returned,
        scope: scopes.at(-1)?.[1],
        line: tab.mount.logs.at(-1),
        box: tab.mount.boxCalls,
        isBoxFocused: tab.session().isBoxFocused(),
        leftStop: tab.stopLeaves.length > 0,
      }).toEqual({
        returned: row.returned,
        scope: row.scope,
        line: row.line,
        box: row.box ?? [],
        isBoxFocused: row.isBoxFocused ?? false,
        leftStop: row.leftStop ?? false,
      });
    },
  );

  it.each<{
    case: string;
    given?: From;
    act: (tab: ReturnType<typeof shownTab>) => void;
    scope: string | null;
    isHubDivider: boolean;
  }>([
    {
      case: 'tab shown',
      act: (tab) => tab.mount.show('row-1'),
      scope: 'chat',
      isHubDivider: false,
    },
    {
      case: 'Esc from the hub',
      given: 'hub from the transcript',
      act: (tab) => tab.mount.view.hub.leave(),
      scope: 'chat',
      isHubDivider: false,
    },
    {
      case: 'a stop exit to the entries',
      given: 'strip',
      act: (tab) => tab.stopExits()?.toEntries(),
      scope: 'chat',
      isHubDivider: false,
    },
    {
      case: 'a stop exit to the box',
      given: 'strip',
      act: (tab) => tab.stopExits()?.toBox('insert'),
      scope: 'chat',
      isHubDivider: false,
    },
    {
      case: 'entering the hub',
      act: (tab) => tab.target().move('right'),
      scope: 'hub',
      isHubDivider: true,
    },
    {
      case: 'a part taking the stop',
      act: (tab) => tab.session().enterStop(),
      scope: null,
      isHubDivider: false,
    },
  ])(
    'chatView_TakingKeys_HandsBothTargetsAfterTheScope: $case',
    ({ given, act, scope, isHubDivider }) => {
      const tab = shownTab();
      if (given !== undefined) {
        tab.putFocus(given);
      }
      const focusTarget = tab.target();
      const divider = tab.mount.sideTabs[0].divider;
      tab.clear();

      act(tab);

      const targets = [
        ['setResizeTarget', isHubDivider ? divider : null],
        ['setFocusTarget', focusTarget],
      ];
      const ownScope = ['setScope', 'strip.own'];
      expect(tab.mount.keyCalls).toEqual(
        scope === null
          ? [ownScope, ...targets]
          : [['setScope', scope], ...targets],
      );
    },
  );

  // Breaks: the ring kept under a pushed scope, the transcript's cursor bar
  // back under a scope pushed over the hub, a hidden tab keeping the hub.
  it('chatView_HubMarks_FollowTheScopeInForce', () => {
    const tab = shownTab();
    const marks = () => ({
      ringed: tab.root.classList.contains('is-hub-in-force'),
      transcriptBarHidden: tab.root.classList.contains('is-at-hub'),
    });
    tab.putFocus('hub from the box');

    expect(marks()).toEqual({ ringed: true, transcriptBarHidden: true });
    tab.mount.scopeChanged('keys.help');
    expect(marks()).toEqual({ ringed: false, transcriptBarHidden: true });
    tab.mount.scopeChanged('chat.hub');
    expect(marks()).toEqual({ ringed: true, transcriptBarHidden: true });

    tab.mount.visible.value = false;
    tab.mount.scopeChanged('sessions.sidebar');
    expect(marks()).toEqual({ ringed: false, transcriptBarHidden: false });
    tab.mount.visible.value = true;
    tab.clear();

    expect(tab.target().move('left')).toBe(false);
    expect(tab.mount.boxCalls).toEqual([]);
  });

  // Each way the hub's turn ends on its own, and the scopes it must not end
  // under: the hub, entered from the transcript, holds the keys first.
  // Breaks: a hub key with no section keeping the keys; `hiddenChanged`,
  // a resize, a press or the box missing the exit; the exit running under
  // another plugin's base scope or a pushed one, stealing its keys; the hub
  // left hidden when its own scope comes back.
  it.each<{
    case: string;
    act: (tab: ReturnType<typeof shownTab>) => void;
    scopes: string[];
  }>([
    {
      case: 'a hub key finding no section shown',
      act: (tab) => {
        hideHeads(tab.root);
        tab.mount.view.hub.move(1);
      },
      scopes: ['chat'],
    },
    {
      case: 'hiddenChanged with the hub hidden',
      act: (tab) => {
        hideHub(tab.root);
        tab.mount.view.hub.hiddenChanged();
      },
      scopes: ['chat'],
    },
    {
      case: 'hiddenChanged with the hub still shown',
      act: (tab) => tab.mount.view.hub.hiddenChanged(),
      scopes: [],
    },
    {
      case: 'the tab narrowing until the hub hides',
      act: (tab) => {
        hideHub(tab.root);
        resize(tab.root);
      },
      scopes: ['chat'],
    },
    {
      case: 'a pointer down on the entries',
      act: (tab) => findAll(tab.root, 'chat-entries')[0].fire('pointerdown'),
      scopes: ['chat'],
    },
    {
      case: 'the box taking focus',
      act: (tab) => tab.session().box.focus(),
      scopes: ['chat'],
    },
    {
      case: 'another base scope in force, hub hidden',
      act: (tab) => {
        tab.mount.scopeChanged('unity-pool.panel');
        hideHub(tab.root);
        tab.mount.view.hub.hiddenChanged();
        resize(tab.root);
      },
      scopes: [],
    },
    {
      case: 'a pushed scope, hub hidden, then the hub scope back',
      act: (tab) => {
        tab.mount.scopeChanged('keys.help');
        hideHub(tab.root);
        tab.mount.view.hub.hiddenChanged();
        tab.mount.scopeChanged('chat.hub');
      },
      scopes: ['chat'],
    },
  ])('chatView_HubTurn_EndsOnItsOwnOnlyUnderItsScope: $case', (row) => {
    const tab = shownTab();
    tab.putFocus('hub from the transcript');
    tab.clear();

    row.act(tab);

    const scopes = tab.mount.keyCalls
      .filter(([call]) => call === 'setScope')
      .map(([, scope]) => scope);
    expect(scopes).toEqual(row.scopes);
  });
});

describe('mountChatView mounts', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sessionState = (sessionId: string) => stateOf([], { sessionId });
  const childCount = (element: HTMLElement) => asFake(element).children.length;
  // A view holding owned session `s1`, mounted into a fresh element.
  const mountedOwned = () => {
    const mount = mounted();
    mount.owners.set('s1', 'practice');
    mount.open(sessionState('s1'));
    const element = document.createElement('div');
    const handle = mount.view.mount(element, 's1');
    return { mount, element, handle };
  };

  // Breaks: an owned row placed in a Sessions pane, or a key arriving before
  // its row taken for a row with no owner.
  it.each<{
    case: string;
    atArrival: string | null | 'no row';
    rowArrives?: string | null;
    addTabs: string[];
  }>([
    { case: 'owned at arrival', atArrival: 'practice', addTabs: [] },
    { case: 'unowned at arrival', atArrival: null, addTabs: ['s1'] },
    {
      case: 'owned row after the key',
      atArrival: 'no row',
      rowArrives: 'practice',
      addTabs: [],
    },
    {
      case: 'unowned row after the key',
      atArrival: 'no row',
      rowArrives: null,
      addTabs: ['s1'],
    },
  ])(
    'ownedRow_Arrives_GetsNoSessionsTab: $case',
    ({ atArrival, rowArrives, addTabs }) => {
      const mount = mounted();
      mount.owners.set('s1', atArrival === 'no row' ? undefined : atArrival);

      mount.open(sessionState('s1'));
      if (rowArrives !== undefined) {
        mount.rowAdded('s1', rowArrives);
      }

      expect(mount.addTabs).toEqual(addTabs);
      expect(mount.view.session('s1') !== undefined).toBe(addTabs.length > 0);
    },
  );

  // Breaks: keys left on a hidden mount, or never given to a shown one.
  it('mount_ShownThenHidden_TakesThenGivesUpTheChatKeys', () => {
    const { mount, handle } = mountedOwned();
    mount.keyCalls.length = 0;

    handle.shown();

    expect(mount.keyCalls[0]).toEqual(['setScope', 'chat']);
    const focusTarget = mount.keyCalls.find(
      ([call]) => call === 'setFocusTarget',
    )?.[1];
    expect(focusTarget).toBeTruthy();
    expect(mount.view.visibleSessionId()).toBe('s1');

    handle.hidden();
    mount.logs.length = 0;
    mount.view.hub.move(1);

    expect(mount.view.visibleSessionId()).toBeNull();
    expect(mount.logs).toContain('no Chat tab shown');
  });

  // Breaks: dialogs left acting on the Sessions tab's session once a mount of
  // another session shows.
  it('mount_AnotherSessionShownAfter_ClosesSessionDialogs', () => {
    const mount = mounted();
    mount.open(sessionState('s2'));
    mount.visible.value = true;
    mount.show('s2');
    mount.owners.set('s1', 'practice');
    mount.open(sessionState('s1'));
    const handle = mount.view.mount(document.createElement('div'), 's1');

    handle.shown();

    expect(mount.otherShown.count).toBe(1);
  });

  // Breaks: a mount accepted for a Sessions row, a second view of one
  // session, or a mount built on a stopped page.
  it.each<{
    case: string;
    act: (mount: ReturnType<typeof mounted>) => void;
    reason: string;
  }>([
    {
      case: 'unowned',
      act: (mount) => {
        mount.open(sessionState('s2'));
        mount.view.mount(document.createElement('div'), 's2');
      },
      reason: 'session s2 is not owned; it shows in Sessions',
    },
    {
      case: 'mounted twice',
      act: (mount) => {
        mount.owners.set('s1', 'practice');
        mount.open(sessionState('s1'));
        mount.view.mount(document.createElement('div'), 's1');
        mount.view.mount(document.createElement('div'), 's1');
      },
      reason: 'session s1 is already mounted',
    },
    {
      case: 'mounted twice while waiting',
      act: (mount) => {
        mount.owners.set('s9', undefined);
        mount.view.mount(document.createElement('div'), 's9');
        mount.view.mount(document.createElement('div'), 's9');
      },
      reason: 'session s9 is already mounted',
    },
    {
      case: 'page stopped',
      act: (mount) => {
        mount.owners.set('s1', 'practice');
        mount.open(sessionState('s1'));
        mount.view.dispose();
        mount.view.mount(document.createElement('div'), 's1');
      },
      reason: 'chat page is stopped',
    },
  ])('mount_Refused_ThrowsTheReason: $case', ({ act, reason }) => {
    const mount = mounted();

    expect(() => act(mount)).toThrow(reason);
  });

  // Breaks: a mount that throws or stays empty when the host mounts right
  // after the session starts, or one that attaches after its dispose.
  it.each<{
    case: string;
    act: (
      mount: ReturnType<typeof mounted>,
      handle: ReturnType<ReturnType<typeof mounted>['view']['mount']>,
    ) => void;
    children: number;
    addTabs?: string[];
    takesKeys?: boolean;
    logs?: string;
  }>([
    {
      case: 'key then row',
      act: (mount) => {
        mount.open(sessionState('s9'));
        mount.rowAdded('s9', 'practice');
      },
      children: 1,
    },
    {
      case: 'row then key',
      act: (mount) => {
        mount.rowAdded('s9', 'practice');
        mount.open(sessionState('s9'));
      },
      children: 1,
    },
    {
      case: 'shown while waiting',
      act: (mount, handle) => {
        handle.shown();
        mount.open(sessionState('s9'));
        mount.rowAdded('s9', 'practice');
      },
      children: 1,
      takesKeys: true,
    },
    {
      case: 'disposed while waiting',
      act: (mount, handle) => {
        handle.dispose();
        mount.open(sessionState('s9'));
        mount.rowAdded('s9', 'practice');
      },
      children: 0,
    },
    {
      case: 'row with no owner',
      act: (mount) => {
        mount.rowAdded('s9', null);
        mount.open(sessionState('s9'));
      },
      children: 0,
      addTabs: ['s9'],
      logs: 'session s9 is not owned; it shows in Sessions',
    },
  ])(
    'mount_BeforeTheSessionArrives_AttachesWhenBothArrive: $case',
    ({ act, children, addTabs = [], takesKeys = false, logs }) => {
      const mount = mounted();
      mount.ready();
      mount.owners.set('s9', undefined);
      const element = document.createElement('div');
      const handle = mount.view.mount(element, 's9');
      expect(childCount(element)).toBe(0);
      expect(mount.addTabs).toEqual([]);

      act(mount, handle);

      expect(childCount(element)).toBe(children);
      expect(mount.addTabs).toEqual(addTabs);
      expect(
        mount.keyCalls.some(
          ([call, scope]) => call === 'setScope' && scope === 'chat',
        ),
      ).toBe(takesKeys);
      if (logs !== undefined) {
        expect(mount.logs).toContain(logs);
      }
    },
  );

  // Breaks: a dispose that ends the session, keeps the view drawn, or leaves
  // the session marked mounted.
  it('mount_Disposed_LeavesTheSessionHeld', () => {
    const { mount, element, handle } = mountedOwned();
    handle.shown();

    handle.dispose();

    expect(childCount(element)).toBe(0);
    expect(mount.invoked.map(([method]) => method)).toEqual(['loadHistory']);
    expect(mount.writers.session.get('s1')).toBeDefined();
    const again = document.createElement('div');
    mount.view.mount(again, 's1');
    expect(childCount(again)).toBe(1);
  });

  // Breaks: a mount left drawn, or still taking keys, after its row left.
  it('mount_RowRemoved_TearsDownAndGoesDead', () => {
    const { mount, element, handle } = mountedOwned();

    mount.removeSession('s1');
    mount.keyCalls.length = 0;
    handle.shown();

    expect(childCount(element)).toBe(0);
    expect(mount.keyCalls).toEqual([]);
  });
});
