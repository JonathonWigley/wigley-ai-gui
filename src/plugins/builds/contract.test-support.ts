import type {
  BackendCapabilities,
  BackendEntry,
  BackendKind,
  BuildBackend,
  BuildJob,
  BuildOffer,
  BuildRecord,
  GameEntry,
  QueueRequest,
} from './contract';

// A finished, successful dev build `build-1` of game `game` on `main`, with `overrides` over its fields.
export function buildRecord(overrides: Partial<BuildRecord> = {}): BuildRecord {
  return {
    id: 'build-1',
    gameId: 'game',
    kind: 'dev',
    number: null,
    version: null,
    branch: 'main',
    revision: null,
    state: 'finished',
    result: 'success',
    statusText: null,
    percent: null,
    leftSeconds: null,
    stepText: null,
    queuedAt: 0,
    startedAt: null,
    finishedAt: null,
    startEstimate: null,
    webUrl: null,
    links: [],
    jobs: [],
    triggeredBy: null,
    ...overrides,
  };
}

// A finished, successful job `job-1`, with `overrides` over its fields.
export function buildJob(overrides: Partial<BuildJob> = {}): BuildJob {
  return {
    id: 'job-1',
    label: 'Job 1',
    state: 'finished',
    result: 'success',
    percent: null,
    leftSeconds: null,
    stepText: null,
    ...overrides,
  };
}

// Game `game` with one kind, `dev`, and no clone or sets, with `overrides` over its fields.
export function gameEntry(overrides: Partial<GameEntry> = {}): GameEntry {
  return {
    id: 'game',
    label: 'Game',
    clone: null,
    defaultBranch: 'main',
    kinds: { dev: { label: 'Dev', target: 'dev-target' } },
    sets: [],
    ...overrides,
  };
}

// Backend entry `backend` of kind `fixture` with no games, with `overrides` over its fields.
export function backendEntry(
  overrides: Partial<BackendEntry> = {},
): BackendEntry {
  return {
    id: 'backend',
    kind: 'fixture',
    label: 'Backend',
    config: {},
    games: [],
    ...overrides,
  };
}

// An offer of a dev build of `game` on `main`, with `overrides` over its fields.
export function buildOffer(overrides: Partial<BuildOffer> = {}): BuildOffer {
  return {
    backendId: 'backend',
    gameId: 'game',
    kind: 'dev',
    branch: 'main',
    revision: null,
    subject: null,
    createdAt: 0,
    ...overrides,
  };
}

// A backend that lists the builds a test set and records every call made on it.
export interface FixtureBackend extends BuildBackend {
  readonly listCalls: { gameId: string; limit: number }[];
  readonly queued: { gameId: string; request: QueueRequest }[];
  readonly cancelled: { gameId: string; buildId: string }[];
  readonly disposed: boolean;
  // The builds `list` gives for game `gameId` from now on.
  setBuilds(gameId: string, builds: BuildRecord[]): void;
  // `list` rejects with `error` from now on; null lists again.
  failLists(error: Error | null): void;
}

// A fixture backend that can cancel and chooses branches unless `capabilities` says otherwise. `list` gives the
// builds set for the game, `[]` by default, cut to `limit`; `queue` gives the ids `queued-1`, `queued-2`, ….
export function createFixtureBackend(
  options: { capabilities?: BackendCapabilities } = {},
): FixtureBackend {
  const builds = new Map<string, BuildRecord[]>();
  let listError: Error | null = null;
  const backend: FixtureBackend = {
    capabilities: options.capabilities ?? { cancel: true, choosesBranch: true },
    listCalls: [],
    queued: [],
    cancelled: [],
    disposed: false,
    async list(game, limit) {
      backend.listCalls.push({ gameId: game.id, limit });
      if (listError) {
        throw listError;
      }
      return (builds.get(game.id) ?? []).slice(0, limit);
    },
    async queue(game, request) {
      backend.queued.push({ gameId: game.id, request });
      return { id: `queued-${backend.queued.length}` };
    },
    async cancel(game, buildId) {
      backend.cancelled.push({ gameId: game.id, buildId });
    },
    dispose() {
      (backend as { disposed: boolean }).disposed = true;
    },
    setBuilds(gameId, gameBuilds) {
      builds.set(gameId, gameBuilds);
    },
    failLists(error) {
      listError = error;
    },
  };
  return backend;
}

// A backend kind `kind` whose `create` gives `backend` for every entry.
export function fixtureBackendKind(
  kind: string,
  backend: FixtureBackend,
): BackendKind {
  return {
    kind,
    label: `Fixture ${kind}`,
    async create() {
      return backend;
    },
  };
}
