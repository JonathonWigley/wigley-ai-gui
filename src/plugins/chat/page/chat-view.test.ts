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
  ChatSessionState,
  ChatSidePart,
  ReturnedMessage,
  SessionCompaction,
} from '../contract';
import { createChatLayouts } from './chat-layouts';
import { type ChatViewDeps, mountChatView } from './chat-view';

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
// `invoked` holds each other call to main. `sideParts` is the view's side part
// store, and `removeSession` closes a session's tab as the sessions plugin does.
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
    layouts: createChatLayouts(log),
    composerParts: createPartStore(),
    statusParts: createPartStore(),
    sideParts,
    markdown: {},
    keys: { anchor: () => ({ dispose: noEvent }), keysFor: () => null },
    commands: { exists: () => true, run: noEvent },
    platform: 'macos',
    run: noEvent,
    log,
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
    sideParts,
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
    const part: ChatSidePart = {
      id: 'side',
      build(parent, sessionId) {
        built.push(sessionId);
        parent.textContent = sessionId;
        return { dispose: () => disposed.push(sessionId) };
      },
    };
    const wrapperTexts = (sessionId: string) =>
      findAll(
        view.tabElements.get(sessionId) as FakeElement,
        'chat-side-part',
      ).map((wrapper) => wrapper.textContent);

    const added = view.sideParts.add(part);
    view.emit('sessionStarted', stateOf([], { sessionId: 'row-2' }));

    expect(built).toEqual(['row-1', 'row-2']);
    expect(wrapperTexts('row-1')).toEqual(['row-1']);
    expect(wrapperTexts('row-2')).toEqual(['row-2']);
    expect(disposed).toEqual([]);

    added.dispose();

    expect(disposed).toEqual(['row-1', 'row-2']);
    expect(wrapperTexts('row-1')).toEqual([]);
    expect(wrapperTexts('row-2')).toEqual([]);

    disposed.length = 0;
    const addedAgain = view.sideParts.add(part);
    view.removeSession('row-1');

    expect(disposed).toEqual(['row-1']);

    addedAgain.dispose();

    expect(disposed).toEqual(['row-1', 'row-2']);
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
