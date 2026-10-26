import type {
  AnswerableKind,
  AnswerEntry,
  AnswerStatus,
  FindingAction,
  Finding,
  FindingAnswerEntry,
  FormBody,
  FormsView,
  ItemKind,
  PresentedRound,
  Round,
  RoundEnd,
} from '../contract';
import { finishSave, startSave } from '../../../shared/page/autosave';
import type { ReducerStore } from '../../../shared/page/reducer-store';
import { actionLabel } from '../finding-origins';
import {
  findingEntries,
  findingEntryNumber,
  findingPickIsComplete,
  isFindingAction,
} from '../finding-pick';

// `index` is 1-based within its kind, as the forms contract numbers items.
export type RailItem = { kind: ItemKind; index: number };

export type AnswerableItem = { kind: AnswerableKind; index: number };

// A finish handed to main and not yet answered by it. `closesSession` marks a
// cancel the close prompt asked, which closes the session once the round
// closes.
export interface RoundSend {
  kind: RoundEnd['kind'];
  closesSession: boolean;
}

// A question's or a finding's answer.
export interface ItemAnswer {
  // 1-based, 0 for none; kept while not applicable.
  choice: number;
  notApplicable: boolean;
  notes: string;
  dontAsk: boolean;
  dontAskReason: string;
}

// `choice` and `action` are one pick, one of the finding's numbered entries
// (`findingEntries`): `choice` is 0 for an action's header. No pick is
// `{ choice: 0, action: '' }`.
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
  // Set from the send until the page's finish closes the round or the send
  // fails; a round main closes on its own fails its send first.
  sending: RoundSend | null;
}

// The active round is the round of the session the sessions plugin shows,
// or null when that session has none.
export interface FormsState {
  // In the order they were shown.
  rounds: RoundState[];
  activeRoundId: string | null;
  view: FormsView;
  activeSessionId: string | null;
  // Where keeping the round from the cancel prompt returns.
  confirmReturnView: FormsView;
  // Whether confirming the cancel prompt also closes the round's session.
  confirmClosesSession: boolean;
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
  // `number` is 1-based: a question's choice, or a finding's entry down its
  // card, which sets choice and action together. Picking the held number
  // again clears the pick; a number past the last changes nothing.
  | { type: 'choose'; number: number }
  // Clears a question's choice, or a finding's whole pick.
  | { type: 'clearChoice' }
  // Sets the recommended choice on a question, or the recommended entry on a
  // finding: its recommend_action with its recommend, or that action's header
  // when recommend is null.
  | { type: 'acceptRecommendation' }
  | { type: 'toggleNotApplicable' }
  | { type: 'toggleDontAsk' };

export type FormsAction =
  | ItemAction
  | { type: 'roundShown'; round: PresentedRound }
  | { type: 'roundClosed'; roundId: string }
  | { type: 'sessionActivated'; sessionId: string | null }
  // Asks to cancel the active round before its session closes.
  | { type: 'askClose'; sessionId: string }
  | { type: 'openReview' }
  | { type: 'closeReview' }
  | { type: 'reviewNext' }
  | { type: 'reviewPrev' }
  // Without `row`, jumps to the review cursor's row.
  | { type: 'reviewJump'; row?: number }
  // `item` is a rail position; the review's rail sends it for a notice, which
  // has no review row.
  | { type: 'reviewJumpItem'; item: number }
  | { type: 'askCancel' }
  | { type: 'dismissConfirm' }
  // The round's finish went to main; it closes on main's roundClosed.
  | { type: 'sendStarted'; roundId: string; kind: RoundEnd['kind'] }
  // The finish never reached the agent: main refused it, or closed the round
  // on its own first.
  | { type: 'sendFailed'; roundId: string }
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
  activeSessionId: null,
  confirmReturnView: 'review',
  confirmClosesSession: false,
};

const UNTOUCHED: ItemAnswer = {
  choice: 0,
  notApplicable: false,
  notes: '',
  dontAsk: false,
  dontAskReason: '',
};

// A finding answer's pick alone.
type FindingPick = Pick<FindingAnswer, 'choice' | 'action'>;

const NO_PICK: FindingPick = { choice: 0, action: '' };

const UNTOUCHED_FINDING: FindingAnswer = { ...UNTOUCHED, ...NO_PICK };

const RAIL_ORDER: ItemKind[] = ['notice', 'finding', 'question'];

// Each kind's items in a round, in order.
export const ROUND_ITEMS = {
  notice: (round) => round.notices,
  finding: (round) => round.findings,
  question: (round) => round.questions,
} satisfies Record<ItemKind, (round: Round) => unknown[]>;

// The answer each answerable kind holds.
interface AnswerOf {
  question: ItemAnswer;
  finding: FindingAnswer;
}

