import { describe, expect, it } from 'vitest';
import type { ActiveTime } from '../../../contracts/active-time';
import { NO_ACTIVE_TIME } from '../../../shared/active-time';
import {
  type AgentEvent,
  type AgentProcessEvents,
  type ChatEntry,
  type CompactionTrigger,
  MAIN_AGENT_ID,
  type ProcessActivity,
  type SessionControl,
  type UserMessage,
} from '../../../contracts/agent';
import type { HostedProcessInfo } from '../../../contracts/session-host';
import {
  createFakeAgentHarness,
  FAKE_HOLD_TEXT,
  FAKE_MICROTASK_TIMERS,
  FAKE_PAST_SESSIONS,
  type FakeAgentHarness,
  fakePlanRowUpdate,
  fakeUsageEvent,
} from '../../../shared/fake-agent-harness';
import { createFakeSessionHost } from '../../../shared/fake-session-host';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  AgentSession,
  OpenOptions,
  SessionInfo,
  SessionTitles,
  TitleSource,
  ToolResult,
} from '../../sessions/contract';
import type {
  ChatChannel,
  ChatMainEvents,
  ChatProfile,
  SendGate,
  SendGateInput,
} from '../contract';
import { DEFAULT_PROFILES } from '../manifest';
import {
  ARCHIVED_SESSIONS_FILE,
  createArchivedSessions,
} from './archived-sessions';
import {
  type ChatSessions,
  type ChatSessionsDeps,
  createChatSessions,
  TURN_FINISHED_TITLE,
} from './chat-sessions';
import type {
  OpenSessions,
  SavedSession,
  SavedSessions,
} from './open-sessions';
import { CANCELLED_REASON } from './permission-tool';
import { createRecentFolders, RECENT_FOLDERS_FILE } from './recent-folders';

type Message = {
  [K in keyof ChatChannel['messages']]: {
    message: K;
    data: ChatChannel['messages'][K];
  };
}[keyof ChatChannel['messages']];

type Emitted = {
  [K in keyof ChatMainEvents]: { event: K; data: ChatMainEvents[K] };
}[keyof ChatMainEvents];

interface Announced {
  title: string;
  body: string;
  onClick: () => void;
}

const ROW_ID = 'row-1';
const PROJECT_DIR = '/work/app';
const PAST_ONE = FAKE_PAST_SESSIONS[0];
const PAST_TWO = FAKE_PAST_SESSIONS[1];
// A process of `PAST_ONE` running in the current host.
const HOSTED_PAST_ONE: HostedProcessInfo = {
  id: `${PAST_ONE.sessionId}-1-900`,
  startedAt: 900,
  running: true,
  current: true,
};

const BASH_ARGS = {
  tool_name: 'Bash',
  input: { command: 'ls' },
  tool_use_id: 'tu-1',
};

const NO_TITLES: SessionTitles = {
  user: null,
  agent: null,
  firstMessage: null,
};

// The usage `agentEvent`s chat emitted, as sent.
function usageEmitted(
  emitted: readonly Emitted[],
): ChatMainEvents['agentEvent'][] {
  return emitted.flatMap((each) =>
    each.event === 'agentEvent' && each.data.event.type === 'usage'
      ? [each.data]
      : [],
  );
}

// The `compactionEnded` `agentEvent`s chat emitted, as sent.
function compactionEndsEmitted(emitted: readonly Emitted[]) {
  return emitted.flatMap((each) => {
    if (each.event !== 'agentEvent') {
      return [];
    }
    const { event } = each.data;
    return event.type === 'compactionEnded' ? [{ ...each.data, event }] : [];
  });
}

const NOTHING_SAVED: SavedSessions = {
  sessions: [],
  selectedHostSessionId: null,
};

// A saved record of a session in `/w/app` under `work`, no message sent, no
// turn running and no titles, unless `fields` say otherwise.
function record(
  hostSessionId: string,
  fields: Partial<SavedSession> = {},
): SavedSession {
  return {
    hostSessionId,
    projectDir: '/w/app',
    profile: 'work',
    sent: false,
    busy: false,
    titles: NO_TITLES,
    processId: null,
    launchControls: {},
    launchResume: false,
    queued: [],
    returned: [],
    controls: [],
    confirmedPicks: {},
    returnedDrops: [],
    activeMs: 0,
    ...fields,
  };
}

// An open-sessions store holding the last snapshot saved and the save count.
function fakeOpenSessions() {
  let last: SavedSessions | null = null;
  let saves = 0;
  const store: OpenSessions = {
    load: () => Promise.resolve(NOTHING_SAVED),
    save: (snapshot) => {
      saves++;
      last = structuredClone(snapshot);
      return Promise.resolve();
    },
  };
  return { store, last: () => last, saves: () => saves };
}

