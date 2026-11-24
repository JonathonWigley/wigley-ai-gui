import type { Clock, Timers } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { KeyedSlotWriter } from '../../../contracts/state';
import { errorText } from '../../../shared/error-text';
import { kindLabel } from '../builds-model';
import type {
  BuildBackend,
  BuildDownload,
  BuildFile,
  BuildJob,
  BuildKindEntry,
  BuildRecord,
  GameEntry,
} from '../contract';

// How long an ended save stays in `builds.downloads`.
export const DOWNLOAD_KEEP_MS = 10 * 60 * 1000;
// How long a file check waits on its `stat` before it keeps the file's last result.
export const FILE_CHECK_TIMEOUT_MS = 5000;

const RESTARTED_PROBLEM = 'the builds plugin restarted during the save';

// Every entry of the kind's `downloads` whose placeholders the build fills, in the kind's order. Not yet checked on disk.
// A template with `{version}` or `{number}` that the build lacks gives no file; any other `{…}` stays as written.
export function filledFiles(
  kind: BuildKindEntry,
  build: BuildRecord,
): BuildFile[] {
  return kind.downloads.flatMap((download, entry) => {
    const path = filledPath(download.path, build);
    return path === null ? [] : [{ label: download.label, path, entry }];
  });
}

// `<game label>-<kind label>-<number>-<job label>.log`, each part reduced to ASCII letters and digits joined by `-`;
// a null number is `build-<build id>`, a null job label `build`, and a part left empty is dropped.
export function savedLogName(
  game: GameEntry,
  build: BuildRecord,
  jobLabel: string | null,
): string {
  const parts = [
    game.label,
    kindLabel(game, build.kind),
    build.number ?? `build-${build.id}`,
    jobLabel ?? 'build',
  ];
  const kept = parts.map(fileNamePart).filter((part) => part !== '');
  return `${kept.join('-')}.log`;
}

export interface DownloadsDeps {
  files: Files;
  paths: Paths;
  clock: Clock;
  timers: Timers;
  downloadsDir: string;
  revealPath(path: string): void;
  slot: KeyedSlotWriter<BuildDownload>;
  log(message: string): void;
  filesChanged(): void; // a finished check changed what `filesOf` gives
}

export interface DownloadTarget {
  backendId: string;
  game: GameEntry;
  build: BuildRecord;
}

// The file checks and the saves into the Downloads folder.
//
// `checkFiles` returns at once: it forgets the game's files not among `builds`' filled paths and starts a `stat` of
// each path not already being checked, which gives up after `FILE_CHECK_TIMEOUT_MS` keeping the path's last result.
// A finished check that flips a file's found state calls `filesChanged`. `filesOf` reads the last results only, per
// build id the found files of the game's current kind in the kind's order, a build with none left out.
//
// `saveLog` and `download` answer `{ ok: true }` once the save is in the slot as `running`, or a `{ problem }` that
// starts nothing: a backend without `saveLog`, or a save of the same id still running. The save then picks a free name
// in `downloadsDir`, reserved so two saves never take one, ends `saved` (revealing the file) or `failed` with the
// error's text, and leaves the slot `DOWNLOAD_KEEP_MS` after it ended. Made over a slot a restart left, it fails each
// running save and gives each ended one a fresh `DOWNLOAD_KEEP_MS`. After `dispose`, nothing settling writes, calls or
// reveals anything.
export interface Downloads {
  checkFiles(
    backendId: string,
    game: GameEntry,
    builds: readonly BuildRecord[],
  ): void;
  filesOf(
    backendId: string,
    game: GameEntry,
    builds: readonly BuildRecord[],
  ): Record<string, BuildFile[]>;
  forgetGame(backendId: string, gameId: string): void;
  saveLog(
    target: DownloadTarget,
    job: BuildJob | null,
    backend: BuildBackend,
  ): { ok: true } | { problem: string };
  download(
    target: DownloadTarget,
    file: BuildFile,
  ): { ok: true } | { problem: string };
  dispose(): void;
}

type SaveEnd = Pick<BuildDownload, 'state' | 'path' | 'problem'>;

