import type { Clock } from '../../../contracts/ambient';
import type {
  BackendKind,
  BuildBackend,
  BuildJob,
  BuildRecord,
  GameEntry,
} from '../contract';

// The self-test's backend kind, `fixture`. Each game lists `<game id>-1`, finished and successful, and `<game id>-2`,
// which moves one step per `list` of that game: running with job `ios` running, then running with `ios` failed
// (`Archive failed`), then finished and failed. `queue` adds a queued build `<game id>-3`, `-4`, …, newest first.
export function selfTestBackendKind(clock: Clock): BackendKind {
  return {
    kind: 'fixture',
    label: 'Fixture',
    async create() {
      return selfTestBackend(clock);
    },
  };
}

function selfTestBackend(clock: Clock): BuildBackend {
  const createdAt = clock.now();
  const listCalls = new Map<string, number>();
  const queued = new Map<string, BuildRecord[]>();
  return {
    capabilities: { cancel: true, choosesBranch: false, saveLog: false },
    async list(game, limit) {
      const call = (listCalls.get(game.id) ?? 0) + 1;
      listCalls.set(game.id, call);
      const builds = [
        ...(queued.get(game.id) ?? []),
        movingBuild(game, call, createdAt),
        record(game, {
          id: `${game.id}-1`,
          number: '1',
          queuedAt: createdAt - 120_000,
          startedAt: createdAt - 110_000,
          finishedAt: createdAt - 60_000,
        }),
      ];
      return builds.slice(0, limit);
    },
    async queue(game, request) {
      const gameQueued = queued.get(game.id) ?? [];
      const number = String(gameQueued.length + 3);
      const build = record(game, {
        id: `${game.id}-${number}`,
        kind: request.kind,
        number,
        branch: request.branch,
        revision: request.revision,
        state: 'queued',
        result: null,
        queuedAt: clock.now(),
      });
      queued.set(game.id, [build, ...gameQueued]);
      return { id: build.id };
    },
    async cancel(game, buildId) {
      queued.set(
        game.id,
        (queued.get(game.id) ?? []).map((build): BuildRecord =>
          build.id === buildId
            ? {
                ...build,
                state: 'finished',
                result: 'cancelled',
                finishedAt: clock.now(),
              }
            : build,
        ),
      );
    },
    dispose() {},
  };
}

// Build `<game id>-2` at the `call`th list of its game.
function movingBuild(
  game: GameEntry,
  call: number,
  createdAt: number,
): BuildRecord {
  const ios = (overrides: Partial<BuildJob>): BuildJob => ({
    id: 'ios',
    label: 'iOS build',
    state: 'running',
    result: null,
    percent: null,
    leftSeconds: null,
    stepText: null,
    webUrl: null,
    startedAt: null,
    finishedAt: null,
    dependsOn: [],
    ...overrides,
  });
  const base = {
    id: `${game.id}-2`,
    number: '2',
    queuedAt: createdAt - 30_000,
    startedAt: createdAt - 20_000,
  };
  if (call === 1) {
    return record(game, {
      ...base,
      state: 'running',
      result: null,
      jobs: [ios({})],
    });
  }
  if (call === 2) {
    return record(game, {
      ...base,
      state: 'running',
      result: null,
      jobs: [
        ios({
          state: 'finished',
          result: 'failure',
          stepText: 'Archive failed',
        }),
      ],
    });
  }
  return record(game, {
    ...base,
    state: 'finished',
    result: 'failure',
    finishedAt: createdAt,
    jobs: [
      ios({ state: 'finished', result: 'failure', stepText: 'Archive failed' }),
    ],
  });
}

// A finished, successful build of the game's first kind on its default branch, with `fields` over it.
function record(game: GameEntry, fields: Partial<BuildRecord>): BuildRecord {
  return {
    id: `${game.id}-0`,
    gameId: game.id,
    kind: Object.keys(game.kinds)[0] ?? '',
    number: null,
    version: null,
    branch: game.defaultBranch,
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
    ...fields,
  };
}
