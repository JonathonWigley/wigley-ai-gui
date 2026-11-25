import type {
  BaseKit,
  ConfirmButtonsKit,
  DialogFrameInput,
  DialogFramePart,
  KitRowOptions,
} from '../../../shared/page/layout-host/kit';

// The contract of a Schedules layout. Each part appends its root element to `parent` and returns it; the app sets
// `data-layout="<name>"` and `data-layout-owner="scheduling"` on that root. A layout's `layout.css` restyles under
// `[data-layout-owner="scheduling"][data-layout="<name>"]`.
//
// Slots. A slot member places an element the app owns or fills:
// - `rows` → `ol.scheduling-rows`; the app replaces its children on each render: the `newTaskRow`, then one `taskRow`
//   per task in the file's order.
// - `notices` → `div.scheduling-notices`; the app draws one `notice` per notice into it on each render.
// - `body` → `div.scheduling-body`; the app draws the `taskDetail` part, or the `empty` part, into it.
// - `history` → `div.scheduling-history`; the app draws one `historyRow` per run into it, newest first, under its own
//   `History` header, or `No runs yet.`; it hides while no task is selected.
// - `editor` → `div.scheduling-editor`; the app draws the `editor` part into it while the editor is open, and hides
//   `body` and `history` meanwhile.
// - `fields` → `ol.scheduling-fields`; the app draws one `fieldRow` per editor row into it.
// - `textBox` appends the row's box frame (`ui-input scheduling-box`) to `parent`, places the vim box in it with the
//   row's text, and returns the frame. A `choice` row has no box: its `textBox` throws `<field> has no box`.
// - `cursorActions` → `span.scheduling-row-actions`, the app's key prompts for what the row's keys do (edit, pause or
//   resume, run now and remove on a task row; open on the "+ New task" row and on a linked history row). The app's
//   `schedules.css` shows it on the `is-cursor` row only.
// - `editButton`, `pauseButton`, `runNowButton` and `removeButton` each append the app's button (its label, variant
//   and key hint in `scheduling.detail`) to `parent` and return it; a click runs its command.
// Each slot places once per draw: a slot called twice throws `<slot> placed twice`, which fails the part, so it draws
// with `default`. A slot the part leaves out the app appends at the end of the part's root (a button it leaves out is
// not drawn; its key still runs it); so does a `confirmBody`'s button the prompt appends to its actions row, so both
// commands keep an anchor.
// The app sets the click on each `newTaskRow`, `taskRow` and linked `historyRow` root and toggles there `is-selected`
// (the selected row) and `is-cursor` (the selected row while its pane has the keys), and on a `fieldRow` root
// `is-cursor` (the editor's field cursor), so a row gives `kit.row` no `onClick`.

// A pane's root, appended to `parent`. The `list` root fills the side bar's `div.scheduling-list`, the `detail` root
// the sheet's `div.scheduling-main`, and the `editor` root the `editor` slot; each lays out its own children.
export interface SchedulingPane {
  element: HTMLElement;
}

// One task row: `scheduleText` reads as `Daily at 09:00`; `next` is `Paused` while `paused`, else `Next <YYYY-MM-DD
// HH:MM>` or `No next run`, and empty in an app that never runs tasks.
export interface TaskRowInput {
  name: string;
  scheduleText: string;
  next: string;
  paused: boolean;
}
// Why the details pane shows no task: none exists, or the "+ New task" row is selected.
export interface EmptyInput {
  reason: 'noTasks' | 'newTask';
}
// One line over the details: the dev app that never runs tasks, a task file error, or the login start's state.
export interface NoticeInput {
  kind: 'dev' | 'fileError' | 'loginStart';
  text: string;
  tone: 'neutral' | 'warning' | 'error';
}
// The selected task. `project` is the folder with the home folder as `~`, or the pool project's name; `next` as in
// `TaskRowInput`; `controls` one entry per harness control the task sets, labelled as the harness labels it;
// `attended` true when each run starts with headless off, only while the app is open.
export interface TaskDetailInput {
  name: string;
  project: string;
  profile: string;
  scheduleText: string;
  next: string;
  controls: { label: string; value: string }[];
  prompt: string;
  paused: boolean;
  attended: boolean;
}
// One run, newest first. `when` is the run's planned time as local `YYYY-MM-DD HH:MM`; `text` reads `Running`,
// `Finished`, `Skipped, previous run still going` or `Failed to start: <reason>`; `linked` is true while the run's row
// is open in the side bar, and a linked row opens it.
export interface HistoryRowInput {
  when: string;
  outcome: 'running' | 'finished' | 'skipped' | 'failed';
  text: string;
  linked: boolean;
}
// One editor row. `value` is a box row's text, or a choice row's shown choice; `hint` says what to type, null for
// none. A `box` row holds one line, a `multiline` row many; a `choice` row opens a list of its choices.
export interface FieldRowInput {
  field: string;
  label: string;
  value: string;
  hint: string | null;
  kind: 'box' | 'choice' | 'multiline';
}
// The open editor: `heading` is `New task` or `Edit <name>`; `envNote` says which environment a run gets; `problem`
// is why the last save was refused, null for none.
export interface EditorInput {
  kind: 'create' | 'edit';
  heading: string;
  envNote: string;
  problem: string | null;
}
// `picker` is the open list's title (the row's label, as `Profile`); `label` is the row's line.
export interface PickerRowInput {
  picker: string;
  label: string;
}
export interface ConfirmBodyInput {
  body: string;
}

