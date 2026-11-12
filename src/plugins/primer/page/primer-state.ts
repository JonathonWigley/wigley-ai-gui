import {
  activeForm,
  createSessionFormsReducer,
  emptySessionForms,
  type SessionForm,
  type SessionFormsAction,
  type SessionFormsState,
  updateForm,
} from '../../../shared/page/session-forms';
import {
  MAX_PRIMER_ENTRIES,
  MAX_PRIMER_ITEMS,
  type PresentedPrimer,
  type Primer,
  type PrimerBody,
  type PrimerEntry,
  type PrimerFeature,
  type PrimerGroup,
  type PrimerItem,
  type PrimerColumn,
  type PrimerNeed,
  type PrimerPane,
  type PrimerPlace,
  PRIMER_SLUG_PATTERN,
  type TaskRow,
} from '../contract';
import type { PrimerScopeName } from '../ids';

export type FeatureField = 'name' | 'slug' | 'spec' | 'summary' | 'notes';

// `item` is 1-based within the task's items. `itemText` exists only on an
// item the user added.
export type TextTarget =
  | { field: 'feature'; name: FeatureField }
  | { field: 'taskName'; entryId: string }
  | { field: 'itemText'; entryId: string; item: number }
  | { field: 'itemComment'; entryId: string; item: number }
  | { field: 'newItem'; entryId: string }
  | { field: 'taskComment'; entryId: string };

// The row a card shows. `item` is 1-based within the task's items, as in
// TextTarget.
export type PrimerRow =
  | TaskRow
  | { kind: 'item'; entryId: string; item: number };

// `formId` is the primer's id.
export interface OpenPrimer extends SessionForm {
  // As the agent sent it.
  primer: Primer;
  // As the user edited it: the sent tasks in sent order, then the extra tasks
  // in the order added.
  feature: PrimerFeature;
  entries: PrimerEntry[];
  // The selected tasks column row, by identity; the items column lists its
  // task's items.
  selectedTask: TaskRow;
  // 1-based in the selected task's items; null on the Feature row or a task
  // with none.
  selectedItem: number | null;
  pane: PrimerPane;
  // The column whose selection the card shows; equals `pane` while a column
  // has focus.
  cardColumn: PrimerColumn;
  // The review's cursor, 0-based in reviewEntries(primer); 0 as the review
  // opens.
  reviewRow: number;
  // Each add-item box's text, by entry id; not part of the body until the
  // box commits it as an item.
  newItemTexts: Readonly<Record<string, string>>;
}

// The open primers and the view; the active primer is the primer of the
// session the sessions plugin focuses, or null when that session has none.
export type PrimerState = SessionFormsState<OpenPrimer, 'primer'>;

// The primer page's own actions beside the session form lifecycle's.
type PrimerOwnAction =
  | { type: 'nextRow' }
  | { type: 'prevRow' }
  | { type: 'firstRow' }
  | { type: 'lastRow' }
  // `row` is a position in taskRows(primer).
  | { type: 'selectTask'; row: number }
  // `item` is 1-based in the selected task's items.
  | { type: 'selectItem'; item: number }
  | { type: 'setNeed'; need: PrimerNeed }
  | { type: 'addExtraTask' }
  | { type: 'removeExtraTask' }
  | { type: 'focusPane'; pane: PrimerPane }
  | { type: 'toggleInclude' }
  // Adds the task's add-item text as an item.
  | { type: 'addItem'; formId: string; entryId: string }
  // Removes item `item` (1-based) of the task when its text is blank.
  | { type: 'dropBlankItem'; formId: string; entryId: string; item: number }
  // Selects the row a text box sits on, and focuses the card.
  | { type: 'showTarget'; formId: string; target: TextTarget }
  | { type: 'setText'; formId: string; target: TextTarget; value: string }
  // Commits each task's add-item text as an item and removes every item whose
  // text is blank, then opens the review.
  | { type: 'openReview' }
  | { type: 'reviewNext' }
  | { type: 'reviewPrev' }
  | { type: 'reviewTop' }
  | { type: 'reviewBottom' }
  // Closes the review on the cursor's task, selected in the focused tasks
  // column.
  | { type: 'reviewJump' }
  // Puts primer `formId` back where the last page left it; the view applies
  // only while the primer is active.
  | { type: 'placeRestored'; formId: string; place: PrimerPlace };

