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
import type { Log } from '../../../contracts/log';
import type {
  PageCommandContext,
  PageStart,
  ToastTone,
} from '../../../contracts/plugin';
import { scrollText } from '../../../shared/content-scroll';
import { errorText } from '../../../shared/error-text';
import { type EditorBoxes, stepBox } from '../../../shared/page/editor-boxes';
import {
  MAX_PRIMER_ENTRIES,
  MAX_PRIMER_ITEMS,
  type PrimerBody,
  type PrimerNeed,
  type PrimerView,
} from '../contract';
import type { primerManifest } from '../manifest';
import { boxKey, focusActionFor, type PrimerBox, shownBoxes } from './boxes';
import {
  activePrimer,
  buildBody,
  type OpenPrimer,
  type PrimerAction,
  primerOfSession,
  type PrimerPane,
  type PrimerState,
  rowName,
  selectedEntry,
  selectedRow,
  submitProblems,
  type TextTarget,
} from './primer-state';
import type { PrimerStore } from './primer-store';

export interface PrimerCommandDeps {
  store: PrimerStore;
  boxes: Pick<EditorBoxes<PrimerBox>, 'focus' | 'leave' | 'active' | 'boxOf'>;
  // Hands the finished primer to main; rejects with the reason when main
  // keeps it open.
  finish(primerId: string, end: AgentFormEnd<PrimerBody>): Promise<void>;
  closeSession(sessionId: string): void;
  // Scrolls the active primer's card or review by `step`, down for 1 and up
  // for -1; null when no primer is shown.
  scrollPrimer(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
  toast(text: string, tone: ToastTone): void;
  log: Log;
}

// A handler's body, run once the box it fired in has its row shown; `box` is
// that box, undefined from the page.
type Run = (box: PrimerBox | undefined) => void;

const SOURCE = 'primer';

const APPEND: FocusOptions = { insertAtEnd: true };

// Every primer command's handler, by short id. A command fired in a box first
// shows that box's row and item, so it acts where the user is typing.
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
    nextRow: handler(() => moveRow(deps, { type: 'nextRow' })),
    prevRow: handler(() => moveRow(deps, { type: 'prevRow' })),
    needYes: handler(() => setNeed(deps, 'yes')),
    needNo: handler(() => setNeed(deps, 'no')),
    needUnclear: handler(() => setNeed(deps, 'unclear')),
    addExtraTask: handler(() => addExtraTask(deps)),
    removeExtraTask: handler(() => removeExtraTask(deps)),
    focusCard: handler(() => focusPane(deps, 'card', 'focused the card')),
    focusRail: handler((box) => {
      commitNewItem(deps, box);
      boxes.leave();
      focusPane(deps, 'rail', 'focused the rail');
    }),
    nextItem: handler(() => moveItem(deps, { type: 'nextItem' })),
    prevItem: handler(() => moveItem(deps, { type: 'prevItem' })),
    toggleInclude: handler(() => toggleInclude(deps)),
    addItem: handler(() => focusAddItem(deps)),
    editItemComment: handler(() => focusItemComment(deps)),
    editTaskComment: handler(() => focusTaskComment(deps)),
    editFirstField: handler(() => {
      const first = shownBoxes(store.get())[0];
      if (first === undefined) {
        log(SOURCE, 'no box to focus');
        return;
      }
      boxes.focus(first, APPEND);
    }),
    nextBox: handler((box) => stepFocus(deps, box, 1)),
    prevBox: handler((box) => stepFocus(deps, box, -1)),
    leaveBox: handler((box) => {
      commitNewItem(deps, box);
      boxes.leave();
      log(SOURCE, 'left the box');
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
    submit: handler(() => submit(deps)),
    askCancel: dispatchOnly({ type: 'askCancel' }),
    dismissConfirm: dispatchOnly({ type: 'dismissConfirm' }),
    confirmCancel: handler(() =>
      finishActivePrimer(deps, 'confirm', 'cancelled'),
    ),
  };
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

// The active primer, or null outside view 'primer' or with none.
function shownPrimer(state: PrimerState): OpenPrimer | null {
  return state.view === 'primer' ? activePrimer(state) : null;
}

function focusTarget(
  deps: PrimerCommandDeps,
  primer: OpenPrimer,
  target: TextTarget,
) {
  deps.boxes.focus({ primerId: primer.primerId, target }, APPEND);
}

function moveRow(deps: PrimerCommandDeps, action: PrimerAction) {
  const before = activePrimer(deps.store.get())?.railCursor;
  deps.store.dispatch(action);
  const primer = activePrimer(deps.store.get());
  if (primer !== null && primer.railCursor !== before) {
    deps.log(SOURCE, `selected ${rowName(selectedRow(primer))}`);
  }
}

function setNeed(deps: PrimerCommandDeps, need: PrimerNeed) {
  const primer = shownPrimer(deps.store.get());
  if (primer === null) {
    return;
  }
  const entry = selectedEntry(primer);
  if (entry === null) {
    deps.log(SOURCE, 'no task selected');
    return;
  }
  const before = deps.store.get();
  deps.store.dispatch({ type: 'setNeed', need });
  if (deps.store.get() !== before) {
    deps.log(SOURCE, `need ${need} on task ${entry.id}`);
  }
}

function addExtraTask(deps: PrimerCommandDeps) {
  const before = deps.store.get();
  const primer = shownPrimer(before);
  if (primer === null) {
    return;
  }
  if (primer.entries.length >= MAX_PRIMER_ENTRIES) {
    deps.log(
      SOURCE,
      `no task added: the primer holds ${MAX_PRIMER_ENTRIES} tasks`,
    );
    return;
  }
  deps.store.dispatch({ type: 'addExtraTask' });
  const added = activePrimer(deps.store.get());
  if (deps.store.get() === before || added === null) {
    return;
  }
  const entry = selectedEntry(added);
  if (entry === null) {
    return;
  }
  deps.log(SOURCE, `added extra task ${entry.id}`);
  focusTarget(deps, added, { field: 'taskName', entryId: entry.id });
}

function removeExtraTask(deps: PrimerCommandDeps) {
  const primer = shownPrimer(deps.store.get());
  if (primer === null) {
    return;
  }
  const entry = selectedEntry(primer);
  if (entry === null || entry.group !== 'extra') {
    deps.log(SOURCE, 'only an extra task can be removed');
    return;
  }
  const before = deps.store.get();
  deps.store.dispatch({ type: 'removeExtraTask' });
  if (deps.store.get() !== before) {
    deps.log(SOURCE, `removed extra task ${entry.id}`);
  }
}

function focusPane(deps: PrimerCommandDeps, pane: PrimerPane, line: string) {
  const before = activePrimer(deps.store.get())?.pane;
  deps.store.dispatch({ type: 'focusPane', pane });
  const after = activePrimer(deps.store.get())?.pane;
  if (after !== undefined && after !== before) {
    deps.log(SOURCE, line);
  }
}

function moveItem(deps: PrimerCommandDeps, action: PrimerAction) {
  const before = activePrimer(deps.store.get())?.itemCursor;
  deps.store.dispatch(action);
  const primer = activePrimer(deps.store.get());
  if (primer === null || primer.itemCursor === before) {
    return;
  }
  const entry = selectedEntry(primer);
  if (entry !== null) {
    deps.log(
      SOURCE,
      `selected item ${primer.itemCursor + 1} on task ${entry.id}`,
    );
  }
}

// The item at the shown primer's cursor, with its primer and task; null when
// no item is selected.
interface CursorItem {
  primer: OpenPrimer;
  entryId: string;
  // 1-based.
  item: number;
  include: boolean;
}

function cursorItem(state: PrimerState): CursorItem | null {
  const primer = shownPrimer(state);
  if (primer === null) {
    return null;
  }
  const entry = selectedEntry(primer);
  const item = entry?.items[primer.itemCursor];
  if (entry === null || item === undefined) {
    return null;
  }
  return {
    primer,
    entryId: entry.id,
    item: primer.itemCursor + 1,
    include: item.include,
  };
}

function toggleInclude(deps: PrimerCommandDeps) {
  const before = deps.store.get();
  if (shownPrimer(before) === null) {
    return;
  }
  const cursor = cursorItem(before);
  if (cursor === null) {
    deps.log(SOURCE, 'no item selected');
    return;
  }
  deps.store.dispatch({ type: 'toggleInclude' });
  const after = cursorItem(deps.store.get());
  if (deps.store.get() === before || after === null) {
    return;
  }
  const { entryId, item, include } = after;
  deps.log(
    SOURCE,
    `${include ? 'included' : 'left out'} item ${item} on task ${entryId}`,
  );
}

function focusItemComment(deps: PrimerCommandDeps) {
  const state = deps.store.get();
  if (shownPrimer(state) === null) {
    return;
  }
  const cursor = cursorItem(state);
  if (cursor === null) {
    deps.log(SOURCE, 'no item selected');
    return;
  }
  const { primer, entryId, item } = cursor;
  focusTarget(deps, primer, { field: 'itemComment', entryId, item });
}

function focusTaskComment(deps: PrimerCommandDeps) {
  const primer = shownPrimer(deps.store.get());
  if (primer === null) {
    return;
  }
  const entry = selectedEntry(primer);
  if (entry === null) {
    deps.log(SOURCE, 'no task selected');
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
    deps.log(SOURCE, 'no task selected');
    return;
  }
  if (entry.items.length >= MAX_PRIMER_ITEMS) {
    deps.log(SOURCE, fullTaskLine(entry.id));
    return;
  }
  focusTarget(deps, primer, { field: 'newItem', entryId: entry.id });
}

function fullTaskLine(entryId: string): string {
  return `no item added: task ${entryId} holds ${MAX_PRIMER_ITEMS} items`;
}

// Adds the add-item box's text as an item when `box` is an add-item box,
// before a key that leaves it acts.
function commitNewItem(deps: PrimerCommandDeps, box: PrimerBox | undefined) {
  if (box === undefined || box.target.field !== 'newItem') {
    return;
  }
  const { primerId } = box;
  const { entryId } = box.target;
  const primer = deps.store
    .get()
    .primers.find((candidate) => candidate.primerId === primerId);
  const entry = primer?.entries.find((candidate) => candidate.id === entryId);
  const text = (primer?.newItemTexts[entryId] ?? '').trim();
  if (entry === undefined || text === '') {
    return;
  }
  if (entry.items.length >= MAX_PRIMER_ITEMS) {
    deps.log(SOURCE, fullTaskLine(entryId));
    return;
  }
  const before = deps.store.get();
  deps.store.dispatch({ type: 'addItem', primerId, entryId });
  if (deps.store.get() !== before) {
    deps.log(SOURCE, `added item ${entry.items.length + 1} on task ${entryId}`);
  }
}

function stepFocus(
  deps: PrimerCommandDeps,
  box: PrimerBox | undefined,
  step: 1 | -1,
) {
  commitNewItem(deps, box);
  const next = stepBox(shownBoxes(deps.store.get()), boxKey, box ?? null, step);
  if (next === null) {
    deps.log(SOURCE, 'no box to focus');
    return;
  }
  deps.boxes.focus(next);
}

// Leaves focus where it is, so a box keeps focus and its vim mode.
function scrollPrimer(
  deps: PrimerCommandDeps,
  step: ScrollStep,
  direction: 1 | -1,
) {
  const scroll = deps.scrollPrimer(step, direction);
  deps.log(
    SOURCE,
    scroll === null
      ? 'no primer to scroll'
      : scrollText('the primer', step, direction, scroll),
  );
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
    deps.log(SOURCE, line);
  }
}

function submit(deps: PrimerCommandDeps) {
  const state = deps.store.get();
  const primer = activePrimer(state);
  if (state.view !== 'review' || primer === null || primer.sending !== null) {
    return;
  }
  const problems = submitProblems(primer);
  if (problems.length > 0) {
    deps.log(SOURCE, `submit refused: ${problems.join(' ')}`);
    return;
  }
  finishActivePrimer(deps, 'review', 'submitted');
}

// `showPrimer` selects the session's Primer tab; `activate` selects the
// session.
export interface GuardCloseDeps extends Pick<
  PrimerCommandDeps,
  'store' | 'toast' | 'log'
> {
  showPrimer(sessionId: string): void;
  activate(sessionId: string): void;
}

// A session closes only once its primer is gone: with its primer active it
// selects the session's Primer tab, so the confirm scope's keys are in force,
// and asks to cancel the primer; confirming closes the session. A primer open
// in the background keeps its session with no prompt: the guard logs the
// refusal, toasts why, and selects the session. A primer being sent, active or
// not, keeps its session: the guard logs and toasts the send, and selects
// nothing.
export function guardClose(deps: GuardCloseDeps, sessionId: string): boolean {
  const { store } = deps;
  const primer = primerOfSession(store.get(), sessionId);
  if (primer === undefined) {
    return true;
  }
  if (primer.sending !== null) {
    deps.log(SOURCE, `session close kept: ${primer.label} is sending`);
    deps.toast(`Sending ${primer.label}'s primer…`, 'info');
    return false;
  }
  if (primer.primerId !== store.get().activePrimerId) {
    deps.log(
      SOURCE,
      `session close kept: ${primer.label} is open in the background`,
    );
    deps.toast(`Finish or cancel ${primer.label}'s primer first`, 'info');
    deps.activate(sessionId);
    return false;
  }
  deps.showPrimer(sessionId);
  const wasConfirm = store.get().view === 'confirm';
  store.dispatch({ type: 'askClose', sessionId });
  if (!wasConfirm && store.get().view === 'confirm') {
    deps.log(SOURCE, `closing the session asks to cancel ${primer.label}`);
  }
  return false;
}

// Marks the primer sending and hands main its body; main's `formClosed` then
// closes it through closePrimerFromMain. A rejected finish clears the mark,
// keeping the primer as it was, and toasts the reason.
function finishActivePrimer(
  deps: PrimerCommandDeps,
  from: PrimerView,
  kind: AgentFormEndKind,
) {
  const state = deps.store.get();
  const primer = activePrimer(state);
  if (state.view !== from || primer === null || primer.sending !== null) {
    return;
  }
  const { primerId } = primer;
  const body = buildBody(primer);
  deps.store.dispatch({ type: 'sendStarted', primerId, kind });
  void deps.finish(primerId, { kind, body }).catch((error) => {
    deps.store.dispatch({ type: 'sendFailed', primerId });
    deps.log(SOURCE, `primer ${primerId} not finished: ${errorText(error)}`);
    deps.toast(`Primer not sent: ${errorText(error)}`, 'error');
  });
}

export type ClosePrimerFromMainDeps = Pick<
  PrimerCommandDeps,
  'store' | 'closeSession' | 'toast' | 'log'
>;

// Closes a primer main closed. A primer the page was sending closes its
// session when the close prompt asked the cancel, whoever closed the primer.
// Only a primer the page's finish closed logs and toasts its send; one main
// closed on its own stays quiet, since main dropped those edits, and its send
// is failed first.
export function closePrimerFromMain(
  deps: ClosePrimerFromMainDeps,
  closed: AgentFormClosed,
): void {
  const primerId = closed.formId;
  const primer = deps.store
    .get()
    .primers.find((candidate) => candidate.primerId === primerId);
  const sending = primer?.sending ?? null;
  if (!closed.byFinish && sending !== null) {
    deps.store.dispatch({ type: 'sendFailed', primerId });
  }
  deps.store.dispatch({ type: 'primerClosed', primerId });
  if (primer === undefined || sending === null) {
    return;
  }
  if (closed.byFinish) {
    const isSubmit = sending.kind === 'submitted';
    deps.log(SOURCE, sending.kind);
    deps.toast(
      isSubmit
        ? `Primer sent: ${primer.label}`
        : `Primer cancelled: ${primer.label}`,
      isSubmit ? 'success' : 'info',
    );
  }
  if (sending.closesSession) {
    deps.closeSession(primer.sessionId);
  }
}
