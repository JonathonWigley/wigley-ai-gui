# 07 — Detail pane, graph view and keys

Status: not started
Type: Task
Rung: deep · crosses the page reload restore (the `builds.place` slot), the async channel answers of `saveLog` and `download`, and main's `builds.downloads` slot
Wave: 3 · Depends on: 05, 06
Plan: [plan.md](plan.md)

All paths are from the repo root.

Files:
- modify `src/plugins/builds/page/builds-view.ts`
- modify `src/plugins/builds/page/builds-view-model.ts`
- modify `src/plugins/builds/page/start.ts`
- modify `src/plugins/builds/page/session-parts-model.ts`
- modify `src/plugins/builds/page/layout/read-builds-layout.ts`
- modify `src/plugins/builds/page/builds.css`
- modify `src/plugins/builds/layouts/layout.d.ts`
- modify `src/plugins/builds/layouts/default/layout.js`
- modify `src/plugins/builds/layouts/default/layout.css`
- modify `src/plugins/builds/manifest.ts`
- modify `src/plugins/builds/contract.ts`
- modify `src/plugins/keymap.ts`
- test `src/plugins/builds/page/builds-view-model.test.ts`
- test `src/plugins/builds/page/session-parts-model.test.ts`
- test `src/plugins/builds/page/start.test.ts`

Consumes:
- `BuildJob.webUrl`, `startedAt`, `finishedAt`, `dependsOn` · `BackendCapabilities.saveLog` · `BuildFile` · `GameView.files` ·
  `BuildDownload` · `buildsDownloadsSlot` ← 02 (plan.md File Structure)
- `BuildsChannel.invoke.saveLog(arg: { backend: string; game: string; build: string; job: string | null }): Promise<{ ok: true } | { problem: string }>` ← type 02, handler 05
- `BuildsChannel.invoke.download(arg: { backend: string; game: string; build: string; file: number }): Promise<{ ok: true } | { problem: string }>` ← type 02, handler 05 — `file` is a `BuildFile.entry`; main refuses an entry its last check did not find
- main publishes each `BuildDownload` in `builds.downloads` with the id shapes plan.md pins ← 05
- `BuildFile.entry` (the file's index in its kind's `downloads`) ← 02; main checks the files again on every poll, so a deleted file leaves `GameView.files` ← 05
- `jobGraph`, `defaultJob`, `movedJob`, `JobGraph`, `JobEdge`, `GraphMove` from `src/plugins/builds/page/job-graph.ts` ← 06
- `createSplit` (`src/shared/page/ui/split.ts`), `placeWrites` (`src/shared/page/place-slot.ts`), `services.uiState`,
  `services.timers`, `api.keys.anchor` (all exist)

Produces:
- `src/plugins/builds/contract.ts`:
  `export interface BuildsPlace { entry: string; build: string | null; job: string | null }` — `entry` a side-bar
  entry key, `build` a build key `<backendId>/<buildId>`, `job` a job id
  `export const buildsPlaceSlot: SlotKey<BuildsPlace, 'page', 'builds'>` — `{ id: 'builds.place', process: 'page', kind: 'value' }`
- `src/plugins/builds/manifest.ts`: the commands and the scope in the Commands table below; `openDetail` removed.
- `src/plugins/builds/layouts/layout.d.ts`: the parts and inputs in the Layout section below; `buildDetail` and
  `BuildDetailInput` removed.
- `src/plugins/builds/page/builds-view-model.ts`:
  `export function jobLineInputs(record: BuildRecord): JobLineInput[]` (replaces `buildDetailInput`)
  `export function buildHeaderInput(record: BuildRecord, view: GameView, backend: BackendView, downloads: ReadonlyMap<string, BuildDownload>, now: number): BuildHeaderInput` — `now` epoch ms, the view's `deps.now()` at each draw
  `export function jobGraphInput(record: BuildRecord, graph: JobGraph): JobGraphInput`
  `export function jobPanelInput(record: BuildRecord, jobId: string | null, view: GameView, backend: BackendView, downloads: ReadonlyMap<string, BuildDownload>): JobPanelInput`
  `export function downloadId(backendId: string, buildId: string, target: { log: string | null } | { file: number }): string` — `file` a `BuildFile.entry`
  `export function downloadStateInput(download: BuildDownload | undefined): DownloadStateInput | null`
- `src/plugins/builds/page/builds-view.ts`: `BuildsScope = 'games' | 'list' | 'graph'`; `BuildsView` gains
  `showBuild(arg: { backend: string; build: string }): boolean` (true when it found the build),
  `selectJob(jobId: string): void`, `downloadFile(entry: number): void` (`entry` a `BuildFile.entry`); `BuildsViewDeps` gains `uiState: UiState`, `timers: Timers`,
  `anchor: AnchorNamer<never>` (the type `createSplit` takes), `downloads(): ReadonlyMap<string, BuildDownload>`,
  `place: PlaceWrites<BuildsPlace>`, `restoredPlace: BuildsPlace | null`.

