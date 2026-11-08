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
  answerableItems,
  pickNumber,
  type RailItem,
  railItems,
  railPosition,
  type RoundState,
  unansweredItem,
} from './form-state';
import {
  itemName,
  jumpedToLine,
  jumpMoved,
  pickRailItem,
  reviewRowsByRailPosition,
} from './view-model';

export interface FormsCommandDeps {
  store: FormsStore;
  boxes: Pick<EditorBoxes<BoxRef>, 'focus' | 'leave' | 'active' | 'boxOf'>;
  // Hands the finished round to main; rejects with the reason when main keeps
  // the round open.
  finish(roundId: string, end: RoundEnd): Promise<void>;
  closeSession(sessionId: string): void;
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

const DESCRIBE_CLEAR: DescribeChange = (_answer, item) =>
  `cleared the choice on ${itemName(item)}`;

const DESCRIBE_ACCEPT: DescribeChange = (_answer, item) =>
  `accepted the recommendation on ${itemName(item)}`;

const DESCRIBE_NOT_APPLICABLE: DescribeChange = (answer, item) =>
  answer.notApplicable
    ? `not applicable on ${itemName(item)}`
    : `applicable again on ${itemName(item)}`;

const DESCRIBE_DONT_ASK: DescribeChange = (answer, item) =>
  answer.dontAsk
    ? `don't ask on ${itemName(item)}`
    : `ask again on ${itemName(item)}`;

// Every forms command's handler, by short id. A command fired in a box first
// focuses that box's item, so it acts where the user is typing; an `At`
// command acts on the item its arg names instead, as a card's click does.
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
      changeAnswer(
        deps,
        context,
        { type: 'choose', number },
        describeChoice(store, number),
      );
    },
    clearChoice: (context) => {
      changeAnswer(deps, context, { type: 'clearChoice' }, DESCRIBE_CLEAR);
    },
    acceptRecommendation: (context) => {
      changeAnswer(
        deps,
        context,
        { type: 'acceptRecommendation' },
        DESCRIBE_ACCEPT,
      );
    },
    toggleNotApplicable: (context) => {
      changeAnswer(
        deps,
        context,
        { type: 'toggleNotApplicable' },
        DESCRIBE_NOT_APPLICABLE,
      );
    },
    toggleDontAsk: (context) => {
      focusReasonBoxWhenOn(
        deps,
        changeAnswer(
          deps,
          context,
          { type: 'toggleDontAsk' },
          DESCRIBE_DONT_ASK,
        ),
      );
    },
    chooseAt: ({ arg }) => {
      if (focusNamedItem(deps, arg.item)) {
        applyAnswer(
          deps,
          { type: 'choose', number: arg.number },
          describeChoice(store, arg.number),
        );
      }
    },
    clearChoiceAt: ({ arg }) => {
      if (focusNamedItem(deps, arg)) {
        applyAnswer(deps, { type: 'clearChoice' }, DESCRIBE_CLEAR);
      }
    },
    acceptRecommendationAt: ({ arg }) => {
      if (focusNamedItem(deps, arg)) {
        applyAnswer(deps, { type: 'acceptRecommendation' }, DESCRIBE_ACCEPT);
      }
    },
    toggleNotApplicableAt: ({ arg }) => {
      if (focusNamedItem(deps, arg)) {
        applyAnswer(
          deps,
          { type: 'toggleNotApplicable' },
          DESCRIBE_NOT_APPLICABLE,
        );
      }
    },
    toggleDontAskAt: ({ arg }) => {
      if (focusNamedItem(deps, arg)) {
        focusReasonBoxWhenOn(
          deps,
          applyAnswer(deps, { type: 'toggleDontAsk' }, DESCRIBE_DONT_ASK),
        );
      }
    },
    focusItem: ({ arg }) => {
      focusNamedItem(deps, arg);
    },
    pickRailItem: ({ arg }) => pickNamedRailItem(deps, arg),
    reviewJumpAt: ({ arg }) => jumpToReviewRow(deps, arg),
    // As vim's `A`: `a` and `o` start typing after the box's text.
    editNotes: () => focusShownBox(deps, ANSWER_FIELDS, APPEND),
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
  if (round === null || focused === null || focused.kind === 'notice') {
    return null;
  }
  const item = { kind: focused.kind, index: focused.index };
  return { item, answer: itemAnswer(round, item) };
}

