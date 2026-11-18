import { describe, expect, it, vi } from 'vitest';
import {
  type AgentEvent,
  type AgentHarness,
  type AgentStart,
  MAIN_AGENT_ID,
  type PermissionRequest,
  type ProcessActivity,
  type UserMessage,
} from '../../../contracts/agent';
import type { Timers } from '../../../contracts/ambient';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type { Files } from '../../../contracts/files';
import type { PartStop } from '../../../contracts/plugin';
import type { HostedProcessInfo } from '../../../contracts/session-host';
import type { KeyedSlotKey } from '../../../contracts/state';
import {
  harnessInfo,
  harnessRegistryOf,
} from '../../../shared/agent-harness-registry.test-support';
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
  type ContributeToolsOptions,
  errorResult,
  type ProjectNamer,
  type SessionsMainExports,
  sessionsMainKey,
  sessionsSelectionSlot,
  type SessionTitles,
  textResult,
  type TitleSource,
  type ToolCallGuard,
  type ToolDefinition,
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
import { chatHarnessesOfRegistry } from './lookups.test-support';
import { OPEN_SESSIONS_FILE } from './open-sessions';
import { addDriveActions, chatMainPart, createHarnessFollower } from './start';
import { CALLER_WAIT_MS, SUBAGENT_CALL_TEXT } from './tool-callers';

// A chat holding one session, `held`, resting when `running` is false.
function fakeChat(running = true) {
  return {
    closed: vi.fn<(sessionId: string, reason: SessionCloseReason) => void>(),
    start: vi.fn<
      (request: {
        projectDir: string;
        harness: string;
        profile: string;
      }) => string
    >(() => 'started'),
    hostSessionIdSettled: () => Promise.resolve('host-started'),
    sessions: () => [
      { sessionId: 'held', projectDir: '/p', running } as ChatSessionState,
    ],
  };
}

// A harness `other` declaring the drive's default profile, `default`.
const DEFAULT_PROFILE_HARNESS = {
  id: 'other',
  info: () =>
    harnessInfo({ profiles: [{ name: 'default', configDir: '/default' }] }),
} as unknown as AgentHarness;

function chatDriveActions(
  chat: ReturnType<typeof fakeChat>,
  activate: (sessionId: string) => void = () => undefined,
  harnesses: readonly AgentHarness[] = [DEFAULT_PROFILE_HARNESS],
) {
  const drive = fakeDriveHost();
  addDriveActions(drive.host, {
    services: {
      homeDir: '/home',
      randomUuid: () => 'use-1',
      log: () => undefined,
      files: { makeFolder: () => Promise.resolve() },
    },
    defaultProfile: () => 'default',
    chat,
    sessions: { activate },
    harnesses: chatHarnessesOfRegistry(harnessRegistryOf(harnesses)),
  });
  return drive;
}

