import { describe, expect, it } from 'vitest';
import type { ProcessActivity } from '../../../contracts/agent';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import { readIfPresent } from '../../../contracts/files';
import type { RunMode } from '../../../contracts/plugin';
import { harnessInfo } from '../../../shared/agent-harness-registry.test-support';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type ChatMainEvents,
  type ChatMainExports,
  type ChatSessionInfo,
  chatMainKey,
  chatSessionSlot,
  type LaunchRequest,
  type SessionCloseReason,
} from '../../chat/contract';
import {
  type SessionRow,
  type SessionsMainExports,
  sessionsMainKey,
  sessionsRowsSlot,
  type TitleSource,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import { autoRetroStateSlot } from '../contract';
import { QUEUE_FILE } from './queue-file';
import { DEFAULT_SETTLE_SECONDS, RESTORE_WAIT_MS } from './retro-done';
import type { RetroQueue } from './retro-queue';
import { autoRetroMainPart } from './start';

const QUEUE_PATH = `/data/auto-retro/${QUEUE_FILE}`;
const SETTLE_MS = DEFAULT_SETTLE_SECONDS * 1000;

const settled = () => new Promise((settle) => setImmediate(settle));

function rowOf(sessionId: string, hostSessionId: string): SessionRow {
  return sessionRow(sessionId, {
    label: sessionId,
    project: 'wigley-agents',
    projectDir: '/home/me/wigley-agents',
    hostSessionId,
  });
}

function closedEvent(
  hostSessionId: string,
  reason: SessionCloseReason = 'user',
): ChatMainEvents['sessionClosed'] {
  return {
    sessionId: `row-${hostSessionId}`,
    hostSessionId,
    projectDir: '/home/me/project',
    profile: 'work',
    titles: { user: 'Fix login', agent: null, firstMessage: 'hi' },
    sent: true,
    headless: false,
    reason,
  };
}

function sessionInfo(
  sessionId: string,
  activity: ProcessActivity,
): ChatSessionInfo {
  return {
    sessionId,
    projectDir: '/home/me/wigley-agents',
    harness: 'fake',
    profile: 'work',
    activity,
    background: 0,
    activeTime: { totalMs: 0, since: null },
    running: true,
    pid: null,
    compaction: null,
    repo: 'wigley-agents',
    branch: 'main',
    worktrees: [],
    headless: false,
  };
}

// The part on the harness, over a chat whose `launch` answers through
// `answerLaunch` (by default: row `retro-<n>` with host `retro-host-<n>` set in
// `sessions.rows`, then that row id) and records each launch and close, and a
// sessions that records each title set. Every fake lives across a restart.
function startPart(
  options: {
    runMode?: RunMode;
    settings?: { folder: string; layout: string; settleSeconds: number };
  } = {},
) {
  const launches: LaunchRequest[] = [];
  const closes: [string, SessionCloseReason][] = [];
  const titles: [string, TitleSource, string | null][] = [];
  const settings = options.settings ?? {
    folder: '~/wigley-agents',
    layout: 'default',
    settleSeconds: DEFAULT_SETTLE_SECONDS,
  };
  const state = createSlotStore(() => undefined);
  state.publish(coreAgentHarnessesSlot).set(
    'claude',
    harnessInfo({
      profiles: [{ name: 'work', configDir: '~/.claude-work' }],
    }),
  );
  const harness = startMainPart(autoRetroMainPart, {
    settings,
    state,
    services: { runMode: options.runMode ?? 'live', homeDir: '/home/me' },
    dependencies: [
      fakeDependency(
        chatMainKey,
        () =>
          ({
            launch(request: LaunchRequest) {
              launches.push(request);
              return part.answerLaunch(request);
            },
            close(sessionId: string, reason: SessionCloseReason) {
              closes.push([sessionId, reason]);
              return Promise.resolve();
            },
            restored: () => Promise.resolve(),
          }) as unknown as ChatMainExports,
      ),
      fakeDependency(
        sessionsMainKey,
        () =>
          ({
            setTitle(
              sessionId: string,
              source: TitleSource,
              title: string | null,
            ) {
              titles.push([sessionId, source, title]);
            },
          }) as unknown as SessionsMainExports,
      ),
    ],
  });
  const rows = harness.state.publish(sessionsRowsSlot);
  const sessions = harness.state.publish(chatSessionSlot);
  const part = {
    harness,
    launches,
    closes,
    titles,
    rows,
    sessions,
    answerLaunch: (_request: LaunchRequest): Promise<string> => {
      const n = launches.length;
      rows.set(`retro-${n}`, rowOf(`retro-${n}`, `retro-host-${n}`));
      return Promise.resolve(`retro-${n}`);
    },
    state: () => harness.state.read(autoRetroStateSlot, 'test').get(),
    messages: () => harness.logs.map((line) => line.message),
    texts: () => launches.map((request) => request.message.text),
    async queueFile(): Promise<RetroQueue | null> {
      const text = await readIfPresent(harness.files, QUEUE_PATH);
      return text === null ? null : (JSON.parse(text) as RetroQueue);
    },
    async close(host: string, reason: SessionCloseReason = 'user') {
      harness.emit('chat.sessionClosed', closedEvent(host, reason));
      await settled();
    },
    async clear(oldHost: string, newHost: string, sent: boolean) {
      harness.emit('chat.sessionCleared', {
        sessionId: `row-${newHost}`,
        oldHostSessionId: oldHost,
        newHostSessionId: newHost,
        projectDir: '/home/me/project',
        profile: 'work',
        titles: { user: 'Fix login', agent: null, firstMessage: 'hi' },
        sent,
      });
      await settled();
    },
    // Starts the launched row's first turn and reads it done.
    async startedThenIdle(sessionId: string) {
      harness.emit('chat.turnStarted', { sessionId });
      await settled();
      sessions.set(sessionId, sessionInfo(sessionId, 'idle'));
    },
  };
  return part;
}

// The part restarted over an unreadable `queue.json`, with a restored row
// `retro-9` (host `retro-host-9`) whose first message is `firstMessage`.
async function restartWithQueueLost(firstMessage: string) {
  const part = startPart();
  await settled();
  await part.harness.files.write(QUEUE_PATH, '{');
  part.rows.set(
    'retro-9',
    sessionRow('retro-9', {
      hostSessionId: 'retro-host-9',
      titles: { user: null, agent: null, firstMessage },
    }),
  );
  await part.harness.restart();
  await settled();
  return part;
}

describe('autoRetroMainPart', () => {
  it('sessionClosed_UserClose_LaunchesUnattendedAndTitlesTheRow', async () => {
    const part = startPart();
    await settled();

    await part.close('h1');

    expect(part.launches).toEqual([
      {
        projectDir: '/home/me/wigley-agents',
        profile: 'work',
        message: { text: '/wigley:retro auto h1', images: [] },
        unattended: true,
      },
    ]);
    expect(part.titles).toEqual([['retro-1', 'user', 'Fix login']]);
    expect(part.state()).toEqual({ rows: ['retro-1'], queued: 0 });
    expect((await part.queueFile())?.launched).toEqual(['retro-host-1']);
    expect(part.messages()).toContain('launched retro retro-1 for h1');
  });

  it('sessionClosed_TwoCloses_LaunchesOneAtATime', async () => {
    const part = startPart();
    let resolveFirst = (_rowId: string) => undefined as void;
    part.answerLaunch = () => {
      part.rows.set('retro-1', rowOf('retro-1', 'retro-host-1'));
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    };
    await settled();

    await part.close('h1');
    await part.close('h2');

    expect(part.launches).toHaveLength(1);
    expect(part.state()?.queued).toBe(1);

    resolveFirst('retro-1');
    await settled();
    await part.close('retro-host-1', 'finished');

    expect(part.texts()).toEqual([
      '/wigley:retro auto h1',
      '/wigley:retro auto h2',
    ]);
    expect((await part.queueFile())?.launched).not.toContain('retro-host-1');
  });

  it('doneRow_AfterTheSettle_ClosesFinished', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');
    await part.close('h2');
    await part.startedThenIdle('retro-1');

    part.harness.advance(3000);
    part.sessions.set('retro-1', sessionInfo('retro-1', 'idle'));
    part.harness.advance(SETTLE_MS - 3000 - 1);

    expect(part.closes).toEqual([]);

    part.harness.advance(1);

    expect(part.closes).toEqual([['retro-1', 'finished']]);

    await part.close('retro-host-1', 'finished');
    await part.startedThenIdle('retro-2');
    part.harness.advance(3000);
    part.sessions.set('retro-2', sessionInfo('retro-2', 'working'));
    part.sessions.set('retro-2', sessionInfo('retro-2', 'idle'));
    part.harness.advance(SETTLE_MS - 1);

    expect(part.closes).toHaveLength(1);

    part.harness.advance(1);

    expect(part.closes).toEqual([
      ['retro-1', 'finished'],
      ['retro-2', 'finished'],
    ]);
  });

  // `inSettle` closes the row after it reads done, inside the settle wait; else it closes while working. Each
  // close deletes the row's `chat.session` entry right after the emit, as chat does; `rowDropped` deletes its
  // sessions row instead, as chat's `endClosed` does for a session that is not running.
  it.each([
    { reason: 'user', inSettle: false, rowDropped: false, logsLostRetro: true },
    {
      reason: 'project-closed',
      inSettle: false,
      rowDropped: false,
      logsLostRetro: true,
    },
    {
      reason: 'finished',
      inSettle: false,
      rowDropped: false,
      logsLostRetro: false,
    },
    { reason: 'user', inSettle: true, rowDropped: false, logsLostRetro: false },
    { reason: 'user', inSettle: true, rowDropped: true, logsLostRetro: false },
  ] satisfies {
    reason: SessionCloseReason;
    inSettle: boolean;
    rowDropped: boolean;
    logsLostRetro: boolean;
  }[])(
    'logs the lost retro only when the running row closes before done ($reason, in settle: $inSettle, row dropped: $rowDropped) → logs: $logsLostRetro',
    async ({ reason, inSettle, rowDropped, logsLostRetro }) => {
      const part = startPart();
      await settled();
      await part.close('h1');
      await part.close('h2');
      if (inSettle) {
        await part.startedThenIdle('retro-1');
        part.harness.advance(SETTLE_MS - 1);
      } else {
        part.sessions.set('retro-1', sessionInfo('retro-1', 'working'));
      }

      part.harness.emit('chat.sessionClosed', {
        ...closedEvent('retro-host-1', reason),
        sessionId: 'retro-1',
      });
      if (rowDropped) {
        part.rows.delete('retro-1');
      } else {
        part.sessions.delete('retro-1');
      }
      await settled();

      const lostRetroLogs = part
        .messages()
        .filter((message) => message.includes('closed before done'));
      expect(lostRetroLogs).toEqual(
        logsLostRetro
          ? ['retro retro-1 closed before done; h1 not analyzed']
          : [],
      );
      expect(part.texts()).toEqual([
        '/wigley:retro auto h1',
        '/wigley:retro auto h2',
      ]);
    },
  );

  it('restart_LaunchCutShort_LaunchesAgain', async () => {
    const part = startPart();
    part.answerLaunch = () => new Promise(() => undefined);
    await settled();
    await part.close('h1');

    part.answerLaunch = () => new Promise(() => undefined);
    await part.harness.restart();
    await settled();

    expect(part.texts()).toEqual([
      '/wigley:retro auto h1',
      '/wigley:retro auto h1',
    ]);
  });

  it('restart_RestoredRetroRow_IsClaimedAndClosingItQueuesNothing', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');
    part.rows.delete('retro-1');
    part.rows.set('retro-9', rowOf('retro-9', 'retro-host-1'));

    await part.harness.restart();
    await settled();

    expect(part.state()?.rows).toEqual(['retro-9']);

    part.harness.advance(RESTORE_WAIT_MS);
    await settled();

    expect(
      part.messages().some((message) => message.startsWith('dropped retro')),
    ).toBe(false);
    expect(part.state()?.rows).toEqual(['retro-9']);

    part.sessions.set('retro-9', sessionInfo('retro-9', 'idle'));
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([['retro-9', 'finished']]);

    await part.close('retro-host-1');

    expect(part.launches).toHaveLength(1);
    expect(part.state()?.queued).toBe(0);
  });

  it('restart_RestoredRowAlreadyIdle_ClosesWithoutANewValue', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');
    part.rows.delete('retro-1');
    part.rows.set('retro-9', rowOf('retro-9', 'retro-host-1'));
    part.sessions.set('retro-9', sessionInfo('retro-9', 'idle'));

    await part.harness.restart();
    await settled();
    part.harness.advance(SETTLE_MS - 1);

    expect(part.closes).toEqual([]);

    part.harness.advance(1);

    expect(part.closes).toEqual([['retro-9', 'finished']]);
  });

  it('claims a restored retro row the queue lost and closes it once done', async () => {
    const part = await restartWithQueueLost('/wigley:retro auto h1');

    expect(part.state()?.rows).toEqual(['retro-9']);

    part.sessions.set('retro-9', sessionInfo('retro-9', 'idle'));
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([['retro-9', 'finished']]);

    part.harness.emit('chat.sessionClosed', {
      ...closedEvent('retro-host-9', 'user'),
      sessionId: 'retro-9',
      titles: {
        user: null,
        agent: null,
        firstMessage: '/wigley:retro auto h1',
      },
    });
    await settled();

    expect(part.launches).toEqual([]);
  });

  // Breaks if a row is claimed by its first message alone, when a resumed or
  // hand-started retro would be closed as finished.
  it.each([
    {
      row: 'a restored row that is not a retro',
      join: async () => restartWithQueueLost('hi'),
    },
    {
      row: 'a retro row added after start',
      join: async () => {
        const part = startPart();
        await settled();
        part.rows.set(
          'retro-9',
          sessionRow('retro-9', {
            hostSessionId: 'retro-host-9',
            titles: {
              user: null,
              agent: null,
              firstMessage: '/wigley:retro auto h1',
            },
          }),
        );
        await settled();
        return part;
      },
    },
  ])('leaves $row unclaimed', async ({ join }) => {
    const part = await join();

    expect(part.state()?.rows).toEqual([]);
  });

  it('closes two claimed rows that settle together', async () => {
    const part = await restartWithQueueLost('/wigley:retro auto h1');
    part.sessions.set('retro-9', sessionInfo('retro-9', 'idle'));
    await part.close('h1');
    await part.startedThenIdle('retro-1');

    part.harness.advance(SETTLE_MS);

    expect(part.closes.toSorted(([a], [b]) => a.localeCompare(b))).toEqual([
      ['retro-1', 'finished'],
      ['retro-9', 'finished'],
    ]);
  });

  it('keeps one claimed row settling when another reads not done', async () => {
    const part = await restartWithQueueLost('/wigley:retro auto h1');
    part.sessions.set('retro-9', sessionInfo('retro-9', 'idle'));
    await part.close('h1');
    await part.startedThenIdle('retro-1');

    part.sessions.set('retro-1', sessionInfo('retro-1', 'working'));
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([['retro-9', 'finished']]);
  });

  it('restart_RunningRowNeverRestored_IsDroppedAfter30s', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');
    await part.close('h2');
    part.rows.delete('retro-1');

    await part.harness.restart();
    await settled();
    part.harness.advance(RESTORE_WAIT_MS - 1);
    await settled();

    expect(part.launches).toHaveLength(1);

    part.harness.advance(1);
    await settled();

    expect(part.messages()).toContain(
      'dropped retro retro-host-1: its row did not come back',
    );
    expect(part.texts()).toEqual([
      '/wigley:retro auto h1',
      '/wigley:retro auto h2',
    ]);
  });

  it('doneRow_IdleBeforeFirstTurn_IsNotClosed', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');

    part.sessions.set('retro-1', sessionInfo('retro-1', 'idle'));
    part.harness.advance(10_000);

    expect(part.closes).toEqual([]);

    await part.startedThenIdle('retro-1');
    part.harness.advance(SETTLE_MS - 1);

    expect(part.closes).toEqual([]);

    part.harness.advance(1);

    expect(part.closes).toEqual([['retro-1', 'finished']]);
  });

  it('doneRow_SettleSecondsZero_ClosesAtOnce', async () => {
    const part = startPart({
      settings: {
        folder: '~/wigley-agents',
        layout: 'default',
        settleSeconds: 0,
      },
    });
    await settled();
    await part.close('h1');
    await part.startedThenIdle('retro-1');

    part.harness.advance(0);

    expect(part.closes).toEqual([['retro-1', 'finished']]);
  });

  it('sessionCleared_SentConversation_LaunchesItsRetroAtTheClear', async () => {
    const part = startPart();
    await settled();

    await part.clear('h0', 'h1', true);

    expect(part.texts()).toEqual(['/wigley:retro auto h0']);
    expect(part.messages()).toContain('queued retro of h0 (1 queued)');
  });

  it('sessionCleared_UnsentConversation_LaunchesNothing', async () => {
    const part = startPart();
    await settled();

    await part.clear('h0', 'h1', false);

    expect(part.texts()).toEqual([]);
  });

  it('selfTestRunMode_UserClose_LaunchesNothing', async () => {
    const part = startPart({ runMode: 'selfTest' });
    await settled();

    await part.close('h1');

    expect(part.launches).toEqual([]);
    expect(part.state()).toEqual({ rows: [], queued: 0 });
  });

  it('launchRejected_LogsAndLaunchesTheNext', async () => {
    const part = startPart();
    const autoRow = part.answerLaunch;
    part.answerLaunch = (request) =>
      request.message.text.endsWith(' h1')
        ? Promise.reject(new Error('unknown profile'))
        : autoRow(request);
    await settled();

    await part.close('h1');
    await part.close('h2');

    expect(part.messages()).toContain(
      'retro launch failed for h1: unknown profile',
    );
    expect(part.texts()).toEqual([
      '/wigley:retro auto h1',
      '/wigley:retro auto h2',
    ]);
  });

  it('unreadableQueueFile_IsNeverOverwritten', async () => {
    const part = startPart();
    await settled();
    await part.harness.files.write(QUEUE_PATH, '{');

    await part.harness.restart();
    await settled();
    await part.close('h1');

    expect(await readIfPresent(part.harness.files, QUEUE_PATH)).toBe('{');
    expect(
      part
        .messages()
        .some((message) => message.startsWith('queue.json not read:')),
    ).toBe(true);
  });
});
