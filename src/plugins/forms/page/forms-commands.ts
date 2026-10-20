import type { FocusOptions } from '../../../contracts/editor';
import type { Log } from '../../../contracts/log';
import type {
  PageCommandContext,
  PageStart,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { FindingAction, RoundEnd } from '../contract';
import { actionLabel } from '../finding-origins';
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
  type FormsView,
  findingActionOf,
  findingActionWord,
  type ItemAnswer,
  itemAnswer,
  type RailItem,
  railPosition,
  unansweredItem,
} from './form-state';
import type { FormsStore } from './forms-store';

export interface FormsCommandDeps {
  store: FormsStore;
  boxes: Pick<EditorBoxes, 'focus' | 'leave' | 'active' | 'boxOf'>;
  // Hands the finished round to main.
  finish(roundId: string, end: RoundEnd): void;
  closeSession(sessionId: string): void;
  layouts: LayoutCommandChannel;
  toast(text: string, tone: ToastTone): void;
  log: Log;
}

// Main's layout methods the layout keys invoke. The page applies a changed
// layout only from main's `layoutChanged` message, so what these resolve to
// is unused.
export interface LayoutCommandChannel {
  cycleLayout(step: 1 | -1): Promise<unknown>;
  copyLayout(): Promise<unknown>;
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
  const choose =
    (choice: number): Handler =>
    (context) =>
      changeAnswer(deps, context, { type: 'choose', choice }, (answer, item) =>
        answer.choice === choice
          ? `chose ${choice} on ${itemName(item)}`
          : `cleared the choice on ${itemName(item)}`,
      );

  // Acts only on a focused finding in the forms view, so a question or another
  // view logs nothing. A finding whose card lacks the action logs that and keeps
  // its answer.
  const act =
    (action: FindingAction): Handler =>
    (context) => {
      focusBoxItem(store, boxIn(deps, context));
      const lacking = findingLackingAction(store.get(), action);
      if (lacking !== null) {
        log(
          'forms',
          `${itemName(lacking)} offers no ${defectActionWord(action).toLowerCase()}`,
        );
        return;
      }
      changeAnswer(
        deps,
        context,
        { type: 'chooseAction', action },
        (_, item) =>
          findingAction(store.get(), item) === action
            ? `chose ${activeFindingActionWord(store.get(), item, action)} on ${itemName(item)}`
            : `cleared the action on ${itemName(item)}`,
      );
    };

  const jumpTo =
    (question: number): Handler =>
    (context) =>
      jumpToItem(deps, context, { kind: 'question', index: question });

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
    // A tenth choice is picked by mouse.
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
    actFixNow: act('fix_now'),
    actFollowUp: act('follow_up'),
    actLeaveIt: act('leave_it'),
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
    nextItem: (context) => moveItem(deps, context, { type: 'nextItem' }),
    prevItem: (context) => moveItem(deps, context, { type: 'prevItem' }),
    jumpTo1: jumpTo(1),
    jumpTo2: jumpTo(2),
    jumpTo3: jumpTo(3),
    jumpTo4: jumpTo(4),
    jumpTo5: jumpTo(5),
    jumpTo6: jumpTo(6),
    jumpTo7: jumpTo(7),
    jumpTo8: jumpTo(8),
    jumpTo9: jumpTo(9),
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
    nextLayout: layoutCommand(() => deps.layouts.cycleLayout(1)),
    prevLayout: layoutCommand(() => deps.layouts.cycleLayout(-1)),
    copyLayout: layoutCommand(() => deps.layouts.copyLayout()),
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

// How a log line names an item, e.g. `finding 2`.
function itemName(item: RailItem): string {
  return `${item.kind} ${item.index}`;
}

// The active round's action on `item`; '' on a question.
function findingAction(
  state: FormsState,
  item: AnswerableItem,
): FindingAction | '' {
  const round = activeRound(state);
  return round === null ? '' : findingActionOf(round, item);
}

// The finding card's word for `action` on `item` in the active round.
function activeFindingActionWord(
  state: FormsState,
  item: AnswerableItem,
  action: FindingAction,
): string | null {
  const round = activeRound(state);
  return round === null ? null : findingActionWord(round, item, action);
}

// The Defect card's word for `action`, which offers every action.
function defectActionWord(action: FindingAction): string {
  return actionLabel('caused', action) ?? action;
}

// The focused finding when the forms view shows it and its card does not offer
// `action`; null otherwise.
function findingLackingAction(
  state: FormsState,
  action: FindingAction,
): AnswerableItem | null {
  const focused = state.view === 'forms' ? focusedAnswer(state) : null;
  const isLacking =
    focused?.item.kind === 'finding' &&
    activeFindingActionWord(state, focused.item, action) === null;
  return isLacking ? focused.item : null;
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

// Focuses `item` as moveItem does; nothing when the forms view shows no round
// with that item.
function jumpToItem(
  deps: FormsCommandDeps,
  context: PageCommandContext,
  item: RailItem,
) {
  const state = deps.store.get();
  const round = activeRound(state);
  if (state.view !== 'forms' || round === null) {
    return;
  }
  const position = railPosition(round.round, item);
  if (position < 0) {
    return;
  }
  moveItem(deps, context, { type: 'focusItem', item: position });
  const moved = round.focus !== position;
  deps.log(
    'forms',
    moved ? `jumped to ${itemName(item)}` : `already on ${itemName(item)}`,
  );
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
  jumpToItem(deps, context, item);
}

// A session closes only once its round is gone: with its round active it asks
// to cancel the round, and confirming closes the session. A round open in the
// background keeps its session with no prompt, and the refusal is logged.
export function guardClose(
  deps: Pick<FormsCommandDeps, 'store' | 'log'>,
  sessionId: string,
): boolean {
  const { store } = deps;
  const round = store
    .get()
    .rounds.find((candidate) => candidate.sessionId === sessionId);
  if (round === undefined) {
    return true;
  }
  if (round.roundId !== store.get().activeRoundId) {
    deps.log(
      'forms',
      `session close kept: ${round.label} is open in the background`,
    );
    return false;
  }
  const wasConfirm = store.get().view === 'confirm';
  store.dispatch({ type: 'askClose', sessionId });
  if (!wasConfirm && store.get().view === 'confirm') {
    deps.log('forms', `closing the session asks to cancel ${round.label}`);
  }
  return false;
}

// Reads the body before the round leaves the state, hands it to main, then
// closes the round, and its session when the cancel prompt was asked by
// closing it.
function finishActiveRound(
  deps: FormsCommandDeps,
  from: FormsView,
  kind: RoundEnd['kind'],
) {
  const state = deps.store.get();
  const round = activeRound(state);
  if (state.view !== from || round === null) {
    return;
  }
  const closesSession = kind === 'cancelled' && state.confirmClosesSession;
  deps.finish(round.roundId, { kind, body: buildBody(round) });
  const isSubmit = kind === 'submitted';
  deps.store.dispatch(
    isSubmit
      ? { type: 'roundClosed', roundId: round.roundId }
      : { type: 'confirmCancel' },
  );
  deps.log('forms', kind);
  deps.toast(
    isSubmit
      ? `Answers sent: ${round.label}`
      : `Round cancelled: ${round.label}`,
    isSubmit ? 'success' : 'info',
  );
  if (closesSession) {
    deps.closeSession(round.sessionId);
  }
}
