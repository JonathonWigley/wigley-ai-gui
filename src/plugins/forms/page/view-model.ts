import type { PluginLog } from '../../../contracts/log';
import {
  type SaveState,
  saveLabel,
  saveState,
} from '../../../shared/page/autosave';
import type { DotStatus } from '../../../shared/page/ui/status-dot';
import type {
  AnswerStatus,
  Finding,
  FindingAction,
  FormsScreen,
  ItemKind,
} from '../contract';
import type {
  PagerInput,
  RailFootInput,
  RailHeadInput,
} from '../layouts/layout';
import { activeForm, formById } from '../../../shared/page/session-forms';
import type { FormsAction, FormsState } from './form-state';
import {
  answerStatus,
  findingActionOf,
  findingActionWord,
  itemAnswer,
  pickIsComplete,
  pickNumber,
  type Progress,
  progress,
  unansweredItem,
} from './round-answers';
import {
  answerableItems,
  focusedItem,
  isNoticesStop,
  kindItems,
  type RailItem,
  railItems,
  railPosition,
  requireKind,
  type RoundState,
} from './round-model';
import { itemLabel } from './kinds/formats';

// One item of an answerable kind as the review lists it.
export interface ReviewRow {
  // 0-based, as `reviewJump` takes it.
  row: number;
  kind: ItemKind;
  // 1-based within its kind.
  number: number;
  label: string;
  title: string;
  status: AnswerStatus;
  // A finding's action while its pick is complete and it applies; '' otherwise,
  // whatever its notes, and on a question.
  action: FindingAction | '';
  // The finding card's word for `action`; '' with no action.
  actionLabel: string;
  // The pick's 1-based number down the card while the item's pick is
  // complete and it applies, else 0: the kind's `pick.number`.
  entry: number;
  // The choice the agent gets while the item's pick is complete and it
  // applies, else 0: the kind's `pick.choice`.
  choice: number;
  choiceText: string;
  tookRecommendation: boolean;
  tookActionRecommendation: boolean;
  // Whether the row earns its Recommended badge: a complete pick the kind's
  // `pick.isRecommended` accepts.
  recommended: boolean;
  notes: string;
  dontAsk: boolean;
  dontAskReason: string;
  isCursor: boolean;
}

// The answerable kinds' items, as answerableItems orders them.
export function reviewRows(round: RoundState): ReviewRow[] {
  return answerableItems(round).map((item, row): ReviewRow => {
    const kind = requireKind(round.kinds, item);
    const pick = kind.reduce.pick;
    if (pick === undefined) {
      throw new Error(`page kind ${item.kind} takes no answer`);
    }
    const kindItem = kindItems(round.round, item.kind)[item.index - 1];
    const answer = itemAnswer(round, item);
    const status = answerStatus(round, item);
    const isApplicable = status !== 'not_applicable';
    const pickCounts = isApplicable && pickIsComplete(round, item);
    const action = pickCounts ? findingActionOf(round, item) : '';
    const choice = pickCounts ? pick.choice(kindItem, answer) : 0;
    const recommend = pick.recommend(kindItem);
    const tookRecommendation = choice > 0 && choice === recommend;
    const tookActionRecommendation =
      action !== '' && action === (kindItem as Finding).recommend_action;
    return {
      row,
      kind: item.kind,
      number: item.index,
      label: itemLabel(round.kinds, item),
      title: kind.cardInput.title(kindItem),
      status,
      entry: pickCounts ? pickNumber(round, item) : 0,
      action,
      actionLabel:
        action === '' ? '' : (findingActionWord(round, item, action) ?? ''),
      choice,
      choiceText: choice > 0 ? pick.choiceText(kindItem, choice) : '',
      tookRecommendation,
      tookActionRecommendation,
      recommended: pickCounts && pick.isRecommended(kindItem, answer),
      notes: answer.notes,
      dontAsk: answer.dontAsk,
      dontAskReason: answer.dontAskReason,
      isCursor: row === round.reviewRow,
    };
  });
}

