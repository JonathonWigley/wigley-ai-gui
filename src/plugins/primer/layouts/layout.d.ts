import type {
  BaseKit,
  ConfirmButtonsKit,
  DialogFrameInput,
  DialogFramePart,
} from '../../../shared/page/layout-host/kit';

// The primer layout contract: what a layout in `layouts/primer/<name>/layout.js` draws the primer popup with. A layout
// defines only the parts it changes; every part it leaves out, and every part that throws or returns no element
// appended to `parent`, is drawn by `default` instead. The app sets `data-layout-owner="primer"` and
// `data-layout="<name>"` on the element each part returns, `<name>` being the layout that drew it, so
// `[data-layout-owner="primer"][data-layout="<name>"] …` in a layout's CSS selects only its own parts.
//
// The app keeps the two nested splits (tasks | (items | card)), their widths and their handles' resize prompt
// (`⌥⇧H ◂ ▸ ⌥⇧L`); the tasks column header (save state, `⌃H ▲ ▼ ⌃L`, `⌥L items ›`) and foot (the Review button); the
// items column header (`‹ tasks ⌥H`, `⌃H ▲ ▼ ⌃L`, `⌥L card ›`); the card edge strip (`‹ items ⌥H`); the review footer
// (Back, Cancel primer, Send), the cancel prompt's scrim, keys and focus (`dialogFrame` and `confirmBody` draw its
// panel, title, body and buttons), selection, each column's selected row prompt, the text boxes and
// scrolling.

export type PrimerNeed = 'yes' | 'no' | 'unclear';
// `extra` is a task the user added; an agent sends only `primer` and `standing`.
export type PrimerGroup = 'primer' | 'standing' | 'extra';

// The feature's fields as the user edited them.
export interface FeatureCardInput {
  name: string;
  slug: string;
  spec: string;
  summary: string;
  notes: string;
}

// One task as the user edited it. `name` is the name the tasks column shows (`Unnamed task` for an extra task with a
// blank name); `itemCount` is how many items it holds; `canAddItem` is false once it holds the most items a task takes.
export interface TaskCardInput {
  id: string;
  group: PrimerGroup;
  number: number | null;
  area: string;
  name: string;
  need: PrimerNeed;
  question: string;
  evidence: string;
  probes: string;
  pointer: string;
  itemCount: number;
  canAddItem: boolean;
}

// One item of a task. `number` is its 1-based place among its task's items, and `count` the task's item count;
// `added` marks an item the user added, whose text the card edits in its `text` box. The app rebuilds the card when
// the task's item count changes.
export interface ItemCardInput {
  entryId: string;
  taskName: string;
  number: number;
  count: number;
  text: string;
  include: boolean;
  added: boolean;
}

// `element` is the card's own node, appended to `parent` before the card mounts a text box. `update` runs with the
// card's current input on each primer change while the card shows; a throw from it is logged once and the card stays.
// The app rebuilds the card when it shows another row, and a task card when its add-item box comes or goes.
export interface PrimerLayoutCard<Input> {
  element: HTMLElement;
  update?(input: Input): void;
}

// A card per row kind: the Feature row's and a task row's, from the tasks column, and an item row's, from the items
// column.
export interface PrimerLayoutCards {
  feature(
    parent: HTMLElement,
    input: FeatureCardInput,
    kit: FeatureKit,
  ): PrimerLayoutCard<FeatureCardInput>;
  task(
    parent: HTMLElement,
    input: TaskCardInput,
    kit: TaskKit,
  ): PrimerLayoutCard<TaskCardInput>;
  item(
    parent: HTMLElement,
    input: ItemCardInput,
    kit: ItemKit,
  ): PrimerLayoutCard<ItemCardInput>;
}

// One tasks column row. `position` is its 0-based place in the tasks column, which `TasksKit.taskRow` takes. A task
// row counts its included items of `total`.
export type TaskRowInput =
  | { position: number; kind: 'feature'; name: string }
  | {
      position: number;
      kind: 'task';
      entryId: string;
      group: PrimerGroup;
      name: string;
      need: PrimerNeed;
      included: number;
      total: number;
    };

