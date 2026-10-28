import type { BaseKit } from '../../../shared/page/layout-host/kit';

// The primer layout contract: what a layout in `layouts/primer/<name>/layout.js` draws the Primer tab with. A layout
// defines only the parts it changes; every part it leaves out, and every part that throws or returns no element
// appended to `parent`, is drawn by `default` instead. The app sets `data-layout-owner="primer"` and
// `data-layout="<name>"` on the element each part returns, `<name>` being the layout that drew it, so
// `[data-layout-owner="primer"][data-layout="<name>"] …` in a layout's CSS selects only its own parts.
//
// The app keeps the split and its width, the rail header (save state, `⌃H ▲ ▼ ⌃L`, `⌥L card ›`), the rail foot's
// Review button, the card edge strip (`‹ rail ⌥H`), the review footer (Back, Cancel primer, Send), the cancel prompt,
// selection, the selected row's prompt, the text boxes and scrolling.

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

// One task as the user edited it. `name` is the name the rail shows (`Unnamed task` for an extra task with a blank
// name); `itemCount` is how many items it holds; `canAddItem` is false once it holds the most items a task takes.
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
// `added` marks an item the user added.
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
// The app rebuilds the card when another row is selected, and a task card when its add-item box comes or goes.
export interface PrimerLayoutCard<Input> {
  element: HTMLElement;
  update?(input: Input): void;
}

// A card per rail row kind: the Feature row's, a task row's and an item row's.
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

// One rail row. `position` is its 0-based place in the rail, which `RailKit.railRow` takes. A task row counts its
// included items of `total` and is `expanded` while its item rows show under it; an item row's `number` is 1-based.
export type RailRowInput =
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
      expanded: boolean;
    }
  | {
      position: number;
      kind: 'item';
      entryId: string;
      number: number;
      text: string;
      include: boolean;
      added: boolean;
    };

// A group of tasks under its header: each task row, then its item rows while it is expanded.
export interface RailGroupInput {
  group: PrimerGroup;
  header: string;
  rows: RailRowInput[];
}

// The Feature row, then the groups in rail order: Primer and Every feature only while they hold a task, Extra tasks
// always.
export interface RailInput {
  feature: RailRowInput;
  groups: RailGroupInput[];
}

export interface ReviewTaskInput {
  id: string;
  name: string;
  need: PrimerNeed;
  comment: string;
  items: { text: string; include: boolean; comment: string }[];
}

// The tallies of every task's need and every item, what blocks a send (empty when the primer may send), the feature's
// fields in card order, and the tasks in rail order.
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
// of the part drawing: `primer.card` for the cards, `primer.rail` for the rail, `primer.review` for the review.
export interface PrimerKit extends BaseKit {
  // The need's Tag: Yes (success), No (neutral) or Unclear (warning).
  needTag(parent: HTMLElement, need: PrimerNeed): HTMLElement;
}

// A text box in its labelled field (`div.primer-field`), with its key hint beside the label and its `⌃P ⌃N` box keys
// on the frame. Each box mounts once per card; asking for it again, or for a box the card does not have, throws. The
// app appends each box a card leaves out at the card's end, in its field, so the box keys always reach it; `⌃N` and
// `⌃P` step through the boxes in the app's order, whatever their place on the card.
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

export interface ItemKit extends PrimerKit {
  textBox(parent: HTMLElement, field: 'comment'): HTMLElement;
  // The item's ToggleMark: a click toggles the item, and it shows the item's include on each change while the card
  // shows.
  includeMark(parent: HTMLElement): HTMLElement;
  // The key hint of the row step `command` (`span.ui-key-stack.primer-item-step-keys`): both panes step through the
  // rows, so it shows the focused pane's key (the rail binds `k`/`<C-h>` and `j`/`<C-l>`, the card `<C-h>` and
  // `<C-l>`).
  stepKey(parent: HTMLElement, command: 'prevRow' | 'nextRow'): HTMLElement;
}

export interface RailKit extends PrimerKit {
  // The list row for rail `position`: the Feature row with the feature's name; a task row with its need tag and
  // included count; an item row led by its include mark and number. The app keeps on it the click that selects it,
  // `is-selected` while it is the selected row, the selected row's prompt (its need, include and remove keys) and an
  // item row's mark click. The app knows rows only by the elements `railRow` returns: a row drawn otherwise gets no
  // click and no selection, and when the rail never calls `railRow` for the selected row, the row prompt is appended
  // at the end of the rail's element. Throws for a position the rail does not hold.
  railRow(parent: HTMLElement, position: number): HTMLElement;
  // The `A add` key hint for adding an extra task.
  addPrompt(parent: HTMLElement): HTMLElement;
}

export type ReviewKit = PrimerKit;

export interface PrimerLayout {
  cards?: Partial<PrimerLayoutCards>;
  // The rail's body, under the app's rail header and over its Review button, drawn again on each primer change.
  rail?(parent: HTMLElement, input: RailInput, kit: RailKit): PrimerLayoutPane;
  // The review's body, over the app's Back, Cancel primer and Send buttons, drawn again on each primer change while
  // the review shows.
  review?(
    parent: HTMLElement,
    input: ReviewInput,
    kit: ReviewKit,
  ): PrimerLayoutPane;
}

// The built-in `default` layout, which defines every part.
export interface CompletePrimerLayout extends PrimerLayout {
  cards: PrimerLayoutCards;
  rail(parent: HTMLElement, input: RailInput, kit: RailKit): PrimerLayoutPane;
  review(
    parent: HTMLElement,
    input: ReviewInput,
    kit: ReviewKit,
  ): PrimerLayoutPane;
}