// Lets the fake harness's queued emissions and the recent-folders write run.
async function flush() {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

// A folder in no clone, unless a test passes its own `git`.
const NO_CLONE: ChatSessionsDeps['git'] = {
  topLevel: () => Promise.resolve(null),
  currentBranch: () => Promise.resolve(null),
};

function setUp(
  options: {
    harnesses?: FakeAgentHarness[];
    clockNow?: number;
    git?: ChatSessionsDeps['git'];
    sessionHost?: ChatSessionsDeps['sessionHost'];
  } = {},
) {
  let clockNow = options.clockNow ?? 1000;
  const clock = { now: () => clockNow };
  const harness = createFakeAgentHarness(
    clock,
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
  const harnesses = options.harnesses ?? [harness];
  const sessionHost = createFakeSessionHost(clock);
  const data = createMemoryFiles();
  const logged: string[] = [];
  const log = (message: string) => logged.push(message);
  const opened: SessionInfo[] = [];
  const openOptions: (OpenOptions | undefined)[] = [];
  const marked: string[] = [];
  const activated: string[] = [];
  const announced: Announced[] = [];
  const messages: Message[] = [];
  const emitted: Emitted[] = [];
  let ownedEnds = 0;
  let windowShows = 0;
  let isFocused = true;
  let selectedSessionId: string | null = ROW_ID;
  let uuidCalls = 0;
  const hostIdChanges: string[] = [];
  // Host ids whose `open` throws, and what each owned `end` also does.
  const refusedOpens = new Set<string>();
  let onOwnedEnd = () => {};
  let profiles: readonly ChatProfile[] = DEFAULT_PROFILES;
  const archived = createArchivedSessions(data);
  const saved = fakeOpenSessions();
  // Every `setTitle` call, and the titles of each row opened.
  const titleCalls: [string, TitleSource, string | null][] = [];
  const titles = new Map<string, SessionTitles>();
  // Rows are numbered in open order: the first is ROW_ID.
  const sessions: ChatSessionsDeps['sessions'] = {
    open: (info, options) => {
      if (info.sessionId !== null && refusedOpens.has(info.sessionId)) {
        throw new Error(`open of ${info.sessionId} refused`);
      }
      opened.push(info);
      openOptions.push(options);
      const id = `row-${opened.length}`;
      titles.set(id, { ...NO_TITLES });
      return {
        session: { id, info },
        end: () => {
          ownedEnds++;
          onOwnedEnd();
        },
        setHostSessionId: (hostSessionId) => {
          hostIdChanges.push(hostSessionId);
        },
      };
    },
    mark: (sessionId) => marked.push(sessionId),
    activate: (sessionId) => activated.push(sessionId),
    selectedSessionId: () => selectedSessionId,
    setTitle: (sessionId, source, title) => {
      titleCalls.push([sessionId, source, title]);
      const held = titles.get(sessionId);
      if (held !== undefined) {
        held[source] = title;
      }
    },
    titles: (sessionId) => {
      const held = titles.get(sessionId);
      return held === undefined ? null : { ...held };
    },
  };
  const chat = createChatSessions({
    harnesses,
    sessions,
    profiles: () => profiles,
    randomUuid: () => {
      uuidCalls++;
      return `uuid-${uuidCalls}`;
    },
    recent: createRecentFolders({
      data,
      clock,
      paths: posixPaths,
      log,
    }),
    archived,
    saved: saved.store,
    send: (message, data) => messages.push({ message, data } as Message),
    emit: (event, data) => emitted.push({ event, data } as Emitted),
    alerts: {
      announce: (title, body, onClick) =>
        announced.push({ title, body, onClick }),
    },
    window: {
      show: () => {
        windowShows++;
      },
      isFocused: () => isFocused,
    },
    git: options.git ?? NO_CLONE,
    log,
    clock,
    sessionHost: options.sessionHost ?? sessionHost,
  });
  const agentSession: AgentSession = {
    id: ROW_ID,
    info: {
      sessionId: 'uuid-1',
      projectDir: PROJECT_DIR,
      deadlineSeconds: null,
      harness: 'claude',
    },
  };
  return {
    chat,
    harness,
    sessionHost,
    data,
    logged,
    opened,
    openOptions,
    marked,
    activated,
    announced,
    messages,
    emitted,
    agentSession,
    archived,
    saved,
    titleCalls,
    titlesOf: (sessionId: string) => titles.get(sessionId),
    // Changes a row's titles as sessions would, recording no call.
    setRowTitles: (sessionId: string, next: SessionTitles) =>
      titles.set(sessionId, next),
    uuidCalls: () => uuidCalls,
    setNow: (now: number) => {
      clockNow = now;
    },
    hostIdChanges,
    ownedEnds: () => ownedEnds,
    windowShows: () => windowShows,
    setFocused: (focused: boolean) => {
      isFocused = focused;
    },
    setSelected: (sessionId: string | null) => {
      selectedSessionId = sessionId;
    },
    refuseOpen: (hostId: string) => refusedOpens.add(hostId),
    setOnOwnedEnd: (act: () => void) => {
      onOwnedEnd = act;
    },
    setProfiles: (next: readonly ChatProfile[]) => {
      profiles = next;
    },
    sent: <K extends Message['message']>(message: K) =>
      messages
        .filter((sent) => sent.message === message)
        .map((sent) => sent.data as ChatChannel['messages'][K]),
    // Each `returned` sent, with its messages' ids left out.
    sentReturned: () =>
      messages
        .filter((sent) => sent.message === 'returned')
        .map((sent) => {
          const data = sent.data as ChatChannel['messages']['returned'];
          return {
            sessionId: data.sessionId,
            messages: data.messages.map(({ text, images }) => ({
              text,
              images,
            })),
          };
        }),
  };
}

async function started(options?: Parameters<typeof setUp>[0]) {
  const test = setUp(options);
  test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
  await flush();
  const process = test.harness.processes[0];
  const activity = (value: ProcessActivity) => process.events.activity(value);
  return { ...test, process, activity };
}

// A session the sessions plugin reports connected with host id `hostId`.
function connected(id: string, hostId: string): AgentSession {
  return {
    id,
    info: {
      sessionId: hostId,
      projectDir: '/w/app',
      deadlineSeconds: null,
      harness: 'claude',
    },
  };
}

function assistant(id: string, text: string): ChatEntry {
  return { kind: 'assistant', id, at: 1000, text, streaming: false, raw: [] };
}

const IDLE_SEND: UserMessage = { text: 'idle send', images: [] };
const PENDING: UserMessage = { text: 'pending', images: [] };

// Two messages sent while the session's harness reports `working`.
function queueTwo(
  test: Awaited<ReturnType<typeof started>>,
): [UserMessage, UserMessage] {
  const first: UserMessage = { text: 'first', images: [] };
  const second: UserMessage = {
    text: 'second',
    images: [{ mediaType: 'image/png', data: 'iVBORw0K' }],
  };
  test.activity('working');
  test.chat.send(ROW_ID, first);
  test.chat.send(ROW_ID, second);
  return [first, second];
}

// The entry id the `index`th queued row was sent now under.
function sentEntryIdOf(test: ReturnType<typeof setUp>, index: number): string {
  const { sentEntryId } = test.chat.sessions()[0].queued[index];
  if (sentEntryId === null) {
    throw new Error(`queued row ${index} was not sent now`);
  }
  return sentEntryId;
}

function userEntry(id: string, text: string): ChatEntry {
  return { kind: 'user', id, at: 1000, text, images: [], raw: [] };
}

const REFUSED_TEXT = 'refused write';

// A started session whose process throws on a write of REFUSED_TEXT.
async function startedRefusing() {
  const fake = createFakeAgentHarness(
    { now: () => 1000 },
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
  const refusing: FakeAgentHarness = {
    ...fake,
    start: (request, events) => {
      const process = fake.start(request, events);
      return {
        ...process,
        send: (message) => {
          if (message.text === REFUSED_TEXT) {
            throw new Error('write refused');
          }
          return process.send(message);
        },
      };
    },
  };
  const test = setUp({ harnesses: [refusing] });
  test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
  await flush();
  const process = fake.processes[0];
  const activity = (value: ProcessActivity) => process.events.activity(value);
  return { ...test, process, activity };
}

function sendCall(message: UserMessage) {
  return {
    method: 'send',
    text: message.text,
    imageCount: message.images.length,
  };
}

function signal(): AbortController {
  return new AbortController();
}

// The call's result, or 'pending' when it has not settled after a flush.
async function settled(
  call: Promise<ToolResult>,
): Promise<ToolResult | 'pending'> {
  let result: ToolResult | 'pending' = 'pending';
  void call.then((value) => {
    result = value;
  });
  await flush();
  return result;
}

function replyText(result: ToolResult | 'pending'): string {
  if (result === 'pending') {
    throw new Error('the call is still pending');
  }
  return result.content[0].text;
}

describe('createChatSessions', () => {
  it('start_opensTheSessionAndStartsTheHarness', async () => {
    const test = setUp();

    const sessionId = test.chat.start({
      projectDir: PROJECT_DIR,
      profile: 'personal',
    });
    await flush();

    expect(sessionId).toBe(ROW_ID);
    expect(test.opened).toEqual([
      {
        sessionId: 'uuid-1',
        projectDir: PROJECT_DIR,
        deadlineSeconds: null,
        harness: 'claude',
      },
    ]);
    expect(test.harness.processes.map((process) => process.request)).toEqual([
      {
        processId: 'uuid-1-1-1000',
        sessionId: 'uuid-1',
        resume: false,
        projectDir: PROJECT_DIR,
        profileDir: '~/.claude-personal',
        controls: {},
        instructions: [],
        idleCompactMinTokens: null,
        rowId: ROW_ID,
      },
    ]);
    expect(test.sent('sessionStarted')).toEqual([
      {
        sessionId: ROW_ID,
        projectDir: PROJECT_DIR,
        profile: 'personal',
        entries: [],
        controls: [],
        activity: 'idle',
        background: 0,
        activeTime: { totalMs: 0, since: null },
        commands: [],
        running: false,
        queued: [],
        compaction: null,
        returned: [],
        repo: 'app',
        branch: null,
      },
    ]);
    expect(test.sent('sessionRunning')).toEqual([{ sessionId: ROW_ID }]);
    expect(test.chat.sessions()[0].running).toBe(true);
    expect(JSON.parse(await test.data.read(RECENT_FOLDERS_FILE))).toEqual([
      { projectDir: PROJECT_DIR, profile: 'personal', lastUsed: 1000 },
    ]);
  });

  it.each([
    { row: 'the started row', sessionId: ROW_ID, expected: 'uuid-1' },
    { row: 'a row chat does not hold', sessionId: 'row-9', expected: null },
  ])('hostSessionIdOf_$row_ReturnsItsHostId', ({ sessionId, expected }) => {
    const test = setUp();
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });

    expect(test.chat.hostSessionIdOf(sessionId)).toBe(expected);
  });

  it('addInstructions_EachStartCarriesTheRegisteredOnes', async () => {
    const test = setUp();
    const first = test.chat.addInstructions('first note');
    test.chat.addInstructions('second note');

    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    expect(test.harness.processes[0].request.instructions).toEqual([
      'first note',
      'second note',
    ]);

    first.dispose();
    first.dispose();
    test.chat.send(ROW_ID, { text: 'hi', images: [] });
    await flush();
    test.harness.processes[0].events.ended({ code: 0, error: null });
    test.chat.send(ROW_ID, { text: 'again', images: [] });
    await flush();
    expect(test.harness.processes[1].request.instructions).toEqual([
      'second note',
    ]);

    test.chat.addInstructions('third note');
    test.chat.clear(ROW_ID);
    await flush();
    expect(test.harness.processes[2].request.instructions).toEqual([
      'second note',
      'third note',
    ]);
    expect(test.harness.processes[0].request.instructions).toEqual([
      'first note',
      'second note',
    ]);
  });

  it('pastSessions_LeavesOutOpenAndMarksArchived', async () => {
    const test = setUp();
    await test.archived.set(PAST_ONE.sessionId, true);
    test.chat.sessionConnected(connected('row-9', PAST_TWO.sessionId));

    const rows = await test.chat.pastSessions('/w/app', 'personal');

    expect(rows).toEqual([
      {
        hostSessionId: PAST_ONE.sessionId,
        title: 'fake past session one',
        modified: 1767323045000,
        archived: true,
      },
    ]);
    expect(test.harness.pastSessionCalls).toEqual([
      {
        method: 'listSessions',
        sessionId: null,
        projectDir: '/w/app',
        profileDir: '~/.claude-personal',
        before: null,
      },
    ]);
  });

  it('pastSessions_UnreadableArchiveFile_ListsNoneArchivedAndKeepsIt', async () => {
    const test = setUp();
    await test.data.write(ARCHIVED_SESSIONS_FILE, '{oops');

    const rows = await test.chat.pastSessions('/w/app', 'personal');

    expect(rows.map((row) => [row.hostSessionId, row.archived])).toEqual([
      [PAST_ONE.sessionId, false],
      [PAST_TWO.sessionId, false],
    ]);
    expect(test.logged).toContainEqual(
      expect.stringContaining(ARCHIVED_SESSIONS_FILE),
    );
    expect(await test.data.read(ARCHIVED_SESSIONS_FILE)).toBe('{oops');
  });

  it('pastSessions_AfterEnded_ListsItAgain', async () => {
    const test = setUp();
    await test.archived.set(PAST_ONE.sessionId, true);
    test.chat.sessionConnected(connected('row-9', PAST_TWO.sessionId));
    await test.chat.pastSessions('/w/app', 'personal');

    test.chat.sessionEnded('row-9');
    const rows = await test.chat.pastSessions('/w/app', 'personal');

    expect(rows.map((row) => row.hostSessionId)).toEqual([
      PAST_ONE.sessionId,
      PAST_TWO.sessionId,
    ]);
  });

  it.each([
    {
      entryPoint: 'pastSessions',
      call: (chat: ChatSessions) => chat.pastSessions('/w/app', 'home'),
    },
    {
      entryPoint: 'resume',
      call: (chat: ChatSessions) =>
        chat.resume({
          projectDir: '/w/app',
          profile: 'home',
          hostSessionId: PAST_ONE.sessionId,
          title: PAST_ONE.title,
        }),
    },
    {
      entryPoint: 'launch',
      call: (chat: ChatSessions) =>
        chat.launch({
          projectDir: PROJECT_DIR,
          profile: 'home',
          message: { text: 'fix the chip', images: [] },
        }),
    },
    {
      entryPoint: 'start',
      call: (chat: ChatSessions) =>
        chat.start({ projectDir: PROJECT_DIR, profile: 'home' }),
    },
  ])(
    '$entryPoint with an unknown profile refuses and calls nothing',
    async ({ call }) => {
      const test = setUp();

      await expect(async () => call(test.chat)).rejects.toThrow('"home"');
      expect(test.harness.pastSessionCalls).toEqual([]);
      expect(test.harness.processes).toEqual([]);
      expect(test.opened).toEqual([]);
    },
  );

  it('resume_OpensWithHistoryAndResumesTheProcess', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;

    const sessionId = await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });
    await flush();

    expect(sessionId).toBe(ROW_ID);
    expect(test.opened).toEqual([
      {
        sessionId: hostId,
        projectDir: '/w/app',
        deadlineSeconds: null,
        harness: 'claude',
      },
    ]);
    const [state] = test.sent('sessionStarted');
    expect(
      state.entries.map((entry) => [
        entry.id,
        'text' in entry ? entry.text : null,
      ]),
    ).toEqual([
      [`history:${hostId}-user`, 'fake earlier message'],
      [`history:${hostId}-assistant`, 'fake earlier reply'],
    ]);
    expect(state.commands).toEqual([]);
    expect(test.harness.processes.at(-1)?.request).toEqual({
      processId: `${hostId}-1-1000`,
      sessionId: hostId,
      resume: true,
      projectDir: '/w/app',
      profileDir: '~/.claude',
      controls: {},
      instructions: [],
      idleCompactMinTokens: null,
      rowId: ROW_ID,
    });
    expect(test.uuidCalls()).toBe(0);
    expect(JSON.parse(await test.data.read(RECENT_FOLDERS_FILE))).toEqual([
      { projectDir: '/w/app', profile: 'work', lastUsed: 1000 },
    ]);
  });

  it('resume_HistoryFails_NoticeAndStillResumes', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;
    test.harness.failNextHistory('cannot read');

    await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });

    expect(test.sent('sessionStarted')[0].entries).toEqual([
      {
        kind: 'notice',
        id: 'history:unread',
        at: 1000,
        text: 'Earlier conversation not read: cannot read',
        tone: 'error',
        raw: [],
      },
    ]);
    expect(test.logged).toContainEqual(
      expect.stringMatching(new RegExp(`${hostId}.*cannot read`)),
    );
    expect(test.harness.processes.at(-1)?.request.resume).toBe(true);
  });

  it.each([
    {
      given: 'saved usage',
      saved: fakeUsageEvent(2, 1500),
      emitted: [
        {
          sessionId: ROW_ID,
          profileDir: '~/.claude',
          hostSessionId: PAST_ONE.sessionId,
          event: fakeUsageEvent(2, 1500),
          replayed: false,
        },
      ],
    },
    { given: 'none saved', saved: null, emitted: [] },
  ])(
    'resume_SavedUsage_EmitsItAsTheNewRowsAgentEvent given $given',
    async ({ saved, emitted }) => {
      const test = setUp();
      const hostId = PAST_ONE.sessionId;
      test.harness.setLastUsage(hostId, saved);

      await test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: hostId,
        title: PAST_ONE.title,
      });

      expect(test.harness.lastUsageCalls).toEqual([hostId]);
      expect(usageEmitted(test.emitted)).toEqual(emitted);
    },
  );

  it('resume_SavedUsageReadFails_LogsAndStillResumes', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;
    test.harness.setLastUsage(hostId, fakeUsageEvent(2, 1500));
    test.harness.failNextLastUsage('transcript unreadable');

    const sessionId = await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });

    expect(sessionId).toBe(ROW_ID);
    expect(test.harness.processes.at(-1)?.request.resume).toBe(true);
    expect(test.logged).toContain(
      `saved usage of ${hostId} not read: transcript unreadable`,
    );
    expect(usageEmitted(test.emitted)).toEqual([]);
  });

  it.each([
    {
      given: 'its process running here',
      list: [{ ...HOSTED_PAST_ONE }],
      rejects: null,
      attaches: [HOSTED_PAST_ONE.id],
      startResumes: [],
    },
    {
      given: 'its process running in another app version',
      list: [{ ...HOSTED_PAST_ONE, current: false }],
      rejects:
        'This session is still finishing in another app version. Send again once it ends.',
      attaches: [],
      startResumes: [],
    },
    {
      given: 'its process ended',
      list: [{ ...HOSTED_PAST_ONE, running: false }],
      rejects: null,
      attaches: [],
      startResumes: [true],
    },
    {
      given: "another session's process running",
      list: [{ ...HOSTED_PAST_ONE, id: `${PAST_TWO.sessionId}-1-900` }],
      rejects: null,
      attaches: [],
      startResumes: [true],
    },
    {
      given: 'the list rejecting',
      list: null,
      rejects: 'no host',
      attaches: [],
      startResumes: [],
    },
  ])(
    'resume_ListsTheHostFirst given $given',
    async ({ list, rejects, attaches, startResumes }) => {
      const test = setUp({
        sessionHost: {
          list: () =>
            list === null
              ? Promise.reject(new Error('no host'))
              : Promise.resolve(list),
        },
      });
      test.harness.scriptAttach(HOSTED_PAST_ONE.id, {
        outcome: 'process',
        turns: 0,
        replay() {},
      });

      const resuming = test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: PAST_ONE.sessionId,
        title: PAST_ONE.title,
      });
      if (rejects === null) {
        await expect(resuming).resolves.toBe(ROW_ID);
      } else {
        await expect(resuming).rejects.toThrow(rejects);
      }
      await flush();

      expect(
        test.harness.attachCalls.map((request) => request.processId),
      ).toEqual(attaches);
      expect(test.harness.attachCalls.map((request) => request.rowId)).toEqual(
        attaches.map(() => ROW_ID),
      );
      expect(
        test.harness.processes
          .filter((process) => !process.attached)
          .map((process) => process.request.resume),
      ).toEqual(startResumes);
      expect(test.opened).toHaveLength(rejects === null ? 1 : 0);
      if (list === null) {
        expect(test.logged).toContain('session host not listed: no host');
      }
    },
  );

  it.each([
    {
      given: 'its process running here',
      list: [HOSTED_PAST_ONE],
      attaches: [HOSTED_PAST_ONE.id],
      starts: 0,
    },
    { given: 'no process running', list: [], attaches: [], starts: 1 },
  ])(
    'resume_TwiceDuringTheListsWait_OpensOneRow given $given',
    async ({ list, attaches, starts }) => {
      let releaseList = () => {};
      const listed = new Promise<HostedProcessInfo[]>((resolve) => {
        releaseList = () => resolve(list);
      });
      const test = setUp({ sessionHost: { list: () => listed } });
      test.harness.scriptAttach(HOSTED_PAST_ONE.id, {
        outcome: 'process',
        turns: 0,
        replay() {},
      });
      const request = {
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: PAST_ONE.sessionId,
        title: PAST_ONE.title,
      };

      const resuming = [test.chat.resume(request), test.chat.resume(request)];
      releaseList();

      await expect(Promise.all(resuming)).resolves.toEqual([ROW_ID, ROW_ID]);
      await flush();
      expect(test.opened).toHaveLength(1);
      expect(test.activated).toEqual([ROW_ID]);
      expect(
        test.harness.attachCalls.map((attach) => attach.processId),
      ).toEqual(attaches);
      expect(
        test.harness.processes.filter((process) => !process.attached),
      ).toHaveLength(starts);
    },
  );

  it('resume_ProcessRunningHere_ReadsHistoryUpToItsStart', async () => {
    const test = setUp({
      sessionHost: { list: () => Promise.resolve([HOSTED_PAST_ONE]) },
    });
    test.harness.scriptAttach(HOSTED_PAST_ONE.id, {
      outcome: 'process',
      turns: 0,
      replay() {},
    });
    test.chat.restore(NOTHING_SAVED, []);

    await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: PAST_ONE.sessionId,
      title: PAST_ONE.title,
    });
    await test.chat.loadHistory(ROW_ID);

    expect(test.openOptions).toEqual([{ select: true }]);
    expect(
      test.harness.pastSessionCalls
        .filter((call) => call.method === 'history')
        .map((call) => call.before),
    ).toEqual([HOSTED_PAST_ONE.startedAt]);
    expect(test.saved.last()?.sessions[0].processId).toBe(HOSTED_PAST_ONE.id);
  });

  it('resume_AlreadyOpen_Rejects', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;
    test.chat.sessionConnected(connected('row-9', hostId));

    await expect(
      test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: hostId,
        title: PAST_ONE.title,
      }),
    ).rejects.toThrow(hostId);
    expect(test.harness.pastSessionCalls).toEqual([]);
    expect(test.opened).toEqual([]);
  });

  it('pastSessions_OpenRows_ListsChatRowsOnly', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record(PAST_ONE.sessionId)],
        selectedHostSessionId: null,
      },
      [],
    );
    test.chat.sessionConnected(connected(ROW_ID, PAST_ONE.sessionId));
    test.chat.sessionConnected(connected('row-relay', PAST_TWO.sessionId));

    const rows = await test.chat.pastSessions('/w/app', 'work');

    expect(rows.map((row) => row.hostSessionId)).toEqual([PAST_ONE.sessionId]);
  });

  it('resume_HostIdChatHolds_SelectsExistingRow', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;
    test.chat.restore(
      {
        sessions: [record(hostId)],
        selectedHostSessionId: null,
      },
      [],
    );
    test.chat.sessionConnected(connected(ROW_ID, hostId));

    const sessionId = await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });

    expect(sessionId).toBe(ROW_ID);
    expect(test.activated).toEqual([ROW_ID]);
    expect(test.opened).toHaveLength(1);
    expect(test.harness.processes).toEqual([]);
    expect(test.harness.pastSessionCalls).toEqual([]);
    expect(test.titleCalls).toEqual([]);
  });

  it('commands_StoredAndSentOnChange', async () => {
    const test = await started();

    test.process.events.commands(['compact', 'model']);
    test.process.events.commands(['compact', 'model']);

    expect(test.sent('commands')).toEqual([
      { sessionId: ROW_ID, names: ['fake-command'] },
      { sessionId: ROW_ID, names: ['compact', 'model'] },
    ]);
    expect(test.chat.sessions()[0].commands).toEqual(['compact', 'model']);
  });

  it('start_OpensSelected', () => {
    const test = setUp();

    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });

    expect(test.openOptions).toEqual([{ select: true }]);
  });

  it('launch_OpensUnselectedAndSendsFirstMessage', async () => {
    const test = setUp();

    const sessionId = test.chat.launch({
      projectDir: PROJECT_DIR,
      profile: DEFAULT_PROFILES[0].name,
      message: { text: 'fix the chip', images: [] },
    });
    await flush();

    expect(sessionId).toBe(ROW_ID);
    expect(test.openOptions).toEqual([{ select: false }]);
    expect(test.harness.processes[0].calls).toEqual([
      { method: 'send', text: 'fix the chip', imageCount: 0 },
    ]);
    expect(test.activated).toEqual([]);
  });

  it('launch_ImageOverCap_RejectsAndOpensNothing', () => {
    const test = setUp();
    const oversized = {
      mediaType: 'image/png',
      data: 'a'.repeat(6 * 1024 * 1024),
    };

    expect(() =>
      test.chat.launch({
        projectDir: PROJECT_DIR,
        profile: DEFAULT_PROFILES[0].name,
        message: { text: 'fix the chip', images: [oversized] },
      }),
    ).toThrow(/5 MB/);
    expect(test.opened).toEqual([]);
  });

  it('start_noClaudeHarness_throwsAndOpensNothing', () => {
    const test = setUp({ harnesses: [] });

    expect(() =>
      test.chat.start({ projectDir: PROJECT_DIR, profile: 'work' }),
    ).toThrow(/claude/);
    expect(test.opened).toEqual([]);
  });

  // The sessions plugin selects a neighbouring row inside the failed row's
  // `end`, and that selection saves.
  it.each([
    { given: 'no other row', saved: [], rows: [] },
    {
      given: 'a held row the selection moves to',
      saved: [record('host-a')],
      rows: ['row-1'],
    },
  ])(
    'start_harnessThrows_endsTheOwnedSessionAndThrowsTheError given $given',
    ({ saved, rows }) => {
      const test = setUp();
      test.chat.restore({ sessions: saved, selectedHostSessionId: null }, []);
      test.setOnOwnedEnd(() => test.chat.selected(rows[0] ?? null));
      test.harness.failNextStart('spawn failed');

      expect(() =>
        test.chat.start({ projectDir: PROJECT_DIR, profile: 'work' }),
      ).toThrow('spawn failed');
      expect(test.ownedEnds()).toBe(1);
      expect(test.sent('sessionRested')).toEqual([]);
      expect(test.chat.sessions().map((state) => state.sessionId)).toEqual(
        rows,
      );
      expect(
        test.saved.last()?.sessions.map((kept) => kept.hostSessionId),
      ).toEqual(saved.map((kept) => kept.hostSessionId));
    },
  );

  it('entry_sameIdReplacesInPlace', async () => {
    const test = await started();

    test.process.events.entry(assistant('a', 'x'));
    test.process.events.entry(assistant('b', 'y'));
    test.process.events.entry(assistant('a', 'xy'));

    expect(test.chat.sessions()[0].entries).toEqual([
      assistant('a', 'xy'),
      assistant('b', 'y'),
    ]);
    const entries = test.sent('entry');
    expect(entries).toHaveLength(3);
    expect(entries[2]).toEqual({
      sessionId: ROW_ID,
      entry: assistant('a', 'xy'),
    });
  });

  it('entry_SecondProcessReusesAnId_HeldAfterTheExitNotice', async () => {
    const test = await started();
    test.chat.send(ROW_ID, { text: 'first', images: [] });
    await flush();
    test.process.events.ended({ code: 0, error: null });

    test.chat.send(ROW_ID, { text: 'second', images: [] });
    await flush();

    const userOrNotice = test.chat
      .sessions()[0]
      .entries.filter(
        (entry) => entry.kind === 'user' || entry.kind === 'notice',
      );
    expect(userOrNotice).toEqual([
      expect.objectContaining({ kind: 'user', text: 'first' }),
      expect.objectContaining({ kind: 'notice' }),
      expect.objectContaining({ kind: 'user', text: 'second' }),
    ]);
  });

  // `opus` is the alias Claude's `claude-opus-5-5[1m]` shows as. A row whose
  // pick the process never confirms has its own reports dropped meanwhile.
  it.each([
    {
      case: 'ConfirmedPicksThroughLaterReports',
      picks: [
        ['model', 'fake-large'],
        ['effort', 'low'],
      ],
      confirms: true,
      clears: false,
      reported: { mode: 'auto', model: 'opus', effort: 'high' },
      controls: { mode: 'auto', model: 'fake-large', effort: 'low' },
    },
    {
      case: 'ConfirmedEffortDroppedByNullReport',
      picks: [['effort', 'high']],
      confirms: true,
      clears: false,
      reported: { mode: 'auto', model: 'opus', effort: null },
      later: { mode: 'auto', model: 'opus', effort: 'medium' },
      controls: { mode: 'auto' },
    },
    {
      case: 'ReportedOnly1mModelAndEffort',
      picks: [],
      confirms: true,
      clears: false,
      reported: { mode: 'auto', model: 'opus', effort: 'high' },
      controls: { mode: 'auto' },
    },
    {
      case: 'RefusedModelPick',
      picks: [['model', 'fake-large']],
      confirms: false,
      clears: false,
      reported: { mode: 'auto', model: 'opus', effort: 'high' },
      controls: { mode: 'auto' },
    },
    {
      case: 'ClearBeforeConfirmation',
      picks: [['model', 'fake-large']],
      confirms: true,
      clears: true,
      reported: { mode: 'auto', model: 'fake-large', effort: 'high' },
      controls: { mode: 'auto' },
    },
    {
      case: 'ModeClaudeEntered',
      picks: [],
      confirms: true,
      clears: false,
      reported: { mode: 'plan', model: 'opus', effort: 'high' },
      controls: { mode: 'plan' },
    },
  ])(
    'restart_StartCarriesHeldModeAndConfirmedPicks ($case)',
    async ({ picks, confirms, clears, reported, later, controls }) => {
      const test = await started();
      test.chat.send(ROW_ID, { text: 'first', images: [] });
      await flush();
      const reportControls = test.process.events.controls;
      if (!confirms) {
        test.process.events.controls = () => {};
      }
      for (const [id, value] of picks) {
        test.chat.setControl(ROW_ID, id, value);
      }
      if (clears) {
        test.chat.clear(ROW_ID);
      }
      await flush();
      test.process.events.controls = reportControls;
      const current = test.harness.processes[clears ? 1 : 0];
      for (const report of later === undefined
        ? [reported]
        : [reported, later]) {
        current.events.controls(
          Object.entries(report).map(([id, value]) => ({
            id,
            label: id,
            choices: [],
            value,
          })),
        );
      }
      current.events.ended({ code: 0, error: null });

      test.chat.send(ROW_ID, { text: 'second', images: [] });
      await flush();

      expect(test.harness.processes.at(-1)?.request.controls).toEqual(controls);
    },
  );

  it('controls_storedAndSent', async () => {
    const test = await started();
    const controls: SessionControl[] = [
      {
        id: 'mode',
        label: 'Mode',
        choices: [{ value: 'auto', label: 'Auto' }],
        value: 'auto',
      },
    ];

    test.process.events.controls(controls);

    expect(test.sent('controls').at(-1)).toEqual({
      sessionId: ROW_ID,
      controls,
    });
    expect(test.chat.sessions()[0].controls).toEqual(controls);
  });

  it('turnFinished_focusedAndSelected_noAlert', async () => {
    const test = await started();

    test.activity('working');
    test.activity('idle');

    expect(test.sent('activity')).toEqual([
      { sessionId: ROW_ID, activity: 'working' },
      { sessionId: ROW_ID, activity: 'idle' },
    ]);
    expect(test.announced).toEqual([]);
    expect(test.marked).toEqual([]);
  });

  it('turnFinished_unfocused_alertsAndMarks', async () => {
    const test = await started();
    test.setFocused(false);

    test.activity('working');
    test.activity('idle');

    expect(test.announced.map(({ title, body }) => [title, body])).toEqual([
      [TURN_FINISHED_TITLE, 'app'],
    ]);
    expect(test.marked).toEqual([ROW_ID]);
    test.announced[0].onClick();
    expect(test.activated).toEqual([ROW_ID]);
    expect(test.windowShows()).toBe(1);
  });

  it('turnFinished_otherSessionSelected_alertsAndMarks', async () => {
    const test = await started();
    test.setSelected('row-other');

    test.activity('working');
    test.activity('idle');

    expect(test.announced).toHaveLength(1);
    expect(test.marked).toEqual([ROW_ID]);
  });

  it('turnFinished_backgroundWorkRunning_noAlertUntilLastTurnEnds', async () => {
    const test = await started();
    test.setFocused(false);
    const { events } = test.process;

    test.activity('working');
    events.agentEvent({
      type: 'agentSpawned',
      at: 0,
      agentId: 'agent-1',
      parentAgentId: MAIN_AGENT_ID,
      agentType: 'general-purpose',
      description: 'review',
      name: 'review',
      model: null,
      effort: null,
    });
    events.agentEvent({
      type: 'taskStarted',
      at: 0,
      taskId: 'task-1',
      agentId: MAIN_AGENT_ID,
      description: 'build',
      command: 'npm run build',
    });
    test.activity('idle');

    expect(test.announced).toEqual([]);
    expect(test.marked).toEqual([]);
    expect(test.chat.sessions()[0].background).toBe(2);

    events.agentEvent({
      type: 'agentFinished',
      at: 0,
      agentId: 'agent-1',
      outcome: 'done',
    });
    events.agentEvent({
      type: 'taskFinished',
      at: 0,
      taskId: 'task-1',
      outcome: 'done',
    });
    test.activity('working');
    test.activity('idle');

    expect(test.sent('background')).toEqual([
      { sessionId: ROW_ID, background: 1 },
      { sessionId: ROW_ID, background: 2 },
      { sessionId: ROW_ID, background: 1 },
      { sessionId: ROW_ID, background: 0 },
    ]);
    expect(test.announced).toHaveLength(1);
    expect(test.marked).toEqual([ROW_ID]);
  });

  it('processExit_BackgroundWorkRunning_ClearsBackground', async () => {
    const test = await started();
    test.process.events.agentEvent({
      type: 'taskStarted',
      at: 0,
      taskId: 'task-1',
      agentId: MAIN_AGENT_ID,
      description: 'server',
      command: null,
    });

    test.process.events.ended({ code: 0, error: null });

    expect(test.sent('background').at(-1)).toEqual({
      sessionId: ROW_ID,
      background: 0,
    });
  });

  it('activity_unchanged_sendsNothing', async () => {
    const test = await started();
    test.setFocused(false);

    test.activity('idle');

    expect(test.sent('activity')).toEqual([]);
    expect(test.announced).toEqual([]);
  });

  it.each([
    { code: 0, error: null, tone: 'info', text: 'exit code 0' },
    { code: 1, error: 'boom', tone: 'error', text: '): boom' },
    { code: null, error: null, tone: 'error', text: 'exit code unknown' },
  ])(
    'processExit_RunningRow_RestsWithNotice (code $code, error $error)',
    async ({ code, error, tone, text }) => {
      const test = await started();
      test.process.events.entry(assistant('a1', 'hi'));

      test.process.events.ended({ code, error });
      test.process.events.entry(assistant('late', 'z'));

      expect(test.sent('sessionRested')).toEqual([
        { sessionId: ROW_ID, error },
      ]);
      expect(test.ownedEnds()).toBe(0);
      const [state] = test.chat.sessions();
      expect(state).toMatchObject({ sessionId: ROW_ID, running: false });
      expect(state.entries).toEqual([
        assistant('a1', 'hi'),
        expect.objectContaining({
          kind: 'notice',
          tone,
          text: expect.stringContaining(text),
        }),
      ]);
    },
  );

  it('processExit_WhileWorking_ShowsIdleAndAnnouncesNothing', async () => {
    const test = await started();
    test.setFocused(false);
    test.activity('working');

    test.process.events.ended({ code: 0, error: null });

    expect(test.sent('activity').at(-1)).toEqual({
      sessionId: ROW_ID,
      activity: 'idle',
    });
    expect(test.chat.sessions()).toMatchObject([
      { sessionId: ROW_ID, running: false, activity: 'idle' },
    ]);
    expect(test.announced).toEqual([]);
    expect(test.marked).toEqual([]);
  });

  it('closed_RestingSession_EndsTheOwnedSessionAtOnce', async () => {
    const test = await started();
    test.process.events.ended({ code: 0, error: null });
    const callsBefore = test.process.calls.length;

    test.chat.closed(ROW_ID);

    expect(test.ownedEnds()).toBe(1);
    expect(test.chat.sessions()).toEqual([]);
    expect(test.process.calls).toHaveLength(callsBefore);
    expect(test.logged).toContainEqual(expect.stringContaining(ROW_ID));
  });

  it('restingSession_ProcessCallsIgnoredAndNoticesKept', async () => {
    const test = await started();
    test.process.events.ended({ code: 0, error: null });
    const entriesBefore = test.chat.sessions()[0].entries.length;

    test.chat.interrupt(ROW_ID);
    test.chat.answerPermission(ROW_ID, 'permission-1', {
      allowed: true,
      reason: null,
    });
    test.chat.notice(ROW_ID, 'note', 'info');

    expect(() => test.chat.setControl(ROW_ID, 'mode', 'plan')).toThrow(ROW_ID);
    expect(test.process.calls).toEqual([]);
    expect(test.chat.sessions()[0].entries).toHaveLength(entriesBefore + 1);
  });

  it('closed_endsTheProcessThenTheOwnedSession', async () => {
    const test = await started();
    test.harness.holdEnd();

    test.chat.closed(ROW_ID);
    test.process.events.entry(assistant('late', 'z'));

    expect(test.chat.sessions()).toEqual([]);
    expect(test.process.calls).toContainEqual({ method: 'end' });
    await flush();
    expect(test.ownedEnds()).toBe(0);
    test.harness.releaseEnd();
    await flush();
    expect(test.ownedEnds()).toBe(1);
    expect(test.sent('entry')).toEqual([]);
    expect(test.sent('sessionRested')).toEqual([]);
    expect(test.logged).toContainEqual(expect.stringContaining(ROW_ID));
  });

  it('detachAll_DetachesHeldProcesses_KillsAClosedRowsStillEnding', async () => {
    const test = await started();
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'work' });
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'work' });
    await flush();
    const [heldProcess, closedProcess, exitedProcess] = test.harness.processes;
    exitedProcess.events.ended({ code: 0, error: null });
    test.harness.holdEnd();
    test.chat.closed('row-2');

    test.chat.detachAll();
    const emittedBefore = test.emitted.length;
    closedProcess.events.agentEvent({ type: 'sessionEnded', at: 1000 });

    expect(heldProcess.calls).toEqual([{ method: 'detach' }]);
    expect(closedProcess.calls).toEqual([
      { method: 'end' },
      { method: 'kill' },
    ]);
    expect(exitedProcess.calls).toEqual([]);
    expect(test.emitted.length).toBe(emittedBefore);
  });

  it('lateEventsFromAnEarlierProcess_LeaveTheNewerOneRunning', async () => {
    const test = await started();
    const earlier = test.process.events;
    earlier.ended({ code: 0, error: null });
    test.chat.send(ROW_ID, { text: 'again', images: [] });
    await flush();
    const later = test.harness.processes[1];
    const entriesBefore = test.chat.sessions()[0].entries;

    earlier.entry(assistant('late', 'stale'));
    earlier.ended({ code: 1, error: 'late' });
    test.chat.detachAll();

    expect(test.chat.sessions()[0].running).toBe(true);
    expect(test.chat.sessions()[0].entries).toEqual(entriesBefore);
    expect(test.sent('sessionRested')).toHaveLength(1);
    expect(later.calls).toContainEqual({ method: 'detach' });
  });

  it('closed_processExitsWithAnError_endsTheOwnedSessionAndReportsNoEnd', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const failingExit: FakeAgentHarness = {
      ...fake,
      start: (request, events) => ({
        ...fake.start(request, events),
        end: () => {
          events.ended({ code: 1, error: 'stdin closed early' });
          return Promise.resolve();
        },
      }),
    };
    const test = setUp({ harnesses: [failingExit] });
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();

    test.chat.closed(ROW_ID);
    await flush();

    expect(test.ownedEnds()).toBe(1);
    expect(test.sent('sessionRested')).toEqual([]);
    expect(test.chat.sessions()).toEqual([]);
  });

  it('closed_processEndRejects_logsAndEndsTheOwnedSession', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const failingEnd: FakeAgentHarness = {
      ...fake,
      start: (request, events) => ({
        ...fake.start(request, events),
        end: () => Promise.reject(new Error('kill failed')),
      }),
    };
    const test = setUp({ harnesses: [failingEnd] });
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();

    test.chat.closed(ROW_ID);
    await flush();

    expect(test.logged).toContainEqual(
      expect.stringMatching(new RegExp(`${ROW_ID}.*kill failed`)),
    );
    expect(test.ownedEnds()).toBe(1);
    expect(test.chat.sessions()).toEqual([]);
  });

  it('closed_notOwned_doesNothing', async () => {
    const test = await started();
    const sentBefore = test.messages.length;

    test.chat.closed('row-x');
    await flush();

    expect(test.process.calls).toEqual([]);
    expect(test.messages).toHaveLength(sentBefore);
  });

  it.each([
    { text: 'hi', images: [], imageCount: 0 },
    {
      text: 'look',
      images: [
        { mediaType: 'image/png', data: 'iVBORw0K' },
        { mediaType: 'image/jpeg', data: '/9j/4AAQ' },
      ],
      imageCount: 2,
    },
  ])(
    'process calls pass through, sending $imageCount images',
    async ({ text, images, imageCount }) => {
      const test = await started();

      test.chat.send(ROW_ID, { text, images });
      test.chat.interrupt(ROW_ID);
      test.chat.setControl(ROW_ID, 'mode', 'plan');

      expect(test.process.calls).toEqual([
        { method: 'send', text, imageCount },
        { method: 'interrupt' },
        { method: 'setControl', id: 'mode', value: 'plan' },
      ]);
    },
  );

  it('send_TurnRunning_QueuesWithoutWriting', async () => {
    const test = await started();

    const [first, second] = queueTwo(test);

    const queued = [
      expect.objectContaining(first),
      expect.objectContaining(second),
    ];
    expect(test.process.calls).toEqual([]);
    expect(test.sent('queued').at(-1)).toEqual({ sessionId: ROW_ID, queued });
    expect(test.chat.sessions()[0].queued).toEqual(queued);
  });

  it('send_HarnessIdleWithPermissionWaiting_WritesAtOnce', async () => {
    const test = await started();
    void test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: null,
        signal: signal().signal,
      });
    const message: UserMessage = { text: 'go on', images: [] };

    test.chat.send(ROW_ID, message);

    expect(test.chat.sessions()[0].activity).toBe('waiting');
    expect(test.process.calls).toEqual([sendCall(message)]);
    expect(test.sent('queued')).toEqual([]);
  });

  it('activityIdle_Queued_WritesOneEachIdleAndAlertsAfterTheLast', async () => {
    const test = await started();
    test.setFocused(false);
    const [first, second] = queueTwo(test);

    test.activity('idle');

    expect(test.process.calls).toEqual([sendCall(first)]);
    expect(test.sent('queued').at(-1)).toEqual({
      sessionId: ROW_ID,
      queued: [expect.objectContaining(second)],
    });

    test.activity('idle');

    expect(test.process.calls).toEqual([sendCall(first), sendCall(second)]);
    expect(test.sent('activity')).toEqual([
      { sessionId: ROW_ID, activity: 'working' },
    ]);
    expect(test.announced).toEqual([]);

    test.activity('idle');

    expect(test.sent('activity').at(-1)).toEqual({
      sessionId: ROW_ID,
      activity: 'idle',
    });
    expect(test.announced).toHaveLength(1);
  });

  it('pullBack_QueuedReturnsItAloneAndSentIsIgnored', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);
    const [firstId, secondId] = test.chat
      .sessions()[0]
      .queued.map((queued) => queued.id);

    test.chat.pullBack(ROW_ID, secondId);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [second] },
    ]);
    expect(test.sent('queued').at(-1)).toEqual({
      sessionId: ROW_ID,
      queued: [{ ...first, id: firstId, sentEntryId: null, holdReason: null }],
    });

    test.activity('idle');
    const sentBefore = test.messages.length;
    test.chat.pullBack(ROW_ID, firstId);

    expect(test.messages).toHaveLength(sentBefore);
    expect(test.logged).toContain(`queued message ${firstId} no longer queued`);
  });

  it('interrupt_Queued_ReturnsAllThenInterrupts', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);

    test.chat.interrupt(ROW_ID);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [first, second] },
    ]);
    expect(test.sent('queued').at(-1)).toEqual({
      sessionId: ROW_ID,
      queued: [],
    });
    expect(test.process.calls).toEqual([{ method: 'interrupt' }]);
  });

  it.each([
    { order: 'ended alone', idleFirst: false },
    { order: 'idle after the process closed, then ended', idleFirst: true },
  ])(
    'processExit_Queued_ReturnsAllBeforeResting ($order)',
    async ({ idleFirst }) => {
      const test = await started();
      const [first, second] = queueTwo(test);

      if (idleFirst) {
        test.process.ended = true;
        test.activity('idle');
      }
      test.process.events.ended({ code: 0, error: null });

      expect(test.sentReturned()).toEqual([
        { sessionId: ROW_ID, messages: [first, second] },
      ]);
      const kinds = test.messages.map((sent) => sent.message);
      expect(kinds.indexOf('returned')).toBeLessThan(
        kinds.indexOf('sessionRested'),
      );
      expect(test.chat.sessions()[0].queued).toEqual([]);
      const again = { text: 'again', images: [] };
      await test.chat.send(ROW_ID, again);
      expect(test.harness.processes[1].calls).toEqual([sendCall(again)]);
    },
  );

  it('sendNow_NewerOfTwoRows_WritesItAndKeepsItMarkedSent', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);

    test.chat.sendNow(ROW_ID, 'queued-2');

    const queued = [
      { ...first, id: 'queued-1', sentEntryId: null, holdReason: null },
      {
        ...second,
        id: 'queued-2',
        sentEntryId: expect.any(String),
        holdReason: null,
      },
    ];
    expect(test.process.calls).toEqual([sendCall(second)]);
    expect(test.chat.sessions()[0].queued).toEqual(queued);
    expect(test.sent('queued').at(-1)).toEqual({ sessionId: ROW_ID, queued });
  });

  it.each([
    {
      case: 'an unknown id',
      queuedId: 'queued-9',
      arrange: () => {},
      reason: 'no longer queued',
    },
    {
      case: 'a row already sent now',
      queuedId: 'queued-1',
      arrange: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.sendNow(ROW_ID, 'queued-1'),
      reason: 'already sent',
    },
    {
      case: 'a row already written at an idle',
      queuedId: 'queued-1',
      arrange: (test: Awaited<ReturnType<typeof started>>) =>
        test.activity('idle'),
      reason: 'no longer queued',
    },
  ])('sendNow_NotQueued_LogsAndWritesNothing: $case', async (row) => {
    const test = await started();
    queueTwo(test);
    row.arrange(test);
    const callsBefore = test.process.calls.length;
    const sentBefore = test.messages.length;

    test.chat.sendNow(ROW_ID, row.queuedId);

    expect(test.process.calls).toHaveLength(callsBefore);
    expect(test.messages).toHaveLength(sentBefore);
    expect(test.logged).toContain(
      `queued message ${row.queuedId} ${row.reason}`,
    );
  });

  it('sendNow_WriteThrows_RowStaysUnsent', async () => {
    const test = await started();
    queueTwo(test);
    test.process.ended = true;

    test.chat.sendNow(ROW_ID, 'queued-1');

    expect(
      test.chat.sessions()[0].queued.map((row) => row.sentEntryId),
    ).toEqual([null, null]);
    expect(test.logged).toContainEqual(
      expect.stringMatching(/queued message queued-1 not sent: .*ended/),
    );
  });

  it('entry_OfASentRow_DropsTheRowAndReturnsNothing', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);
    test.chat.sendNow(ROW_ID, 'queued-2');
    const entryId = sentEntryIdOf(test, 1);
    const queuedBefore = test.sent('queued').length;

    test.process.events.entry(userEntry(entryId, second.text));

    expect(test.sent('queued').slice(queuedBefore)).toEqual([
      {
        sessionId: ROW_ID,
        queued: [
          { ...first, id: 'queued-1', sentEntryId: null, holdReason: null },
        ],
      },
    ]);
    expect(test.sentReturned()).toEqual([]);
  });

  it.each([
    {
      case: 'a sent row',
      arrange: (test: Awaited<ReturnType<typeof started>>) => {
        const [first, second] = queueTwo(test);
        test.chat.sendNow(ROW_ID, 'queued-2');
        return {
          entryId: sentEntryIdOf(test, 1),
          message: second,
          sends: [
            {
              message: 'queued',
              data: {
                sessionId: ROW_ID,
                queued: [
                  {
                    ...first,
                    id: 'queued-1',
                    sentEntryId: null,
                    holdReason: null,
                  },
                ],
              },
            },
            {
              message: 'returned',
              data: {
                sessionId: ROW_ID,
                messages: [{ ...second, id: 'returned-1' }],
              },
            },
          ],
          log: `sent message ${sentEntryIdOf(test, 1)} returned: never taken in`,
        };
      },
    },
    {
      case: 'an idle send',
      arrange: (test: Awaited<ReturnType<typeof started>>) => {
        const message: UserMessage = { text: 'idle send', images: [] };
        test.chat.send(ROW_ID, message);
        return {
          entryId: 'user-1',
          message,
          sends: [
            {
              message: 'returned',
              data: {
                sessionId: ROW_ID,
                messages: [{ ...message, id: 'returned-1' }],
              },
            },
          ],
          log: 'sent message user-1 returned: never taken in',
        };
      },
    },
    {
      case: 'one written before a relaunch, which chat holds nothing for',
      arrange: () => {
        const message: UserMessage = { text: 'before the quit', images: [] };
        return {
          entryId: 'user-9',
          message,
          sends: [
            {
              message: 'returned',
              data: {
                sessionId: ROW_ID,
                messages: [{ ...message, id: 'returned-1' }],
              },
            },
          ],
          log: 'sent message user-9 returned: never taken in',
        };
      },
    },
  ])('messageDropped_ReturnsTheMessage: $case', async (row) => {
    const test = await started();
    const { entryId, message, sends, log } = row.arrange(test);
    const sentBefore = test.messages.length;

    test.process.events.messageDropped(entryId, message);

    expect(test.messages.slice(sentBefore)).toEqual(sends);
    expect(test.logged).toContain(log);
  });

  it('pullBack_SentRow_LogsAndSendsNothing', async () => {
    const test = await started();
    queueTwo(test);
    test.chat.sendNow(ROW_ID, 'queued-1');
    const sentBefore = test.messages.length;

    test.chat.pullBack(ROW_ID, 'queued-1');

    expect(test.messages).toHaveLength(sentBefore);
    expect(test.logged).toContain('queued message queued-1 already sent');
  });

  it('interrupt_SentAndUnsentRows_ReturnsOnlyTheUnsent', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);
    test.chat.sendNow(ROW_ID, 'queued-1');

    test.chat.interrupt(ROW_ID);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [second] },
    ]);
    expect(test.chat.sessions()[0].queued).toEqual([
      {
        ...first,
        id: 'queued-1',
        sentEntryId: expect.any(String),
        holdReason: null,
      },
    ]);
  });

  it.each([
    { outcome: 'the write lands', writeRow: true },
    { outcome: 'the write throws', writeRow: false },
  ])(
    'activityIdle_SentRowAhead_WritesTheNextUnsent ($outcome)',
    async ({ writeRow }) => {
      const test = await started();
      const [first, second] = queueTwo(test);
      test.chat.sendNow(ROW_ID, 'queued-1');
      if (!writeRow) {
        test.process.ended = true;
      }

      test.activity('idle');

      expect(test.process.calls).toEqual([sendCall(first), sendCall(second)]);
      const sentRow = {
        ...first,
        id: 'queued-1',
        sentEntryId: expect.any(String),
        holdReason: null,
      };
      const unsentRow = {
        ...second,
        id: 'queued-2',
        sentEntryId: null,
        holdReason: null,
      };
      expect(test.chat.sessions()[0].queued).toEqual(
        writeRow ? [sentRow] : [sentRow, unsentRow],
      );
    },
  );

  it.each([
    {
      given: 'an idle send, then a sent row',
      hold: (test: Awaited<ReturnType<typeof started>>) => {
        test.chat.send(ROW_ID, IDLE_SEND);
        test.activity('working');
        test.chat.send(ROW_ID, PENDING);
        test.chat.sendNow(ROW_ID, 'queued-1');
        return [IDLE_SEND, PENDING];
      },
    },
    {
      given: 'an idle send and an empty queue',
      hold: (test: Awaited<ReturnType<typeof started>>) => {
        test.chat.send(ROW_ID, IDLE_SEND);
        return [IDLE_SEND];
      },
    },
    {
      given: 'a sent row older than the row the idle wrote',
      hold: (test: Awaited<ReturnType<typeof started>>) => {
        const [first, second] = queueTwo(test);
        test.chat.sendNow(ROW_ID, 'queued-1');
        test.activity('idle');
        return [first, second];
      },
    },
  ])(
    'processExit_WrittenMessagesAndRows_ReturnedInWriteOrder ($given)',
    async ({ hold }) => {
      const test = await started();
      const held = hold(test);

      test.process.events.ended({ code: 0, error: null });

      expect(test.sentReturned()).toEqual([
        { sessionId: ROW_ID, messages: held },
      ]);
      expect(test.chat.sessions()[0].queued).toEqual([]);
    },
  );

  it.each([
    {
      case: 'at an idle with a message',
      running: false,
      rows: [],
      box: true,
      written: ['box'],
      queuedRows: [],
      queuedSends: 0,
      log: null,
    },
    {
      case: 'mid-turn with two rows and a message',
      running: true,
      rows: ['first', 'second'],
      box: true,
      written: ['first', 'second', 'box'],
      queuedRows: [
        ['first', true],
        ['second', true],
        ['box', true],
      ],
      queuedSends: 1,
      log: null,
    },
    {
      case: 'mid-turn with a null message',
      running: true,
      rows: ['first', 'second'],
      box: false,
      written: ['first', 'second'],
      queuedRows: [
        ['first', true],
        ['second', true],
      ],
      queuedSends: 1,
      log: null,
    },
    {
      case: 'mid-turn with nothing unsent and a null message',
      running: true,
      rows: [],
      box: false,
      written: [],
      queuedRows: [],
      queuedSends: 0,
      log: /nothing to send now in row-1/,
    },
    {
      case: 'mid-turn with the second write throwing',
      running: true,
      rows: ['first', REFUSED_TEXT],
      box: true,
      written: ['first'],
      queuedRows: [
        ['first', true],
        [REFUSED_TEXT, false],
        ['box', false],
      ],
      queuedSends: 1,
      log: /queued message queued-2 not sent: write refused/,
    },
  ])('sendAllNow_WritesInTheOrderWritten: $case', async (row) => {
    const test = await startedRefusing();
    if (row.running) {
      test.activity('working');
    }
    for (const text of row.rows) {
      test.chat.send(ROW_ID, { text, images: [] });
    }
    const queuedBefore = test.sent('queued').length;
    const box: UserMessage | null = row.box
      ? { text: 'box', images: [] }
      : null;

    void test.chat.sendAllNow(ROW_ID, box);

    const written = test.process.calls.flatMap((call) =>
      call.method === 'send' ? [call.text] : [],
    );
    const queuedRows = test.chat
      .sessions()[0]
      .queued.map((queued) => [queued.text, queued.sentEntryId !== null]);
    expect(written).toEqual(row.written);
    expect(queuedRows).toEqual(row.queuedRows);
    expect(test.sent('queued').length - queuedBefore).toBe(row.queuedSends);
    if (row.log !== null) {
      expect(test.logged).toContainEqual(expect.stringMatching(row.log));
    }
  });

  it('notice_AddsEntryKeptBySessions', async () => {
    const test = await started();

    test.chat.notice(ROW_ID, 'Signed out of work', 'info');
    test.chat.notice(ROW_ID, 'Status not read', 'error');

    const notices: ChatEntry[] = [
      {
        kind: 'notice',
        id: 'app-notice-1',
        at: 1000,
        text: 'Signed out of work',
        tone: 'info',
        raw: [],
      },
      {
        kind: 'notice',
        id: 'app-notice-2',
        at: 1000,
        text: 'Status not read',
        tone: 'error',
        raw: [],
      },
    ];
    expect(test.chat.sessions()[0].entries).toEqual(notices);
    expect(test.sent('entry')).toEqual(
      notices.map((entry) => ({ sessionId: ROW_ID, entry })),
    );
  });

  it('unknownSession_ignored', async () => {
    const test = await started();
    const sentBefore = test.messages.length;

    test.chat.send('row-x', { text: 'hi', images: [] });
    test.chat.notice('row-x', 'note', 'info');
    test.chat.interrupt('row-x');
    test.chat.answerPermission('row-x', 'permission-1', {
      allowed: true,
      reason: null,
    });

    expect(test.process.calls).toEqual([]);
    expect(test.messages).toHaveLength(sentBefore);
  });

  it('setControl_unknownSession_throwsAndSetsNothing', async () => {
    const test = await started();

    expect(() => test.chat.setControl('row-x', 'mode', 'plan')).toThrow(
      'row-x',
    );
    expect(test.process.calls).toEqual([]);
  });

  it('permission_callAddsAWaitingEntry', async () => {
    const test = await started();
    test.activity('working');
    const tools = test.chat.permissionToolSession(test.agentSession);

    const call = tools.call('permission_prompt', BASH_ARGS, {
      toolUseId: 'tu-1',
      signal: signal().signal,
    });

    expect(test.sent('entry')).toEqual([
      {
        sessionId: ROW_ID,
        entry: {
          kind: 'permission',
          id: 'permission-1',
          at: 1000,
          toolName: 'Bash',
          input: { command: 'ls' },
          answer: null,
          raw: [BASH_ARGS],
        },
      },
    ]);
    expect(test.sent('activity').at(-1)).toEqual({
      sessionId: ROW_ID,
      activity: 'waiting',
    });
    expect(await settled(call)).toBe('pending');
  });

  it('permission_allow_repliesWithTheInput', async () => {
    const test = await started();
    test.activity('working');
    const call = test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: 'tu-1',
        signal: signal().signal,
      });

    test.chat.answerPermission(ROW_ID, 'permission-1', {
      allowed: true,
      reason: null,
    });

    expect(replyText(await settled(call))).toBe(
      '{"behavior":"allow","updatedInput":{"command":"ls"}}',
    );
    expect(test.sent('entry').at(-1)?.entry).toMatchObject({
      id: 'permission-1',
      answer: { allowed: true, reason: null },
    });
    expect(test.sent('activity').at(-1)).toEqual({
      sessionId: ROW_ID,
      activity: 'working',
    });
  });

  it('permission_deny_defaultAndReason', async () => {
    const test = await started();
    const tools = test.chat.permissionToolSession(test.agentSession);
    const context = { toolUseId: null, signal: signal().signal };
    const plainDeny = tools.call('permission_prompt', BASH_ARGS, context);
    const reasonDeny = tools.call('permission_prompt', BASH_ARGS, context);

    test.chat.answerPermission(ROW_ID, 'permission-1', {
      allowed: false,
      reason: null,
    });
    test.chat.answerPermission(ROW_ID, 'permission-2', {
      allowed: false,
      reason: 'use rg',
    });

    expect(replyText(await settled(plainDeny))).toBe(
      '{"behavior":"deny","message":"The user denied this tool call."}',
    );
    expect(replyText(await settled(reasonDeny))).toBe(
      '{"behavior":"deny","message":"use rg"}',
    );
  });

  it('permission_twoPending_staysWaiting', async () => {
    const test = await started();
    const tools = test.chat.permissionToolSession(test.agentSession);
    const context = { toolUseId: null, signal: signal().signal };
    void tools.call('permission_prompt', BASH_ARGS, context);
    void tools.call('permission_prompt', BASH_ARGS, context);
    const activitiesBefore = test.sent('activity').length;

    test.chat.answerPermission(ROW_ID, 'permission-1', {
      allowed: true,
      reason: null,
    });

    expect(test.sent('activity')).toHaveLength(activitiesBefore);
    expect(test.chat.sessions()[0].activity).toBe('waiting');
  });

  it('permission_abort_answersDenied', async () => {
    const test = await started();
    const controller = signal();
    const call = test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: 'tu-1',
        signal: controller.signal,
      });

    controller.abort();

    expect(replyText(await settled(call))).toBe(
      JSON.stringify({ behavior: 'deny', message: CANCELLED_REASON }),
    );
    expect(test.sent('entry').at(-1)?.entry).toMatchObject({
      id: 'permission-1',
      answer: { allowed: false, reason: CANCELLED_REASON },
    });
  });

  it.each([
    { given: 'its turn running', harnessActivity: 'working' as const },
    { given: 'a card left after its turn', harnessActivity: 'idle' as const },
  ])(
    'permission_abortAfterDetachAll_AnswersTheCallAndChangesNothing given $given',
    async ({ harnessActivity }) => {
      const test = setUp();
      test.chat.restore(NOTHING_SAVED, []);
      test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
      await flush();
      test.setFocused(false);
      const { events } = test.harness.processes[0];
      events.activity('working');
      const controller = signal();
      const call = test.chat
        .permissionToolSession(test.agentSession)
        .call('permission_prompt', BASH_ARGS, {
          toolUseId: 'tu-1',
          signal: controller.signal,
        });
      await flush();
      events.activity(harnessActivity);
      test.chat.detachAll();
      const savesBefore = test.saved.saves();
      const messagesBefore = test.messages.length;

      controller.abort();

      expect(replyText(await settled(call))).toBe(
        JSON.stringify({ behavior: 'deny', message: CANCELLED_REASON }),
      );
      expect(test.saved.saves()).toBe(savesBefore);
      expect(test.saved.last()?.sessions[0].busy).toBe(true);
      expect(test.messages).toHaveLength(messagesBefore);
      expect(test.announced).toEqual([]);
      expect(test.marked).toEqual([]);
    },
  );

  it('permission_sessionEnds_answersCancelledAndShowsIt', async () => {
    const test = await started();
    const call = test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: 'tu-1',
        signal: signal().signal,
      });

    test.process.events.ended({ code: 0, error: null });

    expect(replyText(await settled(call))).toBe(
      JSON.stringify({ behavior: 'deny', message: CANCELLED_REASON }),
    );
    expect(test.chat.sessions()[0].entries).toContainEqual(
      expect.objectContaining({
        id: 'permission-1',
        answer: { allowed: false, reason: CANCELLED_REASON },
      }),
    );
  });

  it('permission_restingSession_answersCancelledWithNoEntry', async () => {
    const test = await started();
    test.process.events.ended({ code: 0, error: null });
    const entriesBefore = test.sent('entry').length;

    const result = await test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: 'tu-1',
        signal: signal().signal,
      });

    expect(replyText(result)).toBe(
      JSON.stringify({ behavior: 'deny', message: CANCELLED_REASON }),
    );
    expect(test.sent('entry')).toHaveLength(entriesBefore);
  });

  it('permission_rowCloses_answersCancelledWithNoEntry', async () => {
    const test = await started();
    const call = test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: 'tu-1',
        signal: signal().signal,
      });
    const entriesBefore = test.sent('entry').length;

    test.chat.closed(ROW_ID);

    expect(replyText(await settled(call))).toBe(
      JSON.stringify({ behavior: 'deny', message: CANCELLED_REASON }),
    );
    expect(test.sent('entry')).toHaveLength(entriesBefore);
  });

  it('permission_alreadyAborted_noEntry', async () => {
    const test = await started();
    const controller = signal();
    controller.abort();

    const result = await test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: 'tu-1',
        signal: controller.signal,
      });

    expect(replyText(result)).toBe(
      JSON.stringify({ behavior: 'deny', message: CANCELLED_REASON }),
    );
    expect(test.sent('entry')).toEqual([]);
  });

  it('permission_unownedSession_errorResult', async () => {
    const test = await started();

    const result = await test.chat
      .permissionToolSession({ ...test.agentSession, id: 'row-relay' })
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: null,
        signal: signal().signal,
      });

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'permission_prompt answers only for sessions the wigley-ai-gui app started.',
        },
      ],
      isError: true,
    });
  });

  it('permission_toolSessionBeforeStart_reachesFlowAfterStart', async () => {
    const test = setUp();
    const tools = test.chat.permissionToolSession(test.agentSession);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'work' });
    await flush();

    const call = tools.call('permission_prompt', BASH_ARGS, {
      toolUseId: 'tu-1',
      signal: signal().signal,
    });

    expect(test.sent('entry')).toHaveLength(1);
    expect(await settled(call)).toBe('pending');
  });

  it('permission_badArgs_errorResult', async () => {
    const test = await started();

    const result = await test.chat
      .permissionToolSession(test.agentSession)
      .call(
        'permission_prompt',
        { tool_name: 7, input: {} },
        { toolUseId: null, signal: signal().signal },
      );

    expect(result).toEqual({
      content: [
        { type: 'text', text: 'permission_prompt: tool_name must be a string' },
      ],
      isError: true,
    });
    expect(test.sent('entry')).toEqual([]);
  });

  it('permission_unknownEntry_ignored', async () => {
    const test = await started();
    const call = test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: 'tu-1',
        signal: signal().signal,
      });

    test.chat.answerPermission(ROW_ID, 'permission-9', {
      allowed: true,
      reason: null,
    });

    expect(await settled(call)).toBe('pending');
  });
});

