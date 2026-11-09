import type { PluginLog } from '../../../contracts/log';
import type {
  ProcessResult,
  ProcessRunner,
} from '../../../contracts/processes';
import { errorText } from '../../../shared/error-text';
import type {
  PoolClaimRequest,
  PoolClaimResult,
  PoolProvider,
} from '../../chat/contract';
import type { PoolSnapshot, PoolState } from '../contract';
import { type ClaimAnswer, lastLine } from './pool-cli';

const FETCH_TIMEOUT_MS = 60_000;
const LIST_TIMEOUT_MS = 10_000;
const ORIGIN_PREFIX = 'origin/';
const DATED_REF = /^(\d+) (.+)$/;

// One origin branch as a clone's refs hold it; `committedAt` in Unix seconds.
export interface OriginBranch {
  name: string;
  committedAt: number;
}

// Reads `git for-each-ref --format='%(committerdate:unix) %(refname:short)' refs/remotes/origin`: each name loses
// its `origin/` once, and `origin/HEAD` and the bare `origin` (git's short name for it) are dropped. A blank line, or
// one with no date before its first space, is skipped.
export function parseOriginBranches(stdout: string): OriginBranch[] {
  const branches: OriginBranch[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = DATED_REF.exec(line.trim());
    if (match === null) {
      continue;
    }
    const ref = match[2];
    if (ref === 'origin' || ref === 'origin/HEAD') {
      continue;
    }
    branches.push({
      name: ref.startsWith(ORIGIN_PREFIX)
        ? ref.slice(ORIGIN_PREFIX.length)
        : ref,
      committedAt: Number(match[1]),
    });
  }
  return branches;
}

// Every clone's branches as one list of names: each name once at its newest date across the clones, newest first,
// ties by name, so the order does not hang on which clone answered first.
export function mergeOriginBranches(
  perClone: readonly (readonly OriginBranch[])[],
): string[] {
  const newest = new Map<string, number>();
  for (const branches of perClone) {
    for (const { name, committedAt } of branches) {
      newest.set(name, Math.max(newest.get(name) ?? committedAt, committedAt));
    }
  }
  return [...newest]
    .sort(([a, aAt], [b, bAt]) => bAt - aAt || a.localeCompare(b))
    .map(([name]) => name);
}

export interface PoolProviderDeps {
  processes: ProcessRunner;
  // The watch's current snapshot.
  snapshot(): PoolSnapshot;
  // The pool's state file read now.
  readPool(pool: string): Promise<PoolState | null>;
  runClaim(
    request: PoolClaimRequest,
    signal: AbortSignal,
  ): Promise<ClaimAnswer>;
  rescan(): void;
  log: PluginLog;
}

export interface UnityPoolProvider extends PoolProvider {
  // The watch's change callback.
  snapshotChanged(snapshot: PoolSnapshot): void;
  // Aborts every claim still running.
  dispose(): void;
}

