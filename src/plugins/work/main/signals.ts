import type { Clock, Timers } from '../../../contracts/ambient';
import type { Disposable } from '../../../contracts/disposable';
import type { Git, GitBranch } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import type {
  PullRequestInfo,
  PullRequests,
} from '../../../contracts/pull-requests';
import type { KeyedSlotReader, SlotReader } from '../../../contracts/state';
import { errorText } from '../../../shared/error-text';
import type { ChatMainExports, ChatSessionInfo } from '../../chat/contract';
import { editableTitle, type SessionRow } from '../../sessions/contract';
import type { PoolSnapshot } from '../../unity-pool/contract';
import {
  cardColumn,
  type WorkCard,
  type WorkColumnSetting,
  type WorkJiraCard,
  type WorkSignalSetting,
} from '../contract';
import {
  commitKeyPattern,
  type SeenSignal,
  signalColumn,
  signalKeys,
} from './detection';

export const BRANCH_CHANGE_DEBOUNCE_MS = 5000;
export const COMMIT_LOOKBACK_DAYS = 30;
export const GATHER_DEADLINE_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SignalDeps {
  git: Pick<
    Git,
    'topLevel' | 'originRepoName' | 'branches' | 'commitsMatching'
  >;
  pullRequests: PullRequests;
  chat: Pick<ChatMainExports, 'projects'>;
  chatSessions: KeyedSlotReader<ChatSessionInfo>; // api.state.read(chatSessionSlot)
  sessionRows: KeyedSlotReader<SessionRow>; // api.state.read(sessionsRowsSlot)
  pools: SlotReader<PoolSnapshot>; // api.state.read(unityPoolSnapshotSlot)
  repoFolders(): readonly string[]; // work.repoFolders, read at each gather
  cards(): readonly WorkCard[]; // store.file().cards, read at each gather
  signals(): Readonly<WorkSignalSetting>; // work.signals, read at each gather
  columns(): readonly WorkColumnSetting[]; // readColumns(work.columns), read at each gather
  homeDir: string;
  paths: Paths;
  clock: Clock;
  timers: Timers;
  log: PluginLog;
  onSeen(seen: readonly SeenSignal[]): void; // each finished gather, and each seed
}

// Gathers the work signals of the watched repos and the app's sessions, on `refresh` and once the sessions' branches
// and first messages have been quiet for `BRANCH_CHANGE_DEBOUNCE_MS`.
export interface SignalWatch {
  // Gathers now; a call while a gather runs runs one more after it.
  refresh(): void;
  // Reports `seen` as the signals with no I/O, and from then on gathers nothing.
  seed(seen: readonly SeenSignal[]): void;
  // The last finished gather's or seed's signals; null until one has finished.
  latest(): readonly SeenSignal[] | null;
  dispose(): void;
}

type WatchedRootDeps = Pick<
  SignalDeps,
  'git' | 'chat' | 'pools' | 'repoFolders' | 'homeDir' | 'paths' | 'log'
>;

// The folders whose clones are watched, in watched order: chat's folder projects and the clones of its pool
// projects, then `work.repoFolders`.
function watchedFolders(deps: WatchedRootDeps): string[] {
  const snapshot = deps.pools.get();
  const folders: string[] = [];
  for (const project of deps.chat.projects()) {
    if (project.kind === 'folder') {
      folders.push(deps.paths.expandTilde(project.folder, deps.homeDir));
      continue;
    }
    const pool = snapshot?.pools.find((state) => state.pool === project.pool);
    folders.push(...(pool?.clones.map((clone) => clone.path) ?? []));
  }
  for (const folder of deps.repoFolders()) {
    folders.push(deps.paths.expandTilde(folder, deps.homeDir));
  }
  return folders;
}

// The top folder of each watched folder's clone, in watched order, each once.
export async function watchedRoots(deps: WatchedRootDeps): Promise<string[]> {
  const folders = watchedFolders(deps);
  const tops = await Promise.all(
    folders.map((folder) =>
      deps.git.topLevel(folder).catch((error: unknown) => {
        deps.log(`signals: ${folder}: ${errorText(error)}`);
        return null;
      }),
    ),
  );
  const roots: string[] = [];
  for (const top of tops) {
    const isNew =
      top !== null && !roots.some((root) => deps.paths.samePath(root, top));
    if (isNew) {
      roots.push(top);
    }
  }
  return roots;
}

