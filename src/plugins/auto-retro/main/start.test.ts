import { describe, expect, it } from 'vitest';
import {
  type ChatEntry,
  MAIN_AGENT_ID,
  type ProcessActivity,
} from '../../../contracts/agent';
import type {
  FeatureKey,
  RetroContribution,
} from '../../../contracts/contributions';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type { DemoMainStep } from '../../../contracts/demo';
import { readIfPresent } from '../../../contracts/files';
import type { RunMode } from '../../../contracts/plugin';
import { harnessInfo } from '../../../shared/agent-harness-registry.test-support';
import { createDemoStepRegistry } from '../../../shared/demo-step-registry';
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  fakeDependency,
  startMainPart,
} from '../../../shared/plugin-part-harness.test-support';
import {
  type ChatMainEvents,
  type ChatMainExports,
  type ChatSessionInfo,
  chatEntriesSlot,
  chatMainKey,
  chatSessionSlot,
  type LaunchRequest,
  type SessionCloseReason,
  type SessionOrigin,
} from '../../chat/contract';
import {
  type ContributionsMainExports,
  contributionsMainKey,
  type FeatureReader,
  type Strategy,
} from '../../contributions/contract';
import {
  type SessionRow,
  type SessionsMainExports,
  sessionsMainKey,
  sessionsRowsSlot,
  type TitleSource,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import { autoRetroStateSlot } from '../contract';
import { DEMO_QUEUED } from './demo-steps';
import { QUEUE_FILE } from './queue-file';
import { DEFAULT_SETTLE_SECONDS, RESTORE_WAIT_MS } from './retro-done';
import type { RetroQueue } from './retro-queue';
import { retroReader } from './retro-reader';
import { autoRetroMainPart } from './start';

const QUEUE_PATH = `/data/auto-retro/${QUEUE_FILE}`;
const SETTLE_MS = DEFAULT_SETTLE_SECONDS * 1000;

const settled = () => new Promise((settle) => setImmediate(settle));

type RetroStrategy = Strategy<RetroContribution>;

function retroStrategy(id: string, value: RetroContribution): RetroStrategy {
  return {
    id,
    label: id,
    source: {
      pluginName: id,
      pluginKey: `${id}@market`,
      version: '1.0.0',
      root: `/plugins/${id}`,
      harnessId: 'claude',
    },
    value,
  };
}

const WIGLEY = retroStrategy('wigley', {
  command: '/wigley:retro auto {sessions}',
  folder: '~/wigley-agents',
  on: ['close', 'clear'],
});

const ACME = retroStrategy('acme', {
  command: '/acme:retro {sessions}',
  folder: '~/retros',
  on: ['close'],
});

const SETTINGS = {
  strategy: '',
  layout: 'default',
  settleSeconds: DEFAULT_SETTLE_SECONDS,
};

const notQueuedLines = (messages: string[]) =>
  messages.filter((message) => message.startsWith('retro not queued:'));

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

function clearedEvent(
  oldHost: string,
  newHost: string,
  sent: boolean,
): ChatMainEvents['sessionCleared'] {
  return {
    sessionId: `row-${newHost}`,
    oldHostSessionId: oldHost,
    newHostSessionId: newHost,
    projectDir: '/home/me/project',
    profile: 'work',
    titles: { user: 'Fix login', agent: null, firstMessage: 'hi' },
    sent,
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

// A row resting with no process: not attached yet, or its process exited.
function restingInfo(sessionId: string): ChatSessionInfo {
  return { ...sessionInfo(sessionId, 'idle'), running: false };
}

function processEndedEvent(
  sessionId: string,
  hostSessionId: string,
): ChatMainEvents['processEnded'] {
  return { sessionId, hostSessionId, reason: 'clean', code: 0, error: null };
}

const USER_ENTRY: ChatEntry = {
  kind: 'user',
  id: 'history-user',
  at: 1000,
  text: '/wigley:retro auto h1',
  images: [],
  delivery: null,
  raw: [],
};

// A restored retro row's history once its retro ran.
const RETRO_HISTORY: readonly ChatEntry[] = [
  USER_ENTRY,
  {
    kind: 'assistant',
    id: 'history-assistant',
    at: 2000,
    agentId: MAIN_AGENT_ID,
    text: 'Retro written.',
    streaming: false,
    raw: [],
  },
];

// The part on the harness, over a chat whose `launch` answers through
// `answerLaunch` (by default: row `retro-<n>` with host `retro-host-<n>` set in
// `sessions.rows`, then that row id) and records each launch and close, and a
// sessions that records each title set, and a contributions that serves `strategies` (by default the wigley strategy
// alone), holds each registered reader in `features` and tells `onChanged` listeners on `setStrategies`. Every fake
// lives across a restart. `enterDemoStep` enters the registered `auto-retro.section` step, its demo session `row-demo`.
// Chat's `loadHistory` puts the row's `histories` entries ahead of its `chat.entries` and resolves; while
// `holdsHistory` is true each read waits for `settleHistory`, which writes and resolves, or rejects with its error.
// `holdRestore` keeps the next start's `chat.restored()` pending.
function startPart(
  options: {
    runMode?: RunMode;
    settings?: typeof SETTINGS;
    strategies?: RetroStrategy[];
  } = {},
) {
  const launches: LaunchRequest[] = [];
  const closes: [string, SessionCloseReason][] = [];
  const titles: [string, TitleSource, string | null][] = [];
  const features = new Map<FeatureKey, FeatureReader<unknown>>();
  const strategyListeners = new Set<
    (strategies: readonly Strategy<unknown>[]) => void
  >();
  const settings = options.settings ?? SETTINGS;
  let strategies = options.strategies ?? [WIGLEY];
  let restored: Promise<void> = Promise.resolve();
  const histories = new Map<string, readonly ChatEntry[]>();
  const heldHistories = new Map<string, (error: Error | null) => void>();
  const demoSteps = createDemoStepRegistry<DemoMainStep>();
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
    services: {
      runMode: options.runMode ?? 'live',
      homeDir: '/home/me',
      demoSteps,
    },
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
            restored: () => restored,
            loadHistory: (sessionId: string) => part.loadHistory(sessionId),
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
      fakeDependency(
        contributionsMainKey,
        () =>
          ({
            registerFeature(key: FeatureKey, reader: FeatureReader<unknown>) {
              features.set(key, reader);
              return {
                dispose() {
                  features.delete(key);
                },
              };
            },
            strategies: () => strategies,
            onChanged(
              _key: FeatureKey,
              listener: (strategies: readonly Strategy<unknown>[]) => void,
            ) {
              strategyListeners.add(listener);
              return {
                dispose() {
                  strategyListeners.delete(listener);
                },
              };
            },
            ready: Promise.resolve(),
          }) as unknown as ContributionsMainExports,
      ),
    ],
  });
  const rows = harness.state.publish(sessionsRowsSlot);
  const sessions = harness.state.publish(chatSessionSlot);
  const entries = harness.state.publish(chatEntriesSlot);
  const readHistory = (sessionId: string) =>
    entries.replace(sessionId, [
      ...(histories.get(sessionId) ?? []),
      ...entries.get(sessionId),
    ]);
  const part = {
    harness,
    launches,
    closes,
    titles,
    rows,
    sessions,
    entries,
    histories,
    holdsHistory: false,
    loadHistory(sessionId: string): Promise<void> {
      if (!part.holdsHistory) {
        readHistory(sessionId);
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        heldHistories.set(sessionId, (error) => {
          if (error !== null) {
            reject(error);
            return;
          }
          readHistory(sessionId);
          resolve();
        });
      });
    },
    settleHistory(sessionId: string, error: Error | null = null) {
      const settle = heldHistories.get(sessionId);
      heldHistories.delete(sessionId);
      settle?.(error);
    },
    holdRestore() {
      restored = new Promise(() => undefined);
    },
    features,
    setStrategies(next: RetroStrategy[]) {
      strategies = next;
      for (const listener of strategyListeners) {
        listener(next);
      }
    },
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
      harness.emit('chat.sessionCleared', clearedEvent(oldHost, newHost, sent));
      await settled();
    },
    enterDemoStep() {
      const step = demoSteps
        .list()
        .find(({ id }) => id === 'auto-retro.section');
      if (step === undefined) {
        throw new Error('auto-retro registered no auto-retro.section step');
      }
      return step.enter({
        scratchDir: '/scratch',
        launchSession: async () => 'row-demo',
        processEvents: () => {
          throw new Error('no process events');
        },
      });
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
// `retro-9` (host `retro-host-9`) whose first message is `firstMessage` and whose history is `history`.
async function restartWithQueueLost(
  firstMessage: string,
  history: readonly ChatEntry[] = RETRO_HISTORY,
) {
  const part = startPart();
  await settled();
  await part.harness.files.write(QUEUE_PATH, '{');
  part.histories.set('retro-9', history);
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

// The part restarted over an unreadable `queue.json`, then row `retro-9` (host
// `retro-host-9`, history `RETRO_HISTORY`) opened as chat's restore opens one: the row joins with no
// titles, takes `firstMessage`, and `sessionOpened` fires with `origin`.
async function restartThenReopenWithQueueLost(
  firstMessage: string,
  origin: SessionOrigin = 'restored',
  options: Parameters<typeof startPart>[0] = {},
) {
  const part = startPart(options);
  await settled();
  await part.harness.files.write(QUEUE_PATH, '{');
  part.histories.set('retro-9', RETRO_HISTORY);
  await part.harness.restart();
  await settled();
  const row = sessionRow('retro-9', { hostSessionId: 'retro-host-9' });
  part.rows.set('retro-9', row);
  part.rows.set('retro-9', {
    ...row,
    titles: { user: null, agent: null, firstMessage },
  });
  part.harness.emit('chat.sessionOpened', {
    sessionId: 'retro-9',
    profileDir: '~/.claude-work',
    hostSessionId: 'retro-host-9',
    projectDir: '/home/me/wigley-agents',
    profile: 'work',
    origin,
  });
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
    part.histories.set('retro-9', RETRO_HISTORY);

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

  it('restart_RestoredRowWithAgentEntries_ClosesFinished', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');
    part.rows.delete('retro-1');
    part.rows.set('retro-9', rowOf('retro-9', 'retro-host-1'));
    part.histories.set('retro-9', RETRO_HISTORY);
    part.sessions.set('retro-9', sessionInfo('retro-9', 'idle'));

    await part.harness.restart();
    await settled();
    part.harness.advance(SETTLE_MS - 1);

    expect(part.closes).toEqual([]);

    part.harness.advance(1);

    expect(part.closes).toEqual([['retro-9', 'finished']]);
  });

  // `reopened` opens the row after the start, titles after the row, as chat's restore does.
  it.each([
    { arrival: 'present at the start', join: restartWithQueueLost },
    { arrival: 'reopened by chat', join: restartThenReopenWithQueueLost },
  ])(
    'claims a restored retro row the queue lost and closes it once done ($arrival)',
    async ({ join }) => {
      const part = await join('/wigley:retro auto h1');

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
    },
  );

  // Breaks if a row is claimed by its first message alone, when a resumed or
  // hand-started retro would be closed as finished.
  it.each([
    {
      row: 'a restored row that is not a retro',
      join: async () => restartWithQueueLost('hi'),
    },
    {
      row: 'a resumed retro row',
      join: async () =>
        restartThenReopenWithQueueLost('/wigley:retro auto h1', 'resumed'),
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

  // Breaks: a row whose process ended before its first turn read busy forever, holding the queue.
  it('processEnded_BeforeFirstTurn_ClosesStartFailedAndLaunchesTheNext', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');
    await part.close('h2');
    part.sessions.set('retro-1', restingInfo('retro-1'));

    part.harness.emit(
      'chat.processEnded',
      processEndedEvent('retro-1', 'retro-host-1'),
    );
    await settled();
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([['retro-1', 'start-failed']]);

    part.harness.emit('chat.sessionClosed', {
      ...closedEvent('retro-host-1', 'start-failed'),
      sessionId: 'retro-1',
    });
    await settled();

    expect(part.messages()).toEqual(
      expect.arrayContaining([
        'retro retro-1 ended before its first turn; closing it',
        'retro retro-1 closed before done; h1 not analyzed',
      ]),
    );
    expect(part.texts()).toEqual([
      '/wigley:retro auto h1',
      '/wigley:retro auto h2',
    ]);
  });

  // Breaks: the exit recorded only once the row joined, so an exit before the launch resolved was lost.
  it('processEnded_BeforeTheLaunchResolves_StillClosesTheRow', async () => {
    const part = startPart();
    part.answerLaunch = () => {
      part.rows.set('retro-1', rowOf('retro-1', 'retro-host-1'));
      part.sessions.set('retro-1', restingInfo('retro-1'));
      part.harness.emit(
        'chat.processEnded',
        processEndedEvent('retro-1', 'retro-host-1'),
      );
      return Promise.resolve('retro-1');
    };
    await settled();
    await part.close('h1');

    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([['retro-1', 'start-failed']]);
  });

  // Breaks: an older host's exit after a `/clear` read as the row's own.
  it('processEnded_OfTheOldHostAfterAClear_IsIgnored', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');
    part.rows.set('retro-1', rowOf('retro-1', 'retro-host-1-cleared'));
    part.sessions.set('retro-1', sessionInfo('retro-1', 'idle'));

    part.harness.emit(
      'chat.processEnded',
      processEndedEvent('retro-1', 'retro-host-1'),
    );
    await settled();
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([]);
  });

  // Breaks: a launched row resting before its process attaches read lost.
  it('launchedRow_NotYetAttached_IsNotClosed', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');

    part.sessions.set('retro-1', restingInfo('retro-1'));
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([]);
  });

  // Breaks: a restored row read as started at the claim, closing a retro that never ran as finished.
  it('restart_RestoredRowWithNoAgentEntry_ClosesStartFailed', async () => {
    const part = await restartWithQueueLost('/wigley:retro auto h1', [
      USER_ENTRY,
    ]);

    part.sessions.set('retro-9', restingInfo('retro-9'));
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([['retro-9', 'start-failed']]);
    expect(part.messages()).toContain(
      'retro retro-9 ended before its first turn; closing it',
    );
  });

  // The part restarted with row `retro-9` (host `retro-host-9`) present, opening with the retro command, its history
  // `RETRO_HISTORY` held until `settleHistory`.
  async function restartWithHistoryHeld() {
    const part = startPart();
    await settled();
    part.histories.set('retro-9', RETRO_HISTORY);
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
    part.holdsHistory = true;
    return part;
  }

  // Breaks: the entries read at the claim, before the history load wrote them.
  it('restart_RestoredRowEntriesArriveWithTheHistory_ClosesFinished', async () => {
    const part = await restartWithHistoryHeld();
    await part.harness.restart();
    await settled();
    part.sessions.set('retro-9', restingInfo('retro-9'));

    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([]);

    part.settleHistory('retro-9');
    await settled();
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([['retro-9', 'finished']]);
  });

  // Breaks: a restored row whose process ended before its history was read reading lost, closing it start-failed.
  it('restart_ProcessEndedWhileHistoryIsUnread_ClosesFinishedOnceRead', async () => {
    const part = await restartWithHistoryHeld();
    await part.harness.restart();
    await settled();
    part.sessions.set('retro-9', restingInfo('retro-9'));
    part.harness.emit(
      'chat.processEnded',
      processEndedEvent('retro-9', 'retro-host-9'),
    );
    await settled();

    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([]);

    part.settleHistory('retro-9');
    await settled();
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([['retro-9', 'finished']]);
  });

  // Breaks: rule 4 applied to a live retro still attaching while chat's restore runs.
  it('restart_RestoredRowBeforeRestoreEnds_IsNotClosed', async () => {
    const part = await restartWithHistoryHeld();
    part.holdRestore();
    await part.harness.restart();
    await settled();
    part.sessions.set('retro-9', restingInfo('retro-9'));

    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([]);
  });

  it('restart_HistoryReadRejects_LogsAndReadsTheEntriesAsTheyAre', async () => {
    const part = await restartWithHistoryHeld();
    await part.harness.restart();
    await settled();
    part.sessions.set('retro-9', restingInfo('retro-9'));

    part.settleHistory('retro-9', new Error('transcript missing'));
    await settled();
    part.harness.advance(SETTLE_MS);

    expect(part.messages()).toContain(
      'retro retro-9 history not read: transcript missing',
    );
    expect(part.closes).toEqual([['retro-9', 'start-failed']]);
  });

  // Breaks: a stale `endedRows` or `restoredRows` entry closing the next row with the same id before its history is
  // read.
  it('leaveRow_ThenTheSameIdRestored_StartsClean', async () => {
    const part = startPart();
    await settled();
    const reopen = async () => {
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
      part.harness.emit('chat.sessionOpened', {
        sessionId: 'retro-9',
        profileDir: '~/.claude-work',
        hostSessionId: 'retro-host-9',
        projectDir: '/home/me/wigley-agents',
        profile: 'work',
        origin: 'restored',
      });
      await settled();
      part.sessions.set('retro-9', restingInfo('retro-9'));
    };
    part.histories.set('retro-9', [USER_ENTRY]);
    await reopen();
    part.harness.emit(
      'chat.processEnded',
      processEndedEvent('retro-9', 'retro-host-9'),
    );
    await settled();
    part.harness.advance(SETTLE_MS);
    part.rows.delete('retro-9');
    part.sessions.delete('retro-9');
    part.entries.delete('retro-9');
    await settled();

    part.histories.set('retro-9', RETRO_HISTORY);
    part.holdsHistory = true;
    await reopen();
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([['retro-9', 'start-failed']]);

    part.settleHistory('retro-9');
    await settled();
    part.harness.advance(SETTLE_MS);

    expect(part.closes).toEqual([
      ['retro-9', 'start-failed'],
      ['retro-9', 'finished'],
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
    const part = startPart({ settings: { ...SETTINGS, settleSeconds: 0 } });
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

  it('sessionClosed_NoStrategy_LaunchesNothingAndLogsOnce', async () => {
    const part = startPart({ strategies: [] });
    await settled();

    await part.close('h1');
    await part.close('h2');

    expect(part.launches).toEqual([]);
    expect(part.state()?.queued).toBe(0);
    expect(notQueuedLines(part.messages())).toHaveLength(1);
  });

  it('sessionClosed_TwoStrategiesAutomatic_LaunchesNothing', async () => {
    const part = startPart({ strategies: [WIGLEY, ACME] });
    await settled();

    await part.close('h1');

    expect(part.launches).toEqual([]);
    expect(part.state()?.queued).toBe(0);
  });

  it('sessionClosed_PickedStrategy_LaunchesItsCommandInItsFolder', async () => {
    const part = startPart({
      strategies: [WIGLEY, ACME],
      settings: { ...SETTINGS, strategy: 'acme' },
    });
    await settled();

    await part.close('h1');

    expect(part.launches).toEqual([
      {
        projectDir: '/home/me/retros',
        profile: 'work',
        message: { text: '/acme:retro h1', images: [] },
        unattended: true,
      },
    ]);
  });

  // A retro runs for h1 and h2 waits queued when a second strategy installs and the automatic pick turns `choose`;
  // then h1's retro ends.
  async function queueThenUnbind() {
    const part = startPart();
    await settled();
    await part.close('h1');
    await part.close('h2');
    part.setStrategies([WIGLEY, ACME]);
    await settled();
    await part.close('retro-host-1', 'finished');
    return part;
  }

  it('queuedThenUnbound_StaysQueuedNotRunning', async () => {
    const part = await queueThenUnbind();

    const saved = await part.queueFile();
    expect({ queued: saved?.queued, running: saved?.running }).toEqual({
      queued: [{ hostIds: ['h2'], profile: 'work', title: 'Fix login' }],
      running: null,
    });
    expect(part.texts()).toEqual(['/wigley:retro auto h1']);
  });

  it('queuedThenUnbound_PickRestored_Launches', async () => {
    const part = await queueThenUnbind();

    part.harness.pushSettings({ ...SETTINGS, strategy: 'acme' });
    await settled();
    part.harness.pushSettings({ ...SETTINGS, strategy: 'acme' });
    await settled();

    expect(part.texts()).toEqual(['/wigley:retro auto h1', '/acme:retro h2']);
    expect(part.state()?.queued).toBe(0);
  });

  it('start_RegistersTheRetroReaderInSelfTestMode', async () => {
    const part = startPart({ runMode: 'selfTest' });
    await settled();

    expect(part.features.get('retro')).toBe(retroReader);
  });

  it('restoredSessionOpened_OtherStrategysPrefix_ClaimedAsRetroRow', async () => {
    const part = await restartThenReopenWithQueueLost(
      '/acme:retro h1',
      'restored',
      {
        strategies: [WIGLEY, ACME],
        settings: { ...SETTINGS, strategy: 'wigley' },
      },
    );

    expect(part.state()?.rows).toEqual(['retro-9']);

    part.harness.emit('chat.sessionClosed', {
      ...closedEvent('retro-host-9', 'user'),
      sessionId: 'retro-9',
      titles: { user: null, agent: null, firstMessage: '/acme:retro h1' },
    });
    await settled();

    expect(part.launches).toEqual([]);
    expect(part.state()?.queued).toBe(0);
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

  // No row is set for `row-h1`: a user close removes the row before chat fires the event.
  it.each([
    {
      event: 'close',
      qualified: 'chat.sessionClosed',
      payload: { ...closedEvent('h1'), ephemeral: true },
    },
    {
      event: 'clear',
      qualified: 'chat.sessionCleared',
      payload: { ...clearedEvent('h0', 'h1', true), ephemeral: true },
    },
  ])('demoSession_$event_QueuesNoRetro', async ({ qualified, payload }) => {
    const part = startPart();
    await settled();

    part.harness.emit(qualified, payload);
    await settled();

    expect({
      launches: part.launches,
      queued: part.state()?.queued,
      ignored: part.messages().includes('ignored demo session row-h1'),
    }).toEqual({ launches: [], queued: 0, ignored: true });
  });

  it('demoStep_OverlaysTheRowAndCount_AndLeavingShowsTheRealState', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');
    const real = part.state();
    expect(real).toEqual({ rows: ['retro-1'], queued: 0 });

    const stage = await part.enterDemoStep();
    expect(part.state()).toEqual({
      rows: ['retro-1', 'row-demo'],
      queued: DEMO_QUEUED,
    });
    expect(JSON.stringify(await part.queueFile())).not.toContain('row-demo');

    stage.dispose();
    expect(part.state()).toEqual(real);
  });

  // Breaks: the slot keeping the demo overlay after the part stopped mid-step.
  it('demoStep_StopMidStep_ShowsTheRealState', async () => {
    const part = startPart();
    await settled();
    await part.close('h1');
    const real = part.state();
    await part.enterDemoStep();

    await part.harness.stop();

    expect(part.state()).toEqual(real);
  });

  // Breaks: a stage left after a restart dropping the new part's overlay.
  it('demoStep_LeftAfterARestart_LeavesTheNewStagesOverlay', async () => {
    const part = startPart();
    await settled();
    const stale = await part.enterDemoStep();
    await part.harness.restart();
    await settled();
    await part.enterDemoStep();

    stale.dispose();

    expect(part.state()).toEqual({ rows: ['row-demo'], queued: DEMO_QUEUED });
  });
});
