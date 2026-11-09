import { describe, expect, it, vi } from 'vitest';
import type {
  AgentEvent,
  AgentHarness,
  AgentStart,
} from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { PartStop } from '../../../contracts/plugin';
import type { HostedProcessInfo } from '../../../contracts/session-host';
import type { KeyedSlotKey } from '../../../contracts/state';
import {
  createFakeAgentHarness,
  FAKE_MICROTASK_TIMERS,
} from '../../../shared/fake-agent-harness';
import { fakeDriveHost } from '../../../shared/fake-drive-host';
import { createFakeSessionHost } from '../../../shared/fake-session-host';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  fakeDependency,
  noCounts,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type AgentSession,
  type ProjectNamer,
  type SessionsMainExports,
  sessionsMainKey,
  sessionsSelectionSlot,
  type SessionTitles,
  type TitleSource,
  type ToolCallGuard,
  type ToolDefinition,
  type ToolResult,
  type ToolSession,
} from '../../sessions/contract';
import {
  type ChatMainExports,
  chatEntriesSlot,
  type ChatSessionState,
  chatSessionSlot,
  type PoolProvider,
  type ProjectSetting,
  type SessionCloseReason,
  type SessionOrigin,
} from '../contract';
import { OPEN_SESSIONS_FILE } from './open-sessions';
import { addDriveActions, chatMainPart } from './start';
import { CALLER_WAIT_MS, SUBAGENT_CALL_TEXT } from './tool-callers';

