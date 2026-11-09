import type {
  AgentFormClosed,
  AgentFormEnd,
  AgentFormEndKind,
} from '../../../contracts/agent-forms';
import type {
  ContentScroll,
  FocusOptions,
  ScrollStep,
} from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type { FocusTarget, PaneDirection } from '../../../contracts/panes';
import type {
  PageCommandContext,
  PageStart,
  ToastTone,
} from '../../../contracts/plugin';
import { scrollText } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { type EditorBoxes, stepBox } from '../../../shared/page/editor-boxes';
import {
  activeForm,
  closeFormFromMain,
  finishActiveForm,
  formById,
  mayCloseSessionForm,
  type SessionFormWords,
} from '../../../shared/page/session-forms';
import {
  MAX_PRIMER_ENTRIES,
  MAX_PRIMER_ITEMS,
  type PrimerBody,
  type PrimerNeed,
  type PrimerPane,
  type PrimerView,
} from '../contract';
import type { primerManifest } from '../manifest';
import { boxKey, focusActionFor, type PrimerBox, shownBoxes } from './boxes';
import {
  buildBody,
  cardRow,
  type OpenPrimer,
  type PrimerAction,
  type PrimerState,
  rowName,
  selectedEntry,
  selectedItem,
  submitProblems,
  type TextTarget,
  taskRows,
} from './primer-state';
import type { PrimerStore } from './primer-store';

