import type {
  AnswerStatus,
  FindingAction,
  Finding,
  FormBody,
  ItemAnswer,
  ItemKind,
  KindPick,
  PageKind,
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
import { findingEntries } from '../finding-pick';
import { isResponded } from '../item-response';
import { drawnOriginSpec } from './kinds/finding/verdict';
import type { PageKindTable } from './kinds/page-kinds';

export type { ItemAnswer } from '../contract';

// Any one item of a round, by kind. `index` is 1-based within its kind, as
// the forms contract numbers items.
export type RoundItem = { kind: ItemKind; index: number };

// An item of a kind whose `spec.answerable` is true.
export type AnswerableItem = RoundItem;

// The rail stop that holds every notice of the round.
export type NoticesStop = { kind: 'notices' };

// A stop on the rail: one item of a kind with a rail order, or the notices
// stop.
export type RailItem = RoundItem | NoticesStop;

export function isNoticesStop(item: RailItem): item is NoticesStop {
  return item.kind === 'notices';
}

// `choice` and `action` are one pick, one of the finding's numbered entries
// (`findingEntries`): `choice` is 0 for an action's header. No pick is
// `{ choice: 0, action: '' }`.
export interface FindingAnswer extends ItemAnswer {
  action: FindingAction | '';
}

// A notice's answer: the user's comment on it.
export interface NoticeAnswer {
  comment: string;
}

// The draft entries of a kind the page has no registration for, kept as main
// sent them, and the body key they write back to.
export interface HeldEntries {
  bodyKey: string;
  entries: readonly unknown[];
}

// `formId` is the round's id.
export interface RoundState extends SessionForm {
  round: Round;
  // The kinds the round was derived with.
  kinds: PageKindTable;
  // Each registered kind's answers, one per item, in order.
  itemAnswers: Readonly<Record<ItemKind, readonly unknown[]>>;
  // Each unregistered kind's draft entries, unchanged.
  heldEntries: Readonly<Record<ItemKind, HeldEntries>>;
  // One per notice, in order: whether its line is open on the notices stop.
  openNotices: boolean[];
  // The 1-based notice under the notices stop's line cursor; 0 when the round
  // has no notices.
  noticeLine: number;
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

// The round note, or one of an item's text boxes by its kind's box field.
export type TextTarget = { field: 'note' } | { field: string; item: RoundItem };

// Acts on the active round: its focused item, or the notice an action names.
export type ItemAction =
  | { type: 'nextItem' }
  | { type: 'prevItem' }
  | { type: 'firstItem' }
  | { type: 'lastItem' }
  // `item` is a rail position.
  | { type: 'focusItem'; item: number }
  // `number` is 1-based down the card: the kind's `pick.choose`. A number
  // past the last changes nothing.
  | { type: 'choose'; number: number }
  // The kind's `pick.clear`.
  | { type: 'clearChoice' }
  // The kind's `pick.recommended`.
  | { type: 'acceptRecommendation' }
  | { type: 'toggleNotApplicable' }
  | { type: 'toggleDontAsk' }
  // `notice` is 1-based in each notice action. Opens or closes that line,
  // whatever item is focused.
  | { type: 'toggleNotice'; notice: number }
  // Moves the line cursor while the notices stop is focused.
  | { type: 'moveNoticeLine'; delta: 1 | -1 }
  // Focuses the notices stop with the line cursor on `notice`.
  | { type: 'focusNotice'; notice: number };

// The forms page's own actions beside the session form lifecycle's.
type FormsOwnAction =
  | ItemAction
  | { type: 'openReview' }
  | { type: 'reviewNext' }
  | { type: 'reviewPrev' }
  | { type: 'reviewTop' }
  | { type: 'reviewBottom' }
  // Without `row`, jumps to the review cursor's row.
  | { type: 'reviewJump'; row?: number }
  // `item` is a rail position; the review's rail sends it for the notices
  // stop, which has no review row.
  | { type: 'reviewJumpItem'; item: number }
  | { type: 'setText'; formId: string; target: TextTarget; value: string }
  // Puts round `formId` back where the last page left it; the view applies only
  // while the round is active.
  | { type: 'placeRestored'; formId: string; place: RoundPlace }
  // Re-derives every open round with `kinds`; not an edit.
  | { type: 'kindsChanged'; kinds: PageKindTable };

export type FormsAction = SessionFormsAction<PresentedRound> | FormsOwnAction;

// Returns `state` itself when the action changes nothing. Item actions apply
// only in the forms view. While the active round is sending, only the
// lifecycle's sending actions, the editors' text and kind changes apply.
export type FormsReducer = (
  state: FormsState,
  action: FormsAction,
) => FormsState;

// A finding answer's pick alone.
export type FindingPick = Pick<FindingAnswer, 'choice' | 'action'>;

export const NO_PICK: FindingPick = { choice: 0, action: '' };

const NOTICE_KIND: ItemKind = 'notice';

// The reducer over the kinds `kinds()` returns as each round shows, and the
// state it starts from: `rounds` shown in order.
export function createFormsState(kinds: () => PageKindTable): {
  apply: FormsReducer;
  initialState(
    rounds: PresentedRound[],
    activeSessionId: string | null,
  ): FormsState;
} {
  const apply: FormsReducer = createSessionFormsReducer<
    RoundState,
    'forms',
    PresentedRound,
    FormsOwnAction
  >({
    formView: 'forms',
    restore: (presented) => restoreRound(presented, kinds()),
    sendingActions: new Set(['setText', 'kindsChanged']),
    applyOwn,
  });
  return {
    apply,
    initialState: (rounds, activeSessionId) =>
      rounds.reduce(
        (state, round) => apply(state, { type: 'formShown', form: round }),
        emptySessionForms<RoundState, 'forms'>(activeSessionId),
      ),
  };
}

// The forms page's store, over a `FormsReducer`.
export type FormsStore = ReducerStore<FormsState, FormsAction>;

function applyOwn(state: FormsState, action: FormsOwnAction): FormsState {
  switch (action.type) {
    case 'openReview':
      return openReview(state);
    case 'reviewNext':
      return moveReviewRow(state, 1);
    case 'reviewPrev':
      return moveReviewRow(state, -1);
    case 'reviewTop':
      return placeReviewRow(state, () => 0);
    case 'reviewBottom':
      return placeReviewRow(state, (_row, lastRow) => lastRow);
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
    case 'kindsChanged':
      return changeKinds(state, action.kinds);
    default:
      return state.view === 'forms'
        ? updateForm(state, state.activeFormId, (round) =>
            applyItemAction(round, action),
          )
        : state;
  }
}

// The round's place: its view and the view its Cancel prompt returns to are the
// state's while it is active, else 'forms', the view activating its session opens.
export function roundPlace(state: FormsState, round: RoundState): RoundPlace {
  const { focus, reviewRow, noticeLine } = round;
  if (round.formId === state.activeFormId && state.view !== 'idle') {
    return {
      focus,
      reviewRow,
      noticeLine,
      view: state.view,
      confirmReturnView: state.confirmReturnView,
    };
  }
  return {
    focus,
    reviewRow,
    noticeLine,
    view: 'forms',
    confirmReturnView: 'review',
  };
}

// The kind's items in the round, in order; none for a kind the round lacks.
export function kindItems(round: Round, kind: ItemKind): readonly unknown[] {
  return round.items[kind] ?? [];
}

// The item's answer as its kind holds it. Throws when the round has no such
// item of a registered kind.
export function kindAnswer(round: RoundState, item: RoundItem): unknown {
  const answers = round.itemAnswers[item.kind];
  const isItem =
    answers !== undefined && item.index >= 1 && item.index <= answers.length;
  if (!isItem) {
    throw new Error(`round ${round.formId} has no ${item.kind} ${item.index}`);
  }
  return answers[item.index - 1];
}

// The kinds the round holds items of with no registration, in the round's
// kind order, with their item counts.
export function unregisteredKinds(
  round: RoundState,
): { kind: ItemKind; count: number }[] {
  return Object.entries(round.round.items).flatMap(([kind, items]) =>
    round.kinds.get(kind) === undefined && items.length > 0
      ? [{ kind, count: items.length }]
      : [],
  );
}

// The stops of each kind with a rail order, by rail order, then the notices
// stop when the round has notices.
export function railItems(round: RoundState): RailItem[] {
  const items: RailItem[] = round.kinds.railKinds.flatMap((kind) =>
    kindStops(round, kind),
  );
  return noticeCount(round) > 0 ? [...items, { kind: 'notices' }] : items;
}

// The stops of the answerable kinds, in rail order: the review's rows.
export function answerableItems(round: RoundState): AnswerableItem[] {
  return round.kinds.railKinds
    .filter((kind) => kind.spec.answerable)
    .flatMap((kind) => kindStops(round, kind));
}

function kindStops(round: RoundState, kind: PageKind): RoundItem[] {
  const { id } = kind.spec;
  return kindItems(round.round, id).map((_, i) => ({ kind: id, index: i + 1 }));
}

// The notices the notices stop holds: none while `notice` has no
// registration.
function noticeCount(round: RoundState): number {
  return round.kinds.get(NOTICE_KIND) === undefined
    ? 0
    : kindItems(round.round, NOTICE_KIND).length;
}

// The item's position in railItems(round), or -1 when the round lacks it.
export function railPosition(round: RoundState, item: RailItem): number {
  return railItems(round).findIndex((candidate) =>
    sameRailItem(candidate, item),
  );
}

function sameRailItem(a: RailItem, b: RailItem): boolean {
  if (isNoticesStop(a) || isNoticesStop(b)) {
    return a.kind === b.kind;
  }
  return a.kind === b.kind && a.index === b.index;
}

export function focusedItem(round: RoundState): RailItem | null {
  return railItems(round)[round.focus] ?? null;
}

// Whether the item's kind is registered and takes an answer.
export function isAnswerable(round: RoundState, item: RoundItem): boolean {
  return round.kinds.get(item.kind)?.spec.answerable === true;
}

// An answerable item's kind and its pick rules.
interface AnswerableKindOf {
  kind: PageKind;
  pick: KindPick<unknown, unknown>;
}

// Throws when the item's kind is unregistered or takes no answer.
function answerableKindOf(
  round: RoundState,
  item: RoundItem,
): AnswerableKindOf {
  const kind = round.kinds.get(item.kind);
  const pick = kind?.reduce.pick;
  if (kind === undefined || pick === undefined) {
    throw new Error(`round ${round.formId}: ${item.kind} takes no answer`);
  }
  return { kind, pick };
}

function kindItem(round: RoundState, item: RoundItem): unknown {
  return kindItems(round.round, item.kind)[item.index - 1];
}

// An answerable item's answer. Throws when the round has no such item, or its
// kind takes no answer.
export function itemAnswer(round: RoundState, item: RoundItem): ItemAnswer {
  answerableKindOf(round, item);
  return kindAnswer(round, item) as ItemAnswer;
}

// The action picked on a finding; '' on any other kind.
export function findingActionOf(
  round: RoundState,
  item: AnswerableItem,
): FindingAction | '' {
  return item.kind === 'finding'
    ? (kindAnswer(round, item) as FindingAnswer).action
    : '';
}

// The finding card's word for `action` on finding `item` in `round`, as the
// card draws its origin's spec, or null when the spec does not offer it.
export function findingActionWord(
  round: RoundState,
  item: AnswerableItem,
  action: FindingAction,
): string | null {
  const finding = kindItem(round, item) as Finding;
  return drawnOriginSpec(finding.origin).actions[action] ?? null;
}

// Whether the item's picks alone answer it, notes aside: the kind's
// `pick.isComplete`.
export function pickIsComplete(
  round: RoundState,
  item: AnswerableItem,
): boolean {
  const { pick } = answerableKindOf(round, item);
  return pick.isComplete(kindItem(round, item), kindAnswer(round, item));
}

// The 1-based number the item's pick has down its card, 0 for no pick: the
// kind's `pick.number`.
export function pickNumber(round: RoundState, item: AnswerableItem): number {
  const { pick } = answerableKindOf(round, item);
  return pick.number(kindItem(round, item), kindAnswer(round, item));
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
  const items = answerableItems(round);
  const count = items.length;
  const focused = focusedItem(round);
  const position =
    focused === null
      ? -1
      : items.findIndex((item) => sameRailItem(item, focused));
  // With the notices stop or a stop with no answer focused, the search
  // starts just outside the items, so forward runs from the first and
  // backward from the last.
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
  const statuses = answerableItems(round).map((item) =>
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

// The saved-round body: `note`, then each registered kind's `restore.encode`
// at main's bodyKey for it, in reverse registration order, then each held
// kind's entries unchanged, in main's kind order. A registered kind main gave
// no bodyKey for has no items and writes nothing.
export function buildBody(round: RoundState): FormBody {
  const body: Record<string, unknown> = { note: round.note };
  for (const kind of round.kinds.kinds().toReversed()) {
    const { id } = kind.spec;
    const bodyKey = round.round.bodyKeys[id];
    if (bodyKey !== undefined) {
      body[bodyKey] = kind.restore.encode(round.itemAnswers[id]);
    }
  }
  for (const id of Object.keys(round.round.bodyKeys)) {
    const held = round.heldEntries[id];
    if (held !== undefined) {
      body[held.bodyKey] = held.entries;
    }
  }
  return body as FormBody;
}

// The entries a body holds at `bodyKey`; none for a missing or malformed key.
function draftEntries(
  draft: FormBody | null,
  bodyKey: string | undefined,
): readonly unknown[] {
  const entries = bodyKey === undefined ? undefined : draft?.[bodyKey];
  return Array.isArray(entries) ? entries : [];
}

// Each registered kind's answers restore from main's bodyKey for it, its own
// spec's when main gave none; each kind main gave a bodyKey and the page no
// registration holds its entries.
function restoreRound(
  presented: PresentedRound,
  kinds: PageKindTable,
): RoundState {
  const { roundId, sessionId, label, round, draft } = presented;
  const itemAnswers: Record<ItemKind, readonly unknown[]> = {};
  for (const kind of kinds.kinds()) {
    const { id, bodyKey } = kind.spec;
    itemAnswers[id] = kind.restore.decode(
      kindItems(round, id),
      draftEntries(draft, round.bodyKeys[id] ?? bodyKey),
    );
  }
  const heldEntries: Record<ItemKind, HeldEntries> = {};
  for (const [id, bodyKey] of Object.entries(round.bodyKeys)) {
    if (kinds.get(id) === undefined) {
      heldEntries[id] = { bodyKey, entries: draftEntries(draft, bodyKey) };
    }
  }
  const notices = (itemAnswers[NOTICE_KIND] ?? []) as readonly NoticeAnswer[];
  const noticeTotal = kindItems(round, NOTICE_KIND).length;
  return {
    formId: roundId,
    sessionId,
    label,
    round,
    kinds,
    itemAnswers,
    heldEntries,
    openNotices: Array.from(
      { length: noticeTotal },
      (_, i) => (notices[i]?.comment ?? '') !== '',
    ),
    noticeLine: noticeTotal > 0 ? 1 : 0,
    note: draft?.note ?? '',
    focus: 0,
    reviewRow: 0,
    revision: 0,
    savingRevision: null,
    savedRevision: 0,
    saveError: null,
    sending: null,
  };
}

// Every open round re-derived with `kinds`; `state` itself when every round
// already holds it.
function changeKinds(state: FormsState, kinds: PageKindTable): FormsState {
  const forms = state.forms.map((round) => rederiveRound(round, kinds));
  const isUnchanged = forms.every((round, i) => round === state.forms[i]);
  return isUnchanged ? state : { ...state, forms };
}

// The round with `next` in place of the kinds it was derived with: a kind that
// left encodes its answers into `heldEntries`, a kind that arrived decodes its
// held entries, and a kind replaced under its id encodes with the old and
// decodes with the new. Focus and the review cursor stay on their item while
// it is still there, else clamp to the last stop or row. Not an edit.
function rederiveRound(round: RoundState, next: PageKindTable): RoundState {
  if (round.kinds === next) {
    return round;
  }
  const itemAnswers: Record<ItemKind, readonly unknown[]> = {};
  const heldEntries: Record<ItemKind, HeldEntries> = { ...round.heldEntries };
  for (const old of round.kinds.kinds()) {
    const { id } = old.spec;
    const now = next.get(id);
    const answers = round.itemAnswers[id];
    if (now === old) {
      itemAnswers[id] = answers;
      continue;
    }
    const entries = old.restore.encode(answers);
    const bodyKey = round.round.bodyKeys[id];
    if (now !== undefined) {
      itemAnswers[id] = now.restore.decode(kindItems(round.round, id), entries);
    } else if (bodyKey !== undefined) {
      heldEntries[id] = { bodyKey, entries };
    }
  }
  for (const kind of next.kinds()) {
    const { id } = kind.spec;
    if (itemAnswers[id] === undefined) {
      itemAnswers[id] = kind.restore.decode(
        kindItems(round.round, id),
        heldEntries[id]?.entries ?? [],
      );
      delete heldEntries[id];
    }
  }
  const derived: RoundState = {
    ...round,
    kinds: next,
    itemAnswers,
    heldEntries,
  };
  return {
    ...derived,
    focus: keptPosition(
      railItems(derived),
      railItems(round)[round.focus],
      round.focus,
    ),
    reviewRow: keptPosition(
      answerableItems(derived),
      answerableItems(round)[round.reviewRow],
      round.reviewRow,
    ),
  };
}

// The position of `item` in `items`; when absent, `position` held to the last
// one.
function keptPosition<Item extends RailItem>(
  items: readonly Item[],
  item: Item | undefined,
  position: number,
): number {
  const kept =
    item === undefined
      ? -1
      : items.findIndex((candidate) => sameRailItem(candidate, item));
  return kept >= 0 ? kept : Math.min(position, Math.max(items.length - 1, 0));
}

function restorePlace(
  state: FormsState,
  formId: string,
  place: RoundPlace,
): FormsState {
  const { focus, reviewRow } = place;
  const placed = updateForm(state, formId, (round) => {
    const noticeLine = restoredNoticeLine(round, place.noticeLine);
    const isPlaceUnchanged =
      round.focus === focus &&
      round.reviewRow === reviewRow &&
      round.noticeLine === noticeLine;
    return isPlaceUnchanged
      ? round
      : { ...round, focus, reviewRow, noticeLine };
  });
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

// The saved line cursor held to the round's notices: 1 to their count, 0 with
// none.
function restoredNoticeLine(round: RoundState, line: number): number {
  const count = round.openNotices.length;
  return count === 0 ? 0 : Math.min(Math.max(line, 1), count);
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
  return placeReviewRow(state, (row, lastRow) =>
    Math.min(Math.max(row + step, 0), lastRow),
  );
}

// Sets the review cursor to the row `pick` returns from the cursor's row and
// the last answerable row; nothing outside the review.
function placeReviewRow(
  state: FormsState,
  pick: (row: number, lastRow: number) => number,
): FormsState {
  if (state.view !== 'review') {
    return state;
  }
  return updateForm(state, state.activeFormId, (round) => {
    const lastRow = Math.max(answerableItems(round).length - 1, 0);
    const row = pick(round.reviewRow, lastRow);
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
  const item = answerableItems(round)[target];
  if (item === undefined) {
    return state;
  }
  const jumped = updateForm(state, round.formId, (current) => ({
    ...current,
    reviewRow: target,
    focus: railPosition(current, item),
  }));
  return { ...jumped, view: 'forms' };
}

// Shows the item's card, or the notices page for the notices stop, and leaves
// the review cursor where it was.
function jumpToRailItem(state: FormsState, item: number): FormsState {
  const round = activeForm(state);
  if (state.view !== 'review' || round === null) {
    return state;
  }
  const isRailPosition = item >= 0 && item < railItems(round).length;
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
    case 'firstItem':
      return focusAt(round, 0);
    case 'lastItem':
      return focusAt(round, railItems(round).length - 1);
    case 'focusItem':
      return focusAt(round, action.item);
    case 'choose':
      return updateFocusedPick(round, (pick, item, answer) =>
        pick.choose(item, answer, action.number),
      );
    case 'clearChoice':
      return updateFocusedPick(round, (pick, item, answer) =>
        pick.clear(item, answer),
      );
    case 'acceptRecommendation':
      return updateFocusedPick(round, (pick, item, answer) =>
        pick.recommended(item, answer),
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
    case 'toggleNotice':
      return toggleNotice(round, action.notice);
    case 'moveNoticeLine':
      return moveNoticeLine(round, action.delta);
    case 'focusNotice':
      return focusNotice(round, action.notice);
  }
}

function isNoticeInRange(round: RoundState, notice: number): boolean {
  return notice >= 1 && notice <= round.openNotices.length;
}

// Not an edit: leaves `revision` as it is.
function toggleNotice(round: RoundState, notice: number): RoundState {
  if (!isNoticeInRange(round, notice)) {
    return round;
  }
  return {
    ...round,
    openNotices: round.openNotices.map((isOpen, i) =>
      i === notice - 1 ? !isOpen : isOpen,
    ),
  };
}

// A no-op at either end of the lines, or off the notices stop.
function moveNoticeLine(round: RoundState, delta: 1 | -1): RoundState {
  const line = round.noticeLine + delta;
  const focused = focusedItem(round);
  const isOnNoticesStop = focused !== null && isNoticesStop(focused);
  if (!isOnNoticesStop || !isNoticeInRange(round, line)) {
    return round;
  }
  return { ...round, noticeLine: line };
}

function focusNotice(round: RoundState, notice: number): RoundState {
  const focus = railPosition(round, { kind: 'notices' });
  if (!isNoticeInRange(round, notice) || focus < 0) {
    return round;
  }
  return focus === round.focus && notice === round.noticeLine
    ? round
    : { ...round, focus, noticeLine: notice };
}

function moveFocus(round: RoundState, step: number): RoundState {
  const lastItem = Math.max(railItems(round).length - 1, 0);
  const focus = Math.min(Math.max(round.focus + step, 0), lastItem);
  return focus === round.focus ? round : { ...round, focus };
}

function focusAt(round: RoundState, item: number): RoundState {
  const isRailPosition = item >= 0 && item < railItems(round).length;
  return isRailPosition && item !== round.focus
    ? { ...round, focus: item }
    : round;
}

// Picks the finding's entry `number` (1-based), choice and action together;
// the held entry again clears to no pick. Locked while not applicable, and a
// number past the last entry changes nothing.
export function chooseEntry(
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
export function clearFindingPick(answer: FindingAnswer): FindingAnswer {
  if (answer.notApplicable || holdsPick(answer, NO_PICK)) {
    return answer;
  }
  return { ...answer, ...NO_PICK };
}

export function holdsPick(answer: FindingAnswer, pick: FindingPick): boolean {
  return answer.choice === pick.choice && answer.action === pick.action;
}

// The focused stop as an answerable item; null on the notices stop, a kind
// with no answer, or no stop.
function focusedAnswerable(round: RoundState): AnswerableItem | null {
  const focused = focusedItem(round);
  if (focused === null || isNoticesStop(focused)) {
    return null;
  }
  return isAnswerable(round, focused)
    ? { kind: focused.kind, index: focused.index }
    : null;
}

// Applies `change` through the focused kind's pick rules while its answer
// applies; a no-op off an answerable stop, while not applicable, or when
// `change` returns the answer it was given.
function updateFocusedPick(
  round: RoundState,
  change: (
    pick: KindPick<unknown, unknown>,
    item: unknown,
    answer: unknown,
  ) => unknown,
): RoundState {
  const focused = focusedAnswerable(round);
  if (focused === null) {
    return round;
  }
  const { pick } = answerableKindOf(round, focused);
  const answer = kindAnswer(round, focused);
  if ((answer as ItemAnswer).notApplicable) {
    return round;
  }
  const next = change(pick, kindItem(round, focused), answer);
  return next === answer ? round : withItemAnswer(round, focused, next);
}

// A no-op off an answerable stop or when `change` returns the answer it was
// given; `change` keeps the answer's own fields, so a finding's action
// survives.
function updateFocusedAnswer(
  round: RoundState,
  change: <Answer extends ItemAnswer>(answer: Answer) => Answer,
): RoundState {
  const focused = focusedAnswerable(round);
  if (focused === null) {
    return round;
  }
  const answer = itemAnswer(round, focused);
  const next = change(answer);
  return next === answer ? round : withItemAnswer(round, focused, next);
}

function withItemAnswer(
  round: RoundState,
  item: RoundItem,
  answer: unknown,
): RoundState {
  const answers = round.itemAnswers[item.kind].map((current, i) =>
    i === item.index - 1 ? answer : current,
  );
  return {
    ...round,
    itemAnswers: { ...round.itemAnswers, [item.kind]: answers },
    revision: round.revision + 1,
  };
}

// The round note, or an item box's text through its kind's `reduce.withText`;
// a no-op for an item the round lacks or a kind with no registration.
function setText(
  round: RoundState,
  target: TextTarget,
  value: string,
): RoundState {
  if (!('item' in target)) {
    return value === round.note
      ? round
      : { ...round, note: value, revision: round.revision + 1 };
  }
  const { item, field } = target;
  const kind = round.kinds.get(item.kind);
  const answers = round.itemAnswers[item.kind];
  const isItem =
    kind !== undefined &&
    answers !== undefined &&
    item.index >= 1 &&
    item.index <= answers.length;
  if (!isItem) {
    return round;
  }
  const answer = answers[item.index - 1];
  if (kind.reduce.text(answer, field) === value) {
    return round;
  }
  return withItemAnswer(
    round,
    item,
    kind.reduce.withText(answer, field, value),
  );
}
