# Builds page redesign — plan

Feature: Builds · Implements: none · Ticket: none
Target: `main` of `JonathonWigley/wigley-ai-gui` (clone `~/Documents/wigley-ai-gui`), through the worktree `~/Documents/.worktrees/wigley-ai-gui-builds-redesign` (branch `builds-redesign`) · Written: 2026-11-24

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The user sees each build's dependency jobs in Builds mode and where each job is. The user saves any job's log to
disk, opens any job's own TeamCity page, and saves an Android build's zip from the Google Drive folder, all from the
app.

## Architecture

Systems touched, all in the app:

- **Core services**: `Files` gains `copy`. `MainServices` gains `downloadsDir` and `revealPath`.
- **`builds` contract**: `BuildJob` gains its link, times and direct prerequisites. `BackendCapabilities` gains
  `saveLog`. `BuildBackend` gains `saveLog`. A game kind gains `downloads`. The snapshot gains each build's files. A
  new keyed slot `builds.downloads` holds each download in flight or ended.
- **`builds-teamcity`**: reads the new job fields and the direct prerequisites in its one detail call, and saves a
  job's log through the CLI.
- **`builds-local`**: saves a run's log by copying its log file.
- **`builds` main**: fills each kind's download paths, checks which files exist, runs log saves and file downloads
  into the Downloads folder, reveals each saved file, and names the files in the finish message.
- **`builds` page and layout**: Builds mode becomes a build list beside a detail pane; the pane draws the selected
  build's jobs as a graph. The session hub's build gets an Open in Builds button.

## Preconditions

Each was run at plan time against the worktree's base (`eb81b65a`, the app's `origin/main`). `wigley:make` runs each again before the first
dispatch.

- `git -C ~/Documents/.worktrees/wigley-ai-gui-builds-redesign log -1 --format=%h` — the worktree exists on branch
  `builds-redesign`.
- `grep -n "DETAIL_FIELDS =" src/plugins/builds-teamcity/main/teamcity-backend.ts` — one hit; the
  detail call is one `teamcity api` GET per build.
- `grep -n "copy(" src/contracts/files.ts` — no hit: `Files` has no copy today.
- `grep -n "downloadsDir\|revealPath" -r src/contracts` — no hit.
- `grep -n "saveLog" -r src/plugins` — no hit.
- `teamcity api "/downloadBuildLog.html?buildId=821432" | wc -c` printed 22698452: the CLI returns a whole job log
  (Build Android - Dev) to stdout. `teamcity api "/app/rest/builds/id:821432/log"` fails.
- `teamcity api "/app/rest/builds/id:821436?fields=snapshot-dependencies(build(id,webUrl,startDate,finishDate,snapshot-dependencies(build(id))))"`
  returns each dependency's `webUrl`, its dates, and its own transitive dependency ids (7 dependencies for the
  Tiki Smash Dev chain 821436).
- The Deploy Android job's log names its Drive file:
  `zipfile: bash best/builds/0.11.0/Dev/android_BashBest_0.11.0.332_android.zip` (build 821433). The build number
  `0.11.0.332` parses to version `0.11.0` and number `332` through `parseBuildNumber`.
- The Drive mount `~/Library/CloudStorage/GoogleDrive-jonathon@peoplefun.com/My Drive` holds no `bash best` folder
  yet: the user adds it as a shortcut (task 09).

## Docs written ahead

Committed with this plan on branch `builds-redesign` (not live on `main` until the run lands):

- `docs/features/builds/design.md` — the new contract fields, `saveLog`, `downloads`, the detail pane
  and graph, the keys, the downloads slot and the session changes.
- `agent-plugin/skills/builds/SKILL.md` — a tracked game's `downloads`.
- `~/wigley-agents/machine-skills/teamcity-builds/SKILL.md`, in the `ai` repo — the Drive zip path of a New Games
  game kind. Landed on `ai` `main` ahead of this plan, its `downloads` advice marked planned in `redesign`.
- `DESIGN.md` — § Surfaces' Builds bullet (the split, the detail pane, the job graph, the job panel, the
  hub's Open in Builds) and § Icons and copy's exception for the `↓` and `↗` button labels.

## Mandatory Reads

- `AGENTS.md` § Architecture (A plugin, A registration, A slot, A command, A key, A focus target, An
  ambient service, A path, A layout, the layer check), § README, changelog and boundary, § Running and testing.
