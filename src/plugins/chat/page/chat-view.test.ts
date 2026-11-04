import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveTime } from '../../../contracts/active-time';
import type { TextEditor } from '../../../contracts/editor';
import type { ChatEntry } from '../../../contracts/agent';
import { NO_ACTIVE_TIME } from '../../../shared/active-time';
import { installFakeDom } from '../../../shared/page/test-dom';
import { createPartStore } from '../../../shared/page/contributed-parts';
import type {
  ChatChannel,
  ChatSessionState,
  ReturnedMessage,
} from '../contract';
import { createChatLayouts } from './chat-layouts';
import { type ChatViewDeps, mountChatView } from './chat-view';

const NO_ENTRIES: ChatEntry[] = [];

function stateOf(returned: ReturnedMessage[]): ChatSessionState {
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
// mounts, and `invoked` holds each other call to main.
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
      addTab: (sessionId: string) => {
        readDuringAddTab.push(view.activeTime(sessionId));
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
    markdown: {},
    keys: { anchor: () => ({ dispose: noEvent }) },
    commands: { exists: () => true, run: noEvent },
    platform: 'macos',
    run: noEvent,
    log,
    clock: { now: () => 5000 },
    timers: { setTimeout: () => 0, clearTimeout: noEvent },
    drops: { addTarget: () => ({ dispose: noEvent }) },
  } as unknown as ChatViewDeps);
  return {
    view,
    activeTimeCalls,
    readDuringAddTab,
    removeSession: (sessionId: string) => removeSession(sessionId),
    box,
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