// The kit every Schedules part draws with: the base kit, its keys in the part's scope.
export interface SchedulingKit extends BaseKit {}
export interface ListKit extends SchedulingKit {
  rows(parent: HTMLElement): HTMLElement;
}
export interface DetailKit extends SchedulingKit {
  notices(parent: HTMLElement): HTMLElement;
  body(parent: HTMLElement): HTMLElement;
  history(parent: HTMLElement): HTMLElement;
  editor(parent: HTMLElement): HTMLElement;
}
export interface EditorKit extends SchedulingKit {
  fields(parent: HTMLElement): HTMLElement;
}
export interface FieldRowKit extends SchedulingKit {
  // A second call throws `textBox placed twice`, so the part draws with `default`.
  textBox(parent: HTMLElement): HTMLElement;
}
export interface RowKit extends SchedulingKit {
  cursorActions(parent: HTMLElement): HTMLElement;
}
export interface TaskDetailKit extends SchedulingKit {
  editButton(parent: HTMLElement): HTMLButtonElement;
  pauseButton(parent: HTMLElement): HTMLButtonElement;
  runNowButton(parent: HTMLElement): HTMLButtonElement;
  removeButton(parent: HTMLElement): HTMLButtonElement;
}
export interface PickerRowKit extends SchedulingKit {
  // The app's element for the end of the cursor row, or null on every other row; pass it as
  // `KitRowOptions.trailing`.
  trailing(): HTMLElement | null;
}
export interface ConfirmBodyKit extends SchedulingKit, ConfirmButtonsKit {}

// A user layout defines only the parts it changes; `default` draws the rest. The `list` and `detail` panes are drawn
// into app-owned containers once per layout set; `editor` into the `editor` slot each time the editor opens and when
// its heading or problem changes; the rows, `empty`, `notice`, `taskDetail` and `fieldRow` on every render that
// changes what they show, one call per item; `pickerRow` per row of an open choice list. `confirmBody` draws the
// remove and discard confirms' body, and `dialogFrame` their panel and title (the app keeps the scrim, keys and
// focus). Kit scopes: `list`, `newTaskRow` and `taskRow` `scheduling.list`; `detail`, `notice`, `empty`, `taskDetail`
// and `historyRow` `scheduling.detail`; `editor` and `fieldRow` `scheduling.editor`; `pickerRow`
// `scheduling.picker`; `confirmBody` and `dialogFrame` `scheduling.confirm`.
export interface SchedulingLayout {
  list?(parent: HTMLElement, kit: ListKit): SchedulingPane;
  detail?(parent: HTMLElement, kit: DetailKit): SchedulingPane;
  editor?(
    parent: HTMLElement,
    input: EditorInput,
    kit: EditorKit,
  ): SchedulingPane;
  newTaskRow?(parent: HTMLElement, kit: RowKit): HTMLElement;
  taskRow?(parent: HTMLElement, input: TaskRowInput, kit: RowKit): HTMLElement;
  empty?(
    parent: HTMLElement,
    input: EmptyInput,
    kit: SchedulingKit,
  ): HTMLElement;
  notice?(
    parent: HTMLElement,
    input: NoticeInput,
    kit: SchedulingKit,
  ): HTMLElement;
  taskDetail?(
    parent: HTMLElement,
    input: TaskDetailInput,
    kit: TaskDetailKit,
  ): HTMLElement;
  historyRow?(
    parent: HTMLElement,
    input: HistoryRowInput,
    kit: RowKit,
  ): HTMLElement;
  fieldRow?(
    parent: HTMLElement,
    input: FieldRowInput,
    kit: FieldRowKit,
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
  // The frame of the remove and discard confirms: the panel, its title (`input.title`) and, when `input.hasActions`,
  // its actions row. Return the panel, appended to `parent`, with `body` and `actions` inside it; the app fills them.
  // The app keeps the scrim, showing and hiding, keys and focus. A frame whose `body` or `actions` is not inside its
  // panel, or whose `actions` is not null exactly when `hasActions` is false, draws with `default`.
  dialogFrame?(
    parent: HTMLElement,
    input: DialogFrameInput,
    kit: SchedulingKit,
  ): DialogFramePart;
}

// A layout with every part defined, as `default` is.
export interface CompleteSchedulingLayout extends Required<SchedulingLayout> {}

export type { KitRowOptions };
