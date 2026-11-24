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

const RESTARTED_PROBLEM =
  'the builds plugin restarted during the save; the file may still arrive';

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
// `checksSettled` resolves once every check of `builds`' files in flight has settled or given up. A path's failed or
// given-up check is logged once, until the path's next check that settles in time with no failure, or until no
// checked file holds the path.
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
  checksSettled(
    backendId: string,
    game: GameEntry,
    builds: readonly BuildRecord[],
  ): Promise<void>;
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
  // By file key, the file's path and whether the key's last finished check found it.
  const known = new Map<string, { path: string; isFound: boolean }>();
  // File keys whose `stat` has not settled.
  const checking = new Set<string>();
  // By file key, a wait that settles when the key's check in flight settles or gives up.
  const inFlight = new Map<string, Promise<void>>();
  const failedPaths = new Set<string>();
  const gaveUpPaths = new Set<string>();
  // The full paths of saves in flight.
  const reserved: string[] = [];
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
    pruneLoggedPaths();
  }

  // Drops each logged path that no checked file holds any more.
  function pruneLoggedPaths() {
    const held = new Set([...known.values()].map(({ path }) => path));
    for (const logged of [failedPaths, gaveUpPaths]) {
      for (const path of logged) {
        if (!held.has(path)) {
          logged.delete(path);
        }
      }
    }
  }

  function startCheck(key: string, path: string) {
    const settled = new Promise<void>((resolve) => {
      void check(key, path, resolve);
    });
    inFlight.set(key, settled);
    void settled.then(() => {
      if (inFlight.get(key) === settled) {
        inFlight.delete(key);
      }
    });
  }

  // `settled` runs once, when the `stat` settles or the check gives up, whichever comes first.
  async function check(key: string, path: string, settled: () => void) {
    checking.add(key);
    let hasGivenUp = false;
    const timeout = deps.timers.set(() => {
      hasGivenUp = true;
      settled();
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
    settled();
    if (isDisposed) {
      return;
    }
    if (failure === null) {
      failedPaths.delete(path);
      gaveUpPaths.delete(path);
    } else {
      logOnce(
        failedPaths,
        path,
        `file check failed: ${path}: ${errorText(failure)}`,
      );
    }
    const last = known.get(key);
    if (last === undefined || last.isFound === isFound) {
      return;
    }
    known.set(key, { path, isFound });
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
        reserved.splice(reserved.indexOf(path), 1);
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
      const isReserved = reserved.some((each) =>
        deps.paths.samePath(each, path),
      );
      if (stat === null && !isReserved) {
        reserved.push(path);
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
          known.set(key, { path: file.path, isFound: false });
        }
        if (!checking.has(key)) {
          startCheck(key, file.path);
        }
      }
    },
    filesOf(backendId, game, builds) {
      const files: Record<string, BuildFile[]> = {};
      for (const build of builds) {
        const found = keyedFilesOf(backendId, game, build)
          .filter(({ key }) => known.get(key)?.isFound === true)
          .map(({ file }) => file);
        if (found.length > 0) {
          files[build.id] = found;
        }
      }
      return files;
    },
    async checksSettled(backendId, game, builds) {
      const waits = builds.flatMap((build) =>
        keyedFilesOf(backendId, game, build).flatMap(
          ({ key }) => inFlight.get(key) ?? [],
        ),
      );
      await Promise.all(waits);
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
