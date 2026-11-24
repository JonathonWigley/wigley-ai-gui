# 05 — Builds main: files, saves and downloads

Status: not started
Type: Task
Rung: deep · async state across polls, timers and a part restart: saves in flight, the slot's expiry, file checks beside the poll
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
export const FILE_CHECK_TIMEOUT_MS = 5000;
// Every entry of the kind's `downloads` whose placeholders the build fills, in the kind's order. Not yet checked on disk.
export function filledFiles(kind: BuildKindEntry, build: BuildRecord): BuildFile[];
export function savedLogName(game: GameEntry, build: BuildRecord, jobLabel: string | null): string;
export interface DownloadsDeps {
  files: Files; paths: Paths; clock: Clock; timers: Timers;
  downloadsDir: string; revealPath(path: string): void;
  slot: KeyedSlotWriter<BuildDownload>; log(message: string): void;
  filesChanged(): void; // a finished check changed what `filesOf` gives
}
export interface DownloadTarget { backendId: string; game: GameEntry; build: BuildRecord; }
export interface Downloads {
  checkFiles(backendId: string, game: GameEntry, builds: readonly BuildRecord[]): void;
  filesOf(backendId: string, game: GameEntry, builds: readonly BuildRecord[]): Record<string, BuildFile[]>;
  forgetGame(backendId: string, gameId: string): void;
  saveLog(target: DownloadTarget, job: BuildJob | null, backend: BuildBackend): { ok: true } | { problem: string };
  download(target: DownloadTarget, file: BuildFile): { ok: true } | { problem: string };
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
  `build.version` and every `{number}` by `build.number`, and `entry` its index in the kind's `downloads`. A template
  that holds `{version}` while `build.version` is null, or `{number}` while `build.number` is null, gives no file, and
  the entries after it keep their own indexes. Any other `{…}` text stays as written. `~` is already expanded (task
  02).
- **File checks** (plan.md § Pinned values). They run beside the poll and never hold it.
  - A file's key is `<backend id>\n<game id>\n<build id>\n<entry>\n<filled path>`. Two maps: `known` (key → the
    `BuildFile` and whether its last finished check found it) and `checking` (keys whose `stat` has not settled).
  - `checkFiles(backendId, game, builds)` is synchronous. For each build, the kind is `game.kinds[build.kind]`; a build
    of a kind the game does not declare has no files. It first deletes from `known` every key of that backend and game
    not among this call's keys: a build that left the list, or a template the settings changed. Each new key enters
    `known` as not found. Then it starts a `stat` of each of this call's keys not in `checking`, all at once.
  - A path is a file when `files.stat(path)` gives a non-null stat with `isFolder` false. A `stat` that rejects counts
    as not found, and logs `file check failed: <path>: <error text>` once per path for the part's life.
  - Each `stat` gives up after `FILE_CHECK_TIMEOUT_MS` (a `timers.set`, cleared when the stat settles first). A check
    that gives up keeps the key's last result and logs `file check gave up after 5000 ms: <path>` once per path for the
    part's life. Its key stays in `checking` until its `stat` settles, so a stalled mount gets no second `stat` of
    that path stacked on the first; the late result is dropped, and the next poll checks the path again.
  - A `stat` that settles in time writes its result only when its key is still in `known`. When that flips the key's
    found state, it calls `deps.filesChanged()`. An unchanged result calls nothing.
  - A found file is checked again on every poll, so a deleted file leaves the list after the check that misses it.
  - `filesOf(backendId, game, builds)` reads `known` only and starts nothing: per build, the keys of `filledFiles` for
    the game's current kind whose last check found them, in the kind's order. The result holds a key only for a build
    with at least one file. Since the key holds the filled path, a template the settings changed shows no file until
    the next poll checks the new path.
  - `forgetGame(backendId, gameId)` deletes that game's keys from `known`.
  - After `dispose()`, a settling `stat` writes nothing and calls nothing.
- **The file entry.** The `download` channel's `file` is a `BuildFile.entry`. The handler finds the file in
  `downloads.filesOf(...)[build]` whose `entry` equals it; none (out of range, or the last check did not find it)
  refuses `no file <file> for build <build>`.
