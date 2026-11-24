// The builds layout contract: what a layout in `layouts/builds/<name>/layout.js` draws Builds mode with. In the
// mode's side bar the app draws one `sideBar`, and in its `entries` slot one `allEntry`, then per backend one
// `backendHeading` and one `gameEntry` per tracked game. The sheet holds one split: the list pane beside the detail
// pane, the list above the detail in a narrow window. In the list pane the app draws one `main`, and in its `body`
// slot the shown entry's head (`gameHeader` for a game, `feedHeader` for All), then the list, then `empty` while the
// list shows no build. The list holds one `buildRow` per build, newest first; in a game's list a set run's builds sit
// in one `setGroup` at the place of its newest build, and the All feed is flat. In the detail pane the app draws one
// `detail`, and in its `body` slot the list cursor's build: its `buildHeader`, then its `jobGraph` while the build
// lists jobs, then the `jobPanel` of the selected job (of the build itself while it lists none); with no build under
// the list cursor, `detailEmpty` alone. The queue picker and the file picker draw one `pickerRow` per choice. Under
// each session row with a build the app draws one `rowLine`, the session's newest build; in the session hub's Builds
// section one `hubBuild` per build the session queued, newest first; and above the Chat composer of a session with a
// build offer one `offerCard`. The app sets `data-layout-owner="builds"`
// and `data-layout="<name>"` on the element each part returns, `<name>` being the layout that drew it, so
// `[data-layout-owner="builds"][data-layout="<name>"] …` in a layout's CSS selects only its own parts.
//
// The app keeps:
// - the keys and the focus: in the side bar `j`/`k`/`gg`/`G` walk the cursor, Enter shows the entry and `q` queues
//   its game; Alt+l gives the keys to the list, where `j`/`k`/`gg`/`G` walk the cursor over the build rows, `q` queues
//   the shown game, `o` opens the build in its backend, `x` cancels it, `s` downloads its file (picking one when it
//   has several), and Enter or Alt+l (Alt+j while stacked) gives the keys to the job graph; in the graph `h`/`l` step
//   a column, `j`/`k` a job within one, `s` saves the selected job's log, `o` opens the job in its backend, and Esc or
//   Alt+h (Alt+k while stacked) gives the keys back to the list;
// - the click, `is-selected` and `is-cursor` on each `allEntry`, `gameEntry` and `buildRow` root: `is-selected` on
//   the shown entry and on the list cursor's row, `is-cursor` on the same while its pane has the keys; a row gives
//   `kit.row` no `onClick`;
// - in the job graph, on the element under the `jobGraph` root whose `data-job-id` is the selected job's id:
//   `is-selected`, `is-cursor` while the graph has the keys, and on each such element the click that selects its job;
// - the offer card's keys: `j` from the last chat entry gives them to the card while it shows, where Enter queues
//   the offer, `x` dismisses it, `k` and Esc go back to the entries, and `i` / `a` to the chat box; `is-cursor` on the
//   `offerCard` root while the card holds them;
// - the scrolling: it scrolls the `.is-cursor` of the side bar and of the list into view, and the selected job's box
//   once a build shows and after each job cursor move; a redraw of the same build keeps the graph's sideways scroll;
// - every redraw: the side bar and the list on each change of the builds, of the sessions' links and rows, the shown
//   entry and the filter; `buildHeader` and `jobPanel` on each change of those and of the downloads, `jobPanel` on
//   each job cursor move too; `jobGraph` when the shown build or its graph input changes.
// Every kit extends `BaseKit`. Each part appends its root to `parent` and returns it. Times are milliseconds; a layout
// writes them with `kit.duration(ms)`. Kit scopes: `sideBar`, `allEntry`, `backendHeading` and `gameEntry`
// `builds.games`; `main`, `gameHeader`, `feedHeader`, `setGroup`, `buildRow`, `empty`, `detail`, `buildHeader`,
// `detailEmpty`, `rowLine` and `hubBuild` `builds.list`; `jobGraph` and `jobPanel` `builds.graph`; `pickerRow`
// `builds.picker`; `offerCard` `builds.offer`.
import type { BaseKit, DotStatus } from '../../../shared/page/layout-host/kit';

export type { BaseKit, DotStatus };

