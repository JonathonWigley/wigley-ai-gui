import type { Git } from '../../../contracts/git';
import type { Paths } from '../../../contracts/paths';
import { compareText } from '../../../shared/key-hints';
import type { ChatAgentEvent, ChatSessionInfo } from '../../chat/contract';
import type { PoolClone, PoolSnapshot } from '../../unity-pool/contract';
import { isBusy, type SessionFlow } from '../../workflow/contract';
import type {
  BoardClone,
  BoardFile,
  BoardRow,
  BoardState,
  Claim,
} from '../contract';

// A session the board may list: an app-run row, or a connected terminal or
// Codex session. `root` is the top folder of the clone holding `folder`, as
// `Git.topLevel` returns it; `hostSessionId` the Claude Code session id.
export interface BoardSession {
  readonly rowId: string;
  readonly room: string;
  readonly name: string;
  readonly harness: string | null;
  readonly folder: string | null;
  readonly root: string | null;
  readonly hostSessionId: string | null;
  readonly connected: boolean;
}

// One git read of a clone. `changed` and `unpushed` are `/`-separated below
// `root`; `unpushed` is null with no upstream. `readAt` is the clock read
// before the git calls ran.
export interface GitFolderState {
  readonly root: string;
  readonly branch: string | null;
  readonly changed: readonly string[];
  readonly unpushed: readonly string[] | null;
  readonly readAt: number;
}

// The newest write of a file by a session's agent; `path` is a full path.
export interface Touch {
  readonly path: string;
  readonly rowId: string;
  readonly agentId: string;
  readonly at: number;
}

// Everything a board reads, gathered by the caller. `sessions` holds the live
// sessions of every room; `chat` and `flows` are keyed by row id, `git` by
// `GitFolderState.root`. `stageFinishes` is true for a flow whose stage
// finishes its workflow's run; `waitingOnUser` holds the rows with an open
// question to the user.
export interface BoardInputs {
  readonly room: string;
  readonly now: number;
  readonly sessions: readonly BoardSession[];
  readonly chat: ReadonlyMap<string, ChatSessionInfo>;
  readonly flows: ReadonlyMap<string, SessionFlow>;
  stageFinishes(flow: SessionFlow): boolean;
  readonly waitingOnUser: ReadonlySet<string>;
  readonly pools: PoolSnapshot | null;
  readonly git: ReadonlyMap<string, GitFolderState>;
  readonly claims: readonly Claim[];
  readonly touches: readonly Touch[];
}

type BoardPaths = Pick<Paths, 'samePath' | 'segmentsBelow'>;

const MAX_LISTED_PATHS = 200;
const ENDED_SESSION_NAME = 'an ended session';

// The room's rows, one per session of `inputs.room`, in input order.
export function buildBoard(inputs: BoardInputs, paths: BoardPaths): BoardRow[] {
  const namesByRowId = new Map(
    inputs.sessions.map((session) => [session.rowId, session.name]),
  );
  return inputs.sessions
    .filter((session) => session.room === inputs.room)
    .map((session) => buildRow(session, inputs, namesByRowId, paths));
}

function buildRow(
  session: BoardSession,
  inputs: BoardInputs,
  namesByRowId: ReadonlyMap<string, string>,
  paths: BoardPaths,
): BoardRow {
  const chat = inputs.chat.get(session.rowId);
  const git = session.root === null ? undefined : inputs.git.get(session.root);
  const changed = git === undefined ? null : firstListed(git.changed);
  const unpushed =
    git === undefined || git.unpushed === null
      ? null
      : firstListed(git.unpushed);
  return {
    rowId: session.rowId,
    name: session.name,
    harness: session.harness,
    state: boardState(session, chat, inputs),
    folder: session.folder,
    branch: git?.branch ?? chat?.branch ?? null,
    clone: boardClone(session, inputs.pools, paths),
    uncommitted:
      changed === null || session.root === null
        ? []
        : attributedFiles(
            changed.listed,
            session.root,
            inputs.touches,
            namesByRowId,
            paths,
          ),
    uncommittedMore: changed?.more ?? 0,
    unpushedPaths: unpushed?.listed ?? null,
    unpushedMore: unpushed?.more ?? 0,
    claims: inputs.claims.filter(
      (claim) =>
        claim.room === inputs.room &&
        claim.holder.rowId === session.rowId &&
        claim.expiresAt > inputs.now,
    ),
  };
}

function boardState(
  session: BoardSession,
  chat: ChatSessionInfo | undefined,
  inputs: BoardInputs,
): BoardState {
  if (chat === undefined) {
    return session.connected ? 'connected' : 'gone';
  }
  if (inputs.waitingOnUser.has(session.rowId) || chat.activity === 'waiting') {
    return 'waiting';
  }
  const flow = inputs.flows.get(session.rowId);
  const flowBusy = flow !== undefined && isBusy(flow);
  if (chat.activity === 'working' || chat.background > 0 || flowBusy) {
    return 'working';
  }
  if (flow !== undefined && inputs.stageFinishes(flow)) {
    return 'done';
  }
  return 'idle';
}