// Chat's pool provider over unity-pool's state and CLI. `folders` reads the watch's snapshot; `branches` lists
// origin's refs in every clone with git, after one fetch in the lowest-numbered clone when asked to refresh, and
// never rejects; `claim` runs the CLI, calls `queued` once when a snapshot shows the claim's ticket, keeps a
// `diverged` clone the fresh state file shows held by the session, and reads every pool again once it settles.
export function createPoolProvider(deps: PoolProviderDeps): UnityPoolProvider {
  const { processes, log } = deps;
  const stopping = new AbortController();
  // Each pool's fetch in flight, which a second refresh joins: git refuses a second fetch on the ref lock.
  const fetches = new Map<string, Promise<void>>();
  const snapshotListeners = new Set<(snapshot: PoolSnapshot) => void>();

  const folders = (pool: string): readonly string[] =>
    deps
      .snapshot()
      .pools.find((state) => state.pool === pool)
      ?.clones.map((clone) => clone.path) ?? [];

  const fetchOnce = (pool: string, clone: string): Promise<void> => {
    const running = fetches.get(pool);
    if (running !== undefined) {
      return running;
    }
    const fetch = fetchOrigin(clone).finally(() => fetches.delete(pool));
    fetches.set(pool, fetch);
    return fetch;
  };

  const fetchOrigin = async (clone: string): Promise<void> => {
    try {
      const result = await processes.run(
        'git',
        ['-C', clone, 'fetch', '--no-recurse-submodules', 'origin'],
        { timeoutMs: FETCH_TIMEOUT_MS, signal: stopping.signal },
      );
      if (result.code !== 0 || result.timedOut) {
        log(`fetch in ${clone} failed: ${gitFailure(result)}`);
      }
    } catch (error) {
      log(`fetch in ${clone} failed: ${errorText(error)}`);
    }
  };

  // Null, logged, when the listing fails.
  const listBranches = async (
    clone: string,
  ): Promise<OriginBranch[] | null> => {
    try {
      const result = await processes.run(
        'git',
        [
          '-C',
          clone,
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(committerdate:unix) %(refname:short)',
          'refs/remotes/origin',
        ],
        { timeoutMs: LIST_TIMEOUT_MS, signal: stopping.signal },
      );
      if (result.code !== 0 || result.timedOut) {
        log(`branches of ${clone} not read: ${gitFailure(result)}`);
        return null;
      }
      return parseOriginBranches(result.stdout);
    } catch (error) {
      log(`branches of ${clone} not read: ${errorText(error)}`);
      return null;
    }
  };

  const branches = async (pool: string, refresh: boolean) => {
    const clones = folders(pool);
    if (clones.length === 0) {
      return [];
    }
    if (refresh) {
      await fetchOnce(pool, clones[0]);
    }
    const listed = await Promise.all(clones.map(listBranches));
    return mergeOriginBranches(
      listed.filter((list): list is OriginBranch[] => list !== null),
    );
  };

  // A `diverged` claim keeps its clone, which the CLI's answer does not name and the watch's snapshot may not show
  // yet.
  const divergedResult = async (
    request: PoolClaimRequest,
    message: string,
  ): Promise<PoolClaimResult> => {
    let state: PoolState | null = null;
    try {
      state = await deps.readPool(request.pool);
    } catch (error) {
      log(`state file of ${request.pool} not read: ${errorText(error)}`);
    }
    const held = state?.clones.find(
      (clone) => clone.claim?.session === request.hostSessionId,
    );
    return held === undefined
      ? { ok: false, error: 'diverged', message }
      : { ok: true, path: held.path, note: message };
  };

  const resultOf = (
    request: PoolClaimRequest,
    answer: ClaimAnswer,
  ): PoolClaimResult | Promise<PoolClaimResult> => {
    if (answer.ok) {
      return { ok: true, path: answer.path, note: null };
    }
    return answer.error === 'diverged'
      ? divergedResult(request, answer.message)
      : answer;
  };

  const claim = async (
    request: PoolClaimRequest,
    signal: AbortSignal,
    queued: () => void,
  ): Promise<PoolClaimResult> => {
    const listener = (snapshot: PoolSnapshot) => {
      if (holdsTicket(snapshot, request)) {
        snapshotListeners.delete(listener);
        queued();
      }
    };
    snapshotListeners.add(listener);
    let answer: ClaimAnswer;
    try {
      answer = await deps.runClaim(
        request,
        AbortSignal.any([signal, stopping.signal]),
      );
    } finally {
      snapshotListeners.delete(listener);
    }
    const result = await resultOf(request, answer);
    log(
      `claim ${request.pool} ${request.branch}: ${result.ok ? `ok ${result.path}` : `${result.error}: ${result.message}`}`,
    );
    deps.rescan();
    return result;
  };

  return {
    folders,
    branches,
    claim,
    snapshotChanged(snapshot) {
      for (const listener of snapshotListeners) {
        listener(snapshot);
      }
    },
    dispose() {
      stopping.abort();
    },
  };
}

// True when the snapshot holds a queue ticket in the claim's pool for its host session.
function holdsTicket(
  snapshot: PoolSnapshot,
  request: PoolClaimRequest,
): boolean {
  return (
    snapshot.pools
      .find((state) => state.pool === request.pool)
      ?.queue.some((ticket) => ticket.session === request.hostSessionId) ??
    false
  );
}

function gitFailure(result: ProcessResult): string {
  if (result.timedOut) {
    return 'git timed out';
  }
  return lastLine(result.stderr) ?? `git exited ${result.code}`;
}
