import {
  type Files,
  isMissingFile,
  readIfPresent,
} from '../../../contracts/files';
import { errorText } from '../../../shared/error-text';
import { isJsonObject, isStringArray } from '../../../shared/json';
import { createSerialQueue } from '../../../shared/serial-queue';
import type {
  BackendEntry,
  BackendKind,
  BackendServices,
  BuildBackend,
  BuildRecord,
  BuildResult,
  GameEntry,
  QueueRequest,
} from '../../builds/contract';
import {
  aliveCheckLine,
  isAlive,
  killLine,
  type LocalTarget,
  wrapperLine,
} from './local-wrapper';

// The newest finished runs `runs.json` keeps of each game and kind.
export const KEPT_RUNS = 50;
// How long a run may go without its pid file before it counts as ended.
export const PID_GRACE_MS = 10_000;

const RUNS_FILE = 'runs.json';
const LOG_FILE = 'log.txt';
const PID_FILE = 'pid';
const EXIT_CODE_FILE = 'exit-code';
const RUN_FILES = [LOG_FILE, PID_FILE, EXIT_CODE_FILE];
const LOG_END_BYTES = 4096;
const CHECK_TIMEOUT_MS = 5_000;
// A game id or kind key, each a folder name under `runs/`.
const FOLDER_NAME = /^[A-Za-z0-9._-]+$/;
// oxlint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b\[[0-?]*[ -\/]*[@-~]/g;
const LINE_BREAK = /[\r\n]/;

// One build this backend started, as `runs.json` keeps it. `id` is `<game id>/<kind>/<startedAt>`, which is also
// its folder under `runs/`.
interface LocalRun {
  id: string;
  gameId: string;
  kind: string;
  branch: string;
  revision: string | null;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  cancelled: boolean;
  lastLine: string | null;
}

// A game as `create` parsed it: its clone and each kind's target.
interface LocalGame {
  clone: string;
  targets: Map<string, LocalTarget>;
}

// Runs each build kind's command detached in the game's clone, through a wrapper that writes a pid file and an
// exit-code file beside the run's log, so a build outlives an app restart.
export const localBackendKind: BackendKind = {
  kind: 'local',
  label: 'Local',
  create: async (entry, services) => {
    const games = parseEntry(entry);
    return typeof games === 'string'
      ? { problem: games }
      : createLocalBackend(games, services);
  },
};

// Each game of `entry` by id, or the problem with the entry.
function parseEntry(entry: BackendEntry): Map<string, LocalGame> | string {
  if (!isJsonObject(entry.config)) {
    return 'The local backend’s config must be a JSON object.';
  }
  const games = new Map<string, LocalGame>();
  for (const game of entry.games) {
    const parsed = parseGame(game);
    if (typeof parsed === 'string') {
      return parsed;
    }
    games.set(game.id, parsed);
  }
  return games;
}

function parseGame(game: GameEntry): LocalGame | string {
  if (!isFolderName(game.id)) {
    return `The game id ${game.id} is not a folder name: use letters, digits, ., _ and -.`;
  }
  const kinds = Object.keys(game.kinds);
  const badKind = kinds.find((kind) => !isFolderName(kind));
  if (badKind !== undefined) {
    return `The game ${game.id} has the kind ${badKind}, which is not a folder name: use letters, digits, ., _ and -.`;
  }
  if (game.clone === null) {
    return `The game ${game.id} names no clone.`;
  }
  const targets = new Map<string, LocalTarget>();
  for (const kind of kinds) {
    const target = parseTarget(game.kinds[kind].target);
    if (target === null) {
      return `The kind ${kind} of the game ${game.id} needs a target of { "command": a non-empty string, "args": strings }.`;
    }
    const holdsLineBreak = [target.command, ...target.args].some((text) =>
      LINE_BREAK.test(text),
    );
    if (holdsLineBreak) {
      return `The target of the kind ${kind} of the game ${game.id} holds a line break.`;
    }
    targets.set(kind, target);
  }
  return { clone: game.clone, targets };
}