// A fake harness with one live process for the row `held`; `requests` holds
// each permission request the process raises, which `process` answers.
function heldFake() {
  const fake = createFakeAgentHarness(
    { now: () => 1000 },
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
  const requests: PermissionRequest[] = [];
  const ignore = () => undefined;
  const process = fake.start(
    {
      processId: 'p-1',
      sessionId: 's-1',
      resume: false,
      projectDir: '/p',
      profileDir: null,
      controls: {},
      instructions: [],
      idleCompactMinTokens: null,
      rowId: 'held',
    },
    {
      sessionId: ignore,
      entry: ignore,
      controls: ignore,
      activity: ignore,
      pid: ignore,
      commands: ignore,
      planUsage: ignore,
      agentEvent: ignore,
      messageDropped: ignore,
      permission: (request) => requests.push(request),
      ended: ignore,
    },
  );
  return { fake, process, requests };
}

async function flushMicrotasks() {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

describe('chat drive actions', () => {
  it('start returns the session it started and its host session id', async () => {
    const drive = chatDriveActions(fakeChat());

    expect(await drive.run('start')).toEqual({
      sessionId: 'started',
      hostSessionId: 'host-started',
    });
  });

  it('driveStart_NoProfileArg_StartsOnTheDefaultProfileAndItsHarness', async () => {
    const chat = fakeChat();
    const drive = chatDriveActions(chat);

    await drive.run('start');

    expect(chat.start).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ harness: 'other', profile: 'default' }),
    );
  });

  it('driveStart_ActivateFails_SaysStartFailed', async () => {
    const chat = fakeChat();
    const drive = chatDriveActions(chat, () => {
      throw new Error('no row');
    });

    await expect(drive.run('start')).rejects.toThrow('no row');
    expect(chat.closed).toHaveBeenCalledWith('started', 'start-failed');
  });

  it('permissionAnswer is pending until the user answers, then the decision', async () => {
    const { fake, process, requests } = heldFake();
    const drive = chatDriveActions(fakeChat(), undefined, [fake]);
    expect(await drive.run('askPermission', { sessionId: 'held' })).toEqual({
      toolUseId: 'use-1',
    });
    await flushMicrotasks();

    expect(await drive.run('permissionAnswer', { toolUseId: 'use-1' })).toEqual(
      { pending: true },
    );
    process.answerPermission(requests[0].entry.id, {
      allowed: true,
      reason: null,
    });
    await flushMicrotasks();

    expect(await drive.run('permissionAnswer', { toolUseId: 'use-1' })).toEqual(
      { allowed: true, reason: null },
    );
  });

  it.each([
    { given: 'an explicit null input', input: null, sent: null },
    { given: 'no input', input: undefined, sent: { command: 'ls' } },
  ])('askPermission given $given raises $sent', async ({ input, sent }) => {
    const { fake, requests } = heldFake();
    const drive = chatDriveActions(fakeChat(), undefined, [fake]);
    const args = input === undefined ? {} : { input };

    await drive.run('askPermission', { sessionId: 'held', ...args });
    await flushMicrotasks();

    expect(
      requests.map(({ entry }) => ({
        toolName: entry.toolName,
        input: entry.input,
      })),
    ).toEqual([{ toolName: 'Bash', input: sent }]);
  });

  it('askPermission rejects a resting session and raises no card', async () => {
    const { fake, requests } = heldFake();
    const drive = chatDriveActions(fakeChat(false), undefined, [fake]);

    await expect(
      drive.run('askPermission', { sessionId: 'held' }),
    ).rejects.toThrow('held');
    await flushMicrotasks();
    expect(requests).toEqual([]);
  });

  it('askPermission_NoFakeHarness_Rejects', async () => {
    const drive = chatDriveActions(fakeChat());

    await expect(
      drive.run('askPermission', { sessionId: 'held' }),
    ).rejects.toThrow('chat runs on no fake harness');
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
// each row holds its titles as sessions would, starting with none, in
// `titles`, and its side-bar label as `labels` holds it, else none.
// `options.profiles` replaces the profiles the harness `claude` declares (and
// of its `core.agentHarnesses` entry); null registers no harness.
// `options.publishedProfiles` replaces the entry's profiles alone, as the
// registry does for a profile another harness already names.
// `options.infoFails` makes the harness's `info()` throw.
// `invoke` calls the page channel's handler for `name`; `sent` holds each
// channel message, `logged` each log line, and `starts` counts the harness's
// process starts, each reporting its request's session id, or `host-<n>` for a
// new conversation, in a microtask; `startInstructions` each start's instructions and
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
// `preparedRuns` holds each `prepareRun` call's arguments and the spec it
// returned; the harness declares no start controls.
// `options.unlistedProfiles` publishes a second, unlisted harness `demo` with
// those profiles.
function startChatPart(
  options: {
    list?: () => Promise<HostedProcessInfo[]>;
    data?: Files;
    infoFails?: boolean;
    profiles?: { name: string; configDir: string }[] | null;
    publishedProfiles?: { name: string; configDir: string }[];
    unlistedProfiles?: { name: string; configDir: string }[];
    projects?: ProjectSetting[];
  } = {},
) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const cancelLogIn = vi.fn<() => void>();
  const processSends = vi.fn<(message: unknown) => void>();
  const processDetach = vi.fn<() => void>();
  const processKill = vi.fn<() => void>();
  const store = createSlotStore(() => undefined);
  const profiles =
    options.profiles === undefined
      ? [{ name: 'work', configDir: '/work' }]
      : options.profiles;
  if (profiles !== null || options.unlistedProfiles !== undefined) {
    const published = store.publish(coreAgentHarnessesSlot);
    if (profiles !== null) {
      published.set(
        'claude',
        harnessInfo({ profiles: options.publishedProfiles ?? profiles }),
      );
    }
    if (options.unlistedProfiles !== undefined) {
      published.set(
        'demo',
        harnessInfo({ profiles: options.unlistedProfiles, unlisted: true }),
      );
    }
  }
  const sent: { message: string; data: unknown }[] = [];
  const emitted: { event: string; data: unknown }[] = [];
  const logged: string[] = [];
  const starts = { count: 0 };
  const startInstructions: (readonly string[])[] = [];
  const startIdleCompactMinTokens: (number | null)[] = [];
  const processEvents: {
    sessionId: (id: string) => void;
    ended: (exit: { code: number; error: string | null }) => void;
    agentEvent: (event: AgentEvent) => void;
    activity: (activity: ProcessActivity) => void;
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
  const preparedRuns: {
    request: AgentStart;
    firstMessage: UserMessage;
    env: Readonly<Record<string, string>>;
    spawn: { id: string };
  }[] = [];
  const harness = {
    id: 'claude',
    info: () => {
      if (options.infoFails === true) {
        throw new Error('info unreadable');
      }
      return harnessInfo({ profiles: profiles ?? [] });
    },
    prepareRun: async (
      request: AgentStart,
      firstMessage: UserMessage,
      env: Readonly<Record<string, string>>,
    ) => {
      const spawn = { id: request.processId };
      preparedRuns.push({ request, firstMessage, env, spawn });
      return spawn;
    },
    startControls: () => [],
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
      const hostId = request.sessionId ?? `host-${starts.count}`;
      queueMicrotask(() => events.sessionId(hostId));
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
  const labels = new Map<string, string>();
  const contributions: {
    tools: ToolDefinition[];
    start: (session: AgentSession) => ToolSession;
    options: ContributeToolsOptions | undefined;
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
    addToolCallGuard: (guard: ToolCallGuard) => {
      toolCallGuards.push(guard);
      return { dispose: () => undefined };
    },
    contributeTools: (
      tools: ToolDefinition[],
      start: (session: AgentSession) => ToolSession,
      options?: ContributeToolsOptions,
    ) => {
      contributions.push({ tools, start, options });
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
    label: (sessionId: string) => labels.get(sessionId) ?? null,
  };
  const startSettings = {
    keepIdleMinutes: 60,
    projects: options.projects ?? [],
    defaultHarness: 'claude',
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
      agentHarnesses: harnessRegistryOf(
        profiles === null ? [] : [harness as unknown as AgentHarness],
      ),
      randomUuid: () => 'host-1',
      clock,
      timers,
      sessionHost,
      window: { isFocused: () => true },
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
    clearedTo: () =>
      emitted.flatMap(({ event, data }) =>
        event === 'sessionCleared'
          ? [(data as { newHostSessionId: string }).newHostSessionId]
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
    preparedRuns,
    contributions,
    toolCallGuards,
    settingsChange: (settings: object) =>
      settingsListener({ ...startSettings, ...settings }),
    namers,
    namerChanges,
    titles,
    labels,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const NEW_GAMES_SETTING: ProjectSetting = { name: 'New Games', pool: 'ng' };

// A provider over pool `ng`'s clones, `/pool/ng-1` and `/pool/ng-2` unless
// `clones` says otherwise.
function fakePoolProvider(
  clones: () => readonly string[] = () => ['/pool/ng-1', '/pool/ng-2'],
): PoolProvider {
  return { folders: (pool) => (pool === 'ng' ? clones() : []) };
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
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
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
      chat.invoke('start', {
        projectDir: '/p',
        harness: 'claude',
        profile: 'work',
      });
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
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });

    expect(chat.exports.activeTime('row-1')).toEqual({
      totalMs: 0,
      since: null,
    });
    expect(chat.exports.activeTime('none')).toBeNull();
  });

  it.each([
    { name: 'a subagent', agentId: 'subagent-1' },
    { name: 'the main agent', agentId: MAIN_AGENT_ID },
  ])('toolCaller_NamesStreamAgent ($name)', async ({ agentId }) => {
    const chat = startChatPart();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    await settle();
    chat.processEvents[0].agentEvent({
      type: 'toolStarted',
      at: 0,
      agentId,
      toolUseId: 't1',
      tool: 'mcp__wigley-forms__chatroom_post',
      summary: '',
    });

    await expect(chat.exports.toolCaller('row-1', 't1')).resolves.toBe(agentId);
  });

  it('toolCaller_NamesStreamAgent (a row chat does not hold)', async () => {
    const chat = startChatPart();
    const timersBefore = new Set(chat.timerDelays.keys());

    await expect(
      chat.exports.toolCaller('terminal-1', 't1'),
    ).resolves.toBeNull();
    expect(
      [...chat.timerDelays.keys()].filter(
        (handle) => !timersBefore.has(handle),
      ),
    ).toEqual([]);
  });

  // Breaks if chat main reads a harness's own `info()` profiles again rather
  // than the ones the registry publishes, which leave out a clashing name.
  it('start_ProfileTheRegistryLeftOut_ThrowsNamingIt', () => {
    const chat = startChatPart({ publishedProfiles: [] });

    expect(() =>
      chat.invoke('start', {
        projectDir: '/p',
        harness: 'claude',
        profile: 'work',
      }),
    ).toThrow('chat has no profile "work"');
    expect(chat.starts.count).toBe(0);
  });

  it('exports_HaveNoProfiles', () => {
    const chat = startChatPart();

    expect('profiles' in chat.exports).toBe(false);
  });

  it('exports_Send_WritesToTheProcess', async () => {
    const chat = startChatPart();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    const message = { text: '/wigley:make /p', images: [] };

    await chat.exports.send('row-1', message);

    expect(chat.processSends).toHaveBeenCalledExactlyOnceWith(message);
  });

  // Rows `row-1` (the caller) and `row-2` (the target) are open; `relay-row`
  // stands for a terminal row, which chat does not hold.
  it.each<{
    given: string;
    callerSessionId?: string;
    callerTitle?: string;
    callerLabel?: string;
    target: string;
    text: string;
    isTargetRunning?: true;
    sent?: string;
    error?: string;
  }>([
    {
      given: 'a titled caller',
      callerSessionId: 'row-1',
      callerTitle: 'Planner',
      callerLabel: 'alpha 2',
      target: 'row-2',
      text: 'go',
      sent: '[Message from the agent in session "Planner" — not typed by the user]\ngo',
    },
    {
      given: 'an untitled caller',
      callerSessionId: 'row-1',
      callerLabel: 'alpha 2',
      target: 'row-2',
      text: 'go',
      sent: '[Message from the agent in session "alpha 2" — not typed by the user]\ngo',
    },
    { given: 'no caller', target: 'row-2', text: ' go ', sent: ' go ' },
    {
      given: 'no caller and a slash text',
      target: 'row-2',
      text: '/clear',
      sent: '/clear',
    },
    {
      given: 'a running target',
      callerSessionId: 'row-1',
      callerTitle: 'Planner',
      target: 'row-2',
      text: 'go',
      isTargetRunning: true,
      sent: '[Message from the agent in session "Planner" — not typed by the user]\ngo',
    },
    {
      given: 'a self-send',
      callerSessionId: 'row-2',
      target: 'row-2',
      text: 'go',
      error: 'chat.sendTo: a session cannot send to itself',
    },
    {
      given: 'blank text',
      callerSessionId: 'row-1',
      target: 'row-2',
      text: ' \n ',
      error: 'chat.sendTo: no text',
    },
    {
      given: 'blank text to an unknown target',
      callerSessionId: 'row-1',
      target: 'row-9',
      text: '',
      error: 'chat.sendTo: no text',
    },
    {
      given: "a terminal row's id",
      callerSessionId: 'row-1',
      target: 'relay-row',
      text: 'go',
      error: 'chat.sendTo: no chat session relay-row',
    },
  ])(
    'sendTo sends the framed text to the target or refuses: $given',
    async (row) => {
      const chat = startChatPart();
      for (let opened = 0; opened < 2; opened++) {
        chat.invoke('start', {
          projectDir: '/p',
          harness: 'claude',
          profile: 'work',
        });
      }
      await flushMicrotasks();
      const callerTitles = chat.titles.get('row-1');
      if (callerTitles !== undefined && row.callerTitle !== undefined) {
        callerTitles.agent = row.callerTitle;
      }
      if (row.callerLabel !== undefined) {
        chat.labels.set('row-1', row.callerLabel);
      }
      if (row.isTargetRunning === true) {
        chat.processEvents[1].activity('working');
      }

      const run = Promise.resolve(
        chat.part.commands.sendTo({
          arg: { sessionId: row.target, text: row.text },
          callerSessionId: row.callerSessionId,
        }),
      );

      if (row.error !== undefined) {
        await expect(run).rejects.toThrow(row.error);
        expect(chat.processSends).not.toHaveBeenCalled();
        return;
      }
      await run;
      if (row.isTargetRunning === true) {
        expect(chat.processSends).not.toHaveBeenCalled();
        chat.processEvents[1].activity('idle');
      }
      expect(chat.processSends).toHaveBeenCalledExactlyOnceWith({
        text: row.sent,
        images: [],
      });
      expect(chat.starts.count).toBe(2);
    },
  );

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
    {
      given: 'no harness registered',
      profiles: null,
      sessionId: null,
      expected: null,
    },
  ])(
    'exports_DefaultProfile_given $given',
    ({ profiles, sessionId, expected }) => {
      const chat = startChatPart({
        profiles:
          profiles?.map((name) => ({ name, configDir: `/${name}` })) ?? null,
      });
      if (profiles !== null && profiles.length > 0) {
        chat.invoke('start', {
          projectDir: '/p',
          harness: 'claude',
          profile: 'second',
        });
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
        chat.invoke('start', {
          projectDir: '/p',
          harness: 'claude',
          profile: callerProfile,
        });
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
            rowId: null,
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

  it('startSessionTool_UnlistedHarnessProfile_AnswersUnknownProfile', async () => {
    const chat = startChatPart({
      unlistedProfiles: [{ name: 'demo', configDir: '/demo' }],
    });
    const contribution = chat.contributions.find(({ tools }) =>
      tools.some((tool) => tool.name === 'start_session'),
    );

    const result = await contribution
      ?.start({
        id: 'relay-row',
        info: {
          sessionId: 'host-relay',
          projectDir: '/p',
          harness: 'claude',
          rowId: null,
        },
      })
      .call(
        'start_session',
        { prompt: 'hi', profile: 'demo' },
        { toolUseId: null, signal: new AbortController().signal },
      );

    expect(result).toEqual(
      errorResult('Unknown profile "demo". Profiles: work.'),
    );
    expect(chat.starts.count).toBe(0);
  });

  it('contributions_LeaveOutPermissionPrompt', () => {
    const chat = startChatPart();

    expect(
      chat.contributions.flatMap(({ tools }) => tools.map((tool) => tool.name)),
    ).not.toContain('permission_prompt');
  });

  it('setHeadlessTool_CallOnAStartedRow_FlipsItsFlag_AsAMainAgentOnlyContribution', async () => {
    const chat = startChatPart();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    const contribution = chat.contributions.find(({ tools }) =>
      tools.some((tool) => tool.name === 'set_headless'),
    );

    const result = await contribution
      ?.start({
        id: 'row-1',
        info: {
          sessionId: 'host-1',
          projectDir: '/p',
          harness: 'claude',
          rowId: null,
        },
      })
      .call(
        'set_headless',
        { headless: true },
        { toolUseId: null, signal: new AbortController().signal },
      );

    expect(contribution?.options).toEqual({
      mainAgentOnly: true,
      offline: {
        set_headless: {
          result: textResult('The app is closed: the session stays headless.'),
          replay: false,
        },
      },
    });
    expect(result?.isError ?? false).toBe(false);
    expect(chat.exports.isHeadless('row-1')).toBe(true);
  });

  it.each([{ tool: 'start_session', offline: undefined }])(
    'offlineAnswers_EachChatContribution_AnswersAsPinned: $tool',
    ({ tool, offline }) => {
      const chat = startChatPart();
      const contribution = chat.contributions.find(({ tools }) =>
        tools.some((definition) => definition.name === tool),
      );

      expect(contribution).toBeDefined();
      expect(contribution?.options?.offline).toEqual(offline);
    },
  );

  it('exports_AddSendGate_HoldsAnExportedSend', async () => {
    const chat = startChatPart();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    // The gates skip a row until its harness reports a host id.
    await flushMicrotasks();
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

    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });

    expect(chat.startIdleCompactMinTokens).toEqual([150_000]);
  });

  it('exports_AddInstructions_ReachTheNextStart_AfterTheTitleInstruction', () => {
    const chat = startChatPart();
    chat.exports.addInstructions('visual note');

    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });

    expect(chat.startInstructions).toEqual([
      [expect.stringContaining('set_session_title'), 'visual note'],
    ]);
  });

  // Breaks if the export resolves before the fresh process reports its host
  // session id, when a caller would still read the old one.
  it('clear_Export_ResolvesAfterHostSessionChanged', async () => {
    const chat = startChatPart();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    await chat.exports.send('row-1', { text: 'hi', images: [] });
    await settle();

    await chat.exports.clear('row-1');

    expect(chat.starts.count).toBe(2);
    expect(chat.clearedTo()).toEqual(['host-2']);
  });

  it('toolCallGuard_SubagentCall_SkipsUntilTheRowEnds', async () => {
    const chat = startChatPart();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
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
      replayed: false,
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
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    chat.invoke('start', {
      projectDir: '/q',
      harness: 'claude',
      profile: 'work',
    });
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
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
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    chat.invoke('start', {
      projectDir: '/q',
      harness: 'claude',
      profile: 'work',
    });
    await settle();

    await chat.exports.closeSessionsIn('/p');

    expect(chat.closeReasons()).toEqual(['project-closed']);
  });

  it('exports_Close_EndsTheRow_ResolvesOnceItEnded', async () => {
    const chat = startChatPart();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    chat.invoke('start', {
      projectDir: '/q',
      harness: 'claude',
      profile: 'work',
    });
    await settle();
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

  it('sessionsClosed_UserClose_SaysUser', async () => {
    const chat = startChatPart();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    await settle();

    chat.listeners.get('sessions.closed')?.({ sessionId: 'row-1' });

    expect(chat.closeReasons()).toEqual(['user']);
  });

  it('stop_HeldRows_FiresNoSessionClosed', async () => {
    const chat = startChatPart({ data: await dataWithSavedRow() });
    await chat.heldConnects[0];
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    await settle();

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
      chat.invoke('start', {
        projectDir: '/p',
        harness: 'claude',
        profile: 'work',
      });

      await chat.part.dispose?.(stop);

      expect(chat.kept).toEqual(kept);
    },
  );

  it('exports_CloseSessionsIn_EndsNeverCome_ResolvesAtStop', async () => {
    const chat = startChatPart();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
    chat.holdProcessEnds();
    const closing = chat.exports.closeSessionsIn('/p');

    await chat.part.dispose?.('end');
    await closing;

    expect(chat.ended).toEqual([]);
  });

  it('sessionsTitleChanged_HeldRow_Saves', async () => {
    const chat = startChatPart();
    await settle();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
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
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });

    await chat.part.dispose?.('end');

    expect(chat.cancelLogIn).toHaveBeenCalledOnce();
    expect(chat.processDetach).toHaveBeenCalledOnce();
    expect(chat.processKill).not.toHaveBeenCalled();
  });

  it('stopAll_Channel_StopsEveryProcess', () => {
    const chat = startChatPart();
    chat.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });

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
      infoFails: true,
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

  it.each([
    { given: 'a restore that reopens the saved row', infoFails: false },
    { given: 'a restore that throws', infoFails: true },
  ])(
    'exports_Restored_SettlesWithTheRestore given $given',
    async ({ infoFails }) => {
      const chat = startChatPart({
        infoFails,
        list: () =>
          Promise.resolve([
            { id: 'p1', startedAt: 1, running: true, current: true },
          ]),
        data: await dataWithSavedRow(),
      });

      const restored = chat.exports.restored();

      expect(restored).toBe(chat.invoke('restored'));
      await expect(restored).resolves.toBeUndefined();
    },
  );

  it('exports_Adopt_HoldsRelayConnectsAfterTheRestore', async () => {
    // The restore's list waits for the test; every later list resolves empty.
    let releaseRestoreList: (hosted: HostedProcessInfo[]) => void = () =>
      undefined;
    let lists = 0;
    const list = () => {
      lists += 1;
      if (lists > 1) {
        return Promise.resolve([]);
      }
      return new Promise<HostedProcessInfo[]>((resolve) => {
        releaseRestoreList = resolve;
      });
    };
    const chat = startChatPart({ list, data: await dataWithSavedRow() });

    const adopting = chat.exports.adopt({
      hostSessionId: 'host-a',
      processId: 'host-a-1-4000',
      rowId: 'row-adopted',
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
      headless: true,
      unattended: true,
      instructions: [],
      owner: 'scheduling',
      controls: {},
      titles: { user: null, agent: null, firstMessage: 'run' },
    });
    await settle();

    expect(chat.heldConnects).toContain(adopting);
    expect(chat.sessionsInSlots()).toEqual([]);
    releaseRestoreList([]);
    await expect(adopting).resolves.toBe('row-1');
    expect(chat.sessionsInSlots().map((state) => state.sessionId)).toEqual([
      'row-1',
    ]);
  });

  it('exports_PrepareLaunch_PassesTheEnvToTheHarness', async () => {
    const chat = startChatPart();
    const env = { WIGLEY_FORMS_OFFLINE: '/calls' };
    const message = { text: 'run the task', images: [] };

    const prepared = await chat.exports.prepareLaunch(
      { projectDir: '/p', profile: 'work', message },
      env,
    );

    expect(chat.preparedRuns).toHaveLength(1);
    expect(chat.preparedRuns[0].env).toEqual(env);
    expect(chat.preparedRuns[0].firstMessage).toEqual(message);
    expect(prepared.spawn).toBe(chat.preparedRuns[0].spawn);
    expect(chat.starts.count).toBe(0);
  });

  it('exports_Projects_EqualsTheChannelsList', () => {
    const aiDev = { name: 'AI Dev', folder: '/home/me/ai-dev' };
    const chat = startChatPart({ projects: [aiDev] });
    const before = chat.exports.projects();
    expect(before).toEqual(chat.invoke('projects'));
    expect(before.map((project) => project.name)).toEqual(['AI Dev']);

    chat.settingsChange({
      projects: [aiDev, { name: 'Other', folder: '/home/me/other' }],
    });

    const after = chat.exports.projects();
    expect(after).toEqual(chat.invoke('projects'));
    expect(after.map((project) => project.name)).toEqual(['AI Dev', 'Other']);
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
        chat.invoke('start', {
          projectDir: '/p',
          harness: 'claude',
          profile: 'work',
        });
        return chat.startInstructions.at(-1);
      },
      expected: [expect.stringContaining('set_session_title')],
    },
    {
      contribution: 'a send gate',
      contribute: (view: ChatMainExports) =>
        view.addSendGate(() => ({ action: 'compact', reason: 'r' })),
      observe: async (chat: ReturnType<typeof startChatPart>) => {
        chat.invoke('start', {
          projectDir: '/p',
          harness: 'claude',
          profile: 'work',
        });
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
        chat.invoke('start', {
          projectDir: '/p',
          harness: 'claude',
          profile: 'work',
        });
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
      observe: (chat: ReturnType<typeof startChatPart>) => {
        try {
          return chat.invoke('start', {
            project: 'New Games',
            harness: 'claude',
            profile: 'work',
          });
        } catch (error) {
          return (error as Error).message;
        }
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

  it('exports_PoolProviderChanged_ReasksTheNamerUntilDisposed', () => {
    const chat = startChatPart({ projects: [NEW_GAMES_SETTING] });
    let clones: string[] = [];
    const handle = chat.exports.addPoolProvider(fakePoolProvider(() => clones));
    const [namer] = chat.namers;
    expect(namer('/pool/ng-2/sub')).toBeNull();
    const before = chat.namerChanges.count;

    clones = ['/pool/ng-1', '/pool/ng-2'];
    handle.changed();

    expect(chat.namerChanges.count).toBe(before + 1);
    expect(namer('/pool/ng-2/sub')).toBe('New Games');
    handle.dispose();
    const afterDispose = chat.namerChanges.count;
    handle.changed();
    expect(chat.namerChanges.count).toBe(afterDispose);
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

  it('start_PoolProject_StartsInTheRegisteredProvidersLowestClone', () => {
    const chat = startChatPart({ projects: [NEW_GAMES_SETTING] });
    const before = chat.namerChanges.count;

    chat.exports.addPoolProvider(fakePoolProvider());
    chat.invoke('start', {
      project: 'New Games',
      harness: 'claude',
      profile: 'work',
    });

    expect(chat.namerChanges.count).toBe(before + 1);
    expect(chat.starts.count).toBe(1);
    expect(chat.sessionsInSlots().map((session) => session.projectDir)).toEqual(
      ['/pool/ng-1'],
    );
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
// row's end is recorded in `ended` and emits `sessions.ended`. A process reports
// its request's session id, or `host-new` for a new conversation, in a
// microtask. A process's detach and kill are recorded in `stops`; a kill
// reports its exit, as a real one does.
function startChatOnHarness() {
  const ended: string[] = [];
  const stops = { detaches: 0, kills: 0 };
  let rows = 0;
  const agentHarness = {
    id: 'claude',
    info: () =>
      harnessInfo({ profiles: [{ name: 'work', configDir: '/work' }] }),
    start: (
      request: AgentStart,
      events: {
        sessionId(id: string): void;
        ended(exit: { code: number; error: string | null }): void;
      },
    ) => {
      queueMicrotask(() => events.sessionId(request.sessionId ?? 'host-new'));
      return startedProcess(events);
    },
  } as unknown as AgentHarness;
  const startedProcess = (events: {
    ended(exit: { code: number; error: string | null }): void;
  }) => ({
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
  });
  const state = createSlotStore(() => undefined);
  state
    .publish(coreAgentHarnessesSlot)
    .set(agentHarness.id, agentHarness.info());
  const harness = startMainPart(chatMainPart, {
    state,
    services: {
      agentHarnesses: harnessRegistryOf([agentHarness]),
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
    harness.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
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
    harness.invoke('start', {
      projectDir: '/p',
      harness: 'claude',
      profile: 'work',
    });
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

// A follower over a `core.agentHarnesses` slot that holds `claude` labelled
// `Claude Code`, following a chat double that records each leave and return.
function followedHarnesses() {
  const store = createSlotStore(() => undefined);
  const writer = store.publish(coreAgentHarnessesSlot);
  writer.set('claude', harnessInfo({ label: 'Claude Code' }));
  const logged: string[] = [];
  const follower = createHarnessFollower(
    store.read(coreAgentHarnessesSlot, 'test'),
    (line) => logged.push(line),
  );
  const heard: string[] = [];
  follower.follow({
    harnessLeft: (harnessId) => {
      heard.push(`left ${harnessId}`);
    },
    harnessReturned: (harnessId) => {
      heard.push(`returned ${harnessId}`);
      return Promise.resolve();
    },
  });
  return { writer, follower, heard, logged };
}

describe('createHarnessFollower', () => {
  it('start_HarnessKeyDeleted_ChatHearsTheLeave', () => {
    const test = followedHarnesses();

    test.writer.delete('claude');
    test.writer.delete('claude');

    expect(test.heard).toEqual(['left claude']);
    expect(test.follower.labelOf('claude')).toBe('Claude Code');
  });

  it.each([
    { given: 'a harness that left', leftFirst: true, id: 'claude' },
    { given: 'a first registration', leftFirst: false, id: 'codex' },
  ])(
    'start_HarnessKeySetAfterItLeft_ChatHearsTheReturn given $given',
    ({ leftFirst, id }) => {
      const test = followedHarnesses();
      if (leftFirst) {
        test.writer.delete(id);
      }

      test.writer.set(id, harnessInfo({ label: 'Renamed' }));

      expect(test.heard.at(-1)).toBe(`returned ${id}`);
      expect(test.follower.labelOf(id)).toBe('Renamed');
    },
  );

  it('start_PresentHarnessSetAgain_ChatHearsNeither', () => {
    const test = followedHarnesses();

    test.writer.set('claude', harnessInfo({ label: 'Claude Code 2' }));

    expect(test.heard).toEqual([]);
    expect(test.follower.labelOf('claude')).toBe('Claude Code 2');
    expect(test.follower.labelOf('unknown')).toBe('unknown');
  });

  it('follow_ReturnRejects_LogsIt', async () => {
    const store = createSlotStore(() => undefined);
    const writer = store.publish(coreAgentHarnessesSlot);
    const logged: string[] = [];
    createHarnessFollower(store.read(coreAgentHarnessesSlot, 'test'), (line) =>
      logged.push(line),
    ).follow({
      harnessLeft: () => undefined,
      harnessReturned: () => Promise.reject(new Error('boom')),
    });

    writer.set('claude', harnessInfo());
    await Promise.resolve();
    await Promise.resolve();

    expect(logged).toEqual(['harness claude not re-attached: boom']);
  });
});
