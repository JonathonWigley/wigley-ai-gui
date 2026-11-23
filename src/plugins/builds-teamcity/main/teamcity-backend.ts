import { isMissingFile } from '../../../contracts/files';
import { errorText } from '../../../shared/error-text';
import { isJsonObject } from '../../../shared/json';
import type {
  BackendEntry,
  BackendKind,
  BackendServices,
  BuildBackend,
  BuildLink,
  BuildRecord,
  GameEntry,
} from '../../builds/contract';
import { runTeamcity, type TeamcityCli } from './teamcity-cli';
import {
  type ChainDetail,
  type ListedBuild,
  parseBuildQueue,
  parseChainDetail,
  parseRunList,
  readFirebaseLinks,
  resultOf,
} from './teamcity-parse';

// The most detail and log calls one list runs at once.
export const MAX_CALLS_IN_FLIGHT = 4;
// How long a build whose detail could not be read waits before a list reads it again.
export const DETAIL_RETRY_MS = 10 * 60 * 1000;
// How long after a build finishes its deploy logs are still read for install links.
export const LINK_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const VERSION_TIMEOUT_MS = 10_000;
const LIST_TIMEOUT_MS = 30_000;
const LOG_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 60_000;

const CACHE_FILE = 'teamcity-finished.json';
const RUN_LIST_FIELDS =
  'id,number,status,state,webUrl,branchName,buildTypeId,statusText,queuedDate,startDate,finishDate,waitReason,triggered.user.name';
const QUEUE_PATH =
  '/app/rest/buildQueue?locator=count:1000&fields=build(id,buildTypeId,state,branchName,queuedDate,webUrl,waitReason,startEstimate,triggered(user(name)))';
const DETAIL_FIELDS =
  'id,state,status,statusText,running-info(percentageComplete,leftSeconds,currentStageText),snapshot-dependencies(build(id,buildTypeId,state,status,statusText,percentageComplete,buildType(name),running-info(percentageComplete,leftSeconds,currentStageText),revisions(revision(version))))';

// The `teamcity` backend kind: builds of TeamCity build chains, read and queued through the `teamcity` CLI. `config`
// holds an optional `command` (the CLI, `~` expanded; `teamcity` when empty) and an optional `buildJobPattern` (a
// regex over a snapshot dependency's `buildTypeId` naming the chain's Build jobs); a kind's `target` is a build
// configuration id.
export const teamcityBackendKind: BackendKind = {
  kind: 'teamcity',
  label: 'TeamCity',
  async create(entry, services) {
    const config = parseConfig(entry.config, services);
    if ('problem' in config) {
      return config;
    }
    const targetProblem = targetsProblem(entry);
    if (targetProblem !== null) {
      return { problem: targetProblem };
    }
    const cli: TeamcityCli = {
      processes: services.processes,
      command: config.command,
    };
    try {
      await runTeamcity(cli, ['--version'], VERSION_TIMEOUT_MS);
    } catch (error) {
      return {
        problem: `The TeamCity CLI ${config.command} does not run: ${errorText(error)}`,
      };
    }
    return createTeamcityBackend(cli, config.buildJobPattern, services);
  },
};

interface TeamcityConfig {
  command: string;
  buildJobPattern: RegExp | null;
}

function parseConfig(
  config: unknown,
  services: BackendServices,
): TeamcityConfig | { problem: string } {
  if (!isJsonObject(config)) {
    return { problem: 'The teamcity config must be a JSON object.' };
  }
  const { command, buildJobPattern } = config;
  if (command !== undefined && typeof command !== 'string') {
    return { problem: 'The teamcity config command must be a string.' };
  }
  if (buildJobPattern !== undefined && typeof buildJobPattern !== 'string') {
    return {
      problem: 'The teamcity config buildJobPattern must be a string.',
    };
  }
  let pattern: RegExp | null = null;
  if (buildJobPattern !== undefined && buildJobPattern !== '') {
    try {
      pattern = new RegExp(buildJobPattern);
    } catch (error) {
      return {
        problem: `The teamcity config buildJobPattern is not a valid regex: ${errorText(error)}`,
      };
    }
  }
  return {
    command:
      command === undefined || command === ''
        ? 'teamcity'
        : services.paths.expandTilde(command, services.homeDir),
    buildJobPattern: pattern,
  };
}

