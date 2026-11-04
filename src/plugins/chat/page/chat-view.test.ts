import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextEditor } from '../../../contracts/editor';
import type { ChatEntry } from '../../../contracts/agent';
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
function mounted() {
  const listeners = new Map<string, (data: unknown) => void>();
  const invoked: unknown[][] = [];
  const logs: string[] = [];
  const box = { text: null as string | null };
  const tab = { element: null as FakeElement | null };
  const tabElements = new Map<string, FakeElement>();
  const sideParts = createPartStore<ChatSidePart>();
  let removeSession: (sessionId: string) => void = () => undefined;
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
      addTab: (sessionId: string, added: { element: HTMLElement }) => {
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
    box,
    tab,
    tabElements,
    sideParts,
    invoked,
    logs,
    removeSession: (sessionId: string) => removeSession(sessionId),
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