// The dot a rail entry shows for its item's status: answered is success, an
// untouched item the review flags is warning, and every other item, the
// notices stop and a stop of a kind with no answer (`none`) included, is idle.
export function railDotStatus(
  status: AnswerStatus | 'notices' | 'none',
  isFlagged: boolean,
): DotStatus {
  if (status === 'answered') {
    return 'success';
  }
  return status === 'untouched' && isFlagged ? 'warning' : 'idle';
}

// The round's status on its session's sidebar row: its heading and how many
// of its questions and findings are answered or not applicable.
export function sessionTitle(round: RoundState): string {
  const counts = progress(round);
  return `${round.round.heading} ${counts.answered + counts.notApplicable}/${counts.total}`;
}

export function progressText(progress: Progress): string {
  const answered = `${progress.answered} of ${progress.total} answered`;
  return progress.notApplicable > 0
    ? `${answered}, ${progress.notApplicable} not applicable`
    : answered;
}

// The review's summary line: the progress, and how many items are sent
// untouched when any are.
export function reviewSummaryText(counts: Progress): string {
  const untouched =
    counts.untouched > 0
      ? ` ${counts.untouched} not answered; they are sent as untouched.`
      : '';
  return `${progressText(counts)}.${untouched}`;
}

// The rail header's text: how many of the round's items are still untouched.
export function railHeadText(counts: Progress): string {
  return `Items · ${counts.untouched} open`;
}

// Whether an untouched item other than the focused one is left to jump to, as
// the unanswered keys need.
export function hasOtherUnanswered(round: RoundState): boolean {
  const item = unansweredItem(round, 1);
  return item !== null && railPosition(round, item) !== round.focus;
}

// The item pager's text: the focused stop's rail label of the rail's stop
// count; '' with no stop focused.
function pagerText(round: RoundState): string {
  const focused = focusedItem(round);
  return focused === null
    ? ''
    : `${railEntryLabel(round, focused)} of ${railItems(round).length}`;
}

// The `railHead` part's input: its text and the round's open and total
// counts.
export function railHeadInput(round: RoundState): RailHeadInput {
  const counts = progress(round);
  return {
    text: railHeadText(counts),
    open: counts.untouched,
    total: counts.total,
  };
}

// The `railFoot` part's input: the round's open and total counts.
export function railFootInput(round: RoundState): RailFootInput {
  const counts = progress(round);
  return { open: counts.untouched, total: counts.total };
}

// The `pager` part's input: its text, the focused stop's rail position (null
// with none focused) and the rail's stop count.
export function pagerInput(round: RoundState): PagerInput {
  return {
    text: pagerText(round),
    index: focusedItem(round) === null ? null : round.focus,
    total: railItems(round).length,
  };
}

// The rail entry's label: an item's number, the notice kind's rail prefix
// (`N`) for the notices stop.
export function railEntryLabel(round: RoundState, item: RailItem): string {
  return isNoticesStop(item)
    ? requireKind(round.kinds, { kind: 'notice', index: 1 }).cardInput
        .railPrefix
    : itemLabel(round.kinds, item);
}

// The rail entry's title: an item's title, `Notices · <count>` for the
// notices stop.
export function railEntryTitle(round: RoundState, item: RailItem): string {
  if (isNoticesStop(item)) {
    return `Notices · ${kindItems(round.round, 'notice').length}`;
  }
  const kindItem = kindItems(round.round, item.kind)[item.index - 1];
  return requireKind(round.kinds, item).cardInput.title(kindItem);
}

// The rail header's save text: `Sending…` while the round's finish is with
// main, else its save state.
export function roundSaveLabel(round: RoundState): string {
  return round.sending === null
    ? saveLabel(saveState(round), round.saveError)
    : 'Sending…';
}

// The rail header's save state, which colours its text; null while the
// round's finish is with main, so `Sending…` takes no save state's colour.
export function roundSaveState(round: RoundState): SaveState | null {
  return round.sending === null ? saveState(round) : null;
}

