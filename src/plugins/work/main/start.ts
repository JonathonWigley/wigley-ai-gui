import type { AlertNoun } from '../../../contracts/alerts';
import {
  type Files,
  type FileWatch,
  readIfPresent,
} from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { isJsonObject, isSameJson } from '../../../shared/json';
import {
  type ChatMainEvents,
  chatMainKey,
  chatSessionSlot,
} from '../../chat/contract';
import {
  editableTitle,
  sessionsMainKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { unityPoolSnapshotSlot } from '../../unity-pool/contract';
import {
  readColumns,
  readProjects,
  type WorkChannel,
  type WorkJob,
  type WorkStartArg,
  type WorkStartResult,
  workStateSlot,
} from '../contract';
import { workManifest } from '../manifest';
import {
  type ActionResult,
  acceptSuggestion,
  addToBoard,
  clearStaleMarks,
  deleteTask,
  dismiss,
  isRefusal,
  jobEnded,
  moveCard,
  nextSnoozeEnd,
  notYet,
  type Refusal,
  restore,
  send,
  snooze,
} from './actions';
import { detectSuggestions, type SeenSignal } from './detection';
import { createJobRunner, type JobOutcome } from './job-runner';
import { jobMessage, WORKER_INSTRUCTIONS } from './job-text';
import { RESEED_FILE, workSelfTestScript } from './selftest-script';
import { fixtureFile, fixtureSignals } from './selftest-fixture';
import { createSignalWatch } from './signals';
import { linkSession, startFromWork } from './spin-up';
import { buildWorkState, createWorkStore, type WorkFile } from './store';
import { createSweepTimer } from './sweep-timer';
import { startWorkTools, WORK_TOOLS } from './work-tools';

type WorkMainApi = MainApi<
  typeof workManifest,
  WorkChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents>
>;

// The worker rows `openJobRow` can reopen, newest first, in plugin data.
export const JOB_ROWS_FILE = 'job-rows.json';
const KEPT_JOB_ROWS = 20;

const NEEDS_YOU_NOUN: AlertNoun = {
  singular: 'Slack item that needs you',
  plural: 'Slack items that need you',
};

const STILL_RUNNING = 'The job is still running';
const NO_TRANSCRIPT = 'No transcript for that job';

const SEED_DESCRIPTION =
  'Replaces the work store with the self-test fixture and seeds its signals.';

// A worker job's closed row, as `chat.sessionClosed` gave it: enough for `chat.resume` to reopen it.
interface JobRowRecord {
  rowId: string;
  hostSessionId: string;
  projectDir: string;
  profile: string;
  title: string;
}

const RECORD_FIELDS = [
  'rowId',
  'hostSessionId',
  'projectDir',
  'profile',
  'title',
] as const;

function parseJobRows(text: string): JobRowRecord[] {
  const parsed: unknown = JSON.parse(text);
  const isRecord = (value: unknown) => {
    if (!isJsonObject(value)) {
      return false;
    }
    const record = value;
    return RECORD_FIELDS.every((field) => typeof record[field] === 'string');
  };
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
    throw new Error('job-rows.json is not a list of job rows');
  }
  return (parsed as JobRowRecord[]).map((record) => ({
    rowId: record.rowId,
    hostSessionId: record.hostSessionId,
    projectDir: record.projectDir,
    profile: record.profile,
    title: record.title,
  }));
}

// `records` with `record` at the front, replacing the one for its row, cut to `KEPT_JOB_ROWS`.
function withRecord(
  records: readonly JobRowRecord[],
  record: JobRowRecord,
): JobRowRecord[] {
  return [
    record,
    ...records.filter((kept) => kept.rowId !== record.rowId),
  ].slice(0, KEPT_JOB_ROWS);
}

