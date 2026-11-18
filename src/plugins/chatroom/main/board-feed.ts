import type { Clock, Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { Git } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { errorText } from '../../../shared/error-text';
import { isSameJson } from '../../../shared/json';
import { createListeners } from '../../../shared/listeners';
import type { ChatSessionInfo } from '../../chat/contract';
import type { RowActivitySource } from '../../sessions/contract';
import type { PoolSnapshot } from '../../unity-pool/contract';
import type { SessionFlow } from '../../workflow/contract';
import type { BoardRow, Claim } from '../contract';
import {
  type BoardSession,
  buildBoard,
  type GitFolderState,
  readGitFolder,
  staleTouchPaths,
  type Touch,
  type TouchTracker,
} from './board';
import type { Roster } from './roster';

// The shortest time between two git reads of one clone.
export const GIT_READ_WINDOW_MS = 2_000;

// `chat` is chat's session slot, keyed by row id; `activities` sessions'
// activity slot, keyed by row id; `pools` unity-pool's snapshot.
export interface BoardFeedDeps {
  readonly roster: Pick<Roster, 'sessions' | 'roomOf' | 'participant'>;
  readonly tracker: TouchTracker;
  readonly git: Pick<
    Git,
    | 'topLevel'
    | 'currentBranch'
    | 'changedPaths'
    | 'hasUpstream'
    | 'unpushedPaths'
  >;
  readonly paths: Pick<
    Paths,
    'samePath' | 'segmentsBelow' | 'isInside' | 'join'
  >;
  readonly clock: Clock;
  readonly timers: Timers;
  chat(): ReadonlyMap<string, ChatSessionInfo>;
  flows(): readonly SessionFlow[];
  stageFinishes(flow: SessionFlow): boolean;
  activities(): ReadonlyMap<string, readonly RowActivitySource[]>;
  pools(): PoolSnapshot | null;
  claims(room: string): Promise<readonly Claim[]>;
  readonly log: PluginLog;
}

// The board's inputs for every room, gathered so `buildBoard` stays pure. A
// tracked row's root is its folder's `Git.topLevel`, read once. Each root's
// git state is read at most once per GIT_READ_WINDOW_MS, one read at a time.
export interface BoardFeed {
  // Reads the row's root, then refreshes its room; a tracked row is left.
  track(rowId: string, folder: string | null): void;
  untrack(rowId: string): void;
  // The room's rows from the last git reads and the claims of its last
  // refresh, over every roster session of every room.
  rows(room: string): BoardRow[];
  // Records the agent's write of each full path now, then refreshes the
  // row's room.
  noteTouched(rowId: string, agentId: string, paths: readonly string[]): void;
  // The newest touches, by rows other than `rowId`, of the changed files of
  // the last git read that are `paths` (or below them, with `under`).
  uncommittedByOthers(
    rowId: string,
    paths: readonly string[],
    under: boolean,
  ): readonly Touch[];
  // Reads the room's claims, and its roots' git state in the window rule;
  // resolves once each root had a read that started at or after the call.
  // Never rejects.
  refresh(room: string): Promise<void>;
  // Hears a room whose rows differ from the last rows built for it.
  onChanged(listener: (room: string) => void): Disposable;
  // Resolves once every queued read has settled.
  settled(): Promise<void>;
  // Clears the window timers, drops the queued reads and resolves every
  // pending `refresh`.
  stop(): void;
}

// The git reads of one root.
interface RootReads {
  lastStartAt: number | null;
  isReading: boolean;
  timer: number | null;
  // Resolved once the next read that starts settles.
  waiting: (() => void)[];
}

// The rows with an activity asking for the user: emphasis `urgent`.
function rowsWaitingOnUser(
  activities: ReadonlyMap<string, readonly RowActivitySource[]>,
): Set<string> {
  const waiting = new Set<string>();
  for (const [rowId, sources] of activities) {
    if (sources.some(({ activity }) => activity.emphasis === 'urgent')) {
      waiting.add(rowId);
    }
  }
  return waiting;
}

export function createBoardFeed(deps: BoardFeedDeps): BoardFeed {
  const { roster, tracker, git, paths, clock, timers, log } = deps;
  // Row id → its tracking, so a late `topLevel` of an untracked row is
  // dropped.
  const tracked = new Map<string, object>();
  // Row id → its root; absent while `topLevel` runs.
  const roots = new Map<string, string | null>();
  const gitStates = new Map<string, GitFolderState>();
  const reads = new Map<string, RootReads>();
  const claimsByRoom = new Map<string, readonly Claim[]>();
  const lastRows = new Map<string, BoardRow[]>();
  const changed = createListeners<string>();
  const inFlight = new Set<Promise<unknown>>();
  let isStopped = false;

  const keepUntilSettled = (work: Promise<unknown>) => {
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work));
  };

  const boardSessions = (): BoardSession[] => {
    const sessions: BoardSession[] = [];
    for (const session of roster.sessions()) {
      const room = roster.roomOf(session.rowId);
      if (room === null) {
        continue;
      }
      sessions.push({
        rowId: session.rowId,
        room,
        name: roster.participant(session.rowId, null).name,
        harness: session.harness,
        folder: session.folder,
        root: roots.get(session.rowId) ?? null,
        hostSessionId: session.hostSessionId,
        connected: true,
      });
    }
    return sessions;
  };

  const rows = (room: string): BoardRow[] =>
    buildBoard(
      {
        room,
        now: clock.now(),
        sessions: boardSessions(),
        chat: deps.chat(),
        flows: new Map(deps.flows().map((flow) => [flow.sessionId, flow])),
        stageFinishes: deps.stageFinishes,
        waitingOnUser: rowsWaitingOnUser(deps.activities()),
        pools: deps.pools(),
        git: gitStates,
        claims: claimsByRoom.get(room) ?? [],
        touches: tracker.touches(),
      },
      paths,
    );

  const announceIfChanged = (room: string) => {
    const built = rows(room);
    if (isSameJson(built, lastRows.get(room))) {
      return;
    }
    lastRows.set(room, built);
    changed.tell(room);
  };

  const roomsHoldingRoot = (root: string): Set<string> => {
    const rooms = new Set<string>();
    for (const session of roster.sessions()) {
      const room = roster.roomOf(session.rowId);
      if (room !== null && roots.get(session.rowId) === root) {
        rooms.add(room);
      }
    }
    return rooms;
  };

  const rootsOfRoom = (room: string): Set<string> => {
    const roomRoots = new Set<string>();
    for (const session of roster.sessions()) {
      const root = roots.get(session.rowId) ?? null;
      if (root !== null && roster.roomOf(session.rowId) === room) {
        roomRoots.add(root);
      }
    }
    return roomRoots;
  };

  const trackedRoots = (): Set<string> => {
    const found = new Set<string>();
    for (const root of roots.values()) {
      if (root !== null) {
        found.add(root);
      }
    }
    return found;
  };

  const afterRead = (state: GitFolderState) => {
    gitStates.set(state.root, state);
    tracker.forget(
      staleTouchPaths(tracker.touches(), state, trackedRoots(), paths),
    );
    for (const room of roomsHoldingRoot(state.root)) {
      announceIfChanged(room);
    }
  };

  const readsOf = (root: string): RootReads => {
    let rootReads = reads.get(root);
    if (rootReads === undefined) {
      rootReads = {
        lastStartAt: null,
        isReading: false,
        timer: null,
        waiting: [],
      };
      reads.set(root, rootReads);
    }
    return rootReads;
  };

  const startRead = (root: string, rootReads: RootReads) => {
    const waiters = rootReads.waiting;
    rootReads.waiting = [];
    const readAt = clock.now();
    rootReads.lastStartAt = readAt;
    rootReads.isReading = true;
    const read = readGitFolder(git, root, readAt)
      .then(
        (state) => {
          if (!isStopped) {
            afterRead(state);
          }
        },
        (error: unknown) =>
          log(`board git read failed for ${root}: ${errorText(error)}`),
      )
      .finally(() => {
        rootReads.isReading = false;
        for (const resolve of waiters) {
          resolve();
        }
        startWhenDue(root, rootReads);
      });
    keepUntilSettled(read);
  };

  // Starts the root's next read for its waiting refreshes, now or at the end
  // of the window, once no read runs.
  function startWhenDue(root: string, rootReads: RootReads): void {
    const isIdle = !rootReads.isReading && rootReads.timer === null;
    if (isStopped || !isIdle || rootReads.waiting.length === 0) {
      return;
    }
    const wait =
      rootReads.lastStartAt === null
        ? 0
        : rootReads.lastStartAt + GIT_READ_WINDOW_MS - clock.now();
    if (wait > 0) {
      rootReads.timer = timers.set(() => {
        rootReads.timer = null;
        startWhenDue(root, rootReads);
      }, wait);
      return;
    }
    startRead(root, rootReads);
  }

  const readRoot = (root: string): Promise<void> =>
    new Promise((resolve) => {
      const rootReads = readsOf(root);
      rootReads.waiting.push(resolve);
      startWhenDue(root, rootReads);
    });

  const readClaims = (room: string): Promise<void> => {
    const read = deps.claims(room).then(
      (claims) => {
        if (!isStopped) {
          claimsByRoom.set(room, claims);
          announceIfChanged(room);
        }
      },
      (error: unknown) =>
        log(`board claims read failed for ${room}: ${errorText(error)}`),
    );
    keepUntilSettled(read);
    return read;
  };

  const refresh = async (room: string): Promise<void> => {
    if (isStopped) {
      return;
    }
    await Promise.all([
      readClaims(room),
      ...[...rootsOfRoom(room)].map(readRoot),
    ]);
  };

  const refreshRoomOf = (rowId: string) => {
    const room = roster.roomOf(rowId);
    if (room !== null) {
      void refresh(room);
    }
  };

  // The deepest tracked root holding the full path, null when none does.
  const rootHolding = (path: string): string | null => {
    let found: string | null = null;
    for (const root of trackedRoots()) {
      const holds = paths.isInside(path, root);
      if (holds && (found === null || root.length > found.length)) {
        found = root;
      }
    }
    return found;
  };

  return {
    track(rowId, folder) {
      if (tracked.has(rowId)) {
        return;
      }
      const tracking = {};
      tracked.set(rowId, tracking);
      const lookUp =
        folder === null
          ? Promise.resolve(null)
          : git.topLevel(folder).catch((error: unknown) => {
              log(`board root not read for ${folder}: ${errorText(error)}`);
              return null;
            });
      const settledRoot = lookUp.then((root) => {
        if (isStopped || tracked.get(rowId) !== tracking) {
          return;
        }
        roots.set(rowId, root);
        refreshRoomOf(rowId);
      });
      keepUntilSettled(settledRoot);
    },
    untrack(rowId) {
      tracked.delete(rowId);
      roots.delete(rowId);
    },
    rows,
    noteTouched(rowId, agentId, touchedPaths) {
      const at = clock.now();
      for (const path of touchedPaths) {
        tracker.touched(rowId, agentId, path, at);
      }
      refreshRoomOf(rowId);
    },
    uncommittedByOthers(rowId, askedPaths, under) {
      const found: Touch[] = [];
      for (const path of askedPaths) {
        const root = rootHolding(path);
        const state = root === null ? undefined : gitStates.get(root);
        if (root === null || state === undefined) {
          continue;
        }
        for (const entry of state.changed) {
          const file = paths.join(root, entry);
          const counts = under
            ? paths.isInside(file, path)
            : paths.samePath(file, path);
          const touch = counts ? tracker.latest(file) : null;
          if (touch !== null && touch.rowId !== rowId) {
            found.push(touch);
          }
        }
      }
      return found;
    },
    refresh,
    onChanged: (listener) => changed.add(listener),
    async settled() {
      while (inFlight.size > 0) {
        await Promise.all(inFlight);
      }
    },
    stop() {
      isStopped = true;
      for (const rootReads of reads.values()) {
        if (rootReads.timer !== null) {
          timers.clear(rootReads.timer);
          rootReads.timer = null;
        }
        for (const resolve of rootReads.waiting) {
          resolve();
        }
        rootReads.waiting = [];
      }
    },
  };
}