// What is wrong with the first kind whose target is not a build configuration id; null when none is.
function targetsProblem(entry: BackendEntry): string | null {
  for (const game of entry.games) {
    for (const [kind, { target }] of Object.entries(game.kinds)) {
      if (typeof target !== 'string' || target === '') {
        return `Game ${game.id} kind ${kind} needs a target: a TeamCity build configuration id.`;
      }
    }
  }
  return null;
}

// Each kind of the game by its build configuration id; `create` refused every target that is not a string.
function kindsByTarget(game: GameEntry): Map<string, string> {
  const kinds = new Map<string, string>();
  for (const [kind, { target }] of Object.entries(game.kinds)) {
    if (typeof target === 'string' && !kinds.has(target)) {
      kinds.set(target, kind);
    }
  }
  return kinds;
}

// What this instance queued a build with, for the rows TeamCity lists as `<default>`.
interface QueuedPin {
  branch: string;
  revision: string | null;
}

// A build of one list, its record, and whether it may be cached.
interface ReadBuild {
  record: BuildRecord;
  isCacheable: boolean;
}

type Limit = <T>(call: () => Promise<T>) => Promise<T>;

function createTeamcityBackend(
  cli: TeamcityCli,
  buildJobPattern: RegExp | null,
  services: BackendServices,
): BuildBackend {
  // Finished builds whose detail and every log were read, by game id then build id; null until the first list.
  let finishedCache: Promise<Map<string, Map<string, BuildRecord>>> | null =
    null;
  let cacheWrites: Promise<void> = Promise.resolve();
  const queuedPins = new Map<string, QueuedPin>();
  // The time each failed detail read failed, by build id.
  const failedDetails = new Map<string, number>();

  const cache = () => {
    finishedCache ??= readCacheFile(services);
    return finishedCache;
  };

  const writeCache = (games: Map<string, Map<string, BuildRecord>>) => {
    cacheWrites = cacheWrites.then(async () => {
      const file = {
        games: Object.fromEntries(
          [...games].map(([gameId, records]) => [
            gameId,
            [...records.values()],
          ]),
        ),
      };
      try {
        await services.dataFiles.write(
          CACHE_FILE,
          `${JSON.stringify(file, null, 2)}\n`,
        );
      } catch (error) {
        services.log(`Could not write ${CACHE_FILE}: ${errorText(error)}`);
      }
    });
    return cacheWrites;
  };

  // The build's detail, or null after logging why it could not be read; a read that failed within DETAIL_RETRY_MS is
  // not tried again.
  const readDetail = async (
    id: string,
    limit: Limit,
  ): Promise<ChainDetail | null> => {
    const failedAt = failedDetails.get(id);
    if (
      failedAt !== undefined &&
      services.clock.now() < failedAt + DETAIL_RETRY_MS
    ) {
      return null;
    }
    try {
      const text = await limit(() =>
        runTeamcity(
          cli,
          ['api', `/app/rest/builds/id:${id}?fields=${DETAIL_FIELDS}`],
          LIST_TIMEOUT_MS,
        ),
      );
      const detail = parseChainDetail(JSON.parse(text), buildJobPattern);
      if (detail === null) {
        throw new Error('the detail is not a JSON object');
      }
      failedDetails.delete(id);
      return detail;
    } catch (error) {
      failedDetails.set(id, services.clock.now());
      services.log(`Could not read build ${id}: ${errorText(error)}`);
      return null;
    }
  };

  // The install links of the job logs, in job order, and whether every log was read.
  const readLinks = async (
    logJobIds: string[],
    limit: Limit,
  ): Promise<{ links: BuildLink[]; isComplete: boolean }> => {
    const logs = await Promise.allSettled(
      logJobIds.map((jobId) =>
        limit(() =>
          runTeamcity(cli, ['run', 'log', jobId, '--raw'], LOG_TIMEOUT_MS),
        ),
      ),
    );
    const links = new Map<string, BuildLink>();
    for (const [index, log] of logs.entries()) {
      if (log.status === 'rejected') {
        services.log(
          `Could not read the log of job ${logJobIds[index]}: ${errorText(log.reason)}`,
        );
        continue;
      }
      for (const link of readFirebaseLinks(log.value)) {
        if (!links.has(link.url)) {
          links.set(link.url, link);
        }
      }
    }
    const isComplete = logs.every((log) => log.status === 'fulfilled');
    return { links: [...links.values()], isComplete };
  };

  const readBuild = async (
    game: GameEntry,
    listed: ListedBuild,
    kind: string,
    cached: Map<string, BuildRecord>,
    limit: Limit,
  ): Promise<ReadBuild> => {
    const record = listedRecord(game, listed, kind, queuedPins.get(listed.id));
    if (listed.state === 'queued') {
      return { record, isCacheable: false };
    }
    const cachedRecord = cached.get(listed.id);
    if (listed.state === 'finished' && cachedRecord !== undefined) {
      return { record: cachedRecord, isCacheable: true };
    }
    const detail = await readDetail(listed.id, limit);
    if (detail === null) {
      return { record, isCacheable: false };
    }
    const withDetail = {
      ...record,
      revision: detail.revision,
      jobs: detail.jobs,
    };
    if (listed.state === 'running') {
      return {
        record: {
          ...withDetail,
          percent: detail.percent,
          leftSeconds: detail.leftSeconds,
          stepText: detail.stepText,
        },
        isCacheable: false,
      };
    }
    const isPastLinkWindow =
      listed.finishedAt !== null &&
      services.clock.now() - listed.finishedAt > LINK_WINDOW_MS;
    if (isPastLinkWindow) {
      return { record: withDetail, isCacheable: true };
    }
    const { links, isComplete } = await readLinks(detail.logJobIds, limit);
    return { record: { ...withDetail, links }, isCacheable: isComplete };
  };

  // The game's builds of the run lists and the queue, merged by id with the queue's row winning, newest first, cut
  // to `limit`, each with the kind its build configuration belongs to.
  const listBuilds = async (
    game: GameEntry,
    limit: number,
  ): Promise<{ listed: ListedBuild; kind: string }[]> => {
    const kinds = kindsByTarget(game);
    const [runLists, queue] = await Promise.all([
      Promise.all(
        [...kinds.keys()].map(async (target) =>
          parseRunList(
            JSON.parse(
              await runTeamcity(
                cli,
                [
                  'run',
                  'list',
                  '--job',
                  target,
                  '--limit',
                  String(limit),
                  `--json=${RUN_LIST_FIELDS}`,
                ],
                LIST_TIMEOUT_MS,
              ),
            ),
          ),
        ),
      ),
      runTeamcity(cli, ['api', QUEUE_PATH], LIST_TIMEOUT_MS).then((text) =>
        parseBuildQueue(JSON.parse(text)),
      ),
    ]);
    const byId = new Map<string, { listed: ListedBuild; kind: string }>();
    for (const listed of [...runLists.flat(), ...queue]) {
      const kind = kinds.get(listed.buildTypeId);
      if (kind !== undefined) {
        byId.set(listed.id, { listed, kind });
      }
    }
    return [...byId.values()]
      .sort(
        ({ listed: a }, { listed: b }) =>
          b.queuedAt - a.queuedAt || Number(b.id) - Number(a.id),
      )
      .slice(0, limit);
  };

  return {
    capabilities: { cancel: false, choosesBranch: true },

    async list(game, limit) {
      const builds = await listBuilds(game, limit);
      const games = await cache();
      const cached = games.get(game.id) ?? new Map<string, BuildRecord>();
      const callLimit = createLimit(MAX_CALLS_IN_FLIGHT);
      const read = await Promise.all(
        builds.map(({ listed, kind }) =>
          readBuild(game, listed, kind, cached, callLimit),
        ),
      );
      const nextCached = new Map(
        read
          .filter((each) => each.isCacheable)
          .map(({ record }) => [record.id, record] as const),
      );
      const hasCacheChanged =
        nextCached.size !== cached.size ||
        [...nextCached.keys()].some((id) => !cached.has(id));
      games.set(game.id, nextCached);
      if (hasCacheChanged) {
        await writeCache(games);
      }
      return read.map((each) => each.record);
    },

    async queue(game, request) {
      const target = Object.hasOwn(game.kinds, request.kind)
        ? game.kinds[request.kind].target
        : undefined;
      if (typeof target !== 'string') {
        throw new Error(`${game.id} has no kind ${request.kind}`);
      }
      const revisionArgs =
        request.revision === null ? [] : ['--revision', request.revision];
      const answer: unknown = JSON.parse(
        await runTeamcity(
          cli,
          [
            'run',
            'start',
            target,
            '--branch',
            request.branch,
            ...revisionArgs,
            '--no-push',
            '--json',
          ],
          START_TIMEOUT_MS,
        ),
      );
      if (!isJsonObject(answer) || typeof answer.id !== 'number') {
        throw new Error('teamcity run start gave no build id');
      }
      const id = String(answer.id);
      queuedPins.set(id, {
        branch: request.branch,
        revision: request.revision,
      });
      return { id };
    },

    dispose() {
      finishedCache = null;
      queuedPins.clear();
      failedDetails.clear();
    },
  };
}

