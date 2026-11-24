# 05 — Builds main: files, saves and downloads

Status: not started
Type: Task
Rung: deep · async state across polls, timers and a part restart: saves in flight, the slot's expiry, the file cache
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/builds/main/downloads.ts`
- test `src/plugins/builds/main/downloads.test.ts`
- modify `src/plugins/builds/main/start.ts`
- test `src/plugins/builds/main/start.test.ts`
- modify `src/plugins/builds/main/build-messages.ts`
- test `src/plugins/builds/main/build-messages.test.ts`

Consumes:
- `Files.copy(from: string, to: string): Promise<void>`, `MainServices.downloadsDir: string`,
  `MainServices.revealPath(path: string): void` ← 01
- `BuildKindEntry.downloads`, `BuildDownloadEntry`, `BuildFile`, `GameView.files`, `GameState.files`,
  `BuildDownload`, `buildsDownloadsSlot`, `BuildBackend.saveLog?`, `BuildsChannel.invoke.saveLog`,
  `BuildsChannel.invoke.download`, `FixtureBackend.savedLogs`, `FixtureBackend.failSaveLogs` ← 02

Produces, in `src/plugins/builds/main/downloads.ts`:
```ts
export const DOWNLOAD_KEEP_MS = 10 * 60 * 1000;
export function filledFiles(kind: BuildKindEntry, build: BuildRecord): BuildFile[];
export function savedLogName(game: GameEntry, build: BuildRecord, jobLabel: string | null): string;
export interface DownloadsDeps {
  files: Files; paths: Paths; clock: Clock; timers: Timers;
  downloadsDir: string; revealPath(path: string): void;
  slot: KeyedSlotWriter<BuildDownload>; log(message: string): void;
}
export interface DownloadTarget { backendId: string; game: GameEntry; build: BuildRecord; }
export interface Downloads {
  existingFiles(backendId: string, game: GameEntry, builds: readonly BuildRecord[]): Promise<Record<string, BuildFile[]>>;
  saveLog(target: DownloadTarget, job: BuildJob | null, backend: BuildBackend): { ok: true } | { problem: string };
  download(target: DownloadTarget, index: number, file: BuildFile): { ok: true } | { problem: string };
  dispose(): void;
}
export function createDownloads(deps: DownloadsDeps): Downloads;
```
In `src/plugins/builds/main/build-messages.ts`:
```ts
export function endedMessage(game: GameEntry, build: BuildRecord, files: readonly BuildFile[]): string;
export function setEndedMessage(game: GameEntry, setRun: SetRun, builds: BuildRecord[], files: Record<string, BuildFile[]>): string;
```

Decisions:
- **Filling** (`filledFiles`). The kind's `downloads` in order, each `path` with every `{version}` replaced by
  `build.version` and every `{number}` by `build.number`. A template that holds `{version}` while `build.version` is
  null, or `{number}` while `build.number` is null, gives no file. Any other `{…}` text stays as written. `~` is
  already expanded (task 02).
- **File checks** (`existingFiles`). For each build, the kind is `game.kinds[build.kind]`; a build of a kind the game
  does not declare has no files. Each filled path is a file when `files.stat(path)` gives a non-null stat with
  `isFolder` false.
  - A found file is cached by the key `<backend id>\n<game id>\n<build id>\n<path>` and never stat'ed again.
  - A path not found is stat'ed again on every call.
  - A `stat` that rejects counts as not found, and logs `file check failed: <path>: <error text>` once per path for
    the part's life.
  - After each call, drop the cached keys of that backend and game whose build is not in `builds`.
  - The result holds a key only for a build with at least one file; its files keep the kind's order.
  - The stats of one call run at once (`Promise.all`).
- **The file index.** The `download` channel's `file` is the index into `GameView.files[build]` as main last
  published it. A build's files keep the kind's order, so a file found later can come before one found earlier.
- **Save names.**
  - A log: `savedLogName(game, build, job?.label ?? null)` gives `<game label>-<kind label>-<number>-<job label>.log`.
    Each part has every run of characters other than ASCII letters and digits replaced by one `-`, and leading and
    trailing `-` dropped. A null `number` is the part `build-<build id>`, sanitized the same way. A null job label is
    the part `build`. A part that is empty after the sanitizing is left out with its `-`. The kind label is
    `kindLabel(game, build.kind)` from `builds-model.ts`.
  - A file: `paths.base(file.path)`.
  - A free name: the first of `<name>`, `<stem> (2)<ext>`, `<stem> (3)<ext>`, … at which
    `files.stat(paths.join(downloadsDir, candidate))` is null and that no save in flight has taken. `<ext>` is the
    text from the name's last `.` (a `.` at index 0 does not count); a name with no `.` has an empty `<ext>`. The
    taken name is held until its save ends.
- **A save's life** (`saveLog`, `download`). The id is `<backend id>/<build id>/log/<job id or "build">` or
  `<backend id>/<build id>/file/<index>`.
  1. A slot entry for the id in state `running` refuses with `{ problem: 'that download is already running' }` and
     starts nothing. `saveLog` with a backend that has no `saveLog` refuses with
     `{ problem: 'this backend cannot save logs' }`.
  2. Otherwise it sets the entry `{ id, backendId, buildId, label, state: 'running', path: null, problem: null, startedAt: clock.now() }`
     and returns `{ ok: true }` at once. `label` is the job's label, `build` for a null job, or the file's label.
  3. It picks the free name, then runs `backend.saveLog(game, build.id, job?.id ?? null, <full path>)` or
     `files.copy(file.path, <full path>)`.
  4. On success it sets the entry `saved` with `path`, then calls `revealPath(path)`. On failure it sets the entry
     `failed` with `problem: errorText(error)` (`src/shared/error-text.ts`) and reveals nothing.
  5. Once it ended, a `timers.set` of `DOWNLOAD_KEEP_MS` deletes the entry, but only when the slot still holds the
     entry with that `startedAt`: a new save of the same id after a failure keeps its own entry.
  - A save of an id whose entry is `saved` or `failed` starts again and replaces the entry.
- **Restart.** `createDownloads` reads the slot: the core keeps slot values across a part restart. Each entry in
  state `running` is set `failed` with `problem: 'the builds plugin restarted during the save'`. Each ended entry gets
  a fresh `DOWNLOAD_KEEP_MS` timer.
- **Stop.** `dispose()` sets a flag first. A save that settles after it writes nothing to the slot and reveals
  nothing. The plugin's timers clear on stop.
- **Wiring** (`start.ts`).
  - `const downloads = createDownloads({ files: services.files, paths: services.paths, clock, timers: services.timers, downloadsDir: services.downloadsDir, revealPath: (path) => services.revealPath(path), slot: api.state.publish(buildsDownloadsSlot), log })`.
    `dispose` of the part calls `downloads.dispose()` through the existing `callEach` list.
  - `GameRecords` gains `files: Record<string, BuildFile[]>` (initially `{}` in `recordsOf`). In `poll`, after
    `readSubjects(lists)`, await `downloads.existingFiles(backendId, game, builds)` for every list at once, then make
    the existing `isCurrent()` check, then store each result in its `gameRecords.files`. `backendStates()` passes
    `gameRecords?.files ?? {}` where task 02 put `{}`.
  - Channel handlers `saveLog` and `download` resolve the arg against `parsed`, `live` and `records`, and answer
    these refusals, verbatim, before they call `downloads`:
    `no backend <backend>` · `<backend label>: still starting` (no instance) · `no game <game> in <backend label>` ·
    `no build <build> in <game label>` (not in the game's last listed builds) · `no job <job> in build <build>`
    (`saveLog` with a job id the build's `jobs` lacks) · `no file <file> for build <build>` (`download` with an
    index outside `files[build]`).
  - `saveLog` passes the live `TrackedBackend` instance, so its call is tracked and a replaced instance refuses it.
- **The finish message** (`build-messages.ts`). `endedMessage` adds the line
  `Files: <label> <path> · <label> <path>` when `files` is not empty: after the `Links:` line and before the `Open:`
  line. The path is the full path, as agents read it. `setEndedMessage` passes `files[build.id] ?? []` to each
  build's `endedMessage`. `messageOf` in `start.ts` takes a lookup of each game's files from `records`.
- A build ends before Drive for desktop shows its zip in most runs, since the deploy job uploads it last and the mount
  syncs after. The finish message then holds no `Files:` line; the snapshot shows the file once it exists. Do not make
  the message wait.

GIVEN a Dev build `0.11.0.332` and the template `/d/builds/{version}/Dev/android_BashBest_{version}.{number}_android.zip`
WHEN `filledFiles` runs THEN the path is `/d/builds/0.11.0/Dev/android_BashBest_0.11.0.332_android.zip`.
GIVEN a found file WHEN `existingFiles` runs a second time THEN the file is in the result and `stat` ran once for it.
GIVEN a missing file WHEN it appears before the next call THEN the next call has it.
GIVEN `x.zip` and `x (2).zip` in the Downloads folder WHEN a download of `x.zip` runs THEN it saves `x (3).zip`.
GIVEN a running download WHEN the same id starts again THEN it answers `that download is already running`.
GIVEN a saved download WHEN `DOWNLOAD_KEEP_MS` passes THEN its slot entry is gone, and not one millisecond before.
GIVEN a build with a file WHEN it ends linked to a session THEN the message holds `Files: Android zip <path>` between
`Links:` and `Open:`.

Tests:
- `downloads.test.ts` (new; `describe('downloads')`), over `createMemoryFiles`, `posixPaths`, `fakeTimers()` and a
  slot writer the test reads back (use the part harness's slot or a small `KeyedSlotWriter` over a `Map`, whichever
  the builds tests already use):
  - `'filledFiles fills $case'` table: both placeholders (the GIVEN above); `{number}` with a null number → `[]`;
    no placeholder → the path unchanged; `{branch}` → kept as written.
  - `'savedLogName gives $expected'` table: `Tiki Smash`, `Dev`, number `332`, job `Build Android - Dev` →
    `Tiki-Smash-Dev-332-Build-Android-Dev.log`; number null, build id `821436` →
    `Tiki-Smash-Dev-build-821436-Build-Android-Dev.log`; job null → `Tiki-Smash-Dev-332-build.log`; local build id
    `demo/dev/1000`, number null, job null → `Demo-Dev-build-demo-dev-1000-build.log` (game label `Demo`).
  - `'checks a file once it is found and a missing one every call'`: count `stat` calls through a recording wrapper.
  - `'drops a found file when its build leaves the list'`: a build listed, then not, then again is stat'ed again.
  - `'saves under a free name: $case'` table: free → `x.zip`; `x.zip` and `x (2).zip` taken → `x (3).zip`; two
    downloads of different ids with one name started together → `x.zip` and `x (2).zip`; a log name with no clash →
    its `savedLogName`.
  - `'moves the entry from running to $state'` table: copy succeeds → `saved`, `path` set, `revealPath` called once
    with it; source missing → `failed`, `problem` holds the source path, `revealPath` not called; backend
    `failSaveLogs(new Error('no access'))` → `failed`, `problem` `no access`.
  - `'refuses a second start while one runs'`: the first save waits on a deferred promise; the second answers the
    problem text and the backend's `savedLogs` holds one call; once the first ends, a third start answers `{ ok: true }`.
  - `'refuses a log save on a backend that cannot save logs'`.
  - `'deletes an ended entry after DOWNLOAD_KEEP_MS'`: present at `DOWNLOAD_KEEP_MS - 1`, gone at `DOWNLOAD_KEEP_MS`;
    a restart of the id before that keeps the new entry when the first timer runs.
  - `'fails a running entry left by a restart'`.
  - `'writes nothing after dispose'`: a save that settles after `dispose()` leaves the slot unchanged and reveals
    nothing.
- `build-messages.test.ts`, rows added to the `'build messages'` table (line 66): an ended build with links, files and
  a `webUrl` puts `Files: Android zip /d/a.zip · iOS ipa /d/b.ipa` after `Links:` and before `Open:` (assert the
  whole message: agents parse it); an ended build with no files has no `Files:` line; a set's message carries each
  build's own files.
- `start.test.ts`, one test `'checks, downloads and reveals a build file through the channel'`: a fixture backend
  lists a finished build whose kind has a download template; the file exists in the harness's memory files; after a
  poll the snapshot's game view has the file in `files`; the channel's `download` answers `{ ok: true }`; once
  settled the `builds.downloads` slot holds the entry `saved` with path `/home/Downloads/<file name>`, and the test's
  `revealPath` got that path. Plus `it.each` rows for two refusals: an unknown build → `no build <id> in Game`; a
  `saveLog` on a backend with `saveLog: false` → `this backend cannot save logs`.

Done when: compiles; the test gate runs `downloads.test.ts`, `build-messages.test.ts` and `start.test.ts`.
Commit:    one commit for the group

## Proof