export type PrimerAction =
  | SessionFormsAction<PresentedPrimer>
  | PrimerOwnAction;

const FEATURE_ROW: TaskRow = { kind: 'feature' };

// Each feature field with its label, in the order the card and review show
// them.
export const FEATURE_FIELDS: [FeatureField, string][] = [
  ['name', 'Name'],
  ['slug', 'Slug'],
  ['spec', 'Spec'],
  ['summary', 'Summary'],
  ['notes', 'Notes'],
];

// Each task group with its tasks column header, in tasks column order.
export const TASK_GROUPS: [PrimerGroup, string][] = [
  ['primer', 'Primer'],
  ['standing', 'Every feature'],
  ['extra', 'Extra tasks'],
];

// The actions that apply only in view 'primer'.
const PRIMER_VIEW_ACTIONS: ReadonlySet<PrimerOwnAction['type']> = new Set([
  'nextRow',
  'prevRow',
  'firstRow',
  'lastRow',
  'selectTask',
  'selectItem',
  'setNeed',
  'addExtraTask',
  'removeExtraTask',
  'focusPane',
  'toggleInclude',
  'showTarget',
  'openReview',
]);

// The actions that apply only in view 'review'.
const REVIEW_VIEW_ACTIONS: ReadonlySet<PrimerOwnAction['type']> = new Set([
  'reviewNext',
  'reviewPrev',
  'reviewTop',
  'reviewBottom',
  'reviewJump',
]);

export function initialState(
  primers: PresentedPrimer[],
  activeSessionId: string | null,
): PrimerState {
  return primers.reduce(
    (state, primer) => apply(state, { type: 'formShown', form: primer }),
    emptySessionForms<OpenPrimer, 'primer'>(activeSessionId),
  );
}

// Returns `state` itself when the action changes nothing. Row, pane, include
// and target actions and `openReview` apply only in view 'primer', the review
// cursor's actions only in view 'review'. While the
// active primer is sending, only the lifecycle's sending actions and the
// boxes' text apply.
export const apply = createSessionFormsReducer<
  OpenPrimer,
  'primer',
  PresentedPrimer,
  PrimerOwnAction
>({
  formView: 'primer',
  restore: restorePrimer,
  sendingActions: new Set(['setText']),
  applyOwn,
});

function applyOwn(state: PrimerState, action: PrimerOwnAction): PrimerState {
  const isOutOfView =
    (PRIMER_VIEW_ACTIONS.has(action.type) && state.view !== 'primer') ||
    (REVIEW_VIEW_ACTIONS.has(action.type) && state.view !== 'review');
  if (isOutOfView) {
    return state;
  }
  const active = state.activeFormId;
  switch (action.type) {
    case 'nextRow':
      return updateForm(state, active, (primer) => moveRow(primer, 1));
    case 'prevRow':
      return updateForm(state, active, (primer) => moveRow(primer, -1));
    case 'firstRow':
      return updateForm(state, active, (primer) =>
        placeRow(primer, (_row, first) => first),
      );
    case 'lastRow':
      return updateForm(state, active, (primer) =>
        placeRow(primer, (_row, _first, last) => last),
      );
    case 'selectTask':
      return updateForm(state, active, (primer) =>
        selectTaskAt(primer, action.row),
      );
    case 'selectItem':
      return updateForm(state, active, (primer) =>
        selectItemAt(primer, action.item),
      );
    case 'setNeed':
      return updateForm(state, active, (primer) =>
        setNeed(primer, action.need),
      );
    case 'addExtraTask':
      return updateForm(state, active, addExtraTask);
    case 'removeExtraTask':
      return updateForm(state, active, removeExtraTask);
    case 'focusPane':
      return updateForm(state, active, (primer) =>
        withFocus(primer, action.pane),
      );
    case 'toggleInclude':
      return updateForm(state, active, toggleInclude);
    case 'addItem':
      return updateForm(state, action.formId, (primer) =>
        addItem(primer, action.entryId),
      );
    case 'dropBlankItem':
      return updateForm(state, action.formId, (primer) =>
        dropBlankItem(primer, action.entryId, action.item),
      );
    case 'showTarget':
      return action.formId === active
        ? updateForm(state, active, (primer) =>
            showTarget(primer, action.target),
          )
        : state;
    case 'setText':
      return updateForm(state, action.formId, (primer) =>
        setText(primer, action.target, action.value),
      );
    case 'openReview':
      return active === null
        ? state
        : updateForm({ ...state, view: 'review' }, active, (primer) =>
            withReviewRow(dropBlankItems(addNewItems(primer)), 0),
          );
    case 'reviewNext':
      return updateForm(state, active, (primer) =>
        moveReviewRow(primer, (row) => row + 1),
      );
    case 'reviewPrev':
      return updateForm(state, active, (primer) =>
        moveReviewRow(primer, (row) => row - 1),
      );
    case 'reviewTop':
      return updateForm(state, active, (primer) =>
        moveReviewRow(primer, () => 0),
      );
    case 'reviewBottom':
      return updateForm(state, active, (primer) =>
        moveReviewRow(primer, (_row, last) => last),
      );
    case 'reviewJump':
      return reviewJump(state);
    case 'placeRestored':
      return restorePlace(state, action.formId, action.place);
  }
}