## Decisions

**The page** (plan.md round 1; DESIGN.md § Primitives, Split; § Space, size and shape, Breakpoints).
- The sheet holds one `createSplit` (axis `row`, sized pane `start`): the start pane holds the existing `main` pane
  (the head and the build list), the end pane the new detail pane. Limits: `initial: 480`, `min: 280`,
  `endMin: 360`. `stateKey: 'listWidth'`. Follow Backlog's `tableSplit` in
  `src/plugins/backlog/page/backlog-view.ts` (its `splitDeps`, its classes on the split element, its `dispose`).
- A narrow window stacks the two panes, the list above the detail, through the split's own `is-stacked` (640 px, or
  narrower than `min + endMin`). The view adds no breakpoint of its own.
- The detail pane always shows the list cursor's build. Moving the list cursor shows that build at once. With no
  list cursor (an empty list) it draws `detailEmpty`.
- The old inline detail goes: no part draws under a row, `detailKey` and `builds.openDetail` go, and the
  `builds-detail` class leaves the layout and its CSS.
- **Enter on the build list** (`builds.focusGraph`) gives the keys to the graph, as Alt+l does. This follows
  `docs/keymap.md` § Layers: Enter on a list opens the item and moves focus into it.

**The selected job.**
- The view holds one job cursor, for the shown build. When the shown build changes (another list cursor, a
  `showBuild`, a restored place), the cursor goes to `defaultJob(record.jobs, graph)`. When a snapshot redraws the
  same build, the cursor stays while its id is still among the jobs, else goes to `defaultJob`.
