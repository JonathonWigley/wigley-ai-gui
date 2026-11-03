import { describe, expect, it } from 'vitest';
import {
  type AgentEvent,
  type ChatEntry,
  MAIN_AGENT_ID,
  type ProcessActivity,
  type SessionControl,
  type UserMessage,
} from '../../../contracts/agent';
import {
  createFakeAgentHarness,
  FAKE_MICROTASK_TIMERS,
  FAKE_PAST_SESSIONS,
  type FakeAgentHarness,
  fakePlanRowUpdate,
  fakeUsageEvent,
} from '../../../shared/fake-agent-harness';
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
import type { ChatChannel, ChatMainEvents, ChatProfile } from '../contract';
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
  } = {},
) {
  const clock = { now: () => options.clockNow ?? 1000 };
  const harness = createFakeAgentHarness(
    clock,
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
  const harnesses = options.harnesses ?? [harness];
  const data = createMemoryFiles();
  const logged: string[] = [];
  const log = (source: string, message: string) =>
    logged.push(`[${source}] ${message}`);
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
        sessionId: 'uuid-1',
        resume: false,
        projectDir: PROJECT_DIR,
        profileDir: '~/.claude-personal',
        controls: {},
        instructions: [],
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
        commands: [],
        running: false,
        queued: [],
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
      sessionId: hostId,
      resume: true,
      projectDir: '/w/app',
      profileDir: '~/.claude',
      controls: {},
      instructions: [],
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
    test.chat.restore({
      sessions: [record(PAST_ONE.sessionId)],
      selectedHostSessionId: null,
    });
    test.chat.sessionConnected(connected(ROW_ID, PAST_ONE.sessionId));
    test.chat.sessionConnected(connected('row-relay', PAST_TWO.sessionId));

    const rows = await test.chat.pastSessions('/w/app', 'work');

    expect(rows.map((row) => row.hostSessionId)).toEqual([PAST_ONE.sessionId]);
  });

  it('resume_HostIdChatHolds_SelectsExistingRow', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;
    test.chat.restore({
      sessions: [record(hostId)],
      selectedHostSessionId: null,
    });
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
      test.chat.restore({ sessions: saved, selectedHostSessionId: null });
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
      case: 'ConfirmedPicksFollowLaterReport',
      picks: [
        ['model', 'fake-large'],
        ['effort', 'low'],
      ],
      confirms: true,
      clears: false,
      reported: { mode: 'auto', model: 'opus', effort: 'high' },
      controls: { mode: 'auto', model: 'opus', effort: 'high' },
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
    async ({ picks, confirms, clears, reported, controls }) => {
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
      current.events.controls(
        Object.entries(reported).map(([id, value]) => ({
          id,
          label: id,
          choices: [],
          value,
        })),
      );
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

  it('killAll_KillsAHeldSessionsProcess', async () => {
    const test = await started();

    test.chat.killAll();

    expect(test.process.calls).toContainEqual({ method: 'kill' });
  });

  it('killAll_KillsAClosedSessionStillEnding', async () => {
    const test = await started();
    test.harness.holdEnd();
    test.chat.closed(ROW_ID);

    test.chat.killAll();

    expect(test.process.calls).toContainEqual({ method: 'kill' });
  });

  it('killAll_SkipsAnExitedProcess', async () => {
    const test = await started();
    test.process.events.ended({ code: 0, error: null });

    test.chat.killAll();

    expect(test.process.calls).not.toContainEqual({ method: 'kill' });
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
    test.chat.killAll();

    expect(test.chat.sessions()[0].running).toBe(true);
    expect(test.chat.sessions()[0].entries).toEqual(entriesBefore);
    expect(test.sent('sessionRested')).toHaveLength(1);
    expect(later.calls).toContainEqual({ method: 'kill' });
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

    expect(test.sent('returned')).toEqual([
      { sessionId: ROW_ID, messages: [second] },
    ]);
    expect(test.sent('queued').at(-1)).toEqual({
      sessionId: ROW_ID,
      queued: [{ ...first, id: firstId, sentEntryId: null }],
    });

    test.activity('idle');
    const sentBefore = test.messages.length;
    test.chat.pullBack(ROW_ID, firstId);

    expect(test.messages).toHaveLength(sentBefore);
    expect(test.logged).toContain(
      `[chat] queued message ${firstId} no longer queued`,
    );
  });

  it('interrupt_Queued_ReturnsAllThenInterrupts', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);

    test.chat.interrupt(ROW_ID);

    expect(test.sent('returned')).toEqual([
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

      expect(test.sent('returned')).toEqual([
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
      { ...first, id: 'queued-1', sentEntryId: null },
      { ...second, id: 'queued-2', sentEntryId: expect.any(String) },
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
      `[chat] queued message ${row.queuedId} ${row.reason}`,
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
        queued: [{ ...first, id: 'queued-1', sentEntryId: null }],
      },
    ]);
    expect(test.sent('returned')).toEqual([]);
  });

  it.each([
    {
      case: 'a sent row',
      arrange: (test: Awaited<ReturnType<typeof started>>) => {
        const [first, second] = queueTwo(test);
        test.chat.sendNow(ROW_ID, 'queued-2');
        return {
          entryId: sentEntryIdOf(test, 1),
          sends: [
            {
              message: 'queued',
              data: {
                sessionId: ROW_ID,
                queued: [{ ...first, id: 'queued-1', sentEntryId: null }],
              },
            },
            {
              message: 'returned',
              data: { sessionId: ROW_ID, messages: [second] },
            },
          ],
          log: `[chat] sent message ${sentEntryIdOf(test, 1)} returned: never taken in`,
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
          sends: [
            {
              message: 'returned',
              data: { sessionId: ROW_ID, messages: [message] },
            },
          ],
          log: '[chat] sent message user-1 returned: never taken in',
        };
      },
    },
    {
      case: 'an id chat holds nothing for',
      arrange: () => ({
        entryId: 'user-9',
        sends: [],
        log: '[chat] dropped message user-9 not held',
      }),
    },
  ])('messageDropped_ReturnsWhatChatHolds: $case', async (row) => {
    const test = await started();
    const { entryId, sends, log } = row.arrange(test);
    const sentBefore = test.messages.length;

    test.process.events.messageDropped(entryId);

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
    expect(test.logged).toContain(
      '[chat] queued message queued-1 already sent',
    );
  });

  it('interrupt_SentAndUnsentRows_ReturnsOnlyTheUnsent', async () => {
    const test = await started();
    const [first, second] = queueTwo(test);
    test.chat.sendNow(ROW_ID, 'queued-1');

    test.chat.interrupt(ROW_ID);

    expect(test.sent('returned')).toEqual([
      { sessionId: ROW_ID, messages: [second] },
    ]);
    expect(test.chat.sessions()[0].queued).toEqual([
      { ...first, id: 'queued-1', sentEntryId: expect.any(String) },
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
      };
      const unsentRow = { ...second, id: 'queued-2', sentEntryId: null };
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

      expect(test.sent('returned')).toEqual([
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

    test.chat.restore({
      sessions: [record('host-a'), record('host-b'), record('host-c')],
      selectedHostSessionId: 'host-b',
    });

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
      logged: '[chat] session uuid-1 already open; not restored',
    },
    {
      given: 'a host id open on a relay row',
      arrange: (test: ReturnType<typeof setUp>) =>
        test.chat.sessionConnected(connected('row-relay', 'host-r')),
      saved: ['host-a', 'host-r', 'host-b'],
      opened: ['host-a', 'host-b'],
      logged: '[chat] session host-r already open; not restored',
    },
    {
      given: 'an open that throws',
      arrange: (test: ReturnType<typeof setUp>) => test.refuseOpen('host-x'),
      saved: ['host-a', 'host-x', 'host-b'],
      opened: ['host-a', 'host-b'],
      logged: '[chat] session host-x not restored: open of host-x refused',
    },
    {
      given: 'a restore after killAll',
      arrange: (test: ReturnType<typeof setUp>) => test.chat.killAll(),
      saved: ['host-a', 'host-b'],
      opened: [],
      logged: '[chat] open sessions not restored: chat is stopping',
    },
  ])(
    'restore_RecordNotOpenable_SkippedAndLogged given $given',
    ({ arrange, saved, opened, logged }) => {
      const test = setUp();
      arrange(test);

      test.chat.restore({
        sessions: saved.map((hostId) => record(hostId)),
        selectedHostSessionId: null,
      });

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

    test.chat.restore({ sessions: [saved], selectedHostSessionId: null });

    expect(test.chat.sessions()[0].entries).toEqual(
      entries.map((entry) => expect.objectContaining(entry)),
    );
  });

  it.each([{ sent: true }, { sent: false }])(
    'send_RestingRow_StartsProcessWithResumeFromSent (sent $sent)',
    async ({ sent }) => {
      const test = setUp();
      const hostId = PAST_ONE.sessionId;
      test.chat.restore({
        sessions: [record(hostId, { sent, busy: true })],
        selectedHostSessionId: null,
      });
      expect(test.harness.processes).toEqual([]);

      await test.chat.send(ROW_ID, { text: 'hi', images: [] });

      expect(test.harness.processes.map((process) => process.request)).toEqual([
        {
          sessionId: hostId,
          resume: sent,
          projectDir: '/w/app',
          profileDir: '~/.claude',
          controls: {},
          instructions: [],
        },
      ]);
      expect(test.sent('sessionRunning')).toEqual([{ sessionId: ROW_ID }]);
      expect(test.harness.processes[0].calls).toEqual([
        { method: 'send', text: 'hi', imageCount: 0 },
      ]);
      expect(test.logged).toContain(
        `[chat] session ${ROW_ID} process started (resume ${sent})`,
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
    test.chat.restore(NOTHING_SAVED);

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
      },
    ]);
  });

  it('save_BeforeRestore_WritesNothing', async () => {
    const test = setUp();
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    test.chat.send(ROW_ID, { text: 'hi', images: [] });
    await flush();
    expect(test.saved.saves()).toBe(0);

    test.chat.restore({
      sessions: [record('host-a')],
      selectedHostSessionId: null,
    });

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
      test.chat.restore({ sessions: [saved], selectedHostSessionId: null });
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
        chat.restore({
          sessions: [record('host-a')],
          selectedHostSessionId: null,
        }),
    },
    {
      given: 'a running row',
      open: (chat: ChatSessions) => {
        chat.restore(NOTHING_SAVED);
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

  it('killAll_ThenExits_SavesNothing', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    test.harness.processes[0].events.activity('working');
    const savesBefore = test.saved.saves();

    test.chat.killAll();
    await flush();

    expect(test.chat.sessions()[0].running).toBe(false);
    expect(test.saved.saves()).toBe(savesBefore);
    expect(test.saved.last()?.sessions[0].busy).toBe(true);
  });

  it('activity_IdleFlip_SavesBusy', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    const { events } = test.harness.processes[0];

    events.activity('working');
    const busyWhileWorking = test.saved.last()?.sessions[0].busy;
    events.activity('idle');

    expect(busyWhileWorking).toBe(true);
    expect(test.saved.last()?.sessions[0].busy).toBe(false);
  });

  it('loadHistory_PendingRow_PrependsOnce', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;
    test.chat.restore({
      sessions: [record(hostId, { sent: true, busy: true })],
      selectedHostSessionId: null,
    });

    await test.chat.loadHistory(ROW_ID);
    await test.chat.loadHistory(ROW_ID);

    const ids = [
      `history:${hostId}-user`,
      `history:${hostId}-assistant`,
      'app-notice-1',
    ];
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
      test.harness.pastSessionCalls.filter((call) => call.method === 'history'),
    ).toHaveLength(1);
  });

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
      test.chat.restore({ sessions: [saved], selectedHostSessionId: null });
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
    test.chat.restore({
      sessions: [record(PAST_ONE.sessionId, { sent: true, profile: 'gone' })],
      selectedHostSessionId: null,
    });
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
      test.chat.restore({
        sessions: [record(PAST_ONE.sessionId, { sent: true })],
        selectedHostSessionId: null,
      });
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
    test.chat.restore({
      sessions: [record(PAST_ONE.sessionId, { sent: true })],
      selectedHostSessionId: null,
    });

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
      logged: `[chat] send for session ${ROW_ID} closed while reading ignored`,
    },
    {
      given: 'killAll',
      duringRead: (test: ReturnType<typeof setUp>) => test.chat.killAll(),
      logged: `[chat] send for session ${ROW_ID} ignored: chat is stopping`,
    },
  ])(
    'send_RowWithHistoryPending_StoppedDuringRead_StartsNothing given $given',
    async ({ duringRead, logged }) => {
      const test = setUp();
      test.chat.restore({
        sessions: [record(PAST_ONE.sessionId, { sent: true })],
        selectedHostSessionId: null,
      });

      const sending = test.chat.send(ROW_ID, { text: 'hi', images: [] });
      duringRead(test);
      await sending;
      await flush();

      expect(test.harness.processes).toEqual([]);
      expect(test.logged).toContain(logged);
    },
  );

  it('resume_KilledWhileReading_RejectsAndOpensNothing', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;

    const resuming = test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
      title: PAST_ONE.title,
    });
    test.chat.killAll();

    await expect(resuming).rejects.toThrow(hostId);
    expect(test.opened).toEqual([]);
    expect(test.harness.processes).toEqual([]);
  });

  it('loadHistory_RowClosedWhileReading_SendsNothing', async () => {
    const test = setUp();
    test.chat.restore({
      sessions: [record(PAST_ONE.sessionId, { sent: true })],
      selectedHostSessionId: null,
    });

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
      test.chat.restore(NOTHING_SAVED);

      open(test.chat);
      await flush();

      expect(test.saved.last()?.selectedHostSessionId).toBe(selected);
    },
  );

  it('selected_ChatRowThenOtherRow_KeepsLastChatSelection', () => {
    const test = setUp();
    test.chat.restore({
      sessions: [record('host-a'), record('host-b')],
      selectedHostSessionId: null,
    });

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
      logged: '[chat] branch not read in app: git did not start',
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
        test.chat.restore({
          sessions: [record('host-a', { profile: 'personal' })],
          selectedHostSessionId: null,
        }),
      opened: [{ sessionId: ROW_ID, profileDir: '~/.claude-personal' }],
    },
    {
      given: 'a restored row whose profile is missing',
      open: (test: ReturnType<typeof setUp>) =>
        test.chat.restore({
          sessions: [record('host-a', { profile: 'gone' })],
          selectedHostSessionId: null,
        }),
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
    test.chat.restore(NOTHING_SAVED);
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
    expect(test.harness.processes[1].request).toMatchObject({
      sessionId: 'uuid-2',
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
        },
      ],
      selectedHostSessionId: 'uuid-2',
    });
    expect(test.chat.sessions()[0].running).toBe(true);
    expect(test.logged).toContain('[chat] conversation cleared in app');
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
    expect(test.sent('returned')).toEqual([
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

    expect(test.sent('returned')).toEqual([
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
        old.events.messageDropped('user-1');
      }
      fresh.events.ended({ code: 0, error: null });

      expect(test.sent('returned')).toEqual([
        { sessionId: ROW_ID, messages: [message] },
      ]);
    },
  );

  it('clear_StartThrows_RowRestsUnderNewIdAndRethrows', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED);
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
      logged: '[chat] clear for unknown session row-x ignored',
    },
    {
      given: 'killAll',
      arrange: (test: ReturnType<typeof setUp>) => test.chat.killAll(),
      sessionId: ROW_ID,
      logged: `[chat] clear for session ${ROW_ID} ignored: chat is stopping`,
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
    test.chat.restore({
      sessions: [record(PAST_ONE.sessionId, { sent: true })],
      selectedHostSessionId: null,
    });
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
      test.chat.restore(NOTHING_SAVED);

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

    test.chat.restore({
      sessions: [record('host-a', { titles })],
      selectedHostSessionId: null,
    });

    expect(test.titleCalls).toEqual([
      [ROW_ID, 'agent', 'Plan review'],
      [ROW_ID, 'firstMessage', 'hi'],
    ]);
    expect(test.titlesOf(ROW_ID)).toEqual(titles);
  });

  it('titleChanged_HeldRow_SavesItsCurrentTitles', async () => {
    const test = setUp();
    test.chat.restore(NOTHING_SAVED);
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
    test.chat.restore(NOTHING_SAVED);
    test.chat.start({ projectDir: PROJECT_DIR, profile: 'personal' });
    await flush();
    const savesBefore = test.saved.saves();

    test.chat.titleChanged('row-9');

    expect(test.saved.saves()).toBe(savesBefore);
  });
});
