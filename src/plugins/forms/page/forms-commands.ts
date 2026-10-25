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
import { errorText } from '../../../shared/error-text';
import { scrollText } from '../../../shared/content-scroll';
import type { FormsView, RoundClosed, RoundEnd } from '../contract';
import type { formsManifest } from '../manifest';
import {
  type BoxField,
  type BoxRef,
  focusActionFor,
  shownBox,
  stepBox,
} from './boxes';
import type { EditorBoxes } from './editor-boxes';
import {
  activeRound,
  type AnswerableItem,
  buildBody,
  focusedItem,
  type FormsAction,
  type FormsState,
  type ItemAnswer,
  itemAnswer,
  pickNumber,
  railPosition,
  roundOfSession,
  unansweredItem,
} from './form-state';
import type { FormsStore } from './forms-store';
import { itemName, jumpedToLine, jumpMoved } from './view-model';

export interface FormsCommandDeps {
  store: FormsStore;
  boxes: Pick<EditorBoxes, 'focus' | 'leave' | 'active' | 'boxOf'>;
  // Hands the finished round to main; rejects with the reason when main keeps
  // the round open.
  finish(roundId: string, end: RoundEnd): Promise<void>;
  closeSession(sessionId: string): void;
  layouts: LayoutCommandChannel;
  // Scrolls the active round's main column by `step`, down for 1 and up for
  // -1; null when no round is shown to scroll.
  scrollForm(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
  toast(text: string, tone: ToastTone): void;
  log: Log;
}

// Main's layout method the preview key invokes; what it resolves to is unused.
export interface LayoutCommandChannel {
  openPreview(): Promise<unknown>;
}

type Handler = (context: PageCommandContext) => void;

type DescribeChange = (answer: ItemAnswer, item: AnswerableItem) => string;

const ANSWER_FIELDS: BoxField[] = ['notes', 'comment'];

const APPEND: FocusOptions = { insertAtEnd: true };

// Every forms command's handler, by short id. A command fired in a box first
// focuses that box's item, so it acts where the user is typing.
export function formsCommandHandlers(
  deps: FormsCommandDeps,
): PageStart<typeof formsManifest>['commands'] {
  const { store, boxes, log } = deps;
  // Applies its form-state action and nothing more.
  const plain =
    (action: FormsAction): Handler =>
    (context) => {
      focusBoxItem(store, boxIn(deps, context));
      store.dispatch(action);
    };
  // Logs the number the item now holds, a question's choice or a finding's
  // entry, or the clear when the same number was held.
  const choose =
    (number: number): Handler =>
    (context) =>
      changeAnswer(deps, context, { type: 'choose', number }, (_, item) =>
        activePickNumber(store.get(), item) === number
          ? `chose ${number} on ${itemName(item)}`
          : `cleared the choice on ${itemName(item)}`,
      );

  const layoutCommand =
    (invoke: () => Promise<unknown>): Handler =>
    () =>
      void invoke().catch((error) => {
        log('forms', `layout command failed: ${errorText(error)}`);
        deps.toast(`Layout command failed: ${errorText(error)}`, 'error');
      });

  return {
    closeReview: plain({ type: 'closeReview' }),
    reviewNext: plain({ type: 'reviewNext' }),
    reviewPrev: plain({ type: 'reviewPrev' }),
    reviewJump: plain({ type: 'reviewJump' }),
    askCancel: plain({ type: 'askCancel' }),
    dismissConfirm: plain({ type: 'dismissConfirm' }),
    // Main refuses a round whose question choices or finding entries outnumber
    // these keys, so every numbered entry has one.
    choose1: choose(1),
    choose2: choose(2),
    choose3: choose(3),
    choose4: choose(4),
    choose5: choose(5),
    choose6: choose(6),
    choose7: choose(7),
    choose8: choose(8),
    choose9: choose(9),
    clearChoice: (context) =>
      changeAnswer(
        deps,
        context,
        { type: 'clearChoice' },
        (_answer, item) => `cleared the choice on ${itemName(item)}`,
      ),
    acceptRecommendation: (context) =>
      changeAnswer(
        deps,
        context,
        { type: 'acceptRecommendation' },
        (_answer, item) => `accepted the recommendation on ${itemName(item)}`,
      ),
    toggleNotApplicable: (context) =>
      changeAnswer(
        deps,
        context,
        { type: 'toggleNotApplicable' },
        (answer, item) =>
          answer.notApplicable
            ? `not applicable on ${itemName(item)}`
            : `applicable again on ${itemName(item)}`,
      ),
    toggleDontAsk: (context) => {
      const answer = changeAnswer(
        deps,
        context,
        { type: 'toggleDontAsk' },
        (changed, item) =>
          changed.dontAsk
            ? `don't ask on ${itemName(item)}`
            : `ask again on ${itemName(item)}`,
      );
      if (answer?.dontAsk) {
        focusShownBox(deps, ['dontAskReason']);
      }
    },
    // As vim's `A`: `a` and `o` start typing after the box's text.
    editNotes: () => focusShownBox(deps, ANSWER_FIELDS, APPEND),
    editNote: () => focusShownBox(deps, ['note'], APPEND),
    nextBox: (context) => stepFocus(deps, context, 1),
    prevBox: (context) => stepFocus(deps, context, -1),
    leaveBox: () => {
      boxes.leave();
      log('forms', 'left the box');
    },
    lineDown: () => scrollForm(deps, 'line', 1),
    lineUp: () => scrollForm(deps, 'line', -1),
    halfPageDown: () => scrollForm(deps, 'halfPage', 1),
    halfPageUp: () => scrollForm(deps, 'halfPage', -1),
    nextItem: (context) => moveItem(deps, context, { type: 'nextItem' }),
    prevItem: (context) => moveItem(deps, context, { type: 'prevItem' }),
    nextUnanswered: (context) => jumpToUnanswered(deps, context, 1),
    prevUnanswered: (context) => jumpToUnanswered(deps, context, -1),
    openReview: (context) => {
      focusBoxItem(store, boxIn(deps, context));
      const wasForms = store.get().view === 'forms';
      store.dispatch({ type: 'openReview' });
      if (wasForms && store.get().view === 'review') {
        log('forms', 'review opened');
      }
    },
    submit: () => finishActiveRound(deps, 'review', 'submitted'),
    confirmCancel: () => finishActiveRound(deps, 'confirm', 'cancelled'),
    openPreview: layoutCommand(() => deps.layouts.openPreview()),
  };
}

// The forms box the command's editor edits. A key with no editor in its
// context acts on the focused box: a page key never fires while a box has
// focus, and a chord bind fires inside one without naming the editor.
function boxIn(
  deps: FormsCommandDeps,
  context: PageCommandContext,
): BoxRef | undefined {
  return context.editor === undefined
    ? (deps.boxes.active() ?? undefined)
    : deps.boxes.boxOf(context.editor);
}

function focusBoxItem(store: FormsStore, box: BoxRef | undefined) {
  if (box === undefined) {
    return;
  }
  const action = focusActionFor(store.get(), box);
  if (action !== null) {
    store.dispatch(action);
  }
}

// The number `item` holds in the active round, 0 for none or no round.
function activePickNumber(state: FormsState, item: AnswerableItem): number {
  const round = activeRound(state);
  return round === null ? 0 : pickNumber(round, item);
}

function focusedAnswer(
  state: FormsState,
): { item: AnswerableItem; answer: ItemAnswer } | null {
  const round = activeRound(state);
  const focused = round === null ? null : focusedItem(round);
  if (round === null || focused === null || focused.kind === 'notice') {
    return null;
  }
  const item = { kind: focused.kind, index: focused.index };
  return { item, answer: itemAnswer(round, item) };
}

// Applies an answer action to the focused question or finding and logs the
// change; returns the changed answer, or null when nothing changed.
function changeAnswer(
  deps: FormsCommandDeps,
  context: PageCommandContext,
  action: FormsAction,
  describe: DescribeChange,
): ItemAnswer | null {
  focusBoxItem(deps.store, boxIn(deps, context));
  const before = focusedAnswer(deps.store.get());
  deps.store.dispatch(action);
  const after = focusedAnswer(deps.store.get());
  if (before === null || after === null || after.answer === before.answer) {
    return null;
  }
  deps.log('forms', describe(after.answer, after.item));
  return after.answer;
}

function focusShownBox(
  deps: FormsCommandDeps,
  fields: BoxField[],
  options?: FocusOptions,
) {
  const box = shownBox(deps.store.get(), fields);
  if (box !== null) {
    deps.boxes.focus(box, options);
  }
}

function stepFocus(
  deps: FormsCommandDeps,
  context: PageCommandContext,
  step: number,
) {
  const from = boxIn(deps, context) ?? null;
  const next = stepBox(deps.store.get(), from, step);
  if (next !== null) {
    deps.boxes.focus(next);
  }
}

// Leaves focus where it is, so a box keeps focus and its vim mode.
function scrollForm(
  deps: FormsCommandDeps,
  step: ScrollStep,
  direction: 1 | -1,
) {
  const scroll = deps.scrollForm(step, direction);
  deps.log(
    'forms',
    scroll === null
      ? 'no round to scroll'
      : scrollText('the form', step, direction, scroll),
  );
}

// From inside a box the user stays typing: the new item's notes or comment
// box takes focus. From the page, focus stays on the page.
function moveItem(
  deps: FormsCommandDeps,
  context: PageCommandContext,
  action: FormsAction,
) {
  const box = boxIn(deps, context);
  focusBoxItem(deps.store, box);
  const before = activeRound(deps.store.get())?.focus;
  deps.store.dispatch(action);
  const after = activeRound(deps.store.get())?.focus;
  if (box !== undefined && after !== before) {
    focusShownBox(deps, ANSWER_FIELDS);
  }
}

function jumpToUnanswered(
  deps: FormsCommandDeps,
  context: PageCommandContext,
  step: 1 | -1,
) {
  focusBoxItem(deps.store, boxIn(deps, context));
  const state = deps.store.get();
  const round = activeRound(state);
  if (state.view !== 'forms' || round === null) {
    return;
  }
  const item = unansweredItem(round, step);
  if (item === null) {
    deps.log('forms', 'no unanswered item');
    return;
  }
  const focused = focusedItem(round);
  const isFocusedItem =
    focused?.kind === item.kind && focused.index === item.index;
  if (isFocusedItem) {
    deps.log('forms', 'no other unanswered item');
    return;
  }
  moveItem(deps, context, {
    type: 'focusItem',
    item: railPosition(round.round, item),
  });
  if (jumpMoved(state, deps.store.get())) {
    deps.log('forms', jumpedToLine(item));
  }
}

// `showForm` selects the session's Form tab; `activate` selects the session.
export interface GuardCloseDeps extends Pick<
  FormsCommandDeps,
  'store' | 'toast' | 'log'
> {
  showForm(sessionId: string): void;
  activate(sessionId: string): void;
}

// A session closes only once its round is gone: with its round active it
// selects the session's Form tab, so the confirm scope's keys are in force,
// and asks to cancel the round; confirming closes the session. A round open in
// the background keeps its session with no prompt: the guard logs the refusal,
// toasts why, and selects the session. A round being sent, active or not,
// keeps its session: the guard logs and toasts the send, and selects nothing.
export function guardClose(deps: GuardCloseDeps, sessionId: string): boolean {
  const { store } = deps;
  const round = roundOfSession(store.get(), sessionId);
  if (round === undefined) {
    return true;
  }
  if (round.sending !== null) {
    deps.log('forms', `session close kept: ${round.label} is sending`);
    deps.toast(`Sending ${round.label}'s round…`, 'info');
    return false;
  }
  if (round.roundId !== store.get().activeRoundId) {
    deps.log(
      'forms',
      `session close kept: ${round.label} is open in the background`,
    );
    deps.toast(`Finish or cancel ${round.label}'s round first`, 'info');
    deps.activate(sessionId);
    return false;
  }
  deps.showForm(sessionId);
  const wasConfirm = store.get().view === 'confirm';
  store.dispatch({ type: 'askClose', sessionId });
  if (!wasConfirm && store.get().view === 'confirm') {
    deps.log('forms', `closing the session asks to cancel ${round.label}`);
  }
  return false;
}

// Marks the round sending and hands main its body; main's `roundClosed` then
// closes it through closeRoundFromMain. A rejected finish clears the mark,
// keeping the round as it was, and toasts the reason.
function finishActiveRound(
  deps: FormsCommandDeps,
  from: FormsView,
  kind: RoundEnd['kind'],
) {
  const state = deps.store.get();
  const round = activeRound(state);
  if (state.view !== from || round === null || round.sending !== null) {
    return;
  }
  const { roundId } = round;
  const body = buildBody(round);
  deps.store.dispatch({ type: 'sendStarted', roundId, kind });
  void deps.finish(roundId, { kind, body }).catch((error) => {
    deps.store.dispatch({ type: 'sendFailed', roundId });
    deps.log('forms', `round ${roundId} not finished: ${errorText(error)}`);
    deps.toast(`Round not sent: ${errorText(error)}`, 'error');
  });
}

export type CloseRoundFromMainDeps = Pick<
  FormsCommandDeps,
  'store' | 'closeSession' | 'toast' | 'log'
>;

// Closes a round main closed. A round the page was sending closes its session
// when the close prompt asked the cancel, whoever closed the round. Only a
// round the page's finish closed logs and toasts its send; one main closed on
// its own stays quiet, since main dropped those answers, and its send is
// failed first, so its `roundFinished` says `closed`.
export function closeRoundFromMain(
  deps: CloseRoundFromMainDeps,
  closed: RoundClosed,
): void {
  const { roundId } = closed;
  const round = deps.store
    .get()
    .rounds.find((candidate) => candidate.roundId === roundId);
  const sending = round?.sending ?? null;
  if (!closed.byFinish && sending !== null) {
    deps.store.dispatch({ type: 'sendFailed', roundId });
  }
  deps.store.dispatch({ type: 'roundClosed', roundId });
  if (round === undefined || sending === null) {
    return;
  }
  if (closed.byFinish) {
    const isSubmit = sending.kind === 'submitted';
    deps.log('forms', sending.kind);
    deps.toast(
      isSubmit
        ? `Answers sent: ${round.label}`
        : `Round cancelled: ${round.label}`,
      isSubmit ? 'success' : 'info',
    );
  }
  if (sending.closesSession) {
    deps.closeSession(round.sessionId);
  }
}
