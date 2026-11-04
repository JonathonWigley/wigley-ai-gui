import { describe, expect, it, vi } from 'vitest';
import type { AgentStart } from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { HostedProcessInfo } from '../../../contracts/session-host';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { createFakeSessionHost } from '../../../shared/fake-session-host';
import { createMemoryFiles } from '../../../shared/memory-files';
import type {
  SessionTitles,
  TitleSource,
  ToolResult,
} from '../../sessions/contract';
import type { ChatMainExports, ChatSessionState } from '../contract';
import { OPEN_SESSIONS_FILE } from './open-sessions';
import { addDriveActions, chatMainPart } from './start';

// A chat holding one session, `held`, whose permission calls wait until the
// test replies to them, and `held` resting when `running` is false; `calls`
// holds each call's tool args.
function fakeChat(running = true) {
  const replies: ((result: ToolResult) => void)[] = [];
  const calls: unknown[] = [];
  return {
    replies,
    calls,
    closed: vi.fn<(sessionId: string) => void>(),
    start: () => 'started',
    hostSessionIdOf: () => 'host-started',
    sessions: () => [
      { sessionId: 'held', projectDir: '/p', running } as ChatSessionState,
    ],
    permissionToolSession: () => ({
      call: (_name: string, args: unknown) => {
        calls.push(args);
        return new Promise<ToolResult>((resolve) => {
          replies.push(resolve);
        });
      },
      end: () => undefined,
    }),
  };
}

function chatDriveActions(
  chat: ReturnType<typeof fakeChat>,
  activate: (sessionId: string) => void = () => undefined,
) {
  const drive = fakeDriveHost();
  addDriveActions(drive.host, {
    services: {
      homeDir: '/home',
      randomUuid: () => 'use-1',
      log: () => undefined,
      files: { makeFolder: () => Promise.resolve() },
    },
    profileNames: () => ['default'],
    chat,
    sessions: { activate },
  });
  return drive;
}

const ALLOWED: ToolResult = { content: [{ type: 'text', text: 'allow' }] };

describe('chat drive actions', () => {
  it('start returns the session it started and its host session id', async () => {
    const drive = chatDriveActions(fakeChat());

    expect(await drive.run('start')).toEqual({
      sessionId: 'started',
      hostSessionId: 'host-started',
    });
  });

  it('start closes the session it started when activating its row throws', async () => {
    const chat = fakeChat();
    const drive = chatDriveActions(chat, () => {
      throw new Error('no row');
    });

    await expect(drive.run('start')).rejects.toThrow('no row');
    expect(chat.closed).toHaveBeenCalledWith('started');
  });

  it('permissionAnswer is pending until the user answers, then the reply', async () => {
    const chat = fakeChat();
    const drive = chatDriveActions(chat);
    expect(await drive.run('askPermission', { sessionId: 'held' })).toEqual({
      toolUseId: 'use-1',
    });

    expect(await drive.run('permissionAnswer', { toolUseId: 'use-1' })).toEqual(
      { pending: true },
    );
    chat.replies[0]?.(ALLOWED);
    await Promise.resolve();

    expect(await drive.run('permissionAnswer', { toolUseId: 'use-1' })).toEqual(
      ALLOWED,
    );
  });

  it.each([
    { given: 'an explicit null input', input: null, sent: null },
    { given: 'no input', input: undefined, sent: { command: 'ls' } },
  ])('askPermission given $given sends $sent', async ({ input, sent }) => {
    const chat = fakeChat();
    const drive = chatDriveActions(chat);
    const args = input === undefined ? {} : { input };

    await drive.run('askPermission', { sessionId: 'held', ...args });

    expect(chat.calls[0]).toEqual({
      tool_name: 'Bash',
      input: sent,
      tool_use_id: 'use-1',
    });
  });

  it('askPermission rejects a resting session and raises no card', async () => {
    const chat = fakeChat(false);
    const drive = chatDriveActions(chat);

    await expect(
      drive.run('askPermission', { sessionId: 'held' }),
    ).rejects.toThrow('held');
    expect(chat.calls).toEqual([]);
  });

  it('permissionAnswer rejects a toolUseId askPermission never returned', async () => {
    const drive = chatDriveActions(fakeChat());

    await expect(
      drive.run('permissionAnswer', { toolUseId: 'other' }),
    ).rejects.toThrow('other');
    await expect(drive.run('permissionAnswer')).rejects.toThrow('toolUseId');
  });
});

