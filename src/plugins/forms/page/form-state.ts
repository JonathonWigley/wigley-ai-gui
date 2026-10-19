import type {
  AnswerableKind,
  AnswerEntry,
  AnswerStatus,
  FindingAction,
  FindingAnswerEntry,
  FormBody,
  ItemKind,
  PresentedRound,
  Round,
} from '../contract';
import { findingPickIsComplete, isFindingAction } from '../finding-pick';

export type FormsView = 'forms' | 'review' | 'confirm' | 'help' | 'idle';

export type SaveState = 'saved' | 'saving' | 'unsaved';

// `index` is 1-based within its kind, as the forms contract numbers items.
export type RailItem = { kind: ItemKind; index: number };

export type AnswerableItem = { kind: AnswerableKind; index: number };

// A question's or a finding's answer.
export interface ItemAnswer {
  // 1-based, 0 for none; kept while not applicable.
  choice: number;
  notApplicable: boolean;
  notes: string;
  dontAsk: boolean;
  dontAskReason: string;
}

// `choice` is the solution, kept while the action is 'leave_it'; '' is no
// action.
export interface FindingAnswer extends ItemAnswer {
  action: FindingAction | '';
}

export interface RoundState {
  roundId: string;
  // The session whose view the round fills.
  sessionId: string;
  label: string;
  round: Round;
  // One per question, in order.
  answers: ItemAnswer[];
  // One per finding, in order.
  findingAnswers: FindingAnswer[];
  // One per notice, in order.
  noticeComments: string[];
  note: string;
  // A position in railItems(round).
  focus: number;
  // A position in answerableItems(round).
  reviewRow: number;
  // Counts answer edits; a save carries the revision it sent.
  revision: number;
  savingRevision: number | null;
  savedRevision: number;
  // The last failed save's message; cleared when a save starts or succeeds.
  saveError: string | null;
}

// The active round is the round of the session the sessions plugin shows,
// or null when that session has none.
export interface FormsState {
  // In the order they were shown.
  rounds: RoundState[];
  activeRoundId: string | null;
  view: FormsView;
  // Where closing help returns.
  helpReturnView: FormsView;
  activeSessionId: string | null;
  // Where keeping the round from the cancel prompt returns.
  confirmReturnView: FormsView;
  // Whether confirming the cancel prompt also closes the round's tab.
  confirmClosesTab: boolean;
}

export interface Progress {
  answered: number;
  notApplicable: number;
  untouched: number;
  total: number;
}

// `item.index` and `notice` are 1-based.
export type TextTarget =
  | { field: 'notes' | 'dontAskReason'; item: AnswerableItem }
  | { field: 'comment'; notice: number }
  | { field: 'note' };

// Acts on the active round's focused item.
export type ItemAction =
  | { type: 'nextItem' }
  | { type: 'prevItem' }
  // `item` is a rail position.
  | { type: 'focusItem'; item: number }
  | { type: 'choose'; choice: number }
  // Clears only the solution on a finding; its action stays.
  | { type: 'clearChoice' }
  // On a finding: picking the action it holds clears it.
  | { type: 'chooseAction'; action: FindingAction }
  | { type: 'toggleNotApplicable' }
  | { type: 'toggleDontAsk' };

export type FormsAction =
  | ItemAction
  | { type: 'roundShown'; round: PresentedRound }
  | { type: 'roundClosed'; roundId: string }
  | { type: 'sessionActivated'; sessionId: string | null }
  // Asks to cancel the active round before its session's tab closes.
  | { type: 'askClose'; sessionId: string }
  | { type: 'openReview' }
  | { type: 'closeReview' }
  | { type: 'reviewNext' }
  | { type: 'reviewPrev' }
  // Without `row`, jumps to the review cursor's row.
  | { type: 'reviewJump'; row?: number }
  | { type: 'askCancel' }
  | { type: 'confirmCancel' }
  | { type: 'dismissConfirm' }
  | { type: 'toggleHelp' }
  | { type: 'closeHelp' }
  | { type: 'setText'; roundId: string; target: TextTarget; value: string }
  | { type: 'saveStarted'; roundId: string; revision: number }
  | { type: 'saveFinished'; roundId: string; revision: number; ok: true }
  | {
      type: 'saveFinished';
      roundId: string;
      revision: number;
      ok: false;
      error: string;
    };

