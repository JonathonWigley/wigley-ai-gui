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
  chatMainKey,
  chatSessionSlot,
} from '../../chat/contract';
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
  isRetroDone,
  RESTORE_WAIT_MS,
} from './retro-done';
import {
  EMPTY_QUEUE,
  nextQueue,
  opensWithRetroCommand,
  type QueueEvent,
  RETRO_COMMAND,
  type RetroItem,
  type RetroQueue,
} from './retro-queue';

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

// Queues a retro for each session the user closes, and each conversation a `/clear` ends, after it sent a message, in
// `queue.json` in the plugin data, launches one unattended `/wigley:retro auto <host ids>` row at a time in the
// `folder` setting, claims each retro row (launched, or restored with a retro command as its first message), and
// closes it `settleSeconds` after it reads done. Every event and launch result applies in one
// serial chain that starts once the queue is loaded. Writes the retro rows and the queued count to
// `auto-retro.state`. A `queue.json` it cannot read is never written during that start. In the self-test it registers its layouts and queues nothing.
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
    if (services.runMode === 'selfTest') {
      write({ rows: [], queued: 0 });
      return { commands: {} };
    }
    const chat = api.dependency(chatMainKey);
    const sessions = api.dependency(sessionsMainKey);
    const rowsSlot = api.state.read(sessionsRowsSlot);
    const sessionSlot = api.state.read(chatSessionSlot);
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
    // Each claimed row in its settle wait, to its timer.
    const settles = new Map<string, number>();

    const publish = () =>
      write({ rows: [...rows], queued: queue.queued.length });

    const clearSettle = (rowId: string) => {
      const timer = settles.get(rowId);
      if (timer !== undefined) {
        services.timers.clear(timer);
        settles.delete(rowId);
      }
    };

    const closeIfStillDone = (rowId: string) => {
      settles.delete(rowId);
      if (!isRetroDone(sessionSlot.get(rowId), startedRows.has(rowId))) {
        return;
      }
      log(`retro ${rowId} finished`);
      chat
        .close(rowId, 'finished')
        .catch((error: unknown) =>
          log(`retro ${rowId} not closed: ${errorText(error)}`),
        );
    };

    // Starts a claimed row's settle wait when it turns done, and drops that wait when it reads not done.
    const checkDone = (rowId: string, info: ChatSessionInfo | undefined) => {
      if (!rows.includes(rowId)) {
        return;
      }
      if (!isRetroDone(info, startedRows.has(rowId))) {
        clearSettle(rowId);
        return;
      }
      if (settles.has(rowId)) {
        return;
      }
      settles.set(
        rowId,
        services.timers.set(
          () => closeIfStillDone(rowId),
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

    // Claims a restored retro row as started, as its retro may have run before the restart.
    const claimRestored = (rowId: string) => {
      if (rows.includes(rowId)) {
        return;
      }
      rows.push(rowId);
      startedRows.add(rowId);
      publish();
      checkDone(rowId, sessionSlot.get(rowId));
    };

    const leaveRow = (rowId: string) => {
      startedRows.delete(rowId);
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

    // Takes `next` as the queue, moves the head to running when none runs, then saves, writes the slot and launches
    // the new run.
    const commit = async (next: RetroQueue) => {
      queue = nextQueue(next, { kind: 'launching' });
      const isNewRun = next.running === null && queue.running !== null;
      await save();
      publish();
      if (isNewRun && queue.running !== null) {
        launch(queue.running.item);
      }
    };

    const apply = (event: QueueEvent) => commit(nextQueue(queue, event));

    // `apply`, logging the item `event` queued.
    const applyLoggingQueued = (event: QueueEvent) => {
      const next = nextQueue(queue, event);
      const queuedItem =
        next.queued.length > queue.queued.length
          ? next.queued.at(-1)
          : undefined;
      if (queuedItem !== undefined) {
        log(
          `queued retro of ${hostIdsText(queuedItem)} (${next.queued.length} queued)`,
        );
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

    const launch = (item: RetroItem) => {
      chat
        .launch({
          projectDir: services.paths.expandTilde(
            api.settings().folder,
            services.homeDir,
          ),
          profile: item.profile,
          message: {
            text: `${RETRO_COMMAND} ${hostIdsText(item)}`,
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
      const before = queue.running;
      queue = nextQueue(queue, {
        kind: 'started',
        profiles: registeredProfiles(harnessSlot.all()).map(
          (profile) => profile.name,
        ),
      });
      if (before?.hostSessionId != null && queue.running === null) {
        log(
          `dropped retro ${before.hostSessionId}: profile ${before.item.profile} is gone`,
        );
      }
      // Claims a retro row present at start or restored before chat's restore ends — one `launched` holds, or one
      // the queue lost that opens with the retro command — as started. A row that joins later, a resumed or
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
          if (isLaunchedRow || opensWithRetroCommand(row.titles)) {
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
        if (row !== undefined && opensWithRetroCommand(row.titles)) {
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
    sessionSlot.on((sessionId, info) => {
      if (!rows.includes(sessionId)) {
        return;
      }
      if (info !== undefined && info.activity !== 'idle') {
        startedRows.add(sessionId);
      }
      checkDone(sessionId, info);
    });

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
        if (demo !== null) {
          demo = null;
          state.set(real);
        }
        await file.settled();
      },
    };
  },
};