// The review's task rows, in tasks column order.
export function reviewEntries(primer: OpenPrimer): PrimerEntry[] {
  return taskRows(primer).flatMap((row) => {
    const entry = row.kind === 'task' ? entryOf(primer, row.entryId) : null;
    return entry === null ? [] : [entry];
  });
}

// The primer's place: its view and the view its Cancel prompt returns to are
// the state's while it is active, else 'primer', the view activating its
// session opens.
export function primerPlace(
  state: PrimerState,
  primer: OpenPrimer,
): PrimerPlace {
  const { selectedTask, selectedItem: item, pane, cardColumn } = primer;
  if (primer.formId === state.activeFormId && state.view !== 'idle') {
    return {
      selectedTask,
      selectedItem: item,
      pane,
      cardColumn,
      view: state.view,
      confirmReturnView: state.confirmReturnView,
    };
  }
  return {
    selectedTask,
    selectedItem: item,
    pane,
    cardColumn,
    view: 'primer',
    confirmReturnView: 'review',
  };
}

// A saved task row the primer no longer holds falls back to the Feature row,
// and a saved item outside the task's items to the nearest it holds.
function restorePlace(
  state: PrimerState,
  formId: string,
  place: PrimerPlace,
): PrimerState {
  const placed = updateForm(state, formId, (primer) => {
    const row = place.selectedTask;
    const entry = row.kind === 'feature' ? null : entryOf(primer, row.entryId);
    const isRowHeld = row.kind === 'feature' || entry !== null;
    const count = entry?.items.length ?? 0;
    const item = Math.min(Math.max(place.selectedItem ?? 1, 1), count);
    const restored = withFocus(
      {
        ...primer,
        selectedTask: isRowHeld ? row : FEATURE_ROW,
        selectedItem: count === 0 ? null : item,
        cardColumn: place.cardColumn,
      },
      place.pane,
    );
    return isSamePlace(restored, primer) ? primer : restored;
  });
  const isViewUnchanged =
    placed.view === place.view &&
    placed.confirmReturnView === place.confirmReturnView;
  if (formId !== placed.activeFormId || isViewUnchanged) {
    return placed;
  }
  return {
    ...placed,
    view: place.view,
    confirmReturnView: place.confirmReturnView,
  };
}

function isSamePlace(a: OpenPrimer, b: OpenPrimer): boolean {
  return (
    isSameTask(a.selectedTask, b.selectedTask) &&
    a.selectedItem === b.selectedItem &&
    a.pane === b.pane &&
    a.cardColumn === b.cardColumn
  );
}

// The Feature row, then the tasks of each group in TASK_GROUPS order, each
// group in `entries` order.
export function taskRows(primer: OpenPrimer): TaskRow[] {
  return [
    FEATURE_ROW,
    ...TASK_GROUPS.flatMap(([group]) =>
      primer.entries
        .filter((entry) => entry.group === group)
        .map((entry): TaskRow => ({ kind: 'task', entryId: entry.id })),
    ),
  ];
}

// The selected task row's position in taskRows(primer).
export function taskPosition(primer: OpenPrimer): number {
  return taskRows(primer).findIndex((row) =>
    isSameTask(row, primer.selectedTask),
  );
}

