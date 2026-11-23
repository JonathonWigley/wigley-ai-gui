import { kindLabel, shortRevision } from '../builds-model';
import type {
  BackendView,
  BuildRecord,
  BuildSetEntry,
  BuildsSnapshot,
  GameEntry,
  GameView,
  SessionBuilds,
} from '../contract';
import type {
  BuildDetailInput,
  BuildRowInput,
  DotStatus,
  EmptyInput,
  GameHeaderInput,
  SetGroupInput,
} from '../layouts/layout';

// A side-bar entry: `all`, or `<backendId>/<gameId>`.
export type BuildsEntryKey = 'all' | `${string}/${string}`;

// What the All feed shows: every build, those not finished, or those a session links.
export type FeedFilter = 'all' | 'running' | 'sessions';

const FEED_FILTERS: readonly string[] = [
  'all',
  'running',
  'sessions',
] satisfies FeedFilter[];

export function isFeedFilter(text: string): text is FeedFilter {
  return FEED_FILTERS.includes(text);
}

export type SideBarEntry =
  | { kind: 'all' }
  | { kind: 'backend'; backendId: string; label: string; problem: string | null }
  | { kind: 'game'; key: BuildsEntryKey; label: string; dot: DotStatus };

// One item of a game's list: a lone build, or a set run's builds under its group.
export type GameListItem =
  | { kind: 'build'; row: BuildRowInput }
  | { kind: 'set'; group: SetGroupInput; rows: BuildRowInput[] };

// A choice of the queue picker's first step: a kind of the game, or one of its sets.
export type QueueChoice =
  | { kind: 'kind'; id: string; label: string }
  | { kind: 'set'; id: string; label: string; set: BuildSetEntry };

export type CursorMove = 'down' | 'up' | 'top' | 'bottom';

// The key a build row and the views' lookups name a build by.
export function buildKey(backendId: string, buildId: string): string {
  return `${backendId}/${buildId}`;
}

// The side-bar key of `gameId` of backend `backendId`.
export function gameKey(backendId: string, gameId: string): BuildsEntryKey {
  return `${backendId}/${gameId}`;
}

// The dot for a game's newest build, the one with the largest `queuedAt`: idle with none or while it is queued.
export function gameDot(builds: readonly BuildRecord[]): DotStatus {
  const newest = newestBuild(builds);
  if (newest === null || newest.state === 'queued') {
    return 'idle';
  }
  if (newest.state === 'running') {
    return 'running';
  }
  switch (newest.result) {
    case 'success':
      return 'success';
    case 'failure':
      return 'error';
    case 'cancelled':
      return 'warning';
    case null:
      return 'idle';
  }
}

// The side bar's entries: All, then each backend's heading followed by its games.
export function sideBarEntries(snapshot: BuildsSnapshot): SideBarEntry[] {
  const entries: SideBarEntry[] = [{ kind: 'all' }];
  for (const backend of snapshot.backends) {
    entries.push({
      kind: 'backend',
      backendId: backend.id,
      label: backend.label,
      problem: backend.problem,
    });
    for (const view of backend.games) {
      entries.push({
        kind: 'game',
        key: gameKey(backend.id, view.game.id),
        label: view.game.label,
        dot: gameDot(view.builds),
      });
    }
  }
  return entries;
}

// One build's row as a game's list draws it. `queuedBy` is the linking session's label, null to fall back to the
// backend's `triggeredBy`; `now` is epoch ms.
export function buildRowInput(
  record: BuildRecord,
  view: GameView,
  queuedBy: string | null,
  now: number,
): BuildRowInput {
  const { revision } = record;
  return {
    key: buildKey(view.backendId, record.id),
    gameLabel: view.game.label,
    kindLabel: kindLabel(view.game, record.kind),
    number: record.number,
    version: record.version,
    branch: record.branch,
    shortRevision: revision === null ? null : shortRevision(revision),
    subject:
      revision !== null && Object.hasOwn(view.subjects, revision)
        ? view.subjects[revision]
        : null,
    state: record.state,
    result: record.result,
    percent: record.percent,
    leftMs: record.leftSeconds === null ? null : record.leftSeconds * 1000,
    startsInMs:
      record.startEstimate === null
        ? null
        : Math.max(0, record.startEstimate - now),
    queuedBy: queuedBy ?? record.triggeredBy,
    inFeed: false,
  };
}

