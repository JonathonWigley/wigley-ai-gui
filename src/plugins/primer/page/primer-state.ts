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
  type PrimerNeed,
  PRIMER_SLUG_PATTERN,
} from '../contract';
import type { PrimerScopeName } from '../ids';

export type PrimerPane = 'rail' | 'card';

export type FeatureField = 'name' | 'slug' | 'spec' | 'summary' | 'notes';

// `item` is 1-based within the task's items.
export type TextTarget =
  | { field: 'feature'; name: FeatureField }
  | { field: 'taskName'; entryId: string }
  | { field: 'itemComment'; entryId: string; item: number }
  | { field: 'newItem'; entryId: string }
  | { field: 'taskComment'; entryId: string };

export type RailRow = { kind: 'feature' } | { kind: 'task'; entryId: string };

// `formId` is the primer's id.
export interface OpenPrimer extends SessionForm {
  // As the agent sent it.
  primer: Primer;
  // As the user edited it: the sent tasks in sent order, then the extra tasks
  // in the order added.
  feature: PrimerFeature;
  entries: PrimerEntry[];
  // A position in railRows(primer).
  railCursor: number;
  // A position in the selected task's items.
  itemCursor: number;
  pane: PrimerPane;
  // Each add-item box's text, by entry id; not part of the body until the
  // box commits it as an item.
  newItemTexts: Readonly<Record<string, string>>;
}

// The open primers and the view; the active primer is the primer of the
// session the sessions plugin shows, or null when that session has none.
export type PrimerState = SessionFormsState<OpenPrimer, 'primer'>;

// The primer page's own actions beside the session form lifecycle's.
type PrimerOwnAction =
  | { type: 'nextRow' }
  | { type: 'prevRow' }
  // `row` is a rail position.
  | { type: 'selectRow'; row: number }
  | { type: 'setNeed'; need: PrimerNeed }
  | { type: 'addExtraTask' }
  | { type: 'removeExtraTask' }
  | { type: 'focusPane'; pane: PrimerPane }
  | { type: 'nextItem' }
  | { type: 'prevItem' }
  // `item` is a position in the selected task's items.
  | { type: 'selectItem'; item: number }
  | { type: 'toggleInclude' }
  // Adds the task's add-item text as an item.
  | { type: 'addItem'; formId: string; entryId: string }
  // Selects the row and item a text box edits, and focuses the card.
  | { type: 'showTarget'; formId: string; target: TextTarget }
  | { type: 'setText'; formId: string; target: TextTarget; value: string }
  // Commits each task's add-item text as an item, then opens the review.
  | { type: 'openReview' };

export type PrimerAction =
  | SessionFormsAction<PresentedPrimer>
  | PrimerOwnAction;

const FEATURE_ROW: RailRow = { kind: 'feature' };

// Each feature field with its label, in the order the card and review show
// them.
export const FEATURE_FIELDS: [FeatureField, string][] = [
  ['name', 'Name'],
  ['slug', 'Slug'],
  ['spec', 'Spec'],
  ['summary', 'Summary'],
  ['notes', 'Notes'],
];

// Each task group with its rail header, in rail order.
export const RAIL_GROUPS: [PrimerGroup, string][] = [
  ['primer', 'Primer'],
  ['standing', 'Every feature'],
  ['extra', 'Extra tasks'],
];

