import type { AlertNoun } from '../../../contracts/alerts';
import type { FileWatch } from '../../../contracts/files';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { isSameJson } from '../../../shared/json';
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
  workDetailsSlot,
  workStateSlot,
} from '../contract';
import { workManifest } from '../manifest';
import {
  type ActionResult,
  acceptSuggestion,
  addToBoard,
  clearStaleMarks,
  comment,
  deleteTask,
  dismiss,
  expireSnoozes,
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
import { createJobRows, withKeptLastRow } from './job-rows';
import { createJobRunner, type JobOutcome } from './job-runner';
import { jobMessage, WORKER_INSTRUCTIONS } from './job-text';
import { RESEED_FILE, workSelfTestScript } from './selftest-script';
import { fixtureFile, fixtureSignals } from './selftest-fixture';
import { createSignalWatch } from './signals';
import { linkSession, startFromWork } from './spin-up';
import {
  buildWorkState,
  createWorkStore,
  detailCaps,
  type WorkFile,
} from './store';
import { createSweepTimer } from './sweep-timer';
import { startWorkTools, WORK_TOOLS } from './work-tools';

type WorkMainApi = MainApi<
  typeof workManifest,
  WorkChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents>
>;

export { JOB_ROWS_FILE } from './job-rows';

const NEEDS_YOU_NOUN: AlertNoun = {
  singular: 'Slack item that needs you',
  plural: 'Slack items that need you',
};

const STILL_RUNNING = 'The job is still running';
const NO_TRANSCRIPT = 'No transcript for that job';

const SEED_DESCRIPTION =
  'Replaces the work store with the self-test fixture and seeds its signals.';

const openNeedsYou = (file: WorkFile) =>
  file.items.filter(
    (item) => item.section === 'needs_you' && item.state === 'open',
  ).length;

// A press main refused: the rejection the page toasts, its message the refusal text.
class PressRefused extends Error {}

// Keeps the user's work in `work.json` and publishes it as `work.state`, built against `work.columns`, and its detail
// records as `work.details`, one entry per record: neither slot holds anything until the store's load ends, then both
// are written again on each store change and each settings change, `work.details` setting only the entries that
// changed and deleting the ones the store dropped.
// It runs the worker jobs (05) and gives the worker its tools (06), watches the work signals (07) and writes detection's
// suggestions back to the store, and handles every `WorkChannel` method with 08's actions, logging each press's line
// and each refusal under `[work]`. It sweeps once chat's restore settles and every `work.intervalMinutes` after a
// sweep's end, wakes snoozed items, sets the Dock badge to the open Needs you items, and reopens the last job's row.
// Outside a live run it seeds the self-test fixture: the self-test's script and reseed file, and the drive action
// `work.seed`. A self-test run never starts the runner. Only the installed app's live run launches workers: a drive
// run and the dev app queue jobs, the head waiting as queued, and log each job they do not launch. `dispose` stops
// the watch and timers first, then waits for the runner, the job-row writes and the store.
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
    const details = api.state.publish(workDetailsSlot);
    const store = createWorkStore(api.data, log);
    const jobRows = createJobRows(api.data, log);
    const isSelfTest = services.runMode === 'selfTest';
    const launchesWorkers =
      services.runMode === 'live' && !services.appInstance.isDev;
    let isLoaded = false;
    let isStopped = false;
    let needsYou = 0;
    let snoozeTimer: number | null = null;
    let intervalMinutes = api.settings().intervalMinutes;

    const columns = () => readColumns(api.settings().columns);
    const caps = () => detailCaps(api.settings());

    // Sets each entry whose JSON changed, skipping one the store kept by reference, and deletes each the store dropped.
    const publishDetails = (file: WorkFile) => {
      for (const [id, detail] of Object.entries(file.details)) {
        const shown = details.get(id);
        if (shown !== detail && !isSameJson(shown, detail)) {
          details.set(id, detail);
        }
      }
      for (const id of [...details.all().keys()]) {
        if (!Object.hasOwn(file.details, id)) {
          details.delete(id);
        }
      }
    };

    const publish = () => {
      if (isStopped) {
        return;
      }
      const file = store.file();
      state.set(buildWorkState(file, columns(), store.problem()));
      publishDetails(file);
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
      launchesWorkers,
      profile: () => api.settings().profile,
      instructions: () => [WORKER_INSTRUCTIONS],
      message: (job) => {
        const { comments, replies } = caps();
        const settings = {
          ...api.settings(),
          columns: columns(),
          detailComments: comments,
          threadReplies: replies,
        };
        return jobMessage(job, settings, store.file());
      },
      ended: (job, outcome) => onJobEnded(job, outcome),
    });

    const tools = sessions.contributeTools(
      WORK_TOOLS,
      startWorkTools({
        jobOf: (session) => runner.jobOf(session),
        report: (session, result) => runner.report(session, result),
        store,
        columns,
        caps,
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

    // Queues `job` without waiting: a self-test's runner never starts, so its enqueue never resolves. An enqueue whose
    // step threw clears the press's mark with its error.
    const enqueue = (job: WorkJob) => {
      runner.enqueue(job).catch((error: unknown) => {
        log(`job not queued: ${errorText(error)}`);
        const end = { ok: false, note: `Not queued: ${errorText(error)}` };
        void store.update((file) =>
          jobEnded(file, job, end, clock.now(), caps()),
        );
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
          void store.update((current) => expireSnoozes(current, clock.now()));
        },
        Math.max(0, end - clock.now()),
      );
    };

    const onJobEnded = (job: WorkJob, outcome: JobOutcome) => {
      void store.update((file) =>
        withKeptLastRow(
          jobEnded(file, job, outcome, clock.now(), caps()),
          jobRows,
        ),
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
        details: Object.keys(file.details).length,
      };
      log(
        `fixture seeded: ${counts.items} items, ${counts.cards} cards, ${counts.suggestions} suggestions, ${counts.details} details`,
      );
      const wanted = { items: 7, cards: 7, suggestions: 3, details: 4 };
      const problems: string[] = [];
      for (const name of [
        'items',
        'cards',
        'suggestions',
        'details',
      ] as const) {
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
    channel.handle('comment', (arg) =>
      press('comment', (file) => comment(file, arg)),
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