function boardClone(
  session: BoardSession,
  pools: PoolSnapshot | null,
  paths: BoardPaths,
): BoardClone | null {
  const root = session.root;
  if (root === null || pools === null) {
    return null;
  }
  for (const pool of pools.pools) {
    const clone = pool.clones.find((candidate) =>
      paths.samePath(candidate.path, root),
    );
    if (clone !== undefined) {
      return {
        pool: pool.pool,
        number: clone.number,
        holder: cloneHolder(clone, session),
      };
    }
  }
  return null;
}

// A claim with `row` null is a terminal session's, matched by its Claude Code
// session id.
function cloneHolder(
  clone: PoolClone,
  session: BoardSession,
): BoardClone['holder'] {
  const claim = clone.claim;
  if (claim === null) {
    return 'none';
  }
  if (claim.kind === 'hold') {
    return 'user';
  }
  const claimedByThisRow = claim.row === session.rowId;
  const claimedByThisHostSession =
    claim.session !== null && claim.session === session.hostSessionId;
  return claimedByThisRow || claimedByThisHostSession ? 'this' : 'other';
}

function firstListed(paths: readonly string[]): {
  listed: string[];
  more: number;
} {
  const sorted = [...paths].sort(compareText);
  return {
    listed: sorted.slice(0, MAX_LISTED_PATHS),
    more: Math.max(0, sorted.length - MAX_LISTED_PATHS),
  };
}

function attributedFiles(
  changed: readonly string[],
  root: string,
  touches: readonly Touch[],
  namesByRowId: ReadonlyMap<string, string>,
  paths: BoardPaths,
): BoardFile[] {
  const newestTouches = newestTouchesBelow(root, touches, paths);
  return changed.map((path) => {
    const touch = newestTouches.get(path);
    if (touch === undefined) {
      return { path, byRowId: null, by: null };
    }
    return {
      path,
      byRowId: touch.rowId,
      by: namesByRowId.get(touch.rowId) ?? ENDED_SESSION_NAME,
    };
  });
}

// The newest touch of each file below `root`, keyed by its `/`-separated path
// below it; of two touches with one `at`, the later item wins.
function newestTouchesBelow(
  root: string,
  touches: readonly Touch[],
  paths: BoardPaths,
): Map<string, Touch> {
  const newest = new Map<string, Touch>();
  for (const touch of touches) {
    const segments = paths.segmentsBelow(touch.path, root);
    if (segments === null) {
      continue;
    }
    const path = segments.join('/');
    const kept = newest.get(path);
    if (kept === undefined || touch.at >= kept.at) {
      newest.set(path, touch);
    }
  }
  return newest;
}

// One git read of the clone at `root`; `unpushedPaths` runs only when the
// clone has an upstream. A git failure rejects.
export async function readGitFolder(
  git: Pick<
    Git,
    'currentBranch' | 'changedPaths' | 'hasUpstream' | 'unpushedPaths'
  >,
  root: string,
  readAt: number,
): Promise<GitFolderState> {
  const [branch, changed, upstream] = await Promise.all([
    git.currentBranch(root),
    git.changedPaths(root, '.'),
    git.hasUpstream(root),
  ]);
  const unpushed = upstream ? await git.unpushedPaths(root, '.') : null;
  return { root, branch, changed, unpushed, readAt };
}

// The newest touch of each file for the app run, in memory. Paths compare
// with `samePath`; a relative path is dropped.
export interface TouchTracker {
  // Keeps the touch unless the file's kept touch is newer; an equal `at`
  // replaces it.
  touched(rowId: string, agentId: string, path: string, at: number): void;
  // Records a `fileWritten` event, a replayed one included; ignores the rest.
  fromAgentEvent(event: ChatAgentEvent): void;
  // Ordered by `at`, then by the call that stored them.
  touches(): Touch[];
  latest(path: string): Touch | null;
  forget(paths: readonly string[]): void;
}

export function createTouchTracker(
  paths: Pick<Paths, 'isAbsolute' | 'normalize' | 'samePath'>,
): TouchTracker {
  // In the order of the calls that stored them.
  let stored: Touch[] = [];
  const indexOf = (path: string): number =>
    stored.findIndex((touch) => paths.samePath(touch.path, path));
  const touched = (
    rowId: string,
    agentId: string,
    path: string,
    at: number,
  ): void => {
    if (!paths.isAbsolute(path)) {
      return;
    }
    const index = indexOf(path);
    if (index !== -1) {
      if (stored[index].at > at) {
        return;
      }
      stored.splice(index, 1);
    }
    stored.push({ path: paths.normalize(path), rowId, agentId, at });
  };
  return {
    touched,
    fromAgentEvent(event) {
      if (event.event.type !== 'fileWritten') {
        return;
      }
      touched(
        event.sessionId,
        event.event.agentId,
        event.event.path,
        event.event.at,
      );
    },
    touches() {
      return [...stored].sort((a, b) => a.at - b.at);
    },
    latest(path) {
      const index = indexOf(path);
      return index === -1 ? null : stored[index];
    },
    forget(forgotten) {
      stored = stored.filter(
        (touch) => !forgotten.some((path) => paths.samePath(path, touch.path)),
      );
    },
  };
}
