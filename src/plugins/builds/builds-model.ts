import type {
  BackendCapabilities,
  BuildJob,
  BuildOffer,
  BuildRecord,
  BuildRef,
  BuildsSnapshot,
  GameEntry,
  GameView,
  SessionBuilds,
  SetRunView,
} from './contract';

// How long a linked build or a set run's build that no list holds counts as still active: time for a queued build
// to show in its backend's list, after which a build that fell out of the newest listed ends.
export const UNLISTED_ACTIVE_MS = 10 * 60 * 1000;

// A session's link to a build it queued, kept in plugin data. `failingNotified` and `notified` are set once the
// failing and the ended message are told; `setRunId` names the set run the build belongs to, null for a lone build;
// `linkedAt` and `endedAt` are epoch ms, `endedAt` null until the build ends.
export interface SessionLink {
  sessionId: string;
  backendId: string;
  buildId: string;
  setRunId: string | null;
  linkedAt: number;
  failingNotified: boolean;
  notified: boolean;
  endedAt: number | null;
}

// One run of a set, kept in plugin data: the builds it queued on one revision. `sessionId` is the session that
// queued it, null for the user's own queue; `notified` is set once its end is told; times are epoch ms.
export interface SetRun {
  id: string;
  setId: string;
  label: string;
  backendId: string;
  gameId: string;
  sessionId: string | null;
  builds: BuildRef[];
  revision: string | null;
  createdAt: number;
  notified: boolean;
  endedAt: number | null;
}

// A tracked game's last listed builds, newest first, and the commit subjects read for their revisions.
export interface GameState {
  game: GameEntry;
  builds: BuildRecord[];
  subjects: Record<string, string>;
}

// A backend entry as the poller holds it: `capabilities` is null while it has no instance.
export interface BackendState {
  id: string;
  kind: string;
  label: string;
  problem: string | null;
  capabilities: BackendCapabilities | null;
  games: GameState[];
}

// Everything the fold reads; `now` is epoch ms, passed by the caller.
export interface BuildsModelInput {
  backends: BackendState[];
  links: SessionLink[];
  setRuns: SetRun[];
  offers: Record<string, BuildOffer>; // by session id
  polledAt: number | null;
  now: number;
}

// What the caller tells: a linked build that has a failed job while it still runs, a lone linked build that ended,
// and a set run whose every build ended. Each is reported until the caller sets its link's or set run's flag.
export type BuildsEvent =
  | {
      kind: 'failing';
      sessionId: string;
      ref: BuildRef;
      game: GameEntry;
      build: BuildRecord;
      failedJobs: BuildJob[];
    }
  | {
      kind: 'ended';
      sessionId: string;
      ref: BuildRef;
      game: GameEntry;
      build: BuildRecord;
    }
  | {
      kind: 'setEnded';
      setRun: SetRun;
      game: GameEntry;
      builds: BuildRecord[]; // the set's listed builds, in `setRun.builds` order
    };

// The published state, the events to tell in order (failing, then ended, then setEnded), and the backends that poll
// fast for a linked build still active, in input order.
export interface BuildsFold {
  snapshot: BuildsSnapshot;
  sessions: Record<string, SessionBuilds>;
  events: BuildsEvent[];
  activeBackends: string[];
}

interface ListedBuild {
  game: GameEntry;
  build: BuildRecord;
}

// Folds the backends' builds, the session links, the set runs and the offers into the published slots, the events
// to tell and the active backends. Pure: it reads no clock.
export function foldBuilds(input: BuildsModelInput): BuildsFold {
  const listed = indexListedBuilds(input.backends);
  return {
    snapshot: {
      backends: input.backends.map((backend) => ({
        id: backend.id,
        kind: backend.kind,
        label: backend.label,
        problem: backend.problem,
        capabilities: backend.capabilities,
        games: backend.games.map((state) =>
          gameView(backend.id, state, input.setRuns),
        ),
      })),
      polledAt: input.polledAt,
    },
    sessions: sessionBuilds(input.links, input.offers),
    events: [
      ...failingEvents(input.links, listed),
      ...endedEvents(input.links, listed),
      ...setEndedEvents(input.setRuns, input.backends, listed, input.now),
    ],
    activeBackends: activeBackends(
      input.backends,
      input.links,
      listed,
      input.now,
    ),
  };
}

// The label of `game`'s kind `kind`, or `kind` itself when the game declares no such kind.
export function kindLabel(game: GameEntry, kind: string): string {
  return Object.hasOwn(game.kinds, kind) ? game.kinds[kind].label : kind;
}

// The short form of a commit sha that build rows and messages show.
export function shortRevision(sha: string): string {
  return sha.slice(0, 8);
}