// The record of a listed build before its detail is read: no revision but a queued one, no jobs, links or progress.
// A branch TeamCity names `<default>`, or none, is the one this instance queued on, else the game's default branch.
function listedRecord(
  game: GameEntry,
  listed: ListedBuild,
  kind: string,
  pin: QueuedPin | undefined,
): BuildRecord {
  const isQueued = listed.state === 'queued';
  const listedBranch = listed.branchName;
  const hasBranch = listedBranch !== null && listedBranch !== '<default>';
  return {
    id: listed.id,
    gameId: game.id,
    kind,
    number: isQueued ? null : listed.number,
    version: isQueued ? null : listed.version,
    branch: hasBranch ? listedBranch : (pin?.branch ?? game.defaultBranch),
    revision: isQueued ? (pin?.revision ?? null) : null,
    state: listed.state,
    result: resultOf(listed.state, listed.status),
    statusText: listed.statusText ?? listed.waitReason,
    percent: null,
    leftSeconds: null,
    stepText: null,
    queuedAt: listed.queuedAt,
    startedAt: listed.startedAt,
    finishedAt: listed.finishedAt,
    startEstimate: listed.startEstimate,
    webUrl: listed.webUrl,
    links: [],
    jobs: [],
    triggeredBy: listed.triggeredBy,
  };
}