const EMPTY_STATE: FormsState = {
  rounds: [],
  activeRoundId: null,
  view: 'idle',
  helpReturnView: 'idle',
  activeSessionId: null,
  confirmReturnView: 'review',
  confirmClosesTab: false,
};

const UNTOUCHED: ItemAnswer = {
  choice: 0,
  notApplicable: false,
  notes: '',
  dontAsk: false,
  dontAskReason: '',
};

const UNTOUCHED_FINDING: FindingAnswer = { ...UNTOUCHED, action: '' };

const RAIL_ORDER: ItemKind[] = ['notice', 'finding', 'question'];

const ROUND_ITEMS = {
  notice: (round) => round.notices,
  finding: (round) => round.findings,
  question: (round) => round.questions,
} satisfies Record<ItemKind, (round: Round) => unknown[]>;

const ANSWER_ARRAYS: Record<AnswerableKind, 'answers' | 'findingAnswers'> = {
  question: 'answers',
  finding: 'findingAnswers',
};

export function initialState(
  rounds: PresentedRound[],
  activeSessionId: string | null,
): FormsState {
  return rounds.reduce(
    (state, round) => apply(state, { type: 'roundShown', round }),
    { ...EMPTY_STATE, activeSessionId },
  );
}

// Returns `state` itself when the action changes nothing. Item actions apply
// only in the forms view.
export function apply(state: FormsState, action: FormsAction): FormsState {
  switch (action.type) {
    case 'roundShown':
      return showRound(state, action.round);
    case 'roundClosed':
      return closeRound(state, action.roundId);
    case 'sessionActivated':
      return activateSession(state, action.sessionId);
    case 'askClose':
      return askClose(state, action.sessionId);
    case 'openReview':
      return openReview(state);
    case 'closeReview':
      return state.view === 'review' ? { ...state, view: 'forms' } : state;
    case 'reviewNext':
      return moveReviewRow(state, 1);
    case 'reviewPrev':
      return moveReviewRow(state, -1);
    case 'reviewJump':
      return jumpToReviewRow(state, action.row);
    case 'askCancel':
      return state.view === 'review'
        ? {
            ...state,
            view: 'confirm',
            confirmReturnView: 'review',
            confirmClosesTab: false,
          }
        : state;
    case 'confirmCancel':
      return state.view === 'confirm'
        ? closeRound(state, state.activeRoundId)
        : state;
    case 'dismissConfirm':
      return state.view === 'confirm'
        ? { ...state, view: state.confirmReturnView, confirmClosesTab: false }
        : state;
    case 'toggleHelp':
      return state.view === 'help'
        ? { ...state, view: state.helpReturnView }
        : { ...state, view: 'help', helpReturnView: state.view };
    case 'closeHelp':
      return state.view === 'help'
        ? { ...state, view: state.helpReturnView }
        : state;
    case 'setText':
      return updateRound(state, action.roundId, (round) =>
        setText(round, action.target, action.value),
      );
    case 'saveStarted':
      return updateRound(state, action.roundId, (round) =>
        startSave(round, action.revision),
      );
    case 'saveFinished':
      return updateRound(state, action.roundId, (round) =>
        finishSave(round, action.revision, action.ok ? null : action.error),
      );
    default:
      return state.view === 'forms'
        ? updateRound(state, state.activeRoundId, (round) =>
            applyItemAction(round, action),
          )
        : state;
  }
}

export function activeRound(state: FormsState): RoundState | null {
  return (
    state.rounds.find((round) => round.roundId === state.activeRoundId) ?? null
  );
}

// The view the page shows under the help overlay: the one help returns to.
export function baseView(state: FormsState): FormsView {
  return state.view === 'help' ? state.helpReturnView : state.view;
}

export function railItems(round: Round): RailItem[] {
  return RAIL_ORDER.flatMap((kind) =>
    ROUND_ITEMS[kind](round).map((_, i): RailItem => ({ kind, index: i + 1 })),
  );
}

// The findings, then the questions, in rail order.
export function answerableItems(round: Round): AnswerableItem[] {
  return railItems(round).filter(
    (item): item is AnswerableItem => item.kind !== 'notice',
  );
}

