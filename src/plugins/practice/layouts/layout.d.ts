import type {
  BaseKit,
  KitRowOptions,
} from '../../../shared/page/layout-host/kit';

// The contract of a Practice layout. Each part appends its root element to `parent` and returns it; the app sets
// `data-layout="<name>"` and `data-layout-owner="practice"` on that root. A layout's `layout.css` restyles under
// `[data-layout-owner="practice"][data-layout="<name>"]`.
//
// Slots. A slot member places an element the app owns or fills:
// - `header` → `div.practice-list-header-slot`; the app draws the `listHeader` part into it on each render.
// - `filterBox` places the app's filter frame (`ui-input practice-filter`) and returns it; the app keeps the one frame
//   and its input across every redraw, hidden while no filter is open and the filter text is empty.
// - `rows` → `ol.practice-rows`; the app replaces its children on each render: one `problemRow` per shown problem, or
//   the `empty` part.
// - `importHint` → `span.practice-import-hint`, the app's span for the key hint that starts an import.
// `header`, `filterBox`, `rows` and `importHint` each place once per draw: a slot called twice throws
// `<slot> placed twice`, which fails the part, so it draws with `default`. A slot the part leaves out the app appends
// at the end of the part's root.
// The app sets the click on each `problemRow` root and toggles there `is-selected` (the selected row), `is-cursor`
// (the selected row while the list has focus and no filter box is open) and `is-open` (the open problem), so a row
// gives `kit.row` no `onClick`.

// A pane's root, appended to `parent`. The `list` root fills the side bar's `div.practice-list`, a grid of one
// `minmax(0, 1fr)` cell, and lays out its own children; `default` lays it out through its `practice-pane` class.
export interface PracticePane {
  element: HTMLElement;
}

// One entry per difficulty, easy first, counted over every loaded problem whatever the filter shows.
export interface ListHeaderInput {
  counts: {
    difficulty: 'easy' | 'medium' | 'hard';
    label: 'Easy' | 'Medium' | 'Hard';
    solved: number;
    total: number;
  }[];
}
// `isDue` is true once the problem's review date has come; `isOpen` while the column shows it.
export interface ProblemRowInput {
  slug: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  status: 'new' | 'attempted' | 'solved';
  isDue: boolean;
  isOpen: boolean;
}
// Why the list shows no rows: the first read has not landed, no problem exists, or the filter matches none.
export type EmptyReason = 'loading' | 'noProblems' | 'filter';
export interface EmptyInput {
  reason: EmptyReason;
  filter: string;
}

// The kit every Practice part draws with: the base kit, its keys in the part's scope.
export interface PracticeKit extends BaseKit {}
export interface ListKit extends PracticeKit {
  header(parent: HTMLElement): HTMLElement;
  filterBox(parent: HTMLElement): HTMLElement;
  rows(parent: HTMLElement): HTMLElement;
  importHint(parent: HTMLElement): HTMLElement;
}

// A user layout defines only the parts it changes; `default` draws the rest. The `list` pane is drawn into the side
// bar once per layout set; `listHeader`, the rows and `empty` on every render, one call per row; `noProblem` into the
// problem column while no problem is open. Kit scopes: `list`, `listHeader`, `problemRow` and `empty`
// `practice.list`, `noProblem` `practice.problem`. A user layout's `list` part draws the `filter` hint itself: `/` is
// not a vim key.
export interface PracticeLayout {
  list?(parent: HTMLElement, kit: ListKit): PracticePane;
  listHeader?(
    parent: HTMLElement,
    input: ListHeaderInput,
    kit: PracticeKit,
  ): HTMLElement;
  problemRow?(
    parent: HTMLElement,
    input: ProblemRowInput,
    kit: PracticeKit,
  ): HTMLElement;
  empty?(parent: HTMLElement, input: EmptyInput, kit: PracticeKit): HTMLElement;
  noProblem?(parent: HTMLElement, kit: PracticeKit): HTMLElement;
}

// A layout with every part defined, as `default` is.
export interface CompletePracticeLayout extends Required<PracticeLayout> {}

export type { KitRowOptions };
