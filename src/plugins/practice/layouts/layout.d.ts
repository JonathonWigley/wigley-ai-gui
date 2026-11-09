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
// - `tabs` → the app's `nav.ui-tabs` strip of the pane's tabs; the app toggles `is-active` on the shown tab and runs a
//   click on a tab.
// - `body` → `div.practice-tab-body`, the pane that scrolls; the app draws the shown tab's part into it.
// - `actions` → `span.practice-console-actions`, holding the app's Run and Submit buttons with their key hints.
// - `editor` → `div.practice-editor`, the document editor's parent, which fills its height; `saveState` →
//   `span.practice-save-state`, whose text the app sets to the code's save state.
// - `document` → `div.md` holding the rendered markdown (the statement, a submission's code, or the approach and the
//   reference solution).
// - `textBox` appends the box's frame (`ui-input practice-box practice-box--notes` or `practice-box--customCases`) to
//   `parent`, mounts the vim box in it with the draft text, and returns the frame.
// - `failingCase` → `div.practice-failing-case`; the app draws the `caseResult` part into it when a case failed.
// Each slot places once per draw: a slot called twice throws `<slot> placed twice`, which fails the part, so it draws
// with `default`. A slot the part leaves out the app appends at the end of the part's root; so does a `confirmBody`'s
// button the prompt appends to its actions row, so both commands keep an anchor.
// The app sets the click on each `problemRow` root and toggles there `is-selected` (the selected row), `is-cursor`
// (the selected row while the list has focus and no filter box is open) and `is-open` (the open problem), so a row
// gives `kit.row` no `onClick`. It sets the click on each `submissionRow` root and toggles `is-selected` and
// `is-cursor` on the cursor row the same way.

// A pane's root, appended to `parent`. The `list` root fills the side bar's `div.practice-list`, a grid of one
// `minmax(0, 1fr)` cell, and lays out its own children; `default` lays it out through its `practice-pane` class. The
// `problemPane`, `editorPane` and `consolePane` roots each fill one of the column's stacked panes the same way.
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
// Why a list shows no rows: the first read has not landed, no problem exists, the filter matches none, or the open
// problem has no submissions.
export type EmptyReason = 'loading' | 'noProblems' | 'filter' | 'noSubmissions';
export interface EmptyInput {
  reason: EmptyReason;
  filter: string;
}

// The open problem's summary, for the Description tab's head.
export interface DescriptionInput {
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  lists: string[];
}
export type Verdict =
  | 'accepted'
  | 'wrongAnswer'
  | 'timeLimit'
  | 'runtimeError'
  | 'compileError';
// One Submit, newest first. `time` is local `YYYY-MM-DD HH:mm`; `verdictLabel` LeetCode's name for `verdict`
// (`Wrong Answer`); `runtime` `<ms> ms`.
export interface SubmissionRowInput {
  time: string;
  verdict: Verdict;
  verdictLabel: string;
  passed: number;
  total: number;
  runtime: string;
}
export interface SubmissionCodeInput {
  time: string;
  verdictLabel: string;
}
export interface SolutionInput {
  approach: string;
  reference: string;
}
export interface EditorPaneInput {
  fileName: string;
}
// The last Run or Submit: `empty` before any, `running` while one runs, `done` with its verdict, or `failed` with the
// invoke's error in `message`. `runtime` is `<ms> ms`; `compileOutput` is set for `compileError`, `stderr` the failing
// case's for `runtimeError`.
export interface ResultInput {
  state: 'empty' | 'running' | 'done' | 'failed';
  kind: 'run' | 'submit' | null;
  verdict: Verdict | null;
  verdictLabel: string | null;
  passed: number;
  total: number;
  runtime: string | null;
  message: string | null;
  compileOutput: string | null;
  stderr: string | null;
}
// The failing case: `label` `Case <n>`; `input` one `name = value` line per parameter (a design case as JSON);
// `expected` and `output` as JSON, `output` `No output` when the program wrote none.
export interface CaseResultInput {
  label: string;
  source: 'example' | 'custom' | 'hidden';
  input: string;
  expected: string;
  output: string;
  stdout: string;
}
export interface ConfirmBodyInput {
  body: string;
}

