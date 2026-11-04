import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveTime } from '../../../contracts/active-time';
import type { TextEditor } from '../../../contracts/editor';
import type { ChatEntry } from '../../../contracts/agent';
import { NO_ACTIVE_TIME } from '../../../shared/active-time';
import {
  asFake,
  type FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { createPartStore } from '../../../shared/page/contributed-parts';
import type {
  ChatChannel,
  ChatComposerPart,
  ChatSessionState,
  ChatSidePart,
  ReturnedMessage,
  SessionCompaction,
} from '../contract';
import { createChatLayouts, type SurfaceKitDeps } from './chat-layouts';
import { type ChatViewDeps, mountChatView } from './chat-view';
import { createSideSections } from './side-sections';

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

// A mounted view whose `sessions` call waits for `answerSessions`; `emit` sends
// it a message from main, `box` is the one tab's box text, null before a tab
// mounts, `tab` its element, `tabElements` each session's tab element, and
// `invoked` holds each other call to main. `sideParts` and `composerParts` are
// the view's part stores, `layouts` its chat layouts, and `removeSession` closes
// a session's tab as the sessions plugin does.
function mounted(
  firstActiveTimeListener: (
    sessionId: string,
    activeTime: ActiveTime,
  ) => void = () => undefined,
) {
  const listeners = new Map<string, (data: unknown) => void>();
  const invoked: unknown[][] = [];
  const logs: string[] = [];
  const box = { text: null as string | null };
  const tab = { element: null as FakeElement | null };
  const tabElements = new Map<string, FakeElement>();
  const sideParts = createPartStore<ChatSidePart>();
  const composerParts = createPartStore<ChatComposerPart>();
  let answerSessions: (states: ChatSessionState[]) => void = () => undefined;
  const channel = {
    on(message: string, listener: (data: unknown) => void) {
      listeners.set(message, listener);
      return { remove: () => undefined };
    },
    invoke(method: string, ...args: unknown[]) {
      if (method === 'sessions') {
        return new Promise((resolve) => {
          answerSessions = resolve;
        });
      }
      invoked.push([method, ...args]);
      return Promise.resolve();
    },
  };
  const log = (_source: string, line: string) => logs.push(line);
  const noEvent = () => undefined;
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
  const view = mountChatView({
    channel,
    paths: { base: () => 'app' },
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
      setActivity: noEvent,
      selectedSessionId: () => null,
    },
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
      log,
    }),
    ...kit,
    run: noEvent,
    clock: { now: () => 5000 },
    timers: { set: () => 0, clear: noEvent },
    drops: { addTarget: () => ({ dispose: noEvent }) },
  } as unknown as ChatViewDeps);
  return {
    view,
    activeTimeCalls,
    readDuringAddTab,
    removeSession: (sessionId: string) => removeSession(sessionId),
    box,
    tab,
    tabElements,
    layouts,
    sideParts,
    composerParts,
    invoked,
    logs,
    emit: <K extends keyof ChatChannel['messages']>(
      message: K,
      data: ChatChannel['messages'][K],
    ) => listeners.get(message)?.(data),
    answerSessions: async (states: ChatSessionState[]) => {
      answerSessions(states);
      await Promise.resolve();
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

  it('returned_HeldByMainAtMount_PlacedOnceAndReported', async () => {
    const view = mounted();

    await view.answerSessions([stateOf([returnedOne, returnedTwo])]);

    expect(view.box.text).toBe('one\ntwo');
    expect(view.invoked).toEqual(PLACED_BOTH);
  });

  it('returned_ArrivingBeforeTheTab_LeftWithMainUntilTheMount', async () => {
    const view = mounted();

    view.emit('returned', {
      sessionId: 'row-1',
      messages: [returnedOne, returnedTwo],
    });

    expect(view.invoked).toEqual([]);
    expect(view.logs).toContain('returned for unknown session row-1 ignored');

    await view.answerSessions([stateOf([returnedOne, returnedTwo])]);

    expect(view.box.text).toBe('one\ntwo');
    expect(view.invoked).toEqual(PLACED_BOTH);
  });

  it('returned_ArrivingForAMountedTab_PlacedOnceAndReported', async () => {
    const view = mounted();
    await view.answerSessions([stateOf([])]);
    expect(view.invoked).toEqual([]);

    view.emit('returned', {
      sessionId: 'row-1',
      messages: [returnedOne, returnedTwo],
    });

    expect(view.box.text).toBe('one\ntwo');
    expect(view.invoked).toEqual(PLACED_BOTH);
  });
});