const isParsable = (signal: SeenSignal) => !Number.isNaN(Date.parse(signal.at));

// `call`'s result, or null once its rejection is logged under `root`.
async function loggedUnder<T>(
  root: string,
  log: PluginLog,
  call: () => Promise<T>,
): Promise<T | null> {
  try {
    return await call();
  } catch (error) {
    log(`signals: ${root}: ${errorText(error)}`);
    return null;
  }
}

// The branch name below its remote: `origin/x` → `x`.
function nameBelowRemote(branch: GitBranch): string {
  return branch.name.slice(branch.name.indexOf('/') + 1);
}

// One signal per branch naming a Jira card's key, a remote branch with a local twin left out.
async function branchSignals(
  root: string,
  jiraKeys: ReadonlySet<string>,
  deps: SignalDeps,
): Promise<SeenSignal[]> {
  const branches = await loggedUnder(root, deps.log, () =>
    deps.git.branches(root),
  );
  if (branches === null) {
    return [];
  }
  const repo = deps.paths.base(root);
  const localNames = new Set(
    branches.filter((branch) => !branch.isRemote).map((branch) => branch.name),
  );
  const signals: SeenSignal[] = [];
  for (const branch of branches) {
    const keys = signalKeys(branch.name);
    const namesCard = keys.some((key) => jiraKeys.has(key));
    const hasLocalTwin =
      branch.isRemote && localNames.has(nameBelowRemote(branch));
    if (!namesCard || hasLocalTwin) {
      continue;
    }
    signals.push({
      signal: 'branch',
      at: branch.at,
      reason: `Branch ${branch.name} in ${repo}`,
      keys,
      rowId: null,
      branch: branch.name,
      prState: null,
    });
  }
  return signals;
}

// A Jira card a commit could move, with the pattern its commits match.
interface CommitSearch {
  card: WorkJiraCard;
  pattern: string;
}

// The Jira cards a commit could still move, in card order: each with a key `commitKeyPattern` takes, in a column
// before the commit signal's, and with no move under way. None while the commit signal is off.
function commitSearches(
  cards: readonly WorkCard[],
  signals: Readonly<WorkSignalSetting>,
  columns: readonly WorkColumnSetting[],
): CommitSearch[] {
  const commitColumn = signalColumn('commit', signals, columns);
  if (commitColumn === null) {
    return [];
  }
  const indexOf = (name: string) =>
    columns.findIndex((column) => column.name === name);
  const commitIndex = indexOf(commitColumn);
  const searches: CommitSearch[] = [];
  for (const card of cards) {
    if (card.kind !== 'jira') {
      continue;
    }
    const pattern = commitKeyPattern(card.key);
    if (pattern === null) {
      continue;
    }
    const cardIndex = indexOf(cardColumn(card, columns));
    const isBeforeCommitColumn = cardIndex !== -1 && cardIndex < commitIndex;
    if (isBeforeCommitColumn && card.movingTo === null) {
      searches.push({ card, pattern });
    }
  }
  return searches;
}

// One signal per commit naming each card's key since the card's last move, the cards searched one after another.
async function commitSignals(
  root: string,
  searches: readonly CommitSearch[],
  lookbackStart: string,
  deps: SignalDeps,
): Promise<SeenSignal[]> {
  const repo = deps.paths.base(root);
  const signals: SeenSignal[] = [];
  for (const { card, pattern } of searches) {
    const since = card.movedAt ?? lookbackStart;
    const commits = await loggedUnder(root, deps.log, () =>
      deps.git.commitsMatching(root, pattern, since),
    );
    for (const commit of commits ?? []) {
      signals.push({
        signal: 'commit',
        at: commit.at,
        reason: `Commit ${commit.sha.slice(0, 7)} "${commit.subject}" in ${repo}`,
        keys: [card.key],
        rowId: null,
        branch: null,
        prState: null,
      });
    }
  }
  return signals;
}

// The first root of each origin repo name, in root order; a root with no origin, or whose lookup failed, in none.
async function originGroupRoots(
  roots: readonly string[],
  deps: SignalDeps,
): Promise<string[]> {
  const origins = await Promise.all(
    roots.map(async (root) => ({
      root,
      name: await loggedUnder(root, deps.log, () =>
        deps.git.originRepoName(root),
      ),
    })),
  );
  const firstRoots = new Map<string, string>();
  for (const { root, name } of origins) {
    if (name !== null && !firstRoots.has(name)) {
      firstRoots.set(name, root);
    }
  }
  return [...firstRoots.values()];
}

