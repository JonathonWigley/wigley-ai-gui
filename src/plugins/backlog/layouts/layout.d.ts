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
// - `homeRows` → `ol.backlog-home-rows`, `rows` → `ol.backlog-rows`, `body` → `div.backlog-detail-body`; the app
//   replaces their children on each draw.
// - `filterBox` places the app's filter frame (`backlog-filter`) and returns it; the app keeps the one frame and its
//   input across every redraw.
// - `editor` → `div.backlog-editor`; the app keeps it `hidden` while no editor is open and draws the `editor` pane
//   into it on open.
// - `textBox` appends the field's frame (`ui-input backlog-editor-box backlog-editor-box--<field>`) to `parent`,
//   mounts the field's vim box in it with the draft text, and returns the frame. Each field mounts once per draw.
// - `cursorActions` → `span.backlog-row-actions-slot`, which takes no box of its own; the app fills it with the cursor
//   prompt `span.backlog-row-actions` while the row is the selected row.
// - `document` → `div.md` holding the rendered doc, or the `emptyState` of `problem` when `problem` is not null.
// - `trailing` → the picker's element for the end of the cursor row; pass it as `KitRowOptions.trailing`.
// What a part leaves out:
// - a slot: the app appends it at the end of the part's root; the cursor prompt with no `cursorActions` goes at the
//   end of the row root.
// - a field box of the `editor` pane: the app appends a `label.backlog-editor-label` and the frame at the end of the
//   pane, so `Ctrl+n` / `Ctrl+p` always reach four boxes.
// - a `pickerRow`'s `trailing`: the app appends it at the end of the row root.
// - a `confirmBody`'s button: the prompt appends it to its actions row, so both commands keep an anchor.
// The app sets the click on each row root and toggles `is-selected` and `is-cursor` there, so a row gives `kit.row`
// no `onClick`. The list picker sets `title`, `is-selected`, `is-cursor` and the click on a `pickerRow` root.

// A pane's root, appended to `parent`. The `homes` and `list` roots fill `parent`, a grid of one `minmax(0, 1fr)` cell,
// and lay out their own children; the `detail` root sits in the pane that scrolls, and the `editor` root is the one
// item of a flex column. `default` lays out its roots through their `backlog-pane` class.
export interface BacklogPane {
  element: HTMLElement;
}

export interface EditorInput {
  kind: 'create' | 'edit';
  // 'New follow-up' or 'Edit follow-up'.
  heading: string;
}
export interface RepoHeaderInput {
  repo: string;
}
// `shownRoot` is `root` with the home folder as `~`.
export interface HomeRowInput {
  repo: string;
  root: string;
  shownRoot: string;
  isCreateTarget: boolean;
  uncommitted: boolean;
}
export interface GroupHeaderInput {
  section: 'followup' | 'plan' | 'feature';
  title: string;
}
export interface FollowupRowInput {
  title: string;
  oneLine: string;
  tags: readonly string[];
  done: boolean;
}
export interface PlanRowInput {
  title: string;
  feature: string;
  checked: number;
  total: number;
  target: string | null;
  written: string | null;
  isExpanded: boolean;
}
export interface FeatureRowInput {
  slug: string;
  checked: number;
  total: number;
  isExpanded: boolean;
}
export interface TaskRowInput {
  title: string;
  status: string | null;
}
// Why the list shows no rows: no home open, a filter matching nothing, every follow-up done or not agent-ready while
// those are hidden, or nothing in the home.
export type EmptyReason =
  | 'noHome'
  | 'filter'
  | 'allDone'
  | 'agentReadyNone'
  | 'nothing';
export interface EmptyInput {
  reason: EmptyReason;
  filter: string;
}
export interface FollowupDetailInput {
  title: string;
  oneLine: string;
  tags: readonly string[];
  body: string;
}
// Drawn once the doc's read settles; `problem` is the read error's text, else null.
export interface DocDetailInput {
  path: string;
  shownPath: string;
  problem: string | null;
}
// `picker` is the open list's title ('Tags'); `label` is the row's line.
export interface PickerRowInput {
  picker: string;
  label: string;
}
// `body` is the prompt's body text.
export interface ConfirmBodyInput {
  kind: 'delete' | 'discard';
  body: string;
}