describe('mountChatView side parts', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('side parts build per tab, leave with their part, and dispose with their tab', async () => {
    const view = mounted();
    await view.answerSessions([stateOf([], { sessionId: 'row-1' })]);
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
    const wrappers = (sessionId: string) => tabChildren(sessionId)[1].children;
    const wrapperTexts = (sessionId: string) =>
      wrappers(sessionId).map(
        (wrapper) => findAll(wrapper, 'chat-side-section-body')[0].textContent,
      );

    const first = view.sideParts.add(partOf('first'));
    view.emit('sessionStarted', stateOf([], { sessionId: 'row-2' }));

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

  it('a side part whose build throws stays unbuilt in its tab until it is added again', async () => {
    const view = mounted();
    await view.answerSessions([stateOf([], { sessionId: 'row-1' })]);
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
    expect(holder().children.map((wrapper) => wrapper.dataset.part)).toEqual([
      'other',
    ]);

    added.dispose();
    view.sideParts.add(failing);

    expect(attempts).toBe(2);
    other.dispose();
    expect(attempts).toBe(2);
  });

  it('a chat layout change disposes a side part once and builds it again', async () => {
    const view = mounted();
    await view.answerSessions([stateOf([])]);
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

    mount.emit('sessionStarted', { ...stateOf([]), activeTime: STARTED });
    mount.emit('sessionStarted', { ...stateOf([]), activeTime: STARTED });

    expect(mount.readDuringAddTab).toEqual([STARTED]);
    expect(readAtCall).toEqual([STARTED]);
    expect(mount.activeTimeCalls).toEqual([['row-1', STARTED]]);
  });

  it('activeTime_Message_KeepsTheRecordAndCallsOnce', () => {
    const mount = mounted();
    mount.emit('sessionStarted', stateOf([]));
    mount.activeTimeCalls.length = 0;

    mount.emit('activeTime', { sessionId: 'row-1', activeTime: RUNNING });

    expect(mount.view.activeTime('row-1')).toEqual(RUNNING);
    expect(mount.view.activeTime('row-2')).toBeNull();
    expect(mount.activeTimeCalls).toEqual([['row-1', RUNNING]]);
  });

  it('activeTime_AListenerThrowsOnAMessage_TheNextStillRuns', () => {
    let isFailing = false;
    const mount = mounted(() => {
      if (isFailing) {
        throw new Error('listener failed');
      }
    });
    mount.emit('sessionStarted', stateOf([]));
    mount.activeTimeCalls.length = 0;
    isFailing = true;

    expect(() =>
      mount.emit('activeTime', { sessionId: 'row-1', activeTime: RUNNING }),
    ).toThrow('listener failed');

    expect(mount.activeTimeCalls).toEqual([['row-1', RUNNING]]);
    expect(mount.view.activeTime('row-1')).toEqual(RUNNING);
  });

  it('activeTime_AListenerThrowsOnArrival_EverySessionStillArrives', async () => {
    const mount = mounted(() => {
      throw new Error('listener failed');
    });

    await mount.answerSessions([
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

  it('activeTime_MessageForAnUnheldSession_IgnoredWithNoCall', () => {
    const mount = mounted();

    mount.emit('activeTime', { sessionId: 'row-1', activeTime: RUNNING });

    expect(mount.view.activeTime('row-1')).toBeNull();
    expect(mount.activeTimeCalls).toEqual([]);
  });

  it('activeTime_SessionRemoved_DropsTheRecord', () => {
    const mount = mounted();
    mount.emit('sessionStarted', stateOf([]));

    mount.removeSession('row-1');

    expect(mount.view.activeTime('row-1')).toBeNull();
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
    message?: SessionCompaction | null;
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
      case: 'Message_ShowsTheDock',
      mountedWith: null,
      message: COMPACTION,
      dockState: 'Compacting…',
      dockTrigger: '/compact',
      isIndicatorIdle: false,
    },
    {
      case: 'NullMessage_ClearsToIdle',
      mountedWith: COMPACTION,
      message: null,
      dockState: null,
      dockTrigger: null,
      isIndicatorIdle: true,
    },
  ])(
    'compaction_$case',
    async ({
      mountedWith,
      message,
      dockState,
      dockTrigger,
      isIndicatorIdle,
    }) => {
      const view = mounted();
      await view.answerSessions([
        stateOf([], { running: true, compaction: mountedWith }),
      ]);

      if (message !== undefined) {
        view.emit('compaction', { sessionId: 'row-1', compaction: message });
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