// The PR's signal: `pr_opened` for an open PR, `pr_merged` for a merged one, null for a closed one.
function pullRequestSignal(pr: PullRequestInfo): SeenSignal | null {
  if (pr.state === 'closed') {
    return null;
  }
  const isOpen = pr.state === 'open';
  return {
    signal: isOpen ? 'pr_opened' : 'pr_merged',
    at: pr.updatedAt,
    reason: `PR #${pr.number} ${isOpen ? 'open' : 'merged'}: ${pr.title}`,
    keys: signalKeys(`${pr.title} ${pr.headBranch}`),
    rowId: null,
    branch: pr.headBranch,
    prState: isOpen ? 'open' : null,
  };
}

// The repo's PR signals; [] when its PRs cannot be read.
async function pullRequestSignals(
  root: string,
  deps: SignalDeps,
): Promise<SeenSignal[]> {
  const prs = await loggedUnder(root, deps.log, () =>
    deps.pullRequests.forRepo(root),
  );
  const signals: SeenSignal[] = [];
  for (const pr of prs ?? []) {
    const signal = pullRequestSignal(pr);
    if (signal !== null) {
      signals.push(signal);
    }
  }
  return signals;
}

// One signal per unowned session, in `chat.session` key order, its `at` the first sighting `sightings` holds. Drops
// the sighting of each row chat no longer holds.
function sessionSignals(
  deps: SignalDeps,
  sightings: Map<string, string>,
): SeenSignal[] {
  const now = new Date(deps.clock.now()).toISOString();
  const sessions = deps.chatSessions.all();
  for (const rowId of sightings.keys()) {
    if (!sessions.has(rowId)) {
      sightings.delete(rowId);
    }
  }
  const signals: SeenSignal[] = [];
  for (const [rowId, info] of sessions) {
    const row = deps.sessionRows.get(rowId);
    if (row === undefined || row.owner !== null) {
      continue;
    }
    const at = sightings.get(rowId) ?? now;
    sightings.set(rowId, at);
    const title = editableTitle(row.titles);
    signals.push({
      signal: 'session',
      at,
      reason:
        info.branch === null
          ? `Session "${title}"`
          : `Session "${title}" on ${info.branch}`,
      keys: signalKeys(
        `${info.branch ?? ''}\n${row.titles.firstMessage ?? ''}`,
      ),
      rowId,
      branch: info.branch,
      prState: null,
    });
  }
  return signals;
}

// Every signal the watched repos and sessions give now, in a fixed order: per root its branches then its commits,
// then the PRs by origin group, then the sessions. A PR is kept when it names a Jira card's key or its head branch
// is a session's branch.
async function gatherSignals(
  deps: SignalDeps,
  sightings: Map<string, string>,
): Promise<SeenSignal[]> {
  const cards = deps.cards();
  const jiraKeys = new Set(
    cards.flatMap((card) =>
      card.kind === 'jira' ? [card.key.toUpperCase()] : [],
    ),
  );
  const searches = commitSearches(cards, deps.signals(), deps.columns());
  const lookbackStart = new Date(
    deps.clock.now() - COMMIT_LOOKBACK_DAYS * DAY_MS,
  ).toISOString();
  const sessions = sessionSignals(deps, sightings);
  const sessionBranches = new Set(
    sessions.flatMap((signal) =>
      signal.branch === null ? [] : [signal.branch],
    ),
  );
  const roots = await watchedRoots(deps);
  const rootWork = Promise.all(
    roots.map(async (root) => {
      const [branches, commits] = await Promise.all([
        branchSignals(root, jiraKeys, deps),
        commitSignals(root, searches, lookbackStart, deps),
      ]);
      return [...branches, ...commits];
    }),
  );
  const pullRequestWork = originGroupRoots(roots, deps).then((groupRoots) =>
    Promise.all(groupRoots.map((root) => pullRequestSignals(root, deps))),
  );
  const [perRoot, perGroup] = await Promise.all([rootWork, pullRequestWork]);
  const pullRequests = perGroup.flat().filter((signal) => {
    const namesCard = signal.keys.some((key) => jiraKeys.has(key));
    const isOnSessionBranch =
      signal.branch !== null && sessionBranches.has(signal.branch);
    return namesCard || isOnSessionBranch;
  });
  return [...perRoot.flat(), ...pullRequests, ...sessions].filter(isParsable);
}