// A chat holding one session, `held`, whose permission calls wait until the
// test replies to them, and `held` resting when `running` is false; `calls`
// holds each call's tool args.
function fakeChat(running = true) {
  const replies: ((result: ToolResult) => void)[] = [];
  const calls: unknown[] = [];
  return {
    replies,
    calls,
    closed: vi.fn<(sessionId: string, reason: SessionCloseReason) => void>(),
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
  harnesses: readonly AgentHarness[] = [],
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
    harnesses,
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

  it('driveStart_ActivateFails_SaysStartFailed', async () => {
    const chat = fakeChat();
    const drive = chatDriveActions(chat, () => {
      throw new Error('no row');
    });

    await expect(drive.run('start')).rejects.toThrow('no row');
    expect(chat.closed).toHaveBeenCalledWith('started', 'start-failed');
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

  it('holdCompactions and releaseCompactions reject with no fake harness', async () => {
    const drive = chatDriveActions(fakeChat());

    await expect(drive.run('holdCompactions')).rejects.toThrow(
      'chat runs on no fake harness',
    );
    await expect(drive.run('releaseCompactions')).rejects.toThrow(
      'chat runs on no fake harness',
    );
  });

  it('holdCompactions and releaseCompactions reach the fake harness', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const hold = vi.spyOn(fake, 'holdCompactions');
    const release = vi.spyOn(fake, 'releaseCompactions');
    const drive = chatDriveActions(fakeChat(), undefined, [fake]);

    await drive.run('holdCompactions');
    expect(hold).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();

    await drive.run('releaseCompactions');
    expect(release).toHaveBeenCalledOnce();
  });
});

// Chat's main part started on a harness whose sign-ins record their cancel
// and whose processes record each message sent, with one profile, `work`, and
// a data folder that cannot be read; sessions open rows `row-1`, `row-2`, …,
// and an owned session's end emits `sessions.ended`, recorded in `ended`,
// and its `keep` is recorded in `kept`;
// each row holds its titles as sessions would, starting with none.
// `options.profiles` replaces the profiles.
// `invoke` calls the page channel's handler for `name`; `sent` holds each
// channel message, `logged` each log line, and `starts` counts the harness's
// process starts, `startInstructions` each start's instructions and
// `startIdleCompactMinTokens` each start's threshold, in start order.
// `processEvents` holds each process's events, by start, and
// `holdProcessEnds` keeps every process's `end` pending until the function it
// returns is called. Paths compare equal ignoring a trailing `/`.
// `contributions` holds each `contributeTools` call's arguments, and
// `toolCallGuards` each guard `addToolCallGuard` got.
// `exports` is the part's main exports. `sessionHost` is a fake host whose `list`
// is `options.list` when given, and `timers` a manual `Timers`. `options.data`
// replaces the data folder. `holdConnects` holds each promise held, `harnessAttaches`
// each attach request, `settingsChange` calls the settings listener with the
// settings the part started on changed by its argument, and
// `processDetach` and `processKill` record their process calls.
// `options.projects` is the `projects` setting; `namers` holds each namer
// `addProjectNamer` got, and `namerChanges.count` each `changed()` call.
function startChatPart(
  options: {
    list?: () => Promise<HostedProcessInfo[]>;
    data?: Files;
    harnessId?: string;
    profiles?: { name: string; configDir: string }[];
    projects?: ProjectSetting[];
  } = {},
) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const cancelLogIn = vi.fn<() => void>();
  const processSends = vi.fn<(message: unknown) => void>();
  const processDetach = vi.fn<() => void>();
  const processKill = vi.fn<() => void>();
  const store = createSlotStore(() => undefined);
  const sent: { message: string; data: unknown }[] = [];
  const emitted: { event: string; data: unknown }[] = [];
  const logged: string[] = [];
  const starts = { count: 0 };
  const startInstructions: (readonly string[])[] = [];
  const startIdleCompactMinTokens: (number | null)[] = [];
  const processEvents: {
    ended: (exit: { code: number; error: string | null }) => void;
    agentEvent: (event: AgentEvent) => void;
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
      startIdleCompactMinTokens.push(request.idleCompactMinTokens);
      processEvents.push(events);
      return {
        send: processSends,
        end: () => processEnd,
        interrupt: () => undefined,
        compact: () => undefined,
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
  // Each timer's delay, by handle, while it is pending.
  const timerDelays = new Map<number, number>();
  let lastTimer = 0;
  const timers: Timers = {
    set: (run, ms) => {
      lastTimer += 1;
      timerRuns.set(lastTimer, run);
      timerDelays.set(lastTimer, ms);
      return lastTimer;
    },
    clear: (handle) => {
      timerRuns.delete(handle);
      timerDelays.delete(handle);
    },
  };
  const heldConnects: Promise<unknown>[] = [];
  let settingsListener: (settings: unknown) => void = () => undefined;
  const listeners = new Map<string, (data: unknown) => void>();
  const ended: string[] = [];
  const kept: string[] = [];
  let rows = 0;
  const titles = new Map<string, SessionTitles>();
  const contributions: {
    tools: ToolDefinition[];
    start: (session: AgentSession) => ToolSession;
  }[] = [];
  const toolCallGuards: ToolCallGuard[] = [];
  const namers: ProjectNamer[] = [];
  const namerChanges = { count: 0 };
  const sessions = {
    addProjectNamer: (namer: ProjectNamer) => {
      namers.push(namer);
      return {
        changed: () => {
          namerChanges.count += 1;
        },
        dispose: () => undefined,
      };
    },
    relocate: () => undefined,
    addToolCallGuard: (guard: ToolCallGuard) => {
      toolCallGuards.push(guard);
      return { dispose: () => undefined };
    },
    contributeTools: (
      tools: ToolDefinition[],
      start: (session: AgentSession) => ToolSession,
    ) => {
      contributions.push({ tools, start });
    },
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
        keep: () => kept.push(id),
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
  const startSettings = {
    profiles: options.profiles ?? [{ name: 'work', configDir: '/work' }],
    keepIdleMinutes: 60,
    projects: options.projects ?? [],
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
      emit: (event: string, data: unknown) => emitted.push({ event, data }),
    },
    state: {
      read: (key: KeyedSlotKey<unknown>) => store.read(key, 'chat'),
      publish: (key: KeyedSlotKey<unknown>) => store.publish(key),
    },
    settings: () => startSettings,
    onSettingsChanged: (listener: (settings: unknown) => void) => {
      settingsListener = listener;
      return { dispose: () => undefined };
    },
    services: {
      log: (line: string) => logged.push(line),
      agentHarnesses: [harness],
      randomUuid: () => 'host-1',
      clock,
      timers,
      sessionHost,
      files: {
        stat: () => Promise.resolve({ isFolder: true, isLink: false }),
      },
      paths: {
        samePath: (a: string, b: string) =>
          a.replace(/\/$/, '') === b.replace(/\/$/, ''),
        isAbsolute: () => true,
        isInside: posixPaths.isInside,
        expandTilde: posixPaths.expandTilde,
      },
      homeDir: '/home/me',
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
  const exports = part.exports?.(createRegistrations()) as ChatMainExports;
  return {
    part,
    exports,
    invoke,
    cancelLogIn,
    processSends,
    sent,
    sessionsInSlots: () => [
      ...store.read(chatSessionSlot, 'test').all().values(),
    ],
    entriesInSlots: (sessionId: string) =>
      store.read(chatEntriesSlot, 'test').get(sessionId),
    closeReasons: () =>
      emitted.flatMap(({ event, data }) =>
        event === 'sessionClosed'
          ? [(data as { reason: SessionCloseReason }).reason]
          : [],
      ),
    openOrigins: () =>
      emitted.flatMap(({ event, data }) =>
        event === 'sessionOpened'
          ? [(data as { origin: SessionOrigin }).origin]
          : [],
      ),
    logged,
    starts,
    startInstructions,
    startIdleCompactMinTokens,
    processEvents,
    holdProcessEnds,
    ended,
    kept,
    listeners,
    processDetach,
    processKill,
    sessionHost,
    timerRuns,
    timerDelays,
    heldConnects,
    harnessAttaches,
    contributions,
    toolCallGuards,
    settingsChange: (settings: object) =>
      settingsListener({ ...startSettings, ...settings }),
    namers,
    namerChanges,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const NEW_GAMES_SETTING: ProjectSetting = {
  name: 'New Games',
  pool: 'ng',
  pinnedBranches: ['main'],
};

// A provider over pool `ng`'s two clones listing `feature/x` then `main`,
// whose claims never settle.
function fakePoolProvider(): PoolProvider {
  return {
    folders: (pool) => (pool === 'ng' ? ['/pool/ng-1', '/pool/ng-2'] : []),
    branches: () => Promise.resolve(['feature/x', 'main']),
    claim: () => new Promise(() => {}),
  };
}

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
  const RESUME_ROW = {
    hostSessionId: 'host-a',
    projectDir: '/p',
    profile: 'work',
    title: 'a session',
    at: 1000,
  };

  it('loaded_SignInRunning_CancelsIt', () => {
    const chat = startChatPart();
    chat.invoke('logIn', 1, 'work');

    chat.invoke('loaded');

    expect(chat.cancelLogIn).toHaveBeenCalledOnce();
  });

  it('slots_PreviewOpen_ListsItAfterChatSessions', () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    chat.invoke('openPreview');

    const listed = chat.sessionsInSlots();

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

    expect(chat.entriesInSlots('row-1').at(-1)).toEqual(
      expect.objectContaining({
        kind: 'notice',
        at: 5000,
        text: 'Signed in.',
      }),
    );
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

  it('exports_ActiveTime_ReadsAHeldSessionsClock', () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });

    expect(chat.exports.activeTime('row-1')).toEqual({
      totalMs: 0,
      since: null,
    });
    expect(chat.exports.activeTime('none')).toBeNull();
  });

  it('exports_Send_WritesToTheProcess', async () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    const message = { text: '/wigley:make /p', images: [] };

    await chat.exports.send('row-1', message);

    expect(chat.processSends).toHaveBeenCalledExactlyOnceWith(message);
  });

  it.each([
    {
      given: 'a session chat holds',
      profiles: ['first', 'second'],
      sessionId: 'row-1',
      expected: 'second',
    },
    {
      given: 'a session chat does not hold',
      profiles: ['first', 'second'],
      sessionId: 'row-9',
      expected: 'first',
    },
    {
      given: 'no session',
      profiles: ['first', 'second'],
      sessionId: null,
      expected: 'first',
    },
    {
      given: 'no profiles',
      profiles: [],
      sessionId: null,
      expected: null,
    },
  ])(
    'exports_DefaultProfile_given $given',
    ({ profiles, sessionId, expected }) => {
      const chat = startChatPart({
        profiles: profiles.map((name) => ({ name, configDir: `/${name}` })),
      });
      if (profiles.length > 0) {
        chat.invoke('start', { projectDir: '/p', profile: 'second' });
      }

      expect(chat.exports.defaultProfile(sessionId)).toBe(expected);
    },
  );

  it.each([
    {
      given: 'a caller chat does not hold',
      callerProfile: null,
      callerId: 'relay-row',
      launchedId: 'row-1',
      startsAfter: 1,
      expected: 'first',
    },
    {
      given: 'a caller chat holds',
      callerProfile: 'second',
      callerId: 'row-1',
      launchedId: 'row-2',
      startsAfter: 2,
      expected: 'second',
    },
  ])(
    'startSessionTool_NoProfileNamed_LaunchesOnTheCallersDefaultWithThePromptFirst_given $given',
    async ({ callerProfile, callerId, launchedId, startsAfter, expected }) => {
      const chat = startChatPart({
        profiles: ['first', 'second'].map((name) => ({
          name,
          configDir: `/${name}`,
        })),
      });
      if (callerProfile !== null) {
        chat.invoke('start', { projectDir: '/p', profile: callerProfile });
      }
      const contribution = chat.contributions.find(({ tools }) =>
        tools.some((tool) => tool.name === 'start_session'),
      );

      const result = await contribution
        ?.start({
          id: callerId,
          info: {
            sessionId: 'host-relay',
            projectDir: '/p',
            harness: 'claude',
          },
        })
        .call(
          'start_session',
          { prompt: 'hi' },
          { toolUseId: null, signal: new AbortController().signal },
        );

      expect(result?.isError ?? false).toBe(false);
      expect(chat.exports.profileOf(launchedId)).toBe(expected);
      expect(chat.starts.count).toBe(startsAfter);
      expect(chat.processSends).toHaveBeenCalledExactlyOnceWith({
        text: 'hi',
        images: [],
      });
    },
  );

  it('exports_AddSendGate_HoldsAnExportedSend', async () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    const message = { text: 'hi', images: [] };
    const gate = chat.exports.addSendGate(() => ({
      action: 'compact',
      reason: 'r',
    }));

    await chat.exports.send('row-1', message);
    expect(chat.processSends).not.toHaveBeenCalled();
    chat.invoke('pullBack', 'row-1', 'queued-1');

    gate.dispose();
    await chat.exports.send('row-1', message);

    expect(chat.processSends).toHaveBeenCalledExactlyOnceWith(message);
  });

  it('exports_AddIdleCompactThreshold_ReachesTheNextStart', () => {
    const chat = startChatPart();
    chat.exports.addIdleCompactThreshold(() => 150_000);

    chat.invoke('start', { projectDir: '/p', profile: 'work' });

    expect(chat.startIdleCompactMinTokens).toEqual([150_000]);
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

  it('toolCallGuard_SubagentCall_SkipsUntilTheRowEnds', async () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    await settle();
    chat.processEvents[0].agentEvent({
      type: 'toolStarted',
      at: 0,
      agentId: 'subagent-1',
      toolUseId: 't1',
      tool: 'mcp__wigley-forms__set_workflow_step',
      summary: '',
    });
    const [guard] = chat.toolCallGuards;
    const call = {
      sessionId: 'row-1',
      tool: 'set_workflow_step',
      toolUseId: 't1',
      mainAgentOnly: true,
    };

    await expect(guard(call)).resolves.toEqual({
      kind: 'skip',
      text: SUBAGENT_CALL_TEXT,
    });

    chat.listeners.get('sessions.ended')?.({ sessionId: 'row-1' });
    const timersBefore = new Set(chat.timerRuns.keys());
    const verdict = guard(call);
    const waits = [...chat.timerDelays].filter(
      ([handle]) => !timersBefore.has(handle),
    );
    expect(waits.map(([, ms]) => ms)).toEqual([CALLER_WAIT_MS]);
    chat.timerRuns.get(waits[0][0])?.();

    await expect(verdict).resolves.toEqual({ kind: 'run' });
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
    const listed = chat.sessionsInSlots();
    expect(listed.map((state) => state.sessionId)).toEqual(['row-2']);
  });

  it('exports_CloseSessionsIn_ClosesWithProjectClosed', async () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    chat.invoke('start', { projectDir: '/q', profile: 'work' });

    await chat.exports.closeSessionsIn('/p');

    expect(chat.closeReasons()).toEqual(['project-closed']);
  });

  it('exports_Close_EndsTheRow_ResolvesOnceItEnded', async () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    chat.invoke('start', { projectDir: '/q', profile: 'work' });
    const releaseEnds = chat.holdProcessEnds();
    let resolved = false;

    const closing = chat.exports.close('row-1', 'finished').then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(resolved).toBe(false);
    expect(chat.ended).toEqual([]);
    releaseEnds();
    await closing;
    expect(resolved).toBe(true);
    expect(chat.ended).toEqual(['row-1']);
    const listed = chat.sessionsInSlots();
    expect(listed.map((state) => state.sessionId)).toEqual(['row-2']);
    expect(chat.closeReasons()).toEqual(['finished']);
  });

  it('exports_Close_NotHeld_RejectsAndFiresNothing', async () => {
    const chat = startChatPart();

    await expect(chat.exports.close('row-9', 'finished')).rejects.toThrow(
      'chat holds no session row-9',
    );
    expect(chat.closeReasons()).toEqual([]);
  });

  it('sessionsClosed_UserClose_SaysUser', () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });

    chat.listeners.get('sessions.closed')?.({ sessionId: 'row-1' });

    expect(chat.closeReasons()).toEqual(['user']);
  });

  it('stop_HeldRows_FiresNoSessionClosed', async () => {
    const chat = startChatPart({ data: await dataWithSavedRow() });
    await chat.heldConnects[0];
    chat.invoke('start', { projectDir: '/p', profile: 'work' });

    await chat.part.dispose?.('end');

    expect(chat.openOrigins()).toEqual(['restored', 'new']);
    expect(chat.closeReasons()).toEqual([]);
  });

  it.each<{ stop: PartStop; kept: string[] }>([
    { stop: 'restart', kept: ['row-1', 'row-2'] },
    { stop: 'end', kept: [] },
  ])(
    'dispose_HeldRows_KeepsThemOnlyForARestart: $stop',
    async ({ stop, kept }) => {
      const chat = startChatPart({ data: await dataWithSavedRow() });
      await chat.heldConnects[0];
      chat.invoke('start', { projectDir: '/p', profile: 'work' });

      await chat.part.dispose?.(stop);

      expect(chat.kept).toEqual(kept);
    },
  );

  it('exports_CloseSessionsIn_EndsNeverCome_ResolvesAtStop', async () => {
    const chat = startChatPart();
    chat.invoke('start', { projectDir: '/p', profile: 'work' });
    chat.holdProcessEnds();
    const closing = chat.exports.closeSessionsIn('/p');

    await chat.part.dispose?.('end');
    await closing;

    expect(chat.ended).toEqual([]);
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

    const disposed = Promise.resolve(chat.part.dispose?.('end')).then(() => {
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

    await chat.part.dispose?.('end');

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
    expect(chat.sessionsInSlots()).toEqual([]);

    await chat.heldConnects[0];

    const listed = chat.sessionsInSlots();
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
      const listed = chat.sessionsInSlots();
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

  it.each([
    {
      contribution: 'instructions',
      contribute: (view: ChatMainExports) => view.addInstructions('note'),
      observe: (chat: ReturnType<typeof startChatPart>) => {
        chat.invoke('start', { projectDir: '/p', profile: 'work' });
        return chat.startInstructions.at(-1);
      },
      expected: [expect.stringContaining('set_session_title')],
    },
    {
      contribution: 'a send gate',
      contribute: (view: ChatMainExports) =>
        view.addSendGate(() => ({ action: 'compact', reason: 'r' })),
      observe: async (chat: ReturnType<typeof startChatPart>) => {
        chat.invoke('start', { projectDir: '/p', profile: 'work' });
        await chat.exports.send('row-1', { text: 'hi', images: [] });
        return chat.processSends.mock.calls;
      },
      expected: [[{ text: 'hi', images: [] }]],
    },
    {
      contribution: 'an idle compact threshold',
      contribute: (view: ChatMainExports) =>
        view.addIdleCompactThreshold(() => 150_000),
      observe: (chat: ReturnType<typeof startChatPart>) => {
        chat.invoke('start', { projectDir: '/p', profile: 'work' });
        return chat.startIdleCompactMinTokens.at(-1);
      },
      expected: null,
    },
    {
      contribution: 'a resume section',
      contribute: (view: ChatMainExports) =>
        view.addResumeSection({
          title: 'a section',
          rows: () => Promise.resolve([RESUME_ROW]),
        }),
      observe: (chat: ReturnType<typeof startChatPart>) =>
        chat.invoke('resumeSections'),
      expected: [],
    },
    {
      contribution: 'a pool provider',
      contribute: (view: ChatMainExports) =>
        view.addPoolProvider(fakePoolProvider()),
      observe: async (chat: ReturnType<typeof startChatPart>) => {
        const listing = chat.invoke('branches', 'New Games', false) as Promise<
          string[]
        >;
        return listing.catch((error: unknown) => (error as Error).message);
      },
      expected: expect.stringContaining('No Unity pool provider'),
    },
  ])(
    'exports_ConsumerDisposed_DropsContribution given $contribution',
    async ({ contribute, observe, expected }) => {
      const chat = startChatPart({ projects: [NEW_GAMES_SETTING] });
      const consumer = createRegistrations();
      contribute(chat.part.exports?.(consumer) as ChatMainExports);

      consumer.dispose();

      expect(await observe(chat)).toEqual(expected);
    },
  );

  it('exports_PoolProviderDisposed_ReasksTheNamer', () => {
    const chat = startChatPart({ projects: [NEW_GAMES_SETTING] });
    const consumer = createRegistrations();
    const view = chat.part.exports?.(consumer) as ChatMainExports;
    view.addPoolProvider(fakePoolProvider());
    const before = chat.namerChanges.count;

    consumer.dispose();

    expect(chat.namerChanges.count).toBe(before + 1);
  });

  it('projectNamer_NamesAFolderUnderAProject', () => {
    const chat = startChatPart({
      projects: [{ name: 'AI Dev', folder: '/home/me/ai-dev' }],
    });

    const [namer] = chat.namers;
    expect(namer('/home/me/ai-dev/wigley-ai-gui')).toBe('AI Dev');
    expect(namer('/elsewhere')).toBeNull();
    expect(chat.namerChanges.count).toBe(1);
  });

  it.each([
    {
      name: 'projects changed',
      change: { projects: [{ name: 'Other', folder: '/home/me/ai-dev' }] },
      changes: 1,
      named: 'Other',
    },
    {
      name: 'another setting changed',
      change: { keepIdleMinutes: 5 },
      changes: 0,
      named: 'AI Dev',
    },
  ])(
    'settingsChange_ReasksTheNamerOnlyWhenProjectsChange: $name',
    ({ change, changes, named }) => {
      const chat = startChatPart({
        projects: [{ name: 'AI Dev', folder: '/home/me/ai-dev' }],
      });
      const before = chat.namerChanges.count;

      chat.settingsChange(change);

      expect(chat.namerChanges.count).toBe(before + changes);
      expect(chat.namers[0]('/home/me/ai-dev')).toBe(named);
    },
  );

  it('branches_ThroughTheRegisteredProvider', async () => {
    const chat = startChatPart({ projects: [NEW_GAMES_SETTING] });
    const before = chat.namerChanges.count;

    chat.exports.addPoolProvider(fakePoolProvider());

    expect(chat.namerChanges.count).toBe(before + 1);
    await expect(chat.invoke('branches', 'New Games', false)).resolves.toEqual([
      'main',
      'feature/x',
    ]);
  });

  it('exports_AddResumeSection_ReachesResumeSections', async () => {
    const chat = startChatPart();
    chat.exports.addResumeSection({
      title: 'a section',
      rows: () => Promise.resolve([RESUME_ROW]),
    });

    expect(await chat.invoke('resumeSections')).toEqual([
      { title: 'a section', rows: [RESUME_ROW] },
    ]);
  });

  it('sessionsHostSessionChanged_OpenRow_MovesWhatIsResumable', async () => {
    const chat = startChatPart();
    const resumableIds: string[] = [];
    chat.exports.addResumeSection({
      title: 'a section',
      rows: (isResumable) => {
        resumableIds.push(...['host-a', 'host-b'].filter(isResumable));
        return Promise.resolve([]);
      },
    });
    chat.listeners.get('sessions.connected')?.({
      id: 'relay-row',
      info: { sessionId: 'host-a' },
    });

    chat.listeners.get('sessions.hostSessionChanged')?.({
      id: 'relay-row',
      info: { sessionId: 'host-b' },
    });
    await chat.invoke('resumeSections');

    expect(resumableIds).toEqual(['host-a']);
  });
});

// Chat's main part on the part harness, over a sessions fake that files each
// contribution and owned row with `consumer.track`, as sessions' view does. A
// row's end is recorded in `ended` and emits `sessions.ended`. A process's detach
// and kill are recorded in `stops`; a kill reports its exit, as a real one does.
function startChatOnHarness() {
  const ended: string[] = [];
  const stops = { detaches: 0, kills: 0 };
  let rows = 0;
  const agentHarness = {
    id: 'claude',
    start: (
      _request: AgentStart,
      events: { ended(exit: { code: number; error: string | null }): void },
    ) => ({
      send: () => undefined,
      end: () => Promise.resolve(),
      interrupt: () => undefined,
      detach() {
        stops.detaches += 1;
      },
      kill() {
        stops.kills += 1;
        events.ended({ code: 0, error: null });
      },
    }),
  } as unknown as AgentHarness;
  const harness = startMainPart(chatMainPart, {
    services: {
      agentHarnesses: [agentHarness],
      sessionHost: createFakeSessionHost({ now: () => 0 }),
      git: {
        topLevel: () => Promise.resolve(null),
        currentBranch: () => Promise.resolve(null),
        worktrees: () => Promise.resolve([]),
      } as never,
    },
    dependencies: [
      fakeDependency(
        sessionsMainKey,
        (consumer) =>
          ({
            contributeTools: () => consumer.track({ dispose() {} }),
            addToolCallGuard: () => consumer.track({ dispose() {} }),
            holdConnects() {},
            addProjectNamer: () =>
              consumer.track({ changed() {}, dispose() {} }),
            open: () => {
              rows += 1;
              const id = `row-${rows}`;
              const owned = {
                session: { id },
                end() {
                  ended.push(id);
                  harness.emit('sessions.ended', { sessionId: id });
                },
                setHostSessionId() {},
              };
              consumer.track({ dispose: () => owned.end() });
              return owned;
            },
            activate() {},
            setTitle() {},
            titles: () => null,
          }) as unknown as SessionsMainExports,
      ),
    ],
  });
  return { harness, ended, stops };
}

// Lets the part's pending file reads and writes finish.
const settleFiles = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('chat main part on the harness', () => {
  it('stop_LeavesNoLiveRegistration', async () => {
    const { harness } = startChatOnHarness();
    expect(harness.counts().registrations).toBeGreaterThan(0);

    await harness.stop();

    expect(harness.counts()).toEqual(noCounts);
  });

  it('stopThenStart_StartsAgain', async () => {
    const { harness } = startChatOnHarness();

    await harness.restart();

    expect(harness.started().exports).toBeTypeOf('function');
  });

  it('selectionWrite_SavesTheSelectedSession', async () => {
    const { harness } = startChatOnHarness();
    await settleFiles();
    harness.invoke('start', { projectDir: '/p', profile: 'work' });
    await settleFiles();

    harness.state.publish(sessionsSelectionSlot).set('row-1');
    await settleFiles();

    const saved = JSON.parse(
      await harness.files.read(`/data/chat/${OPEN_SESSIONS_FILE}`),
    ) as {
      sessions: { hostSessionId: string }[];
      selectedHostSessionId: string | null;
    };
    expect(saved.selectedHostSessionId).toBe(saved.sessions[0].hostSessionId);
    await harness.stop();
  });

  it('stop_DetachesTheProcessEndsItsRowAndSavesOnceFirst', async () => {
    const { harness, ended, stops } = startChatOnHarness();
    await settleFiles();
    // The part's files view copies `write` at its start, so a spy set now hears
    // none of its writes; memory files report every write to a watch.
    const writes: string[] = [];
    const watch = harness.files.watch('/data/chat', (changed) =>
      writes.push(changed),
    );
    const openSessionsWrites = () =>
      writes.filter((changed) => changed === OPEN_SESSIONS_FILE).length;
    harness.invoke('start', { projectDir: '/p', profile: 'work' });
    await settleFiles();
    const writesBeforeStop = openSessionsWrites();
    expect(writesBeforeStop).toBeGreaterThan(0);

    await harness.stop();
    await settleFiles();
    watch.dispose();

    expect(stops).toEqual({ detaches: 1, kills: 0 });
    expect(ended).toEqual(['row-1']);
    expect(openSessionsWrites()).toBe(writesBeforeStop + 1);
  });
});