describe('createChatSessions saved sessions', () => {
  it('restore_SavedSnapshot_OpensRestingRowsInOrder', () => {
    const test = setUp();

    test.chat.restore(
      {
        sessions: [record('host-a'), record('host-b'), record('host-c')],
        selectedHostSessionId: 'host-b',
      },
      [],
    );

    expect(test.opened.map((info) => info.sessionId)).toEqual([
      'host-a',
      'host-b',
      'host-c',
    ]);
    expect(test.openOptions).toEqual([
      { select: false },
      { select: false },
      { select: false },
    ]);
    expect(test.activated).toEqual(['row-2']);
    expect(test.chat.sessions().map((state) => state.running)).toEqual([
      false,
      false,
      false,
    ]);
    expect(test.harness.processes).toEqual([]);
    expect(test.harness.pastSessionCalls).toEqual([]);
  });

  it.each([
    {
      given: 'a host id chat holds',
      arrange: (test: ReturnType<typeof setUp>) =>
        test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' }),
      saved: ['host-a', 'uuid-1', 'host-b'],
      opened: ['uuid-1', 'host-a', 'host-b'],
      logged: 'session uuid-1 already open; not restored',
    },
    {
      given: 'a host id open on a relay row',
      arrange: (test: ReturnType<typeof setUp>) =>
        test.chat.sessionConnected(connected('row-relay', 'host-r')),
      saved: ['host-a', 'host-r', 'host-b'],
      opened: ['host-a', 'host-b'],
      logged: 'session host-r already open; not restored',
    },
    {
      given: 'an open that throws',
      arrange: (test: ReturnType<typeof setUp>) => test.refuseOpen('host-x'),
      saved: ['host-a', 'host-x', 'host-b'],
      opened: ['host-a', 'host-b'],
      logged: 'session host-x not restored: open of host-x refused',
    },
    {
      given: 'a restore after detachAll',
      arrange: (test: ReturnType<typeof setUp>) => test.chat.detachAll(),
      saved: ['host-a', 'host-b'],
      opened: [],
      logged: 'open sessions not restored: chat is stopping',
    },
  ])(
    'restore_RecordNotOpenable_SkippedAndLogged given $given',
    ({ arrange, saved, opened, logged }) => {
      const test = setUp();
      arrange(test);

      test.chat.restore(
        {
          sessions: saved.map((hostId) => record(hostId)),
          selectedHostSessionId: null,
        },
        [],
      );

      expect(test.opened.map((info) => info.sessionId)).toEqual(opened);
      expect(test.logged).toContain(logged);
    },
  );

  it.each([
    {
      given: 'a turn running at quit',
      saved: record('host-a', { busy: true }),
      entries: [{ kind: 'notice', tone: 'info' }],
    },
    {
      given: 'a profile missing from settings',
      saved: record('host-a', { profile: 'gone' }),
      entries: [
        {
          kind: 'notice',
          tone: 'error',
          text: expect.stringContaining('gone'),
        },
      ],
    },
    { given: 'neither', saved: record('host-a'), entries: [] },
  ])('restore_RecordFlags_AddNotices given $given', ({ saved, entries }) => {
    const test = setUp();

    test.chat.restore({ sessions: [saved], selectedHostSessionId: null }, []);

    expect(test.chat.sessions()[0].entries).toEqual(
      entries.map((entry) => expect.objectContaining(entry)),
    );
  });

  it.each([
    {
      given: 'a sent session with saved usage',
      sent: true,
      profile: 'work',
      saved: fakeUsageEvent(2, 1500),
      calls: ['host-a'],
      emitted: [
        {
          sessionId: ROW_ID,
          profileDir: '~/.claude',
          hostSessionId: 'host-a',
          event: fakeUsageEvent(2, 1500),
          replayed: false,
        },
      ],
    },
    {
      given: 'a sent session with none saved',
      sent: true,
      profile: 'work',
      saved: null,
      calls: ['host-a'],
      emitted: [],
    },
    {
      given: 'an unsent session',
      sent: false,
      profile: 'work',
      saved: fakeUsageEvent(2, 1500),
      calls: [],
      emitted: [],
    },
    {
      given: 'a sent session whose profile is missing',
      sent: true,
      profile: 'gone',
      saved: fakeUsageEvent(2, 1500),
      calls: [],
      emitted: [],
    },
  ])(
    'restore_SavedUsage_EmitsItAsTheRowsAgentEvent given $given',
    async ({ sent, profile, saved, calls, emitted }) => {
      const test = setUp();
      test.harness.setLastUsage('host-a', saved);

      test.chat.restore(
        {
          sessions: [record('host-a', { sent, profile })],
          selectedHostSessionId: null,
        },
        [],
      );
      await flush();

      expect(test.harness.lastUsageCalls).toEqual(calls);
      expect(usageEmitted(test.emitted)).toEqual(emitted);
    },
  );

  it.each([
    {
      given: 'the row closed',
      act: (test: ReturnType<typeof setUp>) => test.chat.closed(ROW_ID),
    },
    {
      given: 'the row cleared',
      act: (test: ReturnType<typeof setUp>) => test.chat.clear(ROW_ID),
    },
    {
      given: 'chat stopped',
      act: (test: ReturnType<typeof setUp>) => test.chat.detachAll(),
    },
  ])(
    'restore_SavedUsageReadAfterRowGone_EmitsNothing given $given',
    async ({ act }) => {
      const test = setUp();
      test.harness.setLastUsage('host-a', fakeUsageEvent(2, 1500));
      const release = test.harness.holdNextLastUsage();
      test.chat.restore(
        {
          sessions: [record('host-a', { sent: true })],
          selectedHostSessionId: null,
        },
        [],
      );

      act(test);
      release();
      await flush();

      expect(test.harness.lastUsageCalls).toEqual(['host-a']);
      expect(usageEmitted(test.emitted)).toEqual([]);
    },
  );

  it('restore_SavedUsageReadFails_LogsAndEmitsNothing', async () => {
    const test = setUp();
    test.harness.setLastUsage('host-a', fakeUsageEvent(2, 1500));
    test.harness.failNextLastUsage('transcript unreadable');

    test.chat.restore(
      {
        sessions: [record('host-a', { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );
    await flush();

    expect(test.logged).toContain(
      'saved usage of host-a not read: transcript unreadable',
    );
    expect(usageEmitted(test.emitted)).toEqual([]);
  });

  it.each([{ sent: true }, { sent: false }])(
    'send_RestingRow_StartsProcessWithResumeFromSent (sent $sent)',
    async ({ sent }) => {
      const test = setUp();
      const hostId = PAST_ONE.sessionId;
      test.chat.restore(
        {
          sessions: [record(hostId, { sent, busy: true })],
          selectedHostSessionId: null,
        },
        [],
      );
      expect(test.harness.processes).toEqual([]);

      await test.chat.send(ROW_ID, { text: 'hi', images: [] });

      expect(test.harness.processes.map((process) => process.request)).toEqual([
        {
          processId: `${hostId}-1-1000`,
          sessionId: hostId,
          resume: sent,
          projectDir: '/w/app',
          profileDir: '~/.claude',
          controls: {},
          instructions: [],
          idleCompactMinTokens: null,
          rowId: ROW_ID,
        },
      ]);
      expect(test.sent('sessionRunning')).toEqual([{ sessionId: ROW_ID }]);
      expect(test.harness.processes[0].calls).toEqual([
        { method: 'send', text: 'hi', imageCount: 0 },
      ]);
      expect(test.logged).toContain(
        `session ${ROW_ID} process started (resume ${sent})`,
      );
    },
  );

  it.each([
    {
      given: 'a new session then a send',
      act: (chat: ChatSessions) => {
        chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
        chat.send(ROW_ID, { text: 'hi', images: [] });
      },
      sent: true,
    },
    {
      given: 'a launch',
      act: (chat: ChatSessions) =>
        chat.launch({
          projectDir: PROJECT_DIR,
          profile: 'personal',
          message: { text: 'hi', images: [] },
        }),
      sent: true,
    },
    {
      given: 'a new session with no send',
      act: (chat: ChatSessions) =>
        chat.start({ projectDir: PROJECT_DIR, profile: 'personal' }),
      sent: false,
    },
  ])('send_NewSession_SavesSentTrue given $given', async ({ act, sent }) => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);

    act(test.chat);
    await flush();

    expect(test.saved.last()?.sessions).toEqual([
      {
        hostSessionId: 'uuid-1',
        projectDir: PROJECT_DIR,
        profile: 'personal',
        sent,
        busy: false,
        titles: { ...NO_TITLES, firstMessage: sent ? 'hi' : null },
        processId: 'uuid-1-1-1000',
        queued: [],
        returned: [],
        launchControls: {},
        launchResume: false,
        controls: test.chat.sessions()[0].controls,
        confirmedPicks: {},
        returnedDrops: [],
        activeMs: 0,
      },
    ]);
  });

  it('save_BeforeRestore_WritesNothing', async () => {
    const test = setUp();
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    test.chat.send(ROW_ID, { text: 'hi', images: [] });
    await flush();
    expect(test.saved.saves()).toBe(0);

    test.chat.restore(
      {
        sessions: [record('host-a')],
        selectedHostSessionId: null,
      },
      [],
    );

    expect(
      test.saved.last()?.sessions.map((saved) => saved.hostSessionId),
    ).toEqual(['uuid-1', 'host-a']);
  });

  it.each([
    {
      given: 'a missing profile',
      saved: record('host-a', { profile: 'gone', sent: true }),
      startFailure: null,
      error: 'gone',
    },
    {
      given: 'a harness start that throws',
      saved: record('host-a', { sent: true }),
      startFailure: 'spawn failed',
      error: 'spawn failed',
    },
  ])(
    'send_RestingRowThatCannotStart_RejectsAndStaysResting given $given',
    async ({ saved, startFailure, error }) => {
      const test = setUp();
      test.chat.restore({ sessions: [saved], selectedHostSessionId: null }, []);
      if (startFailure !== null) {
        test.harness.failNextStart(startFailure);
      }

      await expect(
        test.chat.send(ROW_ID, { text: 'hi', images: [] }),
      ).rejects.toThrow(error);
      expect(test.harness.processes).toEqual([]);
      expect(test.chat.sessions()[0].running).toBe(false);
      expect(test.sent('sessionRested')).toEqual([]);
    },
  );

  it.each([
    {
      given: 'a resting row',
      open: (chat: ChatSessions) =>
        chat.restore(
          {
            sessions: [record('host-a')],
            selectedHostSessionId: null,
          },
          [],
        ),
    },
    {
      given: 'a running row',
      open: (chat: ChatSessions) => {
        chat.restore(NOTHING_SAVED, []);
        chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
      },
    },
  ])('closed_Row_DropsItsRecord given $given', async ({ open }) => {
    const test = setUp();
    open(test.chat);
    await flush();
    expect(test.saved.last()?.sessions).toHaveLength(1);

    test.chat.closed(ROW_ID);

    expect(test.saved.last()?.sessions).toEqual([]);
  });

  it('detachAll_ThenExits_SavesNothingAndSendsNothing', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    const { events } = test.harness.processes[0];
    events.activity('working');
    await test.chat.send(ROW_ID, { text: 'a', images: [] });
    const messagesBefore = test.messages.length;

    test.chat.detachAll();
    const savesBefore = test.saved.saves();
    events.activity('idle');
    events.ended({ code: 0, error: null });
    await flush();

    expect(test.saved.saves()).toBe(savesBefore);
    expect(test.messages.length).toBe(messagesBefore);
    expect(test.saved.last()?.sessions[0].busy).toBe(true);
    expect(test.saved.last()?.sessions[0].queued).toEqual([
      { text: 'a', images: [] },
    ]);
  });

  it('activity_IdleFlip_SavesBusy', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    const { events } = test.harness.processes[0];

    events.activity('working');
    const busyWhileWorking = test.saved.last()?.sessions[0].busy;
    events.activity('idle');

    expect(busyWhileWorking).toBe(true);
    expect(test.saved.last()?.sessions[0].busy).toBe(false);
  });

  it.each([
    {
      given: 'a resting row',
      hosted: [],
      fields: {},
      before: null,
      ids: [
        `history:${PAST_ONE.sessionId}-user`,
        `history:${PAST_ONE.sessionId}-assistant`,
        'app-notice-1',
      ],
    },
    {
      given: 'an attached row',
      hosted: [{ id: 'p1', startedAt: 5000, running: true, current: true }],
      fields: { processId: 'p1' },
      before: 5000,
      ids: [],
    },
  ])(
    'loadHistory_PendingRow_PrependsOnce given $given',
    async ({ hosted, fields, before, ids }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay() {},
      });
      const hostId = PAST_ONE.sessionId;
      test.chat.restore(
        {
          sessions: [record(hostId, { sent: true, busy: true, ...fields })],
          selectedHostSessionId: null,
        },
        hosted,
      );
      await flush();

      await test.chat.loadHistory(ROW_ID);
      await test.chat.loadHistory(ROW_ID);

      expect(test.chat.sessions()[0].entries.map((entry) => entry.id)).toEqual(
        ids,
      );
      expect(
        test
          .sent('entries')
          .map(({ sessionId, entries }) => [
            sessionId,
            entries.map((entry) => entry.id),
          ]),
      ).toEqual([[ROW_ID, ids]]);
      expect(
        test.harness.pastSessionCalls
          .filter((call) => call.method === 'history')
          .map((call) => call.before),
      ).toEqual([before]);
    },
  );

  it.each([
    {
      given: 'a row never sent to',
      saved: record(PAST_ONE.sessionId),
      arrange: () => {},
      historyCalls: 0,
      entries: [],
    },
    {
      given: 'a failed read',
      saved: record(PAST_ONE.sessionId, { sent: true }),
      arrange: (test: ReturnType<typeof setUp>) =>
        test.harness.failNextHistory('disk gone'),
      historyCalls: 1,
      entries: [
        {
          sessionId: ROW_ID,
          entries: [
            expect.objectContaining({
              kind: 'notice',
              tone: 'error',
              text: 'Earlier conversation not read: disk gone',
            }),
          ],
        },
      ],
    },
  ])(
    'loadHistory_RowWithNothingToRead_SendsNoHistory given $given',
    async ({ saved, arrange, historyCalls, entries }) => {
      const test = setUp();
      test.chat.restore({ sessions: [saved], selectedHostSessionId: null }, []);
      arrange(test);

      await test.chat.loadHistory(ROW_ID);

      expect(
        test.harness.pastSessionCalls.filter(
          (call) => call.method === 'history',
        ),
      ).toHaveLength(historyCalls);
      expect(test.sent('entries')).toEqual(entries);
    },
  );

  it('loadHistory_ProfileMissing_ReadsOnceItIsBack', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record(PAST_ONE.sessionId, { sent: true, profile: 'gone' })],
        selectedHostSessionId: null,
      },
      [],
    );
    const historyCalls = () =>
      test.harness.pastSessionCalls.filter((call) => call.method === 'history');

    await test.chat.loadHistory(ROW_ID);
    const callsWhileMissing = historyCalls().length;
    test.setProfiles([
      ...DEFAULT_PROFILES,
      { name: 'gone', configDir: '/Users/u/.claude-gone' },
    ]);
    await test.chat.loadHistory(ROW_ID);

    expect(callsWhileMissing).toBe(0);
    expect(historyCalls()).toHaveLength(1);
    expect(
      test
        .sent('entries')
        .map(({ entries }) => entries.map((entry) => entry.id)),
    ).toEqual([
      [
        `history:${PAST_ONE.sessionId}-user`,
        `history:${PAST_ONE.sessionId}-assistant`,
        'app-notice-1',
      ],
    ]);
  });

  it.each([
    {
      given: 'a read that succeeds',
      historyFailure: null,
      historyIds: [
        `history:${PAST_ONE.sessionId}-user`,
        `history:${PAST_ONE.sessionId}-assistant`,
      ],
    },
    {
      given: 'a read that fails',
      historyFailure: 'disk gone',
      historyIds: ['history:unread'],
    },
  ])(
    'send_RowWithHistoryPending_ReadsItBeforeTheStart given $given',
    async ({ historyFailure, historyIds }) => {
      const test = setUp();
      test.chat.restore(
        {
          sessions: [record(PAST_ONE.sessionId, { sent: true })],
          selectedHostSessionId: null,
        },
        [],
      );
      if (historyFailure !== null) {
        test.harness.failNextHistory(historyFailure);
      }
      const historyCalls = () =>
        test.harness.pastSessionCalls.filter(
          (call) => call.method === 'history',
        );

      const sending = test.chat.send(ROW_ID, { text: 'hi', images: [] });
      const startsDuringRead = test.harness.processes.length;
      await sending;
      await flush();
      await test.chat.loadHistory(ROW_ID);

      expect(startsDuringRead).toBe(0);
      expect(test.harness.processes[0].calls).toEqual([
        { method: 'send', text: 'hi', imageCount: 0 },
      ]);
      expect(historyCalls()).toHaveLength(1);
      expect(test.chat.sessions()[0].entries.map((entry) => entry.id)).toEqual([
        ...historyIds,
        'user-1',
        'assistant-1',
        'result-1',
      ]);
      expect(test.sent('entries')).toHaveLength(1);
    },
  );

  it('send_TwoSendsOnOnePendingRead_StartOneProcessInOrder', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record(PAST_ONE.sessionId, { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );

    const first = test.chat.send(ROW_ID, { text: 'first', images: [] });
    const second = test.chat.send(ROW_ID, { text: 'second', images: [] });
    await Promise.all([first, second]);

    expect(test.harness.processes).toHaveLength(1);
    expect(test.harness.processes[0].calls).toEqual([
      { method: 'send', text: 'first', imageCount: 0 },
      { method: 'send', text: 'second', imageCount: 0 },
    ]);
  });

  it.each([
    {
      given: 'the row closed',
      duringRead: (test: ReturnType<typeof setUp>) => test.chat.closed(ROW_ID),
      logged: `send for session ${ROW_ID} closed while reading ignored`,
    },
    {
      given: 'detachAll',
      duringRead: (test: ReturnType<typeof setUp>) => test.chat.detachAll(),
      logged: `send for session ${ROW_ID} ignored: chat is stopping`,
    },
  ])(
    'send_RowWithHistoryPending_StoppedDuringRead_StartsNothing given $given',
    async ({ duringRead, logged }) => {
      const test = setUp();
      test.chat.restore(
        {
          sessions: [record(PAST_ONE.sessionId, { sent: true })],
          selectedHostSessionId: null,
        },
        [],
      );

      const sending = test.chat.send(ROW_ID, { text: 'hi', images: [] });
      duringRead(test);
      await sending;
      await flush();

      expect(test.harness.processes).toEqual([]);
      expect(test.logged).toContain(logged);
    },
  );

  it('resume_DetachedWhileReading_RejectsAndOpensNothing', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;

    const resuming = test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });
    test.chat.detachAll();

    await expect(resuming).rejects.toThrow(hostId);
    expect(test.opened).toEqual([]);
    expect(test.harness.processes).toEqual([]);
  });

  it('loadHistory_RowClosedWhileReading_SendsNothing', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record(PAST_ONE.sessionId, { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );

    const reading = test.chat.loadHistory(ROW_ID);
    test.chat.closed(ROW_ID);
    await reading;

    expect(test.sent('entries')).toEqual([]);
  });

  it.each([
    {
      given: 'a start',
      open: (chat: ChatSessions) =>
        chat.start({ projectDir: PROJECT_DIR, profile: 'personal' }),
      selected: 'uuid-1',
    },
    {
      given: 'a launch',
      open: (chat: ChatSessions) =>
        chat.launch({
          projectDir: PROJECT_DIR,
          profile: 'personal',
          message: { text: 'hi', images: [] },
        }),
      selected: null,
    },
  ])(
    'selected_RowChatOpens_SavedWhenOpenedSelected given $given',
    async ({ open, selected }) => {
      const test = setUp();
      test.chat.restore(NOTHING_SAVED, []);

      open(test.chat);
      await flush();

      expect(test.saved.last()?.selectedHostSessionId).toBe(selected);
    },
  );

  it('selected_ChatRowThenOtherRow_KeepsLastChatSelection', () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record('host-a'), record('host-b')],
        selectedHostSessionId: null,
      },
      [],
    );

    test.chat.selected('row-1');
    test.chat.selected('row-2');
    test.chat.selected('row-relay');
    test.chat.selected(null);

    expect(test.saved.last()?.selectedHostSessionId).toBe('host-b');
  });
});