// Whether the review's rows differ from those drawn from `drawn`: a row reads
// only the round, its kinds, their answers and the review cursor. Null
// `drawn` is nothing drawn yet.
export function reviewRowsChanged(
  drawn: RoundState | null,
  current: RoundState,
): boolean {
  if (drawn === null) {
    return true;
  }
  return (
    drawn.round !== current.round ||
    drawn.kinds !== current.kinds ||
    drawn.itemAnswers !== current.itemAnswers ||
    drawn.reviewRow !== current.reviewRow
  );
}

// How a log line names a rail stop, e.g. `finding 2`, or `notices`.
export function itemName(item: RailItem): string {
  return isNoticesStop(item) ? 'notices' : `${item.kind} ${item.index}`;
}

// The log line a jump to `item` writes, by key or by rail click.
export function jumpedToLine(item: RailItem): string {
  return `jumped to ${itemName(item)}`;
}

// The log line a notice line's open or close writes; `notice` is 1-based.
export function noticeToggledLine(notice: number, isOpen: boolean): string {
  return `${isOpen ? 'opened' : 'closed'} notice ${notice}`;
}

// Opens or closes notice line `notice` on round `formId`, and logs it when that
// line's open state changed.
export function toggleNoticeLine(
  deps: {
    dispatch(action: FormsAction): void;
    getState(): FormsState;
    log: PluginLog;
  },
  formId: string,
  notice: number,
): void {
  const isOpenOn = (state: FormsState) =>
    formById(state, formId)?.openNotices[notice - 1];
  const wasOpen = isOpenOn(deps.getState());
  deps.dispatch({ type: 'toggleNotice', notice });
  const isOpen = isOpenOn(deps.getState());
  if (isOpen !== undefined && isOpen !== wasOpen) {
    deps.log(noticeToggledLine(notice, isOpen));
  }
}

// The log line a move of the notices stop's line cursor writes.
export function lineCursorLine(notice: number): string {
  return `line cursor on notice ${notice}`;
}

// Whether going from `before` to `after` moved the view or the active round's
// focused item: a jump that did neither is not logged.
export function jumpMoved(before: FormsState, after: FormsState): boolean {
  return (
    before.view !== after.view ||
    activeForm(before)?.focus !== activeForm(after)?.focus
  );
}

// A pick of the rail entry of `item`, at rail position `position`: dispatches
// its railPickAction and logs the jump when it moved the focus or the view,
// doing nothing when that action is null.
export function pickRailItem(
  deps: {
    dispatch(action: FormsAction): void;
    getState(): FormsState;
    log: PluginLog;
  },
  view: FormsScreen,
  item: RailItem,
  position: number,
  reviewRow: number | undefined,
): void {
  const action = railPickAction(view, position, reviewRow);
  if (action === null) {
    return;
  }
  const before = deps.getState();
  deps.dispatch(action);
  if (jumpMoved(before, deps.getState())) {
    deps.log(jumpedToLine(item));
  }
}

// Each rail position's review row; undefined at the notices stop and at a
// stop of a kind with no answer, which have none.
export function reviewRowsByRailPosition(
  round: RoundState,
): (number | undefined)[] {
  const rows: (number | undefined)[] = [];
  answerableItems(round).forEach((item, row) => {
    rows[railPosition(round, item)] = row;
  });
  return rows;
}

// What clicking a rail item does: focus it in the forms view; in the review,
// jump to its row's item, as Enter on the row does, or show the notices page,
// which has no row; null under the confirm, whose scrim takes the pointer, and
// with no round.
export function railPickAction(
  view: FormsScreen,
  position: number,
  reviewRow: number | undefined,
): FormsAction | null {
  switch (view) {
    case 'forms':
      return { type: 'focusItem', item: position };
    case 'review':
      return reviewRow === undefined
        ? { type: 'reviewJumpItem', item: position }
        : { type: 'reviewJump', row: reviewRow };
    case 'confirm':
    case 'idle':
      return null;
  }
}