// The kit every Practice part draws with: the base kit, its keys in the part's scope.
export interface PracticeKit extends BaseKit {}
export interface ListKit extends PracticeKit {
  header(parent: HTMLElement): HTMLElement;
  filterBox(parent: HTMLElement): HTMLElement;
  rows(parent: HTMLElement): HTMLElement;
  importHint(parent: HTMLElement): HTMLElement;
}
export interface TabbedPaneKit extends PracticeKit {
  tabs(parent: HTMLElement): HTMLElement;
  body(parent: HTMLElement): HTMLElement;
}
export interface ConsoleKit extends TabbedPaneKit {
  actions(parent: HTMLElement): HTMLElement;
}
export interface EditorPaneKit extends PracticeKit {
  editor(parent: HTMLElement): HTMLElement;
  saveState(parent: HTMLElement): HTMLElement;
}
export interface DocKit extends PracticeKit {
  document(parent: HTMLElement): HTMLElement;
}
export interface BoxKit extends PracticeKit {
  textBox(parent: HTMLElement): HTMLElement;
}
export interface ResultKit extends PracticeKit {
  failingCase(parent: HTMLElement): HTMLElement;
}
export interface ConfirmBodyKit extends PracticeKit {
  // The prompt's own buttons (label, variant, key anchor in `practice.confirm`), each appended to `parent`.
  keepButton(parent: HTMLElement): HTMLButtonElement;
  confirmButton(parent: HTMLElement): HTMLButtonElement;
}

// A user layout defines only the parts it changes; `default` draws the rest. The `list` pane is drawn into the side
// bar once per layout set; `listHeader`, the rows and `empty` on every render, one call per row; `noProblem` into the
// problem column while no problem is open. The `problemPane`, `editorPane` and `consolePane` are drawn into the
// column's three stacked panes once per layout set; the shown tab's part into its pane's `body` when what it shows
// changes, one `submissionRow` per submission (or `empty` with `noSubmissions`), and `caseResult` into the
// `resultTab`'s `failingCase`. `confirmBody` draws the Solution tab's confirm. Kit scopes: `list`, `listHeader`,
// `problemRow` and `empty` `practice.list`; `noProblem`, `problemPane`, the problem pane's tabs and `empty` with
// `noSubmissions` `practice.problem`;
// `editorPane` `practice.editor`; `consolePane`, `testcaseTab`, `resultTab` and `caseResult` `practice.console`;
// `confirmBody` `practice.confirm`. A user layout's `list` part draws the `filter` hint itself: `/` is not a vim key;
// its `problemPane` and `consolePane` draw the `prevTab` and `nextTab` hints, and its `notesTab` and `testcaseTab` the
// `editBox` hint.
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
  problemPane?(parent: HTMLElement, kit: TabbedPaneKit): PracticePane;
  editorPane?(
    parent: HTMLElement,
    input: EditorPaneInput,
    kit: EditorPaneKit,
  ): PracticePane;
  consolePane?(parent: HTMLElement, kit: ConsoleKit): PracticePane;
  descriptionTab?(
    parent: HTMLElement,
    input: DescriptionInput,
    kit: DocKit,
  ): HTMLElement;
  submissionRow?(
    parent: HTMLElement,
    input: SubmissionRowInput,
    kit: PracticeKit,
  ): HTMLElement;
  submissionCode?(
    parent: HTMLElement,
    input: SubmissionCodeInput,
    kit: DocKit,
  ): HTMLElement;
  notesTab?(parent: HTMLElement, kit: BoxKit): HTMLElement;
  solutionTab?(
    parent: HTMLElement,
    input: SolutionInput,
    kit: DocKit,
  ): HTMLElement;
  testcaseTab?(parent: HTMLElement, kit: BoxKit): HTMLElement;
  resultTab?(
    parent: HTMLElement,
    input: ResultInput,
    kit: ResultKit,
  ): HTMLElement;
  caseResult?(
    parent: HTMLElement,
    input: CaseResultInput,
    kit: PracticeKit,
  ): HTMLElement;
  confirmBody?(
    parent: HTMLElement,
    input: ConfirmBodyInput,
    kit: ConfirmBodyKit,
  ): HTMLElement;
}

// A layout with every part defined, as `default` is.
export interface CompletePracticeLayout extends Required<PracticeLayout> {}

export type { KitRowOptions };
