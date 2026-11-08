import type {
  ContentScroll,
  FocusOptions,
  ScrollStep,
} from '../../../contracts/editor';
import type { PluginLog } from '../../../contracts/log';
import type {
  PageCommandContext,
  PageStart,
  ToastTone,
} from '../../../contracts/plugin';
import type {
  AgentFormClosed,
  AgentFormEndKind,
} from '../../../contracts/agent-forms';
import { errorText } from '../../../shared/error-text';
import { scrollText } from '../../../shared/content-scroll';
import { type EditorBoxes, stepBox } from '../../../shared/page/editor-boxes';
import {
  activeForm,
  closeFormFromMain,
  finishActiveForm,
  guardSessionClose,
  type SessionCloseAnswers,
  type SessionFormWords,
} from '../../../shared/page/session-forms';
import type { FormsView, RoundEnd } from '../contract';
import type { formsManifest } from '../manifest';
import {
  type BoxField,
  type BoxRef,
  boxKey,
  focusActionFor,
  shownBox,
  shownBoxes,
} from './boxes';
import {
  type AnswerableItem,
  buildBody,
  focusedItem,
  type FormsAction,
  type FormsState,
  type FormsStore,
  type ItemAnswer,
  itemAnswer,
  pickNumber,
  railPosition,
  type RoundState,
  unansweredItem,
} from './form-state';
import {
  itemName,
  jumpedToLine,
  jumpMoved,
  lineCursorLine,
  toggleNoticeLine,
} from './view-model';