// `job-rows.json`, held in memory. `load` reads it once: a missing file is no records; one it cannot read or parse
// logs `job-rows.json not read: …`, starts empty and is never written this run. `keep` writes the whole list on one
// chain, a failed write logging `job-rows.json not written: …`; `settled` waits for the load and every write.
interface JobRows {
  load(): Promise<void>;
  find(rowId: string): JobRowRecord | undefined;
  keep(record: JobRowRecord): void;
  settled(): Promise<void>;
}

function createJobRows(data: Files, log: PluginLog): JobRows {
  let records: JobRowRecord[] = [];
  let isWritable = true;
  let loading: Promise<void> | null = null;
  let writes: Promise<void> = Promise.resolve();

  const write = () => {
    writes = writes.then(async () => {
      if (!isWritable) {
        return;
      }
      try {
        await data.write(JOB_ROWS_FILE, JSON.stringify(records, null, 2));
      } catch (error) {
        log(`job-rows.json not written: ${errorText(error)}`);
      }
    });
  };

  const read = async () => {
    try {
      const text = await readIfPresent(data, JOB_ROWS_FILE);
      const saved = text === null ? [] : parseJobRows(text);
      // A record kept before the read finished is newer than every saved one.
      const keptEarly = records;
      records = saved;
      for (const record of [...keptEarly].reverse()) {
        records = withRecord(records, record);
      }
    } catch (error) {
      log(`job-rows.json not read: ${errorText(error)}`);
      isWritable = false;
    }
  };

  return {
    load() {
      if (loading === null) {
        loading = read();
        writes = loading;
      }
      return loading;
    },
    find: (rowId) => records.find((record) => record.rowId === rowId),
    keep(record) {
      records = withRecord(records, record);
      write();
    },
    settled: () => Promise.all([loading, writes]).then(() => undefined),
  };
}

// `file` with `job.last.rowId` nulled when no kept record names it, so the views' Show transcript follows what can
// reopen; the same object otherwise.
function withKeptLastRow(file: WorkFile, rows: JobRows): WorkFile {
  const { last } = file.job;
  if (
    last === null ||
    last.rowId === null ||
    rows.find(last.rowId) !== undefined
  ) {
    return file;
  }
  return { ...file, job: { ...file.job, last: { ...last, rowId: null } } };
}

const openNeedsYou = (file: WorkFile) =>
  file.items.filter(
    (item) => item.section === 'needs_you' && item.state === 'open',
  ).length;

// A press main refused: the rejection the page toasts, its message the refusal text.
class PressRefused extends Error {}

