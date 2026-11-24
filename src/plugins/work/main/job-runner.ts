import type { Clock, Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import { type Files, readIfPresent } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type { PluginEvents, QualifiedEvents } from '../../../contracts/plugin';
import type { KeyedSlotReader } from '../../../contracts/state';
import { errorText } from '../../../shared/error-text';
import type {
  ChatMainEvents,
  ChatMainExports,
  ChatSessionInfo,
  SessionCloseReason,
} from '../../chat/contract';
import {
  type AgentSession,
  followRows,
  type SessionRow,
  type SessionsMainExports,
} from '../../sessions/contract';
import type { WorkJob, WorkJobStatus } from '../contract';
import { workManifest } from '../manifest';
import {
  EMPTY_JOB_QUEUE,
  type JobQueue,
  type JobQueueEvent,
  type JobResult,
  nextJobQueue,
  parseJobQueue,
  type RunningJob,
} from './job-queue';
import type { WorkStore } from './store';

export const JOB_QUEUE_FILE = 'queue.json';

// How long a job's row reads done before it is closed.
export const SETTLE_MS = 5_000;

// How long after a start a running job's row has to come back before the job fails.
export const RESTORE_WAIT_MS = 30_000;

// How long a launched row has to report its host id before it is closed and the job fails.
export const HOST_WAIT_MS = 30_000;

// How long a job runs before its row is closed and the job fails.
export const JOB_TIMEOUT_MS = 20 * 60_000;

const NO_PROFILE_NOTE =
  'No profile to run on: set work.profile, or a default harness with a profile.';
const GONE_NOTE = 'Its item or card is gone.';
const ROW_GONE_NOTE = 'Its session was gone at launch.';
const HOST_MISSED_NOTE = 'Its session never reported its id, so it was closed.';
const RESTORE_MISSED_NOTE = 'Its session did not come back after the restart.';
const TIMEOUT_NOTE = 'The job ran past 20 minutes and was stopped.';
const NO_REPORT_NOTE = 'The worker ended without reporting a result.';
const CLOSED_BEFORE_NOTE = 'Its session closed before it reported.';
const NOT_LAUNCHED_NOTE = 'Not launched: this run launches no worker.';

// True once a job row that has started its first turn rests with nothing running: its process ended, or its turn is
// idle with no subagent, task or compaction still running. `hasStarted` false is a row whose first turn has not
// begun, which reads idle too.
export function isJobDone(
  info: ChatSessionInfo | undefined,
  hasStarted: boolean,
): boolean {
  if (info === undefined || !hasStarted) {
    return false;
  }
  if (!info.running) {
    return true;
  }
  return (
    info.activity === 'idle' &&
    info.background === 0 &&
    info.compaction === null
  );
}

// How a job ended: `startedAt` is null for none, `rowId` null for a job that never had a row.
export interface JobOutcome {
  ok: boolean;
  note: string | null;
  startedAt: string | null;
  rowId: string | null;
}

export interface JobRunnerDeps {
  chat: Pick<
    ChatMainExports,
    'launch' | 'close' | 'restored' | 'defaultProfile'
  >;
  sessions: Pick<SessionsMainExports, 'setTitle'>;
  rows: KeyedSlotReader<SessionRow>; // sessions.rows
  sessionInfo: KeyedSlotReader<ChatSessionInfo>; // chat.session
  events: Pick<
    PluginEvents<Record<never, never>, QualifiedEvents<'chat', ChatMainEvents>>,
    'on'
  >;
  data: Files;
  store: Pick<WorkStore, 'update'>;
  clock: Clock;
  timers: Timers;
  log: PluginLog;
  homeDir: string;
  launchesWorkers: boolean; // false: the head waits as `queued` and no worker launches
  profile(): string; // the work.profile setting, read at each launch
  instructions(): readonly string[]; // the worker's standing text, read at each launch
  message(job: WorkJob): string | null; // the job's first message; null: its item or card is gone
  ended(job: WorkJob, outcome: JobOutcome): void; // after the store records the end
}

// - `start` loads `queue.json`, waits for chat's restore, puts a job a quit cut short back at the head, applies every
//   enqueue held before it, writes `job.running`, claims a restored running job's row, closes every other work row,
//   then launches the head. A second `start` does nothing.
// - `enqueue` resolves once its job is queued and `queue.json` saved, and rejects with the error of a step that threw
//   (a failed `work.json` write), which is logged too; before `start` it is held, and resolves at the start's apply or
//   at `dispose`.
// - `pending` is the running job, then the queued ones in run order, then any held enqueues.
// - `jobOf` is the running job when `session` is its row's or host's; else null. `report` records the result of that
//   same session's job and returns true; for any other session it returns false.
// - `dispose` waits for the chain, then clears every timer and subscription. It closes no row.
export interface JobRunner {
  start(): void;
  enqueue(job: WorkJob): Promise<void>;
  pending(): WorkJob[];
  jobOf(session: AgentSession): WorkJob | null;
  report(session: AgentSession, result: JobResult): boolean;
  dispose(): Promise<void>;
}

// The ended job, its outcome and the end time, which the end's status write records as `job.last`.
interface JobEnd {
  job: WorkJob;
  outcome: JobOutcome;
  at: string;
}

function rowTitle(job: WorkJob): string {
  switch (job.kind) {
    case 'sweep':
      return 'Work sweep';
    case 'send':
      return 'Work send';
    case 'nudge':
      return 'Work nudge';
    case 'move':
      return `Work move ${job.key}`;
    case 'comment':
      return `Work comment ${job.key}`;
  }
}

// `job.running` for `running`: queued while its launch is pending, running once launched. A run that launches no
// worker notes so on its unlaunched job.
function runningStatus(
  running: RunningJob | null,
  launchesWorkers: boolean,
): WorkJobStatus | null {
  if (running === null) {
    return null;
  }
  const isLaunched = running.hostSessionId !== null;
  const isHeldUnlaunched = !isLaunched && !launchesWorkers;
  return {
    kind: running.job.kind,
    state: isLaunched ? 'running' : 'queued',
    rowId: isLaunched ? running.rowId : null,
    at: running.startedAt,
    note: isHeldUnlaunched ? NOT_LAUNCHED_NOTE : null,
  };
}

// Whether `a` and `b` are the same run of one job, across the queue's copies of it.
function isSameRun(a: RunningJob | null, b: RunningJob): boolean {
  return a !== null && a.job === b.job && a.startedAt === b.startedAt;
}

function endStatus(end: JobEnd): WorkJobStatus {
  return {
    kind: end.job.kind,
    state: end.outcome.ok ? 'done' : 'failed',
    rowId: end.outcome.rowId,
    at: end.at,
    note: end.outcome.note,
  };
}

// The outcome of `running` ended by its row's close: a timeout's whatever it reported, else its report, else a
// failure noted `failedNote`.
function closedOutcome(
  running: RunningJob,
  isTimedOut: boolean,
  failedNote: string,
): JobOutcome {
  const base = { startedAt: running.startedAt, rowId: running.rowId };
  if (isTimedOut) {
    return { ...base, ok: false, note: TIMEOUT_NOTE };
  }
  if (running.result !== null) {
    return { ...base, ...running.result };
  }
  return { ...base, ok: false, note: failedNote };
}

// Runs one unattended, permissive `work` row per job, one at a time, from a queue kept in `queue.json` in the plugin
// data. Every event, launch result, report and enqueue applies in one serial chain that `start` begins. A launched
// row has `HOST_WAIT_MS` to report its host id. A job ends when its row closes: after it reads done for `SETTLE_MS`,
// when its process ends, past `JOB_TIMEOUT_MS`, or by the user; a close is matched by row or host id, so a `/clear`
// on the row still ends it. The running job follows its row to each new host, and a restart claims its row by row id
// or host. With `launchesWorkers` false the head is never launched, and `job.running` notes so. Each change writes
// `job.running` to the store, and each end `job.last` (and a good sweep's `lastSweepAt`), then calls `ended`.
export function createJobRunner(deps: JobRunnerDeps): JobRunner {
  const { chat, rows, sessionInfo, clock, timers, log } = deps;
  let queue: JobQueue = EMPTY_JOB_QUEUE;
  let isStarted = false;
  let isDisposed = false;
  let isFileWritable = true;
  // Enqueues made before `start`, in call order.
  const held: { job: WorkJob; resolve: () => void }[] = [];
  // The row id the running job's launch resolved to, set before its `launched` step runs.
  let launchedRowId: string | null = null;
  // The run its timeout closed, so its end reads as a timeout.
  let timedOutRun: RunningJob | null = null;
  // Row ids whose first turn began, kept until the row leaves the side bar.
  const startedRows = new Set<string>();
  // The running job's timers: each one's fire does nothing once the job it was armed for no longer runs.
  const jobTimers: {
    host: number | null;
    settle: number | null;
    timeout: number | null;
    restore: number | null;
  } = { host: null, settle: null, timeout: null, restore: null };
  const subscriptions: Disposable[] = [];

  let chain: Promise<void> = Promise.resolve();
  // Runs `step` after every earlier step settled, so each applies to the state the last one left. The result
  // settles as the step did; the chain logs a step's error and goes on.
  const runStep = (step: () => Promise<void> | void): Promise<void> => {
    const run = chain.then(() => (isDisposed ? undefined : step()));
    chain = run.catch((error: unknown) =>
      log(`work job step failed: ${errorText(error)}`),
    );
    return run;
  };
  // `runStep` for a caller that does not hear the step's error; resolves once the step has settled.
  const serial = (step: () => Promise<void> | void): Promise<void> => {
    void runStep(step).catch(() => undefined);
    return chain;
  };

  const nowText = () => new Date(clock.now()).toISOString();

  const clearJobTimer = (name: keyof typeof jobTimers) => {
    const handle = jobTimers[name];
    if (handle !== null) {
      timers.clear(handle);
      jobTimers[name] = null;
    }
  };

  const clearJobTimers = () => {
    clearJobTimer('host');
    clearJobTimer('settle');
    clearJobTimer('timeout');
    clearJobTimer('restore');
  };

  // Arms one of the running job's timers, whose fire is a chain step that runs `fire` only while the timer was not
  // cleared since and `isArmedJob` still holds.
  const armTimer = (
    name: keyof typeof jobTimers,
    ms: number,
    isArmedJob: () => boolean,
    fire: () => Promise<void> | void,
  ) => {
    clearJobTimer(name);
    const handle = timers.set(
      () =>
        void serial(() => {
          if (jobTimers[name] !== handle) {
            return;
          }
          jobTimers[name] = null;
          return isArmedJob() ? fire() : undefined;
        }),
      ms,
    );
    jobTimers[name] = handle;
  };

  // `armTimer` for `running`, whichever host its row moves to.
  const armJobTimer = (
    name: keyof typeof jobTimers,
    running: RunningJob,
    ms: number,
    fire: () => Promise<void> | void,
  ) => armTimer(name, ms, () => isSameRun(queue.running, running), fire);

  const save = async () => {
    if (!isFileWritable) {
      return;
    }
    try {
      await deps.data.write(JOB_QUEUE_FILE, JSON.stringify(queue, null, 2));
    } catch (error) {
      log(`queue.json not written: ${errorText(error)}`);
    }
  };

  const writeStatus = async (end: JobEnd | null) => {
    const running = runningStatus(queue.running, deps.launchesWorkers);
    await deps.store.update((file) => {
      if (end === null) {
        return { ...file, job: { ...file.job, running } };
      }
      const isGoodSweep = end.job.kind === 'sweep' && end.outcome.ok;
      return {
        ...file,
        job: { running, last: endStatus(end) },
        lastSweepAt: isGoodSweep ? end.outcome.startedAt : file.lastSweepAt,
      };
    });
  };

  const tellEnded = (end: JobEnd) => {
    try {
      deps.ended(end.job, end.outcome);
    } catch (error) {
      log(`work job step failed: ${errorText(error)}`);
    }
  };

  // Takes `next` as the queue, moves the head to running when none runs, saves, writes the status (with `end` as
  // `job.last`), tells `ended`, and launches the new run.
  const commit = async (next: JobQueue, end: JobEnd | null = null) => {
    queue = nextJobQueue(next, { kind: 'launching', at: nowText() });
    const newRun = next.running === null ? queue.running : null;
    await save();
    await writeStatus(end);
    if (end !== null) {
      tellEnded(end);
    }
    if (newRun !== null) {
      launch(newRun);
    }
  };

  const apply = (event: JobQueueEvent) => commit(nextJobQueue(queue, event));

  // Ends the running job by `event` with `outcome`, clearing what belonged to it.
  const endJob = (
    running: RunningJob,
    event: JobQueueEvent,
    outcome: JobOutcome,
  ) => {
    clearJobTimers();
    launchedRowId = null;
    timedOutRun = null;
    return commit(nextJobQueue(queue, event), {
      job: running.job,
      outcome,
      at: nowText(),
    });
  };

  // Fails the running job before it had a row.
  const failUnlaunched = (note: string) => {
    const { running } = queue;
    if (running === null) {
      return;
    }
    return endJob(
      running,
      { kind: 'launchFailed' },
      { ok: false, note, startedAt: running.startedAt, rowId: null },
    );
  };

  // Ends the running job by the close of row `rowId` on `host`, noted `failedNote` when nothing else gives a note. The
  // row id matches a row a `/clear` moved to a new host; the host matches a restored row not yet claimed.
  const endByClose = (rowId: string, host: string, failedNote: string) => {
    const { running } = queue;
    const runningHost = running?.hostSessionId ?? null;
    if (running === null || runningHost === null) {
      return;
    }
    const isRunningRow = running.rowId === rowId || runningHost === host;
    if (!isRunningRow) {
      return;
    }
    const isTimedOut = timedOutRun !== null && isSameRun(running, timedOutRun);
    const outcome = closedOutcome(running, isTimedOut, failedNote);
    return endJob(
      running,
      { kind: 'closed', hostSessionId: runningHost },
      outcome,
    );
  };

  // Closes a row no job runs on `finished`, logging a close that rejects.
  const closeLogged = (rowId: string) => {
    chat
      .close(rowId, 'finished')
      .catch((error: unknown) =>
        log(`work row ${rowId} not closed: ${errorText(error)}`),
      );
  };

  // Closes the running job's row `finished`; a close that rejects ends the job as if closed.
  const closeRow = (rowId: string, host: string) => {
    chat.close(rowId, 'finished').catch((error: unknown) => {
      const text = errorText(error);
      log(`work row ${rowId} not closed: ${text}`);
      void serial(() =>
        endByClose(rowId, host, `Its session could not be closed: ${text}`),
      );
    });
  };

  const closeIfStillDone = () => {
    const running = queue.running;
    if (running?.rowId == null || running.hostSessionId === null) {
      return;
    }
    if (
      isJobDone(sessionInfo.get(running.rowId), startedRows.has(running.rowId))
    ) {
      closeRow(running.rowId, running.hostSessionId);
    }
  };

  // Starts the running row's settle wait when it reads done, and drops that wait when it reads not done.
  const checkDone = () => {
    const running = queue.running;
    if (running?.rowId == null || running.hostSessionId === null) {
      return;
    }
    const { rowId } = running;
    if (!isJobDone(sessionInfo.get(rowId), startedRows.has(rowId))) {
      clearJobTimer('settle');
      return;
    }
    if (jobTimers.settle === null) {
      armJobTimer('settle', running, SETTLE_MS, closeIfStillDone);
    }
  };

  const timedOut = () => {
    const running = queue.running;
    if (running?.rowId == null || running.hostSessionId === null) {
      return;
    }
    timedOutRun = running;
    closeRow(running.rowId, running.hostSessionId);
  };

  // Arms the running job's timeout for what is left of `JOB_TIMEOUT_MS` since it started; with none left, closes now.
  const armTimeout = (running: RunningJob) => {
    const elapsed = clock.now() - Date.parse(running.startedAt);
    const remaining = Math.max(0, JOB_TIMEOUT_MS - elapsed);
    if (remaining === 0) {
      timedOut();
      return;
    }
    armJobTimer('timeout', running, remaining, timedOut);
  };

  // The running row's process ended, so nothing more runs in it: it closes now rather than at the timeout.
  const rowProcessEnded = (rowId: string) => {
    const { running } = queue;
    if (running?.rowId !== rowId || running.hostSessionId === null) {
      return;
    }
    clearJobTimer('settle');
    closeRow(rowId, running.hostSessionId);
  };

  // True while the running job's launch resolved to `rowId` and its row has reported no host id.
  const isAwaitingHost = (rowId: string) =>
    launchedRowId === rowId && queue.running?.hostSessionId === null;

  const hostMissed = (rowId: string) => {
    closeLogged(rowId);
    return failUnlaunched(HOST_MISSED_NOTE);
  };

  // The launched row's host id, once its row holds one: now, at a later `rows` change, or never within
  // `HOST_WAIT_MS`, when the row is closed and the job fails.
  const launched = async (rowId: string) => {
    const row = rows.get(rowId);
    if (row === undefined) {
      await failUnlaunched(ROW_GONE_NOTE);
      return;
    }
    if (row.hostSessionId === null) {
      armTimer(
        'host',
        HOST_WAIT_MS,
        () => isAwaitingHost(rowId),
        () => hostMissed(rowId),
      );
      return;
    }
    await adoptHost(rowId, row.hostSessionId);
  };

  // A row change during the host wait: the launched row taking its host id, or leaving before it had one.
  const hostWaitRowChanged = (rowId: string, row: SessionRow | undefined) => {
    if (jobTimers.host === null || !isAwaitingHost(rowId)) {
      return;
    }
    if (row === undefined) {
      return failUnlaunched(ROW_GONE_NOTE);
    }
    if (row.hostSessionId === null) {
      return;
    }
    clearJobTimer('host');
    return adoptHost(rowId, row.hostSessionId);
  };

  const adoptHost = async (rowId: string, host: string) => {
    await apply({ kind: 'launched', hostSessionId: host, rowId });
    const { running } = queue;
    if (running === null) {
      return;
    }
    try {
      deps.sessions.setTitle(rowId, 'user', rowTitle(running.job));
    } catch (error) {
      log(`work row ${rowId} not titled: ${errorText(error)}`);
    }
    armTimeout(running);
    checkDone();
  };

  const launchFailed = (error: unknown) => {
    launchedRowId = null;
    void serial(() => failUnlaunched(`Launch failed: ${errorText(error)}`));
  };

  // Launches `running`'s row, failing the job unlaunched when a step of the launch throws or rejects.
  const launch = (running: RunningJob) => {
    if (!deps.launchesWorkers) {
      log(
        `work ${running.job.kind} job not launched: this run launches no worker`,
      );
      return;
    }
    try {
      startLaunch(running);
    } catch (error) {
      launchFailed(error);
    }
  };

  const startLaunch = (running: RunningJob) => {
    const setting = deps.profile();
    const profile = setting !== '' ? setting : chat.defaultProfile(null);
    if (profile === null || profile === '') {
      void serial(() => failUnlaunched(NO_PROFILE_NOTE));
      return;
    }
    const text = deps.message(running.job);
    if (text === null) {
      void serial(() => failUnlaunched(GONE_NOTE));
      return;
    }
    chat
      .launch({
        projectDir: deps.homeDir,
        profile,
        message: { text, images: [] },
        instructions: deps.instructions(),
        unattended: true,
        permissions: 'auto',
        owner: workManifest.id,
      })
      .then((rowId) => {
        launchedRowId = rowId;
        void serial(() => launched(rowId));
      }, launchFailed);
  };

  // Whether `row` is the launched `running` job's row: by its row id, which a `/clear` keeps, or by its host.
  const isRunningRow = (row: SessionRow, running: RunningJob) =>
    running.hostSessionId !== null &&
    (row.sessionId === running.rowId ||
      row.hostSessionId === running.hostSessionId);

  // The side bar's row of the launched `running` job: the row with its row id, else the row on its host.
  const runningRowOf = (running: RunningJob) => {
    const byId = running.rowId === null ? undefined : rows.get(running.rowId);
    if (byId !== undefined) {
      return byId;
    }
    return [...rows.all().values()].find(
      (row) => row.hostSessionId === running.hostSessionId,
    );
  };

  // Claims the running job's restored row as started, taking the row's id and current host (or the saved host while the row has none), then arms its timeout
  // and checks it for done.
  const claimRestored = async (row: SessionRow) => {
    const host = row.hostSessionId ?? queue.running?.hostSessionId ?? null;
    if (host === null) {
      return;
    }
    clearJobTimer('restore');
    await apply({
      kind: 'rowRestored',
      hostSessionId: host,
      rowId: row.sessionId,
    });
    const { running } = queue;
    if (running === null) {
      return;
    }
    startedRows.add(row.sessionId);
    armTimeout(running);
    checkDone();
  };

  // A row that joins, or takes a host, during the restore wait is the running job's restored row when it carries
  // the job's row id or host.
  const claimIfAwaited = (row: SessionRow) => {
    const { running } = queue;
    const isAwaitedRow =
      jobTimers.restore !== null &&
      running !== null &&
      isRunningRow(row, running);
    return isAwaitedRow ? claimRestored(row) : undefined;
  };

  // The running row took a new host, as a `/clear` gives it: the running job follows it there.
  const followRunningHost = (row: SessionRow) => {
    const { running } = queue;
    const newHost = row.hostSessionId;
    const isMovedRunningRow =
      running !== null &&
      running.hostSessionId !== null &&
      row.sessionId === running.rowId &&
      newHost !== running.hostSessionId;
    if (newHost === null || !isMovedRunningRow) {
      return;
    }
    return apply({
      kind: 'hostChanged',
      rowId: row.sessionId,
      hostSessionId: newHost,
    });
  };

  // A row that joined or took a host: the running job's restored row, its row moved to a new host, or its launched
  // row reporting its host.
  const rowHostSeen = async (row: SessionRow) => {
    await claimIfAwaited(row);
    await followRunningHost(row);
    await hostWaitRowChanged(row.sessionId, row);
  };

  const restoreWaitEnded = () => {
    const { running } = queue;
    if (running?.hostSessionId == null) {
      return;
    }
    const row = runningRowOf(running);
    if (row !== undefined) {
      return claimRestored(row);
    }
    return endJob(
      running,
      { kind: 'restoreMissed', hostSessionId: running.hostSessionId },
      {
        ok: false,
        note: RESTORE_MISSED_NOTE,
        startedAt: running.startedAt,
        rowId: null,
      },
    );
  };

  const closeStrayRows = () => {
    const claimed = queue.running?.rowId ?? null;
    for (const row of rows.all().values()) {
      const isStray =
        row.owner === workManifest.id && row.sessionId !== claimed;
      if (!isStray) {
        continue;
      }
      log(`closed stray work row ${row.sessionId}`);
      closeLogged(row.sessionId);
    }
  };

  // The kept running job claims its restored row, or waits `RESTORE_WAIT_MS` for it.
  const claimOnRestart = async () => {
    const { running } = queue;
    if (running?.hostSessionId == null) {
      return;
    }
    const row = runningRowOf(running);
    if (row !== undefined) {
      await claimRestored(row);
      return;
    }
    armJobTimer('restore', running, RESTORE_WAIT_MS, restoreWaitEnded);
  };

  const jobOf = (session: AgentSession): WorkJob | null => {
    const { running } = queue;
    if (running === null) {
      return null;
    }
    const { rowId, sessionId } = session.info;
    const isJobsRow =
      rowId !== null && (rowId === running.rowId || rowId === launchedRowId);
    const isJobsHost =
      sessionId !== null && sessionId === running.hostSessionId;
    return isJobsRow || isJobsHost ? running.job : null;
  };

  const isJobRow = (rowId: string) =>
    rowId === launchedRowId || rowId === queue.running?.rowId;

  const subscribe = () => {
    subscriptions.push(
      deps.events.on(
        'chat.sessionClosed',
        ({ sessionId, hostSessionId, reason }) => {
          void serial(() =>
            endByClose(sessionId, hostSessionId, closeNote(reason)),
          );
        },
      ),
      deps.events.on('chat.processEnded', ({ sessionId }) => {
        void serial(() => rowProcessEnded(sessionId));
      }),
      deps.events.on('chat.turnStarted', ({ sessionId }) => {
        void serial(() => {
          startedRows.add(sessionId);
          checkDone();
        });
      }),
      sessionInfo.on((sessionId, info) => {
        if (!isJobRow(sessionId)) {
          return;
        }
        if (info !== undefined && info.activity !== 'idle') {
          startedRows.add(sessionId);
        }
        checkDone();
      }),
      followRows(rows, {
        added: (row) => void serial(() => rowHostSeen(row)),
        hostChanged: (row) => void serial(() => rowHostSeen(row)),
        removed: (sessionId) => {
          startedRows.delete(sessionId);
          void serial(() => hostWaitRowChanged(sessionId, undefined));
        },
      }),
    );
  };

  const load = async () => {
    try {
      const text = await readIfPresent(deps.data, JOB_QUEUE_FILE);
      queue = text === null ? EMPTY_JOB_QUEUE : parseJobQueue(text);
    } catch (error) {
      isFileWritable = false;
      log(`queue.json not read: ${errorText(error)}`);
    }
  };

  const begin = async () => {
    await load();
    await chat.restored();
    queue = nextJobQueue(queue, { kind: 'started' });
    await save();
    for (const { job, resolve } of held.splice(0)) {
      queue = nextJobQueue(queue, { kind: 'enqueued', job, at: nowText() });
      await save();
      resolve();
    }
    await writeStatus(null);
    subscribe();
    await claimOnRestart();
    closeStrayRows();
    await commit(queue);
  };

  return {
    start() {
      if (isStarted || isDisposed) {
        return;
      }
      isStarted = true;
      void serial(begin);
    },
    enqueue(job) {
      if (isDisposed) {
        return Promise.resolve();
      }
      if (!isStarted) {
        return new Promise((resolve) => held.push({ job, resolve }));
      }
      return runStep(() =>
        commit(nextJobQueue(queue, { kind: 'enqueued', job, at: nowText() })),
      );
    },
    pending() {
      const runningJobs = queue.running === null ? [] : [queue.running.job];
      return [
        ...runningJobs,
        ...queue.queued.map(({ job }) => job),
        ...held.map(({ job }) => job),
      ];
    },
    jobOf,
    report(session, result) {
      const job = jobOf(session);
      if (job === null) {
        return false;
      }
      void serial(() =>
        queue.running?.job === job
          ? apply({ kind: 'reported', result })
          : undefined,
      );
      return true;
    },
    async dispose() {
      if (!isStarted) {
        isDisposed = true;
        for (const { resolve } of held.splice(0)) {
          resolve();
        }
        return;
      }
      await chain;
      isDisposed = true;
      clearJobTimers();
      for (const subscription of subscriptions.splice(0)) {
        subscription.dispose();
      }
    },
  };
}

// The note of a job whose row closed by `reason` before it reported.
function closeNote(reason: SessionCloseReason): string {
  return reason === 'finished' ? NO_REPORT_NOTE : CLOSED_BEFORE_NOTE;
}
