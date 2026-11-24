import type { Clock } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type {
  BackendKind,
  BuildBackend,
  BuildJob,
  BuildRecord,
  GameEntry,
} from '../contract';

const FIXTURE_URL = 'https://fixture.example.com';

// The self-test's and a drive run's backend kind, `fixture`. Each game lists `<game id>-1`, finished and successful
// with no jobs, and `<game id>-2`, with jobs `build-android` (succeeded), `ios` and `deploy` (waiting on both), which
// moves one step per `list` of that game: running with `ios` running and `deploy` queued, then running with `ios`
// failed (`Archive failed`), then finished and failed with `deploy` cancelled. `queue` adds a queued build
// `<game id>-3`, `-4`, …, newest first. It saves logs: `saveLog` writes one line naming the build and the job.
export function selfTestBackendKind(clock: Clock): BackendKind {
  return {
    kind: 'fixture',
    label: 'Fixture',
    async create(_entry, services) {
      return selfTestBackend(clock, services.files);
    },
  };
}

function selfTestBackend(clock: Clock, files: Files): BuildBackend {
  const createdAt = clock.now();
  const listCalls = new Map<string, number>();
  const queued = new Map<string, BuildRecord[]>();
  return {
    capabilities: { cancel: true, choosesBranch: false, saveLog: true },
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
    async saveLog(_game, buildId, jobId, path) {
      await files.write(
        path,
        `fixture log of ${buildId} ${jobId ?? 'build'}\n`,
      );
    },
    dispose() {},
  };
}

// Build `<game id>-2` at the `call`th list of its game, with its three jobs at that call.
function movingBuild(
  game: GameEntry,
  call: number,
  createdAt: number,
): BuildRecord {
  const buildId = `${game.id}-2`;
  const job = (
    fields: Partial<BuildJob> & Pick<BuildJob, 'id' | 'label'>,
  ): BuildJob => ({
    state: 'finished',
    result: 'success',
    percent: null,
    leftSeconds: null,
    stepText: null,
    webUrl: `${FIXTURE_URL}/${buildId}/${fields.id}`,
    startedAt: null,
    finishedAt: null,
    dependsOn: [],
    ...fields,
  });
  const iosFailed = call >= 2;
  const deployCancelled = call >= 3;
  const jobs = [
    job({
      id: 'build-android',
      label: 'Build Android',
      startedAt: createdAt - 20_000,
      finishedAt: createdAt - 10_000,
    }),
    job({
      id: 'ios',
      label: 'iOS build',
      state: iosFailed ? 'finished' : 'running',
      result: iosFailed ? 'failure' : null,
      stepText: iosFailed ? 'Archive failed' : null,
      startedAt: createdAt - 20_000,
      finishedAt: iosFailed ? createdAt - 5_000 : null,
    }),
    job({
      id: 'deploy',
      label: 'Deploy',
      state: deployCancelled ? 'finished' : 'queued',
      result: deployCancelled ? 'cancelled' : null,
      dependsOn: ['build-android', 'ios'],
    }),
  ];
  const base = {
    id: buildId,
    number: '2',
    queuedAt: createdAt - 30_000,
    startedAt: createdAt - 20_000,
    webUrl: `${FIXTURE_URL}/${buildId}`,
    jobs,
  };
  if (call < 3) {
    return record(game, { ...base, state: 'running', result: null });
  }
  return record(game, {
    ...base,
    state: 'finished',
    result: 'failure',
    finishedAt: createdAt,
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