describe('createChatSessions branch', () => {
  const TURN_ENDED: AgentEvent = { type: 'turnEnded', at: 1000 };

  // A clone at `/repos/clone` whose branch the test changes.
  function cloneGit(branch: { current: string }): ChatSessionsDeps['git'] {
    return {
      topLevel: () => Promise.resolve('/repos/clone'),
      currentBranch: () => Promise.resolve(branch.current),
    };
  }

  it.each([
    {
      case: 'clone on main',
      git: cloneGit({ current: 'main' }),
      sent: [{ sessionId: ROW_ID, repo: 'clone', branch: 'main' }],
      logged: null,
    },
    { case: 'no clone', git: NO_CLONE, sent: [], logged: null },
    {
      case: 'topLevel rejects',
      git: {
        ...NO_CLONE,
        topLevel: () => Promise.reject(new Error('git did not start')),
      },
      sent: [],
      logged: 'branch not read in app: git did not start',
    },
  ])('branchRead_$case', async ({ git, sent, logged }) => {
    const test = await started({ git });

    expect(test.sent('branch')).toEqual(sent);
    expect(test.chat.sessions()[0]).toMatchObject({
      repo: sent[0]?.repo ?? 'app',
      branch: sent[0]?.branch ?? null,
    });
    if (logged !== null) {
      expect(test.logged).toContain(logged);
    }
  });

  it('agentEvent_TurnEnded_ReadsTheBranchAgain', async () => {
    const branch = { current: 'main' };
    const test = await started({ git: cloneGit(branch) });
    branch.current = 'feature';

    test.process.events.agentEvent(TURN_ENDED);
    await flush();
    test.process.events.agentEvent(TURN_ENDED);
    await flush();

    expect(test.sent('branch')).toEqual([
      { sessionId: ROW_ID, repo: 'clone', branch: 'main' },
      { sessionId: ROW_ID, repo: 'clone', branch: 'feature' },
    ]);
  });

  // `reads` holds each branch read still open, oldest first.
  it.each([
    {
      case: 'older read settles after a newer',
      settle: async (
        test: Awaited<ReturnType<typeof started>>,
        reads: ((branch: string) => void)[],
      ) => {
        test.process.events.agentEvent(TURN_ENDED);
        await flush();
        reads[1]('feature');
        await flush();
        reads[0]('main');
      },
      sent: [{ sessionId: ROW_ID, repo: 'clone', branch: 'feature' }],
      shown: 'feature',
    },
    {
      case: 'read settles after its row closed',
      settle: async (
        test: Awaited<ReturnType<typeof started>>,
        reads: ((branch: string) => void)[],
      ) => {
        test.chat.closed(ROW_ID);
        reads[0]('main');
      },
      sent: [],
      shown: null,
    },
  ])(
    'branchRead_StaleRead_ChangesNothing ($case)',
    async ({ settle, sent, shown }) => {
      const reads: ((branch: string) => void)[] = [];
      const git: ChatSessionsDeps['git'] = {
        topLevel: () => Promise.resolve('/repos/clone'),
        currentBranch: () =>
          new Promise((resolve) => {
            reads.push(resolve);
          }),
      };
      const test = await started({ git });

      await settle(test, reads);
      await flush();

      expect(test.sent('branch')).toEqual(sent);
      expect(test.chat.sessions()[0]?.branch ?? null).toBe(shown);
    },
  );
});