// The row the card shows: the selected item's row while the card shows the
// items column and an item is selected, else the selected task row.
export function cardRow(primer: OpenPrimer): PrimerRow {
  const { selectedTask, selectedItem: item } = primer;
  const isItemCard =
    steppedColumn(primer) === 'items' &&
    item !== null &&
    selectedTask.kind === 'task';
  return isItemCard
    ? { kind: 'item', entryId: selectedTask.entryId, item }
    : selectedTask;
}

// The selected task, null on the Feature row.
export function selectedEntry(primer: OpenPrimer): PrimerEntry | null {
  const row = primer.selectedTask;
  return row.kind === 'feature' ? null : entryOf(primer, row.entryId);
}

// The item `primer.selectedItem` names, null when it is null.
export function selectedItem(primer: OpenPrimer): PrimerItem | null {
  const number = primer.selectedItem;
  if (number === null) {
    return null;
  }
  return selectedEntry(primer)?.items[number - 1] ?? null;
}

// Which keys a column's selected row prompt shows: the need keys on a task or
// item row, the include key on an item row, and the remove key on an extra
// task's row.
export interface RowPrompt {
  need: boolean;
  include: boolean;
  remove: boolean;
}

// The prompt on `column`'s selected row; null when that column has no
// selected row with keys: the tasks column on the Feature row, whose need keys
// do nothing, and the items column with no item selected.
export function rowPrompt(
  primer: OpenPrimer,
  column: PrimerColumn,
): RowPrompt | null {
  const entry = selectedEntry(primer);
  if (column === 'items') {
    return primer.selectedItem === null
      ? null
      : { need: true, include: true, remove: false };
  }
  if (entry === null) {
    return null;
  }
  return { need: true, include: false, remove: entry.group === 'extra' };
}

export function includedCount(entry: PrimerEntry): number {
  return entry.items.filter((item) => item.include).length;
}

export function buildBody(primer: OpenPrimer): PrimerBody {
  return { feature: primer.feature, entries: primer.entries };
}

// What blocks a submit, in this order; empty when it may send.
export function submitProblems(primer: OpenPrimer): string[] {
  const slugProblem = PRIMER_SLUG_PATTERN.test(primer.feature.slug)
    ? []
    : [
        'The slug must be lowercase letters, digits and dashes, starting with a letter or digit.',
      ];
  const nameProblems = primer.entries
    .filter((entry) => entry.group === 'extra')
    .flatMap((entry, i) =>
      entry.task.trim() === '' ? [`Extra task ${i + 1} needs a name.`] : [],
    );
  return [...slugProblem, ...nameProblems];
}

// The session row's status for the primer popup: the feature's name and how
// many tasks have a need other than unclear.
export function sessionTitle(primer: OpenPrimer): string {
  const decided = primer.entries.filter(
    (entry) => entry.need !== 'unclear',
  ).length;
  return `${primer.feature.name} ${decided}/${primer.entries.length}`;
}

// The scope the primer popup's keys fire in for this state.
export function scopeOf(state: PrimerState): PrimerScopeName {
  if (state.view === 'primer') {
    return activeForm(state)?.pane ?? 'idle';
  }
  return state.view;
}

// How the view and the log name a row: `the feature`, `task <entryId>`
// or `item <item> on task <entryId>`.
export function rowName(row: PrimerRow): string {
  switch (row.kind) {
    case 'feature':
      return 'the feature';
    case 'task':
      return `task ${row.entryId}`;
    case 'item':
      return `item ${row.item} on task ${row.entryId}`;
  }
}

// The column the row keys step: the focused column, or the card's column
// while the card has focus.
function steppedColumn(primer: OpenPrimer): PrimerColumn {
  return primer.pane === 'card' ? primer.cardColumn : primer.pane;
}

function isSameTask(a: TaskRow, b: TaskRow): boolean {
  const aEntry = a.kind === 'feature' ? null : a.entryId;
  const bEntry = b.kind === 'feature' ? null : b.entryId;
  return aEntry === bEntry;
}

// The task with id `entryId`, or null when the primer holds none.
function entryOf(primer: OpenPrimer, entryId: string): PrimerEntry | null {
  return primer.entries.find((entry) => entry.id === entryId) ?? null;
}