// A group of tasks under its header.
export interface TaskGroupInput {
  group: PrimerGroup;
  header: string;
  rows: TaskRowInput[];
}

// The Feature row, then the groups in tasks column order: Primer and Every feature only while they hold a task, Extra
// tasks always.
export interface TasksInput {
  feature: TaskRowInput;
  groups: TaskGroupInput[];
}

// One item of the selected task. `position` is its 0-based place in the items column, which `ItemsKit.itemRow`
// takes; `number` is position + 1; `added` marks an item the user added.
export interface ItemRowInput {
  position: number;
  entryId: string;
  number: number;
  text: string;
  include: boolean;
  added: boolean;
}

// The selected task's items. `task` is null on the Feature row. `empty` is the empty state copy, null while rows
// show.
export interface ItemsInput {
  task: { entryId: string; name: string } | null;
  rows: ItemRowInput[];
  empty: string | null;
}

// `isCursor` is true on the one task under the review's cursor (`j`/`k`, `gg`/`G`; `Enter` jumps to it).
export interface ReviewTaskInput {
  id: string;
  isCursor: boolean;
  name: string;
  need: PrimerNeed;
  comment: string;
  items: { text: string; include: boolean; comment: string }[];
}

// The tallies of every task's need and every item, what blocks a send (empty when the primer may send), the feature's
// fields in card order, and the tasks in tasks column order.
export interface ReviewInput {
  tallies: {
    yes: number;
    no: number;
    unclear: number;
    included: number;
    items: number;
  };
  problems: string[];
  feature: { label: string; value: string }[];
  tasks: ReviewTaskInput[];
}

// `element` is the pane body's own node, appended to `parent`; the app sets `data-layout` on it.
export interface PrimerLayoutPane {
  element: HTMLElement;
}

// Every part appends itself to `parent` and returns what it appended. `keyHint`, `keys` and `keysFor` read the scope
// of the part drawing: `primer.card` for the cards, `primer.tasks` for the tasks part, `primer.items` for the items
// part, `primer.review` for the review.
export interface PrimerKit extends BaseKit {
  // The need's Tag: Yes (success), No (neutral) or Unclear (warning).
  needTag(parent: HTMLElement, need: PrimerNeed): HTMLElement;
}

// A text box in its labelled field (`div.primer-field`), with its key hint beside the label and its `⇧⇥ ⇥` box keys
// on the frame. Each box mounts once per card; asking for it again, or for a box the card does not have, throws. The
// app appends each box a card leaves out at the card's end, in its field, so the box keys always reach it; `⇥` and
// `⇧⇥` step through the boxes in the app's order, whatever their place on the card.
export interface FeatureKit extends PrimerKit {
  textBox(
    parent: HTMLElement,
    field: 'name' | 'slug' | 'spec' | 'summary' | 'notes',
  ): HTMLElement;
}

// `name` exists only on an extra task, and `newItem` only while `canAddItem`.
export interface TaskKit extends PrimerKit {
  textBox(
    parent: HTMLElement,
    field: 'name' | 'newItem' | 'comment',
  ): HTMLElement;
}

// `text` exists only on an item the user added; an agent's item text is read-only. An added item's text left blank
// when a key leaves its box, or when the review opens, removes the item, as the add-item box adds none for blank text.
export interface ItemKit extends PrimerKit {
  textBox(parent: HTMLElement, field: 'text' | 'comment'): HTMLElement;
  // The item's ToggleMark: a click toggles the item, and it shows the item's include on each change while the card
  // shows.
  includeMark(parent: HTMLElement): HTMLElement;
  // The key hint of the row step `command` (`span.ui-key-stack.primer-item-step-keys`): the items column and the card
  // both step through the items, so it shows the focused pane's key (the items column binds `k`/`<C-h>` and
  // `j`/`<C-l>`, the card `<C-h>` and `<C-l>`).
  stepKey(parent: HTMLElement, command: 'prevRow' | 'nextRow'): HTMLElement;
}

