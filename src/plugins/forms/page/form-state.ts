import type {
  AnswerEntry,
  AnswerStatus,
  FormBody,
  PresentedRound,
  Round,
} from '../contract';

export type FormsView = 'forms' | 'review' | 'confirm' | 'help' | 'idle';

export type SaveState = 'saved' | 'saving' | 'unsaved';

// `index` is 1-based within its kind, as the forms contract numbers items.
export type RailItem =
  | { kind: 'notice'; index: number }
  | { kind: 'question'; index: number };

export interface QuestionAnswer {
  // 1-based, 0 for none; kept while not applicable.
  choice: number;
  notApplicable: boolean;
  what: string;
  why: string;
  dontAsk: boolean;
  dontAskReason: string;
}

export interface RoundState {
  roundId: string;
  // The session whose view the round fills.
  sessionId: string;
  label: string;
  round: Round;
  // One per question, in order.
  answers: QuestionAnswer[];
  // One per notice, in order.
  noticeComments: string[];
  note: string;
  // A position in railItems(round).
  focus: number;
  // A question position, 0-based.
  reviewRow: number;
  // One per rail item; true hides that item's context.
  folded: boolean[];
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

// `question` and `notice` are 1-based.
export type TextTarget =
  | { field: 'what' | 'why' | 'dontAskReason'; question: number }
  | { field: 'comment'; notice: number }
  | { field: 'note' };

// Acts on the active round's focused item.
export type ItemAction =
  | { type: 'nextItem' }
  | { type: 'prevItem' }
  // `item` is a rail position.
  | { type: 'focusItem'; item: number }
  | { type: 'choose'; choice: number }
  | { type: 'clearChoice' }
  | { type: 'toggleNotApplicable' }
  | { type: 'toggleDontAsk' }
  | { type: 'toggleFold' }
  | { type: 'unfoldAll' }
  | { type: 'foldAll' };

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

const UNTOUCHED: QuestionAnswer = {
  choice: 0,
  notApplicable: false,
  what: '',
  why: '',
  dontAsk: false,
  dontAskReason: '',
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
  const notices = round.notices.map((_, i): RailItem => ({
    kind: 'notice',
    index: i + 1,
  }));
  const questions = round.questions.map((_, i): RailItem => ({
    kind: 'question',
    index: i + 1,
  }));
  return [...notices, ...questions];
}

export function focusedItem(round: RoundState): RailItem | null {
  return railItems(round.round)[round.focus] ?? null;
}

// A choice, or written what or why text, answers a question.
export function questionStatus(answer: QuestionAnswer): AnswerStatus {
  if (answer.notApplicable) {
    return 'not_applicable';
  }
  const hasChoice = answer.choice >= 1;
  const hasText = answer.what.trim() !== '' || answer.why.trim() !== '';
  return hasChoice || hasText ? 'answered' : 'untouched';
}

export function progress(round: RoundState): Progress {
  const statuses = round.answers.map(questionStatus);
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
    answers: round.answers.map((answer, i): AnswerEntry => ({
      index: i + 1,
      choice: answer.choice,
      not_applicable: answer.notApplicable,
      what: answer.what,
      why: answer.why,
      dont_ask: answer.dontAsk,
      dont_ask_reason: answer.dontAskReason,
    })),
    notice_comments: round.noticeComments.map((comment, i) => ({
      index: i + 1,
      comment,
    })),
  };
}

function restoreRound(presented: PresentedRound): RoundState {
  const { roundId, sessionId, label, round, draft } = presented;
  return {
    roundId,
    sessionId,
    label,
    round,
    answers: round.questions.map((question, i) =>
      restoreAnswer(
        draft?.answers.find((entry) => entry.index === i + 1),
        question.choices.length,
      ),
    ),
    noticeComments: round.notices.map(
      (_, i) =>
        draft?.notice_comments.find((comment) => comment.index === i + 1)
          ?.comment ?? '',
    ),
    note: draft?.note ?? '',
    focus: 0,
    reviewRow: 0,
    folded: railItems(round).map(() => false),
    revision: 0,
    savingRevision: null,
    savedRevision: 0,
    saveError: null,
  };
}

function restoreAnswer(
  entry: AnswerEntry | undefined,
  choiceCount: number,
): QuestionAnswer {
  if (entry === undefined) {
    return UNTOUCHED;
  }
  const isChoiceInRange = entry.choice >= 1 && entry.choice <= choiceCount;
  return {
    choice: isChoiceInRange ? entry.choice : 0,
    notApplicable: entry.not_applicable,
    what: entry.what,
    why: entry.why,
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
    const lastRow = Math.max(round.answers.length - 1, 0);
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
  const isQuestionRow = target >= 0 && target < round.answers.length;
  if (!isQuestionRow) {
    return state;
  }
  const jumped = updateRound(state, round.roundId, (current) => ({
    ...current,
    reviewRow: target,
    focus: current.round.notices.length + target,
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
    case 'toggleFold':
      return {
        ...round,
        folded: round.folded.map((folded, i) =>
          i === round.focus ? !folded : folded,
        ),
      };
    case 'unfoldAll':
      return setAllFolded(round, false);
    case 'foldAll':
      return setAllFolded(round, true);
  }
}

function setAllFolded(round: RoundState, folded: boolean): RoundState {
  return round.folded.every((current) => current === folded)
    ? round
    : { ...round, folded: round.folded.map(() => folded) };
}

function moveFocus(round: RoundState, step: number): RoundState {
  const lastItem = Math.max(round.folded.length - 1, 0);
  const focus = Math.min(Math.max(round.focus + step, 0), lastItem);
  return focus === round.focus ? round : { ...round, focus };
}

function focusAt(round: RoundState, item: number): RoundState {
  const isRailPosition = item >= 0 && item < round.folded.length;
  return isRailPosition && item !== round.focus
    ? { ...round, focus: item }
    : round;
}

// Same number again clears; locked while not applicable.
function choose(
  answer: QuestionAnswer,
  choiceCount: number,
  choice: number,
): QuestionAnswer {
  const isChoiceInRange = choice >= 1 && choice <= choiceCount;
  if (answer.notApplicable || !isChoiceInRange) {
    return answer;
  }
  return { ...answer, choice: answer.choice === choice ? 0 : choice };
}

// A no-op when a notice is focused or `change` returns the answer it was given.
function updateFocusedAnswer(
  round: RoundState,
  change: (answer: QuestionAnswer, choiceCount: number) => QuestionAnswer,
): RoundState {
  const position = round.focus - round.round.notices.length;
  const isQuestion = position >= 0 && position < round.answers.length;
  if (!isQuestion) {
    return round;
  }
  const answer = round.answers[position];
  const next = change(answer, round.round.questions[position].choices.length);
  return next === answer ? round : withAnswer(round, position, next);
}

function withAnswer(
  round: RoundState,
  position: number,
  answer: QuestionAnswer,
): RoundState {
  return {
    ...round,
    answers: round.answers.map((current, i) =>
      i === position ? answer : current,
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
      const position = target.question - 1;
      const isQuestion = position >= 0 && position < round.answers.length;
      if (!isQuestion || round.answers[position][target.field] === value) {
        return round;
      }
      return withAnswer(round, position, {
        ...round.answers[position],
        [target.field]: value,
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
