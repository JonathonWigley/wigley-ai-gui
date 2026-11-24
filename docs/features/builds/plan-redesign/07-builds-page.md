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
- `BuildsChannel.invoke.download(arg: { backend: string; game: string; build: string; file: number }): Promise<{ ok: true } | { problem: string }>` ← type 02, handler 05
- main publishes each `BuildDownload` in `builds.downloads` with the id shapes plan.md pins ← 05
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
  `export function buildHeaderInput(record: BuildRecord, view: GameView, backend: BackendView, downloads: ReadonlyMap<string, BuildDownload>): BuildHeaderInput`
  `export function jobGraphInput(record: BuildRecord, graph: JobGraph): JobGraphInput`
  `export function jobPanelInput(record: BuildRecord, jobId: string | null, view: GameView, backend: BackendView, downloads: ReadonlyMap<string, BuildDownload>): JobPanelInput`
  `export function downloadId(backendId: string, buildId: string, target: { log: string | null } | { file: number }): string`
  `export function downloadStateInput(download: BuildDownload | undefined): DownloadStateInput | null`
- `src/plugins/builds/page/builds-view.ts`: `BuildsScope = 'games' | 'list' | 'graph'`; `BuildsView` gains
  `showBuild(arg: { backend: string; build: string }): void`, `selectJob(jobId: string): void`,
  `downloadFile(index: number): void`; `BuildsViewDeps` gains `uiState: UiState`, `timers: Timers`,
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

**Focus and keys** (AGENTS.md § Architecture, A focus target, A resize target; `docs/keymap.md` § Layers, Alt+hjkl).
- Three base scopes: `games` (side bar), `list`, `graph`. `setFocus` sets the scope, then the resize target, then the
  focus target, as today. The resize target is the split while `list` or `graph` holds the keys, null for `games`.
- `setFocus` logs `focus <scope>` each time the scope changes (`focus graph`). The self-test waits on it (08).
- The DOM focus: `graph` focuses the detail pane element (`tabIndex = -1`), as `list` focuses `mainPane`. A
  `focusin` on the detail pane sets `graph` without moving focus, as the two other panes do.
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
  - One file: download it (index 0).
  - Several: open the shared list picker (`picker.open`), title `Download a file`, one row per file's label, drawn
    through the `pickerRow` part as the queue picker's rows are; choosing a row downloads that index. The picker's
    scope is the existing `builds.picker`.
