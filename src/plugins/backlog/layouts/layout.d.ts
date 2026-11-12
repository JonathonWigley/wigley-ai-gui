import type {
  BaseKit,
  KitRowOptions,
} from '../../../shared/page/layout-host/kit';

// The contract of a Backlog layout. Each part appends its root element to `parent` and returns it; the app sets
// `data-layout="<name>"` and `data-layout-owner="backlog"` on that root. A layout's `layout.css` restyles under
// `[data-layout-owner="backlog"][data-layout="<name>"]`.
//
// Slots. A slot member places an element the app owns or fills:
// - `status` → `div.backlog-status`; the app sets its text, title and `hidden`.
// - `filterBar` → `div.backlog-filter-bar`; the app draws the `filters` part into it on each render.
// - `filterBox` places the app's filter frame (`backlog-filter`) and returns it; the app keeps the one frame and its
//   input across every redraw.
// - `rows` → `ol.backlog-rows`; the app replaces its children with the `tableRow`s, or the `empty` part, on each draw.
// - `body` → `div.backlog-review-body`; the app draws `reviewItem` into it, then `commits` while they show.
// - `chunks` → the strip's horizontal scroller (`ui-h-scroller backlog-chunks`); its track takes one `chunkCard` per
//   shown chunk, then `newChunk`.
// - `renameBox` places the app's rename frame (`backlog-rename`) and returns it; the app keeps it `hidden` while no
//   rename is open.
// - `cursorActions` → `span.backlog-row-actions-slot`, which takes no box of its own; the app fills it with the cursor
//   prompt `span.backlog-row-actions` while the row is the selected row.
// - `trailing` → the picker's element for the end of the cursor row; pass it as `KitRowOptions.trailing`.
// `status`, `filterBar`, `filterBox`, `rows`, `body`, `chunks`, `renameBox` and `cursorActions` each place once per
// draw: a slot called twice throws `<slot> placed twice`, which fails the part, so it draws with `default`.
// What a part leaves out:
// - a slot: the app appends it at the end of the part's root; the cursor prompt with no `cursorActions` goes at the
//   end of the row root.
// - a `pickerRow`'s `trailing`: the app appends it at the end of the row root.
// The app sets the click on each `tableRow` root and toggles `is-selected`, `is-cursor`, `is-marked` and `is-started`
// there; it sets the click on each `chunkCard` and `newChunk` root and toggles `is-cursor` on the strip cursor's. So a
// row gives `kit.row`, and a card `kit.card`, no click. The list picker sets `title`, `is-selected`, `is-cursor` and
// the click on a `pickerRow` root.

// A pane's root, appended to `parent`. The `table` root fills `parent`, a grid of one `minmax(0, 1fr)` cell, and lays
// out its own children; the `review` root sits in the pane that scrolls; the `strip` root fills the strip's pane.
// `default` lays out its roots through their `backlog-pane` class.
export interface BacklogPane {
  element: HTMLElement;
}

// A follow-up's staleness, as main reads it from git: `stale` when a path it names is gone, `moved` when a commit
// touched one since it was written, `unknown` when it is not in git history, else `fresh`.
export type StalenessLevel = 'fresh' | 'moved' | 'stale' | 'unknown';

// The table's view filters: `repo` null for every repo; `marked` the count of marked rows.
export interface FiltersInput {
  repo: string | null;
  isReadyOnly: boolean;
  isChunkedHidden: boolean;
  isStaleFirst: boolean;
  isDoneShown: boolean;
  marked: number;
}
// One follow-up row. `staleness` is null until main has read it; `chunk` is the chunk holding the row, null for none.
export interface TableRowInput {
  repo: string;
  title: string;
  oneLine: string;
  tags: readonly string[];
  done: boolean;
  isReady: boolean;
  staleness: StalenessLevel | null;
  chunk: { name: string; isStarted: boolean } | null;
  isMarked: boolean;
}
// Why the table shows no rows: a filter matching nothing, every follow-up done while done ones are hidden, none
// agent-ready while ready-only is on, every one in a chunk while chunked rows are hidden, or no follow-ups at all.
export type EmptyReason =
  | 'filter'
  | 'allDone'
  | 'readyNone'
  | 'allChunked'
  | 'nothing';
