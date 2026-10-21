import { describe, expect, it } from 'vitest';
import type {
  ChatEntry,
  ProcessActivity,
  SessionControl,
} from '../../../contracts/agent';
import {
  createFakeAgentHarness,
  FAKE_PAST_SESSIONS,
  type FakeAgentHarness,
} from '../../../shared/fake-agent-harness';
import { createMemoryFiles } from '../../../shared/memory-files';
import type {
  AgentSession,
  SessionInfo,
  ToolResult,
} from '../../sessions/contract';
import type { ChatChannel } from '../contract';
import { DEFAULT_PROFILES } from '../manifest';
import {
  ARCHIVED_SESSIONS_FILE,
  createArchivedSessions,
} from './archived-sessions';
import {
  type ChatSessionsDeps,
  createChatSessions,
  TURN_FINISHED_TITLE,
} from './chat-sessions';
import { CANCELLED_REASON } from './permission-tool';
import { createRecentFolders, RECENT_FOLDERS_FILE } from './recent-folders';

type Message = {
  [K in keyof ChatChannel['messages']]: {
    message: K;
    data: ChatChannel['messages'][K];
  };
}[keyof ChatChannel['messages']];

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

// Lets the fake harness's queued emissions and the recent-folders write run.
async function flush() {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

function setUp(
  options: { harnesses?: FakeAgentHarness[]; clockNow?: number } = {},
) {
  const harness = createFakeAgentHarness();
  const harnesses = options.harnesses ?? [harness];
  const data = createMemoryFiles();
  const logged: string[] = [];
  const log = (source: string, message: string) =>
    logged.push(`[${source}] ${message}`);
  const opened: SessionInfo[] = [];
  const marked: string[] = [];
  const activated: string[] = [];
  const announced: Announced[] = [];
  const messages: Message[] = [];
  let ownedEnds = 0;
  let windowShows = 0;
  let isFocused = true;
  let selectedSessionId: string | null = ROW_ID;
  let uuidCalls = 0;
  const archived = createArchivedSessions(data);
  const sessions: ChatSessionsDeps['sessions'] = {
    open: (info) => {
      opened.push(info);
      return {
        session: { id: ROW_ID, info },
        end: () => {
          ownedEnds++;
        },
      };
    },
    mark: (sessionId) => marked.push(sessionId),
    activate: (sessionId) => activated.push(sessionId),
    selectedSessionId: () => selectedSessionId,
  };
  const chat = createChatSessions({
    harnesses,
    sessions,
    profiles: DEFAULT_PROFILES,
    homeDir: '/Users/u',
    randomUuid: () => {
      uuidCalls++;
      return 'uuid-1';
    },
    recent: createRecentFolders({
      data,
      clock: { now: () => options.clockNow ?? 1000 },
      log,
    }),
    archived,
    send: (message, data) => messages.push({ message, data } as Message),
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
    log,
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
    marked,
    activated,
    announced,
    messages,
    agentSession,
    archived,
    uuidCalls: () => uuidCalls,
    ownedEnds: () => ownedEnds,
    windowShows: () => windowShows,
    setFocused: (focused: boolean) => {
      isFocused = focused;
    },
    setSelected: (sessionId: string | null) => {
      selectedSessionId = sessionId;
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
  return { kind: 'assistant', id, text, streaming: false, raw: [] };
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
        profileDir: '/Users/u/.claude-personal',
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
        commands: [],
      },
    ]);
    expect(JSON.parse(await test.data.read(RECENT_FOLDERS_FILE))).toEqual([
      { projectDir: PROJECT_DIR, profile: 'personal', lastUsed: 1000 },
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
        profileDir: '/Users/u/.claude-personal',
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
    expect(test.logged).toContain(
      `[chat] archived sessions not read: ${ARCHIVED_SESSIONS_FILE} is not a JSON array of session ids`,
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

  it('pastSessionsAndResume_UnknownProfile_RejectWithoutCalls', async () => {
    const test = setUp();

    await expect(test.chat.pastSessions('/w/app', 'home')).rejects.toThrow(
      'chat has no profile "home"',
    );
    await expect(
      test.chat.resume({
        projectDir: '/w/app',
        profile: 'home',
        hostSessionId: PAST_ONE.sessionId,
      }),
    ).rejects.toThrow('chat has no profile "home"');
    expect(test.harness.pastSessionCalls).toEqual([]);
    expect(test.harness.processes).toEqual([]);
    expect(test.opened).toEqual([]);
  });

  it('resume_OpensWithHistoryAndResumesTheProcess', async () => {
    const test = setUp();
    const hostId = PAST_ONE.sessionId;

    const sessionId = await test.chat.resume({
      projectDir: '/w/app',
      profile: 'work',
      hostSessionId: hostId,
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
      profileDir: '/Users/u/.claude',
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
    });

    expect(test.sent('sessionStarted')[0].entries).toEqual([
      {
        kind: 'notice',
        id: 'history:unread',
        text: 'Earlier conversation not read: cannot read',
        tone: 'error',
        raw: [],
      },
    ]);
    expect(test.logged).toContain(
      `[chat] history of ${hostId} not read: cannot read`,
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
      }),
    ).rejects.toThrow(`session ${hostId} is already open in the app`);
    expect(test.harness.pastSessionCalls).toEqual([]);
    expect(test.opened).toEqual([]);
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

  it('start_unknownProfile_throwsAndOpensNothing', () => {
    const test = setUp();

    expect(() =>
      test.chat.start({ projectDir: PROJECT_DIR, profile: 'home' }),
    ).toThrow('chat has no profile "home"');
    expect(test.opened).toEqual([]);
  });

  it('start_noClaudeHarness_throwsAndOpensNothing', () => {
    const test = setUp({ harnesses: [] });

    expect(() =>
      test.chat.start({ projectDir: PROJECT_DIR, profile: 'work' }),
    ).toThrow('no agent harness "claude"');
    expect(test.opened).toEqual([]);
  });

  it('start_harnessThrows_endsTheOwnedSessionAndReportsTheError', () => {
    const test = setUp();
    test.harness.failNextStart('spawn failed');

    expect(() =>
      test.chat.start({ projectDir: PROJECT_DIR, profile: 'work' }),
    ).toThrow('spawn failed');
    expect(test.ownedEnds()).toBe(1);
    expect(test.sent('sessionEnded')).toEqual([
      { sessionId: ROW_ID, error: 'spawn failed' },
    ]);
    expect(test.chat.sessions()).toEqual([]);
  });

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

  it('activity_unchanged_sendsNothing', async () => {
    const test = await started();
    test.setFocused(false);

    test.activity('idle');

    expect(test.sent('activity')).toEqual([]);
    expect(test.announced).toEqual([]);
  });

  it('ended_reportsAndEndsTheOwnedSession', async () => {
    const test = await started();
    const entriesBefore = test.sent('entry').length;

    test.process.events.ended({ code: 1, error: 'crashed' });
    test.process.events.entry(assistant('late', 'z'));

    expect(test.sent('sessionEnded')).toEqual([
      { sessionId: ROW_ID, error: 'crashed' },
    ]);
    expect(test.ownedEnds()).toBe(1);
    expect(test.chat.sessions()).toEqual([]);
    expect(test.sent('entry')).toHaveLength(entriesBefore);
    expect(test.logged).toContain(`[chat] session ${ROW_ID} ended (code 1)`);
    expect(test.logged).toContain(`[chat] session ${ROW_ID} failed: crashed`);
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
    expect(test.sent('sessionEnded')).toEqual([]);
    expect(test.logged).toContain(`[chat] session ${ROW_ID} closed (code 0)`);
  });

  it('closed_processExitsWithAnError_logsTheExit', async () => {
    const fake = createFakeAgentHarness();
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

    expect(test.logged).toContain(
      `[chat] session ${ROW_ID} closed (code 1, error: stdin closed early)`,
    );
    expect(test.ownedEnds()).toBe(1);
  });

  it('closed_processEndRejects_logsAndEndsTheOwnedSession', async () => {
    const fake = createFakeAgentHarness();
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

    expect(test.logged).toContain(
      `[chat] session ${ROW_ID} end failed: kill failed`,
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

  it('processCalls_passThrough', async () => {
    const test = await started();

    test.chat.send(ROW_ID, 'hi');
    test.chat.interrupt(ROW_ID);
    test.chat.setControl(ROW_ID, 'mode', 'plan');

    expect(test.process.calls).toEqual([
      { method: 'send', text: 'hi' },
      { method: 'interrupt' },
      { method: 'setControl', id: 'mode', value: 'plan' },
    ]);
  });

  it('unknownSession_loggedAndIgnored', async () => {
    const test = await started();

    test.chat.send('row-x', 'hi');
    test.chat.interrupt('row-x');
    test.chat.answerPermission('row-x', 'permission-1', {
      allowed: true,
      reason: null,
    });

    expect(test.logged).toEqual(
      expect.arrayContaining([
        '[chat] send for unknown session row-x ignored',
        '[chat] interrupt for unknown session row-x ignored',
        '[chat] answerPermission for unknown session row-x ignored',
      ]),
    );
    expect(test.process.calls).toEqual([]);
  });

  it('setControl_unknownSession_throwsAndSetsNothing', async () => {
    const test = await started();

    expect(() => test.chat.setControl('row-x', 'mode', 'plan')).toThrow(
      'session row-x has ended',
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

  it('permission_sessionEnds_answersCancelledWithNoEntry', async () => {
    const test = await started();
    const call = test.chat
      .permissionToolSession(test.agentSession)
      .call('permission_prompt', BASH_ARGS, {
        toolUseId: 'tu-1',
        signal: signal().signal,
      });
    const entriesBefore = test.sent('entry').length;

    test.process.events.ended({ code: 0, error: null });

    expect(replyText(await settled(call))).toBe(
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

    expect(test.logged).toContain(
      '[chat] answerPermission for unknown entry permission-9 ignored',
    );
    expect(await settled(call)).toBe('pending');
  });
});