- **Save names.**
  - A log: `savedLogName(game, build, job?.label ?? null)` gives `<game label>-<kind label>-<number>-<job label>.log`.
    Each part has every run of characters other than ASCII letters and digits replaced by one `-`, and leading and
    trailing `-` dropped. A null `number` is the part `build-<build id>`, sanitized the same way. A null job label is
    the part `build`. A part that is empty after the sanitizing is left out with its `-`. The kind label is
    `kindLabel(game, build.kind)` from `builds-model.ts`.
  - A file: `paths.base(file.path)`.
  - Candidates: `<name>`, `<stem> (2)<ext>`, `<stem> (3)<ext>`, … `<ext>` is the text from the name's last `.` (a `.`
    at index 0 does not count); a name with no `.` has an empty `<ext>`.
  - **The pick.** A `reserved` set holds the full paths of saves in flight. For each candidate in order, await
    `files.stat(paths.join(downloadsDir, candidate))`; then, in the same synchronous step after that `await` with no
    other `await` between, if the stat is null and `reserved` lacks the path, add it to `reserved` and take it; else
    try the next candidate. So two saves started together never take one name. A `stat` that rejects makes the pick
    throw. The reservation is deleted when its save ends, saved or failed.
- **A save's life** (`saveLog`, `download`). The id is `<backend id>/<build id>/log` for a null job,
  `<backend id>/<build id>/log/<job id>` for a job, or `<backend id>/<build id>/file/<entry>`.
  1. Refusals, in this order, each starting nothing: `saveLog` with a backend that has no `saveLog` →
     `{ problem: 'this backend cannot save logs' }`; a slot entry for the id in state `running` →
     `{ problem: 'that download is already running' }`.
  2. Otherwise it sets the entry `{ id, backendId, buildId, label, state: 'running', path: null, problem: null, startedAt: clock.now() }`
     and returns `{ ok: true }` at once. `label` is the job's label, `build` for a null job, or the file's label.
  3. Then one async body runs in one `try`: the pick, then `await backend.saveLog(game, build.id, job?.id ?? null, <full path>)`
     or `await files.copy(file.path, <full path>)`. The call runs inside the async body, so a `saveLog` that throws
     synchronously lands in the same `catch` as a rejection.
  4. Success: delete the reservation, set the entry `saved` with `path`, then call `revealPath(path)` in its own
     `try`: a throw logs `reveal failed: <path>: <error text>` and leaves the entry `saved`. Failure (a pick that
     throws, a `stat` that rejects in the pick, a `saveLog` that throws or rejects, a `copy` that rejects): delete the
     reservation if one was taken, set the entry `failed` with `problem: errorText(error)` (`src/shared/error-text.ts`),
     and reveal nothing.
  5. Once it ended, a `timers.set` of `DOWNLOAD_KEEP_MS` deletes the entry, but only when the slot still holds the
     entry with that `startedAt`: a new save of the same id after a failure keeps its own entry.
  - A save of an id whose entry is `saved` or `failed` starts again and replaces the entry.
- **Restart.** Checked in the core: `PluginSwitch.restart` and a catalog reload stop the main part as a `restart` and
  do not clear its slots; `plugin-switch.ts` calls `slots.clearOwner` only in `stopWithheld`, `stopAsRemoved` and
  `switchOff`, and a slot's value outlives its writer (`slot-store.ts`). So after a restart or reload the new part's
  `api.state.publish(buildsDownloadsSlot)` holds the old entries; after a switch-off, a withhold or a removal the
  plugin starts again with the slot empty. Slots live in memory only, so an app quit loses them. `createDownloads`
  reads the slot: each entry in state `running` is set `failed` with
  `problem: 'the builds plugin restarted during the save'`, and each ended entry gets a fresh `DOWNLOAD_KEEP_MS` timer.
- **Stop.** `dispose()` sets a flag first. A save or `stat` that settles after it writes nothing to the slot, calls
  nothing and reveals nothing. The plugin's timers clear on stop.