interface Save {
  id: string;
  label: string;
  target: DownloadTarget;
  name: string; // the file name before ` (2)` and so on
  write(path: string): Promise<void>;
}

interface KeyedFile {
  key: string;
  file: BuildFile;
}

export function createDownloads(deps: DownloadsDeps): Downloads {
  // By file key, whether the key's last finished check found the file.
  const known = new Map<string, boolean>();
  // File keys whose `stat` has not settled.
  const checking = new Set<string>();
  const failedPaths = new Set<string>();
  const gaveUpPaths = new Set<string>();
  // The full paths of saves in flight.
  const reserved = new Set<string>();
  // By download id, the timer that deletes its ended entry.
  const expiries = new Map<string, number>();
  let isDisposed = false;

  for (const entry of deps.slot.all().values()) {
    if (entry.state === 'running') {
      end(entry, { state: 'failed', path: null, problem: RESTARTED_PROBLEM });
    } else {
      expireLater(entry.id);
    }
  }

  function keyedFilesOf(
    backendId: string,
    game: GameEntry,
    build: BuildRecord,
  ): KeyedFile[] {
    if (!Object.hasOwn(game.kinds, build.kind)) {
      return [];
    }
    return filledFiles(game.kinds[build.kind], build).map((file) => ({
      key: `${gameKeyPrefix(backendId, game.id)}${build.id}\n${file.entry}\n${file.path}`,
      file,
    }));
  }

  function forgetKeys(prefix: string, kept: ReadonlySet<string>) {
    for (const key of known.keys()) {
      if (key.startsWith(prefix) && !kept.has(key)) {
        known.delete(key);
      }
    }
  }

  async function check(key: string, path: string) {
    checking.add(key);
    let hasGivenUp = false;
    const timeout = deps.timers.set(() => {
      hasGivenUp = true;
      if (!isDisposed) {
        logOnce(
          gaveUpPaths,
          path,
          `file check gave up after ${FILE_CHECK_TIMEOUT_MS} ms: ${path}`,
        );
      }
    }, FILE_CHECK_TIMEOUT_MS);
    let isFound = false;
    let failure: unknown = null;
    try {
      const stat = await deps.files.stat(path);
      isFound = stat !== null && !stat.isFolder;
    } catch (error) {
      failure = error;
    }
    checking.delete(key);
    if (hasGivenUp) {
      return;
    }
    deps.timers.clear(timeout);
    if (isDisposed) {
      return;
    }
    if (failure !== null) {
      logOnce(
        failedPaths,
        path,
        `file check failed: ${path}: ${errorText(failure)}`,
      );
    }
    const wasFound = known.get(key);
    if (wasFound === undefined || wasFound === isFound) {
      return;
    }
    known.set(key, isFound);
    deps.filesChanged();
  }

  function logOnce(logged: Set<string>, path: string, message: string) {
    if (!logged.has(path)) {
      logged.add(path);
      deps.log(message);
    }
  }

  function start(save: Save): { ok: true } | { problem: string } {
    if (deps.slot.get(save.id)?.state === 'running') {
      return { problem: 'that download is already running' };
    }
    const pending = expiries.get(save.id);
    if (pending !== undefined) {
      deps.timers.clear(pending);
      expiries.delete(save.id);
    }
    const entry: BuildDownload = {
      id: save.id,
      backendId: save.target.backendId,
      buildId: save.target.build.id,
      label: save.label,
      state: 'running',
      path: null,
      problem: null,
      startedAt: deps.clock.now(),
    };
    deps.slot.set(entry.id, entry);
    void run(entry, save);
    return { ok: true };
  }

  async function run(entry: BuildDownload, save: Save) {
    let path: string | null = null;
    let ended: SaveEnd;
    try {
      path = await reserveFreePath(save.name);
      if (isDisposed) {
        return;
      }
      await save.write(path);
      ended = { state: 'saved', path, problem: null };
    } catch (error) {
      ended = { state: 'failed', path: null, problem: errorText(error) };
    } finally {
      if (path !== null) {
        reserved.delete(path);
      }
    }
    if (isDisposed) {
      return;
    }
    end(entry, ended);
    if (ended.path !== null) {
      reveal(ended.path);
    }
  }

  // The first of `name`, `<stem> (2)<ext>`, `<stem> (3)<ext>`, … that nothing in the Downloads folder holds and no
  // save in flight reserved, reserved in the step its `stat` settles in.
  async function reserveFreePath(name: string): Promise<string> {
    for (let copy = 1; ; copy += 1) {
      const path = deps.paths.join(deps.downloadsDir, numberedName(name, copy));
      const stat = await deps.files.stat(path);
      if (stat === null && !reserved.has(path)) {
        reserved.add(path);
        return path;
      }
    }
  }

  function end(entry: BuildDownload, ended: SaveEnd) {
    deps.slot.set(entry.id, { ...entry, ...ended });
    expireLater(entry.id);
  }

  function expireLater(id: string) {
    const handle = deps.timers.set(() => {
      expiries.delete(id);
      if (!isDisposed) {
        deps.slot.delete(id);
      }
    }, DOWNLOAD_KEEP_MS);
    expiries.set(id, handle);
  }

  function reveal(path: string) {
    try {
      deps.revealPath(path);
    } catch (error) {
      deps.log(`reveal failed: ${path}: ${errorText(error)}`);
    }
  }

  return {
    checkFiles(backendId, game, builds) {
      const checked = builds.flatMap((build) =>
        keyedFilesOf(backendId, game, build),
      );
      forgetKeys(
        gameKeyPrefix(backendId, game.id),
        new Set(checked.map(({ key }) => key)),
      );
      for (const { key, file } of checked) {
        if (!known.has(key)) {
          known.set(key, false);
        }
        if (!checking.has(key)) {
          void check(key, file.path);
        }
      }
    },
    filesOf(backendId, game, builds) {
      const files: Record<string, BuildFile[]> = {};
      for (const build of builds) {
        const found = keyedFilesOf(backendId, game, build)
          .filter(({ key }) => known.get(key) === true)
          .map(({ file }) => file);
        if (found.length > 0) {
          files[build.id] = found;
        }
      }
      return files;
    },
    forgetGame(backendId, gameId) {
      forgetKeys(gameKeyPrefix(backendId, gameId), new Set());
    },
    saveLog(target, job, backend) {
      const saveLog = backend.saveLog?.bind(backend);
      if (!backend.capabilities.saveLog || saveLog === undefined) {
        return { problem: 'this backend cannot save logs' };
      }
      const { backendId, game, build } = target;
      return start({
        id: `${backendId}/${build.id}/log${job === null ? '' : `/${job.id}`}`,
        label: job?.label ?? 'build',
        target,
        name: savedLogName(game, build, job?.label ?? null),
        write: (path) => saveLog(game, build.id, job?.id ?? null, path),
      });
    },
    download(target, file) {
      return start({
        id: `${target.backendId}/${target.build.id}/file/${file.entry}`,
        label: file.label,
        target,
        name: deps.paths.base(file.path),
        write: (path) => deps.files.copy(file.path, path),
      });
    },
    dispose() {
      isDisposed = true;
    },
  };
}

// The start of every file key of the game: `<backend id>\n<game id>\n`.
function gameKeyPrefix(backendId: string, gameId: string): string {
  return `${backendId}\n${gameId}\n`;
}

// `template` with `{version}` and `{number}` filled from `build`; null when it holds one the build lacks.
function filledPath(template: string, build: BuildRecord): string | null {
  const values: Record<string, string | null> = {
    version: build.version,
    number: build.number,
  };
  let isLacking = false;
  const path = template.replace(
    /\{(version|number)\}/g,
    (_placeholder, name: string) => {
      const value = values[name];
      isLacking ||= value === null;
      return value ?? '';
    },
  );
  return isLacking ? null : path;
}

// Every run of characters other than ASCII letters and digits as one `-`, with no `-` at either end.
function fileNamePart(text: string): string {
  return text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// `name` for the first copy, else `<stem> (<copy>)<ext>`, `<ext>` running from the last `.` past the first character.
function numberedName(name: string, copy: number): string {
  if (copy === 1) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${stem} (${copy})${ext}`;
}