function restorePrimer(presented: PresentedPrimer): OpenPrimer {
  const { formId, sessionId, label, form, draft } = presented;
  const edited = draft ?? form;
  return {
    formId,
    sessionId,
    label,
    primer: form,
    feature: edited.feature,
    entries: edited.entries,
    selectedTask: FEATURE_ROW,
    selectedItem: null,
    pane: 'tasks',
    cardColumn: 'tasks',
    reviewRow: 0,
    newItemTexts: {},
    revision: 0,
    savingRevision: null,
    savedRevision: 0,
    saveError: null,
    sending: null,
  };
}

// A body edit: the next revision.
function edited(primer: OpenPrimer, change: Partial<OpenPrimer>): OpenPrimer {
  return { ...primer, ...change, revision: primer.revision + 1 };
}

// Steps the stepped column's selection `step` rows, clamped at both ends:
// a task row of the tasks column, or an item of the selected task.
function moveRow(primer: OpenPrimer, step: number): OpenPrimer {
  return placeRow(primer, (row, first, last) =>
    Math.min(Math.max(row + step, first), last),
  );
}

// Selects the stepped column's row `pick` returns from the selected row and
// the column's first and last: a position in taskRows(primer), or a 1-based
// item of the selected task; nothing on a task with no item selected.
function placeRow(
  primer: OpenPrimer,
  pick: (row: number, first: number, last: number) => number,
): OpenPrimer {
  if (steppedColumn(primer) === 'tasks') {
    const rows = taskRows(primer);
    return withTask(
      primer,
      rows[pick(taskPosition(primer), 0, rows.length - 1)],
    );
  }
  const item = primer.selectedItem;
  const count = selectedEntry(primer)?.items.length ?? 0;
  if (item === null) {
    return primer;
  }
  const next = pick(item, 1, count);
  return next === item ? primer : { ...primer, selectedItem: next };
}

function withReviewRow(primer: OpenPrimer, row: number): OpenPrimer {
  return row === primer.reviewRow ? primer : { ...primer, reviewRow: row };
}

// Sets the review cursor to the row `pick` returns from the cursor's row and
// the last row, clamped to the review's rows.
function moveReviewRow(
  primer: OpenPrimer,
  pick: (row: number, last: number) => number,
): OpenPrimer {
  const last = Math.max(reviewEntries(primer).length - 1, 0);
  const row = Math.min(Math.max(pick(primer.reviewRow, last), 0), last);
  return withReviewRow(primer, row);
}

function reviewJump(state: PrimerState): PrimerState {
  const primer = activeForm(state);
  const entryId =
    primer === null ? undefined : reviewEntries(primer)[primer.reviewRow]?.id;
  if (entryId === undefined) {
    return state;
  }
  return updateForm({ ...state, view: 'primer' }, state.activeFormId, (open) =>
    withFocus(withTask(open, { kind: 'task', entryId }), 'tasks'),
  );
}

// Selects `row` and, when the task changes, its first item, or none when it
// has none.
function withTask(primer: OpenPrimer, row: TaskRow): OpenPrimer {
  if (isSameTask(row, primer.selectedTask)) {
    return primer;
  }
  const entry = row.kind === 'feature' ? null : entryOf(primer, row.entryId);
  const hasItems = entry !== null && entry.items.length > 0;
  return { ...primer, selectedTask: row, selectedItem: hasItems ? 1 : null };
}

// Focuses `pane`; a column focused takes the card's column with it, and the
// card keeps the column it came from.
function withFocus(primer: OpenPrimer, pane: PrimerPane): OpenPrimer {
  const cardColumn = pane === 'card' ? primer.cardColumn : pane;
  if (primer.pane === pane && primer.cardColumn === cardColumn) {
    return primer;
  }
  return { ...primer, pane, cardColumn };
}

// `row` is a position in taskRows(primer); a click there selects it and
// focuses the tasks column.
function selectTaskAt(primer: OpenPrimer, row: number): OpenPrimer {
  const rows = taskRows(primer);
  if (row < 0 || row >= rows.length) {
    return primer;
  }
  return withFocus(withTask(primer, rows[row]), 'tasks');
}

// `item` is 1-based in the selected task's items; a click there selects it
// and focuses the items column.
function selectItemAt(primer: OpenPrimer, item: number): OpenPrimer {
  const count = selectedEntry(primer)?.items.length ?? 0;
  if (item < 1 || item > count) {
    return primer;
  }
  const selected =
    item === primer.selectedItem ? primer : { ...primer, selectedItem: item };
  return withFocus(selected, 'items');
}