// A pane's root: the `sideBar` root fills the side bar's `div.builds-side`, the `main` root the sheet's
// `div.builds-main`, the `detail` root the sheet's `div.builds-detail-holder`.
export interface BuildsPane {
  element: HTMLElement;
}

// A backend's heading: its label, and `problem`, what is wrong with its entry or its last poll, null when nothing is.
export interface BackendHeadingInput {
  label: string;
  problem: string | null;
}

// A tracked game in the side bar: `dot` shows its newest build's state.
export interface GameEntryInput {
  label: string;
  dot: DotStatus;
}

// One queue button: `id` is the kind or set id, `withAgent` true for a set that also gets a `<label> with agent`
// button.
export interface QueueButtonInput {
  id: string;
  label: string;
  withAgent: boolean;
}

// The shown game's head. A kind's or a set's button runs `builds.queueButton` with
// `{ backend: backendId, game: gameId, kind: id }`; a set's with-agent button runs `builds.withAgent` with
// `{ backend: backendId, game: gameId, set: id }`. `canQueue` is false while the backend has no instance, when the
// part draws no button.
export interface GameHeaderInput {
  backendId: string;
  gameId: string;
  label: string;
  backendLabel: string;
  kinds: QueueButtonInput[]; // `withAgent` always false
  sets: QueueButtonInput[]; // `withAgent` true when the set has an agent prompt
  canQueue: boolean;
}

// The All feed's head: `filter` is the shown filter. A chip runs `builds.setFilter` with `all`, `running` or
// `sessions`.
export interface FeedHeaderInput {
  filter: 'all' | 'running' | 'sessions';
}

// One build. `gameLabel` is drawn only while `inFeed` (the All feed). `shortRevision` and `subject` are null when the
// build names no revision, or its commit is not in the game's clone. `percent` (0–100), `leftMs` and `startsInMs` are
// null when the backend cannot read them. `queuedBy` is the label of the session that queued it, else the backend's
// name for who did, else null.
export interface BuildRowInput {
  key: string; // `<backendId>/<buildId>`
  gameLabel: string;
  kindLabel: string;
  number: string | null;
  version: string | null;
  branch: string;
  shortRevision: string | null;
  subject: string | null;
  state: 'queued' | 'running' | 'finished';
  result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null;
  leftMs: number | null;
  startsInMs: number | null;
  queuedBy: string | null;
  inFeed: boolean;
}

// A set run's group: the set's label and the short revision every build of the run was made from.
export interface SetGroupInput {
  label: string;
  shortRevision: string | null;
}

// One job's line in a hub build: its own progress and `stepText` (what the job does now as the backend reads it,
// null when it reads none).
export interface JobLineInput {
  label: string;
  state: 'queued' | 'running' | 'finished';
  result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null;
  leftMs: number | null;
  stepText: string | null;
}

// A log save or a file download into the Downloads folder.
export interface DownloadStateInput {
  state: 'running' | 'saved' | 'failed';
  fileName: string | null; // the saved file's base name (after the last `/` or `\`), once saved
  problem: string | null; // why it failed
}

// One file of the shown build, drawn as a `kit.button` running `builds.downloadFile` with `entry`.
export interface BuildFileInput {
  entry: number; // the file's `BuildFile.entry`, the arg of `builds.downloadFile`
  label: string;
  download: DownloadStateInput | null; // this file's download, null with none in `builds.downloads`
}

// The shown build's head. `stepText` is not null only while the build lists no job. `subject` and `startsInMs` are
// read as `buildRowInput` reads them: `subject` from `view.subjects` through `revision`, `startsInMs` null while
// `startEstimate` is null, else `Math.max(0, startEstimate - now)`. Each link is a `kit.button` running
// `builds.openLink` with its `url`, and so is `<backendLabel> ↗` with `webUrl` while it is not null. `canCancel` is
// the backend's `capabilities.cancel`, whatever the build's state.
export interface BuildHeaderInput {
  gameLabel: string;
  kindLabel: string;
  number: string | null;
  version: string | null;
  branch: string;
  shortRevision: string | null;
  subject: string | null;
  state: 'queued' | 'running' | 'finished';
  result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null;
  leftMs: number | null;
  startsInMs: number | null;
  stepText: string | null;
  statusText: string | null;
  backendLabel: string;
  webUrl: string | null;
  links: { label: string; url: string }[];
  files: BuildFileInput[];
  canCancel: boolean;
}