// The open build's detail: its jobs' times in ms, its status text, links and backend page.
export function buildDetailInput(record: BuildRecord): BuildDetailInput {
  return {
    statusText: record.statusText,
    webUrl: record.webUrl,
    links: record.links.map((link) => ({ label: link.label, url: link.url })),
    jobs: record.jobs.map((job) => ({
      label: job.label,
      state: job.state,
      result: job.result,
      percent: job.percent,
      leftMs: job.leftSeconds === null ? null : job.leftSeconds * 1000,
      stepText: job.stepText,
    })),
  };
}

// The shown game's head: a button per kind, and per set, a set with an agent prompt also getting its with-agent
// button; no button while the backend has no instance.
export function gameHeaderInput(
  backend: BackendView,
  view: GameView,
): GameHeaderInput {
  const { game } = view;
  return {
    backendId: backend.id,
    gameId: game.id,
    label: game.label,
    backendLabel: backend.label,
    kinds: Object.entries(game.kinds).map(([id, kind]) => ({
      id,
      label: kind.label,
      withAgent: false,
    })),
    sets: game.sets.map((set) => ({
      id: set.id,
      label: set.label,
      withAgent: set.agentPrompt !== null,
    })),
    canQueue: backend.capabilities !== null,
  };
}

// A game's list, newest first: each set run's listed builds as one group at the place of its newest, the rest as
// lone rows. A set run with no listed build draws nothing.
export function gameRows(
  view: GameView,
  queuedByOf: (backendId: string, buildId: string) => string | null,
  now: number,
): GameListItem[] {
  const row = (record: BuildRecord) =>
    buildRowInput(
      record,
      view,
      queuedByOf(view.backendId, record.id),
      now,
    );
  const sorted = newestFirst(view.builds);
  const runOf = new Map<string, number>();
  view.setRuns.forEach((run, index) => {
    for (const ref of run.builds) {
      if (ref.backendId === view.backendId && !runOf.has(ref.buildId)) {
        runOf.set(ref.buildId, index);
      }
    }
  });
  const items: GameListItem[] = [];
  const placedRuns = new Set<number>();
  for (const record of sorted) {
    const runIndex = runOf.get(record.id);
    if (runIndex === undefined) {
      items.push({ kind: 'build', row: row(record) });
      continue;
    }
    if (placedRuns.has(runIndex)) {
      continue;
    }
    placedRuns.add(runIndex);
    const run = view.setRuns[runIndex];
    items.push({
      kind: 'set',
      group: {
        label: run.label,
        shortRevision:
          run.revision === null ? null : shortRevision(run.revision),
      },
      rows: sorted
        .filter((member) => runOf.get(member.id) === runIndex)
        .map(row),
    });
  }
  return items;
}

// The All feed: every game's builds, newest first, those `filter` keeps. `linked` holds the build keys a session
// links.
export function feedRows(
  snapshot: BuildsSnapshot,
  filter: FeedFilter,
  linked: ReadonlySet<string>,
  queuedByOf: (backendId: string, buildId: string) => string | null,
  now: number,
): BuildRowInput[] {
  const listed = snapshot.backends.flatMap((backend) =>
    backend.games.flatMap((view) =>
      view.builds.map((record) => ({ view, record })),
    ),
  );
  return listed
    .sort((a, b) => b.record.queuedAt - a.record.queuedAt)
    .filter(({ view, record }) => {
      switch (filter) {
        case 'all':
          return true;
        case 'running':
          return record.state !== 'finished';
        case 'sessions':
          return linked.has(buildKey(view.backendId, record.id));
      }
    })
    .map(({ view, record }) => ({
      ...buildRowInput(
        record,
        view,
        queuedByOf(view.backendId, record.id),
        now,
      ),
      inFeed: true,
    }));
}