- `DESIGN.md` — every view task (06, 07).
- `docs/keymap.md` § Layers — tasks 07, 08.
- `docs/features/builds/design.md` — every task.
- `docs/features/layouts/design.md` — task 07.

## Design Overview

```
TeamCity CLI ──detail call──▶ teamcity backend ──BuildRecord (jobs: webUrl, times, dependsOn)──▶ builds main
local runs ─────────────────▶ local backend ─────────────────────────────────────────────────▶ builds main
                                                                                                   │
kind.downloads (path templates) ──fill {version} {number}, stat──▶ GameView.files ─────────────────┤
                                                                                                   ▼
                                                             builds.snapshot slot, builds.downloads slot
                                                                                                   │
page: list ◀─j/k─▶ detail pane ─Alt+l─▶ job graph (h/j/k/l)                                         │
        s: download the build's file      s: save job log ──channel saveLog──▶ backend.saveLog(path) ─┐
                                          o: open job webUrl                                          │
        channel download ──▶ Files.copy(drive file ▶ Downloads) ──────────────────────────────────────┤
                                                                       revealPath(saved file) ◀───────┘
```

**Decisions** (from the interview):

- The page is a build list beside a detail pane (round 1). The selected build's detail updates live.
- The detail pane draws the jobs as a graph: boxes left to right with arrows (round 1). Selecting a box shows its
  step, its Log button and its TeamCity link under the graph.
- Graph columns: a job's column is the length of its longest chain of prerequisites (a job with none sits in column
  0). Arrows join a job only to its direct prerequisites. Inside a column, jobs keep their order in `BuildRecord.jobs`.
- The graph scrolls sideways when the pane is narrower than the graph. Boxes do not shrink.
- Opening a build selects its first running job, else its first failed job, else the last job of the last column.
- Zips are read through the Google Drive for desktop folder (round 1). Each game kind lists `downloads`: a label and a
  path template. The app shows a file's button only once the file exists.
- Saved files go to the Downloads folder, and Finder (Explorer on Windows) opens on the file (round 1).
- Each job links to its own TeamCity page. Logs come through `teamcity api /downloadBuildLog.html?buildId=<id>`.
- Local builds save their logs too.
- Finished jobs show how long they ran.
- The session hub's build gets an Open in Builds button. The finish message names each available file's path
  (round 2).
- Keys: Alt+l moves from the build list into the graph; h/l step between columns and j/k within one; `s` saves the
  selected job's log; `o` opens its TeamCity page; on the build list `s` downloads the build's file and `o` opens the
  build (round 2).
- A running download is published by main in `builds.downloads`, so a page reload keeps it (round 2).

**Known risk**: a stalled Drive mount leaves each path's given-up `stat` pending (one per path, never more), and those can hold Node's four file-system threads until the mount answers; the poll and the snapshot keep running.

**Out of scope**: a live log tail; a Drive API sign-in; queueing changes; Release or Play uploads; the iOS IPA (the
pipeline uploads no iOS zip to Drive).

## File Structure

Every path is from the app repo's root unless it starts with `~/wigley-agents/` (the `ai` repo).

Shared names, defined once here; each task that produces one uses this exact shape.