function setNeed(primer: OpenPrimer, need: PrimerNeed): OpenPrimer {
  const entry = selectedEntry(primer);
  if (entry === null || entry.need === need) {
    return primer;
  }
  return withEntry(primer, { ...entry, need });
}

// Replaces the task with `entry`'s id: a body edit.
function withEntry(primer: OpenPrimer, entry: PrimerEntry): OpenPrimer {
  return edited(primer, {
    entries: primer.entries.map((current) =>
      current.id === entry.id ? entry : current,
    ),
  });
}

// The smallest `extra-<n>` id, n from 1, that no task holds.
function nextExtraId(entries: PrimerEntry[]): string {
  const ids = new Set(entries.map((entry) => entry.id));
  let n = 1;
  while (ids.has(`extra-${n}`)) {
    n++;
  }
  return `extra-${n}`;
}

function addExtraTask(primer: OpenPrimer): OpenPrimer {
  if (primer.entries.length >= MAX_PRIMER_ENTRIES) {
    return primer;
  }
  const entry: PrimerEntry = {
    id: nextExtraId(primer.entries),
    group: 'extra',
    number: null,
    area: '',
    question: '',
    task: '',
    need: 'yes',
    evidence: '',
    probes: '',
    pointer: '',
    comment: '',
    items: [],
  };
  const added = edited(primer, { entries: [...primer.entries, entry] });
  return {
    ...added,
    selectedTask: { kind: 'task', entryId: entry.id },
    selectedItem: null,
    pane: 'card',
    cardColumn: 'tasks',
  };
}

// Removes the selected task when it is an extra one. The selection takes the
// removed task's position in the tasks column left, clamped to the last row,
// and that task's first item.
function removeExtraTask(primer: OpenPrimer): OpenPrimer {
  const entry = selectedEntry(primer);
  if (entry === null || entry.group !== 'extra') {
    return primer;
  }
  const position = taskPosition(primer);
  const { [entry.id]: _dropped, ...newItemTexts } = primer.newItemTexts;
  const removed = edited(primer, {
    entries: primer.entries.filter((current) => current.id !== entry.id),
    newItemTexts,
  });
  const rows = taskRows(removed);
  return withTask(removed, rows[Math.min(position, rows.length - 1)]);
}

// Toggles the item the card shows; a no-op on a Feature or task card.
function toggleInclude(primer: OpenPrimer): OpenPrimer {
  const row = cardRow(primer);
  const entry = selectedEntry(primer);
  const item = selectedItem(primer);
  if (row.kind !== 'item' || entry === null || item === null) {
    return primer;
  }
  return withEntry(primer, {
    ...entry,
    items: entry.items.map((current, i) =>
      i === row.item - 1 ? { ...item, include: !item.include } : current,
    ),
  });
}

// Adds every task's add-item text as an item, in `entries` order; a task's
// text stays when addItem refuses it.
function addNewItems(primer: OpenPrimer): OpenPrimer {
  return primer.entries.reduce(
    (current, entry) => addItem(current, entry.id),
    primer,
  );
}

// A no-op for blank text or a task already holding MAX_PRIMER_ITEMS items.
// The selection stays where it is, except that an item added as the selected
// task's first becomes its selected item.
function addItem(primer: OpenPrimer, entryId: string): OpenPrimer {
  const entry = entryOf(primer, entryId);
  const text = (primer.newItemTexts[entryId] ?? '').trim();
  const isAddable =
    entry !== null && text !== '' && entry.items.length < MAX_PRIMER_ITEMS;
  if (!isAddable) {
    return primer;
  }
  const item: PrimerItem = { text, include: true, comment: '', added: true };
  const added = withEntry(primer, { ...entry, items: [...entry.items, item] });
  const isFirstOfSelected =
    entry.items.length === 0 && selectedEntry(primer)?.id === entryId;
  return {
    ...added,
    selectedItem: isFirstOfSelected ? 1 : primer.selectedItem,
    newItemTexts: { ...primer.newItemTexts, [entryId]: '' },
  };
}

// Removes every item whose text is blank, as `dropBlankItem` does.
function dropBlankItems(primer: OpenPrimer): OpenPrimer {
  return primer.entries.reduce(
    (current, entry) =>
      entry.items.reduceRight(
        (dropped, _item, i) => dropBlankItem(dropped, entry.id, i + 1),
        current,
      ),
    primer,
  );
}