- **Wiring** (`start.ts`).
  - `const downloads = createDownloads({ files: services.files, paths: services.paths, clock, timers: services.timers, downloadsDir: services.downloadsDir, revealPath: (path) => services.revealPath(path), slot: api.state.publish(buildsDownloadsSlot), log, filesChanged: () => fold() })`.
    `fold` already does nothing before ready or after stop. `dispose` of the part calls `downloads.dispose()` through
    the existing `callEach` list.
  - In `poll`, after `readSubjects(lists)` and its `isCurrent()` check, call `downloads.checkFiles(backendId, game, builds)`
    for each list before the records loop. Nothing is awaited.
  - `backendStates()` passes `files: downloads.filesOf(backend.id, game, gameRecords?.builds ?? [])` where task 02 put
    `{}`. `GameRecords` holds no files.
  - `keepRecordsOf` calls `downloads.forgetGame(backendId, gameId)` for each game it drops.
  - A settings change (`apply`) needs nothing more: `backendStates()` reads the current game, so a changed template's
    old file drops at the next fold and the new path's file shows after the next poll's check.
  - Channel handlers `saveLog` and `download` resolve the arg against `parsed`, `live` and `records`, and answer
    these refusals, verbatim, in this order, before they call `downloads`:
    `no backend <backend>` · `<backend label>: still starting` (no instance) · `no game <game> in <backend label>` ·
    `no build <build> in <game label>` (not in the game's last listed builds) · `no job <job> in build <build>`
    (`saveLog` with a job id the build's `jobs` lacks) · `no file <file> for build <build>` (`download`, per The file
    entry above). Then `downloads` gives its own two refusals.
  - `saveLog` passes the live `TrackedBackend` instance, so its call is tracked and a replaced instance refuses it.
- **The finish message** (`build-messages.ts`). `endedMessage` adds the line
  `Files: <label> <path> · <label> <path>` when `files` is not empty: after the `Links:` line and before the `Open:`
  line. The path is the full path, as agents read it, written as it is. `setEndedMessage` passes
  `files[build.id] ?? []` to each build's `endedMessage`. `messageOf` in `start.ts` takes a lookup of each game's files
  through `downloads.filesOf`.
- A build ends before Drive for desktop shows its zip in most runs, since the deploy job uploads it last and the mount
  syncs after. The finish message then holds no `Files:` line; the snapshot shows the file once it exists. Do not make
  the message wait.

GIVEN a Dev build `0.11.0.332` and the template `/d/builds/{version}/Dev/android_BashBest_{version}.{number}_android.zip`
WHEN `filledFiles` runs THEN the path is `/d/builds/0.11.0/Dev/android_BashBest_0.11.0.332_android.zip` with entry 0.
GIVEN a found file WHEN it is deleted and the next poll's check misses it THEN `filesOf` no longer has it.
GIVEN a missing file WHEN it appears and the next poll's check finds it THEN `filesOf` has it and `filesChanged` ran.
GIVEN a `stat` that never settles WHEN `FILE_CHECK_TIMEOUT_MS` passes THEN the file keeps its last result, and no
second `stat` of that path starts until the first settles.
GIVEN `x.zip` and `x (2).zip` in the Downloads folder WHEN a download of `x.zip` runs THEN it saves `x (3).zip`.
GIVEN two downloads of one name started together WHEN both settle THEN they saved `x.zip` and `x (2).zip`.
GIVEN a running download WHEN the same id starts again THEN it answers `that download is already running`.
GIVEN a save whose `revealPath` throws WHEN it settles THEN the entry is `saved` and the log holds `reveal failed: …`.
GIVEN a saved download WHEN `DOWNLOAD_KEEP_MS` passes THEN its slot entry is gone, and not one millisecond before.
GIVEN a build with a file WHEN it ends linked to a session THEN the message holds `Files: Android zip <path>` between
`Links:` and `Open:`.

Tests:
- `downloads.test.ts` (new; `describe('downloads')`), over `createMemoryFiles`, `posixPaths`, `fakeTimers()` and a
  slot writer the test reads back (use the part harness's slot or a small `KeyedSlotWriter` over a `Map`, whichever
  the builds tests already use). `stat` calls are counted, held on a deferred, or made to reject through a wrapper
  over the memory files.
  - `'filledFiles fills $case'` table: both placeholders (the GIVEN above, entry 0); `{number}` with a null number →
    `[]`; two templates, the first needing a null `{number}` → only the second, entry 1; no placeholder → the path
    unchanged; `{branch}` → kept as written.
  - `'savedLogName gives $expected'` table: `Tiki Smash`, `Dev`, number `332`, job `Build Android - Dev` →
    `Tiki-Smash-Dev-332-Build-Android-Dev.log`; number null, build id `821436` →
    `Tiki-Smash-Dev-build-821436-Build-Android-Dev.log`; job null → `Tiki-Smash-Dev-332-build.log`; local build id
    `demo/dev/1000`, number null, job null → `Demo-Dev-build-demo-dev-1000-build.log` (game label `Demo`).
  - `'checks every filled path on every poll'`: two `checkFiles` calls stat a found path twice; a file deleted
    between them leaves `filesOf`; a file written between them joins it.
  - `'calls filesChanged only when a check changes the files'`: called once when a path flips to found; not called
    by a second check with the same result.
  - `'gives up on a stalled stat and keeps the last result'`: a found file; the next `stat` held on a deferred; at
    `FILE_CHECK_TIMEOUT_MS` the file is still in `filesOf`, the give-up line is logged once, `filesChanged` not
    called; a third `checkFiles` starts no `stat` of the path; the deferred then resolves null and `filesOf` still
    has the file; a fourth `checkFiles` stats it again.
  - `'counts a rejecting stat as not found and logs once'`: two checks, one log line.
  - `'gives no files for a kind the game does not declare'`.
  - `'drops files when $case'` table: the build leaves the list (`checkFiles` without it); the kind's template
    changes (`filesOf` with the changed game gives nothing until a check of the new path); `forgetGame`.
  - `'writes nothing after dispose'`: a `stat` and a save that settle after `dispose()` leave `filesOf`, the slot and
    `revealPath` untouched, and `filesChanged` is not called.
  - `'gives the id $expected'` table: null job → `work/821436/log`; job `821432` → `work/821436/log/821432`; file
    entry 1 → `work/821436/file/1`.
  - `'saves under a free name: $case'` table: free → `x.zip`; `x.zip` and `x (2).zip` taken → `x (3).zip`; two
    downloads of different ids with one name started together → `x.zip` and `x (2).zip`; a name freed once its save
    ended → taken again by the next save; a log name with no clash → its `savedLogName`.
  - `'moves the entry from running to $state: $case'` table: copy succeeds → `saved`, `path` set, `revealPath`
    called once with it; source missing → `failed`, `problem` holds the source path, `revealPath` not called; backend
    `failSaveLogs(new Error('no access'))` → `failed`, `problem` `no access`; the pick's `stat` rejects
    `new Error('denied')` → `failed`, `problem` `denied`; a backend whose `saveLog` throws `new Error('sync')`
    synchronously → `failed`, `problem` `sync`; `revealPath` throws `new Error('no finder')` → `saved`, the log holds
    `reveal failed: <path>: no finder`.
  - `'refuses a second start while one runs'`: the first save waits on a deferred promise; the second answers the
    problem text and the backend's `savedLogs` holds one call; once the first ends, a third start answers `{ ok: true }`.
  - `'refuses a log save on a backend that cannot save logs'`.
  - `'deletes an ended entry after DOWNLOAD_KEEP_MS'`: present at `DOWNLOAD_KEEP_MS - 1`, gone at `DOWNLOAD_KEEP_MS`;
    a restart of the id before that keeps the new entry when the first timer runs.
  - `'fails a running entry left by a restart'`: seed the slot by hand, as the core leaves it after a restart (see
    Restart); an ended entry seeded beside it is deleted `DOWNLOAD_KEEP_MS` after `createDownloads`.
- `build-messages.test.ts`, rows added to the `'build messages'` table (line 66): an ended build with links, files and
  a `webUrl` puts `Files: Android zip /d/a.zip · iOS ipa /d/b.ipa` after `Links:` and before `Open:` (assert the
  whole message: agents parse it); an ended build with no files has no `Files:` line; a set's message carries each
  build's own files.
- `start.test.ts`, `'checks, downloads and reveals a build file through the channel'`: a fixture backend lists a
  finished build whose kind has a download template; the file exists in the harness's memory files; after a poll and
  its check the snapshot's game view has the file in `files` with entry 0; the channel's `download` with `file: 0`
  answers `{ ok: true }`; once settled the `builds.downloads` slot holds the entry `saved` with path
  `/home/Downloads/<file name>`, and the test's `revealPath` got that path.
- `start.test.ts`, `'refreshes the files after a settings change'`: change the kind's template through the setting;
  the next snapshot has no file for the build; after the next poll's check it has the new path's file.
- `start.test.ts`, one `it.each` `'refuses $case'` over every refusal, each asserting the verbatim answer: unknown
  backend → `no backend <id>`; a backend whose instance is not created yet → `<label>: still starting`; unknown
  game → `no game <id> in <label>`; unknown build → `no build <id> in Game`; `saveLog` with an unknown job →
  `no job <id> in build <build>`; `download` with an entry the last check did not find → `no file 0 for build <build>`;
  `download` with an entry past the kind's `downloads` → `no file 5 for build <build>`; `saveLog` on a backend with
  `saveLog: false` → `this backend cannot save logs`.

Done when: compiles; the test gate runs `downloads.test.ts`, `build-messages.test.ts` and `start.test.ts`.
Commit:    one commit for the group

## Proof