export interface PrimerCommandDeps {
  store: PrimerStore;
  boxes: Pick<EditorBoxes<PrimerBox>, 'focus' | 'leave' | 'active' | 'boxOf'>;
  // Hands the finished primer to main; rejects with the reason when main
  // keeps it open.
  finish(primerId: string, end: AgentFormEnd<PrimerBody>): Promise<void>;
  // Scrolls the active primer's card or review by `step`, down for 1 and up
  // for -1; null when no primer is shown.
  scrollPrimer(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
  // Asks main to open the layout preview; rejects with the reason it failed.
  openPreview(): Promise<unknown>;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
}

// A handler's body, run once the box it fired in has its row shown; `box` is
// that box, undefined from the page.
type Run = (box: PrimerBox | undefined) => void;

// How the primer page's log and toasts name a primer.
const PRIMER_WORDS: SessionFormWords = {
  noun: 'primer',
  sent: 'Primer sent',
};

const APPEND: FocusOptions = { insertAtEnd: true };

// Every primer command's handler, by short id. A command fired in a box first
// shows that box's row, so it acts where the user is typing.
export function primerCommandHandlers(
  deps: PrimerCommandDeps,
): PageStart<typeof primerManifest>['commands'] {
  const { store, boxes, log } = deps;
  const handler =
    (run: Run) =>
    (context: PageCommandContext): void => {
      const box = boxIn(deps, context);
      showBoxTarget(store, box);
      run(box);
    };
  const dispatchOnly = (action: PrimerAction) =>
    handler(() => store.dispatch(action));

  return {
    nextRow: handler((box) => moveRow(deps, box, { type: 'nextRow' })),
    prevRow: handler((box) => moveRow(deps, box, { type: 'prevRow' })),
    firstRow: handler((box) => moveRow(deps, box, { type: 'firstRow' })),
    lastRow: handler((box) => moveRow(deps, box, { type: 'lastRow' })),
    needYes: handler(() => setNeed(deps, 'yes')),
    needNo: handler(() => setNeed(deps, 'no')),
    needUnclear: handler(() => setNeed(deps, 'unclear')),
    addExtraTask: handler(() => addExtraTask(deps)),
    removeExtraTask: handler(() => removeExtraTask(deps)),
    toggleInclude: handler(() => toggleInclude(deps)),
    // A click names its row, so these act with no box's row shown first.
    selectTask: ({ arg }) => selectTaskRow(deps, arg),
    selectItem: ({ arg }) => {
      selectItemRow(deps, arg);
    },
    toggleIncludeAt: ({ arg }) => {
      if (selectItemRow(deps, arg)) {
        toggleInclude(deps);
      }
    },
    addItem: handler(() => focusAddItem(deps)),
    editItemComment: handler(() => focusItemComment(deps)),
    editTaskComment: handler(() => focusTaskComment(deps)),
    editFirstField: handler(() => {
      const first = shownBoxes(store.get())[0];
      if (first === undefined) {
        log('no box to focus');
        return;
      }
      boxes.focus(first, APPEND);
    }),
    nextBox: handler((box) => stepFocus(deps, box, 1)),
    prevBox: handler((box) => stepFocus(deps, box, -1)),
    leaveBox: handler((box) => {
      commitNewItem(deps, box);
      boxes.leave();
      log('left the box');
    }),
    lineDown: handler(() => scrollPrimer(deps, 'line', 1)),
    lineUp: handler(() => scrollPrimer(deps, 'line', -1)),
    halfPageDown: handler(() => scrollPrimer(deps, 'halfPage', 1)),
    halfPageUp: handler(() => scrollPrimer(deps, 'halfPage', -1)),
    openReview: handler((box) => {
      commitNewItem(deps, box);
      changeView(deps, { type: 'openReview' }, 'review', 'review opened');
    }),
    closeReview: handler(() =>
      changeView(deps, { type: 'closeReview' }, 'primer', 'review closed'),
    ),
    reviewNext: dispatchOnly({ type: 'reviewNext' }),
    reviewPrev: dispatchOnly({ type: 'reviewPrev' }),
    reviewTop: dispatchOnly({ type: 'reviewTop' }),
    reviewBottom: dispatchOnly({ type: 'reviewBottom' }),
    reviewJump: handler(() => reviewJump(deps)),
    submit: handler(() => submit(deps)),
    askCancel: dispatchOnly({ type: 'askCancel' }),
    dismissConfirm: dispatchOnly({ type: 'dismissConfirm' }),
    confirmCancel: handler(() =>
      finishActivePrimer(deps, 'confirm', 'cancelled'),
    ),
    // Acts in any view, with or without an open primer.
    openPreview: () => openPreview(deps),
  };
}

function openPreview(deps: PrimerCommandDeps) {
  deps.openPreview().catch((error: unknown) => {
    deps.log(`layout preview failed: ${errorText(error)}`);
    deps.toast(`Layout preview failed: ${errorText(error)}`, 'error');
  });
}

// The primer box the command's editor edits. A key with no editor in its
// context acts on the focused box: a page key never fires while a box has
// focus, and a chord bind fires inside one without naming the editor.
function boxIn(
  deps: PrimerCommandDeps,
  context: PageCommandContext,
): PrimerBox | undefined {
  return context.editor === undefined
    ? (deps.boxes.active() ?? undefined)
    : deps.boxes.boxOf(context.editor);
}

function showBoxTarget(store: PrimerStore, box: PrimerBox | undefined) {
  if (box === undefined) {
    return;
  }
  const action = focusActionFor(store.get(), box);
  if (action !== null) {
    store.dispatch(action);
  }
}

// The card row's name, null with no active primer.
function selectedRowName(state: PrimerState): string | null {
  const primer = activeForm(state);
  return primer === null ? null : rowName(cardRow(primer));
}

// The active primer, or null outside view 'primer' or with none.
function shownPrimer(state: PrimerState): OpenPrimer | null {
  return state.view === 'primer' ? activeForm(state) : null;
}

// Shows the card the target's box sits on, which mounts the box, then
// focuses it.
function focusTarget(
  deps: PrimerCommandDeps,
  primer: OpenPrimer,
  target: TextTarget,
) {
  deps.store.dispatch({ type: 'showTarget', formId: primer.formId, target });
  deps.boxes.focus({ primerId: primer.formId, target }, APPEND);
}

// Adds an add-item box's text first, since the move leaves the box. Logs the
// card row's name when the move changed it.
function moveRow(
  deps: PrimerCommandDeps,
  box: PrimerBox | undefined,
  action: PrimerAction,
) {
  commitNewItem(deps, box);
  const before = selectedRowName(deps.store.get());
  deps.store.dispatch(action);
  const after = selectedRowName(deps.store.get());
  if (after !== null && after !== before) {
    deps.log(`selected ${after}`);
  }
}

function setNeed(deps: PrimerCommandDeps, need: PrimerNeed) {
  const primer = shownPrimer(deps.store.get());
  if (primer === null) {
    return;
  }
  const entry = selectedEntry(primer);
  if (entry === null) {
    deps.log('no task selected');
    return;
  }
  const before = deps.store.get();
  deps.store.dispatch({ type: 'setNeed', need });
  if (deps.store.get() !== before) {
    deps.log(`need ${need} on task ${entry.id}`);
  }
}

function addExtraTask(deps: PrimerCommandDeps) {
  const before = deps.store.get();
  const primer = shownPrimer(before);
  if (primer === null) {
    return;
  }
  if (primer.entries.length >= MAX_PRIMER_ENTRIES) {
    deps.log(`no task added: the primer holds ${MAX_PRIMER_ENTRIES} tasks`);
    return;
  }
  deps.store.dispatch({ type: 'addExtraTask' });
  const added = activeForm(deps.store.get());
  if (deps.store.get() === before || added === null) {
    return;
  }
  const entry = selectedEntry(added);
  if (entry === null) {
    return;
  }
  deps.log(`added extra task ${entry.id}`);
  focusTarget(deps, added, { field: 'taskName', entryId: entry.id });
}

function removeExtraTask(deps: PrimerCommandDeps) {
  const primer = shownPrimer(deps.store.get());
  if (primer === null) {
    return;
  }
  const entry = selectedEntry(primer);
  if (entry === null || entry.group !== 'extra') {
    deps.log('only an extra task can be removed');
    return;
  }
  const before = deps.store.get();
  deps.store.dispatch({ type: 'removeExtraTask' });
  if (deps.store.get() !== before) {
    deps.log(`removed extra task ${entry.id}`);
  }
}

// The panes the focus keys step through, left to right.
const PANE_ORDER: readonly PrimerPane[] = ['tasks', 'items', 'card'];

// The shown primer's panes for the core's focus keys: left and right step
// through tasks, items and card, and every other move returns false. A move
// first shows the focused box's row; one into a column commits the add-item
// text and leaves the box, as a click there would.
export function primerFocusTarget(
  deps: Pick<PrimerCommandDeps, 'store' | 'boxes' | 'log'>,
): FocusTarget {
  return {
    move(direction) {
      const box = deps.boxes.active() ?? undefined;
      showBoxTarget(deps.store, box);
      const primer = shownPrimer(deps.store.get());
      const pane = primer === null ? undefined : paneTo(primer.pane, direction);
      if (pane === undefined) {
        return false;
      }
      if (pane !== 'card') {
        commitNewItem(deps, box);
        deps.boxes.leave();
      }
      return focusPane(deps, pane);
    },
  };
}

// The pane beside `from` toward `direction`; undefined past either end and
// for up and down.
function paneTo(
  from: PrimerPane,
  direction: PaneDirection,
): PrimerPane | undefined {
  const at = PANE_ORDER.indexOf(from);
  switch (direction) {
    case 'left':
      return PANE_ORDER[at - 1];
    case 'right':
      return PANE_ORDER[at + 1];
    case 'up':
    case 'down':
      return undefined;
  }
}

// Focuses `pane` of the active primer, logging and returning true when focus
// moved.
function focusPane(
  deps: Pick<PrimerCommandDeps, 'store' | 'log'>,
  pane: PrimerPane,
): boolean {
  const before = activeForm(deps.store.get())?.pane;
  deps.store.dispatch({ type: 'focusPane', pane });
  const after = activeForm(deps.store.get())?.pane;
  const moved = after !== undefined && after !== before;
  if (moved) {
    deps.log(`focused the ${pane}`);
  }
  return moved;
}

// The shown primer's card row and its item; null when the card shows no item.
function cursorItem(state: PrimerState) {
  const primer = shownPrimer(state);
  if (primer === null) {
    return null;
  }
  const row = cardRow(primer);
  const item = selectedItem(primer);
  return row.kind === 'item' && item !== null ? { primer, row, item } : null;
}

function toggleInclude(deps: PrimerCommandDeps) {
  const before = deps.store.get();
  if (shownPrimer(before) === null) {
    return;
  }
  const cursor = cursorItem(before);
  if (cursor === null) {
    deps.log('no item selected');
    return;
  }
  deps.store.dispatch({ type: 'toggleInclude' });
  const after = cursorItem(deps.store.get());
  if (deps.store.get() === before || after === null) {
    return;
  }
  const { row, item } = after;
  deps.log(
    `${item.include ? 'included' : 'left out'} item ${row.item} on task ${row.entryId}`,
  );
}

// Selects tasks column row `row`, a position in taskRows; nothing with no
// shown primer, and the miss logged for a row the column lacks, as a click
// drawn before the primer changed sends.
function selectTaskRow(deps: PrimerCommandDeps, row: number) {
  const primer = shownPrimer(deps.store.get());
  if (primer === null) {
    return;
  }
  if (taskRows(primer)[row] === undefined) {
    deps.log(`no task row ${row}`);
    return;
  }
  deps.store.dispatch({ type: 'selectTask', row });
}

// Selects the selected task's item `item`, 1-based; false with no shown
// primer, and false with the miss logged for an item the task lacks.
function selectItemRow(deps: PrimerCommandDeps, item: number): boolean {
  const primer = shownPrimer(deps.store.get());
  if (primer === null) {
    return false;
  }
  if (selectedEntry(primer)?.items[item - 1] === undefined) {
    deps.log(`no item ${item}`);
    return false;
  }
  deps.store.dispatch({ type: 'selectItem', item });
  return true;
}

function focusItemComment(deps: PrimerCommandDeps) {
  const state = deps.store.get();
  if (shownPrimer(state) === null) {
    return;
  }
  const cursor = cursorItem(state);
  if (cursor === null) {
    deps.log('no item selected');
    return;
  }
  const { primer, row } = cursor;
  focusTarget(deps, primer, {
    field: 'itemComment',
    entryId: row.entryId,
    item: row.item,
  });
}

function focusTaskComment(deps: PrimerCommandDeps) {
  const primer = shownPrimer(deps.store.get());
  if (primer === null) {
    return;
  }
  const entry = selectedEntry(primer);
  if (entry === null) {
    deps.log('no task selected');
    return;
  }
  focusTarget(deps, primer, { field: 'taskComment', entryId: entry.id });
}

function focusAddItem(deps: PrimerCommandDeps) {
  const primer = shownPrimer(deps.store.get());
  if (primer === null) {
    return;
  }
  const entry = selectedEntry(primer);
  if (entry === null) {
    deps.log('no task selected');
    return;
  }
  if (entry.items.length >= MAX_PRIMER_ITEMS) {
    deps.log(fullTaskLine(entry.id));
    return;
  }
  focusTarget(deps, primer, { field: 'newItem', entryId: entry.id });
}

function fullTaskLine(entryId: string): string {
  return `no item added: task ${entryId} holds ${MAX_PRIMER_ITEMS} items`;
}

// Adds the add-item box's text as an item when `box` is an add-item box,
// before a key that leaves it acts; a focus change alone adds nothing.
function commitNewItem(
  deps: Pick<PrimerCommandDeps, 'store' | 'log'>,
  box: PrimerBox | undefined | null,
) {
  if (box === undefined || box === null || box.target.field !== 'newItem') {
    return;
  }
  const { primerId } = box;
  const { entryId } = box.target;
  const primer = formById(deps.store.get(), primerId);
  const entry = primer?.entries.find((candidate) => candidate.id === entryId);
  const text = (primer?.newItemTexts[entryId] ?? '').trim();
  if (entry === undefined || text === '') {
    return;
  }
  if (entry.items.length >= MAX_PRIMER_ITEMS) {
    deps.log(fullTaskLine(entryId));
    return;
  }
  const before = deps.store.get();
  deps.store.dispatch({ type: 'addItem', formId: primerId, entryId });
  if (deps.store.get() !== before) {
    deps.log(`added item ${entry.items.length + 1} on task ${entryId}`);
  }
}

function stepFocus(
  deps: PrimerCommandDeps,
  box: PrimerBox | undefined,
  step: 1 | -1,
) {
  commitNewItem(deps, box);
  const next = boxAfterStep(shownBoxes(deps.store.get()), box, step);
  if (next === null) {
    deps.log('no box to focus');
    return;
  }
  deps.boxes.focus(next);
}

// The box `step` places away from `box` in `shown`. An add-item box whose
// commit filled its task is gone from `shown`; the step lands as from where
// it stood, before the task's comment box.
function boxAfterStep(
  shown: PrimerBox[],
  box: PrimerBox | undefined,
  step: 1 | -1,
): PrimerBox | null {
  if (box === undefined || box.target.field !== 'newItem') {
    return stepBox(shown, boxKey, box ?? null, step);
  }
  const key = boxKey(box);
  if (shown.some((candidate) => boxKey(candidate) === key)) {
    return stepBox(shown, boxKey, box, step);
  }
  const taskComment: PrimerBox = {
    primerId: box.primerId,
    target: { field: 'taskComment', entryId: box.target.entryId },
  };
  return stepBox(shown, boxKey, taskComment, step === 1 ? 0 : -1);
}

// Leaves focus where it is, so a box keeps focus and its vim mode.
function scrollPrimer(
  deps: PrimerCommandDeps,
  step: ScrollStep,
  direction: 1 | -1,
) {
  const scroll = deps.scrollPrimer(step, direction);
  deps.log(
    scroll === null
      ? 'no primer to scroll'
      : scrollText('the primer', step, direction, scroll),
  );
}

// Closes the review on the cursor's task, logging `selected <name>` when the
// card's row changed, as `moveRow` does.
function reviewJump(deps: PrimerCommandDeps) {
  const before = selectedRowName(deps.store.get());
  changeView(deps, { type: 'reviewJump' }, 'primer', 'review closed');
  const after = selectedRowName(deps.store.get());
  if (after !== null && after !== before) {
    deps.log(`selected ${after}`);
  }
}

// Logs `line` when the action moved the view to `to`.
function changeView(
  deps: PrimerCommandDeps,
  action: PrimerAction,
  to: PrimerView,
  line: string,
) {
  const before = deps.store.get().view;
  deps.store.dispatch(action);
  if (before !== to && deps.store.get().view === to) {
    deps.log(line);
  }
}

function submit(deps: PrimerCommandDeps) {
  const state = deps.store.get();
  const primer = activeForm(state);
  if (state.view !== 'review' || primer === null || primer.sending !== null) {
    return;
  }
  const problems = submitProblems(primer);
  if (problems.length > 0) {
    deps.log(`submit refused: ${problems.join(' ')}`);
    return;
  }
  finishActivePrimer(deps, 'review', 'submitted');
}

// Whether the session's popup lets it close, as mayCloseSessionForm decides.
export function mayClosePrimer(
  deps: Pick<PrimerCommandDeps, 'store' | 'toast' | 'log'>,
  sessionId: string,
): boolean {
  return mayCloseSessionForm({ ...deps, words: PRIMER_WORDS }, sessionId);
}

// Hands main the active primer's finish, as finishActiveForm sends it.
function finishActivePrimer(
  deps: PrimerCommandDeps,
  from: PrimerView,
  kind: AgentFormEndKind,
) {
  finishActiveForm(
    { ...deps, bodyOf: buildBody, words: PRIMER_WORDS },
    from,
    kind,
  );
}

export type ClosePrimerFromMainDeps = Pick<
  PrimerCommandDeps,
  'store' | 'toast' | 'log'
>;

// Closes a primer main closed, as closeFormFromMain closes it.
export function closePrimerFromMain(
  deps: ClosePrimerFromMainDeps,
  closed: AgentFormClosed,
): void {
  closeFormFromMain({ ...deps, words: PRIMER_WORDS }, closed);
}