// The item's position in railItems(round), or -1 when the round lacks it.
export function railPosition(round: Round, item: RailItem): number {
  return railItems(round).findIndex(
    (candidate) =>
      candidate.kind === item.kind && candidate.index === item.index,
  );
}

export function focusedItem(round: RoundState): RailItem | null {
  return railItems(round.round)[round.focus] ?? null;
}

// Throws when the round has no such item.
export function itemAnswer(
  round: RoundState,
  item: AnswerableItem,
): ItemAnswer {
  if (!hasItem(round, item)) {
    throw new Error(`round ${round.roundId} has no ${item.kind} ${item.index}`);
  }
  return round[ANSWER_ARRAYS[item.kind]][item.index - 1];
}

// The action picked on a finding; '' on a question.
export function findingActionOf(
  round: RoundState,
  item: AnswerableItem,
): FindingAction | '' {
  return item.kind === 'finding'
    ? round.findingAnswers[item.index - 1].action
    : '';
}

// Whether the item's picks answer it: a choice on a question, a complete
// pick of action and solution on a finding.
const PICK_ANSWERS = {
  question: (round, index) => round.answers[index - 1].choice >= 1,
  finding: (round, index) => {
    const answer = round.findingAnswers[index - 1];
    const solutionCount = round.round.findings[index - 1].choices.length;
    return findingPickIsComplete(solutionCount, answer.choice, answer.action);
  },
} satisfies Record<
  AnswerableKind,
  (round: RoundState, index: number) => boolean
>;

// The item's picks, or written notes, answer it. Throws when the round has no
// such item.
export function answerStatus(
  round: RoundState,
  item: AnswerableItem,
): AnswerStatus {
  const answer = itemAnswer(round, item);
  if (answer.notApplicable) {
    return 'not_applicable';
  }
  const hasText = answer.notes.trim() !== '';
  const picksAnswer = PICK_ANSWERS[item.kind](round, item.index);
  return picksAnswer || hasText ? 'answered' : 'untouched';
}

// The next answerable item after the focused one, by `step` and wrapping,
// whose status is untouched; the focused item is checked last. Null when
// every item is answered or not applicable.
export function unansweredItem(
  round: RoundState,
  step: 1 | -1,
): AnswerableItem | null {
  const items = answerableItems(round.round);
  const count = items.length;
  const focused = focusedItem(round);
  const position = items.findIndex(
    (item) => item.kind === focused?.kind && item.index === focused.index,
  );
  // With a notice focused the search starts just outside the items, so
  // forward runs from the first and backward from the last.
  const outside = step === 1 ? -1 : count;
  const start = position < 0 ? outside : position;
  for (let offset = 1; offset <= count; offset++) {
    const item = items[(((start + step * offset) % count) + count) % count];
    if (answerStatus(round, item) === 'untouched') {
      return item;
    }
  }
  return null;
}

export function progress(round: RoundState): Progress {
  const statuses = answerableItems(round.round).map((item) =>
    answerStatus(round, item),
  );
  const count = (status: AnswerStatus) =>
    statuses.filter((candidate) => candidate === status).length;
  return {
    answered: count('answered'),
    notApplicable: count('not_applicable'),
    untouched: count('untouched'),
    total: statuses.length,
  };
}

export function saveState(round: RoundState): SaveState {
  if (round.savedRevision === round.revision) {
    return 'saved';
  }
  return round.savingRevision === round.revision ? 'saving' : 'unsaved';
}

// The saved-round body; a not-applicable answer keeps its choice.
export function buildBody(round: RoundState): FormBody {
  return {
    note: round.note,
    answers: round.answers.map(answerEntry),
    finding_answers: round.findingAnswers.map(findingAnswerEntry),
    notice_comments: round.noticeComments.map((comment, i) => ({
      index: i + 1,
      comment,
    })),
  };
}

// `i` is the answer's 0-based position.
function answerEntry(answer: ItemAnswer, i: number): AnswerEntry {
  return {
    index: i + 1,
    choice: answer.choice,
    not_applicable: answer.notApplicable,
    notes: answer.notes,
    dont_ask: answer.dontAsk,
    dont_ask_reason: answer.dontAskReason,
  };
}

// `i` is the answer's 0-based position.
function findingAnswerEntry(
  answer: FindingAnswer,
  i: number,
): FindingAnswerEntry {
  return { ...answerEntry(answer, i), action: answer.action };
}