// The actions that apply only in view 'primer'.
const PRIMER_VIEW_ACTIONS: ReadonlySet<PrimerOwnAction['type']> = new Set([
  'nextRow',
  'prevRow',
  'selectRow',
  'setNeed',
  'addExtraTask',
  'removeExtraTask',
  'focusPane',
  'nextItem',
  'prevItem',
  'selectItem',
  'toggleInclude',
  'showTarget',
  'openReview',
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

// Returns `state` itself when the action changes nothing. Row, pane, item and
// target actions and `openReview` apply only in view 'primer'. While the
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
  if (PRIMER_VIEW_ACTIONS.has(action.type) && state.view !== 'primer') {
    return state;
  }
  const active = state.activeFormId;
  switch (action.type) {
    case 'nextRow':
      return updateForm(state, active, (primer) => moveRow(primer, 1));
    case 'prevRow':
      return updateForm(state, active, (primer) => moveRow(primer, -1));
    case 'selectRow':
      return updateForm(state, active, (primer) =>
        selectRowAt(primer, action.row),
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
        primer.pane === action.pane ? primer : { ...primer, pane: action.pane },
      );
    case 'nextItem':
      return updateForm(state, active, (primer) => moveItem(primer, 1));
    case 'prevItem':
      return updateForm(state, active, (primer) => moveItem(primer, -1));
    case 'selectItem':
      return updateForm(state, active, (primer) =>
        selectItemAt(primer, action.item),
      );
    case 'toggleInclude':
      return updateForm(state, active, toggleInclude);
    case 'addItem':
      return updateForm(state, action.formId, (primer) =>
        addItem(primer, action.entryId),
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
        : updateForm({ ...state, view: 'review' }, active, addNewItems);
  }
}

// The Feature row, then the tasks of each group in RAIL_GROUPS order, each
// group in `entries` order.
export function railRows(primer: OpenPrimer): RailRow[] {
  return [
    FEATURE_ROW,
    ...RAIL_GROUPS.flatMap(([group]) =>
      primer.entries
        .filter((entry) => entry.group === group)
        .map((entry): RailRow => ({ kind: 'task', entryId: entry.id })),
    ),
  ];
}

export function selectedRow(primer: OpenPrimer): RailRow {
  return railRows(primer)[primer.railCursor];
}

// The selected row's task, null on the Feature row.
export function selectedEntry(primer: OpenPrimer): PrimerEntry | null {
  const row = selectedRow(primer);
  return row.kind === 'feature' ? null : entryOf(primer, row.entryId);
}

// Which need keys the selected row's prompt shows: none on the Feature row,
// whose need keys do nothing; `remove` too on an extra task.
export type RowPrompt = 'none' | 'task' | 'extra';

export function rowPrompt(primer: OpenPrimer): RowPrompt {
  const entry = selectedEntry(primer);
  if (entry === null) {
    return 'none';
  }
  return entry.group === 'extra' ? 'extra' : 'task';
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

// The session row's status for the Primer tab: the feature's name and how
// many tasks have a need other than unclear.
export function sessionTitle(primer: OpenPrimer): string {
  const decided = primer.entries.filter(
    (entry) => entry.need !== 'unclear',
  ).length;
  return `${primer.feature.name} ${decided}/${primer.entries.length}`;
}

// The scope the Primer tab's keys fire in for this state.
export function scopeOf(state: PrimerState): PrimerScopeName {
  if (state.view === 'primer') {
    return activeForm(state)?.pane ?? 'idle';
  }
  return state.view;
}

// How the log names a rail row: `the feature` or `task <entryId>`.
export function rowName(row: RailRow): string {
  return row.kind === 'feature' ? 'the feature' : `task ${row.entryId}`;
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
    railCursor: 0,
    itemCursor: 0,
    pane: 'rail',
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

function moveRow(primer: OpenPrimer, step: number): OpenPrimer {
  const lastRow = railRows(primer).length - 1;
  return selectRowAt(
    primer,
    Math.min(Math.max(primer.railCursor + step, 0), lastRow),
  );
}

// A row change starts the item cursor at the row's first item.
function selectRowAt(primer: OpenPrimer, row: number): OpenPrimer {
  const isRailPosition = row >= 0 && row < railRows(primer).length;
  if (!isRailPosition || row === primer.railCursor) {
    return primer;
  }
  return { ...primer, railCursor: row, itemCursor: 0 };
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
    railCursor: railRows(added).findIndex(
      (row) => row.kind === 'task' && row.entryId === entry.id,
    ),
    itemCursor: 0,
    pane: 'card',
  };
}

// Removes the selected task when it is an extra one; the cursor keeps its
// position, clamped to the last row.
function removeExtraTask(primer: OpenPrimer): OpenPrimer {
  const entry = selectedEntry(primer);
  if (entry === null || entry.group !== 'extra') {
    return primer;
  }
  const { [entry.id]: _dropped, ...newItemTexts } = primer.newItemTexts;
  const removed = edited(primer, {
    entries: primer.entries.filter((current) => current.id !== entry.id),
    newItemTexts,
  });
  return {
    ...removed,
    railCursor: Math.min(removed.railCursor, railRows(removed).length - 1),
    itemCursor: 0,
  };
}

// A no-op on the Feature row.
function moveItem(primer: OpenPrimer, step: number): OpenPrimer {
  const entry = selectedEntry(primer);
  if (entry === null) {
    return primer;
  }
  const lastItem = Math.max(entry.items.length - 1, 0);
  const item = Math.min(Math.max(primer.itemCursor + step, 0), lastItem);
  return item === primer.itemCursor ? primer : { ...primer, itemCursor: item };
}

// A no-op on the Feature row or past the task's items.
function selectItemAt(primer: OpenPrimer, item: number): OpenPrimer {
  const entry = selectedEntry(primer);
  const isItem = entry !== null && item >= 0 && item < entry.items.length;
  return isItem && item !== primer.itemCursor
    ? { ...primer, itemCursor: item }
    : primer;
}

// A no-op on the Feature row or a task with no items.
function toggleInclude(primer: OpenPrimer): OpenPrimer {
  const entry = selectedEntry(primer);
  const item = entry?.items[primer.itemCursor];
  if (entry === null || item === undefined) {
    return primer;
  }
  return withEntry(primer, {
    ...entry,
    items: entry.items.map((current, i) =>
      i === primer.itemCursor ? { ...item, include: !item.include } : current,
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
  const isSelected = selectedEntry(primer)?.id === entryId;
  return {
    ...added,
    newItemTexts: { ...primer.newItemTexts, [entryId]: '' },
    itemCursor: isSelected ? entry.items.length : primer.itemCursor,
  };
}

// The rail position of the row a target's box sits on, or -1 when the primer
// has no such task.
function targetRow(primer: OpenPrimer, target: TextTarget): number {
  if (target.field === 'feature') {
    return 0;
  }
  return railRows(primer).findIndex(
    (row) => row.kind === 'task' && row.entryId === target.entryId,
  );
}

function showTarget(primer: OpenPrimer, target: TextTarget): OpenPrimer {
  const row = targetRow(primer, target);
  if (row < 0) {
    return primer;
  }
  const onRow = selectRowAt(primer, row);
  const itemCursor =
    target.field === 'itemComment' ? target.item - 1 : onRow.itemCursor;
  const isUnchanged =
    onRow === primer &&
    itemCursor === primer.itemCursor &&
    primer.pane === 'card';
  return isUnchanged ? primer : { ...onRow, itemCursor, pane: 'card' };
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
    { field: 'taskName' | 'itemComment' | 'taskComment' }
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
