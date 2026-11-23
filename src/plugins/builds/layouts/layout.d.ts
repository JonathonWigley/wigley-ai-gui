// The builds layout contract: what a layout in `layouts/builds/<name>/layout.js` draws Builds mode with. In the
// mode's side bar the app draws one `sideBar`, and in its `entries` slot one `allEntry`, then per backend one
// `backendHeading` and one `gameEntry` per tracked game. In the sheet it draws one `main`, and in its `body` slot the
// shown entry's head (`gameHeader` for a game, `feedHeader` for All), then the list, then `empty` while the list
// shows no build. The list holds one `buildRow` per build, newest first; in a game's list a set run's builds sit in
// one `setGroup` at the place of its newest build, and the All feed is flat. The open build's `buildDetail` sits
// right after its row. The queue picker draws one `pickerRow` per choice. The app sets `data-layout-owner="builds"`
// and `data-layout="<name>"` on the element each part returns, `<name>` being the layout that drew it, so
// `[data-layout-owner="builds"][data-layout="<name>"] …` in a layout's CSS selects only its own parts.
//
// The app keeps:
// - the keys and the focus: in the side bar `j`/`k`/`gg`/`G` walk the cursor, Enter shows the entry and `q` queues
//   its game; Alt+l gives the keys to the list, where `j`/`k`/`gg`/`G` walk the cursor over the build rows, Enter
//   opens or closes the detail, `q` queues the shown game, `o` opens the build in its backend and `x` cancels it;
// - the click, `is-selected` and `is-cursor` on each `allEntry`, `gameEntry` and `buildRow` root: `is-selected` on
//   the shown entry and on the list cursor's row, `is-cursor` on the same while its pane has the keys; a row gives
//   `kit.row` no `onClick`;
// - the scrolling: it scrolls the `.is-cursor` of the side bar and of the list into view;
// - every redraw: on each change of the builds, of the sessions' links and rows, the shown entry, the filter and the
//   open detail.
// Every kit extends `BaseKit`. Each part appends its root to `parent` and returns it. Times are milliseconds; a layout
// writes them with `kit.duration(ms)`. Kit scopes: `sideBar`, `allEntry`, `backendHeading` and `gameEntry`
// `builds.games`; `main`, `gameHeader`, `feedHeader`, `setGroup`, `buildRow`, `buildDetail` and `empty`
// `builds.list`; `pickerRow` `builds.picker`.
import type {
  BaseKit,
  DotStatus,
} from '../../../shared/page/layout-host/kit';

export type { BaseKit, DotStatus };

// A pane's root: the `sideBar` root fills the side bar's `div.builds-side`, the `main` root the sheet's
// `div.builds-main`.
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

// The open build's detail: each job with its own progress, the status text, the links (each a `kit.button` running
// `builds.openLink` with its `url`) and, while `webUrl` is not null, Open in the backend (`builds.openWeb`).
export interface BuildDetailInput {
  statusText: string | null;
  webUrl: string | null;
  links: { label: string; url: string }[];
  jobs: {
    label: string;
    state: 'queued' | 'running' | 'finished';
    result: 'success' | 'failure' | 'cancelled' | null;
    percent: number | null;
    leftMs: number | null;
    stepText: string | null;
  }[];
}

// Why the list shows no build: no backend in the setting, no tracked game, no build in the shown entry, or a filter
// that hides every build of the feed.
export interface EmptyInput {
  reason: 'noBackends' | 'noGames' | 'noBuilds' | 'noMatches';
}

// `picker` is the open queue picker's title (`Queue Game One`); `label` is the row's line.
export interface PickerRowInput {
  picker: string;
  label: string;
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
// return an `li`. `buildDetail` draws into the same `ol` as its row and returns an `li`, which the app places right
// after the row's root. `gameHeader`, `feedHeader` and `empty` draw into `div.builds-body`.
export interface BuildsLayout {
  sideBar?(parent: HTMLElement, kit: SideBarKit): BuildsPane;
  main?(parent: HTMLElement, kit: MainKit): BuildsPane;
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
  buildDetail?(
    parent: HTMLElement,
    input: BuildDetailInput,
    kit: BaseKit,
  ): HTMLElement;
  empty?(parent: HTMLElement, input: EmptyInput, kit: BaseKit): HTMLElement;
  pickerRow?(
    parent: HTMLElement,
    input: PickerRowInput,
    kit: PickerRowKit,
  ): HTMLElement;
}

// Every member of BuildsLayout, required: the built-in `default` defines them all.
export interface CompleteBuildsLayout extends Required<BuildsLayout> {}