- `builds.downloadFile` (a file button, arg the file's index) downloads that index of the shown build.
- A download logs `saving <download id>` and invokes `download({ backend, game, build, file })`; its answers are
  handled as `saveLog`'s (`download refused: <problem>`). Demo-blocked as `download` and `downloadFile`.
- **Download ids**: `downloadId` returns `<backendId>/<buildId>/log/<job id>`, `<backendId>/<buildId>/log/build`
  for `{ log: null }`, and `<backendId>/<buildId>/file/<index>` — plan.md's `BuildDownload.id` shapes.

**The downloads slot, as the page logs it.** The view reads `builds.downloads` through a new dep `downloads()`;
`start.ts` reads the slot and calls `changed()` on each change, as it does for `builds.snapshot`. The view logs one
line each time an entry it holds reaches a state it did not have at the last change it heard:
- `download <id> running`
- `download <id> saved <file name>` — the base name of `path` (`Game-A-Dev-2-iOS-build.log`)
- `download <id> failed: <problem>`
Entries the slot holds when the view starts log nothing until they change. A deleted entry logs nothing.

**Opening links.** `builds.openJob` (`o` in `builds.graph`) opens the cursor job's `webUrl`; with none it toasts
`This job has no link in the backend` (info). For a build with no jobs it opens the build's `webUrl`, as `openWeb`
does. Demo-blocked as `openJob`. `o` in `builds.list` stays `openWeb`.

**Open in Builds** (plan.md round 2). `builds.showBuild` with `{ backend, build }`:
- finds the game view holding the build in the shown snapshot; none: logs `no build <backend>/<build>` and toasts
  `The build is no longer listed` (info).
- else shows that game's side-bar entry (as `selectEntry` does), puts the list cursor on the build, shows Builds mode
  (`mode.show()` when it does not show), and gives the keys to `list`. It logs `shown build <build key>`.
- It is not demo-blocked: it acts on nothing outside the page.
- `start.ts` owns the mode handle, so its handler runs `view.showBuild(arg)` and then shows the mode; the view's
  `shown()` must then keep `list`, not reset to `games`. Pin this by the start test below.

**Reload keeps the place** (AGENTS.md § Architecture, A slot: `<id>.place`).
- `start.ts` publishes `buildsPlaceSlot` and wraps the writer in `placeWrites`, as Backlog's `start.ts` does, and
  hands the view the place read at start (`restoredPlace`) and the writes (`place`).
- The view writes `{ entry: selected, build: listCursor, job: jobCursor }` after every change of any of the three.
  It writes nothing while a demo sample shows.
- At start the view holds `restoredPlace` as pending. Each `drawSnapshot` applies it once the snapshot holds its
  `entry` (or `entry` is `all`): `selected = entry`; the list cursor goes to `build` when the list holds it; the job
  cursor to `job` when that build lists it, else `defaultJob`. Then the pending place drops. Any user move before
  that (a side-bar or list move, `selectEntry`, `selectBuild`, `showBuild`) drops it too. The scope is not restored:
  the mode shows on `games` as today.

**Clicks** (AGENTS.md § Architecture, A command: a view's own click handler runs the command a key would).
- A graph box's click runs `builds.selectJob` with the box's job id. The app attaches it to each element under the
  `jobGraph` root that carries `data-job-id`, with `rowAction` as rows get theirs.
- `selectJob(id)`: an id the shown build lacks logs `no job <id>`; else it moves the job cursor there, gives the keys
  to `graph` and logs `job cursor on <id>`.
- The header's file buttons run `builds.downloadFile` with the index; the job panel's `Log ↓` runs `builds.saveLog`;
  every `↗` link runs the existing `builds.openLink` with its URL.

**Session hub** (plan.md round 2). `HubBuildInput` gains `backendId` and `buildId`. The default `hubBuild` draws an
`Open in Builds` button (`ghost`) in its actions row, running `builds.showBuild` with
`{ backend: backendId, build: buildId }`, always, links or not.

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
  fileName: string | null; // the saved file's base name, once saved
  problem: string | null;  // why it failed
}
export interface BuildFileInput {
  index: number;  // the arg of `builds.downloadFile`
  label: string;
  download: DownloadStateInput | null; // this file's download, null with none in `builds.downloads`
}
// The shown build's head. `stepText` is not null only while the build lists no job.
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
// One box. `durationMs` is `finishedAt - startedAt` once both are set, else null.
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
  the keys, set on the element under the `jobGraph` root whose `data-job-id` is the job's id; the boxes' clicks;
  after each `jobGraph` draw and each job cursor move, `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on
  the cursor's box. The app redraws `jobGraph` only on a snapshot change of the shown build or a new shown build, and
  redraws `jobPanel` on each job cursor move and each downloads change.
- Order in `div.builds-detail-body`: `buildHeader`, then `jobGraph` while the build lists jobs, then `jobPanel`.
  With no build: `detailEmpty` alone.

**The `default` layout** (DESIGN.md § Surfaces, Builds; § Primitives; `kit.d.ts`):
- `detail`: `div.builds-detail-pane`, `kit.body` in it, as `main`.
- `buildHeader`: a heading `<game label> <kind label> #<number> (<version>)`, each null part left out with its
  mark, then `<branch> · <short revision> <subject>` muted (as `rowDetail` writes it), then the state
  (`drawState`), the step text muted (only when not null), the status text, then one actions row: a button per
  link (`secondary`), a `<backend label> ↗` button (`ghost`) running `builds.openLink` with `webUrl` while it is not
  null, the `openWeb` hint, the `cancel` hint while `canCancel`, then the files: a `<file label> ↓` button per file
  running `builds.downloadFile` with `{ arg: index }`, each followed by its download state (below), then the
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
  root is not connected, it draws nothing. The SVG nodes come from `document.createElementNS` with the SVG namespace,
  as `src/shared/page/ui/sparkline.ts` makes its nodes.
- `jobPanel`: under the graph, `div.builds-job-panel`: the label (medium weight), the state (`drawState`), `ran
  <duration>` muted when finished with a duration, the step text muted, then an actions row: `Log ↓` (`secondary`,
  running `builds.saveLog`) while `canSaveLog`, the `saveLog` hint, the log's download state, then a
  `<backend label> ↗` button (`ghost`) running `builds.openLink` with `webUrl` while it is not null, and the `openJob`
  hint. Both hints draw whatever `canSaveLog` and `webUrl` hold, so the placement check finds them.
- A download state (`DownloadStateInput`): running → `Saving…` muted; saved → a `success` Tag `Saved` and the file
  name muted; failed → `Failed: <problem>` in `builds-problem`.
- `detailEmpty`: `kit.emptyState` with `Pick a build to see its jobs.`
- `hubBuild`: the `Open in Builds` button as above.
- `sideBar`: the `pickQueue` hint as above.
- The pinned copy, verbatim: `Log ↓`, `<backend label> ↗` (reads `TeamCity ↗` on a backend labelled TeamCity),
  `<file label> ↓`, `Open in Builds`, `Saving…`, `Saved`, `Failed: <problem>`, `ran <duration>`,
  `Pick a build to see its jobs.`, `Download a file`, `This build has no files to download`,
  `This job has no link in the backend`, `<backend label> cannot save logs`, `The build is no longer listed`.
  The link label names the backend's own `label`, not the word TeamCity, so the `builds` plugin names no backend
  (`docs/features/builds/design.md` § Plugins: a third backend is a new plugin with no edit to `builds`).
  The `↓` and `↗` marks are the user's pinned copy (interview); they override DESIGN.md § Icons and copy ("a button
  label stands alone, with no trailing arrow"). Task 10 brings DESIGN.md in line.
- `layout.css` drops the `.builds-detail` rules and adds the detail pane, header, graph, box, arrows and panel rules,
  tokens only. `builds.css` styles the app-owned containers (`div.builds-detail-pane` holder, the split's classes).

## Behaviour

GIVEN the list cursor on a build WHEN `j` moves it to the next build THEN the detail pane shows the next build, its job cursor on that build's `defaultJob`
GIVEN the keys in the build list WHEN Alt+l (or Enter) THEN the log reads `focus graph` then `graph on <build key> job <job id>`, and that box carries `is-selected` and `is-cursor`
GIVEN the keys in the graph WHEN Alt+h (or Esc) THEN the keys return to the list and the box keeps `is-selected` without `is-cursor`
GIVEN a stacked split (narrow window) WHEN Alt+j in the list THEN the keys move to the graph; GIVEN a side-by-side split WHEN Alt+j in the list THEN the view returns false
GIVEN a poll that changes the shown build's jobs but keeps the cursor's job WHEN it redraws THEN the job cursor stays on that job
GIVEN a backend without `saveLog` WHEN `s` in the graph THEN it toasts `<label> cannot save logs` and invokes nothing
GIVEN a build with one file WHEN `s` in the list THEN `download` is invoked with `file: 0`; with two files THEN the picker opens titled `Download a file` with both labels
GIVEN `builds.downloads` gains `<id>` running then saved WHEN the view hears each change THEN it logs `download <id> running` then `download <id> saved <file name>`
GIVEN a hub build WHEN its `Open in Builds` button runs `builds.showBuild` THEN Builds mode shows, the game's entry is selected, the list cursor is on the build and the keys are in the list
GIVEN a place `{ entry, build, job }` written by the last page WHEN the page starts and the snapshot holds them THEN the entry, the list cursor and the job cursor are restored

## Tests

Pure rules, in `builds-view-model.test.ts` (each an `it.each` table, `describe` per function, built with
`contract.test-support.ts`'s builders):
- `describe('jobLineInputs')` — replaces `describe('buildDetailInput')`: each job's time left in ms (`[90_000, null]`
  for `leftSeconds` 90 and null).
- `describe('downloadId')` — rows: `{ log: 'ios' }` → `a/b1/log/ios`; `{ log: null }` → `a/b1/log/build`;
  `{ file: 2 }` → `a/b1/file/2`.
- `describe('jobGraphInput')` — one test: `durationMs` is `finishedAt - startedAt` for a finished job with both
  (`300_000` for 1_000_000 and 1_300_000), null with `startedAt` null; `leftMs` from `leftSeconds`; each column holds
  the boxes in `graph.columns` order.
- `describe('buildHeaderInput')` — rows: `files` are `view.files[record.id]` with index 0, 1 and each file's download
  read by `downloadId(…, { file: i })` (`saved` → `fileName` the path's base name `game-a-1.zip`); a build missing from
  `view.files` gives `files: []`; `stepText` is the record's only while `jobs` is empty, else null; `canCancel`
  follows `capabilities.cancel` for a finished build too.
- `describe('jobPanelInput')` — rows: a job id gives that job's fields, `webUrl` the job's, `isBuild` false; `null`
  for a build with no jobs gives `isBuild` true, `label` the kind's label, `webUrl` the build's; `canSaveLog` follows
  `capabilities.saveLog`; `log` reads `downloadId(…, { log })` (failed → `problem` kept).

In `session-parts-model.test.ts`: the existing hub test gains `backendId` and `buildId` in its expected input.

Page part, in `start.test.ts` (the existing harness; rewrite the detail tests at its `'keeps the cursor and the detail
on their build across a poll'` block, since the inline detail goes):
- `it('shows the list cursor's build in the detail pane')` — after `listDown`, the `.builds-detail-body` header
  names the second build.
- `it('keeps the job cursor on its job across a poll')` — select job `b` by `graphDown`, publish a new snapshot with
  the same job ids and changed percents; the `is-selected` box is still `b`.
- `it('moves the keys between the list and the graph')` — `focusGraph` sets scope `graph` and logs `focus graph`;
  `leaveGraph` sets scope `list`.
- `it('saves the cursor job's log')` — `saveLog` invokes the channel's `saveLog` with
  `{ backend, game, build, job: '<cursor job>' }`; a `{ problem: 'x' }` answer toasts `x`.
- `it('downloads the only file and picks among several')` — rows: one file → `download` invoked with `file: 0`; two
  files → the picker opens with both labels; none → the toast `This build has no files to download`.
- `it('logs each download state it hears')` — put a `BuildDownload` running, then saved with path
  `/home/Downloads/x.log`; the log holds `download <id> running` then `download <id> saved x.log`.
- `it('shows a build from the hub')` — run `showBuild` with a build of the second game; the mode shows, the game's
  entry is selected, the list cursor is on the build, the scope is `list`.
- `it('restores the place after a reload')` — start with `builds.place` holding `{ entry, build, job }`; after the
  first snapshot, the entry, cursor row and `is-selected` box match.

Every other check (the graph's look, the arrows, sideways scroll, the stacked window) is a live check in
[11-final-verification.md](11-final-verification.md).

Done when: compiles; no raw length or colour in the two CSS files (DESIGN.md § Checks); the test gate runs the tests above.
Commit:    one commit for the group

## Proof