// One box. `durationMs` is `Math.max(0, finishedAt - startedAt)` once both are set (a clock skew gives 0), else null.
export interface JobBoxInput {
  id: string;
  label: string;
  state: 'queued' | 'running' | 'finished';
  result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null;
  leftMs: number | null;
  durationMs: number | null;
}

// The shown build's jobs left to right: `columns[c]` holds column `c`'s boxes top to bottom, and each edge joins the
// box of its prerequisite `from` to the box of the job `to` that waits on it, each by its box's id.
export interface JobGraphInput {
  columns: JobBoxInput[][];
  edges: { from: string; to: string }[];
}

// The selected job, or the build itself while it lists no job (`isBuild` true, `label` the kind's label). `Log ↓`, a
// `kit.button` running `builds.saveLog`, shows while `canSaveLog`; `<backendLabel> ↗` runs `builds.openLink` with
// `webUrl` while it is not null.
export interface JobPanelInput {
  label: string;
  isBuild: boolean;
  stepText: string | null;
  state: 'queued' | 'running' | 'finished';
  result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null;
  leftMs: number | null;
  durationMs: number | null;
  canSaveLog: boolean; // the backend's `capabilities.saveLog`
  log: DownloadStateInput | null; // this log's save, null with none in `builds.downloads`
  backendLabel: string;
  webUrl: string | null; // the job's, or the build's while `isBuild`
}

// Why the detail pane shows no build: the list has no cursor.
export interface DetailEmptyInput {
  reason: 'noBuild';
}

// Why the list shows no build: no backend in the setting, no tracked game, no build in the shown entry, or a filter
// that hides every build of the feed.
export interface EmptyInput {
  reason: 'noBackends' | 'noGames' | 'noBuilds' | 'noMatches';
}

// `picker` is the open picker's title (`Queue Game One`, `Download a file`); `label` is the row's line.
export interface PickerRowInput {
  picker: string;
  label: string;
}

// A session's newest build, under its row: game, kind and number, a progress bar and time left while it runs, its
// result once it ends. `percent` (0–100) and `leftMs` are null when the backend cannot read them.
export interface RowLineInput {
  gameLabel: string;
  kindLabel: string;
  number: string | null;
  state: 'queued' | 'running' | 'finished';
  result: 'success' | 'failure' | 'cancelled' | null;
  percent: number | null;
  leftMs: number | null;
}

// One build the session queued, in its hub's Builds section: the branch, the short revision (null when the build
// names none), each job's progress, its links (each a `kit.button` running `builds.openLink` with its `url`), and
// Open in Builds (a `kit.button` running `builds.showBuild` with `{ backend: backendId, build: buildId }`).
export interface HubBuildInput {
  backendId: string;
  buildId: string;
  gameLabel: string;
  kindLabel: string;
  number: string | null;
  branch: string;
  shortRevision: string | null;
  state: 'queued' | 'running' | 'finished';
  result: 'success' | 'failure' | 'cancelled' | null;
  jobs: JobLineInput[];
  links: { label: string; url: string }[];
}

// The session's build offer: the game, the kind's or set's label, the branch, its origin head short and that commit's
// subject (each null when not read). A `Queue` button runs `builds.queueSessionOffer` and a `Dismiss` button
// `builds.dismissSessionOffer`, each with `sessionId` as its arg.
export interface OfferCardInput {
  sessionId: string;
  gameLabel: string;
  choiceLabel: string;
  branch: string;
  shortRevision: string | null;
  subject: string | null;
}

// `entries` appends the app's `ol.builds-entries` to `parent` and returns it; the app draws the entries in it. A list
// the part leaves out goes at the end of its root.
export interface SideBarKit extends BaseKit {
  entries(parent: HTMLElement): HTMLElement;
}

// `body` appends the app's `div.builds-body` to `parent` and returns it; the app draws the head, the list `ol` and the
// empty state in it. A body the part leaves out goes at the end of its root.
export interface MainKit extends BaseKit {
  body(parent: HTMLElement): HTMLElement;
}