export interface EmptyInput {
  reason: EmptyReason;
  filter: string;
}
// The cursor row's item. `shownPath` is its follow-up file's path with the home folder as `~`; `level` is null until
// main has read its staleness; `note` is the staleness line to show.
export interface ReviewItemInput {
  repo: string;
  title: string;
  oneLine: string;
  shownPath: string;
  body: string;
  tags: readonly string[];
  done: boolean;
  level: StalenessLevel | null;
  note: string;
  chunk: { name: string; isStarted: boolean } | null;
}
// The commits since the cursor item was written, newest first: null while they are read. `problem` is the read
// error's text, else null. `date` is the commit's date in ISO 8601 (`2026-10-21`).
export interface CommitsInput {
  commits:
    | readonly { shortSha: string; subject: string; date: string }[]
    | null;
  problem: string | null;
}
// One chunk of one repo's follow-ups; `count` is its item count.
export interface ChunkCardInput {
  repo: string;
  name: string;
  count: number;
  isHeadless: boolean;
  isStarted: boolean;
}
// `picker` is the open list's title ('Repos'); `label` is the row's line.
export interface PickerRowInput {
  picker: string;
  label: string;
}

// The kit every Backlog part draws with: the base kit, its keys in the part's scope.
export interface BacklogKit extends BaseKit {}
export interface TableKit extends BacklogKit {
  status(parent: HTMLElement): HTMLElement;
  filterBar(parent: HTMLElement): HTMLElement;
  filterBox(parent: HTMLElement): HTMLElement;
  rows(parent: HTMLElement): HTMLElement;
}
export interface ReviewKit extends BacklogKit {
  body(parent: HTMLElement): HTMLElement;
}
export interface StripKit extends BacklogKit {
  chunks(parent: HTMLElement): HTMLElement;
  renameBox(parent: HTMLElement): HTMLElement;
}
export interface RowKit extends BacklogKit {
  cursorActions(parent: HTMLElement): HTMLElement;
}
export interface PickerRowKit extends BacklogKit {
  // The app's element for the end of the cursor row, or null on every other row; pass it as
  // `KitRowOptions.trailing`.
  trailing(): HTMLElement | null;
}

// A user layout defines only the parts it changes; `default` draws the rest. The `table`, `review` and `strip` panes
// are drawn into app-owned containers once per layout set; `filters`, `tableRow`, `empty`, `reviewItem`, `commits`,
// `chunkCard`, `newChunk` and `pickerRow` on every render, one call per item. Kit scopes: `table`, `filters`,
// `tableRow` and `empty` `backlog.table`; `review`, `reviewItem` and `commits` `backlog.review`; `strip`, `chunkCard`
// and `newChunk` `backlog.strip`; `pickerRow` `backlog.picker`. A user layout's `table` part draws the `rescan`,
// `sweep` and `startAllChunks` hints itself, and its `strip` part the `renameChunk`, `toggleHeadless`, `startChunk`
// and `startAllChunks` hints: none of their keys is a vim key.
export interface BacklogLayout {
  table?(parent: HTMLElement, kit: TableKit): BacklogPane;
  filters?(
    parent: HTMLElement,
    input: FiltersInput,
    kit: BacklogKit,
  ): HTMLElement;
  tableRow?(
    parent: HTMLElement,
    input: TableRowInput,
    kit: RowKit,
  ): HTMLElement;
  empty?(parent: HTMLElement, input: EmptyInput, kit: BacklogKit): HTMLElement;
  review?(parent: HTMLElement, kit: ReviewKit): BacklogPane;
  reviewItem?(
    parent: HTMLElement,
    input: ReviewItemInput,
    kit: BacklogKit,
  ): HTMLElement;
  commits?(
    parent: HTMLElement,
    input: CommitsInput,
    kit: BacklogKit,
  ): HTMLElement;
  strip?(parent: HTMLElement, kit: StripKit): BacklogPane;
  chunkCard?(
    parent: HTMLElement,
    input: ChunkCardInput,
    kit: BacklogKit,
  ): HTMLElement;
  newChunk?(parent: HTMLElement, kit: BacklogKit): HTMLElement;
  pickerRow?(
    parent: HTMLElement,
    input: PickerRowInput,
    kit: PickerRowKit,
  ): HTMLElement;
}

// A layout with every part defined, as `default` is.
export interface CompleteBacklogLayout extends Required<BacklogLayout> {}

export type { KitRowOptions };