describe('createChatSessions usage forwarding', () => {
  it.each([
    {
      case: 'running',
      close: false,
      event: {
        type: 'toolStarted',
        at: 1000,
        agentId: MAIN_AGENT_ID,
        toolUseId: 'tool-1',
        tool: 'Read',
        summary: '',
      } satisfies AgentEvent,
    },
    {
      case: 'after close',
      close: true,
      event: { type: 'sessionEnded', at: 1000 } satisfies AgentEvent,
    },
  ])('agentEvent_$case_ReachesTheBusWithBothIds', async ({ close, event }) => {
    const test = await started();
    if (close) {
      test.chat.closed(ROW_ID);
    }
    test.emitted.length = 0;

    test.process.events.agentEvent(event);

    expect(test.emitted).toEqual([
      {
        event: 'agentEvent',
        data: {
          sessionId: ROW_ID,
          profileDir: '~/.claude-personal',
          hostSessionId: 'uuid-1',
          event,
          replayed: false,
        },
      },
    ]);
    expect((test.emitted[0].data as ChatMainEvents['agentEvent']).event).toBe(
      event,
    );
  });

  it.each([
    {
      given: 'a plan row update',
      act: (test: Awaited<ReturnType<typeof started>>) =>
        test.process.events.planUsage(fakePlanRowUpdate(1, 1000)),
      emitted: [
        {
          event: 'planUsage',
          data: {
            profileDir: '~/.claude-personal',
            update: fakePlanRowUpdate(1, 1000),
          },
        },
      ],
    },
    {
      given: 'the profile setting changed after the start',
      act: (test: Awaited<ReturnType<typeof started>>) => {
        test.setProfiles([{ name: 'personal', configDir: '/elsewhere' }]);
        test.process.events.agentEvent(fakeUsageEvent(1, 1000));
      },
      emitted: [
        {
          event: 'agentEvent',
          data: {
            sessionId: ROW_ID,
            profileDir: '~/.claude-personal',
            hostSessionId: 'uuid-1',
            event: fakeUsageEvent(1, 1000),
            replayed: false,
          },
        },
      ],
    },
    {
      given: 'an agent event after the row closed',
      act: (test: Awaited<ReturnType<typeof started>>) => {
        test.chat.closed(ROW_ID);
        test.process.events.agentEvent(fakeUsageEvent(1, 1000));
      },
      emitted: [],
    },
    {
      given: 'a plan row update after the process ended',
      act: (test: Awaited<ReturnType<typeof started>>) => {
        test.process.events.ended({ code: 0, error: null });
        test.process.events.planUsage(fakePlanRowUpdate(1, 1000));
      },
      emitted: [],
    },
  ])(
    'processEvents_UsageForwarding_EmitsWhileLive given $given',
    async ({ act, emitted }) => {
      const test = await started();
      test.emitted.length = 0;

      act(test);

      expect(test.emitted).toEqual(emitted);
    },
  );

  it.each([
    {
      given: 'a started row',
      open: (test: ReturnType<typeof setUp>) =>
        test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' }),
      opened: [{ sessionId: ROW_ID, profileDir: '~/.claude-personal' }],
    },
    {
      given: 'a restored row',
      open: (test: ReturnType<typeof setUp>) =>
        test.chat.restore(
          {
            sessions: [record('host-a', { profile: 'personal' })],
            selectedHostSessionId: null,
          },
          [],
        ),
      opened: [{ sessionId: ROW_ID, profileDir: '~/.claude-personal' }],
    },
    {
      given: 'a restored row whose profile is missing',
      open: (test: ReturnType<typeof setUp>) =>
        test.chat.restore(
          {
            sessions: [record('host-a', { profile: 'gone' })],
            selectedHostSessionId: null,
          },
          [],
        ),
      opened: [],
    },
  ])(
    'openRow_SessionOpened_EmitsTheRowsProfileDir given $given',
    ({ open, opened }) => {
      const test = setUp();

      open(test);

      expect(
        test.emitted
          .filter((emitted) => emitted.event === 'sessionOpened')
          .map((emitted) => emitted.data),
      ).toEqual(opened);
    },
  );
});

describe('createChatSessions clear', () => {
  const CLEARED: ChatEntry = {
    kind: 'notice',
    id: 'app-notice-1',
    at: 1000,
    text: 'Conversation cleared',
    tone: 'info',
    raw: [],
  };

  it('clear_RunningRow_RestartsUnderNewIdWithOneNotice', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    const old = test.harness.processes[0];
    test.chat.send(ROW_ID, { text: 'first', images: [] });
    await flush();
    old.events.entry(assistant('extra', 'more'));
    test.chat.setControl(ROW_ID, 'model', 'fake-large');
    await flush();

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.chat.sessions()[0].entries).toEqual([CLEARED]);
    expect(test.sent('entries').at(-1)).toEqual({
      sessionId: ROW_ID,
      entries: [CLEARED],
    });
    expect(old.request.sessionId).toBe('uuid-1');
    expect(old.request.rowId).toBe(ROW_ID);
    expect(test.harness.processes[1].request).toMatchObject({
      sessionId: 'uuid-2',
      rowId: ROW_ID,
      resume: false,
      controls: { model: 'fake-large' },
    });
    expect(old.calls).toContainEqual({ method: 'end' });
    expect(test.hostIdChanges).toEqual(['uuid-2']);
    expect(test.saved.last()).toEqual({
      sessions: [
        {
          hostSessionId: 'uuid-2',
          projectDir: PROJECT_DIR,
          profile: 'personal',
          sent: false,
          busy: false,
          titles: { ...NO_TITLES, firstMessage: 'first' },
          processId: 'uuid-2-2-1000',
          queued: [],
          returned: [],
          launchControls: { mode: 'auto', model: 'fake-large' },
          launchResume: false,
          controls: test.chat.sessions()[0].controls,
          confirmedPicks: { model: 'fake-large' },
          returnedDrops: [],
          activeMs: 0,
        },
      ],
      selectedHostSessionId: 'uuid-2',
    });
    expect(test.chat.sessions()[0].running).toBe(true);
    expect(test.logged).toContain('conversation cleared in app');
  });

  it('clear_MidTurn_StopsOldProcessAndIgnoresItsLateEvents', async () => {
    const test = await started();
    test.activity('working');
    const call = test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: 'tu-1',
        signal: signal().signal,
      });

    test.chat.clear(ROW_ID);
    await flush();
    test.process.events.entry(assistant('late', 'stale'));
    test.process.events.ended({ code: 1, error: 'late' });

    expect(test.process.calls).toEqual([
      { method: 'interrupt' },
      { method: 'end' },
    ]);
    expect(replyText(await settled(call))).toBe(
      JSON.stringify({ behavior: 'deny', message: CANCELLED_REASON }),
    );
    expect(test.chat.sessions()[0].entries).toEqual([CLEARED]);
    expect(test.chat.sessions()[0].running).toBe(true);
    expect(test.sent('sessionRested')).toEqual([]);
    const sessionEndedHostIds = test.emitted.flatMap((emitted) =>
      emitted.event === 'agentEvent' &&
      emitted.data.event.type === 'sessionEnded'
        ? [emitted.data.hostSessionId]
        : [],
    );
    expect(sessionEndedHostIds).toEqual(['uuid-1']);
  });

  it('clear_RowWithRunTime_ResetsTheClockAndSavesZero', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record('host-a', { activeMs: 30000 })],
        selectedHostSessionId: null,
      },
      [],
    );

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.sent('activeTime').at(-1)).toEqual({
      sessionId: ROW_ID,
      activeTime: { totalMs: 0, since: null },
    });
    expect(test.saved.last()?.sessions[0].activeMs).toBe(0);
  });

  it('clear_RestingRow_StartsFreshProcess', async () => {
    const test = await started();
    test.process.events.ended({ code: 0, error: null });

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.harness.processes).toHaveLength(2);
    expect(test.harness.processes[1].request).toMatchObject({
      sessionId: 'uuid-2',
      resume: false,
    });
    expect(test.process.calls).not.toContainEqual({ method: 'end' });
    expect(test.chat.sessions()[0].entries).toEqual([
      { ...CLEARED, id: 'app-notice-2' },
    ]);
  });

  it('clear_QueuedMessages_ReturnedOldestFirst', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.chat.sessions()[0].queued).toEqual([]);
    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [first, second] },
    ]);
    expect(
      test.harness.processes[1].calls.filter((call) => call.method === 'send'),
    ).toEqual([]);
  });

  it('clear_WrittenAndSentMessages_ReturnedInWriteOrder', async () => {
    const test = await started();
    const idleSend: UserMessage = { text: 'idle send', images: [] };
    test.chat.send(ROW_ID, idleSend);
    const [first, second] = queueTwo(test);
    test.chat.sendNow(ROW_ID, 'queued-1');

    test.chat.clear(ROW_ID);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [idleSend, first, second] },
    ]);
    expect(test.chat.sessions()[0].queued).toEqual([]);
  });

  it.each([{ event: 'entry' }, { event: 'messageDropped' }])(
    'clear_OldProcessEventForAReusedId_ChangesNothing: $event',
    async ({ event }) => {
      const test = await started();
      const old = test.process;
      test.chat.clear(ROW_ID);
      await flush();
      const fresh = test.harness.processes[1];
      const message: UserMessage = { text: 'after clear', images: [] };
      test.chat.send(ROW_ID, message);

      if (event === 'entry') {
        old.events.entry(userEntry('user-1', 'stale'));
      } else {
        old.events.messageDropped('user-1', { text: 'stale', images: [] });
      }
      fresh.events.ended({ code: 0, error: null });

      expect(test.sentReturned()).toEqual([
        { sessionId: ROW_ID, messages: [message] },
      ]);
    },
  );

  it('clear_StartThrows_RowRestsUnderNewIdAndRethrows', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    test.harness.failNextStart('spawn failed');

    expect(() => test.chat.clear(ROW_ID)).toThrow('spawn failed');

    expect(test.chat.sessions()[0]).toMatchObject({
      running: false,
      entries: [CLEARED],
    });
    expect(test.saved.last()?.sessions).toEqual([
      expect.objectContaining({ hostSessionId: 'uuid-2', sent: false }),
    ]);
    expect(test.sent('sessionRested')).toEqual([
      { sessionId: ROW_ID, error: null },
    ]);
  });

  it.each([
    {
      given: 'an unknown session',
      arrange: () => {},
      sessionId: 'row-x',
      logged: 'clear for unknown session row-x ignored',
    },
    {
      given: 'detachAll',
      arrange: (test: ReturnType<typeof setUp>) => test.chat.detachAll(),
      sessionId: ROW_ID,
      logged: `clear for session ${ROW_ID} ignored: chat is stopping`,
    },
  ])(
    'clear_Ignored_ChangesNothingAndLogs given $given',
    async ({ arrange, sessionId, logged }) => {
      const test = await started();
      arrange(test);

      test.chat.clear(sessionId);
      await flush();

      expect(test.harness.processes).toHaveLength(1);
      expect(test.hostIdChanges).toEqual([]);
      expect(test.logged).toContain(logged);
    },
  );

  it('clear_ProfileMissing_ThrowsAndChangesNothing', async () => {
    const test = await started();
    test.process.events.entry(assistant('kept', 'still here'));
    const entriesBefore = test.chat.sessions()[0].entries;
    test.setProfiles([]);

    expect(() => test.chat.clear(ROW_ID)).toThrow('personal');

    expect(test.chat.sessions()[0].entries).toEqual(entriesBefore);
    expect(test.hostIdChanges).toEqual([]);
    expect(test.process.calls).toEqual([]);
    expect(test.harness.processes).toHaveLength(1);
  });

  it('clear_HistoryReadInFlight_Dropped', async () => {
    const test = setUp();
    test.chat.restore(
      {
        sessions: [record(PAST_ONE.sessionId, { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );
    const sending = test.chat.send(ROW_ID, { text: 'after', images: [] });

    test.chat.clear(ROW_ID);
    await sending;
    await flush();

    const { entries } = test.chat.sessions()[0];
    expect(entries[0]).toEqual(CLEARED);
    expect(entries.filter((entry) => entry.id.startsWith('history:'))).toEqual(
      [],
    );
    expect(test.sent('entries')).toHaveLength(1);
  });

  it('clear_WorkingRowUnfocused_NoTurnFinishedAlert', async () => {
    const test = await started();
    test.setFocused(false);
    test.activity('working');

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.announced).toEqual([]);
    expect(test.marked).toEqual([]);
  });
});

// A change to a session's work at `at`: the activity its harness reports, its
// one permission call asked or answered, or its one background task starting (1)
// or finishing (0).
type ClockStep =
  | { at: number; activity: ProcessActivity }
  | { at: number; permission: 'asked' | 'answered' }
  | { at: number; background: 0 | 1 };

function backgroundEvent(at: number, background: 0 | 1): AgentEvent {
  return background === 1
    ? {
        type: 'taskStarted',
        at,
        taskId: 'task-1',
        agentId: MAIN_AGENT_ID,
        description: 'server',
        command: null,
      }
    : { type: 'taskFinished', at, taskId: 'task-1', outcome: 'done' };
}

function runClockSteps(
  test: Awaited<ReturnType<typeof started>>,
  steps: readonly ClockStep[],
) {
  for (const step of steps) {
    test.setNow(step.at);
    if ('activity' in step) {
      test.activity(step.activity);
    } else if ('background' in step) {
      test.process.events.agentEvent(backgroundEvent(step.at, step.background));
    } else if (step.permission === 'asked') {
      void test.chat
        .permissionToolSession(test.agentSession)
        .call('permission_prompt', BASH_ARGS, {
          toolUseId: 'tu-1',
          signal: signal().signal,
        });
    } else {
      test.chat.answerPermission(ROW_ID, 'permission-1', {
        allowed: true,
        reason: null,
      });
    }
  }
}

describe('createChatSessions active time', () => {
  it.each<{ given: string; steps: ClockStep[]; expected: ActiveTime[] }>([
    {
      given: 'working, then idle',
      steps: [
        { at: 1000, activity: 'working' },
        { at: 4000, activity: 'idle' },
      ],
      expected: [
        { totalMs: 0, since: 1000 },
        { totalMs: 3000, since: null },
      ],
    },
    {
      given: 'working, a permission asked, then answered',
      steps: [
        { at: 1000, activity: 'working' },
        { at: 4000, permission: 'asked' },
        { at: 9000, permission: 'answered' },
      ],
      expected: [
        { totalMs: 0, since: 1000 },
        { totalMs: 3000, since: null },
        { totalMs: 3000, since: 9000 },
      ],
    },
    {
      given: 'working with background running through a permission wait',
      steps: [
        { at: 1000, activity: 'working' },
        { at: 2000, background: 1 },
        { at: 4000, permission: 'asked' },
        { at: 9000, permission: 'answered' },
      ],
      expected: [{ totalMs: 0, since: 1000 }],
    },
    {
      given: 'working, idle with background running, then background over',
      steps: [
        { at: 1000, activity: 'working' },
        { at: 2000, background: 1 },
        { at: 5000, activity: 'idle' },
        { at: 9000, background: 0 },
      ],
      expected: [
        { totalMs: 0, since: 1000 },
        { totalMs: 8000, since: null },
      ],
    },
    {
      given: 'a permission waiting, background starting then over',
      steps: [
        { at: 500, activity: 'working' },
        { at: 1000, permission: 'asked' },
        { at: 2000, background: 1 },
        { at: 6000, background: 0 },
      ],
      expected: [
        { totalMs: 0, since: 500 },
        { totalMs: 500, since: null },
        { totalMs: 500, since: 2000 },
        { totalMs: 4500, since: null },
      ],
    },
  ])(
    'activeTime_WorkSteps_SendsEachStartAndStop: $given',
    async ({ steps, expected }) => {
      const test = await started();

      runClockSteps(test, steps);

      expect(test.sent('activeTime').map((sent) => sent.activeTime)).toEqual(
        expected,
      );
      expect(test.chat.sessions()[0].activeTime).toEqual(expected.at(-1));
    },
  );

  it('activeTime_ClockStopsWithNoOtherSave_SnapshotCarriesTheStoppedTotal', async () => {
    const test = await started();
    test.chat.restore(NOTHING_SAVED, []);

    runClockSteps(test, [
      { at: 1000, activity: 'working' },
      { at: 2000, background: 1 },
      { at: 5000, activity: 'idle' },
      { at: 9000, background: 0 },
    ]);

    expect(test.saved.last()?.sessions[0].activeMs).toBe(8000);
  });

  const CLOCK_RUNNING: { given: string; steps: ClockStep[] }[] = [
    { given: 'working', steps: [{ at: 1000, activity: 'working' }] },
    { given: 'with background only', steps: [{ at: 1000, background: 1 }] },
    {
      given: 'working with background',
      steps: [
        { at: 1000, activity: 'working' },
        { at: 2000, background: 1 },
      ],
    },
  ];

  it('restore_SavedActiveMs_SessionStartedCarriesThePausedTotal', () => {
    const test = setUp();

    test.chat.restore(
      {
        sessions: [record('host-a', { activeMs: 42000 })],
        selectedHostSessionId: null,
      },
      [],
    );

    expect(test.sent('sessionStarted')[0].activeTime).toEqual({
      totalMs: 42000,
      since: null,
    });
  });

  it('detachAll_ClockRunning_SavesTheOpenSpanUpToNow', async () => {
    const test = await started();
    test.chat.restore(NOTHING_SAVED, []);
    runClockSteps(test, [{ at: 1000, activity: 'working' }]);
    test.setNow(2500);

    test.chat.detachAll();

    expect(test.saved.last()?.sessions[0].activeMs).toBe(1500);
  });

  it('detachAll_SaveInFlight_ItsPromiseHoldsForTheWrite', async () => {
    const test = await started();
    test.chat.restore(NOTHING_SAVED, []);
    let finishWrite = () => {};
    test.saved.store.save = () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      });
    let isHeld = true;

    const detached = test.chat.detachAll().then(() => {
      isHeld = false;
    });
    await flush();
    const heldBeforeTheWrite = isHeld;
    finishWrite();
    await detached;

    expect(heldBeforeTheWrite).toBe(true);
    expect(isHeld).toBe(false);
  });

  it('detachAll_WriteFails_ResolvesAndLogs', async () => {
    const test = await started();
    test.chat.restore(NOTHING_SAVED, []);
    test.saved.store.save = () => Promise.reject(new Error('disk full'));

    await test.chat.detachAll();

    expect(test.logged).toContain('open sessions not saved: disk full');
  });

  // Restores `host-a` with 42 s saved, its attach replaying `replay` at 7000.
  async function restoredAfterReplay(
    replay: (events: AgentProcessEvents) => void,
  ) {
    const test = setUp();
    test.harness.scriptAttach('p1', { outcome: 'process', replay });
    test.setNow(7000);
    restoreOne(test, hostedRecord({ activeMs: 42000 }), [hostedP1()]);
    const savesAfterRestore = test.saved.saves();
    await flush();
    return { test, savesAfterRestore };
  }

  const pastTask = (events: AgentProcessEvents, taskId: string) => {
    events.agentEvent({
      type: 'taskStarted',
      at: 100,
      taskId,
      agentId: MAIN_AGENT_ID,
      description: 'server',
      command: null,
    });
    events.agentEvent({
      type: 'taskFinished',
      at: 200,
      taskId,
      outcome: 'done',
    });
  };

  it.each<{ given: string; replay: (events: AgentProcessEvents) => void }>([
    { given: 'working', replay: (events) => events.activity('working') },
    {
      given: 'a task still running',
      replay: (events) => {
        pastTask(events, 'task-past');
        events.agentEvent(backgroundEvent(100, 1));
      },
    },
  ])(
    'replay_EndingWithWorkRunning_OpensTheClockOnceAtItsEnd: $given',
    async ({ replay }) => {
      const { test } = await restoredAfterReplay(replay);

      const running = { totalMs: 42000, since: 7000 };
      expect(test.sent('activeTime').map((sent) => sent.activeTime)).toEqual([
        running,
      ]);
      expect(test.chat.sessions()[0].activeTime).toEqual(running);
    },
  );

  it.each<{ given: string; replay: (events: AgentProcessEvents) => void }>([
    { given: 'nothing', replay: () => {} },
    {
      given: 'past tasks that finished',
      replay: (events) => {
        pastTask(events, 'task-1');
        pastTask(events, 'task-2');
      },
    },
    {
      given: 'a past turn that ended',
      replay: (events) => {
        events.activity('working');
        events.activity('idle');
      },
    },
  ])(
    'replay_EndingIdle_LeavesTheClockAtTheSavedTotal: $given',
    async ({ replay }) => {
      const { test } = await restoredAfterReplay(replay);

      expect(test.sent('activeTime')).toEqual([]);
      expect(test.chat.sessions()[0].activeTime).toEqual({
        totalMs: 42000,
        since: null,
      });
      expect(test.saved.last()?.sessions[0].activeMs).toBe(42000);
    },
  );

  it('replay_PastTasks_SavesNothing', async () => {
    const { test, savesAfterRestore } = await restoredAfterReplay((events) => {
      pastTask(events, 'task-1');
      pastTask(events, 'task-2');
    });

    expect(test.saved.saves()).toBe(savesAfterRestore);
  });

  it.each([
    { outcome: 'null' as const, message: '', background: false },
    { outcome: 'reject' as const, message: 'no attach', background: false },
    { outcome: 'null' as const, message: '', background: true },
    { outcome: 'reject' as const, message: 'no attach', background: true },
  ])(
    'attach_FailsAfterReplayingWorking_ClockStaysPaused: $outcome, background $background',
    async ({ outcome, message, background }) => {
      const test = setUp();
      const replay = (events: AgentProcessEvents) => {
        events.activity('working');
        if (background) {
          events.agentEvent(backgroundEvent(100, 1));
        }
      };
      test.harness.scriptAttach(
        'p1',
        outcome === 'null' ? { outcome, replay } : { outcome, message, replay },
      );

      restoreOne(test, hostedRecord({ activeMs: 42000 }), [hostedP1()]);
      test.setNow(7000);
      await flush();

      expect(test.chat.sessions()[0].running).toBe(false);
      expect(test.sent('activeTime')).toEqual([]);
      expect(test.chat.sessions()[0].activeTime).toEqual({
        totalMs: 42000,
        since: null,
      });
      expect(test.saved.last()?.sessions[0].activeMs).toBe(42000);
    },
  );

  it.each(CLOCK_RUNNING)(
    'ended_MidSpan_ClosesTheTotal: $given',
    async ({ steps }) => {
      const test = await started();
      test.chat.restore(NOTHING_SAVED, []);
      runClockSteps(test, steps);
      test.setNow(5000);

      test.process.events.ended({ code: 0, error: null });

      const closed = { totalMs: 4000, since: null };
      expect(test.chat.sessions()[0].activeTime).toEqual(closed);
      expect(test.sent('activeTime').at(-1)?.activeTime).toEqual(closed);
      expect(test.saved.last()?.sessions[0].activeMs).toBe(4000);
    },
  );

  it.each(CLOCK_RUNNING)(
    'clear_ClockRunning_StaysAtZero: $given',
    async ({ steps }) => {
      const test = await started();
      test.chat.restore(NOTHING_SAVED, []);
      runClockSteps(test, steps);
      test.setNow(5000);

      test.chat.clear(ROW_ID);
      await flush();
      test.setNow(8000);
      test.process.events.agentEvent(backgroundEvent(8000, 0));
      test.process.events.ended({ code: 0, error: null });
      await flush();

      expect(test.sent('activeTime').at(-1)?.activeTime).toEqual(
        NO_ACTIVE_TIME,
      );
      expect(test.chat.sessions()[0].activeTime).toEqual(NO_ACTIVE_TIME);
      expect(test.saved.last()?.sessions[0].activeMs).toBe(0);
    },
  );

  it.each([
    { given: 'the start succeeding', startFails: false },
    { given: 'the start throwing', startFails: true },
  ])(
    'restore_SkippedRecord_ANewHeldRowTakesOverItsTotal given $given',
    async ({ startFails }) => {
      const test = setUp();
      const hostId = PAST_ONE.sessionId;
      test.chat.sessionConnected(connected('row-relay', hostId));
      test.chat.restore(
        {
          sessions: [
            record(hostId, {
              activeMs: 42000,
              queued: [{ text: 'saved', images: [] }],
            }),
          ],
          selectedHostSessionId: null,
        },
        [],
      );
      test.chat.sessionEnded('row-relay');
      if (startFails) {
        test.harness.failNextStart('no start');
      }

      const resuming = test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: hostId,
        title: PAST_ONE.title,
      });
      await (startFails ? expect(resuming).rejects.toThrow() : resuming);

      expect(test.saved.last()?.sessions[0].activeMs).toBe(42000);
      expect(test.sent('activeTime')[0].activeTime).toEqual({
        totalMs: 42000,
        since: null,
      });
    },
  );

  it('restore_RecordOfAHeldRow_AddsItsTotalToARunningClock', async () => {
    const test = await started();
    runClockSteps(test, [{ at: 1000, activity: 'working' }]);
    test.setNow(3000);

    restoreOne(test, record('uuid-1', { activeMs: 42000 }), []);

    expect(test.chat.sessions()[0].activeTime).toEqual({
      totalMs: 42000,
      since: 1000,
    });
    expect(test.sent('activeTime').at(-1)?.activeTime).toEqual({
      totalMs: 42000,
      since: 1000,
    });
    expect(test.saved.last()?.sessions[0].activeMs).toBe(44000);
  });
});