// `body` appends the app's `div.builds-detail-body` to `parent` and returns it; the app draws the head, the graph and
// the panel in it. A body the part leaves out goes at the end of its root.
export interface DetailKit extends BaseKit {
  body(parent: HTMLElement): HTMLElement;
}

// `rows` appends the app's `ol.builds-set-rows` to `parent` and returns it; the app draws the set's rows in it. A list
// the part leaves out goes at the end of its root.
export interface SetGroupKit extends BaseKit {
  rows(parent: HTMLElement): HTMLElement;
}

export interface PickerRowKit extends BaseKit {
  // The app's element for the end of the cursor row, or null on every other row; pass it as
  // `KitRowOptions.trailing`.
  trailing(): HTMLElement | null;
}

// Each part comes from the first layout that defines it among the `builds.layout` setting and `default`; a part that
// throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
// `allEntry`, `backendHeading` and `gameEntry` draw into the entries `ol` and return an `li`. `setGroup` and
// `buildRow` draw into the list `ol` in `div.builds-body`, a row of a set into its group's `ol.builds-set-rows`, and
// return an `li`. `gameHeader`, `feedHeader` and `empty` draw into `div.builds-body`; `buildHeader`, `jobGraph`,
// `jobPanel` and `detailEmpty` into `div.builds-detail-body`. `rowLine` draws into the session row part's wrapper
// (`.session-row-part[data-part='builds.row']`), `hubBuild` into the Builds section's body and `offerCard` into the
// composer part's wrapper.
export interface BuildsLayout {
  sideBar?(parent: HTMLElement, kit: SideBarKit): BuildsPane;
  main?(parent: HTMLElement, kit: MainKit): BuildsPane;
  // The detail pane's root fills the sheet's `div.builds-detail-holder`.
  detail?(parent: HTMLElement, kit: DetailKit): BuildsPane;
  // Draws the `All` entry.
  allEntry?(parent: HTMLElement, kit: BaseKit): HTMLElement;
  backendHeading?(
    parent: HTMLElement,
    input: BackendHeadingInput,
    kit: BaseKit,
  ): HTMLElement;
  gameEntry?(
    parent: HTMLElement,
    input: GameEntryInput,
    kit: BaseKit,
  ): HTMLElement;
  gameHeader?(
    parent: HTMLElement,
    input: GameHeaderInput,
    kit: BaseKit,
  ): HTMLElement;
  feedHeader?(
    parent: HTMLElement,
    input: FeedHeaderInput,
    kit: BaseKit,
  ): HTMLElement;
  setGroup?(
    parent: HTMLElement,
    input: SetGroupInput,
    kit: SetGroupKit,
  ): HTMLElement;
  buildRow?(
    parent: HTMLElement,
    input: BuildRowInput,
    kit: BaseKit,
  ): HTMLElement;
  empty?(parent: HTMLElement, input: EmptyInput, kit: BaseKit): HTMLElement;
  buildHeader?(
    parent: HTMLElement,
    input: BuildHeaderInput,
    kit: BaseKit,
  ): HTMLElement;
  jobGraph?(
    parent: HTMLElement,
    input: JobGraphInput,
    kit: BaseKit,
  ): HTMLElement;
  jobPanel?(
    parent: HTMLElement,
    input: JobPanelInput,
    kit: BaseKit,
  ): HTMLElement;
  detailEmpty?(
    parent: HTMLElement,
    input: DetailEmptyInput,
    kit: BaseKit,
  ): HTMLElement;
  pickerRow?(
    parent: HTMLElement,
    input: PickerRowInput,
    kit: PickerRowKit,
  ): HTMLElement;
  rowLine?(parent: HTMLElement, input: RowLineInput, kit: BaseKit): HTMLElement;
  hubBuild?(
    parent: HTMLElement,
    input: HubBuildInput,
    kit: BaseKit,
  ): HTMLElement;
  offerCard?(
    parent: HTMLElement,
    input: OfferCardInput,
    kit: BaseKit,
  ): HTMLElement;
}

// Every member of BuildsLayout, required: the built-in `default` defines them all.
export interface CompleteBuildsLayout extends Required<BuildsLayout> {}