// The app knows rows only by the elements a column's row function returns: it keeps on each the click that selects it
// and focuses its column, `is-selected` while it is the column's selected row, and the selected row's prompt. A row
// drawn otherwise gets no click and no selection, and when a part never calls its row function for the selected row,
// the row prompt is appended at the end of the part's element. A row function throws for a position its column does
// not hold.
export interface TasksKit extends PrimerKit {
  // The list row for tasks column `position`: the Feature row with the feature's name, or a task row with its need tag
  // and included count. Its prompt holds the need keys and, on an extra task, the remove key.
  taskRow(parent: HTMLElement, position: number): HTMLElement;
  // The `A add` key hint for adding an extra task.
  addPrompt(parent: HTMLElement): HTMLElement;
}

export interface ItemsKit extends PrimerKit {
  // The list row for items column `position`, led by its include mark and number. Its prompt holds the need keys and
  // the include key; a click on its mark selects the item and toggles it.
  itemRow(parent: HTMLElement, position: number): HTMLElement;
}

export type ReviewKit = PrimerKit;

// The cancel confirm's body text.
export interface ConfirmBodyInput {
  body: string;
}
export interface ConfirmBodyKit extends PrimerKit, ConfirmButtonsKit {}

export interface PrimerLayout {
  cards?: Partial<PrimerLayoutCards>;
  // The tasks column's body, under the app's header and over its Review button, drawn again on each primer change.
  tasks?(
    parent: HTMLElement,
    input: TasksInput,
    kit: TasksKit,
  ): PrimerLayoutPane;
  // The items column's body, under the app's header, drawn again on each primer change.
  items?(
    parent: HTMLElement,
    input: ItemsInput,
    kit: ItemsKit,
  ): PrimerLayoutPane;
  // The review's body, over the app's Back, Cancel primer and Send buttons, drawn again on each primer change while
  // the review shows.
  review?(
    parent: HTMLElement,
    input: ReviewInput,
    kit: ReviewKit,
  ): PrimerLayoutPane;
  // The cancel confirm's body, scope `primer.confirm`: `input.body` and the prompt's two buttons. A button the part
  // leaves out goes at the end of the frame's actions row.
  confirmBody?(
    parent: HTMLElement,
    input: ConfirmBodyInput,
    kit: ConfirmBodyKit,
  ): HTMLElement;
  // The frame of the cancel confirm: the panel, its title (`input.title`) and, when `input.hasActions`, its actions
  // row. Return the panel, appended to `parent`, with `body` and `actions` inside it; the app fills them. The app
  // keeps the scrim, showing and hiding, keys and focus. A frame whose `body` or `actions` is not inside its panel,
  // or whose `actions` is not null exactly when `hasActions` is false, draws with `default`.
  dialogFrame?(
    parent: HTMLElement,
    input: DialogFrameInput,
    kit: PrimerKit,
  ): DialogFramePart;
}

// The built-in `default` layout, which defines every part.
export interface CompletePrimerLayout extends PrimerLayout {
  cards: PrimerLayoutCards;
  tasks(
    parent: HTMLElement,
    input: TasksInput,
    kit: TasksKit,
  ): PrimerLayoutPane;
  items(
    parent: HTMLElement,
    input: ItemsInput,
    kit: ItemsKit,
  ): PrimerLayoutPane;
  review(
    parent: HTMLElement,
    input: ReviewInput,
    kit: ReviewKit,
  ): PrimerLayoutPane;
  confirmBody(
    parent: HTMLElement,
    input: ConfirmBodyInput,
    kit: ConfirmBodyKit,
  ): HTMLElement;
  dialogFrame(
    parent: HTMLElement,
    input: DialogFrameInput,
    kit: PrimerKit,
  ): DialogFramePart;
}
