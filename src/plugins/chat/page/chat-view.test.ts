import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveTime } from '../../../contracts/active-time';
import type { TextEditor } from '../../../contracts/editor';
import type { AgentCommand, ChatEntry } from '../../../contracts/agent';
import { NO_ACTIVE_TIME } from '../../../shared/active-time';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  asFake,
  type FakeElement,
  findAll,
  installFakeDom,
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
  type QueuedMessage,
  type ReturnedMessage,
  type SessionCompaction,
} from '../contract';
import { createChatLayouts, type SurfaceKitDeps } from './chat-layouts';
import { type ChatViewDeps, mountChatView } from './chat-view';
import { createSideSections } from './side-sections';

// Each call the view makes to a tab's entry list that draws it, by method name.
const listCalls = vi.hoisted(() => [] as string[]);
vi.mock('./entry-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./entry-list')>();
  return {
    ...actual,
    createEntryList(...args: Parameters<typeof actual.createEntryList>) {
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
// does, and `setActive` names the focused pane's session.
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
  const toasts: [string, string][] = [];
  const activities: (string | undefined)[] = [];
  const box = { text: null as string | null };
  const tab = { element: null as FakeElement | null };
  const tabElements = new Map<string, FakeElement>();
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
  let pageReady: () => void = noEvent;
  const layouts = createChatLayouts(log);
  const kit = {
    markdown: {},
    keys: { anchor: () => ({ dispose: noEvent }), keysFor: () => null },
    commands: { exists: () => true, run: noEvent },
    platform: 'macos',
    log,
  } as unknown as SurfaceKitDeps;
  const activeTimeCalls: [string, ActiveTime][] = [];
  // What `activeTime` read while `addTab` ran, as a row drawn then reads it.
  const readDuringAddTab: (ActiveTime | null)[] = [];
  let removeSession: (sessionId: string) => void = noEvent;
  let activeSessionId: string | null = null;
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
    onPageReady: (listener: () => void) => {
      pageReady = listener;
    },
    paths: posixPaths,
    homeDir: '/w',
    sessions: {
      addTab: (sessionId: string, added: { element: HTMLElement }) => {
        readDuringAddTab.push(view.activeTime(sessionId));
        tab.element = asFake(added.element);
        tabElements.set(sessionId, tab.element);
        return {
          setStatus: noEvent,
          select: noEvent,
          takeOver: () => ({ release: noEvent }),
          remove: noEvent,
          isVisible: () => false,
        };
      },
      activate: noEvent,
      closeSession: noEvent,
      setActivity: (
        _sessionId: string,
        _source: string,
        activity: { word: string } | null,
      ) => activities.push(activity?.word),
    },
    activeSessionId: () => activeSessionId,
    onSessionRemoved: (listener: (sessionId: string) => void) => {
      removeSession = listener;
    },
    onActiveChanged: noEvent,
    onSessionHostChanged: noEvent,
    onScopeChanged: noEvent,
    activeTimeListeners: [
      firstActiveTimeListener,
      (sessionId: string, activeTime: ActiveTime) => {
        activeTimeCalls.push([sessionId, activeTime]);
      },
    ],
    editor: {
      create(): TextEditor {
        box.text = '';
        return {
          text: () => box.text,
          setText: (next: string) => {
            box.text = next;
          },
          destroy: noEvent,
        } as unknown as TextEditor;
      },
    },
    layouts,
    composerParts,
    statusParts: createPartStore(),
    sideParts,
    sideSections: createSideSections({
      layouts,
      kit,
      parts: sideParts,
      uiState: { get: () => undefined, set: noEvent },
      timers: { set: () => 0, clear: noEvent },
      log,
    }),
    ...kit,
    run: noEvent,
    clock: { now: () => 5000 },
    timers: { set: () => 0, clear: noEvent },
    drops: { addTarget: () => ({ dispose: noEvent }) },
    toast: (text: string, tone: string) => toasts.push([text, tone]),
    visibleSessionRested: noEvent,
  } as unknown as ChatViewDeps);
  const ready = () => {
    pageReady();
    pageReady = noEvent;
  };
  return {
    view,
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
    const branchesHeard: (string | undefined)[] = [];
    source?.onChanged(() =>
      branchesHeard.push(
        source.input().facts.find((fact) => fact.label === 'Branch')?.value,
      ),
    );

    mount.setInfo('row-1', { branch: 'feature' });

    expect(branchesHeard).toEqual(['feature']);
    expect(
      mount.logs.some((line) => line.includes('composer update failed')),
    ).toBe(composerRedrawn);
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
