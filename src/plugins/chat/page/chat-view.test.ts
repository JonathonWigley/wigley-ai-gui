import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextEditor } from '../../../contracts/editor';
import type { ChatEntry } from '../../../contracts/agent';
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
    commands: [],
    running: false,
    queued: [],
    returned,
    repo: 'app',
    branch: 'main',
    compaction: null,
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
function mounted() {
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
  mountChatView({
    channel,
    paths: { base: () => 'app' },
    sessions: {
      addTab: () => ({
        setStatus: noEvent,
        select: noEvent,
        takeOver: () => ({ release: noEvent }),
        remove: noEvent,
        isVisible: () => false,
      }),
      activate: noEvent,
      closeSession: noEvent,
      setActivity: noEvent,
      selectedSessionId: () => null,
    },
    onSessionRemoved: noEvent,
    onActiveChanged: noEvent,
    onSessionHostChanged: noEvent,
    onScopeChanged: noEvent,
    editor: {
      create(): TextEditor {
        box.text = '';
        return {
          text: () => box.text,
          setText: (next: string) => {
            box.text = next;
          },
        } as unknown as TextEditor;
      },
    },
    layouts: createChatLayouts(log),
    composerParts: createPartStore(),
    statusParts: createPartStore(),
    markdown: {},
    keys: { anchor: () => ({ dispose: noEvent }), keysFor: () => null },
    commands: { exists: () => true, run: noEvent },
    platform: 'macos',
    run: noEvent,
    log,
    clock: { now: () => 5000 },
    timers: { setTimeout: () => 0, clearTimeout: noEvent },
    drops: { addTarget: () => ({ dispose: noEvent }) },
  } as unknown as ChatViewDeps);
  return {
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