// Where a round opens: its first finding or question, past the notices; the
// first notice when it has nothing to answer.
function firstAnswerablePosition(round: Round): number {
  const first = answerableItems(round)[0];
  return first === undefined ? 0 : railPosition(round, first);
}

function restoreRound(presented: PresentedRound): RoundState {
  const { roundId, sessionId, label, round, draft } = presented;
  return {
    roundId,
    sessionId,
    label,
    round,
    answers: restoreAnswers(
      round.questions,
      draft?.answers ?? [],
      restoreAnswer,
    ),
    findingAnswers: restoreAnswers(
      round.findings,
      draft?.finding_answers ?? [],
      restoreFindingAnswer,
    ),
    noticeComments: round.notices.map(
      (_, i) =>
        draft?.notice_comments.find((comment) => comment.index === i + 1)
          ?.comment ?? '',
    ),
    note: draft?.note ?? '',
    focus: firstAnswerablePosition(round),
    reviewRow: 0,
    revision: 0,
    savingRevision: null,
    savedRevision: 0,
    saveError: null,
  };
}

// One answer per item, from the entry carrying its 1-based index.
function restoreAnswers<Entry extends AnswerEntry, Answer>(
  items: { choices: unknown[] }[],
  entries: Entry[],
  restore: (entry: Entry | undefined, choiceCount: number) => Answer,
): Answer[] {
  return items.map((item, i) =>
    restore(
      entries.find((entry) => entry.index === i + 1),
      item.choices.length,
    ),
  );
}

// A missing or unknown action restores as none.
function restoreFindingAnswer(
  entry: FindingAnswerEntry | undefined,
  choiceCount: number,
): FindingAnswer {
  if (entry === undefined) {
    return UNTOUCHED_FINDING;
  }
  const action = isFindingAction(entry.action) ? entry.action : '';
  return { ...restoreAnswer(entry, choiceCount), action };
}

function restoreAnswer(
  entry: AnswerEntry | undefined,
  choiceCount: number,
): ItemAnswer {
  if (entry === undefined) {
    return UNTOUCHED;
  }
  const isChoiceInRange = entry.choice >= 1 && entry.choice <= choiceCount;
  return {
    choice: isChoiceInRange ? entry.choice : 0,
    notApplicable: entry.not_applicable,
    notes: entry.notes,
    dontAsk: entry.dont_ask,
    dontAskReason: entry.dont_ask_reason,
  };
}

// A round for the session shown becomes active; any other waits in the
// background.
function showRound(state: FormsState, presented: PresentedRound): FormsState {
  const isOpen = state.rounds.some(
    (round) => round.roundId === presented.roundId,
  );
  if (isOpen) {
    return state;
  }
  const rounds = [...state.rounds, restoreRound(presented)];
  if (presented.sessionId !== state.activeSessionId) {
    return { ...state, rounds };
  }
  const shown = { ...state, rounds, activeRoundId: presented.roundId };
  return state.view === 'help'
    ? { ...shown, helpReturnView: 'forms' }
    : { ...shown, view: 'forms' };
}

// The active round closing leaves its session shown with no round.
function closeRound(state: FormsState, roundId: string | null): FormsState {
  const rounds = state.rounds.filter((round) => round.roundId !== roundId);
  if (rounds.length === state.rounds.length) {
    return state;
  }
  if (roundId !== state.activeRoundId) {
    return { ...state, rounds };
  }
  return showView(
    { ...state, rounds, activeRoundId: null, confirmClosesTab: false },
    'idle',
  );
}

// Shows the newly active session's round, or the idle view; a pending
// prompt is dismissed, and help stays open over the new view.
function activateSession(
  state: FormsState,
  sessionId: string | null,
): FormsState {
  if (sessionId === state.activeSessionId) {
    return state;
  }
  const round = state.rounds.find(
    (candidate) => candidate.sessionId === sessionId,
  );
  const activated: FormsState = {
    ...state,
    activeSessionId: sessionId,
    activeRoundId: round?.roundId ?? null,
    confirmClosesTab: false,
  };
  return showView(activated, round === undefined ? 'idle' : 'forms');
}