// The kit every Backlog part draws with: the base kit, its keys in the part's scope.
export interface BacklogKit extends BaseKit {}
export interface HomesKit extends BacklogKit {
  status(parent: HTMLElement): HTMLElement;
  homeRows(parent: HTMLElement): HTMLElement;
}
export interface ListKit extends BacklogKit {
  filterBox(parent: HTMLElement): HTMLElement;
  rows(parent: HTMLElement): HTMLElement;
}
export interface DetailKit extends BacklogKit {
  body(parent: HTMLElement): HTMLElement;
  editor(parent: HTMLElement): HTMLElement;
}
export interface EditorKit extends BacklogKit {
  textBox(
    parent: HTMLElement,
    field: 'title' | 'oneLine' | 'tags' | 'body',
  ): HTMLElement;
}
export interface RowKit extends BacklogKit {
  cursorActions(parent: HTMLElement): HTMLElement;
}
export interface DocKit extends BacklogKit {
  document(parent: HTMLElement): HTMLElement;
}
export interface PickerRowKit extends BacklogKit {
  // The app's element for the end of the cursor row, or null on every other row; pass it as
  // `KitRowOptions.trailing`.
  trailing(): HTMLElement | null;
}
export interface ConfirmBodyKit extends BacklogKit {
  // The prompt's own buttons (label, variant, key anchor in `backlog.confirm`), each appended to `parent`.
  keepButton(parent: HTMLElement): HTMLButtonElement;
  confirmButton(parent: HTMLElement): HTMLButtonElement;
}

// A user layout defines only the parts it changes; `default` draws the rest. The `homes`, `list` and `detail` panes are
// drawn into app-owned containers once per layout set, the `editor` pane on each editor open and again on a layout
// set while it is open; rows and entries on every render, one call per item. Kit scopes: `homes` and `list` and
// their rows `backlog.list`, `detail` and its entries `backlog.detail`, `editor` `backlog.editor`, `pickerRow`
// `backlog.picker`, `confirmBody` `backlog.confirm`.
export interface BacklogLayout {
  homes?(parent: HTMLElement, kit: HomesKit): BacklogPane;
  list?(parent: HTMLElement, kit: ListKit): BacklogPane;
  detail?(parent: HTMLElement, kit: DetailKit): BacklogPane;
  editor?(parent: HTMLElement, input: EditorInput, kit: EditorKit): BacklogPane;
  repoHeader?(
    parent: HTMLElement,
    input: RepoHeaderInput,
    kit: BacklogKit,
  ): HTMLElement;
  homeRow?(
    parent: HTMLElement,
    input: HomeRowInput,
    kit: BacklogKit,
  ): HTMLElement;
  groupHeader?(
    parent: HTMLElement,
    input: GroupHeaderInput,
    kit: BacklogKit,
  ): HTMLElement;
  followupRow?(
    parent: HTMLElement,
    input: FollowupRowInput,
    kit: RowKit,
  ): HTMLElement;
  planRow?(parent: HTMLElement, input: PlanRowInput, kit: RowKit): HTMLElement;
  featureRow?(
    parent: HTMLElement,
    input: FeatureRowInput,
    kit: RowKit,
  ): HTMLElement;
  taskRow?(parent: HTMLElement, input: TaskRowInput, kit: RowKit): HTMLElement;
  empty?(parent: HTMLElement, input: EmptyInput, kit: BacklogKit): HTMLElement;
  followupDetail?(
    parent: HTMLElement,
    input: FollowupDetailInput,
    kit: BacklogKit,
  ): HTMLElement;
  docDetail?(
    parent: HTMLElement,
    input: DocDetailInput,
    kit: DocKit,
  ): HTMLElement;
  pickerRow?(
    parent: HTMLElement,
    input: PickerRowInput,
    kit: PickerRowKit,
  ): HTMLElement;
  confirmBody?(
    parent: HTMLElement,
    input: ConfirmBodyInput,
    kit: ConfirmBodyKit,
  ): HTMLElement;
}

// A layout with every part defined, as `default` is.
export interface CompleteBacklogLayout extends Required<BacklogLayout> {}

export type { KitRowOptions };
