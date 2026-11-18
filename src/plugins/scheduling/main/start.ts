import type { AgentHarness } from '../../../contracts/agent';
import type { AlertNoun } from '../../../contracts/alerts';
import type { Disposable } from '../../../contracts/disposable';
import type { LoginStartStatus } from '../../../contracts/login-start';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import type { HostedRun, PendingSpawn } from '../../../contracts/session-host';
import { errorText } from '../../../shared/error-text';
import {
  CHAT_HARNESS_ID,
  type ChatMainEvents,
  chatControlsSlot,
  chatMainKey,
  chatSessionSlot,
  type LaunchRequest,
  type PreparedLaunch,
  type StartTarget,
} from '../../chat/contract';
import {
  followRows,
  sessionsMainKey,
  sessionsRowsSlot,
  sessionsSelectionSlot,
} from '../../sessions/contract';
import {
  type RunHistoryEntry,
  type ScheduledTask,
  type ScheduledTaskView,
  type SchedulingChannel,
  schedulingStateSlot,
  TASK_FILE_NAME,
  type TaskDraft,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { schedulingManifest } from '../manifest';
import { createHistoryStore, HISTORY_FILE } from './history-store';
import { type PlannedRun, planRuns } from './planner';
import {
  readRunRecord,
  runEntry,
  type ScheduledRunRecord,
} from './run-records';
import { schedulingSelfTestScript } from './selftest-script';
import { createTaskStore } from './task-store';
import { startTaskTools, TASK_TOOLS, type TaskToolsDeps } from './task-tools';

type SchedulingApi = MainApi<
  typeof schedulingManifest,
  SchedulingChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents>
>;

// How the part heard of a host run: read through `listRuns`, or pushed through `onRunStarted`.
type RunHeard = 'listed' | 'pushed';

// One plan's queue: the pending entries, the prepared launches by reuse key, each planned task's `at`, the times a
// prepare that threw before its run's time tries again, and the tasks whose due run failed to prepare.
interface PlannedQueue {
  entries: PendingSpawn[];
  prepared: Map<string, PreparedLaunch>;
  nextRuns: Map<string, number>;
  retryAts: number[];
  want: boolean;
  dueFailures: Set<string>;
}

const ALERT_NOUN: AlertNoun = {
  singular: 'finished scheduled run',
  plural: 'finished scheduled runs',
};
const RUNS_RETRY_MS = 10_000;
const NEVER_FIRES =
  'This app never fires scheduled tasks; Run now works in the installed app.';

function isRunRowOutcome(entry: RunHistoryEntry): boolean {
  return entry.outcome === 'running' || entry.outcome === 'finished';
}

function isSameRun(
  entry: RunHistoryEntry,
  record: ScheduledRunRecord,
): boolean {
  return (
    entry.taskId === record.taskId && entry.occurrence === record.occurrence
  );
}

// The reuse key of a planned run's `PreparedLaunch`: a task edit, a hand edit that keeps `updatedAt` included, or a
// new occurrence prepares again.
function preparedKey(run: PlannedRun, task: ScheduledTask): string {
  return `${run.taskId} ${run.occurrence} ${JSON.stringify(task)}`;
}

// Each entry's row id once, in the entries' order.
function uniqueRows(entries: readonly RunHistoryEntry[]): string[] {
  const rows: string[] = [];
  for (const entry of entries) {
    if (entry.rowId !== null && !rows.includes(entry.rowId)) {
      rows.push(entry.rowId);
    }
  }
  return rows;
}

// Holds the scheduled tasks and their history, plans each active task's next run, prepares it through chat and
// queues it in the session host, which starts it at its time; adopts each run the host started as a row, records
// it in history, and tracks the finished, unviewed run rows for the page and the Dock badge. Every event, push,
// timer and channel call that changes state runs as one step of a serial chain. Where the app does not fire (the dev
// app's live run) it shows and edits the tasks and never touches the host's queue or the login start. Hands the
// self-test its script.
export const schedulingMainPart: MainPart<typeof schedulingManifest> = {
  manifest: schedulingManifest,
  start(api: SchedulingApi) {
    const { services } = api;
    const { log, clock, timers, sessionHost } = services;
    const fires = !services.appInstance.isDev || services.runMode !== 'live';
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const rowsSlot = api.state.read(sessionsRowsSlot);
    const selectionSlot = api.state.read(sessionsSelectionSlot);
    const sessionSlot = api.state.read(chatSessionSlot);
    const controlsSlot = api.state.read(chatControlsSlot);
    const taskStore = createTaskStore({
      files: services.files,
      paths: services.paths,
      configFolder: services.paths.join(
        services.homeDir,
        '.config',
        'wigley-ai-gui',
      ),
      clock,
      randomHex: services.randomHex,
      log,
    });
    const history = createHistoryStore(api.data, log);

    api.layouts.register({ layoutTypes });
    const state = api.state.publish(schedulingStateSlot);

    // The part's start time when `history.json` failed to load, so no task catches up a time it cannot tell ran.
    let catchUpFloor: number | null = null;
    let isDisposing = false;
    // The host's runs were read since the start or since the last read that failed; no plan is sent until then.
    let hasReadRuns = false;
    let presses: string[] = [];
    let kept = new Map<string, PreparedLaunch>();
    let nextRuns = new Map<string, number>();
    let prepareTimers: number[] = [];
    let runsRetry: number | null = null;
    // A `readRunsThenPlan` step is in the chain and has not begun; one has begun and not ended; a re-plan asked for
    // after the read began, which one plan after it serves.
    let isReadQueued = false;
    let isReadGoing = false;
    let isPlanAfterRead = false;
    let lastWant: boolean | null = null;
    let loginStatus: LoginStartStatus | null = null;
    const handledRuns = new Set<string>();
    const subscriptions: Disposable[] = [];

    const taskName = (taskId: string): string =>
      taskStore.tasks().find((task) => task.id === taskId)?.name ?? taskId;

    const chatHarness = (): AgentHarness => {
      const harness = services.agentHarnesses.find(
        (candidate) => candidate.id === CHAT_HARNESS_ID,
      );
      if (!harness) {
        throw new Error(`no agent harness "${CHAT_HARNESS_ID}"`);
      }
      return harness;
    };

    const profileNames = (): string[] =>
      chat.profiles().map((profile) => profile.name);

    const views = (): ScheduledTaskView[] => {
      const entries = history.entries();
      return taskStore.tasks().map((task) => ({
        task,
        nextRun: nextRuns.get(task.id) ?? null,
        history: entries.filter((entry) => entry.taskId === task.id),
      }));
    };

    // The entries of open run rows, oldest first.
    const openRunEntries = (): RunHistoryEntry[] =>
      history
        .entries()
        .filter(
          (entry) =>
            isRunRowOutcome(entry) &&
            entry.rowId !== null &&
            rowsSlot.get(entry.rowId) !== undefined,
        )
        .sort((a, b) => a.at - b.at);

    const runRows = (): string[] => uniqueRows(openRunEntries());

    const publish = () => {
      const open = openRunEntries();
      const unviewedRows = uniqueRows(
        open.filter((entry) => entry.outcome === 'finished' && !entry.viewed),
      );
      state.set({
        tasks: views(),
        fileError: taskStore.error(),
        fires,
        loginStart: fires ? loginStatus : null,
        runRows: uniqueRows(open),
        unviewedRows,
      });
      services.alerts.setOpenCount(
        'scheduling',
        unviewedRows.length,
        ALERT_NOUN,
      );
    };

    // Runs `step` after every earlier step settled, then publishes, so each step reads the state the last one left.
    let chain: Promise<void> = Promise.resolve();
    const serial = (step: () => Promise<void> | void): Promise<void> => {
      chain = chain
        .then(async () => {
          if (isDisposing) {
            return;
          }
          await step();
          publish();
        })
        .catch((error: unknown) =>
          log(`scheduling step failed: ${errorText(error)}`),
        );
      return chain;
    };

    // Marks a running entry finished; viewed at once when its row is selected.
    const finish = (entry: RunHistoryEntry) => {
      if (entry.outcome !== 'running') {
        return;
      }
      history.update(entry.taskId, entry.occurrence, {
        outcome: 'finished',
        viewed: selectionSlot.get() === entry.rowId,
      });
    };

    const finishRowRun = (rowId: string) => {
      const entry = history
        .entries()
        .find((each) => each.rowId === rowId && each.outcome === 'running');
      if (entry !== undefined) {
        finish(entry);
      }
    };

    const markViewed = (rowId: string | null | undefined) => {
      if (rowId === null || rowId === undefined) {
        return;
      }
      for (const entry of history.entries()) {
        const isUnviewed =
          entry.rowId === rowId &&
          entry.outcome === 'finished' &&
          !entry.viewed;
        if (isUnviewed) {
          history.update(entry.taskId, entry.occurrence, { viewed: true });
        }
      }
    };

    // After chat's restore: a running entry whose row is gone, or whose session reads not running, is finished.
    const finishRestoredRuns = () => {
      for (const entry of history.entries()) {
        const isRowOpen =
          entry.rowId !== null && rowsSlot.get(entry.rowId) !== undefined;
        const isSessionRunning =
          entry.rowId !== null &&
          sessionSlot.get(entry.rowId)?.running === true;
        if (!isRowOpen || !isSessionRunning) {
          finish(entry);
        }
      }
    };

    // A relay row has no chat session to report its turn's end, and a run with an exit has no process. A listed run
    // started while no app heard it, so an attached row's idle read after the attach replay means its turn ended; a
    // pushed run's first turn has just begun. An unheld row reads not running while its process may still run.
    const isFinishedAtAdoption = (
      run: HostedRun,
      rowId: string,
      heard: RunHeard,
    ): boolean => {
      const info = sessionSlot.get(rowId);
      if (info === undefined || run.exit !== null) {
        return true;
      }
      return heard === 'listed' && info.running && info.activity === 'idle';
    };

    const launchRequest = (task: ScheduledTask): LaunchRequest => {
      const target: StartTarget =
        'projectDir' in task.target
          ? {
              projectDir: services.paths.expandTilde(
                task.target.projectDir,
                services.homeDir,
              ),
            }
          : task.target;
      return {
        ...target,
        profile: task.profile,
        message: { text: task.prompt, images: [] },
        headless: true,
        controls: task.controls,
      };
    };

    // Records a prepare that threw: a failed entry when the run is due, else a retry at the run's time.
    const prepareFailed = (
      task: ScheduledTask,
      run: PlannedRun,
      reason: string,
      now: number,
      queue: PlannedQueue,
    ) => {
      if (run.at > now) {
        queue.retryAts.push(run.at);
        return;
      }
      history.add({
        taskId: task.id,
        occurrence: run.occurrence,
        at: now,
        outcome: 'failed',
        reason,
        rowId: null,
        processId: null,
        viewed: true,
      });
      log(`run of ${task.name} failed to start: ${reason}`);
      queue.dueFailures.add(task.id);
    };

    // Plans every task and prepares each planned run, reusing a launch `prepares` or the last plan holds.
    const queueRuns = (
      tasks: readonly ScheduledTask[],
      runNow: readonly string[],
      now: number,
      prepares: Map<string, PreparedLaunch>,
    ): PlannedQueue => {
      const planned = planRuns({
        tasks,
        history: history.entries(),
        runNow,
        now,
        catchUpFloor,
      });
      const queue: PlannedQueue = {
        entries: [],
        prepared: new Map(),
        nextRuns: new Map(),
        retryAts: [],
        want: planned.length > 0,
        dueFailures: new Set(),
      };
      for (const run of planned) {
        // planRuns plans only from `tasks`, so every run's task is in it.
        const task = tasks.find((each) => each.id === run.taskId)!;
        queue.nextRuns.set(run.taskId, run.at);
        const key = preparedKey(run, task);
        let launch = prepares.get(key) ?? kept.get(key);
        if (launch === undefined) {
          try {
            launch = chat.prepareLaunch(
              launchRequest(task),
              sessions.offlineEnv(),
            );
          } catch (error) {
            prepareFailed(task, run, errorText(error), now, queue);
            continue;
          }
          prepares.set(key, launch);
        }
        queue.prepared.set(key, launch);
        const record: ScheduledRunRecord = {
          taskId: run.taskId,
          occurrence: run.occurrence,
          adopt: launch.adopt,
        };
        queue.entries.push({
          at: run.at,
          spawn: launch.spawn,
          record,
          skipWhileBusy: run.skipWhileBusy,
        });
      }
      return queue;
    };

    const clearPrepareTimers = () => {
      for (const handle of prepareTimers) {
        timers.clear(handle);
      }
      prepareTimers = [];
    };

    // Plans, prepares and sends the whole queue; sets the login start at the first plan and when `want` changes.
    const plan = async () => {
      if (!fires || !hasReadRuns || isDisposing) {
        return;
      }
      clearPrepareTimers();
      const tasks = taskStore.tasks();
      const now = clock.now();
      const prepares = new Map<string, PreparedLaunch>();
      let runNow = presses;
      presses = [];
      let queue = queueRuns(tasks, runNow, now, prepares);
      while (queue.dueFailures.size > 0) {
        const failed = queue.dueFailures;
        runNow = runNow.filter((id) => !failed.has(id));
        queue = queueRuns(tasks, runNow, now, prepares);
      }
      kept = queue.prepared;
      nextRuns = queue.nextRuns;
      for (const at of queue.retryAts) {
        prepareTimers.push(timers.set(() => serial(plan), at - now));
      }
      sessionHost.setPending(queue.entries);
      log(`queued ${queue.entries.length} runs`);
      if (queue.want !== lastWant) {
        lastWant = queue.want;
        loginStatus = await services.loginStart.set(queue.want);
      }
    };

    const forget = (run: HostedRun) => sessionHost.forgetRuns([run.id]);

    // The step for one host run: history first, then forget, so a quit between the two finds the run again.
    const handleRun = async (run: HostedRun, heard: RunHeard) => {
      if (handledRuns.has(run.id)) {
        forget(run);
        return;
      }
      const record = readRunRecord(run.record);
      if (record === null) {
        forget(run);
        log(`run ${run.id} is not a scheduled run; forgotten`);
        return;
      }
      handledRuns.add(run.id);
      try {
        await handleScheduledRun(run, record, heard);
      } catch (error) {
        handledRuns.delete(run.id);
        throw error;
      }
    };

    const handleScheduledRun = async (
      run: HostedRun,
      record: ScheduledRunRecord,
      heard: RunHeard,
    ) => {
      const name = taskName(record.taskId);
      const didNotStart = run.skipped || run.exit?.error != null;
      if (didNotStart) {
        const entry = runEntry(run, record, null);
        history.add(entry);
        forget(run);
        log(
          run.skipped
            ? `skipped run of ${name}: its previous run is still going`
            : `run of ${name} failed to start: ${entry.reason}`,
        );
        return;
      }
      let rowId: string;
      try {
        rowId = await chat.adopt(record.adopt);
      } catch (error) {
        const reason = errorText(error);
        log(`run of ${name} not opened: ${reason}`);
        if (isDisposing) {
          return;
        }
        history.add({
          taskId: record.taskId,
          occurrence: record.occurrence,
          at: run.startedAt,
          outcome: 'failed',
          reason: `not opened: ${reason}`,
          rowId: null,
          processId: null,
          viewed: true,
        });
        forget(run);
        return;
      }
      const hasEntry = history
        .entries()
        .some((entry) => isSameRun(entry, record));
      if (!hasEntry) {
        history.add(runEntry(run, record, rowId));
      }
      log(`adopted run of ${name} as ${rowId}`);
      if (isFinishedAtAdoption(run, rowId, heard)) {
        const entry = history.entries().find((each) => isSameRun(each, record));
        if (entry !== undefined) {
          finish(entry);
        }
      }
      // A replay that rejects leaves the calls file on disk, and nothing replays it again.
      const { hostSessionId } = record.adopt;
      try {
        const replayed = await sessions.replayCalls(hostSessionId);
        if (replayed > 0) {
          log(`replayed ${replayed} calls for ${rowId}`);
        }
      } catch (error) {
        log(
          `calls of host session ${hostSessionId} for ${rowId} not replayed: ${errorText(error)}`,
        );
      }
      forget(run);
    };

    // The step for one host run read through `listRuns`, then a re-plan. The self-test feeds its fixture runs here.
    const adoptRun = (run: HostedRun): Promise<void> =>
      serial(async () => {
        await handleRun(run, 'listed');
        await plan();
      });

    // Reads the host's runs inside a connect hold and handles each before the plan; retries a read that rejects.
    const readRunsThenPlan = async () => {
      isReadQueued = false;
      isReadGoing = true;
      try {
        await readRunsInHoldThenPlan();
      } finally {
        isReadGoing = false;
        if (isPlanAfterRead) {
          isPlanAfterRead = false;
          serial(plan);
        }
      }
    };

    // Queues a `readRunsThenPlan` unless one is already queued, which then serves this caller too.
    const queueReadRuns = () => {
      if (isReadQueued) {
        return;
      }
      isReadQueued = true;
      serial(readRunsThenPlan);
    };

    const readRunsInHoldThenPlan = async () => {
      if (runsRetry !== null) {
        timers.clear(runsRetry);
        runsRetry = null;
      }
      let release = () => undefined as void;
      sessions.holdConnects(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      try {
        let runs: HostedRun[];
        try {
          runs = await sessionHost.listRuns();
        } catch (error) {
          hasReadRuns = false;
          log(`runs not read: ${errorText(error)}`);
          runsRetry = timers.set(() => {
            runsRetry = null;
            queueReadRuns();
          }, RUNS_RETRY_MS);
          return;
        }
        for (const run of runs) {
          await handleRun(run, 'listed').catch((error: unknown) =>
            log(`run ${run.id} not handled: ${errorText(error)}`),
          );
        }
      } finally {
        release();
      }
      hasReadRuns = true;
      await plan();
    };

    const loadStores = async () => {
      try {
        await taskStore.load();
      } catch (error) {
        log(`${TASK_FILE_NAME} not loaded: ${errorText(error)}`);
      }
      try {
        await history.load();
      } catch (error) {
        log(`${HISTORY_FILE} not read: ${errorText(error)}`);
        catchUpFloor = clock.now();
      }
    };

    serial(loadStores);
    if (fires) {
      queueReadRuns();
    }

    const saveTask = async (draft: TaskDraft): Promise<string> => {
      if (!profileNames().includes(draft.profile)) {
        throw new Error(`No profile ${draft.profile}.`);
      }
      if ('project' in draft.target) {
        const { project: name } = draft.target;
        const project = chat.projects().find((each) => each.name === name);
        if (project === undefined) {
          throw new Error(`No project ${name}.`);
        }
        const hasOtherProfile =
          project.profile !== null && project.profile !== draft.profile;
        if (hasOtherProfile) {
          throw new Error(
            `Project ${name} runs under its own profile ${project.profile}.`,
          );
        }
      }
      return taskStore.save(draft);
    };

    api.channel.handle('saveTask', saveTask);
    api.channel.handle('setPaused', (id, paused) =>
      taskStore.setPaused(id, paused),
    );
    api.channel.handle('removeTask', (id) => taskStore.remove(id));
    api.channel.handle('runNow', (id) => {
      if (!fires) {
        throw new Error(NEVER_FIRES);
      }
      const task = taskStore.tasks().find((each) => each.id === id);
      if (task === undefined) {
        throw new Error(`No scheduled task ${id}.`);
      }
      if (task.paused) {
        throw new Error(`${task.name} is paused.`);
      }
      presses.push(id);
      serial(plan);
    });
    api.channel.handle('editorChoices', () => ({
      profiles: profileNames(),
      projects: chat.projects().map((project) => project.name),
      controls: chatHarness().startControls(),
    }));

    const toolDeps: TaskToolsDeps = {
      views,
      save: (draft) => taskStore.save(draft),
      remove: (id) => taskStore.remove(id),
      isRunRow: (sessionId) => runRows().includes(sessionId),
      profileOf: (sessionId) => chat.profileOf(sessionId),
      defaultProfile: (sessionId) => chat.defaultProfile(sessionId),
      profileNames,
      projects: () => chat.projects(),
      controlIds: () =>
        chatHarness()
          .startControls()
          .map((control) => control.id),
      sessionControls: (sessionId) =>
        Object.fromEntries(
          (controlsSlot.get(sessionId) ?? []).flatMap(
            (control): [string, string][] =>
              control.value === null ? [] : [[control.id, control.value]],
          ),
        ),
      capControls: (controls, cap) => chatHarness().capControls(controls, cap),
      isAbsolute: (path) => services.paths.isAbsolute(path),
      stat: (path) => services.files.stat(path),
      log,
    };
    sessions.contributeTools(TASK_TOOLS, startTaskTools(toolDeps), {
      mainAgentOnly: true,
    });

    // A re-plan that prepares a launch again reads the host's runs first, so an occurrence the host fired but the
    // part has not heard is in history and is not queued again under a new spawn id. Before the first read, the read
    // already queued plans after it. A re-plan joins a read still queued, and a read already going plans once more
    // after it, however many re-plans arrived meanwhile.
    const replanAfterRuns = () => {
      if (!hasReadRuns) {
        serial(plan);
      } else if (isReadGoing && !isReadQueued) {
        isPlanAfterRead = true;
      } else {
        queueReadRuns();
      }
    };
    taskStore.onChanged(replanAfterRuns);
    followRows(rowsSlot, {
      added: () => serial(() => undefined),
      removed: (rowId) => serial(() => finishRowRun(rowId)),
    });
    selectionSlot.on((rowId) => serial(() => markViewed(rowId)));
    api.events.on('chat.turnFinished', ({ sessionId }) =>
      serial(() => finishRowRun(sessionId)),
    );
    chat.restored().then(() => serial(finishRestoredRuns));
    if (fires) {
      subscriptions.push(
        chat.onInstructionsChanged(() => {
          kept = new Map();
          replanAfterRuns();
        }),
        sessionHost.onRunStarted((run) =>
          serial(async () => {
            await handleRun(run, 'pushed');
            await plan();
          }),
        ),
        sessionHost.onConnected(queueReadRuns),
      );
    }

    services.selfTest?.run(
      schedulingSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        now: () => clock.now(),
        chat,
        store: taskStore,
        adoptRun,
      }),
    );

    return {
      commands: {},
      async dispose(stop) {
        isDisposing = true;
        for (const subscription of subscriptions) {
          subscription.dispose();
        }
        await chain;
        if (stop === 'end' && fires) {
          sessionHost.setPending([]);
          await services.loginStart.set(false);
        }
        taskStore.dispose();
        await Promise.all([taskStore.settled(), history.settled()]);
      },
    };
  },
};
