import type { PresentedRound, RoundPlace } from '../contract';
import type { ReducerStore } from '../../../shared/page/reducer-store';
import {
  activeForm,
  createSessionFormsReducer,
  emptySessionForms,
  type SessionFormsAction,
  type SessionFormsState,
  updateForm,
} from '../../../shared/page/session-forms';
import type { PageKindTable } from './kinds/page-kinds';
import { type AnswerAction, applyAnswerAction, setText } from './round-answers';
import { rederiveRound, restoreRound } from './round-draft';
import {
  answerableItems,
  focusedItem,
  isNoticesStop,
  railItems,
  railPosition,
  type RoundState,
  type TextTarget,
} from './round-model';

// The open rounds and the view; the active round is the round of the session
// the sessions plugin focuses, or null when that session has none.
export type FormsState = SessionFormsState<RoundState, 'forms'>;

// Acts on the active round: its focused item, or the notice an action names.
export type ItemAction =
  | { type: 'nextItem' }
  | { type: 'prevItem' }
  | { type: 'firstItem' }
  | { type: 'lastItem' }
  // `item` is a rail position.
  | { type: 'focusItem'; item: number }
  | AnswerAction
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

// Every open round re-derived with `kinds`; `state` itself when every round
// already holds it.
function changeKinds(state: FormsState, kinds: PageKindTable): FormsState {
  const forms = state.forms.map((round) => rederiveRound(round, kinds));
  const isUnchanged = forms.every((round, i) => round === state.forms[i]);
  return isUnchanged ? state : { ...state, forms };
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
    case 'toggleNotice':
      return toggleNotice(round, action.notice);
    case 'moveNoticeLine':
      return moveNoticeLine(round, action.delta);
    case 'focusNotice':
      return focusNotice(round, action.notice);
    default:
      return applyAnswerAction(round, action);
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