export interface FormsCommandDeps {
  store: FormsStore;
  boxes: Pick<EditorBoxes<BoxRef>, 'focus' | 'leave' | 'active' | 'boxOf'>;
  // Hands the finished round to main; rejects with the reason when main keeps
  // the round open.
  finish(roundId: string, end: RoundEnd): Promise<void>;
  layouts: LayoutCommandChannel;
  // Scrolls the active round's main column by `step`, down for 1 and up for
  // -1; null when no round is shown to scroll.
  scrollForm(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
  toast(text: string, tone: ToastTone): void;
  log: PluginLog;
}

// How the forms page's log and toasts name a round.
const ROUND_WORDS: SessionFormWords = {
  noun: 'round',
  sent: 'Answers sent',
};

// Main's layout method the preview key invokes; what it resolves to is unused.
export interface LayoutCommandChannel {
  openPreview(): Promise<unknown>;
}

type EditorContext = Pick<PageCommandContext, 'editor'>;

type Handler = (context: EditorContext) => void;

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
  const layoutCommand =
    (invoke: () => Promise<unknown>): Handler =>
    () =>
      void invoke().catch((error) => {
        log(`layout command failed: ${errorText(error)}`);
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
    // the number keys, so every numbered entry has one. Logs the number the item
    // now holds, a question's choice or a finding's entry, or the clear when the
    // same number was held.
    choose: (context) => {
      const number = context.arg;
      changeAnswer(deps, context, { type: 'choose', number }, (_, item) =>
        activePickNumber(store.get(), item) === number
          ? `chose ${number} on ${itemName(item)}`
          : `cleared the choice on ${itemName(item)}`,
      );
    },
    clearChoice: (context) => {
      changeAnswer(
        deps,
        context,
        { type: 'clearChoice' },
        (_answer, item) => `cleared the choice on ${itemName(item)}`,
      );
    },
    // On the notices stop, opens or closes the line under the cursor.
    acceptRecommendation: (context) => {
      focusBoxItem(store, boxIn(deps, context));
      const stop = noticesStop(store.get());
      if (stop !== null) {
        toggleCursorLine(deps, stop);
        return;
      }
      changeAnswer(
        deps,
        context,
        { type: 'acceptRecommendation' },
        (_answer, item) => `accepted the recommendation on ${itemName(item)}`,
      );
    },
    toggleNotApplicable: (context) => {
      changeAnswer(
        deps,
        context,
        { type: 'toggleNotApplicable' },
        (answer, item) =>
          answer.notApplicable
            ? `not applicable on ${itemName(item)}`
            : `applicable again on ${itemName(item)}`,
      );
    },
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
    // As vim's `A`: `a` and `o` start typing after the box's text. On the
    // notices stop, opens the line under the cursor first.
    editNotes: () => {
      const stop = noticesStop(store.get());
      if (stop === null) {
        focusShownBox(deps, ANSWER_FIELDS, APPEND);
        return;
      }
      if (!stop.openNotices[stop.noticeLine - 1]) {
        toggleCursorLine(deps, stop);
      }
      focusCursorLineBox(deps, APPEND);
    },
    editNote: () => focusShownBox(deps, ['note'], APPEND),
    nextBox: (context) => stepFocus(deps, context, 1),
    prevBox: (context) => stepFocus(deps, context, -1),
    leaveBox: () => {
      boxes.leave();
      log('left the box');
    },
    lineDown: () => scrollForm(deps, 'line', 1),
    lineUp: () => scrollForm(deps, 'line', -1),
    halfPageDown: () => scrollForm(deps, 'halfPage', 1),
    halfPageUp: () => scrollForm(deps, 'halfPage', -1),
    nextItem: (context) => moveItem(deps, context, { type: 'nextItem' }),
    prevItem: (context) => moveItem(deps, context, { type: 'prevItem' }),
    nextLine: (context) => moveLine(deps, context, 1),
    prevLine: (context) => moveLine(deps, context, -1),
    toggleNotice: (context) => {
      focusBoxItem(store, boxIn(deps, context));
      const stop = noticesStop(store.get());
      if (stop !== null) {
        toggleCursorLine(deps, stop);
      }
    },
    nextUnanswered: (context) => jumpToUnanswered(deps, context, 1),
    prevUnanswered: (context) => jumpToUnanswered(deps, context, -1),
    openReview: (context) => {
      focusBoxItem(store, boxIn(deps, context));
      const wasForms = store.get().view === 'forms';
      store.dispatch({ type: 'openReview' });
      if (wasForms && store.get().view === 'review') {
        log('review opened');
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
  context: EditorContext,
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
  const round = activeForm(state);
  return round === null ? 0 : pickNumber(round, item);
}

function focusedAnswer(
  state: FormsState,
): { item: AnswerableItem; answer: ItemAnswer } | null {
  const round = activeForm(state);
  const focused = round === null ? null : focusedItem(round);
  if (round === null || focused === null || focused.kind === 'notices') {
    return null;
  }
  const item = { kind: focused.kind, index: focused.index };
  return { item, answer: itemAnswer(round, item) };
}

// Applies an answer action to the focused question or finding and logs the
// change; returns the changed answer, or null when nothing changed.
function changeAnswer(
  deps: FormsCommandDeps,
  context: EditorContext,
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
  deps.log(describe(after.answer, after.item));
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
  context: EditorContext,
  step: number,
) {
  const from = boxIn(deps, context) ?? null;
  const next = stepBox(shownBoxes(deps.store.get()), boxKey, from, step);
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
    scroll === null
      ? 'no round to scroll'
      : scrollText('the form', step, direction, scroll),
  );
}

// From inside a box the user stays typing: the new item's notes box takes
// focus, or on the notices stop the cursor line's comment box, focus leaving
// the box when that line is closed. From the page, focus stays on the page.
function moveItem(
  deps: FormsCommandDeps,
  context: EditorContext,
  action: FormsAction,
) {
  const box = boxIn(deps, context);
  focusBoxItem(deps.store, box);
  const before = activeForm(deps.store.get())?.focus;
  deps.store.dispatch(action);
  const after = activeForm(deps.store.get())?.focus;
  if (box === undefined || after === before) {
    return;
  }
  if (noticesStop(deps.store.get()) === null) {
    focusShownBox(deps, ANSWER_FIELDS);
  } else if (!focusCursorLineBox(deps)) {
    deps.boxes.leave();
  }
}

// On the notices stop, moves the line cursor and logs it; past either end of
// the lines, and on any other stop, moves by item as nextItem and prevItem do.
function moveLine(
  deps: FormsCommandDeps,
  context: EditorContext,
  delta: 1 | -1,
) {
  focusBoxItem(deps.store, boxIn(deps, context));
  const stop = noticesStop(deps.store.get());
  if (stop !== null) {
    deps.store.dispatch({ type: 'moveNoticeLine', delta });
    const line = activeForm(deps.store.get())?.noticeLine;
    if (line !== undefined && line !== stop.noticeLine) {
      deps.log(lineCursorLine(line));
      return;
    }
  }
  moveItem(deps, context, { type: delta === 1 ? 'nextItem' : 'prevItem' });
}

// The active round while the forms view shows its notices stop, else null.
function noticesStop(state: FormsState): RoundState | null {
  const round = activeForm(state);
  const isOnNoticesStop =
    state.view === 'forms' &&
    round !== null &&
    focusedItem(round)?.kind === 'notices';
  return isOnNoticesStop ? round : null;
}

// Opens or closes the notices stop's cursor line, and logs it.
function toggleCursorLine(deps: FormsCommandDeps, stop: RoundState) {
  toggleNoticeLine(
    {
      dispatch: deps.store.dispatch,
      getState: deps.store.get,
      log: deps.log,
    },
    stop.formId,
    stop.noticeLine,
  );
}

// Focuses the comment box of the notices stop's cursor line while that line is
// open; false when it is closed or the notices stop is not shown.
function focusCursorLineBox(
  deps: FormsCommandDeps,
  options?: FocusOptions,
): boolean {
  const stop = noticesStop(deps.store.get());
  if (stop === null || !stop.openNotices[stop.noticeLine - 1]) {
    return false;
  }
  deps.boxes.focus(
    {
      roundId: stop.formId,
      target: { field: 'comment', notice: stop.noticeLine },
    },
    options,
  );
  return true;
}

function jumpToUnanswered(
  deps: FormsCommandDeps,
  context: EditorContext,
  step: 1 | -1,
) {
  focusBoxItem(deps.store, boxIn(deps, context));
  const state = deps.store.get();
  const round = activeForm(state);
  if (state.view !== 'forms' || round === null) {
    return;
  }
  const item = unansweredItem(round, step);
  if (item === null) {
    deps.log('no unanswered item');
    return;
  }
  const isFocusedItem = railPosition(round.round, item) === round.focus;
  if (isFocusedItem) {
    deps.log('no other unanswered item');
    return;
  }
  moveItem(deps, context, {
    type: 'focusItem',
    item: railPosition(round.round, item),
  });
  if (jumpMoved(state, deps.store.get())) {
    deps.log(jumpedToLine(item));
  }
}

// `showForm` opens the session's form popup; `activate` selects the session;
// `closeAnswers` holds the cancel prompt's answer to the close.
export interface GuardCloseDeps extends Pick<
  FormsCommandDeps,
  'store' | 'toast' | 'log'
> {
  showForm(sessionId: string): void;
  activate(sessionId: string): void;
  closeAnswers: Pick<SessionCloseAnswers, 'wait'>;
}

// A session closes only once its round is gone, as guardSessionClose keeps
// it.
export function guardClose(
  deps: GuardCloseDeps,
  sessionId: string,
): boolean | Promise<boolean> {
  return guardSessionClose({ ...deps, words: ROUND_WORDS }, sessionId);
}

// Hands main the active round's finish, as finishActiveForm sends it.
function finishActiveRound(
  deps: FormsCommandDeps,
  from: FormsView,
  kind: AgentFormEndKind,
) {
  finishActiveForm(
    { ...deps, bodyOf: buildBody, words: ROUND_WORDS },
    from,
    kind,
  );
}

export interface CloseRoundFromMainDeps extends Pick<
  FormsCommandDeps,
  'store' | 'toast' | 'log'
> {
  closeAnswers: Pick<SessionCloseAnswers, 'closing'>;
}

// Closes a round main closed, as closeFormFromMain closes it.
export function closeRoundFromMain(
  deps: CloseRoundFromMainDeps,
  closed: AgentFormClosed,
): void {
  closeFormFromMain({ ...deps, words: ROUND_WORDS }, closed);
}