- A build with no jobs (the local backend's) draws no `jobGraph`. Its `jobPanel` shows the build itself: label the
  kind's label, the build's `stepText`, state and times, and its Log ↓ saves the build's own log (`job: null`).

**What redraws when.** `start.ts` calls the one `changed()` for `builds.snapshot`, `builds.sessions`,
`sessions.rows` and `builds.downloads`; each `changed()` redraws the detail pane by these rules:
- `buildHeader` and `jobPanel` redraw on every `changed()` while a build is shown, so the files, each download's
  state and a running job's percent, state and step text stay current. `jobPanel` also redraws on each job cursor move.
- `jobGraph` redraws when the shown build changes, or when `JSON.stringify(jobGraphInput(record, graph))` differs from
  the input of the last draw (a poll replaces the snapshot object every time, so the object is no test). An equal
  input keeps the drawn graph and only re-marks the boxes.
- A redraw of the same build keeps the graph's sideways scroll: the view reads the old `jobGraph` root's
  `scrollLeft` before it replaces the root and sets it on the new root once it is in the pane. A new shown build
  starts at `scrollLeft` 0.
- `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on the cursor's box runs after a new shown build and after
  a job cursor move, never after a same-build redraw, so a poll does not pull back a scroll the user made.
- `graph` holds the keys only while a build is shown. A redraw that changes the shown build's key, or leaves no build
  shown, while `graph` holds the keys calls `setFocus('list')` and logs `build <old build key> gone`.

**Focus and keys** (AGENTS.md § Architecture, A focus target, A resize target; `docs/keymap.md` § Layers, Alt+hjkl).
- Three base scopes: `games` (side bar), `list`, `graph`. `setFocus` sets the scope, then the resize target, then the
  focus target, as today. The resize target is the split while `list` or `graph` holds the keys, null for `games`.
- `setFocus` logs `focus <scope>` each time the scope changes (`focus graph`). The self-test waits on it (08).
- The DOM focus: `graph` focuses the detail pane element (`tabIndex = -1`), as `list` focuses `mainPane`. A
  `focusin` on the detail pane sets `graph` without moving focus, as the two other panes do, only while a build is
  shown; with none (a click on `detailEmpty`) it sets `list` without moving focus.
- The detail pane element carries `is-pane-inactive` while `graph` does not hold the keys, toggled in `markRows` beside
  `mainPane`'s (DESIGN.md: the pane without focus marks itself `is-pane-inactive`).
- The focus target's `move(direction)`:
  - `games`, `right`: to `list` (today's rule).
  - `list`, `right`: to `graph`. `list`, `down`: to `graph` only while the split element has `is-stacked`.
  - `graph`, `left`: to `list`. `graph`, `up`: to `list` only while the split element has `is-stacked`.
  - Every other move returns false, so the core goes on (Alt+h from the list still reaches the side bar).
- Moving into `graph` logs `graph on <build key> job <job id>` after `focus graph` (`job build` for a build with no
  jobs). With no build shown, `graph` is not entered: the move returns false and logs `no build under the cursor`.
- `focusMain` (the core's way back to main) restores the last of `list` or `graph` that held the keys, `list` at first.
- Graph moves: `builds.graphLeft` / `graphRight` / `graphUp` / `graphDown` run `movedJob` with `left` / `right` /
  `up` / `down`. A move that lands on a new job logs `job cursor on <job id>`, marks the boxes and redraws the
  `jobPanel`; a move that stays logs nothing. A build with no jobs logs `no jobs`.
- `builds.leaveGraph` (Esc) gives the keys back to `list`.

**Saving a log** (`s` in `builds.graph`, the job panel's `Log ↓` button; plan.md: saved files go to Downloads).
- `builds.saveLog` acts on the shown build and the job cursor (`job: null` for a build with no jobs). While a demo
  sample shows it logs `demo: saveLog does nothing` (the existing `isDemoBlocked`).
- A backend whose `capabilities?.saveLog` is not true toasts `<backend label> cannot save logs` (info) and invokes
  nothing.
- Else it logs `saving <download id>` and invokes `saveLog({ backend, game, build, job })`. A `{ problem }` answer
  logs `saveLog refused: <problem>` and toasts the problem (error); a rejection toasts its error text (the existing
  `toastProblem` and `toastFailure` shapes).
- The download's state comes only from `builds.downloads`: the page holds no state of its own for it.

**Downloading a file** (`s` in `builds.list`; a file button in the header).
- `builds.download` acts on the list cursor's build and its files, `view.files[record.id] ?? []`.
  - No file: toast `This build has no files to download` (info).
  - One file: download it (its `entry`).
  - Several: open the shared list picker (`picker.open`), title `Download a file`, one row per file's label, drawn
    through the `pickerRow` part as the queue picker's rows are; each row carries its file's `entry`, and choosing a
    row downloads that entry. The entry does not move when another file appears or goes, so a poll while the picker
    is open cannot pick the wrong file; a file gone by then is refused by main, and the refusal toasts as below. The
    picker's scope is the existing `builds.picker`.
- `builds.downloadFile` (a file button, arg the file's `entry`) downloads that entry of the shown build.
- A download logs `saving <download id>` and invokes `download({ backend, game, build, file: entry })`; its answers are
  handled as `saveLog`'s (`download refused: <problem>`). Demo-blocked as `download` and `downloadFile`.
- **Download ids**: `downloadId` returns `<backendId>/<buildId>/log/<job id>`, `<backendId>/<buildId>/log` for
  `{ log: null }` (the build's own log), and `<backendId>/<buildId>/file/<entry>` — plan.md's `BuildDownload.id` shapes.

**The downloads slot, as the page logs it.** The view reads `builds.downloads` through a new dep `downloads()`;
`start.ts` reads the slot and calls `changed()` on each change, as it does for `builds.snapshot`. The view logs one
line each time an entry it holds reaches a state it did not have at the last change it heard:
- `download <id> running`
- `download <id> saved <file name>` — the base name of `path`: the part after its last `/` or `\`, so a Windows path
  splits too (`Game-A-Dev-2-iOS-build.log`). `DownloadStateInput.fileName` is the same base name.
- `download <id> failed: <problem>`
Entries the slot holds when the view starts log nothing until they change. A deleted entry logs nothing.

**Opening links.** `builds.openJob` (`o` in `builds.graph`) opens the cursor job's `webUrl`; with none it toasts
`This job has no link in the backend` (info). For a build with no jobs it opens the build's `webUrl`, as `openWeb`
does, and with none toasts `openWeb`'s existing `This build has no link in the backend` (info). Demo-blocked as
`openJob`. `o` in `builds.list` stays `openWeb`.

**Open in Builds** (plan.md round 2). `view.showBuild({ backend, build })` returns whether it found the build:
- finds the game view holding the build in the shown snapshot; none: logs `no build <backend>/<build>`, toasts
  `The build is no longer listed` (info) and returns false.
- else shows that game's side-bar entry (as `selectEntry` does), puts the list cursor on the build, gives the keys to
  `list`, logs `shown build <build key>` and returns true. While the mode does not show (`deps.isShown()` false) it
  also sets a one-shot flag, `keepsListOnShow`; the view's `shown()` consumes it: with the flag set it clears it and
  calls `setFocus('list')` in place of `setFocus('games')`. Every other `shown()` resets to `games` as today. The view
  holds no mode handle and never shows the mode itself.
- It is not demo-blocked: it acts on nothing outside the page.
- `start.ts` owns the mode handle: its `showBuild` handler runs `if (view.showBuild(arg) && !mode.isShown())
  mode.show()`, so the mode shows only when the build was found.

**Reload keeps the place** (AGENTS.md § Architecture, A slot: `<id>.place`).
- `start.ts` publishes `buildsPlaceSlot` and wraps the writer in `placeWrites`, as Backlog's `start.ts` does, and
  hands the view the place read at start (`restoredPlace`) and the writes (`place`).
- The view writes `{ entry: selected, build: listCursor, job: jobCursor }` after every change of any of the three.
  It writes nothing while a demo sample shows.
- At start the view holds `restoredPlace` as pending, and while it is pending holds `place.hold()` (the same hold the
  demo sample takes), so a draw before the restore (an empty or first snapshot moving the cursors) never overwrites
  the saved place. Each `drawSnapshot` applies the pending place once the snapshot holds its `entry` (or `entry` is
  `all`): `selected = entry`; the list cursor goes to `build` when the list holds it; the job cursor to `job` when that
  build lists it, else `defaultJob`. Then the pending place drops. Any user move before that (a side-bar or list move,
  `selectEntry`, `selectBuild`, `showBuild`, a graph move) drops it too. Dropping it, either way, disposes the hold and
  writes the current place once. With `restoredPlace` null nothing is pending and no hold is taken. The scope is not
  restored: the mode shows on `games` as today.

**Clicks** (AGENTS.md § Architecture, A command: a view's own click handler runs the command a key would).
- A graph box's click runs `builds.selectJob` with the box's job id. The app attaches it to each element under the
  `jobGraph` root that carries `data-job-id`, with `rowAction` as rows get theirs.
- `selectJob(id)`: an id the shown build lacks logs `no job <id>`; else it moves the job cursor there, gives the keys
  to `graph` and logs `job cursor on <id>`.
- The header's file buttons run `builds.downloadFile` with the file's `entry`; the job panel's `Log ↓` runs `builds.saveLog`;
  every `↗` link runs the existing `builds.openLink` with its URL.

**Session hub** (plan.md round 2). `HubBuildInput` gains `backendId` and `buildId`. The default `hubBuild` draws an
`Open in Builds` button (`ghost`) in its actions row, running `builds.showBuild` with
`{ backend: backendId, build: buildId }`, always, links or not. `session-parts-model.ts` builds the hub's `jobs`
from `jobLineInputs(record)` and its `links` from `record.links.map((link) => ({ label: link.label, url: link.url }))`,
in place of `buildDetailInput(record)`.

## Commands, scope and keys

New manifest scope: `graph: 'In the Builds job graph'`. New commands, every one `runsIn: 'page'`:

| Command | Label | Group | Arg | Key (scope) |
|---|---|---|---|---|
| `focusGraph` | `show the build's jobs` | `list` | — | `<CR>` (`builds.list`), replacing `openDetail` |
| `download` | `download the build's file` | `list` | — | `s` (`builds.list`) |
| `leaveGraph` | `back to the builds` | `graph` | — | `<Esc>` (`builds.graph`) |
| `graphLeft` | `previous column` | `graph` | — | `h` (`builds.graph`) |
| `graphRight` | `next column` | `graph` | — | `l` (`builds.graph`) |
| `graphUp` | `previous job` | `graph` | — | `k` (`builds.graph`) |
| `graphDown` | `next job` | `graph` | — | `j` (`builds.graph`) |
| `saveLog` | `save the job's log` | `graph` | — | `s` (`builds.graph`) |
| `openJob` | `open the job in the backend` | `graph` | — | `o` (`builds.graph`) |
| `selectJob` | `select this job` | `graph` | `'string'` | click only |
| `downloadFile` | `download this file` | `list` | `'number'` | click only |
| `showBuild` | `show this build in Builds` | `list` | `{ backend: 'string', build: 'string' }` | click only |

- In `src/plugins/keymap.ts`: the binds above go in the `// ── Builds` block, `builds.list`'s `<CR>` now naming
  `builds.focusGraph`. `builds.graph` joins the `<C-n>` scope list beside `builds.list` (`docs/keymap.md` § Layers,
  Ctrl+n: every main view).
- `BuildsViewCommand` gains `focusGraph`, `download`, `leaveGraph`, `graphLeft`, `graphRight`, `graphUp`,
  `graphDown`, `saveLog`, `openJob`, and loses `openDetail`. `start.ts` wires `selectJob`, `downloadFile` and
  `showBuild` as it wires `selectBuild`.
- Update the manifest's header comment to name the new commands and the scope.

**Anchors** (AGENTS.md § Architecture, Key hints: every bind that is not one of vim's own keys has an anchor; `h`,
`j`, `k`, `l`, `<CR>` and `<Esc>` are vim's own, `src/shared/vim-keys.ts`). Each is a `kit.keyHint` in the part's
kit scope:

| Command | Scope | Where (default layout) | Option |
|---|---|---|---|
| `pickQueue` | `builds.games` | the `sideBar` part, at the bar's top, before the entries | `{ label: true, className: 'builds-hint' }` |
| `pickQueue` | `builds.list` | the `gameHeader` (exists) | as today |
| `openWeb` | `builds.list` | `buildHeader`, after its `<backend label> ↗` button (drawn while `webUrl` is null too) | none (a control hint) |
| `cancel` | `builds.list` | `buildHeader`'s actions, while `canCancel` | `{ label: true }` |
| `download` | `builds.list` | `buildHeader`, after the file buttons, while files is not empty | none |
| `saveLog` | `builds.graph` | `jobPanel`, after `Log ↓` | none |
| `openJob` | `builds.graph` | `jobPanel`, after the job's `↗` button | none |

`canCancel` is the backend's `capabilities?.cancel === true`, whatever the build's state, so the hint shows in the
self-test's state too (AGENTS.md: a target drawn only in some states is placed by a fixture state that builds it). A
press on a finished build keeps today's toast `The build has ended`.

## Layout

`layout.d.ts` changes (the parts' kit scopes: `detail`, `buildHeader` and `detailEmpty` in `builds.list`;
`jobGraph` and `jobPanel` in `builds.graph`). Rewrite the file's header comment for the new page: the split, the
detail pane's parts in order, the app's keys (as the Commands table above) and what the app keeps (below).

```ts
export interface DownloadStateInput {
  state: 'running' | 'saved' | 'failed';
  fileName: string | null; // the saved file's base name (after the last `/` or `\`), once saved
  problem: string | null;  // why it failed
}
export interface BuildFileInput {
  entry: number;  // the file's `BuildFile.entry`, the arg of `builds.downloadFile`
  label: string;
  download: DownloadStateInput | null; // this file's download, null with none in `builds.downloads`
}
// The shown build's head. `stepText` is not null only while the build lists no job. `subject` and `startsInMs` are
// read as `buildRowInput` reads them: `subject` from `view.subjects` through `revision`, `startsInMs` null while
// `startEstimate` is null, else `Math.max(0, startEstimate - now)`.
export interface BuildHeaderInput {
  gameLabel: string; kindLabel: string; number: string | null; version: string | null;
  branch: string; shortRevision: string | null; subject: string | null;
  state: 'queued' | 'running' | 'finished'; result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null; leftMs: number | null; startsInMs: number | null;
  stepText: string | null; statusText: string | null;
  backendLabel: string; webUrl: string | null;
  links: { label: string; url: string }[];
  files: BuildFileInput[];
  canCancel: boolean;
}
// One box. `durationMs` is `Math.max(0, finishedAt - startedAt)` once both are set (a clock skew gives 0), else null.
export interface JobBoxInput {
  id: string; label: string;
  state: 'queued' | 'running' | 'finished'; result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null; leftMs: number | null; durationMs: number | null;
}
// `columns` and `edges` as `jobGraph` gives them, each id as its box.
export interface JobGraphInput { columns: JobBoxInput[][]; edges: { from: string; to: string }[]; }
// The selected job, or the build itself while it lists no job (`isBuild` true, `label` the kind's label).
export interface JobPanelInput {
  label: string; isBuild: boolean;
  stepText: string | null;
  state: 'queued' | 'running' | 'finished'; result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null; leftMs: number | null; durationMs: number | null;
  canSaveLog: boolean; // the backend's `capabilities.saveLog`
  log: DownloadStateInput | null; // this log's save, null with none in `builds.downloads`
  backendLabel: string;
  webUrl: string | null; // the job's, or the build's while `isBuild`
}
export interface DetailEmptyInput { reason: 'noBuild' }
// `body` appends the app's `div.builds-detail-body` to `parent` and returns it; the app draws the head, the graph and
// the panel in it. A body the part leaves out goes at the end of its root.
export interface DetailKit extends BaseKit { body(parent: HTMLElement): HTMLElement; }
// in BuildsLayout:
detail?(parent: HTMLElement, kit: DetailKit): BuildsPane;
buildHeader?(parent: HTMLElement, input: BuildHeaderInput, kit: BaseKit): HTMLElement;
jobGraph?(parent: HTMLElement, input: JobGraphInput, kit: BaseKit): HTMLElement;
jobPanel?(parent: HTMLElement, input: JobPanelInput, kit: BaseKit): HTMLElement;
detailEmpty?(parent: HTMLElement, input: DetailEmptyInput, kit: BaseKit): HTMLElement;
```

- `JobLineInput` is the old `BuildDetailInput['jobs']` element, exported under its own name; `HubBuildInput.jobs`
  becomes `JobLineInput[]` and gains `backendId: string; buildId: string`.
- `read-builds-layout.ts`'s `LAYOUT_PARTS` loses `buildDetail` and gains the five parts.
- **The app keeps**, for the graph: `is-selected` on the box of the job cursor, `is-cursor` on it while `graph` holds
  the keys, set on the element under the `jobGraph` root whose `data-job-id` is the job's id; the boxes' clicks; the
  `scrollIntoView` and the kept `scrollLeft`, and when each part redraws, as Decisions § What redraws when pins.
- Order in `div.builds-detail-body`: `buildHeader`, then `jobGraph` while the build lists jobs, then `jobPanel`.
  With no build: `detailEmpty` alone.

**The `default` layout** (DESIGN.md § Surfaces, Builds; § Primitives; `kit.d.ts`):
- `detail`: `div.builds-detail-pane`, `kit.body` in it, as `main`.
- `buildHeader`: a heading `<game label> <kind label> #<number> (<version>)`, each null part left out with its
  mark, then `<branch> · <short revision> <subject>` muted (as `rowDetail` writes it), then the state
  (`drawState`), the step text muted (only when not null), the status text, then one actions row: a button per
  link (`secondary`), a `<backend label> ↗` button (`ghost`) running `builds.openLink` with `webUrl` while it is not
  null, the `openWeb` hint, the `cancel` hint while `canCancel`, then the files: a `<file label> ↓` button per file
  (class `builds-file-button`, `data-entry` its `entry`; 11 clicks it by that selector)
  running `builds.downloadFile` with `{ arg: entry }`, each followed by its download state (below), then the
  `download` hint.
- `jobGraph`: a root `div.builds-graph` that scrolls sideways (`overflow-x: auto`); in it a CSS grid,
  `div.builds-graph-grid`, one grid column per graph column, each box at its column and row. Boxes keep a fixed width
  from a layout token (`calc(var(--wg-space-8) * 20)`, no raw length: DESIGN.md § Checks) and do not shrink
  (plan.md: the graph scrolls, boxes do not shrink). A box is `div.builds-job-box` with `data-job-id`, `radius-md`,
  `border-subtle`: its label (medium weight, one line, ellipsized) and its state line (`drawState`, and `ran
  <duration>` muted while `durationMs` is not null and the job finished). `is-selected` gives the box
  `list-active-background`; `is-cursor` the focus ring (DESIGN.md § Keys and focus).
- The arrows: one `svg.builds-graph-arrows` absolutely placed over the grid, not taking pointer events. The layout
  draws its paths from measured boxes: in a `requestAnimationFrame` after the part returns, and again from a
  `ResizeObserver` on the grid each time the grid's size changes (a mode shown after a draw while hidden, a theme's
  spacing). For each edge it reads both boxes' `offsetLeft`, `offsetTop`, `offsetWidth` and `offsetHeight` against the
  grid, and draws one path from the middle of the prerequisite's end edge to the middle of the dependent's start
  edge, a horizontal cubic curve, with an arrowhead marker at the dependent's end. Stroke `border-strong`. While the
  root is not connected, it draws nothing, and the first `ResizeObserver` callback that finds the root disconnected
  calls `observer.disconnect()`, so a redrawn graph leaves no observer behind (`BaseKit` gives a layout no dispose
  hook). The SVG nodes come from `document.createElementNS` with the SVG namespace,
  as `src/shared/page/ui/sparkline.ts` makes its nodes.
- `jobPanel`: under the graph, `div.builds-job-panel`: the label (medium weight), the state (`drawState`), `ran
  <duration>` muted when finished with a duration, the step text muted, then an actions row: `Log ↓` (`secondary`,
  running `builds.saveLog`) while `canSaveLog`, the `saveLog` hint, the log's download state, then a
  `<backend label> ↗` button (`ghost`) running `builds.openLink` with `webUrl` while it is not null, and the `openJob`
  hint. Both hints draw whatever `canSaveLog` and `webUrl` hold, so the placement check finds them.
- A download state (`DownloadStateInput`): running → `Saving…` muted; saved → a `success` Tag `Saved` and the file
  name muted; failed → `Failed: <problem>` in `builds-problem`.
- `detailEmpty`: `kit.emptyState` with `Pick a build to see its jobs.`
- `hubBuild`: the `Open in Builds` button as above, with class `builds-open-in-builds` (11 clicks it by that selector).
- `sideBar`: the `pickQueue` hint as above.
- The pinned copy, verbatim: `Log ↓`, `<backend label> ↗` (reads `TeamCity ↗` on a backend labelled TeamCity),
  `<file label> ↓`, `Open in Builds`, `Saving…`, `Saved`, `Failed: <problem>`, `ran <duration>`,
  `Pick a build to see its jobs.`, `Download a file`, `This build has no files to download`,
  `This job has no link in the backend`, `<backend label> cannot save logs`, `The build is no longer listed`, and
  the existing `This build has no link in the backend` (`o` on a build with no jobs and no `webUrl`).
  The link label names the backend's own `label`, not the word TeamCity, so the `builds` plugin names no backend
  (`docs/features/builds/design.md` § Plugins: a third backend is a new plugin with no edit to `builds`).
  The `↓` and `↗` marks are the user's pinned copy (interview); DESIGN.md § Icons and copy already names both marks
  as its exception, so DESIGN.md needs no edit.
- `layout.css` drops the `.builds-detail` rules and adds the detail pane, header, graph, box, arrows and panel rules,
  tokens only. `builds.css` styles the app-owned containers (`div.builds-detail-pane` holder, the split's classes).

## Behaviour

GIVEN the list cursor on a build WHEN `j` moves it to the next build THEN the detail pane shows the next build, its job cursor on that build's `defaultJob`
GIVEN the keys in the build list WHEN Alt+l (or Enter) THEN the log reads `focus graph` then `graph on <build key> job <job id>`, and that box carries `is-selected` and `is-cursor`
GIVEN the keys in the graph WHEN Alt+h (or Esc) THEN the keys return to the list and the box keeps `is-selected` without `is-cursor`
GIVEN a stacked split (narrow window) WHEN Alt+j in the list THEN the keys move to the graph; GIVEN a side-by-side split WHEN Alt+j in the list THEN the view returns false
GIVEN a poll that changes the shown build's jobs but keeps the cursor's job WHEN it redraws THEN the job cursor stays on that job
GIVEN a backend without `saveLog` WHEN `s` in the graph THEN it toasts `<label> cannot save logs` and invokes nothing
GIVEN a build with one file, `entry` 1 WHEN `s` in the list THEN `download` is invoked with `file: 1`; with two files THEN the picker opens titled `Download a file` with both labels
GIVEN the keys in the graph WHEN a poll drops the shown build THEN the keys go to the list and the log reads `build <key> gone`
GIVEN a hub build the snapshot no longer lists WHEN `showBuild` runs THEN it toasts `The build is no longer listed` and the mode does not show
GIVEN `builds.downloads` gains `<id>` running then saved WHEN the view hears each change THEN it logs `download <id> running` then `download <id> saved <file name>`
GIVEN a hub build WHEN its `Open in Builds` button runs `builds.showBuild` THEN Builds mode shows, the game's entry is selected, the list cursor is on the build and the keys are in the list
GIVEN a place `{ entry, build, job }` written by the last page WHEN the page starts and the snapshot holds them THEN the entry, the list cursor and the job cursor are restored

## Tests

Pure rules, in `builds-view-model.test.ts` (each an `it.each` table, `describe` per function, built with
`contract.test-support.ts`'s builders):
- `describe('jobLineInputs')` — replaces `describe('buildDetailInput')`: each job's time left in ms (`[90_000, null]`
  for `leftSeconds` 90 and null).
- `describe('downloadId')` — rows: `{ log: 'ios' }` → `a/b1/log/ios`; `{ log: null }` → `a/b1/log`;
  `{ file: 2 }` → `a/b1/file/2`.
- `describe('jobGraphInput')` — one test: `durationMs` is `finishedAt - startedAt` for a finished job with both
  (`300_000` for 1_000_000 and 1_300_000), `0` for `finishedAt` before `startedAt`, null with `startedAt` null;
  `leftMs` from `leftSeconds`; each column holds the boxes in `graph.columns` order.
- `describe('buildHeaderInput')` — rows: `files` are `view.files[record.id]` with each file's `entry` kept (files with
  entries 0 and 2 give `entry` 0 and 2, not 0 and 1) and each file's download read by `downloadId(…, { file: entry })`
  (`saved` → `fileName` the path's base name `game-a-1.zip`; a path `C:\Users\u\Downloads\game-a-1.zip` gives the
  same name); a build missing from `view.files` gives `files: []`; `stepText` is the record's only while `jobs` is
  empty, else null; `canCancel` follows `capabilities.cancel` for a finished build too; `startsInMs` is
  `startEstimate - now` (`now` 1_000, `startEstimate` 61_000 → `60_000`), `0` for a past estimate, null for none;
  `subject` is `view.subjects[revision]`.
- `describe('jobPanelInput')` — rows: a job id gives that job's fields, `webUrl` the job's, `isBuild` false; `null`
  for a build with no jobs gives `isBuild` true, `label` the kind's label, `webUrl` the build's; `canSaveLog` follows
  `capabilities.saveLog`; `log` reads `downloadId(…, { log })` (failed → `problem` kept).

In `session-parts-model.test.ts`: the existing hub test gains `backendId` and `buildId` in its expected input.

Page part, in `start.test.ts` (the existing harness). The inline detail goes, so its tests change:
- the `marks` helper (reads `builds-detail`): rewrite it to return the `is-selected` row's place and the build key the
  `.builds-detail-body` header names.
- `'keeps the cursor and the detail on their build across a poll'`: rewrite as
  `'keeps the cursor and the detail pane on their build across a poll'`, without `openDetail` (the pane follows the
  cursor).
- `"opens the detail's build in its backend, wherever the cursor is"`: delete. The pane always shows the cursor's
  build, so the case is gone; `o` in the list is the existing `'toasts a build with no link on o'` and `openWeb` tests.
- `'closes the detail when its build is gone'`: rewrite as `'shows the new cursor build when the shown build is
  gone'` — the pane's header names the build the cursor fell to.
- `"shows the build's step in its detail only with $case"`: delete; the `buildHeaderInput` `stepText` row covers it.

New tests:
- `it('shows the list cursor's build in the detail pane')` — after `listDown`, the `.builds-detail-body` header
  names the second build; an empty list draws `detailEmpty`.
- `it('keeps the job cursor on its job across a poll')` — select job `b` by `graphDown`, publish a new snapshot with
  the same job ids and changed percents; the `is-selected` box is still `b`, and the `jobPanel` shows the new percent.
- `it('keeps the graph's scroll across a poll')` — set the `jobGraph` root's `scrollLeft` to 40, publish a new snapshot
  of the same build with changed percents; the new root's `scrollLeft` is 40.
- `it.each` `'moves the keys between the list and the graph: $case'` — rows: `focusGraph` sets scope `graph` and logs
  `focus graph` then `graph on <key> job <id>`; `leaveGraph` sets scope `list`; with an empty list `focusGraph`
  stays on `list` and logs `no build under the cursor`; `move('down')` from `list` returns false side by side and
  enters `graph` once the test adds `is-stacked` to the split element by hand (the fake DOM reports no width, and
  the rule reads the class); `focusGraph`, then `focusSideBar`, then `focusMain` restores `graph`.
- `it('gives the keys to the list when the shown build goes')` — in `graph`, publish a snapshot without the shown
  build; scope `list`, log `build <key> gone`.
- `it.each` `'saves a log: $case'` — rows: the cursor job → `saveLog` invoked with
  `{ backend, game, build, job: '<cursor job>' }`; a build with no jobs → `job: null`, no `jobGraph` drawn; a backend
  without `saveLog` → the toast `<label> cannot save logs`, nothing invoked; a `{ problem: 'x' }` answer → toast `x`;
  a rejection with `Error('boom')` → toast `boom`.
- `it('downloads the only file and picks among several')` — rows: one file with `entry` 1 → `download` invoked with
  `file: 1`; two files → the picker opens with both labels, and choosing the second invokes its `entry`; none → the
  toast `This build has no files to download`.
- `it('logs each download state it hears')` — put a `BuildDownload` running, then saved with path
  `/home/Downloads/x.log`; the log holds `download <id> running` then `download <id> saved x.log`.
- `it.each` `'opens a link with o in the graph: $case'` — rows: a job with `webUrl` → opened; a job without → toast
  `This job has no link in the backend`; a build with no jobs → the build's `webUrl` opened.
- `it.each` `'selects a job by id: $case'` — rows: a known id → scope `graph`, log `job cursor on <id>`; an unknown
  id → log `no job <id>`, cursor unmoved.
- `it('shows a build from the hub')` — run `showBuild` with a build of the second game while the mode hides; the
  mode shows, the game's entry is selected, the list cursor is on the build, the scope is `list` (the flag kept it
  through `shown()`); a later hide and show resets to `games`.
- `it('shows no mode for a build the snapshot lacks')` — `showBuild` of an unknown build; the toast
  `The build is no longer listed`, the mode does not show.
- `it.each` `'keeps the saved place until the restore: $case'` — rows: start with `builds.place` holding
  `{ entry, build, job }` and no snapshot yet, then publish an empty snapshot, then the full one; the slot still
  holds the saved place until the full snapshot, then the entry, cursor row and `is-selected` box match it; a
  `listDown` before the full snapshot drops the pending place and the slot holds `{ entry, build, job }` of the new
  cursor.

Every other check (the graph's look, the arrows, sideways scroll, the stacked window) is a live check in
[11-final-verification.md](11-final-verification.md).

Done when: compiles; no raw length or colour in the two CSS files (DESIGN.md § Checks); the test gate runs the tests above.
Commit:    one commit for the group

## Proof