// Opens the cancel prompt for the active round of the closing tab's session,
// from its form or review; keeping the round returns there.
function askClose(state: FormsState, sessionId: string): FormsState {
  const view = baseView(state);
  const isRoundOfSession = activeRound(state)?.sessionId === sessionId;
  const isAskable = view === 'forms' || view === 'review';
  if (!isRoundOfSession || !isAskable) {
    return state;
  }
  return {
    ...state,
    view: 'confirm',
    confirmReturnView: view,
    confirmClosesTab: true,
  };
}

// Under help, `view` becomes where help returns; otherwise it shows.
function showView(state: FormsState, view: FormsView): FormsState {
  return state.view === 'help'
    ? { ...state, helpReturnView: view }
    : { ...state, view, helpReturnView: view };
}

function openReview(state: FormsState): FormsState {
  if (state.view !== 'forms' || state.activeRoundId === null) {
    return state;
  }
  return updateRound(
    { ...state, view: 'review' },
    state.activeRoundId,
    (round) => (round.reviewRow === 0 ? round : { ...round, reviewRow: 0 }),
  );
}

function moveReviewRow(state: FormsState, step: number): FormsState {
  if (state.view !== 'review') {
    return state;
  }
  return updateRound(state, state.activeRoundId, (round) => {
    const lastRow = Math.max(answerableItems(round.round).length - 1, 0);
    const row = Math.min(Math.max(round.reviewRow + step, 0), lastRow);
    return row === round.reviewRow ? round : { ...round, reviewRow: row };
  });
}

function jumpToReviewRow(
  state: FormsState,
  row: number | undefined,
): FormsState {
  const round = activeRound(state);
  if (state.view !== 'review' || round === null) {
    return state;
  }
  const target = row ?? round.reviewRow;
  const item = answerableItems(round.round)[target];
  if (item === undefined) {
    return state;
  }
  const jumped = updateRound(state, round.roundId, (current) => ({
    ...current,
    reviewRow: target,
    focus: railPosition(current.round, item),
  }));
  return { ...jumped, view: 'forms' };
}

// Returns `state` itself when `change` returns the round it was given.
function updateRound(
  state: FormsState,
  roundId: string | null,
  change: (round: RoundState) => RoundState,
): FormsState {
  let changed = false;
  const rounds = state.rounds.map((round) => {
    if (round.roundId !== roundId) {
      return round;
    }
    const next = change(round);
    changed = changed || next !== round;
    return next;
  });
  return changed ? { ...state, rounds } : state;
}

function applyItemAction(round: RoundState, action: ItemAction): RoundState {
  switch (action.type) {
    case 'nextItem':
      return moveFocus(round, 1);
    case 'prevItem':
      return moveFocus(round, -1);
    case 'focusItem':
      return focusAt(round, action.item);
    case 'choose':
      return updateFocusedAnswer(round, (answer, choiceCount) =>
        choose(answer, choiceCount, action.choice),
      );
    case 'clearChoice':
      return updateFocusedAnswer(round, (answer) =>
        answer.notApplicable || answer.choice === 0
          ? answer
          : { ...answer, choice: 0 },
      );
    case 'chooseAction':
      return updateFocusedFinding(round, (answer, solutionCount) =>
        chooseAction(answer, solutionCount, action.action),
      );
    case 'toggleNotApplicable':
      return updateFocusedAnswer(round, (answer) => ({
        ...answer,
        notApplicable: !answer.notApplicable,
      }));
    case 'toggleDontAsk':
      return updateFocusedAnswer(round, (answer) => ({
        ...answer,
        dontAsk: !answer.dontAsk,
      }));
  }
}

function moveFocus(round: RoundState, step: number): RoundState {
  const lastItem = Math.max(railItems(round.round).length - 1, 0);
  const focus = Math.min(Math.max(round.focus + step, 0), lastItem);
  return focus === round.focus ? round : { ...round, focus };
}

function focusAt(round: RoundState, item: number): RoundState {
  const isRailPosition = item >= 0 && item < railItems(round.round).length;
  return isRailPosition && item !== round.focus
    ? { ...round, focus: item }
    : round;
}

// Same number again clears; locked while not applicable.
function choose(
  answer: ItemAnswer,
  choiceCount: number,
  choice: number,
): ItemAnswer {
  const isChoiceInRange = choice >= 1 && choice <= choiceCount;
  if (answer.notApplicable || !isChoiceInRange) {
    return answer;
  }
  return { ...answer, choice: answer.choice === choice ? 0 : choice };
}