describe('createChatSessions titles', () => {
  it.each([
    {
      given: 'a first message then a second',
      act: async (chat: ChatSessions) => {
        await chat.send(ROW_ID, { text: '  fix the\nlogin bug', images: [] });
        await chat.send(ROW_ID, { text: 'and the logout', images: [] });
      },
      expected: [[ROW_ID, 'firstMessage', 'fix the\nlogin bug']],
    },
    {
      given: 'a first message over 200 code points',
      act: (chat: ChatSessions) =>
        chat.send(ROW_ID, { text: '🙂a'.repeat(150), images: [] }),
      expected: [[ROW_ID, 'firstMessage', '🙂a'.repeat(100)]],
    },
    {
      given: 'a first message opening with 250 spaces',
      act: (chat: ChatSessions) =>
        chat.send(ROW_ID, { text: `${' '.repeat(250)}fix it`, images: [] }),
      expected: [[ROW_ID, 'firstMessage', 'fix it']],
    },
    {
      given: 'a whitespace-only first message',
      act: (chat: ChatSessions) =>
        chat.send(ROW_ID, { text: ' \n\t ', images: [] }),
      expected: [],
    },
    {
      given: 'an images-only first message',
      act: (chat: ChatSessions) =>
        chat.send(ROW_ID, {
          text: '',
          images: [{ mediaType: 'image/png', data: 'iVBORw0K' }],
        }),
      expected: [],
    },
  ])('deliver_FirstMessage_SetsItsTitle given $given', async (row) => {
    const test = await started();

    await row.act(test.chat);

    expect(test.titleCalls).toEqual(row.expected);
  });

  it('deliver_FirstMessageAfterClear_KeepsTheTitle', async () => {
    const test = await started();
    await test.chat.send(ROW_ID, { text: 'first', images: [] });
    test.chat.clear(ROW_ID);
    await flush();
    test.titleCalls.length = 0;

    await test.chat.send(ROW_ID, { text: 'second', images: [] });

    expect(test.titleCalls).toEqual([]);
    expect(test.titlesOf(ROW_ID)?.firstMessage).toBe('first');
  });

  it.each([
    { given: 'a short title', title: 'Past work', expected: 'Past work' },
    {
      given: 'a title over 200 code points',
      title: '🙂a'.repeat(150),
      expected: '🙂a'.repeat(100),
    },
  ])(
    'resume_SetsTheRequestTitleAndSavesIt given $given',
    async ({ title, expected }) => {
      const test = setUp();
      test.chat.restore(NOTHING_SAVED, []);

      await test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: PAST_ONE.sessionId,
        title,
      });

      expect(test.titleCalls).toEqual([[ROW_ID, 'firstMessage', expected]]);
      expect(test.saved.last()?.sessions[0].titles).toEqual({
        ...NO_TITLES,
        firstMessage: expected,
      });
    },
  );

  it('restore_SavedTitles_SetsEachSavedSource', () => {
    const test = setUp();
    const titles = { user: null, agent: 'Plan review', firstMessage: 'hi' };

    test.chat.restore(
      {
        sessions: [record('host-a', { titles })],
        selectedHostSessionId: null,
      },
      [],
    );

    expect(test.titleCalls).toEqual([
      [ROW_ID, 'agent', 'Plan review'],
      [ROW_ID, 'firstMessage', 'hi'],
    ]);
    expect(test.titlesOf(ROW_ID)).toEqual(titles);
  });

  it('titleChanged_HeldRow_SavesItsCurrentTitles', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    const renamed = { ...NO_TITLES, agent: 'Named by agent' };
    test.setRowTitles(ROW_ID, renamed);
    const savesBefore = test.saved.saves();

    test.chat.titleChanged(ROW_ID);

    expect(test.saved.saves()).toBe(savesBefore + 1);
    expect(test.saved.last()?.sessions[0].titles).toEqual(renamed);
  });

  it('titleChanged_RowChatDoesNotHold_SavesNothing', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    const savesBefore = test.saved.saves();

    test.chat.titleChanged('row-9');

    expect(test.saved.saves()).toBe(savesBefore);
  });
});

// The host's entry for process `p1`, running in the current host and started at
// 5000, unless `fields` say otherwise.
function hostedP1(fields: Partial<HostedProcessInfo> = {}): HostedProcessInfo {
  return { id: 'p1', startedAt: 5000, running: true, current: true, ...fields };
}

// A record of `host-a` whose process is `p1`, unless `fields` say otherwise.
function hostedRecord(fields: Partial<SavedSession> = {}): SavedSession {
  return record('host-a', { processId: 'p1', ...fields });
}

function restoreOne(
  test: ReturnType<typeof setUp>,
  saved: SavedSession,
  hosted: readonly HostedProcessInfo[] | null,
) {
  test.chat.restore({ sessions: [saved], selectedHostSessionId: null }, hosted);
}

const QUIT_NOTICE =
  'The app quit during this turn. Your next message resumes this session.';
const OLDER_HOST_NOTICE =
  'This session is finishing its turn in another app version. Send a message once it ends.';
const OLDER_HOST_REFUSAL =
  'This session is still finishing in another app version. Send again once it ends.';
const STOPPED_NOTICE =
  'Session stopped. Your next message resumes this session.';

function noticesOf(test: ReturnType<typeof setUp>, row = 0) {
  return test.chat
    .sessions()
    [row].entries.flatMap((entry) =>
      entry.kind === 'notice'
        ? [{ kind: entry.kind, tone: entry.tone, text: entry.text }]
        : [],
    );
}

function startsOf(test: ReturnType<typeof setUp>) {
  return test.harness.processes.filter((process) => !process.attached);
}

function attachedOf(test: ReturnType<typeof setUp>) {
  return test.harness.processes.filter((process) => process.attached);
}

describe('createChatSessions process ids and the saved queue', () => {
  it('startProcess_ProcessId_HostIdStartCountAndTime', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    const firstSaved = test.saved.last()?.sessions[0];
    await test.chat.send(ROW_ID, { text: 'hi', images: [] });

    test.harness.processes[0].events.ended({ code: 0, error: null });
    await test.chat.send(ROW_ID, { text: 'again', images: [] });
    await flush();

    expect(
      test.harness.processes.map((each) => each.request.processId),
    ).toEqual(['uuid-1-1-1000', 'uuid-1-2-1000']);
    expect(firstSaved?.processId).toBe('uuid-1-1-1000');
    expect(firstSaved?.launchResume).toBe(false);
    const lastSaved = test.saved.last()?.sessions[0];
    expect(lastSaved?.processId).toBe('uuid-1-2-1000');
    expect(lastSaved?.launchResume).toBe(true);
  });

  it('save_QueuedChange_SavesUnsentRowsWithImages', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    test.harness.processes[0].events.activity('working');
    const image = { mediaType: 'image/png' as const, data: 'AAAA' };
    const saves = [test.saved.saves()];

    await test.chat.send(ROW_ID, { text: 'a', images: [image] });
    saves.push(test.saved.saves());
    await test.chat.send(ROW_ID, { text: 'b', images: [] });
    saves.push(test.saved.saves());
    test.chat.sendNow(ROW_ID, 'queued-2');
    saves.push(test.saved.saves());

    expect(saves[1]).toBeGreaterThan(saves[0]);
    expect(saves[2]).toBeGreaterThan(saves[1]);
    expect(saves[3]).toBeGreaterThan(saves[2]);
    expect(test.saved.last()?.sessions[0].queued).toEqual([
      { text: 'a', images: [image] },
    ]);
  });
});