// Every listed build by backend id, then build id.
function indexListedBuilds(
  backends: BackendState[],
): Map<string, Map<string, ListedBuild>> {
  const listed = new Map<string, Map<string, ListedBuild>>();
  for (const backend of backends) {
    const byId = new Map<string, ListedBuild>();
    for (const state of backend.games) {
      for (const build of state.builds) {
        byId.set(build.id, { game: state.game, build });
      }
    }
    listed.set(backend.id, byId);
  }
  return listed;
}

function findListed(
  listed: Map<string, Map<string, ListedBuild>>,
  ref: BuildRef,
): ListedBuild | null {
  return listed.get(ref.backendId)?.get(ref.buildId) ?? null;
}

function gameView(
  backendId: string,
  state: GameState,
  setRuns: SetRun[],
): GameView {
  const views: SetRunView[] = setRuns
    .filter(
      (run) => run.backendId === backendId && run.gameId === state.game.id,
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((run) => ({
      id: run.id,
      setId: run.setId,
      label: run.label,
      builds: run.builds,
      revision: run.revision,
    }));
  return {
    backendId,
    game: state.game,
    builds: state.builds,
    subjects: state.subjects,
    setRuns: views,
  };
}

function sessionBuilds(
  links: SessionLink[],
  offers: Record<string, BuildOffer>,
): Record<string, SessionBuilds> {
  const sessionIds = new Set([
    ...links.map((link) => link.sessionId),
    ...Object.keys(offers),
  ]);
  const sessions: Record<string, SessionBuilds> = {};
  for (const sessionId of sessionIds) {
    const builds = links
      .filter((link) => link.sessionId === sessionId)
      .sort((a, b) => b.linkedAt - a.linkedAt)
      .map((link) => ({ backendId: link.backendId, buildId: link.buildId }));
    const offer = Object.hasOwn(offers, sessionId) ? offers[sessionId] : null;
    sessions[sessionId] = { builds, offer };
  }
  return sessions;
}

function isActive(build: BuildRecord): boolean {
  return build.state === 'queued' || build.state === 'running';
}

function failingEvents(
  links: SessionLink[],
  listed: Map<string, Map<string, ListedBuild>>,
): BuildsEvent[] {
  const events: BuildsEvent[] = [];
  for (const link of links) {
    const found = findListed(listed, link);
    if (link.failingNotified || !found || !isActive(found.build)) {
      continue;
    }
    const failedJobs = found.build.jobs.filter(
      (job) => job.result === 'failure',
    );
    if (failedJobs.length > 0) {
      events.push({
        kind: 'failing',
        sessionId: link.sessionId,
        ref: { backendId: link.backendId, buildId: link.buildId },
        game: found.game,
        build: found.build,
        failedJobs,
      });
    }
  }
  return events;
}

function endedEvents(
  links: SessionLink[],
  listed: Map<string, Map<string, ListedBuild>>,
): BuildsEvent[] {
  const events: BuildsEvent[] = [];
  for (const link of links) {
    const found = findListed(listed, link);
    const isLoneBuild = link.setRunId === null;
    const hasEnded = found?.build.state === 'finished';
    if (found && isLoneBuild && !link.notified && hasEnded) {
      events.push({
        kind: 'ended',
        sessionId: link.sessionId,
        ref: { backendId: link.backendId, buildId: link.buildId },
        game: found.game,
        build: found.build,
      });
    }
  }
  return events;
}

function setEndedEvents(
  setRuns: SetRun[],
  backends: BackendState[],
  listed: Map<string, Map<string, ListedBuild>>,
  now: number,
): BuildsEvent[] {
  const events: BuildsEvent[] = [];
  for (const setRun of setRuns) {
    const game = backends
      .find((backend) => backend.id === setRun.backendId)
      ?.games.find((state) => state.game.id === setRun.gameId)?.game;
    if (setRun.notified || setRun.builds.length === 0 || !game) {
      continue;
    }
    const isPastUnlistedWindow = now - setRun.createdAt >= UNLISTED_ACTIVE_MS;
    const found = setRun.builds.map((ref) => findListed(listed, ref));
    const everyBuildEnded = found.every((entry) =>
      entry ? entry.build.state === 'finished' : isPastUnlistedWindow,
    );
    if (everyBuildEnded) {
      events.push({
        kind: 'setEnded',
        setRun,
        game,
        builds: found
          .filter((entry) => entry !== null)
          .map((entry) => entry.build),
      });
    }
  }
  return events;
}

function activeBackends(
  backends: BackendState[],
  links: SessionLink[],
  listed: Map<string, Map<string, ListedBuild>>,
  now: number,
): string[] {
  const active = new Set<string>();
  for (const link of links) {
    if (link.notified) {
      continue;
    }
    const found = findListed(listed, link);
    const isRecentUnlisted = !found && now - link.linkedAt < UNLISTED_ACTIVE_MS;
    if ((found && isActive(found.build)) || isRecentUnlisted) {
      active.add(link.backendId);
    }
  }
  return backends.map((backend) => backend.id).filter((id) => active.has(id));
}