// Same action again clears it, leaving the solution; locked while not
// applicable. Fixing or following up a one-solution finding picks that
// solution.
function chooseAction(
  answer: FindingAnswer,
  solutionCount: number,
  action: FindingAction,
): FindingAnswer {
  if (answer.notApplicable) {
    return answer;
  }
  if (answer.action === action) {
    return { ...answer, action: '' };
  }
  const picksOnlySolution = action !== 'leave_it' && solutionCount === 1;
  return { ...answer, action, choice: picksOnlySolution ? 1 : answer.choice };
}

// A no-op unless a finding is focused, or when `change` returns the answer
// it was given.
function updateFocusedFinding(
  round: RoundState,
  change: (answer: FindingAnswer, solutionCount: number) => FindingAnswer,
): RoundState {
  const focused = focusedItem(round);
  if (focused === null || focused.kind !== 'finding') {
    return round;
  }
  const item: AnswerableItem = { kind: 'finding', index: focused.index };
  const answer = round.findingAnswers[item.index - 1];
  const solutionCount = round.round.findings[item.index - 1].choices.length;
  const next = change(answer, solutionCount);
  return next === answer ? round : withItemAnswer(round, item, next);
}

// A no-op when a notice is focused or `change` returns the answer it was given.
function updateFocusedAnswer(
  round: RoundState,
  change: (answer: ItemAnswer, choiceCount: number) => ItemAnswer,
): RoundState {
  const focused = focusedItem(round);
  if (focused === null || focused.kind === 'notice') {
    return round;
  }
  const item: AnswerableItem = { kind: focused.kind, index: focused.index };
  const choiceCount = ROUND_ITEMS[item.kind](round.round)[item.index - 1]
    .choices.length;
  const answer = itemAnswer(round, item);
  const next = change(answer, choiceCount);
  return next === answer ? round : withItemAnswer(round, item, next);
}

function hasItem(round: RoundState, item: AnswerableItem): boolean {
  const count = round[ANSWER_ARRAYS[item.kind]].length;
  return item.index >= 1 && item.index <= count;
}

function withItemAnswer(
  round: RoundState,
  item: AnswerableItem,
  answer: ItemAnswer,
): RoundState {
  const key = ANSWER_ARRAYS[item.kind];
  return {
    ...round,
    [key]: round[key].map((current, i) =>
      i === item.index - 1 ? answer : current,
    ),
    revision: round.revision + 1,
  };
}

function setText(
  round: RoundState,
  target: TextTarget,
  value: string,
): RoundState {
  switch (target.field) {
    case 'note':
      return value === round.note
        ? round
        : { ...round, note: value, revision: round.revision + 1 };
    case 'comment': {
      const position = target.notice - 1;
      const isNotice = position >= 0 && position < round.noticeComments.length;
      if (!isNotice || round.noticeComments[position] === value) {
        return round;
      }
      return {
        ...round,
        noticeComments: round.noticeComments.map((comment, i) =>
          i === position ? value : comment,
        ),
        revision: round.revision + 1,
      };
    }
    default: {
      const { item, field } = target;
      if (!hasItem(round, item) || itemAnswer(round, item)[field] === value) {
        return round;
      }
      return withItemAnswer(round, item, {
        ...itemAnswer(round, item),
        [field]: value,
      });
    }
  }
}

function startSave(round: RoundState, revision: number): RoundState {
  const isUnchanged =
    round.savingRevision === revision && round.saveError === null;
  return isUnchanged
    ? round
    : { ...round, savingRevision: revision, saveError: null };
}

// `error` is null for a save that succeeded.
function finishSave(
  round: RoundState,
  revision: number,
  error: string | null,
): RoundState {
  const savingRevision =
    round.savingRevision === revision ? null : round.savingRevision;
  const savedRevision =
    error === null
      ? Math.max(round.savedRevision, revision)
      : round.savedRevision;
  const isUnchanged =
    savingRevision === round.savingRevision &&
    savedRevision === round.savedRevision &&
    error === round.saveError;
  return isUnchanged
    ? round
    : { ...round, savingRevision, savedRevision, saveError: error };
}