// Keeps the user's work in `work.json` and publishes it as `work.state`, built against `work.columns`: the slot holds
// no value until the store's load ends, then is written again on each store change and each settings change. It
// runs the worker jobs (05) and gives the worker its tools (06), watches the work signals (07) and writes detection's
// suggestions back to the store, and handles every `WorkChannel` method with 08's actions, logging each press's line
// and each refusal under `[work]`. It sweeps once chat's restore settles and every `work.intervalMinutes` after a
// sweep's end, wakes snoozed items, sets the Dock badge to the open Needs you items, and reopens the last job's row.
// Outside a live run it seeds the self-test fixture: the self-test's script and reseed file, and the drive action
// `work.seed`. A self-test run never starts the runner, so no worker launches. `dispose` stops the watch and timers
// first, then waits for the runner, the job-row writes and the store.
export const workMainPart: MainPart<typeof workManifest> = {
  manifest: workManifest,
  start(api: WorkMainApi) {
    const { services, channel } = api;
    const { log, clock, timers } = services;
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const chatSessions = api.state.read(chatSessionSlot);
    const sessionRows = api.state.read(sessionsRowsSlot);
    const state = api.state.publish(workStateSlot);
    const store = createWorkStore(api.data, log);
    const jobRows = createJobRows(api.data, log);
    const isSelfTest = services.runMode === 'selfTest';
    let isLoaded = false;
    let isStopped = false;
    let needsYou = 0;
    let snoozeTimer: number | null = null;
    let intervalMinutes = api.settings().intervalMinutes;

    const columns = () => readColumns(api.settings().columns);

    const publish = () => {
      if (isStopped) {
        return;
      }
      state.set(buildWorkState(store.file(), columns(), store.problem()));
    };

    const runner = createJobRunner({
      chat,
      sessions,
      rows: sessionRows,
      sessionInfo: chatSessions,
      events: api.events,
      data: api.data,
      store,
      clock,
      timers,
      log,
      homeDir: services.homeDir,
      profile: () => api.settings().profile,
      instructions: () => [WORKER_INSTRUCTIONS],
      message: (job) =>
        jobMessage(
          job,
          { ...api.settings(), columns: columns() },
          store.file(),
        ),
      ended: (job, outcome) => onJobEnded(job, outcome),
    });

    const tools = sessions.contributeTools(
      WORK_TOOLS,
      startWorkTools({
        jobOf: (session) => runner.jobOf(session),
        report: (session, result) => runner.report(session, result),
        store,
        columns,
        clock,
      }),
    );

    const watch = createSignalWatch({
      git: services.git,
      pullRequests: services.pullRequests,
      chat,
      chatSessions,
      sessionRows,
      pools: api.state.read(unityPoolSnapshotSlot),
      repoFolders: () => api.settings().repoFolders,
      cards: () => store.file().cards,
      signals: () => api.settings().signals,
      columns,
      homeDir: services.homeDir,
      paths: services.paths,
      clock,
      timers,
      log,
      onSeen: () => redetect(),
    });

    // Queues `job` without waiting: a self-test's runner never starts, so its enqueue never resolves. A rejection
    // clears the press's mark with its note.
    const enqueue = (job: WorkJob) => {
      runner.enqueue(job).catch((error: unknown) => {
        log(`job not queued: ${errorText(error)}`);
        const end = { ok: false, note: `Not queued: ${errorText(error)}` };
        void store.update((file) => jobEnded(file, job, end, clock.now()));
      });
    };

    const queueSweep = () => {
      enqueue({ kind: 'sweep' });
      log('sweep queued');
    };

    const sweepTimer = createSweepTimer({
      timers,
      clock,
      intervalMinutes: () => api.settings().intervalMinutes,
      sweep: queueSweep,
    });

    const detected = (file: WorkFile, seen: readonly SeenSignal[]) =>
      detectSuggestions({
        cards: file.cards,
        seen,
        signals: api.settings().signals,
        columns: columns(),
        notYet: file.notYet,
      });

    // Writes detection's suggestions to the store when they differ from its own. Before the first gather or seed
    // finishes it does nothing, so the saved suggestions stand.
    const redetect = () => {
      const seen = watch.latest();
      if (isStopped || seen === null) {
        return;
      }
      const file = store.file();
      if (isSameJson(detected(file, seen), file.suggestions)) {
        return;
      }
      void store.update((current) => ({
        ...current,
        suggestions: detected(current, seen),
      }));
    };

    const setBadge = (file: WorkFile) => {
      if (isStopped) {
        return;
      }
      const count = openNeedsYou(file);
      services.alerts.setOpenCount('work', count, NEEDS_YOU_NOUN);
      if (count !== needsYou) {
        needsYou = count;
        log(`needs you: ${count}`);
      }
    };

    const clearSnoozeTimer = () => {
      if (snoozeTimer !== null) {
        timers.clear(snoozeTimer);
        snoozeTimer = null;
      }
    };

    // One timer at the earliest snooze end, replacing the last; its fire expires the snoozes then due.
    const armSnoozeTimer = (file: WorkFile) => {
      clearSnoozeTimer();
      const end = nextSnoozeEnd(file);
      if (isStopped || end === null) {
        return;
      }
      snoozeTimer = timers.set(
        () => {
          snoozeTimer = null;
          const expiry = { ok: true, note: null };
          void store.update((current) =>
            jobEnded(current, { kind: 'sweep' }, expiry, clock.now()),
          );
        },
        Math.max(0, end - clock.now()),
      );
    };

    const onJobEnded = (job: WorkJob, outcome: JobOutcome) => {
      void store.update((file) =>
        withKeptLastRow(jobEnded(file, job, outcome, clock.now()), jobRows),
      );
      if (job.kind === 'sweep') {
        sweepTimer.sweepEnded();
        watch.refresh();
      }
    };

    // Logs the refusal of `method` and returns the rejection that carries it.
    const refusal = (method: string, text: string) => {
      log(`refused ${method}: ${text}`);
      return new PressRefused(text);
    };

    // Runs a press's action inside one store update, so a refusal changes nothing; then logs its line and queues
    // its job.
    const press = async (
      method: string,
      action: (file: WorkFile) => ActionResult | Refusal,
    ): Promise<void> => {
      let pressed!: ActionResult;
      try {
        await store.update((file) => {
          const outcome = action(file);
          if (isRefusal(outcome)) {
            throw new PressRefused(outcome.refused);
          }
          pressed = outcome;
          return outcome.file;
        });
      } catch (error) {
        if (error instanceof PressRefused) {
          throw refusal(method, error.message);
        }
        throw error;
      }
      log(pressed.log);
      if (pressed.job !== null) {
        enqueue(pressed.job);
      }
    };

    const startSession = async (
      arg: WorkStartArg,
    ): Promise<WorkStartResult> => {
      const projects = () => readProjects(api.settings().projects);
      const result = await startFromWork(
        { chat, projects, log },
        store.file(),
        arg,
      );
      if ('refused' in result) {
        throw refusal('startSession', result.refused);
      }
      if (result.kind === 'prompt') {
        return result;
      }
      const link = { cardIds: result.cardIds, sessionId: result.rowId };
      await store.update((file) => linkSession(file, link));
      return { kind: 'launched', toast: result.toast };
    };

    // Reopens `job.last`'s row from its record, a running job's own row being held by chat for work.
    const openJobRow = async () => {
      const { running, last } = store.file().job;
      const record =
        last === null || last.rowId === null
          ? undefined
          : jobRows.find(last.rowId);
      if (record === undefined) {
        throw refusal(
          'openJobRow',
          running === null ? NO_TRANSCRIPT : STILL_RUNNING,
        );
      }
      try {
        await chat.resume({
          projectDir: record.projectDir,
          profile: record.profile,
          hostSessionId: record.hostSessionId,
          title: record.title,
        });
      } catch (error) {
        throw refusal('openJobRow', errorText(error));
      }
    };

    // Replaces the store with the fixture and seeds its signals; resolves to the problems its counts show.
    const seed = async (): Promise<string[]> => {
      await store.update(() => fixtureFile(clock.now()));
      watch.seed(fixtureSignals(clock.now()));
      await store.settled();
      const file = store.file();
      const counts = {
        items: file.items.length,
        cards: file.cards.length,
        suggestions: file.suggestions.length,
      };
      log(
        `fixture seeded: ${counts.items} items, ${counts.cards} cards, ${counts.suggestions} suggestions`,
      );
      const wanted = { items: 7, cards: 7, suggestions: 3 };
      const problems: string[] = [];
      for (const name of ['items', 'cards', 'suggestions'] as const) {
        if (counts[name] !== wanted[name]) {
          problems.push(`${counts[name]} ${name}, not ${wanted[name]}`);
        }
      }
      if (needsYou !== 1) {
        problems.push(`badge ${needsYou}, not 1`);
      }
      return problems;
    };

    store.onChange((file) => {
      publish();
      setBadge(file);
      armSnoozeTimer(file);
      redetect();
    });
    api.onSettingsChanged((settings) => {
      if (isLoaded) {
        publish();
      }
      redetect();
      if (settings.intervalMinutes !== intervalMinutes) {
        intervalMinutes = settings.intervalMinutes;
        sweepTimer.reschedule();
      }
    });
    api.events.on('chat.sessionClosed', (event) => {
      const { running, last } = store.file().job;
      const isJobRow =
        event.sessionId === running?.rowId || event.sessionId === last?.rowId;
      if (!isJobRow) {
        return;
      }
      jobRows.keep({
        rowId: event.sessionId,
        hostSessionId: event.hostSessionId,
        projectDir: event.projectDir,
        profile: event.profile,
        title: editableTitle(event.titles),
      });
    });

    channel.handle('sweep', async () => {
      queueSweep();
    });
    channel.handle('send', (arg) => press('send', (file) => send(file, arg)));
    channel.handle('dismiss', (itemId) =>
      press('dismiss', (file) => dismiss(file, itemId)),
    );
    channel.handle('restore', (itemId) =>
      press('restore', (file) => restore(file, itemId)),
    );
    channel.handle('snooze', (itemId) =>
      press('snooze', (file) => snooze(file, itemId, clock.now())),
    );
    channel.handle('addToBoard', (itemId) => {
      const newId = `local-${services.randomUuid()}`;
      return press('addToBoard', (file) =>
        addToBoard(file, itemId, newId, columns()),
      );
    });
    channel.handle('moveCard', (arg) =>
      press('moveCard', (file) => moveCard(file, arg, columns(), clock.now())),
    );
    channel.handle('acceptSuggestion', (cardId) =>
      press('acceptSuggestion', (file) =>
        acceptSuggestion(file, cardId, columns(), clock.now()),
      ),
    );
    channel.handle('notYet', (cardId) =>
      press('notYet', (file) => notYet(file, cardId)),
    );
    channel.handle('deleteTask', (cardId) =>
      press('deleteTask', (file) => deleteTask(file, cardId)),
    );
    channel.handle('startSession', startSession);
    channel.handle('linkSession', async (arg) => {
      await store.update((file) => linkSession(file, arg));
    });
    channel.handle('openJobRow', openJobRow);

    void Promise.all([store.load(), jobRows.load()]).then(() => {
      if (withKeptLastRow(store.file(), jobRows) !== store.file()) {
        void store.update((file) => withKeptLastRow(file, jobRows));
      }
    });

    if (api.drive !== null) {
      api.drive.add('seed', {
        description: SEED_DESCRIPTION,
        args: '{}',
        run: () => seed(),
      });
    }
    services.selfTest?.run(workSelfTestScript({ seed }));
    let reseedWatch: FileWatch | null = null;
    if (isSelfTest) {
      reseedWatch = api.data.watch(
        '',
        (path) => {
          if (path === RESEED_FILE) {
            seed().catch((error: unknown) =>
              log(`fixture not seeded: ${errorText(error)}`),
            );
          }
        },
        { recursive: false },
      );
    }

    void store.load().then(() => {
      isLoaded = true;
      publish();
      setBadge(store.file());
      armSnoozeTimer(store.file());
      redetect();
    });

    // The start gather, then, outside the self-test, the runner and the start sweep, and the marks of jobs a lost
    // queue dropped.
    const begin = async () => {
      if (isStopped) {
        return;
      }
      watch.refresh();
      if (isSelfTest) {
        return;
      }
      runner.start();
      log('sweep queued');
      try {
        await runner.enqueue({ kind: 'sweep' });
      } catch (error) {
        log(`job not queued: ${errorText(error)}`);
        return;
      }
      await store.update((file) => clearStaleMarks(file, runner.pending()));
    };

    return {
      commands: {},
      ready() {
        void chat
          .restored()
          .then(begin)
          .catch((error: unknown) =>
            log(`start not finished: ${errorText(error)}`),
          );
      },
      async dispose() {
        isStopped = true;
        watch.dispose();
        clearSnoozeTimer();
        sweepTimer.dispose();
        reseedWatch?.dispose();
        tools.dispose();
        await runner.dispose();
        await jobRows.settled();
        await store.settled();
      },
    };
  },
};