function isFolderName(name: string): boolean {
  return FOLDER_NAME.test(name) && name !== '.' && name !== '..';
}

function parseTarget(target: unknown): LocalTarget | null {
  if (!isJsonObject(target)) {
    return null;
  }
  const { command, args } = target;
  const isCommand = typeof command === 'string' && command !== '';
  if (!isCommand || !isStringArray(args)) {
    return null;
  }
  return { command, args: [...args] };
}

// One backend entry's instance. Every call runs through one serial chain, reads `runs.json` as it starts and again
// before it writes, and lays only the runs it changed over the file's, so another instance's runs over the same data
// stay.
function createLocalBackend(
  games: Map<string, LocalGame>,
  services: BackendServices,
): BuildBackend {
  const { dataFiles, processes, clock } = services;
  const os = services.platform.os;
  const chain = createSerialQueue();
  // The runs as this instance last read or wrote them; only those in `changedIds` outlive the next read.
  let runs: LocalRun[] = [];
  // The ids of runs this instance added or changed since its last write.
  const changedIds = new Set<string>();

  const dataPath = (run: LocalRun, name: string) => `runs/${run.id}/${name}`;
  const fullPath = (run: LocalRun, name: string) =>
    services.paths.join(
      services.dataFolder,
      'runs',
      run.gameId,
      run.kind,
      String(run.startedAt),
      name,
    );

  const changedRuns = () => runs.filter((run) => changedIds.has(run.id));

  // The file's runs with this instance's unsaved changes laid over them, which becomes the instance's list.
  const currentRuns = async (): Promise<LocalRun[]> => {
    const ours = changedRuns();
    runs = mergedRuns(await readRuns(dataFiles), ours);
    for (const run of ours) {
      if (!runs.includes(run)) {
        changedIds.delete(run.id);
      }
    }
    return runs;
  };

  // Writes the merge of the file's runs and this instance's changes, and gives the runs it kept.
  const writeRuns = async (): Promise<LocalRun[]> => {
    const merged = mergedRuns(await readRuns(dataFiles), changedRuns());
    const { kept, dropped } = keptRuns(merged);
    await dataFiles.write(RUNS_FILE, `${JSON.stringify({ runs: kept })}\n`);
    runs = kept;
    changedIds.clear();
    for (const run of dropped) {
      for (const name of RUN_FILES) {
        await dataFiles.deleteFile(dataPath(run, name));
      }
    }
    return kept;
  };

  const readExitCode = async (run: LocalRun): Promise<number | null> => {
    const text = await readIfPresent(dataFiles, dataPath(run, EXIT_CODE_FILE));
    const trimmed = text?.trim() ?? '';
    return /^-?\d+$/.test(trimmed) ? Number(trimmed) : null;
  };

  const readPid = async (run: LocalRun): Promise<number | null> => {
    const text = await readIfPresent(dataFiles, dataPath(run, PID_FILE));
    const trimmed = text?.trim() ?? '';
    const pid = Number(trimmed);
    return /^\d+$/.test(trimmed) && pid > 0 ? pid : null;
  };

  const readLastLine = async (run: LocalRun): Promise<string | null> => {
    try {
      const end = await dataFiles.readEnd(
        dataPath(run, LOG_FILE),
        LOG_END_BYTES,
      );
      return lastLineOf(end);
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  };

  // Whether the wrapper of `run`, at `pid`, is still running.
  const checkAlive = async (run: LocalRun, pid: number) => {
    const line = aliveCheckLine(os, pid);
    const result = await processes.run(line.command, line.args, {
      timeoutMs: CHECK_TIMEOUT_MS,
    });
    return isAlive(os, fullPath(run, PID_FILE), result);
  };

  const finish = async (
    run: LocalRun,
    exitCode: number | null,
    finishedAt: number,
  ) => {
    run.exitCode = exitCode;
    run.finishedAt = finishedAt;
    run.lastLine = await readLastLine(run);
    changedIds.add(run.id);
  };

  const finishWithExitCode = async (run: LocalRun, exitCode: number) => {
    const at = await dataFiles.modified(dataPath(run, EXIT_CODE_FILE));
    await finish(run, exitCode, at);
  };

  // A run whose pid is gone: it can have ended between the first exit-code read and the alive check.
  const finishGone = async (run: LocalRun) => {
    const exitCode = await readExitCode(run);
    if (exitCode === null) {
      await finish(run, null, clock.now());
    } else {
      await finishWithExitCode(run, exitCode);
    }
  };

  // Ends the run when its files or its pid show it ended; true when it did.
  const settle = async (run: LocalRun): Promise<boolean> => {
    const exitCode = await readExitCode(run);
    if (exitCode !== null) {
      await finishWithExitCode(run, exitCode);
      return true;
    }
    const pid = await readPid(run);
    if (pid === null) {
      if (clock.now() - run.startedAt < PID_GRACE_MS) {
        return false;
      }
      await finish(run, null, clock.now());
      return true;
    }
    const alive = await checkAlive(run, pid).catch(() => true);
    if (alive) {
      return false;
    }
    await finishGone(run);
    return true;
  };

  // Settles each unfinished run of the game; true when any ended.
  const settleGame = async (loaded: LocalRun[], gameId: string) => {
    let anyEnded = false;
    const unfinished = loaded.filter(
      (run) => run.gameId === gameId && run.finishedAt === null,
    );
    for (const run of unfinished) {
      anyEnded = (await settle(run)) || anyEnded;
    }
    return anyEnded;
  };

  const toRecord = async (
    run: LocalRun,
    loaded: LocalRun[],
  ): Promise<BuildRecord> => {
    const isRunning = run.finishedAt === null;
    const progress = isRunning
      ? progressOf(run, loaded, clock.now())
      : { percent: null, leftSeconds: null };
    const ending = isRunning
      ? { result: null, statusText: null }
      : endingOf(run);
    return {
      id: run.id,
      gameId: run.gameId,
      kind: run.kind,
      number: null,
      version: null,
      branch: run.branch,
      revision: run.revision,
      state: isRunning ? 'running' : 'finished',
      result: ending.result,
      statusText: ending.statusText,
      percent: progress.percent,
      leftSeconds: progress.leftSeconds,
      stepText: isRunning ? await readLastLine(run) : run.lastLine,
      queuedAt: run.startedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      startEstimate: null,
      webUrl: null,
      links: [],
      jobs: [],
      triggeredBy: null,
    };
  };

  const list = async (game: GameEntry, limit: number) => {
    const loaded = await currentRuns();
    const current = (await settleGame(loaded, game.id))
      ? await writeRuns()
      : loaded;
    const newest = current
      .filter((run) => run.gameId === game.id)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
    return Promise.all(newest.map((run) => toRecord(run, current)));
  };

  const queue = async (game: GameEntry, request: QueueRequest) => {
    const localGame = games.get(game.id);
    const target = localGame?.targets.get(request.kind);
    if (localGame === undefined || target === undefined) {
      throw new Error(`${game.id} has no kind ${request.kind}`);
    }
    const loaded = await currentRuns();
    await settleGame(loaded, game.id);
    const isKindRunning = loaded.some(
      (run) =>
        run.gameId === game.id &&
        run.kind === request.kind &&
        run.finishedAt === null,
    );
    if (isKindRunning) {
      throw new Error(
        `${kindLabelOf(game, request.kind)} of ${game.label} is already building.`,
      );
    }
    const { clone } = localGame;
    const branch = await services.git.currentBranch(clone);
    if (branch === null) {
      throw new Error(`${clone} is not a git clone`);
    }
    const revision = await services.git.resolveCommit(clone, 'HEAD');
    const startedAt = clock.now();
    const run: LocalRun = {
      id: `${game.id}/${request.kind}/${startedAt}`,
      gameId: game.id,
      kind: request.kind,
      branch,
      revision,
      startedAt,
      finishedAt: null,
      exitCode: null,
      cancelled: false,
      lastLine: null,
    };
    await dataFiles.makeFolder(`runs/${run.id}`);
    loaded.push(run);
    changedIds.add(run.id);
    const line = wrapperLine(
      os,
      { pid: fullPath(run, PID_FILE), exitCode: fullPath(run, EXIT_CODE_FILE) },
      target,
    );
    try {
      await processes.startDetached(line.command, line.args, {
        cwd: clone,
        logPath: fullPath(run, LOG_FILE),
      });
    } catch (error) {
      loaded.splice(loaded.indexOf(run), 1);
      changedIds.delete(run.id);
      throw error;
    }
    try {
      await writeRuns();
    } catch (error) {
      services.log(`Could not save runs.json: ${errorText(error)}`);
    }
    return { id: run.id };
  };

  const cancel = async (game: GameEntry, buildId: string) => {
    const run = (await currentRuns()).find(
      (candidate) => candidate.id === buildId && candidate.gameId === game.id,
    );
    if (run === undefined) {
      throw new Error(`No local build ${buildId}`);
    }
    if (run.finishedAt !== null) {
      return;
    }
    const exitCode = await readExitCode(run);
    if (exitCode !== null) {
      await finishWithExitCode(run, exitCode);
      await writeRuns();
      return;
    }
    const pid = await readPid(run);
    if (pid === null) {
      throw new Error('The build has not written its pid yet');
    }
    if (!(await checkAlive(run, pid))) {
      await finishGone(run);
      await writeRuns();
      return;
    }
    const kill = killLine(os, pid);
    const killed = await processes.run(kill.command, kill.args, {
      timeoutMs: CHECK_TIMEOUT_MS,
    });
    if (killed.timedOut) {
      throw new Error(`${kill.command} timed out stopping the build`);
    }
    // A kill that exits non-zero found no process to end: the build had already ended.
    if (killed.code !== 0) {
      await finishGone(run);
      await writeRuns();
      return;
    }
    run.cancelled = true;
    run.exitCode = null;
    run.finishedAt = clock.now();
    run.lastLine = await readLastLine(run);
    changedIds.add(run.id);
    await writeRuns();
  };

  return {
    capabilities: { cancel: true, choosesBranch: false },
    list: (game, limit) => chain.run(() => list(game, limit)),
    queue: (game, request) => chain.run(() => queue(game, request)),
    cancel: (game, buildId) => chain.run(() => cancel(game, buildId)),
    // A write in flight finishes on its own, and running builds outlive the app.
    dispose() {},
  };
}

// The runs `runs.json` holds; none when the file is missing. Rejects `runs.json is not valid: <reason>` for a file
// that is not JSON or not of its shape.
async function readRuns(dataFiles: Files): Promise<LocalRun[]> {
  const text = await readIfPresent(dataFiles, RUNS_FILE);
  if (text === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${RUNS_FILE} is not valid: ${errorText(error)}`);
  }
  const fileRuns: unknown = isJsonObject(parsed) ? parsed.runs : undefined;
  if (!Array.isArray(fileRuns)) {
    throw new Error(`${RUNS_FILE} is not valid: runs is not an array`);
  }
  return fileRuns.map((value: unknown, index) => {
    const run = parseRun(value);
    if (run === null) {
      throw new Error(
        `${RUNS_FILE} is not valid: run ${index} lacks a field or has one of the wrong type`,
      );
    }
    return run;
  });
}

// The run's `LocalRun` fields; null when one is missing or of the wrong type. Other keys are left out.
function parseRun(value: unknown): LocalRun | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const isString = (key: string) => typeof value[key] === 'string';
  const isNumber = (key: string) => typeof value[key] === 'number';
  const isStringOrNull = (key: string) => value[key] === null || isString(key);
  const isNumberOrNull = (key: string) => value[key] === null || isNumber(key);
  const isRun =
    ['id', 'gameId', 'kind', 'branch'].every(isString) &&
    ['revision', 'lastLine'].every(isStringOrNull) &&
    isNumber('startedAt') &&
    ['finishedAt', 'exitCode'].every(isNumberOrNull) &&
    typeof value.cancelled === 'boolean';
  if (!isRun) {
    return null;
  }
  return {
    id: value.id as string,
    gameId: value.gameId as string,
    kind: value.kind as string,
    branch: value.branch as string,
    revision: value.revision as string | null,
    startedAt: value.startedAt as number,
    finishedAt: value.finishedAt as number | null,
    exitCode: value.exitCode as number | null,
    cancelled: value.cancelled as boolean,
    lastLine: value.lastLine as string | null,
  };
}

// `fileRuns` with `ours` laid over them by run id, and those of `ours` the file lacks after them. A run the file holds
// finished keeps the file's record.
function mergedRuns(fileRuns: LocalRun[], ours: LocalRun[]): LocalRun[] {
  const finishedInFile = new Set(
    fileRuns.filter((run) => run.finishedAt !== null).map((run) => run.id),
  );
  const laid = new Map(
    ours
      .filter((run) => !finishedInFile.has(run.id))
      .map((run) => [run.id, run]),
  );
  const fileIds = new Set(fileRuns.map((run) => run.id));
  return [
    ...fileRuns.map((run) => laid.get(run.id) ?? run),
    ...[...laid.values()].filter((run) => !fileIds.has(run.id)),
  ];
}

// The newest `KEPT_RUNS` finished runs of each game and kind, by `startedAt`, and every unfinished run; `dropped`
// holds the rest.
function keptRuns(all: LocalRun[]): { kept: LocalRun[]; dropped: LocalRun[] } {
  const finishedSeen = new Map<string, number>();
  const droppedIds = new Set<string>();
  const newestFirst = [...all].sort((a, b) => b.startedAt - a.startedAt);
  for (const run of newestFirst) {
    if (run.finishedAt === null) {
      continue;
    }
    const group = `${run.gameId}/${run.kind}`;
    const seen = (finishedSeen.get(group) ?? 0) + 1;
    finishedSeen.set(group, seen);
    if (seen > KEPT_RUNS) {
      droppedIds.add(run.id);
    }
  }
  return {
    kept: all.filter((run) => !droppedIds.has(run.id)),
    dropped: all.filter((run) => droppedIds.has(run.id)),
  };
}

// The last non-empty line of a log's end, its CSI escape sequences removed; a line redrawn with `\r` gives its last state.
function lastLineOf(text: string): string | null {
  const lines = text
    .replace(ANSI_ESCAPE, '')
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.at(-1) ?? null;
}

// A running run's elapsed time over the duration of the newest success of its game and kind.
function progressOf(
  run: LocalRun,
  all: LocalRun[],
  now: number,
): { percent: number | null; leftSeconds: number | null } {
  const durationOf = (other: LocalRun) =>
    (other.finishedAt ?? other.startedAt) - other.startedAt;
  const baseline = all
    .filter(
      (other) =>
        other.gameId === run.gameId &&
        other.kind === run.kind &&
        other.finishedAt !== null &&
        other.exitCode === 0 &&
        !other.cancelled &&
        durationOf(other) > 0,
    )
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
  if (baseline === undefined) {
    return { percent: null, leftSeconds: null };
  }
  const duration = durationOf(baseline);
  const elapsed = now - run.startedAt;
  return {
    percent: Math.min(99, Math.floor((elapsed * 100) / duration)),
    leftSeconds: Math.max(0, Math.ceil((duration - elapsed) / 1000)),
  };
}

function endingOf(run: LocalRun): {
  result: BuildResult;
  statusText: string | null;
} {
  if (run.cancelled) {
    return { result: 'cancelled', statusText: 'Cancelled' };
  }
  if (run.exitCode === 0) {
    return { result: 'success', statusText: null };
  }
  if (run.exitCode === null) {
    return { result: 'failure', statusText: 'ended without an exit code' };
  }
  return { result: 'failure', statusText: `Exited with code ${run.exitCode}` };
}

function kindLabelOf(game: GameEntry, kind: string): string {
  return Object.hasOwn(game.kinds, kind) ? game.kinds[kind].label : kind;
}
