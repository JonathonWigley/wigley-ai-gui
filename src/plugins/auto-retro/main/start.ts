import type { ChatEntry } from '../../../contracts/agent';
import type { RetroContribution } from '../../../contracts/contributions';
import { coreAgentHarnessesSlot } from '../../../contracts/core-state';
import type {
  ChannelShape,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { registeredProfiles } from '../../../shared/harness-profiles';
import {
  type ChatMainEvents,
  type ChatSessionInfo,
  type HistoryLoad,
  chatEntriesSlot,
  chatMainKey,
  chatSessionSlot,
} from '../../chat/contract';
import {
  contributionsMainKey,
  pickProblemText,
  pickStrategy,
  type Strategy,
  type StrategyPick,
} from '../../contributions/contract';
import {
  followRows,
  sessionsMainKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import { type AutoRetroState, autoRetroStateSlot } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { autoRetroManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { createQueueFile } from './queue-file';
import {
  DEFAULT_SETTLE_SECONDS,
  RESTORE_WAIT_MS,
  type RetroRowState,
  retroRowState,
} from './retro-done';
import {
  commandPrefix,
  EMPTY_QUEUE,
  nextQueue,
  opensWithRetroCommand,
  type QueueEvent,
  type RetroItem,
  type RetroPolicy,
  type RetroQueue,
  retroCommandText,
} from './retro-queue';
import { retroReader } from './retro-reader';

type AutoRetroApi = MainApi<
  typeof autoRetroManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents>
>;

// The settle wait in ms: `settleSeconds` when it is a whole number of 0 or more, else the default.
function settleMs(settleSeconds: unknown): number {
  const isWholeSeconds =
    typeof settleSeconds === 'number' &&
    Number.isInteger(settleSeconds) &&
    settleSeconds >= 0;
  return (isWholeSeconds ? settleSeconds : DEFAULT_SETTLE_SECONDS) * 1000;
}

function hostIdsText(item: RetroItem): string {
  return item.hostIds.join(' ');
}

// An entry the agent wrote: a reply, its thinking or a tool call.
function isAgentEntry(entry: ChatEntry): boolean {
  return (
    entry.kind === 'assistant' ||
    entry.kind === 'thinking' ||
    entry.kind === 'tool'
  );
}

type RetroPick = StrategyPick<RetroContribution>;

// The endings a close or a clear is checked against to tell whether it would have queued a retro under some pick.
const EVERY_ENDING: RetroPolicy['on'] = ['close', 'clear'];

// Registers the `retro` reader with `contributions`, then queues a retro for each session the user closes, and each
// conversation a `/clear` ends, after it sent a message, when the picked retro strategy's `on` holds that ending, in
// `queue.json` in the plugin data. It launches one unattended row at a time, in the picked strategy's folder with its
// command, claims each retro row (launched, or restored with any installed strategy's command as its first message),
// and closes it `settleSeconds` after it reads done (`finished`) or lost, resting with no first turn run
// (`start-failed`). With no pick it queues nothing and logs why once per pick; a queued retro waits at the head until
// a pick returns. Every event, launch result and change of pick applies in one serial chain that starts once the queue
// is loaded and the strategies are read. Writes the retro rows and the queued count to `auto-retro.state`. A
// `queue.json` it cannot read is never written during that start. In the self-test it registers its layouts and
// reader and queues nothing.
// A demo session (`ephemeral` on chat's event) queues no retro. While the demo step is entered, the slot shows its
// row after the real rows and its queued count in place of the real one; the queue and `queue.json` never hold it.
export const autoRetroMainPart: MainPart<typeof autoRetroManifest> = {
  manifest: autoRetroManifest,
  start(api: AutoRetroApi) {
    const { services } = api;
    const { log } = services;
    api.layouts.register({ layoutTypes });
    const state = api.state.publish(autoRetroStateSlot);
    // The state the queue gives, last written, and the demo step's row and count shown over it.
    let real: AutoRetroState = { rows: [], queued: 0 };
    let demo: { rowId: string; queued: number } | null = null;
    // Set once the part is disposed, after which the demo step writes nothing.
    let isDisposed = false;
    const write = (next: AutoRetroState) => {
      real = next;
      state.set(
        demo === null
          ? next
          : { rows: [...next.rows, demo.rowId], queued: demo.queued },
      );
    };
    registerDemoSteps(services, {
      setDemo(next) {
        if (isDisposed) {
          return;
        }
        demo = next;
        write(real);
      },
    });
    const contributions = api.dependency(contributionsMainKey);
    const readerRegistration = contributions.registerFeature(
      'retro',
      retroReader,
    );
    if (services.runMode === 'selfTest') {
      write({ rows: [], queued: 0 });
      return {
        commands: {},
        dispose() {
          readerRegistration.dispose();
        },
      };
    }
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const rowsSlot = api.state.read(sessionsRowsSlot);
    const sessionSlot = api.state.read(chatSessionSlot);
    const entriesSlot = api.state.read(chatEntriesSlot);
    const harnessSlot = api.state.read(coreAgentHarnessesSlot);
    const file = createQueueFile(api.data);

    let queue: RetroQueue = EMPTY_QUEUE;
    let isFileWritable = true;
    // True until chat's restore of the saved rows ends: only a row present or restored by then is claimed.
    let isRestoring = true;
    // The slot's rows, in join order.
    const rows: string[] = [];
    // Row ids whose first turn began, kept until the row leaves the side bar.
    const startedRows = new Set<string>();
    // Row ids whose current host's process exited, kept until the row leaves the side bar.
    const endedRows = new Set<string>();
    // Restored row ids whose history was read once chat's restore ended, kept until the row leaves the side bar.
    const restoredRows = new Set<string>();
    // Restored row ids whose history is not yet read, from the claim until chat reads it, to the token of the claim's
    // `loadHistory` call, so a call from an earlier claim of the same id acts on nothing. Such a row reads busy, since
    // its entries cannot yet say whether its retro ran; one chat can never read stays here, left open.
    const pendingHistoryRows = new Map<string, object>();
    // Each claimed row in its settle wait, to its timer.
    const settles = new Map<string, number>();

    // The unbound pick the last `retro not queued` line named, as JSON; null until one is logged and after a pick
    // binds again.
    let loggedUnboundPick: string | null = null;

    const retroStrategies = () =>
      contributions.strategies<RetroContribution>('retro');
    const retroPick = (): RetroPick =>
      pickStrategy(retroStrategies(), api.settings().strategy);
    // Every installed strategy's prefix, not the pick's alone, so a row an earlier pick launched still reads as a
    // retro row.
    const installedPrefixes = () =>
      retroStrategies().map((strategy) =>
        commandPrefix(strategy.value.command),
      );
    const policyOf = (pick: RetroPick): RetroPolicy => ({
      prefixes: installedPrefixes(),
      on: pick.kind === 'picked' ? pick.strategy.value.on : [],
    });

    const logNotQueued = (pick: Exclude<RetroPick, { kind: 'picked' }>) => {
      const pickJson = JSON.stringify(pick);
      if (pickJson === loggedUnboundPick) {
        return;
      }
      loggedUnboundPick = pickJson;
      log(`retro not queued: ${pickProblemText(retroReader.label, pick)}`);
    };

    const publish = () =>
      write({ rows: [...rows], queued: queue.queued.length });

    const clearSettle = (rowId: string) => {
      const timer = settles.get(rowId);
      if (timer !== undefined) {
        services.timers.clear(timer);
        settles.delete(rowId);
      }
    };

    // The transcript a restored row reads holds the turns run while the app was closed.
    const hasStarted = (rowId: string) =>
      startedRows.has(rowId) ||
      (restoredRows.has(rowId) && entriesSlot.get(rowId).some(isAgentEntry));

    const rowState = (
      rowId: string,
      info: ChatSessionInfo | undefined,
    ): RetroRowState =>
      pendingHistoryRows.has(rowId)
        ? 'busy'
        : retroRowState(info, {
            hasStarted: hasStarted(rowId),
            hasEnded: endedRows.has(rowId),
            isRestored: restoredRows.has(rowId),
          });

    const closeIfStillSettled = (rowId: string) => {
      settles.delete(rowId);
      const settledState = rowState(rowId, sessionSlot.get(rowId));
      if (settledState === 'busy') {
        return;
      }
      const isDone = settledState === 'done';
      log(
        isDone
          ? `retro ${rowId} finished`
          : `retro ${rowId} ended before its first turn; closing it`,
      );
      chat
        .close(rowId, isDone ? 'finished' : 'start-failed')
        .catch((error: unknown) =>
          log(`retro ${rowId} not closed: ${errorText(error)}`),
        );
    };

    // Starts a claimed row's settle wait when it turns done or lost, and drops that wait when it reads busy.
    const checkDone = (rowId: string, info: ChatSessionInfo | undefined) => {
      if (!rows.includes(rowId)) {
        return;
      }
      if (rowState(rowId, info) === 'busy') {
        clearSettle(rowId);
        return;
      }
      if (settles.has(rowId)) {
        return;
      }
      settles.set(
        rowId,
        services.timers.set(
          () => closeIfStillSettled(rowId),
          settleMs(api.settings().settleSeconds),
        ),
      );
    };

    const markStarted = (rowId: string) => {
      if (startedRows.has(rowId)) {
        return;
      }
      startedRows.add(rowId);
      checkDone(rowId, sessionSlot.get(rowId));
    };

    const joinRow = (rowId: string) => {
      if (!rows.includes(rowId)) {
        rows.push(rowId);
      }
    };

    // Reads a claimed restored row again once its history is read: its entries now say whether its retro ran.
    const historyRead = (rowId: string) => {
      pendingHistoryRows.delete(rowId);
      if (!rows.includes(rowId)) {
        return;
      }
      restoredRows.add(rowId);
      checkDone(rowId, sessionSlot.get(rowId));
    };

    // A row whose history chat can never read stays busy and open, never closed under a guess; when it is the running
    // retro, the queue drops the run as a missed restore does, and the next queued item launches.
    const historyUnreadable = (rowId: string, reason: string) => {
      const host = rowsSlot.get(rowId)?.hostSessionId ?? null;
      const isRunningRow =
        host !== null && queue.running?.hostSessionId === host;
      if (!isRunningRow) {
        log(`retro ${rowId} left open: its history cannot be read (${reason})`);
        return;
      }
      log(
        `dropped retro ${host}: its history cannot be read (${reason}); row ${rowId} left open`,
      );
      return apply({ kind: 'restoreMissed' });
    };

    // What chat's wait for a pending row's history came to, unless the row left or was claimed again since the call.
    const historyLoaded = (rowId: string, token: object, load: HistoryLoad) => {
      if (pendingHistoryRows.get(rowId) !== token) {
        return;
      }
      switch (load.kind) {
        case 'read':
          historyRead(rowId);
          return;
        case 'unreadable':
          return historyUnreadable(rowId, load.reason);
        case 'gone':
          return;
      }
    };

    // Asks chat for a pending row's history, outside the serial chain so a slow read holds no other event. Chat
    // resolves once it has read the history, waiting through chat's restore, the row's attach, a harness wait and a
    // missing harness or profile; or once it never can (`historyUnreadable`); or once the row is gone. A rejected read
    // reads the entries as they are.
    const readHistory = (rowId: string) => {
      const token = {};
      pendingHistoryRows.set(rowId, token);
      chat.loadHistory(rowId).then(
        (load) => serial(() => historyLoaded(rowId, token, load)),
        (error: unknown) =>
          serial(() => {
            if (pendingHistoryRows.get(rowId) !== token) {
              return;
            }
            log(`retro ${rowId} history not read: ${errorText(error)}`);
            historyRead(rowId);
          }),
      );
    };

    // Claims a restored retro row and reads its history.
    const claimRestored = (rowId: string) => {
      if (rows.includes(rowId)) {
        return;
      }
      rows.push(rowId);
      readHistory(rowId);
      publish();
      checkDone(rowId, sessionSlot.get(rowId));
    };

    const leaveRow = (rowId: string) => {
      startedRows.delete(rowId);
      endedRows.delete(rowId);
      restoredRows.delete(rowId);
      pendingHistoryRows.delete(rowId);
      clearSettle(rowId);
      const index = rows.indexOf(rowId);
      if (index !== -1) {
        rows.splice(index, 1);
        publish();
      }
    };

    // Runs `step` after every earlier step settled, so each applies to the state the last one left.
    let chain: Promise<void> = Promise.resolve();
    const serial = (step: () => Promise<void> | void) => {
      chain = chain
        .then(() => (isDisposed ? undefined : step()))
        .catch((error: unknown) =>
          log(`retro step failed: ${errorText(error)}`),
        );
    };

    const save = async () => {
      if (!isFileWritable) {
        return;
      }
      try {
        await file.save(queue);
      } catch (error) {
        log(`queue.json not written: ${errorText(error)}`);
      }
    };

    // Takes `next` as the queue and, while a strategy is picked, moves the head to running when none runs; then saves,
    // writes the slot and launches the new run with the picked strategy. With no pick the head stays queued.
    const commit = async (next: RetroQueue) => {
      const pick = retroPick();
      const strategy = pick.kind === 'picked' ? pick.strategy : null;
      queue =
        strategy === null
          ? next
          : nextQueue(next, { kind: 'launching' }, policyOf(pick));
      const isNewRun = next.running === null && queue.running !== null;
      await save();
      publish();
      if (isNewRun && queue.running !== null && strategy !== null) {
        launch(queue.running.item, strategy);
      }
    };

    const apply = (event: QueueEvent) =>
      commit(nextQueue(queue, event, policyOf(retroPick())));

    // Whether `event` would queue a retro under a pick whose `on` holds every ending.
    const wouldQueueUnderAPick = (event: QueueEvent) =>
      nextQueue(queue, event, {
        prefixes: installedPrefixes(),
        on: EVERY_ENDING,
      }).queued.length > queue.queued.length;

    // `apply`, logging the item `event` queued, or why an ending that would queue one under a pick queued none.
    const applyLoggingQueued = (event: QueueEvent) => {
      const pick = retroPick();
      const next = nextQueue(queue, event, policyOf(pick));
      const queuedItem =
        next.queued.length > queue.queued.length
          ? next.queued.at(-1)
          : undefined;
      if (queuedItem !== undefined) {
        log(
          `queued retro of ${hostIdsText(queuedItem)} (${next.queued.length} queued)`,
        );
      } else if (pick.kind !== 'picked' && wouldQueueUnderAPick(event)) {
        logNotQueued(pick);
      }
      return commit(next);
    };

    const launched = async (item: RetroItem, rowId: string) => {
      const host = rowsSlot.get(rowId)?.hostSessionId ?? null;
      if (host === null) {
        log(`retro row ${rowId} gone at launch`);
        await apply({ kind: 'launchFailed' });
        return;
      }
      joinRow(rowId);
      await apply({ kind: 'launched', hostSessionId: host });
      if (item.title !== null) {
        sessions.setTitle(rowId, 'user', item.title);
      }
      log(`launched retro ${rowId} for ${hostIdsText(item)}`);
      checkDone(rowId, sessionSlot.get(rowId));
    };

    const launch = (item: RetroItem, strategy: Strategy<RetroContribution>) => {
      chat
        .launch({
          projectDir: services.paths.expandTilde(
            strategy.value.folder,
            services.homeDir,
          ),
          profile: item.profile,
          message: {
            text: retroCommandText(strategy.value.command, item.hostIds),
            images: [],
          },
          unattended: true,
        })
        .then(
          (rowId) => serial(() => launched(item, rowId)),
          (error: unknown) =>
            serial(() => {
              log(
                `retro launch failed for ${hostIdsText(item)}: ${errorText(error)}`,
              );
              return apply({ kind: 'launchFailed' });
            }),
        );
    };

    // A close of the running row logs the lost retro unless the row already read done: closed `finished`, or in
    // its settle wait when the close was emitted (`isSettling`).
    const closed = (
      event: ChatMainEvents['sessionClosed'],
      isSettling: boolean,
    ) => {
      const { running } = queue;
      const isRunningRow = running?.hostSessionId === event.hostSessionId;
      const isDone = event.reason === 'finished' || isSettling;
      if (running !== null && isRunningRow && !isDone) {
        log(
          `retro ${event.sessionId} closed before done; ${hostIdsText(running.item)} not analyzed`,
        );
      }
      return applyLoggingQueued({ kind: 'closed', ...event });
    };

    const watchRestore = (host: string) => {
      services.timers.set(
        () =>
          serial(() => {
            const isStillRunning = queue.running?.hostSessionId === host;
            const hasRow = [...rowsSlot.all().values()].some(
              (row) => row.hostSessionId === host,
            );
            if (!isStillRunning || hasRow) {
              return;
            }
            log(`dropped retro ${host}: its row did not come back`);
            return apply({ kind: 'restoreMissed' });
          }),
        RESTORE_WAIT_MS,
      );
    };

    const begin = async () => {
      await contributions.ready;
      const before = queue.running;
      queue = nextQueue(
        queue,
        {
          kind: 'started',
          profiles: registeredProfiles(harnessSlot.all()).map(
            (profile) => profile.name,
          ),
        },
        policyOf(retroPick()),
      );
      if (before?.hostSessionId != null && queue.running === null) {
        log(
          `dropped retro ${before.hostSessionId}: profile ${before.item.profile} is gone`,
        );
      }
      // Claims a retro row present at start or restored before chat's restore ends — one `launched` holds, or one
      // the queue lost that opens with an installed strategy's command. A row that joins later, a resumed or
      // hand-started retro included, is left alone; a launch claims its own row in `launched`. A row chat restores
      // joins before its titles are set, so its first message is read at its `sessionOpened` instead.
      followRows(rowsSlot, {
        added(row) {
          if (!isRestoring) {
            return;
          }
          const isLaunchedRow =
            row.hostSessionId !== null &&
            queue.launched.includes(row.hostSessionId);
          if (
            isLaunchedRow ||
            opensWithRetroCommand(row.titles, installedPrefixes())
          ) {
            claimRestored(row.sessionId);
          }
        },
        removed: leaveRow,
      });
      await commit(queue);
      const host = queue.running?.hostSessionId ?? null;
      if (host !== null) {
        watchRestore(host);
      }
    };

    // True, logged, for a demo session's event. Its row is gone before chat fires its close, so the event's
    // `ephemeral` tells it apart.
    const skipsDemoSession = (event: {
      sessionId: string;
      ephemeral?: true;
    }) => {
      if (event.ephemeral !== true) {
        return false;
      }
      log(`ignored demo session ${event.sessionId}`);
      return true;
    };

    // Read at the emit: before the step runs, chat deletes the row's `chat.session` entry right after the emit, and
    // `endClosed` ends a session that is not running at once, dropping its sessions row; either clears the wait.
    api.events.on('chat.sessionClosed', (event) => {
      if (skipsDemoSession(event)) {
        return;
      }
      const isSettling = settles.has(event.sessionId);
      serial(() => closed(event, isSettling));
    });
    // Chat's restore opens a row, sets its titles, then emits this, so a restored row's first message is known here
    // and not at its `added`. A resumed or launched row is left to its own path.
    api.events.on('chat.sessionOpened', ({ sessionId, origin }) => {
      if (origin !== 'restored') {
        return;
      }
      serial(() => {
        const row = rowsSlot.get(sessionId);
        const isRetroRow =
          row !== undefined &&
          opensWithRetroCommand(row.titles, installedPrefixes());
        if (isRetroRow) {
          claimRestored(sessionId);
        }
      });
    });
    api.events.on('chat.sessionCleared', (event) => {
      if (skipsDemoSession(event)) {
        return;
      }
      serial(() =>
        applyLoggingQueued({
          kind: 'cleared',
          oldHostSessionId: event.oldHostSessionId,
          newHostSessionId: event.newHostSessionId,
          profile: event.profile,
          titles: event.titles,
          sent: event.sent,
        }),
      );
    });
    api.events.on('chat.turnStarted', ({ sessionId }) =>
      serial(() => markStarted(sessionId)),
    );
    // Recorded at the emit, so an exit before `launched` joins the row is still known; an older host's exit after a
    // `/clear` is not the row's.
    api.events.on('chat.processEnded', (event) => {
      if (event.ephemeral === true) {
        return;
      }
      const isCurrentHost =
        rowsSlot.get(event.sessionId)?.hostSessionId === event.hostSessionId;
      if (isCurrentHost) {
        endedRows.add(event.sessionId);
      }
      serial(() =>
        checkDone(event.sessionId, sessionSlot.get(event.sessionId)),
      );
    });
    sessionSlot.on((sessionId, info) => {
      if (!rows.includes(sessionId)) {
        return;
      }
      if (info !== undefined && info.activity !== 'idle') {
        startedRows.add(sessionId);
      }
      checkDone(sessionId, info);
    });
    // A change of strategies or of a setting may change the pick; `commit` then launches a retro queued while none
    // was picked. A pick that binds again lets the next unbound pick log.
    const repick = () =>
      serial(() => {
        if (retroPick().kind === 'picked') {
          loggedUnboundPick = null;
        }
        return commit(queue);
      });
    const strategiesWatch = contributions.onChanged('retro', repick);
    api.onSettingsChanged(repick);

    chain = file.load().then(
      (loaded) => {
        queue = loaded;
      },
      (error: unknown) => {
        isFileWritable = false;
        log(`queue.json not read: ${errorText(error)}`);
      },
    );
    serial(begin);
    chat.restored().then(() =>
      serial(() => {
        isRestoring = false;
      }),
    );

    return {
      commands: {},
      async dispose() {
        await chain;
        isDisposed = true;
        strategiesWatch.dispose();
        readerRegistration.dispose();
        if (demo !== null) {
          demo = null;
          state.set(real);
        }
        await file.settled();
      },
    };
  },
};