describe('createChatSessions restoring hosted processes', () => {
  it.each([
    {
      given: 'running, current',
      fields: {
        sent: true,
        launchResume: false,
        launchControls: { effort: 'high' },
      },
      hosted: [hostedP1()],
      attaches: 1,
      notices: [],
      running: true,
    },
    {
      given: 'running, older',
      fields: {},
      hosted: [hostedP1({ current: false })],
      attaches: 0,
      notices: [{ kind: 'notice', tone: 'info', text: OLDER_HOST_NOTICE }],
      running: false,
    },
    {
      given: 'ended',
      fields: {},
      hosted: [hostedP1({ running: false })],
      attaches: 0,
      notices: [{ kind: 'notice', tone: 'info', text: QUIT_NOTICE }],
      running: false,
    },
    {
      given: 'not listed',
      fields: {},
      hosted: [],
      attaches: 0,
      notices: [{ kind: 'notice', tone: 'info', text: QUIT_NOTICE }],
      running: false,
    },
    {
      given: 'running, current, profile gone',
      fields: { profile: 'gone' },
      hosted: [hostedP1()],
      attaches: 0,
      notices: [
        {
          kind: 'notice',
          tone: 'error',
          text: expect.stringContaining('gone'),
        },
      ],
      running: false,
    },
    {
      given: 'list unknown',
      fields: {},
      hosted: null,
      attaches: 0,
      notices: [],
      running: false,
    },
    {
      given: 'list unknown, no process id',
      fields: { processId: null },
      hosted: null,
      attaches: 0,
      notices: [],
      running: false,
    },
  ])(
    'restore_HostedProcess_PicksThePath given $given',
    async ({ fields, hosted, attaches, notices, running }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay() {},
      });

      restoreOne(test, hostedRecord({ busy: true, ...fields }), hosted);
      await flush();

      expect(test.harness.attachCalls).toHaveLength(attaches);
      if (attaches === 1) {
        expect(test.harness.attachCalls[0]).toMatchObject({
          processId: 'p1',
          resume: false,
          controls: { effort: 'high' },
        });
      }
      expect(noticesOf(test)).toEqual(notices);
      expect(test.chat.sessions()[0].running).toBe(running);
    },
  );

  const heldControl = (id: string, value: string | null): SessionControl => ({
    id,
    label: id,
    choices: [],
    value,
  });
  const HELD_CONTROLS = [
    heldControl('mode', 'plan'),
    heldControl('model', 'opus'),
    heldControl('effort', 'high'),
  ];
  const HELD_RECORD = {
    processId: 'p1',
    controls: HELD_CONTROLS,
    confirmedPicks: { model: 'opus', effort: 'high' },
  };
  const LOW_EFFORT_PICK: Record<string, string> = { effort: 'low' };

  it.each([
    {
      given: 'a re-attached row whose process ends',
      fields: HELD_RECORD,
      hosted: [hostedP1()],
      replayed: [
        heldControl('mode', 'default'),
        heldControl('model', 'opus'),
        heldControl('effort', 'high'),
      ],
      shown: HELD_CONTROLS,
      passed: { mode: 'default', model: 'opus', effort: 'high' },
    },
    {
      given: 'a resting row',
      fields: HELD_RECORD,
      hosted: [],
      replayed: null,
      shown: HELD_CONTROLS,
      passed: { mode: 'plan', model: 'opus', effort: 'high' },
    },
    {
      given: 'a row whose picks are only reports',
      fields: { ...HELD_RECORD, confirmedPicks: {} },
      hosted: [],
      replayed: null,
      shown: HELD_CONTROLS,
      passed: { mode: 'plan' },
    },
    {
      given: 'a row whose held effort differs from its pick',
      fields: { ...HELD_RECORD, confirmedPicks: LOW_EFFORT_PICK },
      hosted: [],
      replayed: null,
      shown: HELD_CONTROLS,
      passed: { mode: 'plan', effort: 'low' },
    },
    {
      given: 'a saved file without controls',
      fields: { processId: 'p1' },
      hosted: [],
      replayed: null,
      shown: [],
      passed: {},
    },
  ])(
    'restore_HeldControls_ShownAndPassedAtTheNextStart given $given',
    async ({ fields, hosted, replayed, shown, passed }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay: (events) => {
          expect(test.chat.sessions()[0].controls).toEqual(shown);
          events.controls(replayed ?? []);
        },
      });

      restoreOne(test, hostedRecord(fields), hosted);
      expect(test.chat.sessions()[0].controls).toEqual(shown);
      expect(test.saved.last()?.sessions[0].confirmedPicks).toEqual(
        hostedRecord(fields).confirmedPicks,
      );
      await flush();
      attachedOf(test)[0]?.events.ended({ code: 0, error: null });
      await test.chat.send(ROW_ID, { text: 'next', images: [] });
      await flush();

      expect(startsOf(test).at(-1)?.request.controls).toEqual(passed);
    },
  );

  it('controls_ConfirmedPick_SavedWithTheRow', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED, []);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    const controls = [
      heldControl('mode', 'auto'),
      heldControl('model', 'fake-large'),
    ];

    test.chat.setControl(ROW_ID, 'model', 'fake-large');
    test.harness.processes[0].events.controls(controls);

    expect(test.saved.last()?.sessions[0]).toMatchObject({
      controls,
      confirmedPicks: { model: 'fake-large' },
    });
  });

  it.each([
    { queued: [{ text: 'a', images: [] }], returned: [], kept: true },
    { queued: [], returned: [{ text: 'b', images: [] }], kept: true },
    { queued: [], returned: [], kept: false },
  ])(
    'restore_SkippedRecordHoldingMessages_StaysSaved given $queued.length queued, $returned.length returned',
    ({ queued, returned, kept }) => {
      const test = setUp();
      test.chat.sessionConnected(connected('row-relay', 'host-a'));

      test.chat.restore(
        {
          sessions: [record('host-a', { queued, returned }), record('host-b')],
          selectedHostSessionId: null,
        },
        [],
      );

      const saved = test.saved.last()?.sessions ?? [];
      expect(saved.map((each) => each.hostSessionId)).toEqual(
        kept ? ['host-b', 'host-a'] : ['host-b'],
      );
      const line =
        'session host-a not restored; its 1 queued or returned message(s) stay saved';
      expect(test.logged.includes(line)).toBe(kept);
      if (kept) {
        expect(saved[1].queued).toEqual(queued);
        expect(saved[1].returned).toEqual(returned);
      }
    },
  );

  it.each([
    { given: 'the start succeeding', startFails: false },
    { given: 'the start throwing', startFails: true },
  ])(
    'restore_SkippedRecord_ANewHeldRowTakesOverItsMessages given $given',
    async ({ startFails }) => {
      const test = setUp();
      const hostId = PAST_ONE.sessionId;
      const queued = [{ text: 'saved', images: [] }];
      const returned = [{ text: 'not placed', images: [] }];
      test.chat.sessionConnected(connected('row-relay', hostId));
      test.chat.restore(
        {
          sessions: [record(hostId, { queued, returned })],
          selectedHostSessionId: null,
        },
        [],
      );
      test.chat.sessionEnded('row-relay');
      if (startFails) {
        test.harness.failNextStart('no start');
      }

      const resuming = test.chat.resume({
        projectDir: '/w/app',
        profile: 'work',
        hostSessionId: hostId,
        title: PAST_ONE.title,
      });
      if (startFails) {
        await expect(resuming).rejects.toThrow('no start');
      } else {
        await resuming;
      }

      expect(test.sent('queued')[0].queued.map((row) => row.text)).toEqual([
        'saved',
      ]);
      expect(test.sentReturned()[0].messages).toEqual(returned);
      const saved = test.saved.last()?.sessions ?? [];
      expect(saved.map((each) => each.hostSessionId)).toEqual([hostId]);
      expect(saved[0].returned).toEqual(returned);
      if (startFails) {
        expect(test.chat.sessions()).toEqual([]);
        expect(saved[0].queued).toEqual(queued);
      }
    },
  );

  it('restore_RecordOfAHeldRow_TheRowTakesOverItsQueued', () => {
    const test = setUp();

    test.chat.restore(
      {
        sessions: [
          record('host-a', { queued: [{ text: 'first', images: [] }] }),
          record('host-a', { queued: [{ text: 'second', images: [] }] }),
        ],
        selectedHostSessionId: null,
      },
      [],
    );

    const saved = test.saved.last()?.sessions ?? [];
    expect(saved.map((each) => each.hostSessionId)).toEqual(['host-a']);
    expect(saved[0].queued.map((message) => message.text)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('createChatSessions attaching', () => {
  it.each([
    {
      given: 'detachAll',
      act: (test: ReturnType<typeof setUp>) => test.chat.detachAll(),
      replayEnds: false,
      calls: [{ method: 'detach' }],
      ownedEnds: 0,
      callsAtOwnedEnd: [],
      resting: null,
    },
    {
      given: 'a closed row',
      act: (test: ReturnType<typeof setUp>) => test.chat.closed(ROW_ID),
      replayEnds: false,
      calls: [{ method: 'end' }],
      ownedEnds: 1,
      callsAtOwnedEnd: [{ method: 'end' }],
      resting: null,
    },
    {
      given: 'a closed row, then detachAll',
      act: (test: ReturnType<typeof setUp>) => {
        test.chat.closed(ROW_ID);
        test.chat.detachAll();
      },
      replayEnds: false,
      calls: [{ method: 'kill' }],
      ownedEnds: 1,
      callsAtOwnedEnd: [{ method: 'kill' }],
      resting: null,
    },
    {
      given: 'the replay firing ended',
      act: () => {},
      replayEnds: true,
      calls: [],
      ownedEnds: 0,
      callsAtOwnedEnd: [],
      resting:
        'Claude stopped (exit code 0). Your next message resumes this session.',
    },
  ])(
    'attach_LateResult_DetachesOrEnds given $given',
    async ({ act, replayEnds, calls, ownedEnds, callsAtOwnedEnd, resting }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 1,
        replay(events) {
          events.entry(userEntry('r1', 'replayed'));
          if (replayEnds) {
            events.ended({ code: 0, error: null });
          }
        },
      });
      restoreOne(test, hostedRecord(), [hostedP1()]);
      let seenAtOwnedEnd: unknown[] = [];
      test.setOnOwnedEnd(() => {
        seenAtOwnedEnd = [...attachedOf(test)[0].calls];
      });

      act(test);
      await flush();

      expect(attachedOf(test)[0].calls).toEqual(calls);
      expect(test.ownedEnds()).toBe(ownedEnds);
      expect(seenAtOwnedEnd).toEqual(callsAtOwnedEnd);
      if (!replayEnds) {
        expect(test.sent('entry')).toEqual([]);
      }
      if (resting !== null) {
        expect(test.chat.sessions()[0].running).toBe(false);
        expect(noticesOf(test).map((notice) => notice.text)).toEqual([resting]);
      }
    },
  );

  it.each([
    {
      call: 'setControl',
      act: (test: ReturnType<typeof setUp>) =>
        test.chat.setControl(ROW_ID, 'effort', 'high'),
      throws: `session ${ROW_ID} is still attaching`,
      logged: null,
      calls: [],
    },
    {
      call: 'clear',
      act: (test: ReturnType<typeof setUp>) => test.chat.clear(ROW_ID),
      throws: `session ${ROW_ID} is still attaching`,
      logged: null,
      calls: [],
    },
    {
      call: 'interrupt',
      act: (test: ReturnType<typeof setUp>) => test.chat.interrupt(ROW_ID),
      throws: null,
      logged: `session ${ROW_ID} interrupt waits for the attach`,
      calls: [{ method: 'interrupt' }],
    },
  ])(
    'attach_CallsWhileAttaching_WaitOrRefuse given $call',
    async ({ act, throws, logged, calls }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay: (events) => events.activity('working'),
      });
      restoreOne(test, hostedRecord(), [hostedP1()]);

      if (throws === null) {
        act(test);
      } else {
        expect(() => act(test)).toThrow(throws);
      }
      if (logged !== null) {
        expect(test.logged).toContain(logged);
      }
      await flush();

      expect(attachedOf(test)[0].calls).toEqual(calls);
      expect(test.hostIdChanges).toEqual([]);
      expect(test.uuidCalls()).toBe(0);
    },
  );

  const WRITTEN_BEFORE_QUIT: UserMessage = { text: 'dropped', images: [] };

  it.each([
    {
      given: 'a drop in the replay',
      returnedDrops: [],
      inReplay: 1,
      live: 0,
      returned: 1,
    },
    {
      given: 'a drop once live',
      returnedDrops: [],
      inReplay: 0,
      live: 1,
      returned: 1,
    },
    {
      given: 'a repeat of the drop',
      returnedDrops: [],
      inReplay: 1,
      live: 1,
      returned: 1,
    },
    {
      given: 'a drop an earlier run returned',
      returnedDrops: ['user-1'],
      inReplay: 1,
      live: 0,
      returned: 0,
    },
  ])(
    'attach_DroppedMessage_ComesBackOnce given $given',
    async ({ returnedDrops, inReplay, live, returned }) => {
      const test = setUp();
      const dropTimes = (events: AgentProcessEvents, times: number) => {
        for (let drop = 0; drop < times; drop += 1) {
          events.messageDropped('user-1', WRITTEN_BEFORE_QUIT);
        }
      };
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay: (events) => dropTimes(events, inReplay),
      });

      restoreOne(test, hostedRecord({ returnedDrops }), [hostedP1()]);
      await flush();
      dropTimes(attachedOf(test)[0].events, live);

      expect(test.sentReturned()).toEqual(
        Array.from({ length: returned }, () => ({
          sessionId: ROW_ID,
          messages: [WRITTEN_BEFORE_QUIT],
        })),
      );
      expect(test.saved.last()?.sessions[0].returnedDrops).toEqual(['user-1']);
    },
  );

  it.each([
    {
      path: 'a pull-back',
      returns: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.pullBack(ROW_ID, 'queued-1'),
      texts: ['first'],
    },
    {
      path: 'an interrupt',
      returns: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.interrupt(ROW_ID),
      texts: ['first', 'second'],
    },
    {
      path: 'a clear',
      returns: (test: Awaited<ReturnType<typeof started>>) =>
        test.chat.clear(ROW_ID),
      texts: ['first', 'second'],
    },
    {
      path: 'the process ending',
      returns: (test: Awaited<ReturnType<typeof started>>) =>
        test.process.events.ended({ code: 0, error: null }),
      texts: ['first', 'second'],
    },
    {
      path: 'a drop',
      returns: (test: Awaited<ReturnType<typeof started>>) =>
        test.process.events.messageDropped('user-9', {
          text: 'dropped',
          images: [],
        }),
      texts: ['dropped'],
    },
  ])(
    'returned_EveryPath_HeldAndSavedUntilThePagePlacesIt: $path',
    async ({ returns, texts }) => {
      const test = await started();
      test.chat.restore({ sessions: [], selectedHostSessionId: null }, []);
      queueTwo(test);

      returns(test);

      const heldTexts = () =>
        test.chat.sessions()[0].returned.map((held) => held.text);
      const savedTexts = () =>
        test.saved.last()?.sessions[0].returned.map((held) => held.text);
      expect(heldTexts()).toEqual(texts);
      expect(savedTexts()).toEqual(texts);

      test.chat.returnedPlaced(ROW_ID, [
        test.chat.sessions()[0].returned[0].id,
      ]);

      expect(heldTexts()).toEqual(texts.slice(1));
      expect(savedTexts()).toEqual(texts.slice(1));
    },
  );

  it('returned_DropInReplayAcrossRelaunches_HeldUntilPlacedThenGone', async () => {
    const relaunch = async (saved: SavedSession) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay: (events) =>
          events.messageDropped('user-1', WRITTEN_BEFORE_QUIT),
      });
      restoreOne(test, saved, [hostedP1()]);
      await flush();
      return test;
    };

    // No page heard the first return; the app quits before one places it.
    const noPage = await relaunch(hostedRecord());
    const quitRecord = noPage.saved.last()?.sessions[0];
    expect(quitRecord?.returned).toEqual([WRITTEN_BEFORE_QUIT]);
    expect(quitRecord?.returnedDrops).toEqual(['user-1']);

    // The next relaunch holds it once, though the replay finds the drop again.
    const held = await relaunch(quitRecord as SavedSession);
    const [{ id, ...message }] = held.chat.sessions()[0].returned;
    expect(message).toEqual(WRITTEN_BEFORE_QUIT);
    expect(held.chat.sessions()[0].returned).toHaveLength(1);

    // The page places it, and it never comes back.
    held.chat.returnedPlaced(ROW_ID, [id]);
    const placedRecord = held.saved.last()?.sessions[0];
    expect(placedRecord?.returned).toEqual([]);
    const after = await relaunch(placedRecord as SavedSession);
    expect(after.chat.sessions()[0].returned).toEqual([]);
    expect(after.sent('returned')).toEqual([]);
  });

  it('startProcess_NewProcess_ForgetsTheOldProcessesDrops', async () => {
    const test = setUp();
    const message: UserMessage = { text: 'second process', images: [] };

    restoreOne(test, record('host-a', { returnedDrops: ['user-1'] }), []);
    await test.chat.send(ROW_ID, { text: 'starts it', images: [] });
    await flush();
    test.harness.processes[0].events.messageDropped('user-1', message);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [message] },
    ]);
  });

  it('attach_ReplayedEvents_FlaggedNoAlertNoPlanUsage', async () => {
    const test = setUp();
    test.setFocused(false);
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 1,
      replay(events) {
        events.entry(assistant('r1', 'replayed'));
        events.activity('working');
        events.activity('idle');
        events.agentEvent({ type: 'turnEnded', at: 1000 });
        events.planUsage(fakePlanRowUpdate(1, 1000));
        events.agentEvent({ type: 'sessionEnded', at: 1500 });
      },
    });
    restoreOne(test, hostedRecord(), [hostedP1()]);
    await flush();
    const { events } = attachedOf(test)[0];

    events.activity('working');
    events.agentEvent({ type: 'turnEnded', at: 2000 });
    events.activity('idle');

    expect(test.sent('entry').map(({ entry }) => entry.id)).toEqual(['r1']);
    expect(
      test.emitted.flatMap((each) =>
        each.event === 'agentEvent'
          ? [[each.data.event.at, each.data.replayed]]
          : [],
      ),
    ).toEqual([
      [1000, true],
      [1500, false],
      [2000, false],
    ]);
    expect(test.emitted.filter((each) => each.event === 'planUsage')).toEqual(
      [],
    );
    expect(test.announced).toHaveLength(1);
  });

  it.each([
    {
      given: 'the turn running',
      replayed: 'working' as const,
      writesAtResolve: [],
    },
    // The fake's echo of `a` ends its turn, which writes `b`; no idle came before `a`.
    {
      given: 'the turn over',
      replayed: 'idle' as const,
      writesAtResolve: ['a', 'b'],
    },
  ])(
    'attach_SavedQueued_WrittenOnceTheTurnEnds given $given',
    async ({ replayed, writesAtResolve }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', {
        outcome: 'process',
        turns: 0,
        replay: (events) => events.activity(replayed),
      });
      const queued = [
        { text: 'a', images: [] },
        { text: 'b', images: [] },
      ];
      restoreOne(test, hostedRecord({ queued }), [hostedP1()]);
      expect(
        test
          .sent('queued')
          .at(-1)
          ?.queued.map((row) => row.id),
      ).toEqual(['queued-1', 'queued-2']);
      await flush();
      const process = attachedOf(test)[0];
      const written = () =>
        process.calls.flatMap((call) =>
          call.method === 'send' ? [call.text] : [],
        );

      expect(written()).toEqual(writesAtResolve);
      if (replayed === 'working') {
        process.events.activity('idle');
        expect(written()).toEqual(['a']);
        await flush();
      }
      expect(written()).toEqual(['a', 'b']);
    },
  );

  it.each([
    {
      given: 'a null',
      script: { outcome: 'null' as const },
      logged: `session ${ROW_ID} not re-attached: process p1 is not running`,
      notices: [QUIT_NOTICE],
    },
    {
      given: 'a rejection, whose turn may still run',
      script: { outcome: 'reject' as const, message: 'host gone' },
      logged: `session ${ROW_ID} not re-attached: host gone`,
      notices: [],
    },
  ])(
    'attach_NullOrRejects_RestsWithQuitNoticeOnlyOnNull given $given',
    async ({ script, logged, notices }) => {
      const test = setUp();
      test.harness.scriptAttach('p1', script);
      const attach = test.harness.attach.bind(test.harness);
      test.harness.attach = (request, events) => {
        events.activity('working');
        events.agentEvent({
          type: 'taskStarted',
          at: 0,
          taskId: 'task-1',
          agentId: MAIN_AGENT_ID,
          description: 'task',
          command: null,
        });
        return attach(request, events);
      };

      restoreOne(test, hostedRecord({ busy: true, sent: true }), [hostedP1()]);
      expect(test.chat.sessions()[0].background).toBe(1);
      expect(test.harness.lastUsageCalls).toEqual([]);
      await flush();

      expect(test.chat.sessions()[0].background).toBe(0);
      expect(test.saved.last()?.sessions[0].busy).toBe(false);
      expect(test.chat.sessions()[0].running).toBe(false);
      expect(test.sent('sessionRested')).toEqual([
        { sessionId: ROW_ID, error: null },
      ]);
      expect(noticesOf(test).map((notice) => notice.text)).toEqual(notices);
      expect(test.logged).toContain(logged);
      expect(test.harness.lastUsageCalls).toEqual(['host-a']);
      test.sessionHost.setList([]);
      await test.chat.loadHistory(ROW_ID);
      expect(
        test.harness.pastSessionCalls
          .filter((call) => call.method === 'history')
          .map((call) => call.before),
      ).toEqual([null]);
    },
  );

  it('attach_ProcessExitsDuringTheReplay_KeepsItsSavedQueued', async () => {
    const test = setUp();
    const queued = [{ text: 'a', images: [] }];
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 0,
      replay: (events) => events.ended({ code: 0, error: null }),
    });

    restoreOne(test, hostedRecord({ queued }), [hostedP1()]);
    await flush();

    expect(test.sentReturned()).toEqual([]);
    expect(test.chat.sessions()[0].queued.map((row) => row.text)).toEqual([
      'a',
    ]);
    expect(test.saved.last()?.sessions[0].queued).toEqual(queued);
  });

  it('loadHistory_BeforeAnAttachResolvesNull_ReadsWithNoCut', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', { outcome: 'null' });
    restoreOne(test, hostedRecord({ sent: true }), [hostedP1()]);

    await test.chat.loadHistory(ROW_ID);

    expect(
      test.harness.pastSessionCalls
        .filter((call) => call.method === 'history')
        .map((call) => call.before),
    ).toEqual([null]);
  });

  it('send_WhileAttaching_WaitsForTheAttach', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 0,
      replay() {},
    });
    restoreOne(test, hostedRecord(), [hostedP1()]);
    const message = { text: 'c', images: [] };

    const sending = test.chat.send(ROW_ID, message);
    expect(test.harness.processes).toEqual([]);
    await sending;
    await flush();

    expect(startsOf(test)).toEqual([]);
    expect(attachedOf(test)[0].calls).toEqual([sendCall(message)]);
  });

  it('permission_RowAttaching_WaitsThenAsks', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 0,
      replay() {},
    });
    restoreOne(test, hostedRecord(), [hostedP1()]);

    void test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: null,
        signal: signal().signal,
      });
    expect(test.chat.sessions()[0].entries).toEqual([]);
    await flush();

    expect(test.chat.sessions()[0].entries).toEqual([
      expect.objectContaining({ kind: 'permission', answer: null }),
    ]);
  });
});

describe('createChatSessions unheld processes', () => {
  // A restored resting row with `unheldProcessId` p1, and a `list` the test sets.
  async function unheldRow(arrangement: 'profileBack' | 'attachRejected') {
    const held = { list: () => Promise.resolve<HostedProcessInfo[]>([]) };
    const test = setUp({ sessionHost: { list: () => held.list() } });
    if (arrangement === 'profileBack') {
      restoreOne(test, hostedRecord({ sent: true, profile: 'gone' }), [
        hostedP1(),
      ]);
      test.setProfiles([
        ...DEFAULT_PROFILES,
        { name: 'gone', configDir: '/gone' },
      ]);
    } else {
      test.harness.scriptAttach('p1', {
        outcome: 'reject',
        message: 'defs failed',
      });
      restoreOne(test, hostedRecord({ sent: true }), [hostedP1()]);
      await flush();
    }
    return { test, held };
  }

  const ARRANGEMENTS = ['profileBack', 'attachRejected'] as const;
  const message = { text: 'c', images: [] };

  it.each(
    ARRANGEMENTS.flatMap((arrangement) => [
      {
        arrangement,
        at: 'p1 running, current, attach resolves',
        list: () => Promise.resolve([hostedP1()]),
        script: {
          outcome: 'process' as const,
          turns: 0,
          replay() {},
        },
        rejects: null,
        logged: null,
        attaches: 1,
        startResumes: [],
      },
      {
        arrangement,
        at: 'p1 running, current, attach rejects',
        list: () => Promise.resolve([hostedP1()]),
        script: { outcome: 'reject' as const, message: 'again' },
        rejects: 'again',
        logged: null,
        attaches: 1,
        startResumes: [],
      },
      {
        arrangement,
        at: 'p1 not running',
        list: () => Promise.resolve([hostedP1({ running: false })]),
        script: null,
        rejects: null,
        logged: null,
        attaches: 0,
        startResumes: [true],
      },
      {
        arrangement,
        at: 'list rejects',
        list: () => Promise.reject<HostedProcessInfo[]>(new Error('no host')),
        script: null,
        rejects: 'no host',
        logged: 'session host not listed: no host',
        attaches: 0,
        startResumes: [],
      },
    ]),
  )(
    'unheldGuard_SendListsFirst given $arrangement and $at',
    async ({
      arrangement,
      list,
      script,
      rejects,
      logged,
      attaches,
      startResumes,
    }) => {
      const { test, held } = await unheldRow(arrangement);
      held.list = list;
      if (script !== null) {
        test.harness.scriptAttach('p1', script);
      }
      const attachesBefore = test.harness.attachCalls.length;

      const sending = test.chat.send(ROW_ID, message);
      if (rejects === null) {
        await sending;
      } else {
        await expect(sending).rejects.toThrow(rejects);
      }
      await flush();

      const newAttaches = test.harness.attachCalls.slice(attachesBefore);
      expect(newAttaches.map((request) => request.processId)).toEqual(
        Array.from({ length: attaches }, () => 'p1'),
      );
      expect(startsOf(test).map((start) => start.request.resume)).toEqual(
        startResumes,
      );
      if (logged !== null) {
        expect(test.logged).toContain(logged);
      }
      if (rejects === null) {
        const process = test.harness.processes.at(-1);
        expect(process?.calls).toContainEqual(sendCall(message));
      }
    },
  );

  it.each([
    {
      given: 'an unheld row',
      arrange: async () => (await unheldRow('profileBack')).test,
    },
    {
      given: 'an attach that then rejects',
      arrange: () => {
        const test = setUp();
        test.harness.scriptAttach('p1', {
          outcome: 'reject',
          message: 'defs failed',
        });
        restoreOne(test, hostedRecord({ sent: true }), [hostedP1()]);
        return Promise.resolve(test);
      },
    },
  ])(
    'unheldGuard_ClosedRow_LogsTheProcessLeftRunning given $given',
    async ({ arrange }) => {
      const test = await arrange();

      test.chat.closed(ROW_ID);
      await flush();

      expect(test.logged).toContain(
        `session ${ROW_ID} closed; process p1 left running on the session host`,
      );
      expect(test.ownedEnds()).toBe(1);
    },
  );

  it('unheldGuard_ClearedRow_LogsAndStartsFresh', async () => {
    const { test } = await unheldRow('profileBack');

    test.chat.clear(ROW_ID);
    await flush();

    expect(test.logged).toContain(
      `session ${ROW_ID} cleared; process p1 left running on the session host`,
    );
    expect(startsOf(test).map((start) => start.request.resume)).toEqual([
      false,
    ]);
    expect(test.harness.attachCalls).toEqual([]);
  });

  it('send_OlderHostProcess_RefusedUntilItEnds', async () => {
    const held = { list: () => Promise.resolve<HostedProcessInfo[]>([]) };
    const test = setUp({ sessionHost: { list: () => held.list() } });
    const older = [hostedP1({ current: false })];
    restoreOne(test, hostedRecord({ sent: true }), older);
    expect(test.logged).toContain(
      `session ${ROW_ID} waits on process p1 in another app version`,
    );

    held.list = () => Promise.resolve(older);
    await expect(test.chat.send(ROW_ID, message)).rejects.toThrow(
      OLDER_HOST_REFUSAL,
    );
    expect(test.harness.processes).toEqual([]);

    held.list = () => Promise.reject(new Error('no host'));
    await expect(test.chat.send(ROW_ID, message)).rejects.toThrow('no host');
    expect(test.logged).toContain('session host not listed: no host');
    expect(test.harness.processes).toEqual([]);
    expect(noticesOf(test).map((notice) => notice.text)).toEqual([
      OLDER_HOST_NOTICE,
    ]);

    held.list = () => Promise.resolve([hostedP1({ running: false })]);
    await test.chat.send(ROW_ID, message);
    await flush();

    expect(noticesOf(test).map((notice) => notice.text)).not.toContain(
      OLDER_HOST_NOTICE,
    );
    expect(
      test
        .sent('entries')
        .flatMap(({ entries }) => entries)
        .map((entry) => (entry.kind === 'notice' ? entry.text : null)),
    ).not.toContain(OLDER_HOST_NOTICE);
    expect(
      test.harness.pastSessionCalls.filter((call) => call.method === 'history'),
    ).toHaveLength(1);
    expect(startsOf(test).map((start) => start.request.resume)).toEqual([true]);
  });

  it('loadHistory_OlderHostRow_ReadsNothing', async () => {
    const test = setUp();
    const older = [hostedP1({ current: false })];
    restoreOne(test, hostedRecord({ sent: true }), older);

    test.sessionHost.setList(older);
    await test.chat.loadHistory(ROW_ID);
    expect(test.harness.pastSessionCalls).toEqual([]);

    test.sessionHost.setList([hostedP1({ running: false })]);
    await test.chat.loadHistory(ROW_ID);

    expect(test.harness.pastSessionCalls.map((call) => call.before)).toEqual([
      null,
    ]);
  });

  it('send_RestingRowWithSavedQueued_WritesTheSavedFirst', async () => {
    const test = setUp();
    restoreOne(
      test,
      record('host-a', { queued: [{ text: 'a', images: [] }] }),
      [],
    );

    const sending = test.chat.send(ROW_ID, message);

    expect(startsOf(test)).toHaveLength(1);
    expect(
      startsOf(test)[0].calls.flatMap((call) =>
        call.method === 'send' ? [call.text] : [],
      ),
    ).toEqual(['a']);
    expect(test.chat.sessions()[0].queued.map((row) => row.text)).toEqual([
      'c',
    ]);
    await sending;
  });
});

describe('createChatSessions stopAll', () => {
  it('stopAll_KillsEveryRunningProcess_RowsRestWithStoppedNotice', async () => {
    const test = setUp();
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'work' });
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();

    test.chat.stopAll();
    await flush();

    for (const process of test.harness.processes) {
      expect(process.calls).toEqual([{ method: 'kill' }]);
    }
    const stopped = [{ kind: 'notice', tone: 'info', text: STOPPED_NOTICE }];
    expect(noticesOf(test, 0)).toEqual(stopped);
    expect(noticesOf(test, 1)).toEqual(stopped);
    expect(test.chat.sessions().map((state) => state.running)).toEqual([
      false,
      false,
    ]);
    expect(test.logged).toContain('stopped 2 session process(es)');
  });

  it('stopAll_WorkingRow_RaisesNoAlertAndWritesNothingQueued', async () => {
    const test = await started();
    const queued = { text: 'queued', images: [] };
    test.setFocused(false);
    test.activity('working');
    await test.chat.send(ROW_ID, queued);

    test.chat.stopAll();
    // The harness reports a closed process idle before its `ended`.
    test.activity('idle');
    await flush();

    expect(test.process.calls).toEqual([{ method: 'kill' }]);
    expect(test.announced).toEqual([]);
    expect(test.marked).toEqual([]);
    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [queued] },
    ]);
    expect(noticesOf(test).map((notice) => notice.text)).toEqual([
      STOPPED_NOTICE,
    ]);
  });

  it('stopAll_SkipsAnAttachingRow', async () => {
    const test = await started();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      turns: 0,
      replay() {},
    });
    restoreOne(test, hostedRecord(), [hostedP1()]);

    test.chat.stopAll();
    await flush();

    expect(test.process.calls).toEqual([{ method: 'kill' }]);
    expect(test.logged).toContain('session row-2 still attaching; not stopped');
    expect(test.logged).toContain('stopped 1 session process(es)');
    expect(attachedOf(test)[0].calls).toEqual([]);
  });
});

const answerA: SendGate = () => ({ action: 'compact', reason: 'a' });
const answerB: SendGate = () => ({ action: 'compact', reason: 'b' });
const LATER: UserMessage = { text: 'later', images: [] };

function compactionStartedEvent(
  trigger: CompactionTrigger,
  at = 2000,
): AgentEvent {
  return { type: 'compactionStarted', at, trigger };
}

function compactionEndedEvent(
  outcome: 'done' | 'failed' | 'interrupted',
  trigger: CompactionTrigger = 'app',
): AgentEvent {
  return {
    type: 'compactionEnded',
    at: 3000,
    trigger,
    outcome,
    beforeTokens: null,
    durationMs: null,
  };
}

// A running session whose idle send of IDLE_SEND is held with reason `a`, row
// `queued-1`, the fake keeping its compaction open.
async function startedAndHeld(options?: Parameters<typeof setUp>[0]) {
  const test = await started(options);
  test.harness.holdCompactions();
  test.chat.addSendGate(answerA);
  await test.chat.send(ROW_ID, IDLE_SEND);
  await flush();
  return test;
}