// The log line of a pick of `number`: the number the item now holds, or the
// clear when the same number was held.
function describeChoice(store: FormsStore, number: number): DescribeChange {
  return (_answer, item) =>
    activePickNumber(store.get(), item) === number
      ? `chose ${number} on ${itemName(item)}`
      : `cleared the choice on ${itemName(item)}`;
}

// Focuses the item of the command's box, then applies the answer action as
// applyAnswer does.
function changeAnswer(
  deps: FormsCommandDeps,
  context: EditorContext,
  action: FormsAction,
  describe: DescribeChange,
): ItemAnswer | null {
  focusBoxItem(deps.store, boxIn(deps, context));
  return applyAnswer(deps, action, describe);
}

// Applies an answer action to the focused question or finding and logs the
// change; returns the changed answer, or null when nothing changed.
function applyAnswer(
  deps: FormsCommandDeps,
  action: FormsAction,
  describe: DescribeChange,
): ItemAnswer | null {
  const before = focusedAnswer(deps.store.get());
  deps.store.dispatch(action);
  const after = focusedAnswer(deps.store.get());
  if (before === null || after === null || after.answer === before.answer) {
    return null;
  }
  deps.log(describe(after.answer, after.item));
  return after.answer;
}

// Focuses Don't ask's reason box when `answer`, the toggled one, turned it on.
function focusReasonBoxWhenOn(
  deps: FormsCommandDeps,
  answer: ItemAnswer | null,
) {
  if (answer?.dontAsk) {
    focusShownBox(deps, ['dontAskReason']);
  }
}

// The active round and its rail item at `position`; null with no round, and
// null with the miss logged for a position the rail lacks, as a click drawn
// before the round changed sends.
function railItemAt(
  deps: FormsCommandDeps,
  position: number,
): { round: RoundState; item: RailItem } | null {
  const round = activeForm(deps.store.get());
  if (round === null) {
    return null;
  }
  const item = railItems(round.round)[position];
  if (item === undefined) {
    deps.log(`no rail item at ${position}`);
    return null;
  }
  return { round, item };
}

// Focuses the item at rail `position` whatever box holds focus, so a click's
// answer lands on its own card; false when railItemAt found none.
function focusNamedItem(deps: FormsCommandDeps, position: number): boolean {
  if (railItemAt(deps, position) === null) {
    return false;
  }
  deps.store.dispatch({ type: 'focusItem', item: position });
  return true;
}

// The rail entry at `position` picked in the view the store shows now, with
// the review row the item has there.
function pickNamedRailItem(deps: FormsCommandDeps, position: number) {
  const found = railItemAt(deps, position);
  if (found === null) {
    return;
  }
  const { store, log } = deps;
  pickRailItem(
    {
      dispatch: (action) => store.dispatch(action),
      getState: () => store.get(),
      log,
    },
    store.get().view,
    found.item,
    position,
    reviewRowsByRailPosition(found.round)[position],
  );
}

// Moves the review cursor to `row` and shows its item, as Enter on the row
// does; a row the review lacks is logged.
function jumpToReviewRow(deps: FormsCommandDeps, row: number) {
  const round = activeForm(deps.store.get());
  if (round === null) {
    return;
  }
  if (answerableItems(round.round)[row] === undefined) {
    deps.log(`no review row ${row}`);
    return;
  }
  deps.store.dispatch({ type: 'reviewJump', row });
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

// From inside a box the user stays typing: the new item's notes or comment
// box takes focus. From the page, focus stays on the page.
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
  if (box !== undefined && after !== before) {
    focusShownBox(deps, ANSWER_FIELDS);
  }
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
  const focused = focusedItem(round);
  const isFocusedItem =
    focused?.kind === item.kind && focused.index === item.index;
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

// `showForm` selects the session's Form tab; `activate` selects the session.
export interface GuardCloseDeps extends Pick<
  FormsCommandDeps,
  'store' | 'toast' | 'log'
> {
  showForm(sessionId: string): void;
  activate(sessionId: string): void;
}

// A session closes only once its round is gone, as guardSessionClose keeps
// it.
export function guardClose(deps: GuardCloseDeps, sessionId: string): boolean {
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

export type CloseRoundFromMainDeps = Pick<
  FormsCommandDeps,
  'store' | 'closeSession' | 'toast' | 'log'
>;

// Closes a round main closed, as closeFormFromMain closes it.
export function closeRoundFromMain(
  deps: CloseRoundFromMainDeps,
  closed: AgentFormClosed,
): void {
  closeFormFromMain({ ...deps, words: ROUND_WORDS }, closed);
}