// Chat's main part started on a harness whose sign-ins record their cancel
// and whose processes record each message sent, with one profile, `work`, and
// a data folder that cannot be read; sessions open rows `row-1`, `row-2`, …,
// and an owned session's end emits `sessions.ended`, recorded in `ended`;
// each row holds its titles as sessions would, starting with none.
// `invoke` calls the page channel's handler for `name`; `sent` holds each
// channel message, `logged` each log line, and `starts` counts the harness's
// process starts and `startInstructions` each start's instructions, in start
// order. `processEvents` holds each process's events, by start, and
// `holdProcessEnds` keeps every process's `end` pending until the function it
// returns is called. Paths compare equal ignoring a trailing `/`.
// `exports` is the part's main exports. `sessionHost` is a fake host whose `list`
// is `options.list` when given, and `timers` a manual `Timers`. `options.data`
// replaces the data folder. `holdConnects` holds each promise held, `harnessAttaches`
// each attach request, `settingsChange` calls the settings listener, and
// `processDetach` and `processKill` record their process calls.
function startChatPart(
  options: {
    list?: () => Promise<HostedProcessInfo[]>;
    data?: Files;
    harnessId?: string;
  } = {},
) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const cancelLogIn = vi.fn<() => void>();
  const processSends = vi.fn<(message: unknown) => void>();
  const processDetach = vi.fn<() => void>();
  const processKill = vi.fn<() => void>();
  const sent: { message: string; data: unknown }[] = [];
  const logged: string[] = [];
  const starts = { count: 0 };
  const startInstructions: (readonly string[])[] = [];
  const processEvents: {
    ended: (exit: { code: number; error: string | null }) => void;
  }[] = [];
  let processEnd = Promise.resolve();
  const holdProcessEnds = () => {
    let release = () => undefined as void;
    processEnd = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  };
  const harnessAttaches: AgentStart[] = [];
  const harness = {
    id: options.harnessId ?? 'claude',
    logIn: () => ({ sendCode: () => undefined, cancel: cancelLogIn }),
    attach: (request: AgentStart) => {
      harnessAttaches.push(request);
      return Promise.resolve(null);
    },
    start: (request: AgentStart, events: (typeof processEvents)[number]) => {
      starts.count += 1;
      startInstructions.push(request.instructions);
      processEvents.push(events);
      return {
        send: processSends,
        end: () => processEnd,
        interrupt: () => undefined,
        detach: processDetach,
        kill: processKill,
      };
    },
  };
  const clock = { now: () => 5000 };
  const sessionHost = createFakeSessionHost(clock);
  if (options.list !== undefined) {
    sessionHost.list = options.list;
  }
  const timerRuns = new Map<number, () => void>();
  let lastTimer = 0;
  const timers: Timers = {
    set: (run) => {
      lastTimer += 1;
      timerRuns.set(lastTimer, run);
      return lastTimer;
    },
    clear: (handle) => timerRuns.delete(handle),
  };
  const heldConnects: Promise<unknown>[] = [];
  let settingsListener: (settings: unknown) => void = () => undefined;
  const listeners = new Map<string, (data: unknown) => void>();
  const ended: string[] = [];
  let rows = 0;
  const titles = new Map<string, SessionTitles>();
  const sessions = {
    contributeTools: () => undefined,
    open: () => {
      rows += 1;
      const id = `row-${rows}`;
      titles.set(id, { user: null, agent: null, firstMessage: null });
      return {
        session: { id },
        end: () => {
          ended.push(id);
          listeners.get('sessions.ended')?.({ sessionId: id });
        },
        setHostSessionId: () => undefined,
      };
    },
    activate: () => undefined,
    holdConnects: (until: Promise<unknown>) => heldConnects.push(until),
    setTitle: (
      sessionId: string,
      source: TitleSource,
      title: string | null,
    ) => {
      const held = titles.get(sessionId);
      if (held !== undefined) {
        held[source] = title;
      }
    },
    titles: (sessionId: string) => {
      const held = titles.get(sessionId);
      return held === undefined ? null : { ...held };
    },
  };
  const api = {
    channel: {
      handle: (name: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(name, handler),
      send: (message: string, data: unknown) => sent.push({ message, data }),
    },
    events: {
      on: (name: string, listener: (data: unknown) => void) => {
        listeners.set(name, listener);
        return { dispose: () => undefined };
      },
      emit: () => undefined,
    },
    settings: () => ({
      profiles: [{ name: 'work', configDir: '/work' }],
      keepIdleMinutes: 60,
    }),
    onSettingsChanged: (listener: (settings: unknown) => void) => {
      settingsListener = listener;
      return { dispose: () => undefined };
    },
    services: {
      log: (_plugin: string, line: string) => logged.push(line),
      agentHarnesses: [harness],
      randomUuid: () => 'host-1',
      clock,
      timers,
      sessionHost,
      paths: {
        samePath: (a: string, b: string) =>
          a.replace(/\/$/, '') === b.replace(/\/$/, ''),
      },
      selfTest: null,
    },
    dependency: () => sessions,
    data: options.data ?? {
      list: () => Promise.reject(new Error('no data folder')),
      read: () => Promise.reject(new Error('no data folder')),
      write: () => Promise.reject(new Error('no data folder')),
    },
    layouts: { register: () => ({ dispose: () => undefined }) },
    drive: null,
  } as unknown as Parameters<typeof chatMainPart.start>[0];
  const part = chatMainPart.start(api);
  const invoke = (name: string, ...args: unknown[]) => {
    const handler = handlers.get(name);
    if (handler === undefined) {
      throw new Error(`chat handles no ${name}`);
    }
    return handler(...args);
  };
  const exports = part.exports as ChatMainExports;
  return {
    part,
    exports,
    invoke,
    cancelLogIn,
    processSends,
    sent,
    logged,
    starts,
    startInstructions,
    processEvents,
    holdProcessEnds,
    ended,
    listeners,
    processDetach,
    processKill,
    sessionHost,
    timerRuns,
    heldConnects,
    harnessAttaches,
    settingsChange: (settings: unknown) => settingsListener(settings),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// A data folder holding one saved session whose process id is `p1`.
async function dataWithSavedRow(): Promise<Files> {
  const data = createMemoryFiles();
  await data.write(
    OPEN_SESSIONS_FILE,
    JSON.stringify({
      sessions: [
        {
          hostSessionId: 'host-a',
          projectDir: '/p',
          profile: 'work',
          sent: false,
          busy: false,
          titles: { user: null, agent: null, firstMessage: null },
          processId: 'p1',
        },
      ],
      selectedHostSessionId: null,
    }),
  );
  return data;
}

describe('chat main part', () => {
  it('loaded_SignInRunning_CancelsIt', () => {
    const chat = startChatPart();
    chat.invoke('logIn', 1, 'work');

    chat.invoke('loaded');

    expect(chat.cancelLogIn).toHaveBeenCalledOnce();
  });

  it('sessions_SignInRunning_LeavesItRunning', () => {
    const chat = startChatPart();
    chat.invoke('logIn', 1, 'work');

    chat.invoke('sessions');

    expect(chat.cancelLogIn).not.toHaveBeenCalled();
  });

  it('sessions_PreviewOpen_ListsItAfterChatSessions', () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    chat.invoke('openPreview');

    const listed = chat.invoke('sessions') as ChatSessionState[];

    expect(listed.map((state) => state.sessionId)).toEqual(['row-1', 'row-2']);
  });

  it.each([
    { method: 'send', args: [{ text: 'hi', images: [] }] },
    { method: 'setControl', args: ['mode', 'plan'] },
    { method: 'interrupt', args: [] },
    {
      method: 'answerPermission',
      args: ['preview-7', { allowed: true, reason: null }],
    },
    { method: 'loadHistory', args: [] },
    { method: 'pullBack', args: ['queued-1'] },
    { method: 'returnedPlaced', args: [['returned-1']] },
    { method: 'sendNow', args: ['queued-1'] },
    { method: 'sendAllNow', args: [{ text: 'hi', images: [] }] },
  ])(
    'calls_PreviewSession_AreIgnoredWithNoError: $method',
    async ({ method, args }) => {
      const chat = startChatPart();
      chat.invoke('openPreview');

      await chat.invoke(method, 'row-1', ...args);

      expect(chat.logged).toContain(`${method} in the chat preview ignored`);
      expect(chat.processSends).not.toHaveBeenCalled();
    },
  );

  it('notice_PreviewSession_AddsAnEntryToItsRow', () => {
    const chat = startChatPart();
    chat.invoke('openPreview');

    chat.invoke('notice', 'row-1', 'Signed in.', 'info');

    expect(chat.sent.filter((held) => held.message === 'entry')).toEqual([
      {
        message: 'entry',
        data: {
          sessionId: 'row-1',
          entry: expect.objectContaining({
            kind: 'notice',
            at: 5000,
            text: 'Signed in.',
          }),
        },
      },
    ]);
  });

  it.each([
    { method: 'send', target: 'row-9' },
    { method: 'send', target: 'row-2' },
    { method: 'clear', target: 'row-9' },
    { method: 'clear', target: 'row-2' },
  ] as const)(
    'exports_$method_SessionChatDoesNotHold_Rejects ($target)',
    async ({ method, target }) => {
      const chat = startChatPart();
      chat.invoke('start', { projectDir: '/p', profile: 'work' });
      chat.invoke('openPreview');
      const startsBefore = chat.starts.count;

      const called =
        method === 'send'
          ? chat.exports.send(target, { text: 'hi', images: [] })
          : chat.exports.clear(target);

      await expect(called).rejects.toThrow(`chat holds no session ${target}`);
      expect(chat.processSends).not.toHaveBeenCalled();
      expect(chat.starts.count).toBe(startsBefore);
    },
  );

  it('exports_Send_WritesToTheProcess', async () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    const message = { text: '/wigley:make /p', images: [] };

    await chat.exports.send('row-1', message);

    expect(chat.processSends).toHaveBeenCalledExactlyOnceWith(message);
  });

  it('exports_AddInstructions_ReachTheNextStart_AfterTheTitleInstruction', () => {
    const chat = startChatPart();
    chat.exports.addInstructions('visual note');

    chat.invoke('start', { projectDir: '/p', profile: 'work' });

    expect(chat.startInstructions).toEqual([
      [expect.stringContaining('set_session_title'), 'visual note'],
    ]);
  });

  it('exports_Clear_ResolvesAfterTheFreshStart', async () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    await chat.exports.send('row-1', { text: 'hi', images: [] });

    await chat.exports.clear('row-1');

    expect(chat.starts.count).toBe(2);
  });

  it("exports_CloseSessionsIn_EndsTheFolder'sSessions_ResolvesOnceTheyEnded", async () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    chat.invoke('start', { projectDir: '/q', profile: 'work' });
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    chat.processEvents[2]?.ended({ code: 0, error: null });
    const releaseEnds = chat.holdProcessEnds();
    let resolved = false;

    const closing = chat.exports.closeSessionsIn('/p/').then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(resolved).toBe(false);
    expect(chat.ended).toEqual(['row-3']);
    releaseEnds();
    await closing;
    expect(chat.ended).toEqual(['row-3', 'row-1']);
    const listed = chat.invoke('sessions') as ChatSessionState[];
    expect(listed.map((state) => state.sessionId)).toEqual(['row-2']);
  });

  it('sessionsTitleChanged_HeldRow_Saves', async () => {
    const chat = startChatPart();
    await settle();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    await settle();
    // The harness's data folder refuses every write, so each save logs this.
    const saveAttempts = () =>
      chat.logged.filter((line) => line.startsWith('open sessions not saved'))
        .length;
    const before = saveAttempts();

    chat.listeners.get('sessions.titleChanged')?.({ sessionId: 'row-1' });
    await settle();

    expect(saveAttempts()).toBe(before + 1);
  });

  it('dispose_SaveInFlight_HoldsForTheWrite', async () => {
    const memory = createMemoryFiles();
    let writesWaitOn = Promise.resolve();
    const chat = startChatPart({
      data: {
        ...memory,
        write: async (name: string, text: string) => {
          await writesWaitOn;
          await memory.write(name, text);
        },
      } as Files,
    });
    await settle();
    let finishWrite = () => undefined as void;
    writesWaitOn = new Promise((resolve) => {
      finishWrite = resolve;
    });
    let isHeld = true;

    const disposed = Promise.resolve(chat.part.dispose?.()).then(() => {
      isHeld = false;
    });
    await settle();
    const heldBeforeTheWrite = isHeld;
    finishWrite();
    await disposed;

    expect(heldBeforeTheWrite).toBe(true);
    expect(isHeld).toBe(false);
  });

  it('dispose_SignInRunning_CancelsIt', async () => {
    const chat = startChatPart();
    chat.invoke('logIn', 1, 'work');
    chat.invoke('start', { projectDir: '/p', profile: 'work' });

    await chat.part.dispose?.();

    expect(chat.cancelLogIn).toHaveBeenCalledOnce();
    expect(chat.processDetach).toHaveBeenCalledOnce();
    expect(chat.processKill).not.toHaveBeenCalled();
  });

  it('stopAll_Channel_StopsEveryProcess', () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });

    chat.invoke('stopAll');

    expect(chat.processKill).toHaveBeenCalledOnce();
  });

  it('keepIdleMinutes_StartAndChange_PassedToTheHost', () => {
    const chat = startChatPart();

    expect(chat.sessionHost.keepIdleMinutes).toEqual([60]);
    chat.settingsChange({ keepIdleMinutes: 5 });

    expect(chat.sessionHost.keepIdleMinutes).toEqual([60, 5]);
  });

  it('restore_HoldsRelayConnectsUntilTheRowsOpen', async () => {
    const chat = startChatPart({ data: await dataWithSavedRow() });

    expect(chat.heldConnects).toHaveLength(1);
    expect(chat.invoke('sessions')).toEqual([]);

    await chat.heldConnects[0];

    const listed = chat.invoke('sessions') as ChatSessionState[];
    expect(listed.map((state) => state.sessionId)).toEqual(['row-1']);
  });

  it.each([
    {
      given: 'a list that rejects',
      list: () => Promise.reject(new Error('no host')),
      runsTheTimer: false,
      logged: 'session host not listed: no host',
    },
    {
      given: 'a list that never settles',
      list: () => new Promise<HostedProcessInfo[]>(() => {}),
      runsTheTimer: true,
      logged: 'session host not listed: timed out after 3000 ms',
    },
  ])(
    'restore_SessionHostListFails_LogsAndRestsEveryRow given $given',
    async ({ list, runsTheTimer, logged }) => {
      const chat = startChatPart({ list, data: await dataWithSavedRow() });
      await settle();

      if (runsTheTimer) {
        [...chat.timerRuns.values()].forEach((run) => run());
      }
      await settle();

      expect(chat.logged).toContain(logged);
      const listed = chat.invoke('sessions') as ChatSessionState[];
      expect(listed.map((state) => state.running)).toEqual([false]);
      expect(chat.harnessAttaches).toEqual([]);
    },
  );

  it('restore_Throws_LogsAndSettlesTheHold', async () => {
    const chat = startChatPart({
      harnessId: 'not-chats',
      list: () =>
        Promise.resolve([
          { id: 'p1', startedAt: 1, running: true, current: true },
        ]),
      data: await dataWithSavedRow(),
    });

    await expect(chat.heldConnects[0]).resolves.toBeUndefined();

    expect(chat.logged).toContainEqual(
      expect.stringContaining('open sessions not restored'),
    );
  });

  it('restore_SessionHostListFails_LogsAndRestsEveryRow given a list that resolves first', async () => {
    const chat = startChatPart({ list: () => Promise.resolve([]) });

    await settle();

    expect(chat.timerRuns.size).toBe(0);
  });
});
