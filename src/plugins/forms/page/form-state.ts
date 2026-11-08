import type {
  AnswerableKind,
  AnswerEntry,
  AnswerStatus,
  FindingAction,
  Finding,
  FindingAnswerEntry,
  FormBody,
  ItemKind,
  PresentedRound,
  Round,
  RoundPlace,
} from '../contract';
import type { ReducerStore } from '../../../shared/page/reducer-store';
import {
  activeForm,
  createSessionFormsReducer,
  emptySessionForms,
  type SessionForm,
  type SessionFormsAction,
  type SessionFormsState,
  updateForm,
} from '../../../shared/page/session-forms';
import { actionLabel } from '../finding-origins';
import {
  findingEntries,
  findingEntryNumber,
  findingPickIsComplete,
  isFindingAction,
} from '../finding-pick';
import { isResponded } from '../item-response';

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

// `choice` and `action` are one pick, one of the finding's numbered entries
// (`findingEntries`): `choice` is 0 for an action's header. No pick is
// `{ choice: 0, action: '' }`.
export interface FindingAnswer extends ItemAnswer {
  action: FindingAction | '';
}

// `formId` is the round's id.
export interface RoundState extends SessionForm {
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
}

// The open rounds and the view; the active round is the round of the session
// the sessions plugin focuses, or null when that session has none.
export type FormsState = SessionFormsState<RoundState, 'forms'>;

export interface Progress {
  // Responded items (`answerStatus`), notes-only ones included.
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

// The forms page's own actions beside the session form lifecycle's.
type FormsOwnAction =
  | ItemAction
  | { type: 'openReview' }
  | { type: 'reviewNext' }
  | { type: 'reviewPrev' }
  // Without `row`, jumps to the review cursor's row.
  | { type: 'reviewJump'; row?: number }
  // `item` is a rail position; the review's rail sends it for a notice, which
  // has no review row.
  | { type: 'reviewJumpItem'; item: number }
  | { type: 'setText'; formId: string; target: TextTarget; value: string }
  // Puts round `formId` back where the last page left it; the view applies only
  // while the round is active.
  | { type: 'placeRestored'; formId: string; place: RoundPlace };

export type FormsAction = SessionFormsAction<PresentedRound> | FormsOwnAction;

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
    (state, round) => apply(state, { type: 'formShown', form: round }),
    emptySessionForms<RoundState, 'forms'>(activeSessionId),
  );
}

// The forms page's store, over `apply`.
export type FormsStore = ReducerStore<FormsState, FormsAction>;

// Returns `state` itself when the action changes nothing. Item actions apply
// only in the forms view. While the active round is sending, only the
// lifecycle's sending actions and the editors' text apply.
export const apply = createSessionFormsReducer<
  RoundState,
  'forms',
  PresentedRound,
  FormsOwnAction
>({
  formView: 'forms',
  restore: restoreRound,
  sendingActions: new Set(['setText']),
  applyOwn,
});

function applyOwn(state: FormsState, action: FormsOwnAction): FormsState {
  switch (action.type) {
    case 'openReview':
      return openReview(state);
    case 'reviewNext':
      return moveReviewRow(state, 1);
    case 'reviewPrev':
      return moveReviewRow(state, -1);
    case 'reviewJump':
      return jumpToReviewRow(state, action.row);
    case 'reviewJumpItem':
      return jumpToRailItem(state, action.item);
    case 'setText':
      return updateForm(state, action.formId, (round) =>
        setText(round, action.target, action.value),
      );
    case 'placeRestored':
      return restorePlace(state, action.formId, action.place);
    default:
      return state.view === 'forms'
        ? updateForm(state, state.activeFormId, (round) =>
            applyItemAction(round, action),
          )
        : state;
  }
}

// The round's place: its view and the view its Cancel prompt returns to are the
// state's while it is active, else `kept`'s, the place last written for it.
export function roundPlace(
  state: FormsState,
  round: RoundState,
  kept: RoundPlace | undefined,
): RoundPlace {
  const { focus, reviewRow } = round;
  if (round.formId === state.activeFormId && state.view !== 'idle') {
    return {
      focus,
      reviewRow,
      view: state.view,
      confirmReturnView: state.confirmReturnView,
    };
  }
  return {
    focus,
    reviewRow,
    view: kept?.view ?? 'forms',
    confirmReturnView: kept?.confirmReturnView ?? 'review',
  };
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
    throw new Error(`round ${round.formId} has no ${item.kind} ${item.index}`);
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

// The item's status as the page counts it: `answered` once the item is
// responded (`isResponded`), its pick complete or its notes written, where the
// payload counts the pick alone. Throws when the round has no such item.
export function answerStatus(
  round: RoundState,
  item: AnswerableItem,
): AnswerStatus {
  const answer = itemAnswer(round, item);
  if (answer.notApplicable) {
    return 'not_applicable';
  }
  const responded = isResponded({
    notApplicable: answer.notApplicable,
    pickIsComplete: pickIsComplete(round, item),
    notes: answer.notes,
  });
  return responded ? 'answered' : 'untouched';
}

// The next answerable item after the focused one, by `step` and wrapping,
// whose status is untouched; the focused item is checked last. Null when
// every item is responded or not applicable.
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
    formId: roundId,
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

function restorePlace(
  state: FormsState,
  formId: string,
  place: RoundPlace,
): FormsState {
  const { focus, reviewRow } = place;
  const placed = updateForm(state, formId, (round) =>
    round.focus === focus && round.reviewRow === reviewRow
      ? round
      : { ...round, focus, reviewRow },
  );
  const isViewUnchanged =
    placed.view === place.view &&
    placed.confirmReturnView === place.confirmReturnView;
  if (formId !== placed.activeFormId || isViewUnchanged) {
    return placed;
  }
  return {
    ...placed,
    view: place.view,
    confirmReturnView: place.confirmReturnView,
  };
}

function openReview(state: FormsState): FormsState {
  if (state.view !== 'forms' || state.activeFormId === null) {
    return state;
  }
  return updateForm(
    { ...state, view: 'review' },
    state.activeFormId,
    (round) => (round.reviewRow === 0 ? round : { ...round, reviewRow: 0 }),
  );
}

function moveReviewRow(state: FormsState, step: number): FormsState {
  if (state.view !== 'review') {
    return state;
  }
  return updateForm(state, state.activeFormId, (round) => {
    const lastRow = Math.max(answerableItems(round.round).length - 1, 0);
    const row = Math.min(Math.max(round.reviewRow + step, 0), lastRow);
    return row === round.reviewRow ? round : { ...round, reviewRow: row };
  });
}

function jumpToReviewRow(
  state: FormsState,
  row: number | undefined,
): FormsState {
  const round = activeForm(state);
  if (state.view !== 'review' || round === null) {
    return state;
  }
  const target = row ?? round.reviewRow;
  const item = answerableItems(round.round)[target];
  if (item === undefined) {
    return state;
  }
  const jumped = updateForm(state, round.formId, (current) => ({
    ...current,
    reviewRow: target,
    focus: railPosition(current.round, item),
  }));
  return { ...jumped, view: 'forms' };
}

// Shows the item's card and leaves the review cursor where it was.
function jumpToRailItem(state: FormsState, item: number): FormsState {
  const round = activeForm(state);
  if (state.view !== 'review' || round === null) {
    return state;
  }
  const isRailPosition = item >= 0 && item < railItems(round.round).length;
  if (!isRailPosition) {
    return state;
  }
  const jumped = updateForm(state, round.formId, (current) =>
    current.focus === item ? current : { ...current, focus: item },
  );
  return { ...jumped, view: 'forms' };
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