// Each linked build's key, to the session that links it; a build two sessions link goes to the first.
export function linkedBuilds(
  sessions: ReadonlyMap<string, SessionBuilds>,
): Map<string, string> {
  const linked = new Map<string, string>();
  for (const [sessionId, builds] of sessions) {
    for (const ref of builds.builds) {
      const key = buildKey(ref.backendId, ref.buildId);
      if (!linked.has(key)) {
        linked.set(key, sessionId);
      }
    }
  }
  return linked;
}

// The game's queue choices: its kinds in key order, then its sets in order.
export function queueChoices(game: GameEntry): QueueChoice[] {
  return [
    ...Object.entries(game.kinds).map(
      ([id, kind]): QueueChoice => ({ kind: 'kind', id, label: kind.label }),
    ),
    ...game.sets.map(
      (set): QueueChoice => ({ kind: 'set', id: set.id, label: set.label, set }),
    ),
  ];
}

// Who queued the build `key` names: the label of the session row that links it, else `triggeredBy`.
export function queuedBy(
  key: string,
  triggeredBy: string | null,
  linked: ReadonlyMap<string, string>,
  sessionLabels: ReadonlyMap<string, string>,
): string | null {
  const sessionId = linked.get(key);
  const label =
    sessionId === undefined ? undefined : sessionLabels.get(sessionId);
  return label ?? triggeredBy;
}

// The key the cursor keeps after a redraw from `before` to `after`: `key` while it is still drawn, else the nearest
// survivor, the later rows of `before` first, then the earlier ones; else the first row; else null.
export function heldKey(
  before: readonly string[],
  after: readonly string[],
  key: string | null,
): string | null {
  if (key !== null && after.includes(key)) {
    return key;
  }
  const index = key === null ? -1 : before.indexOf(key);
  if (index >= 0) {
    const later = before.slice(index + 1).find((held) => after.includes(held));
    const earlier = before
      .slice(0, index)
      .reverse()
      .find((held) => after.includes(held));
    const survivor = later ?? earlier;
    if (survivor !== undefined) {
      return survivor;
    }
  }
  return after[0] ?? null;
}

// Why the list shows no build, null while it shows `shownRows` above 0. `entry` is the shown entry.
export function emptyReason(
  snapshot: BuildsSnapshot,
  entry: BuildsEntryKey,
  shownRows: number,
): EmptyInput['reason'] | null {
  if (shownRows > 0) {
    return null;
  }
  if (snapshot.backends.length === 0) {
    return 'noBackends';
  }
  const views = snapshot.backends.flatMap((backend) => backend.games);
  if (views.length === 0) {
    return 'noGames';
  }
  const shown =
    entry === 'all'
      ? views
      : views.filter((view) => gameKey(view.backendId, view.game.id) === entry);
  const hasBuilds = shown.some((view) => view.builds.length > 0);
  return hasBuilds ? 'noMatches' : 'noBuilds';
}

// The key after `move` from `key` over `keys`, held at both ends; a key not in `keys` moves from before the first.
// Null for no keys.
export function movedKey(
  keys: readonly string[],
  key: string | null,
  move: CursorMove,
): string | null {
  if (keys.length === 0) {
    return null;
  }
  const index = key === null ? -1 : keys.indexOf(key);
  switch (move) {
    case 'down':
      return keys[Math.min(index + 1, keys.length - 1)];
    case 'up':
      return keys[Math.max(index - 1, 0)];
    case 'top':
      return keys[0];
    case 'bottom':
      return keys[keys.length - 1];
  }
}

// The builds newest first by `queuedAt`; equal times keep their order.
function newestFirst(builds: readonly BuildRecord[]): BuildRecord[] {
  return [...builds].sort((a, b) => b.queuedAt - a.queuedAt);
}

function newestBuild(builds: readonly BuildRecord[]): BuildRecord | null {
  return newestFirst(builds)[0] ?? null;
}