// The cache file's records by game id then build id; a missing or malformed file reads as empty.
async function readCacheFile(
  services: BackendServices,
): Promise<Map<string, Map<string, BuildRecord>>> {
  let text: string;
  try {
    text = await services.dataFiles.read(CACHE_FILE);
  } catch (error) {
    if (!isMissingFile(error)) {
      services.log(`Could not read ${CACHE_FILE}: ${errorText(error)}`);
    }
    return new Map();
  }
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return new Map();
  }
  const games = isJsonObject(file) ? file.games : undefined;
  if (!isJsonObject(games)) {
    return new Map();
  }
  const cached = new Map<string, Map<string, BuildRecord>>();
  for (const [gameId, records] of Object.entries(games)) {
    const kept = Array.isArray(records)
      ? records.filter(
          (record): record is BuildRecord =>
            isJsonObject(record) && typeof record.id === 'string',
        )
      : [];
    cached.set(gameId, new Map(kept.map((record) => [record.id, record])));
  }
  return cached;
}

// Runs at most `max` calls at once; each further call waits for one to settle.
function createLimit(max: number): Limit {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (call) => {
    if (running >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running += 1;
    }
    try {
      return await call();
    } finally {
      const next = waiting.shift();
      if (next === undefined) {
        running -= 1;
      } else {
        next();
      }
    }
  };
}