// An answerable item of one kind.
type KindItem<K extends AnswerableKind> = { kind: K; index: number };

// Reads and replaces one kind's answers in a round.
interface AnswerArray<Answer> {
  read(round: RoundState): Answer[];
  write(round: RoundState, answers: Answer[]): RoundState;
}

// Keeps every answer's own kind, so a finding's action survives.
type AnswerChange = <Answer extends ItemAnswer>(
  answer: Answer,
  choiceCount: number,
) => Answer;

// A mapped type, not `satisfies`: indexing it by a generic kind keeps the
// kind's answer type.
const ANSWER_ARRAYS: { [K in AnswerableKind]: AnswerArray<AnswerOf[K]> } = {
  question: {
    read: (round) => round.answers,
    write: (round, answers) => ({ ...round, answers }),
  },
  finding: {
    read: (round) => round.findingAnswers,
    write: (round, findingAnswers) => ({ ...round, findingAnswers }),
  },
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

// The actions that still apply while the active round is sending: rounds
// opening and closing, the shown session, the editors' text and saves, and
// the send's own failure.
const SENDING_ACTIONS: ReadonlySet<FormsAction['type']> = new Set([
  'roundShown',
  'roundClosed',
  'sessionActivated',
  'setText',
  'saveStarted',
  'saveFinished',
  'sendFailed',
]);

// The forms page's store, over `apply`.
export type FormsStore = ReducerStore<FormsState, FormsAction>;

// Returns `state` itself when the action changes nothing. Item actions apply
// only in the forms view. While the active round is sending, only the
// actions in SENDING_ACTIONS apply.
export function apply(state: FormsState, action: FormsAction): FormsState {
  const isActiveSending = (activeRound(state)?.sending ?? null) !== null;
  if (isActiveSending && !SENDING_ACTIONS.has(action.type)) {
    return state;
  }
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
    case 'reviewJumpItem':
      return jumpToRailItem(state, action.item);
    case 'askCancel':
      return state.view === 'review'
        ? {
            ...state,
            view: 'confirm',
            confirmReturnView: 'review',
            confirmClosesSession: false,
          }
        : state;
    case 'dismissConfirm':
      return state.view === 'confirm'
        ? {
            ...state,
            view: state.confirmReturnView,
            confirmClosesSession: false,
          }
        : state;
    case 'setText':
      return updateRound(state, action.roundId, (round) =>
        setText(round, action.target, action.value),
      );
    case 'sendStarted':
      return updateRound(state, action.roundId, (round) =>
        round.sending === null
          ? {
              ...round,
              sending: {
                kind: action.kind,
                closesSession:
                  action.kind === 'cancelled' && state.confirmClosesSession,
              },
            }
          : round,
      );
    case 'sendFailed':
      return updateRound(state, action.roundId, (round) =>
        round.sending === null ? round : { ...round, sending: null },
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

// The session's round; main keeps one open round per session, so the first
// match is the only one.
export function roundOfSession(
  state: FormsState,
  sessionId: string | null,
): RoundState | undefined {
  return state.rounds.find((round) => round.sessionId === sessionId);
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
export function itemAnswer<K extends AnswerableKind>(
  round: RoundState,
  item: KindItem<K>,
): AnswerOf[K] {
  if (!hasItem(round, item)) {
    throw new Error(`round ${round.roundId} has no ${item.kind} ${item.index}`);
  }
  const answers: AnswerArray<AnswerOf[K]> = ANSWER_ARRAYS[item.kind];
  return answers.read(round)[item.index - 1];
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

// The finding card's word for `action` on finding `item` in `round`, or null
// when the finding's origin does not offer it.
export function findingActionWord(
  round: RoundState,
  item: AnswerableItem,
  action: FindingAction,
): string | null {
  return actionLabel(round.round.findings[item.index - 1].origin, action);
}

const PICK_ANSWERS = {
  question: (round, index) => round.answers[index - 1].choice >= 1,
  finding: (round, index) => {
    const answer = round.findingAnswers[index - 1];
    const finding = round.round.findings[index - 1];
    return findingPickIsComplete(finding, answer.choice, answer.action);
  },
} satisfies Record<
  AnswerableKind,
  (round: RoundState, index: number) => boolean
>;

// Whether the item's picks alone answer it, notes aside: a choice on a
// question, one of its numbered entries on a finding.
export function pickIsComplete(
  round: RoundState,
  item: AnswerableItem,
): boolean {
  return PICK_ANSWERS[item.kind](round, item.index);
}

// The 1-based number the item's pick has down its card: a question's choice,
// a finding's entry (`findingEntries`); 0 for no pick.
export function pickNumber(round: RoundState, item: AnswerableItem): number {
  if (item.kind === 'question') {
    return round.answers[item.index - 1].choice;
  }
  const answer = round.findingAnswers[item.index - 1];
  const finding = round.round.findings[item.index - 1];
  return findingEntryNumber(finding, answer.choice, answer.action);
}

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
  return pickIsComplete(round, item) || hasText ? 'answered' : 'untouched';
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
      (entry, question) => restoreAnswer(entry, question.choices.length),
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
    sending: null,
  };
}

// One answer per item, from the entry carrying its 1-based index.
function restoreAnswers<Item, Entry extends AnswerEntry, Answer>(
  items: Item[],
  entries: Entry[],
  restore: (entry: Entry | undefined, item: Item) => Answer,
): Answer[] {
  return items.map((item, i) =>
    restore(
      entries.find((entry) => entry.index === i + 1),
      item,
    ),
  );
}

// A finding with no draft entry starts with no pick. A draft's pick restores
// only when it is one of the finding's entries; any other restores as no
// pick, keeping the entry's notes, Not applicable and Don't ask.
function restoreFindingAnswer(
  entry: FindingAnswerEntry | undefined,
  finding: Finding,
): FindingAnswer {
  if (entry === undefined) {
    return UNTOUCHED_FINDING;
  }
  const answer = restoreAnswer(entry, finding.choices.length);
  const action = isFindingAction(entry.action) ? entry.action : '';
  const isEntry = findingEntryNumber(finding, entry.choice, action) > 0;
  return isEntry
    ? { ...answer, choice: entry.choice, action }
    : { ...answer, choice: 0, action: '' };
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
  return { ...state, rounds, activeRoundId: presented.roundId, view: 'forms' };
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
  return {
    ...state,
    rounds,
    activeRoundId: null,
    view: 'idle',
    confirmClosesSession: false,
  };
}

// Shows the newly active session's round, or the idle view; a pending
// prompt is dismissed.
function activateSession(
  state: FormsState,
  sessionId: string | null,
): FormsState {
  if (sessionId === state.activeSessionId) {
    return state;
  }
  const round = roundOfSession(state, sessionId);
  return {
    ...state,
    activeSessionId: sessionId,
    activeRoundId: round?.roundId ?? null,
    view: round === undefined ? 'idle' : 'forms',
    confirmClosesSession: false,
  };
}

// Opens the cancel prompt for the active round of the closing session,
// from its form or review; keeping the round returns there.
function askClose(state: FormsState, sessionId: string): FormsState {
  const view = state.view;
  const isRoundOfSession = activeRound(state)?.sessionId === sessionId;
  const isAskable = view === 'forms' || view === 'review';
  if (!isRoundOfSession || !isAskable) {
    return state;
  }
  return {
    ...state,
    view: 'confirm',
    confirmReturnView: view,
    confirmClosesSession: true,
  };
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

// Shows the item's card and leaves the review cursor where it was.
function jumpToRailItem(state: FormsState, item: number): FormsState {
  const round = activeRound(state);
  if (state.view !== 'review' || round === null) {
    return state;
  }
  const isRailPosition = item >= 0 && item < railItems(round.round).length;
  if (!isRailPosition) {
    return state;
  }
  const jumped = updateRound(state, round.roundId, (current) =>
    current.focus === item ? current : { ...current, focus: item },
  );
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
      if (focusedItem(round)?.kind === 'finding') {
        return updateFocusedFinding(round, (answer, finding) =>
          chooseEntry(answer, finding, action.number),
        );
      }
      return updateFocusedAnswer(round, (answer, choiceCount) =>
        choose(answer, choiceCount, action.number),
      );
    case 'clearChoice':
      if (focusedItem(round)?.kind === 'finding') {
        return updateFocusedFinding(round, clearFindingPick);
      }
      return updateFocusedAnswer(round, (answer) =>
        answer.notApplicable || answer.choice === 0
          ? answer
          : { ...answer, choice: 0 },
      );
    case 'acceptRecommendation':
      return acceptRecommendation(round);
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
function choose<Answer extends ItemAnswer>(
  answer: Answer,
  choiceCount: number,
  choice: number,
): Answer {
  const isChoiceInRange = choice >= 1 && choice <= choiceCount;
  if (answer.notApplicable || !isChoiceInRange) {
    return answer;
  }
  return { ...answer, choice: answer.choice === choice ? 0 : choice };
}

// Picks the finding's entry `number` (1-based), choice and action together;
// the held entry again clears to no pick. Locked while not applicable, and a
// number past the last entry changes nothing.
function chooseEntry(
  answer: FindingAnswer,
  finding: Finding,
  number: number,
): FindingAnswer {
  const entry = findingEntries(finding)[number - 1];
  if (answer.notApplicable || entry === undefined) {
    return answer;
  }
  if (holdsPick(answer, entry)) {
    return { ...answer, ...NO_PICK };
  }
  return { ...answer, choice: entry.choice, action: entry.action };
}

// Locked while not applicable; a no-op on a finding with no pick.
function clearFindingPick(answer: FindingAnswer): FindingAnswer {
  if (answer.notApplicable || holdsPick(answer, NO_PICK)) {
    return answer;
  }
  return { ...answer, ...NO_PICK };
}

function holdsPick(answer: FindingAnswer, pick: FindingPick): boolean {
  return answer.choice === pick.choice && answer.action === pick.action;
}

// A no-op unless a finding is focused, or when `change` returns the answer
// it was given.
function updateFocusedFinding(
  round: RoundState,
  change: (answer: FindingAnswer, finding: Finding) => FindingAnswer,
): RoundState {
  const focused = focusedItem(round);
  if (focused === null || focused.kind !== 'finding') {
    return round;
  }
  const finding = ROUND_ITEMS.finding(round.round)[focused.index - 1];
  return updateItemAnswer(
    round,
    { kind: 'finding', index: focused.index },
    (answer) => change(answer, finding),
  );
}

// Writes the recommended pick onto an answer, or returns the answer itself
// when it already holds that pick. `index` is 1-based.
type RecommendedPick<K extends AnswerableKind> = (
  round: RoundState,
  index: number,
  answer: AnswerOf[K],
) => AnswerOf[K];

// A mapped type, not `satisfies`: indexing it by a generic kind keeps the
// kind's answer type. A finding's recommended pick is its recommend_action
// with its recommend, or that action's header when recommend is null.
const RECOMMENDED_PICKS: { [K in AnswerableKind]: RecommendedPick<K> } = {
  question: (round, index, answer) => {
    const { recommend } = round.round.questions[index - 1];
    return answer.choice === recommend
      ? answer
      : { ...answer, choice: recommend };
  },
  finding: (round, index, answer) => {
    const finding = round.round.findings[index - 1];
    const recommended: FindingPick = {
      choice: finding.recommend ?? 0,
      action: finding.recommend_action,
    };
    return holdsPick(answer, recommended)
      ? answer
      : { ...answer, ...recommended };
  },
};

// A no-op on a notice, while not applicable, or when the focused answer
// already holds the recommended pick.
function acceptRecommendation(round: RoundState): RoundState {
  const focused = focusedItem(round);
  if (focused === null || focused.kind === 'notice') {
    return round;
  }
  return acceptRecommendationOn(round, {
    kind: focused.kind,
    index: focused.index,
  });
}

function acceptRecommendationOn<K extends AnswerableKind>(
  round: RoundState,
  item: KindItem<K>,
): RoundState {
  const pick: RecommendedPick<K> = RECOMMENDED_PICKS[item.kind];
  return updateItemAnswer(round, item, (answer) =>
    answer.notApplicable ? answer : pick(round, item.index, answer),
  );
}

// A no-op when a notice is focused or `change` returns the answer it was given.
function updateFocusedAnswer(
  round: RoundState,
  change: AnswerChange,
): RoundState {
  const focused = focusedItem(round);
  if (focused === null || focused.kind === 'notice') {
    return round;
  }
  return updateItemAnswer(
    round,
    { kind: focused.kind, index: focused.index },
    change,
  );
}

// A no-op when `change` returns the answer it was given. Throws when the
// round has no such item.
function updateItemAnswer<K extends AnswerableKind>(
  round: RoundState,
  item: KindItem<K>,
  change: (answer: AnswerOf[K], choiceCount: number) => AnswerOf[K],
): RoundState {
  const choiceCount = ROUND_ITEMS[item.kind](round.round)[item.index - 1]
    .choices.length;
  const answer = itemAnswer(round, item);
  const next = change(answer, choiceCount);
  return next === answer ? round : withItemAnswer(round, item, next);
}

function hasItem(round: RoundState, item: AnswerableItem): boolean {
  const count = ANSWER_ARRAYS[item.kind].read(round).length;
  return item.index >= 1 && item.index <= count;
}

function withItemAnswer<K extends AnswerableKind>(
  round: RoundState,
  item: KindItem<K>,
  answer: AnswerOf[K],
): RoundState {
  const answers: AnswerArray<AnswerOf[K]> = ANSWER_ARRAYS[item.kind];
  const written = answers.write(
    round,
    answers
      .read(round)
      .map((current, i) => (i === item.index - 1 ? answer : current)),
  );
  return { ...written, revision: round.revision + 1 };
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
      const writeField: AnswerChange = (answer) => ({
        ...answer,
        [field]: value,
      });
      return updateItemAnswer(round, item, writeField);
    }
  }
}