// What a session row's change is judged by: a change of either re-gathers once the sessions are quiet.
interface SessionPair {
  branch: string | null;
  firstMessage: string | null;
}

// The pair of the unowned session `rowId`; undefined when chat holds no such session or the row has an owner.
function sessionPair(rowId: string, deps: SignalDeps): SessionPair | undefined {
  const info = deps.chatSessions.get(rowId);
  const row = deps.sessionRows.get(rowId);
  if (info === undefined || row === undefined || row.owner !== null) {
    return undefined;
  }
  return { branch: info.branch, firstMessage: row.titles.firstMessage };
}

// True when the session's move from `before` to `after` is one a gather should see: it left, it changed branch or
// first message, or it appeared holding either.
function isSessionChange(
  before: SessionPair | undefined,
  after: SessionPair | undefined,
): boolean {
  if (before === undefined) {
    return (
      after !== undefined &&
      (after.branch !== null || after.firstMessage !== null)
    );
  }
  if (after === undefined) {
    return true;
  }
  return (
    before.branch !== after.branch || before.firstMessage !== after.firstMessage
  );
}

export function createSignalWatch(deps: SignalDeps): SignalWatch {
  const sightings = new Map<string, string>();
  const pairs = new Map<string, SessionPair>();
  let latestSeen: readonly SeenSignal[] | null = null;
  let inFlight: { id: number; deadline: number } | null = null;
  let lastId = 0;
  let isAgainWanted = false;
  let debounce: number | null = null;
  let isHeld = false;
  let isDisposed = false;

  const mayGather = () => !isHeld && !isDisposed;

  const endGather = () => {
    inFlight = null;
    if (isAgainWanted) {
      isAgainWanted = false;
      startGather();
    }
  };

  const startGather = (): void => {
    if (!mayGather()) {
      return;
    }
    if (inFlight !== null) {
      isAgainWanted = true;
      return;
    }
    const id = ++lastId;
    const isCurrent = () => inFlight?.id === id && mayGather();
    const deadline = deps.timers.set(() => {
      if (isCurrent()) {
        deps.log('signals: gather passed 60 s, dropped');
        endGather();
      }
    }, GATHER_DEADLINE_MS);
    inFlight = { id, deadline };
    void gatherSignals(deps, sightings).then(
      (seen) => {
        if (!isCurrent()) {
          return;
        }
        deps.timers.clear(deadline);
        latestSeen = seen;
        deps.onSeen(seen);
        endGather();
      },
      (error: unknown) => {
        if (!isCurrent()) {
          return;
        }
        deps.timers.clear(deadline);
        deps.log(`signals: gather failed: ${errorText(error)}`);
        endGather();
      },
    );
  };

  const clearDebounce = () => {
    if (debounce !== null) {
      deps.timers.clear(debounce);
      debounce = null;
    }
  };

  const dropInFlight = () => {
    if (inFlight !== null) {
      deps.timers.clear(inFlight.deadline);
      inFlight = null;
    }
    isAgainWanted = false;
  };

  const armDebounce = () => {
    if (!mayGather()) {
      return;
    }
    clearDebounce();
    debounce = deps.timers.set(() => {
      debounce = null;
      startGather();
    }, BRANCH_CHANGE_DEBOUNCE_MS);
  };

  const onSessionEvent = (rowId: string) => {
    const before = pairs.get(rowId);
    const after = sessionPair(rowId, deps);
    if (after === undefined) {
      pairs.delete(rowId);
    } else {
      pairs.set(rowId, after);
    }
    if (isSessionChange(before, after)) {
      armDebounce();
    }
  };

  for (const rowId of deps.chatSessions.all().keys()) {
    const pair = sessionPair(rowId, deps);
    if (pair !== undefined) {
      pairs.set(rowId, pair);
    }
  }
  const listeners: Disposable[] = [
    deps.chatSessions.on(onSessionEvent),
    deps.sessionRows.on(onSessionEvent),
  ];

  return {
    refresh: startGather,
    seed(seen) {
      isHeld = true;
      clearDebounce();
      dropInFlight();
      latestSeen = seen;
      deps.onSeen(seen);
    },
    latest: () => latestSeen,
    dispose() {
      isDisposed = true;
      clearDebounce();
      dropInFlight();
      for (const listener of listeners) {
        listener.dispose();
      }
    },
  };
}