```ts
// src/contracts/files.ts — on `Files`
// Copies the file at `from` to `to` by streaming, atomic through a temp file beside `to` as `write` is, creating
// missing parent folders of `to`. Replaces a file at `to`. Rejects when `from` is missing (isMissingFile) and for a
// folder at `from`.
copy(from: string, to: string): Promise<void>;

// src/contracts/plugin.ts — on `MainServices`
downloadsDir: string;          // the OS Downloads folder; `<homeDir>/Downloads` in the self-test and a drive run
revealPath(path: string): void; // shows the file in Finder or Explorer; logs and does nothing in the self-test and a drive run

// src/plugins/builds/contract.ts
export interface BuildJob {
  id: string; label: string; state: BuildState; result: BuildResult | null;
  percent: number | null; leftSeconds: number | null; stepText: string | null;
  webUrl: string | null;      // the job's own page in the backend
  startedAt: number | null;   // epoch ms
  finishedAt: number | null;  // epoch ms
  dependsOn: string[];        // ids of the jobs in the same build this job directly waits on
}
export interface BackendCapabilities { cancel: boolean; choosesBranch: boolean; saveLog: boolean; }
// on BuildBackend — present only when capabilities.saveLog is true. `jobId` null saves the build's own log.
saveLog?(game: GameEntry, buildId: string, jobId: string | null, path: string): Promise<void>;
export interface BuildDownloadEntry { label: string; path: string; } // path: `~` expanded, `{version}` and `{number}` filled
export interface BuildKindEntry { label: string; target: unknown; downloads: BuildDownloadEntry[]; }
export interface BuildFile { label: string; path: string; entry: number; } // a filled path that exists on disk; entry: its index in the kind's `downloads`
export interface GameView { /* existing fields */ files: Record<string, BuildFile[]>; } // build id → its files that exist
export interface BuildDownload {
  id: string;                 // `<backend id>/<build id>/log` (the build's own log), `<backend id>/<build id>/log/<job id>`, or `<backend id>/<build id>/file/<entry>`
  backendId: string; buildId: string;
  label: string;              // the job's label for a log, the file's label for a file
  state: 'running' | 'saved' | 'failed';
  path: string | null;        // the saved file, once saved
  problem: string | null;     // why it failed
  startedAt: number;          // epoch ms
}
export const buildsDownloadsSlot: KeyedSlotKey<BuildDownload, 'main', 'builds'>; // id 'builds.downloads', keyed by BuildDownload.id
export interface BuildsPlace { entry: string; build: string | null; job: string | null; } // task 07; build `<backendId>/<buildId>`
export const buildsPlaceSlot: SlotKey<BuildsPlace, 'page', 'builds'>; // id 'builds.place': a reload keeps the shown build and job
// on BuildsChannel.invoke
saveLog(arg: { backend: string; game: string; build: string; job: string | null }): Promise<{ ok: true } | { problem: string }>;
download(arg: { backend: string; game: string; build: string; file: number }): Promise<{ ok: true } | { problem: string }>; // file: a BuildFile.entry
```

Pinned values:

- A saved log's file name: `<game label>-<kind label>-<number>-<job label>.log`. Each part has every run of
  characters other than ASCII letters and digits replaced by one `-`, with leading and trailing `-` dropped. A null
  number is `build-<build id>`. A null job is `build`. Example: `Tiki-Smash-Dev-332-Build-Android-Dev.log`.
- A downloaded file keeps the source file's name.
- A name that already exists in the Downloads folder gets ` (2)`, ` (3)` and so on before its extension.
- A `downloads` template with `{version}` or `{number}` that the build lacks (null) gives no file for that build.
- A `BuildDownload` in state `saved` or `failed` is deleted from the slot 10 minutes after it ended.
- `GameView.files` holds, per build, the files whose last check found them, in the kind's `downloads` order. The
  checks run beside the poll and never hold it: each poll starts a `stat` of every filled path not already being
  checked, each `stat` gives up after 5 s, and a check that gives up keeps that file's last result. A file found once
  is checked again on every poll, so a deleted file leaves the list. A finished check publishes the snapshot again
  when it changed the list.
- `download`'s `file` is a `BuildFile.entry`: the file's index in its kind's `downloads`, which does not move when
  another file appears or goes. An entry whose file the last check did not find is refused.
- Main picks a saved file's free name and reserves it in the same synchronous step, so two saves started together
  never get one name; a reservation ends when its save ends.
- `saveLog` and `download` answer `{ ok: true }` once the entry is in `builds.downloads` as `running`; the outcome
  shows only in the slot. A refusal's text is pinned in task 05.
- `~` in a `downloads` path is expanded when the setting is parsed (task 02); task 05 fills `{version}` and `{number}`.
- A button that saves a file ends in `↓`; one that opens a backend page reads `<backend label> ↗`. No code names a vendor.

Existing files modified: see each task's Files line. New files:

- `src/plugins/builds/main/downloads.ts` (task 05) — the download runner and the file checks; justification: keeps
  `main/start.ts` (26k) from growing the async state of every download.
- `src/plugins/builds/page/job-graph.ts` (task 06) — the pure graph model; justification: the graph rules get one
  table-tested home.

Boundary rules: no backend names Google Drive. No code names a user's path or the `bash best` folder (the boundary
scan, `AGENTS.md` § README, changelog and boundary): the Drive path lives only in the user's `settings.json`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 02 → 05 → 07 → 08 → 10 → 11