// Removes item `number` (1-based) of the task when its text is blank, as the
// add-item box adds no item for blank text. A selected item past the removed
// one moves up with it; the selection stays on the removed item's place,
// clamped to the items left, or none when none are left.
function dropBlankItem(
  primer: OpenPrimer,
  entryId: string,
  number: number,
): OpenPrimer {
  const entry = entryOf(primer, entryId);
  const item = entry?.items[number - 1];
  if (entry === null || item === undefined || item.text.trim() !== '') {
    return primer;
  }
  const items = entry.items.filter((_current, i) => i !== number - 1);
  const dropped = withEntry(primer, { ...entry, items });
  const selected = primer.selectedItem;
  const isSelectedTask = selectedEntry(primer)?.id === entryId;
  if (!isSelectedTask || selected === null) {
    return dropped;
  }
  const shifted = selected > number ? selected - 1 : selected;
  return {
    ...dropped,
    selectedItem: items.length === 0 ? null : Math.min(shifted, items.length),
  };
}

// The task row a target's box sits on: the Feature row for a feature box.
function targetTask(target: TextTarget): TaskRow {
  return target.field === 'feature'
    ? FEATURE_ROW
    : { kind: 'task', entryId: target.entryId };
}

// Shows the card a target's box sits on and focuses it: an item text's or
// comment's item card, from the items column; another box's task or Feature
// card, from the tasks column. A no-op for a target on a task the primer does
// not hold.
function showTarget(primer: OpenPrimer, target: TextTarget): OpenPrimer {
  const isHeldTask =
    target.field === 'feature' || entryOf(primer, target.entryId) !== null;
  if (!isHeldTask) {
    return primer;
  }
  const isItemBox =
    target.field === 'itemText' || target.field === 'itemComment';
  const shown = isItemBox
    ? {
        ...primer,
        selectedTask: targetTask(target),
        selectedItem: target.item,
        cardColumn: 'items' as const,
      }
    : {
        ...withTask(primer, targetTask(target)),
        cardColumn: 'tasks' as const,
      };
  const isUnchanged =
    isSameTask(shown.selectedTask, primer.selectedTask) &&
    shown.selectedItem === primer.selectedItem &&
    shown.cardColumn === primer.cardColumn &&
    primer.pane === 'card';
  return isUnchanged ? primer : { ...shown, pane: 'card' };
}

// `newItem` text is not part of the body, so it leaves the revision.
function setText(
  primer: OpenPrimer,
  target: TextTarget,
  value: string,
): OpenPrimer {
  switch (target.field) {
    case 'feature':
      return primer.feature[target.name] === value
        ? primer
        : edited(primer, {
            feature: { ...primer.feature, [target.name]: value },
          });
    case 'newItem':
      return (primer.newItemTexts[target.entryId] ?? '') === value
        ? primer
        : {
            ...primer,
            newItemTexts: { ...primer.newItemTexts, [target.entryId]: value },
          };
    default:
      return setEntryText(primer, target, value);
  }
}

function setEntryText(
  primer: OpenPrimer,
  target: Extract<
    TextTarget,
    { field: 'taskName' | 'itemText' | 'itemComment' | 'taskComment' }
  >,
  value: string,
): OpenPrimer {
  const entry = entryOf(primer, target.entryId);
  if (entry === null) {
    return primer;
  }
  switch (target.field) {
    case 'taskName':
      return entry.task === value
        ? primer
        : withEntry(primer, { ...entry, task: value });
    case 'taskComment':
      return entry.comment === value
        ? primer
        : withEntry(primer, { ...entry, comment: value });
    case 'itemText': {
      // The agent's items keep their text; only an added item's is the user's.
      const position = target.item - 1;
      const item = entry.items[position];
      if (item === undefined || !item.added || item.text === value) {
        return primer;
      }
      return withEntry(primer, {
        ...entry,
        items: entry.items.map((current, i) =>
          i === position ? { ...item, text: value } : current,
        ),
      });
    }
    case 'itemComment': {
      const position = target.item - 1;
      const item = entry.items[position];
      if (item === undefined || item.comment === value) {
        return primer;
      }
      return withEntry(primer, {
        ...entry,
        items: entry.items.map((current, i) =>
          i === position ? { ...item, comment: value } : current,
        ),
      });
    }
  }
}