describe('createChatSessions send gate and hold', () => {
  it.each([
    {
      given: 'no gate',
      gates: [] as SendGate[],
      disposes: false,
      calls: [sendCall(IDLE_SEND)],
      reasons: [] as (string | null)[],
      logged: [] as string[],
    },
    {
      given: 'a null gate',
      gates: [() => null],
      disposes: false,
      calls: [sendCall(IDLE_SEND)],
      reasons: [],
      logged: [],
    },
    {
      given: 'a null gate then A',
      gates: [() => null, answerA],
      disposes: false,
      calls: [{ method: 'compact' }],
      reasons: ['a'],
      logged: ['send held in row-1: a'],
    },
    {
      given: 'A then B',
      gates: [answerA, answerB],
      disposes: false,
      calls: [{ method: 'compact' }],
      reasons: ['a'],
      logged: ['send held in row-1: a'],
    },
    {
      given: 'a gate that throws then A',
      gates: [
        () => {
          throw new Error('boom');
        },
        answerA,
      ],
      disposes: false,
      calls: [{ method: 'compact' }],
      reasons: ['a'],
      logged: ['send gate failed in row-1: boom', 'send held in row-1: a'],
    },
    {
      given: 'A disposed twice',
      gates: [answerA],
      disposes: true,
      calls: [sendCall(IDLE_SEND)],
      reasons: [],
      logged: [],
    },
  ])(
    'sendGate_IdleSend_FirstVerdictWinsInRegistrationOrder: $given',
    async ({ gates, disposes, calls, reasons, logged }) => {
      const test = await started();
      test.harness.holdCompactions();
      const disposers = gates.map((gate) => test.chat.addSendGate(gate));
      if (disposes) {
        disposers.forEach((handle) => {
          handle.dispose();
          handle.dispose();
        });
      }

      await test.chat.send(ROW_ID, IDLE_SEND);

      expect(test.process.calls).toEqual(calls);
      expect(
        test.chat.sessions()[0].queued.map((row) => row.holdReason),
      ).toEqual(reasons);
      expect(test.logged).toEqual(expect.arrayContaining(logged));
    },
  );

  it('sendGate_SameFunctionAddedTwice_DisposeRemovesOnlyItsRegistration', async () => {
    const test = await started();
    test.harness.holdCompactions();
    const handle = test.chat.addSendGate(answerA);
    test.chat.addSendGate(answerA);

    handle.dispose();
    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(test.process.calls).toEqual([{ method: 'compact' }]);
  });

  it('sendGate_LaterGateAfterAVerdict_NotAsked', async () => {
    const test = await started();
    test.harness.holdCompactions();
    let laterCalls = 0;
    test.chat.addSendGate(answerA);
    test.chat.addSendGate(() => {
      laterCalls += 1;
      return null;
    });

    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(laterCalls).toBe(0);
  });

  it('sendGate_Input_RowHostTextAndNow', async () => {
    const test = await started({ clockNow: 5000 });
    const inputs: SendGateInput[] = [];
    test.chat.addSendGate((input) => {
      inputs.push(input);
      return null;
    });

    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(inputs).toEqual([
      {
        sessionId: 'row-1',
        hostSessionId: 'uuid-1',
        text: IDLE_SEND.text,
        now: 5000,
      },
    ]);
  });

  it.each<{
    given: string;
    act(test: Awaited<ReturnType<typeof started>>): unknown;
    asked: number;
  }>([
    {
      given: 'a send while a turn runs',
      act: (test) => {
        test.activity('working');
        return test.chat.send(ROW_ID, IDLE_SEND);
      },
      asked: 0,
    },
    {
      given: 'an idle that drains a queued row',
      act: (test) => {
        queueTwo(test);
        test.activity('idle');
      },
      asked: 0,
    },
    {
      given: 'sendNow on a queued row',
      act: (test) => {
        queueTwo(test);
        test.chat.sendNow(ROW_ID, 'queued-1');
      },
      asked: 0,
    },
    {
      given: 'a launch',
      act: (test) =>
        test.chat.launch({
          projectDir: PROJECT_DIR,
          profile: 'personal',
          message: IDLE_SEND,
        }),
      asked: 0,
    },
    {
      given: 'sendAllNow at idle with a message',
      act: (test) => test.chat.sendAllNow(ROW_ID, IDLE_SEND),
      asked: 1,
    },
  ])('sendGate_NotAskedOffTheIdleWrite: $given', async ({ act, asked }) => {
    const test = await started();
    let calls = 0;
    test.chat.addSendGate(() => {
      calls += 1;
      return null;
    });

    await act(test);

    expect(calls).toBe(asked);
  });

  it('send_RestingRowHeld_StartsProcessThenCompacts', async () => {
    const test = setUp();
    test.harness.holdCompactions();
    test.chat.addSendGate(answerA);
    test.chat.restore(
      {
        sessions: [record('host-a', { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );

    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(test.harness.processes[0].calls).toEqual([{ method: 'compact' }]);
    const startedAt = test.logged.indexOf(
      'session row-1 process started (resume true)',
    );
    expect(startedAt).toBeGreaterThanOrEqual(0);
    expect(test.logged.indexOf('send held in row-1: a')).toBeGreaterThan(
      startedAt,
    );
  });

  it('send_TwoSendsToARestingRow_OneVerdictAndTwoRows', async () => {
    const test = setUp();
    test.harness.holdCompactions();
    let asked = 0;
    test.chat.addSendGate(() => {
      asked += 1;
      return { action: 'compact', reason: 'a' };
    });
    test.chat.restore(
      {
        sessions: [record('host-a', { sent: true })],
        selectedHostSessionId: null,
      },
      [],
    );

    await Promise.all([
      test.chat.send(ROW_ID, IDLE_SEND),
      test.chat.send(ROW_ID, LATER),
    ]);

    expect(asked).toBe(1);
    expect(test.harness.processes[0].calls).toEqual([{ method: 'compact' }]);
    expect(
      test.chat.sessions()[0].queued.map((row) => [row.text, row.holdReason]),
    ).toEqual([
      [IDLE_SEND.text, 'a'],
      [LATER.text, null],
    ]);
  });

  it('send_SavedRowsBehindAHold_WriteNoneUntilTheCompactionEnds', async () => {
    const test = setUp();
    test.harness.holdCompactions();
    test.chat.addSendGate(answerA);
    test.chat.restore(
      {
        sessions: [record('host-a', { queued: [PENDING] })],
        selectedHostSessionId: null,
      },
      [],
    );

    await test.chat.send(ROW_ID, IDLE_SEND);
    const process = test.harness.processes[0];
    process.events.activity('idle');

    expect(process.calls).toEqual([{ method: 'compact' }]);
    process.events.agentEvent(compactionEndedEvent('done'));
    expect(process.calls.at(-1)).toEqual(sendCall(PENDING));
  });

  it.each(['done', 'failed', 'interrupted'] as const)(
    'hold_LaterSendsQueueBehindAndReleaseInOrder: %s',
    async (outcome) => {
      const test = await startedAndHeld();
      const third: UserMessage = { text: 'third', images: [] };
      await test.chat.send(ROW_ID, LATER);
      await test.chat.send(ROW_ID, third);
      expect(test.chat.sessions()[0].queued.map((row) => row.text)).toEqual([
        IDLE_SEND.text,
        LATER.text,
        third.text,
      ]);

      test.activity('idle');
      expect(test.process.calls).toEqual([{ method: 'compact' }]);

      test.process.events.agentEvent(compactionEndedEvent(outcome));
      expect(test.process.calls.at(-1)).toEqual(sendCall(IDLE_SEND));
      expect(test.logged).toContain(
        `held message queued-1 released in row-1 (${outcome})`,
      );
      test.activity('idle');
      expect(test.process.calls.at(-1)).toEqual(sendCall(LATER));
      test.activity('idle');
      expect(test.process.calls.at(-1)).toEqual(sendCall(third));
    },
  );

  it('hold_CompactThrows_WritesAtOnce', async () => {
    const test = await started();
    let asked = 0;
    test.chat.addSendGate(() => {
      asked += 1;
      return asked === 2 ? { action: 'compact', reason: 'a' } : null;
    });

    void test.chat.send(ROW_ID, { text: FAKE_HOLD_TEXT, images: [] });
    await test.chat.send(ROW_ID, IDLE_SEND);

    expect(test.process.calls.at(-1)).toEqual(sendCall(IDLE_SEND));
    expect(test.logged).toContain(
      'compaction not started in row-1: fake agent is running a turn',
    );
    expect(test.chat.sessions()[0].queued).toEqual([]);
  });

  it('hold_CompactAndThenSendThrow_SendRejectsWithNoRowLeft', async () => {
    const test = await startedRefusing();
    const refused: UserMessage = { text: REFUSED_TEXT, images: [] };
    test.chat.addSendGate((input) =>
      input.text === REFUSED_TEXT ? { action: 'compact', reason: 'a' } : null,
    );

    void test.chat.send(ROW_ID, { text: FAKE_HOLD_TEXT, images: [] });

    await expect(test.chat.send(ROW_ID, refused)).rejects.toThrow(
      'write refused',
    );
    expect(test.chat.sessions()[0].queued).toEqual([]);
  });

  it.each(['app', 'manual', 'harness'] as const)(
    'compaction_StateFollowsStartedAndEnded: %s',
    async (trigger) => {
      const test = await started({ clockNow: 2000 });
      expect(test.chat.sessions()[0].compaction).toBeNull();
      expect(test.sent('sessionStarted')[0].compaction).toBeNull();
      if (trigger === 'app') {
        test.harness.holdCompactions();
        test.chat.addSendGate(answerA);
        await test.chat.send(ROW_ID, IDLE_SEND);
        await flush();
      } else {
        test.process.events.agentEvent(compactionStartedEvent(trigger));
      }
      const running = {
        trigger,
        reason: trigger === 'app' ? 'a' : null,
        startedAt: 2000,
      };
      expect(test.chat.sessions()[0].compaction).toEqual(running);

      test.process.events.agentEvent(compactionEndedEvent('done', trigger));

      expect(test.chat.sessions()[0].compaction).toBeNull();
      expect(test.sent('compaction')).toEqual([
        { sessionId: ROW_ID, compaction: running },
        { sessionId: ROW_ID, compaction: null },
      ]);
    },
  );

  it('compaction_NoHold_QueuedRowsWaitForItsEnd', async () => {
    const test = await started();
    const [first] = queueTwo(test);
    test.process.events.agentEvent(compactionStartedEvent('manual'));

    test.activity('idle');
    expect(test.process.calls).toEqual([]);

    test.process.events.agentEvent(compactionEndedEvent('done', 'manual'));
    expect(test.process.calls).toEqual([sendCall(first)]);
  });

  it('compaction_EndWithNoStart_SendsNoMessage', async () => {
    const test = await started();

    test.process.events.agentEvent(compactionEndedEvent('done'));

    expect(test.sent('compaction')).toEqual([]);
  });

  it('compaction_Replayed_EndDrainsOnlyAtTheAttachSettling', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      replay(events) {
        events.agentEvent(compactionStartedEvent('harness'));
        events.agentEvent(compactionEndedEvent('done', 'harness'));
      },
    });

    restoreOne(test, hostedRecord({ queued: [PENDING] }), [hostedP1()]);
    await flush();

    expect(attachedOf(test)[0].calls).toEqual([sendCall(PENDING)]);
    expect(test.logged).not.toContainEqual(expect.stringContaining('not sent'));
  });

  it('compaction_ReplayLeavesOneRunning_QueueWaitsForItsLiveEnd', async () => {
    const test = setUp();
    test.harness.scriptAttach('p1', {
      outcome: 'process',
      replay(events) {
        events.agentEvent(compactionStartedEvent('harness'));
      },
    });

    restoreOne(test, hostedRecord({ queued: [PENDING] }), [hostedP1()]);
    await flush();

    const attached = attachedOf(test)[0];
    expect(attached.calls).toEqual([]);
    attached.events.agentEvent(compactionEndedEvent('done', 'harness'));
    expect(attached.calls).toEqual([sendCall(PENDING)]);
  });

  it.each<{
    given: string;
    end(test: Awaited<ReturnType<typeof started>>): void;
  }>([
    {
      given: 'the process ends',
      end: (test) => test.process.events.ended({ code: 0, error: null }),
    },
    {
      given: 'a clear',
      end: (test) => test.chat.clear(ROW_ID),
    },
  ])('hold_$given_ReturnsRowsAndClears', async ({ end }) => {
    const test = await startedAndHeld();
    await test.chat.send(ROW_ID, LATER);

    end(test);

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [IDLE_SEND, LATER] },
    ]);
    expect(test.chat.sessions()[0].compaction).toBeNull();
    expect(test.sent('compaction').at(-1)?.compaction).toBeNull();
  });

  it.each<{
    given: string;
    arrange(): ReturnType<typeof started>;
    end(test: Awaited<ReturnType<typeof started>>): void;
    ends: { trigger: CompactionTrigger; outcome: string }[];
  }>([
    {
      given: 'a clear, whose old process reports its end too late',
      arrange: () => startedAndHeld(),
      end: (test) => test.chat.clear(ROW_ID),
      ends: [{ trigger: 'app', outcome: 'interrupted' }],
    },
    {
      given: 'a clear with no compaction running',
      arrange: () => started(),
      end: (test) => test.chat.clear(ROW_ID),
      ends: [],
    },
    {
      given: 'an exit the harness ended it before',
      arrange: () => startedAndHeld(),
      end: (test) => {
        const { events } = test.process;
        events.agentEvent(compactionEndedEvent('failed'));
        events.agentEvent({ type: 'sessionEnded', at: 3000 });
        events.ended({ code: 0, error: null });
      },
      ends: [{ trigger: 'app', outcome: 'failed' }],
    },
  ])(
    'compaction_ProcessLetGo_AgentEventCarriesOneEnd: $given',
    async ({ arrange, end, ends }) => {
      const test = await arrange();

      end(test);
      await flush();

      expect(
        compactionEndsEmitted(test.emitted).map(({ event }) => ({
          trigger: event.trigger,
          outcome: event.outcome,
        })),
      ).toEqual(ends);
    },
  );

  it('compaction_Clear_EmittedEndCarriesTheOldHostAndNoSizes', async () => {
    const test = await startedAndHeld({ clockNow: 2000 });

    test.chat.clear(ROW_ID);

    expect(compactionEndsEmitted(test.emitted)).toEqual([
      {
        sessionId: ROW_ID,
        profileDir: '~/.claude-personal',
        hostSessionId: 'uuid-1',
        replayed: false,
        event: {
          type: 'compactionEnded',
          at: 2000,
          trigger: 'app',
          outcome: 'interrupted',
          beforeTokens: null,
          durationMs: null,
        },
      },
    ]);
  });

  it('compaction_FailedAttach_AgentEventCarriesItsEnd', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const test = setUp({
      harnesses: [
        {
          ...fake,
          attach: (_request, events) => {
            events.agentEvent(compactionStartedEvent('harness'));
            return Promise.resolve(null);
          },
        },
      ],
    });

    restoreOne(test, hostedRecord(), [hostedP1()]);
    await flush();

    expect(test.chat.sessions()[0].compaction).toBeNull();
    expect(
      compactionEndsEmitted(test.emitted).map(({ event, replayed }) => [
        event.trigger,
        event.outcome,
        replayed,
      ]),
    ).toEqual([['harness', 'interrupted', false]]);
  });

  it.each<{
    given: string;
    skip(test: Awaited<ReturnType<typeof started>>): void;
  }>([
    {
      given: 'interrupt',
      skip: (test) => test.chat.interrupt(ROW_ID),
    },
    {
      given: 'sendNow on the held row',
      skip: (test) => test.chat.sendNow(ROW_ID, 'queued-1'),
    },
    {
      given: 'sendAllNow with no message',
      skip: (test) => void test.chat.sendAllNow(ROW_ID, null),
    },
  ])('hold_Skip_KeepsRowsAndWritesInOrder: $given', async ({ skip }) => {
    const test = await startedAndHeld();
    await test.chat.send(ROW_ID, LATER);

    skip(test);

    expect(test.process.calls).toEqual([
      { method: 'compact' },
      { method: 'interrupt' },
    ]);
    expect(test.sentReturned()).toEqual([]);
    expect(
      test.chat.sessions()[0].queued.map((row) => row.sentEntryId),
    ).toEqual([null, null]);
    expect(test.logged).toContain('skipping the compaction in row-1');

    await flush();

    expect(test.process.calls).toEqual([
      { method: 'compact' },
      { method: 'interrupt' },
      sendCall(IDLE_SEND),
      sendCall(LATER),
    ]);
  });

  it('sendAllNow_HoldUp_QueuesTheBoxBehindAndSkips', async () => {
    const test = await startedAndHeld();

    const sending = test.chat.sendAllNow(ROW_ID, LATER);

    expect(test.process.calls).toEqual([
      { method: 'compact' },
      { method: 'interrupt' },
    ]);
    expect(
      test.chat
        .sessions()[0]
        .queued.map((row) => [row.text, row.sentEntryId, row.holdReason]),
    ).toEqual([
      [IDLE_SEND.text, null, 'a'],
      [LATER.text, null, null],
    ]);
    await sending;
  });

  it('sendNow_UnsentRowBehindTheHeldRow_WritesIt', async () => {
    const test = await startedAndHeld();
    await test.chat.send(ROW_ID, LATER);

    test.chat.sendNow(ROW_ID, 'queued-2');

    expect(test.process.calls).toEqual([
      { method: 'compact' },
      sendCall(LATER),
    ]);
    expect(test.chat.sessions()[0].queued[0].holdReason).toBe('a');
  });

  it('sendAllNow_CompactionUpNoHold_WritesAllAndAsksNoGate', async () => {
    const test = await started();
    let asked = 0;
    test.chat.addSendGate(() => {
      asked += 1;
      return null;
    });
    test.process.events.agentEvent(compactionStartedEvent('manual'));
    await test.chat.send(ROW_ID, IDLE_SEND);

    await test.chat.sendAllNow(ROW_ID, LATER);

    expect(asked).toBe(0);
    expect(test.process.calls).toEqual([sendCall(IDLE_SEND), sendCall(LATER)]);
  });

  it('pullBack_HeldRow_ReturnsItAndTheCompactionGoesOn', async () => {
    const test = await startedAndHeld();
    await test.chat.send(ROW_ID, LATER);

    test.chat.pullBack(ROW_ID, 'queued-1');

    expect(test.sentReturned()).toEqual([
      { sessionId: ROW_ID, messages: [IDLE_SEND] },
    ]);
    expect(test.process.calls).toEqual([{ method: 'compact' }]);
    expect(test.chat.sessions()[0].compaction).not.toBeNull();
    test.activity('idle');
    expect(test.process.calls).toEqual([{ method: 'compact' }]);

    test.process.events.agentEvent(compactionEndedEvent('done'));

    expect(test.process.calls.at(-1)).toEqual(sendCall(LATER));
  });

  it.each<{
    given: string;
    act(test: Awaited<ReturnType<typeof started>>): Promise<void>;
    alerts: number;
  }>([
    {
      given: 'a pulled-back compaction, its stretch held no turn',
      act: async (test) => {
        test.chat.pullBack(ROW_ID, 'queued-1');
        test.harness.releaseCompactions();
        await flush();
      },
      alerts: 0,
    },
    {
      given: 'an idle before the compaction ends, in the skip grace order',
      act: async (test) => {
        test.chat.interrupt(ROW_ID);
        test.activity('idle');
        expect(test.announced).toEqual([]);
        await flush();
      },
      alerts: 1,
    },
    {
      given: 'the held row written at the end, its own turn',
      act: async (test) => {
        test.harness.releaseCompactions();
        await flush();
      },
      alerts: 1,
    },
    {
      given: 'a later stretch after a pulled-back compaction',
      act: async (test) => {
        test.chat.pullBack(ROW_ID, 'queued-1');
        test.harness.releaseCompactions();
        await flush();
        test.activity('working');
        test.activity('idle');
      },
      alerts: 1,
    },
    {
      given: 'a stretch of the fresh process after a clear',
      act: async (test) => {
        test.chat.clear(ROW_ID);
        await flush();
        const fresh = test.harness.processes[1];
        fresh.events.activity('working');
        fresh.events.activity('idle');
      },
      alerts: 1,
    },
  ])('hold_TurnFinishedAlert: $given', async ({ act, alerts }) => {
    const test = await startedAndHeld();
    test.setFocused(false);

    await act(test);

    expect(test.announced).toHaveLength(alerts);
  });

  it('hold_IdleAfterARowBehindWasSentNow_NoAlertWhileTheHoldIsUp', async () => {
    const test = await startedAndHeld();
    test.setFocused(false);
    await test.chat.send(ROW_ID, LATER);
    test.chat.sendNow(ROW_ID, 'queued-2');

    test.activity('idle');

    expect(test.announced).toEqual([]);
  });

  it('hold_IdleWithNoCompaction_WritesTheRowAndALaterEndReleasesNothing', async () => {
    const fake = createFakeAgentHarness(
      { now: () => 1000 },
      createMemoryFiles(),
      FAKE_MICROTASK_TIMERS,
    );
    const test = setUp({
      harnesses: [
        {
          ...fake,
          start: (request, events) => ({
            ...fake.start(request, events),
            compact: () => undefined,
          }),
        },
      ],
    });
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    const { calls, events } = fake.processes[0];
    test.chat.addSendGate(answerA);
    await test.chat.send(ROW_ID, IDLE_SEND);

    events.activity('idle');
    expect(calls).toEqual([]);
    expect(test.chat.sessions()[0].queued).toHaveLength(1);

    events.activity('working');
    events.activity('idle');
    expect(calls).toEqual([sendCall(IDLE_SEND)]);
    expect(test.logged).toContain(
      'held message queued-1 released in row-1: idle with no compaction',
    );

    events.agentEvent(compactionEndedEvent('failed'));
    expect(calls).toEqual([sendCall(IDLE_SEND)]);
    expect(test.logged).not.toContainEqual(expect.stringContaining('(failed)'));
  });

  it.each<{
    given: string;
    register(chat: ChatSessions): void;
    tokens: number | null;
    logged: string | null;
  }>([
    {
      given: 'a reader of 150000',
      register: (chat) => chat.addIdleCompactThreshold(() => 150_000),
      tokens: 150_000,
      logged: null,
    },
    {
      given: 'no reader',
      register: () => undefined,
      tokens: null,
      logged: null,
    },
    {
      given: 'a removed reader',
      register: (chat) => {
        const handle = chat.addIdleCompactThreshold(() => 150_000);
        handle.dispose();
        handle.dispose();
      },
      tokens: null,
      logged: null,
    },
    {
      given: 'two readers',
      register: (chat) => {
        chat.addIdleCompactThreshold(() => 1);
        chat.addIdleCompactThreshold(() => 2);
      },
      tokens: 2,
      logged: null,
    },
    {
      given: 'a newest reader that throws over an older one',
      register: (chat) => {
        chat.addIdleCompactThreshold(() => 1);
        chat.addIdleCompactThreshold(() => {
          throw new Error('boom');
        });
      },
      tokens: null,
      logged: 'idle compaction threshold failed in row-1: boom',
    },
  ])(
    'idleCompactThreshold_ProcessStart_CarriesTheNewestReader: $given',
    ({ register, tokens, logged }) => {
      const test = setUp();
      register(test.chat);

      test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });

      expect(test.harness.processes[0].request.idleCompactMinTokens).toBe(
        tokens,
      );
      if (logged !== null) {
        expect(test.logged).toContain(logged);
      }
    },
  );
});