### Wave 1
- [x] [Files copy, Downloads folder and reveal](01-core-services.md)
- [x] [Builds contract and config](02-builds-contract.md)

### Wave 2
- [x] [TeamCity jobs and log saves](03-teamcity-backend.md) — after 02
- [x] [Local log saves](04-local-backend.md) — after 01, 02
- [x] [Builds main: files, saves and downloads](05-builds-main.md) — after 01, 02
- [x] [Job graph model](06-job-graph-model.md) — after 02

### Wave 3
- [x] [Detail pane, graph view and keys](07-builds-page.md) — after 05, 06

### Wave 4
- [x] [Demo, self-test and README](08-demo-selftest.md) — after 07

### Wave 5
- [x] [Tiki Smash download paths](09-tiki-settings.md) — after 02
- [x] [Doc re-read](10-doc-re-read.md) — after 03, 04, 06, 08

### Wave 6
- [ ] [Final verification](11-final-verification.md) — after 10

## Run log

Review base: a9161d1a

### Groups
- 01 · hard · 53f0c0d3 · diff read against the task: Files.copy in contract, Node, memory, scoped and counting adapters; downloadsDir/revealPath on MainServices and both main.ts run kinds; wave 1 typecheck passes · concerns: Windows EPERM retry ~150ms on copy onto a folder; two long comments
- 02 · hard · 0eab3b94 · diff read: every Produces in plan.md's shape, parseDownloads texts, trackCalls saveLog, fixture savedLogs; fallout sites in teamcity-parse/backend tests, local-backend tests, page tests, queueing, build-messages, start tests; wave 1 typecheck passes; oxfmt applied to contract.ts by the lead · concerns: teamcity cache isJob does not check new job fields until 03; channel handlers for saveLog/download wait for 05
- 03 · hard · 719c1032 · diff read: buildJobOf fills webUrl/startedAt/finishedAt, parseChainDetail reduces listed snapshot deps to direct prerequisites, DETAIL_FIELDS verbatim, saveLog via downloadBuildLog.html (300 s), capabilities.saveLog true, isJob checks the new fields; wave 2 typecheck, oxfmt and oxlint pass · concerns: satisfies typing on the dependsOn table and saveLog?.() calls checked by the wave compile (pass)
- 04 · standard · 24abf5d0 · diff read: saveLog outside chain, refusal order build then job, missing log names build and path, other copy errors pass through, capabilities saveLog true; wave 2 typecheck passes · concerns: test assigns files.copy to a mock (compiles); success row relies on memory read returning the written text
- 06 · hard · cdb2b1c3 · diff read: JobEdge, JobGraph, GraphMove, jobGraph, defaultJob, movedJob in plan shape; three it.each tables; wave 2 typecheck passes · concerns: design.md:285 says arrows run from a job to its prerequisites, 07 draws them prerequisite to dependent
- 05 · deep · 8183fa1d · diff read: downloads.ts exports filledFiles, savedLogName, createDownloads, DOWNLOAD_KEEP_MS, FILE_CHECK_TIMEOUT_MS; start.ts wires checkFiles, filesOf, forgetGame, dispose and the saveLog/download handlers with refusals; Files: line between Links: and Open:; wave 2 typecheck and oxlint pass; oxfmt applied by the lead to build-messages.ts and downloads.test.ts · concerns: settings-change test reads the snapshot right after pushSettings with no settle
- 07 · deep · 0e2453f2 · diff read: BuildsPlace and buildsPlaceSlot, the six view-model functions, BuildsScope, BuildsView and BuildsViewDeps members present in the task's shape; openDetail, buildDetail and BuildDetailInput gone; wave 3 typecheck and oxlint pass; oxfmt applied by the lead to six files · concerns: restore of entry 'all' on an empty first snapshot overwrites the saved build with null; a pending place holds writes until a named move (a removed game keeps writes blocked); setFilter drops no pending place; job boxes carry ui-row--action; requestAnimationFrame stubbed in tests so arrows are live-only; divergence: part harness gains focusTarget(), view model exports fileBaseName
- 08 · hard · 58e1dca1 · diff read: Sample CI saveLog true, sky-104 download and file, sky-105 five jobs, selectBuild beat; fixture saveLog and three-job moving build, loaded in drive runs; graph, saves and narrow self-test groups; README and CHANGELOG; writeHomeFile and selectBuild Produces present; wave 4 typecheck and full npm run lint pass (changelog and boundary included) · concerns: self-test steps assume view behaviour not run yet (keys after Enter, default cursors) — the filtered self-test settles them; design.md:150 still calls the fixture self-test only (task 10's doc)
- 09 · standard · none (user settings.json, outside the repo) · grep of settings.json: dev, qa and release kinds of tiki-smash each hold label, target and the task's downloads path; json.load passes · concerns: the shared bash best folder still needs a My Drive shortcut before the paths exist (wrap-up note)
- 10 · standard · 0094c0e2 · diff read: design.md arrow direction, fixture in drive runs, Enter/Alt+l and no-job s/o lines match keymap.ts, start.ts and fixture-backend.ts; other docs checked unchanged · concerns: machine skill teamcity-builds line-56 planned mark drops in an ai worktree after the app lands (close step); Drive fetch-on-copy and DESIGN.md fg-tertiary step text unverified
### Contract changes
- Review fix b7dd1da7: GameView gains listed: boolean (true once the entry's current instance listed the game); GameState.hasListed renamed listed; Downloads gains checksSettled
### Rulings
- Node temp name extracted into tempFileBeside, shared by write and copy — one temp-name rule — none if wrong, write unchanged · group 01
- buildJobOf puts the four new fields in its shared base object, which 03 fills per row — one site — none · group 02
- fixture/test literals left untyped JSON (gameSetting, validGame) keep downloads optional — they feed parseBackends — none · group 02
- defaultJob skips repeated job ids as jobGraph does · group 06
- Arrow direction: 07's prerequisite-to-dependent arrowhead stands; task 10 corrects design.md:285 · group 06
- A restarted id clears its pending expiry timer rather than checking startedAt when it fires · group 05
- No instance refuses '<label>: <problem ?? still starting>', as queueing answers · group 05
- A save whose name pick settles after dispose starts no backend call or copy · group 05
- Split end pane holds div.builds-detail-holder (tabIndex -1) around the layout's builds-detail-pane; focus and is-pane-inactive act on the holder · group 07
- Stacked split shares height evenly (minmax(0,1fr) twice) instead of the shared fit-content(40%) 1fr, so a long list does not press the graph · group 07
- download drops the pending branch picker before opening the file picker · group 07
- showBuild moves keys to list before showing, so a hub Open in Builds logs no 'gone' · group 07
- Review fix: trackCalls refuses saveLog after dispose but leaves it out of drained (overrides 02's 'drained waits for it'); the saved place restores only once its game (All: every game) is listed, and a saved game gone from a polled snapshot drops the hold
- Repeat (saved All place restores early): mechanism is BackendView.problem, a joined heading text, used as the will-not-list state; fixes stacked 4aaa350d, b7dd1da7, 3ea8b304. Stepped back to one never-lists signal that excludes a backend with a live or starting instance; Leave it once fixed.
### Review rounds
- Round 1 (a9161d1a..43060941, 5 lanes): NEEDS FIXES — 3 Important, 19 Minor, 8 recommendations, all taken per repo § Review. Lead-applied 9445a61f (docs/comments). Fix range 992fd4cf, 4aaa350d, b7dd1da7 — risk Medium (restore rule, drain membership, end-message timing, download resolution change behaviour across main and page) → correctness re-review
- Re-review 1 (9445a61f..b7dd1da7, correctness): NEEDS FIXES — 1 Important (repeat of R1#2: All restore waits on a backend that never lists), 4 Minor, 1 pre-existing; lead-applied ff78daba. Repeat stepped back to the cause: the restore rules read BackendView.problem as the 'will not list' signal (repo § Review takes the recommendation)
- Cycle 2 fix range 3ea8b304, 0927df9c — risk Medium (restore settle rule, checksSettled re-check, cache file shape) → correctness re-review 2 (last cycle)
- Re-review 2 (ff78daba..0927df9c, correctness): NEEDS FIXES — 1 Important repeat (All restore reads the joined heading problem as never-lists), 2 Minor (drop rule, same proxy; a wait row that cannot fail). Cycles used up; settled per repo § Review: all three Fix now in the last fix round, with one never-lists signal.
### Test gate
