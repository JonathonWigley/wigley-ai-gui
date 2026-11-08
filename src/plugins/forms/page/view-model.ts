import type { PluginLog } from '../../../contracts/log';
import {
  type SaveState,
  saveLabel,
  saveState,
} from '../../../shared/page/autosave';
import type { DotStatus } from '../../../shared/page/ui/status-dot';
import type {
  AnswerableKind,
  AnswerStatus,
  FindingAction,
  FormsView,
} from '../contract';
import { activeForm } from '../../../shared/page/session-forms';
import { findingSolution } from '../finding-pick';
import {
  type AnswerableItem,
  answerableItems,
  answerStatus,
  findingActionOf,
  findingActionWord,
  type FormsAction,
  type FormsState,
  focusedItem,
  itemAnswer,
  pickIsComplete,
  pickNumber,
  type Progress,
  progress,
  type RailItem,
  railItems,
  railPosition,
  type RoundState,
  unansweredItem,
} from './form-state';
import { FORMATS, itemLabel } from './kinds/formats';

// One question or finding as the review lists it.
export interface ReviewRow {
  // 0-based, as `reviewJump` takes it.
  row: number;
  kind: AnswerableKind;
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
  // complete and it applies, else 0: a question's choice, a finding's entry.
  entry: number;
  // The choice the agent gets while the item's pick is complete and it
  // applies, else 0: on a finding, the solution findingSolution gives, 0 for
  // an action's header.
  choice: number;
  choiceText: string;
  tookRecommendation: boolean;
  tookActionRecommendation: boolean;
  // Whether the row earns its Recommended badge: a question whose choice is
  // its recommend; a finding whose pick is its recommend_action with its
  // recommend, or that action's header when recommend is null.
  recommended: boolean;
  notes: string;
  dontAsk: boolean;
  dontAskReason: string;
  isCursor: boolean;
}

// Findings, then questions, as answerableItems orders them.
export function reviewRows(round: RoundState): ReviewRow[] {
  return answerableItems(round.round).map((item, row): ReviewRow => {
    const format = FORMATS[item.kind];
    const answer = itemAnswer(round, item);
    const status = answerStatus(round, item);
    const isApplicable = status !== 'not_applicable';
    const pickCounts = isApplicable && pickIsComplete(round, item);
    const action = pickCounts ? findingActionOf(round, item) : '';
    const choice = pickCounts ? pickedChoice(round, item) : 0;
    const recommend = format.recommend(round.round, item.index);
    const tookRecommendation = choice > 0 && choice === recommend;
    const tookActionRecommendation =
      action !== '' &&
      action === round.round.findings[item.index - 1].recommend_action;
    return {
      row,
      kind: item.kind,
      number: item.index,
      label: itemLabel(item),
      title: format.title(round.round, item.index),
      status,
      entry: pickCounts ? pickNumber(round, item) : 0,
      action,
      actionLabel:
        action === '' ? '' : (findingActionWord(round, item, action) ?? ''),
      choice,
      choiceText:
        choice > 0
          ? format.choiceTexts(round.round, item.index)[choice - 1]
          : '',
      tookRecommendation,
      tookActionRecommendation,
      recommended:
        action === ''
          ? item.kind === 'question' && tookRecommendation
          : tookActionRecommendation && choice === recommend,
      notes: answer.notes,
      dontAsk: answer.dontAsk,
      dontAskReason: answer.dontAskReason,
      isCursor: row === round.reviewRow,
    };
  });
}

// The choice the agent gets for an item whose pick is complete: a question's
// choice, or a finding's solution.
function pickedChoice(round: RoundState, item: AnswerableItem): number {
  if (item.kind === 'question') {
    return round.answers[item.index - 1].choice;
  }
  const answer = round.findingAnswers[item.index - 1];
  const finding = round.round.findings[item.index - 1];
  return findingSolution(finding, answer.choice, answer.action);
}

// The dot a rail entry shows for its item's status: answered is success, an
// untouched item the review flags is warning, and every other item is idle.
export function railDotStatus(
  status: AnswerStatus | 'notice',
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
  return item !== null && railPosition(round.round, item) !== round.focus;
}

// The item pager's text: the focused item's label of the rail's item count;
// '' with no item focused.
export function pagerText(round: RoundState): string {
  const focused = focusedItem(round);
  return focused === null
    ? ''
    : `${itemLabel(focused)} of ${railItems(round.round).length}`;
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
// only the round, its answers, its finding answers and the review cursor.
// Null `drawn` is nothing drawn yet.
export function reviewRowsChanged(
  drawn: RoundState | null,
  current: RoundState,
): boolean {
  if (drawn === null) {
    return true;
  }
  return (
    drawn.round !== current.round ||
    drawn.answers !== current.answers ||
    drawn.findingAnswers !== current.findingAnswers ||
    drawn.reviewRow !== current.reviewRow
  );
}

// How a log line names an item, e.g. `finding 2`.
export function itemName(item: RailItem): string {
  return `${item.kind} ${item.index}`;
}

// The log line a jump to `item` writes, by key or by rail click.
export function jumpedToLine(item: RailItem): string {
  return `jumped to ${itemName(item)}`;
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
  view: FormsView,
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

// Each rail position's review row; undefined at a notice, which has none.
export function reviewRowsByRailPosition(
  round: RoundState,
): (number | undefined)[] {
  const rows: (number | undefined)[] = [];
  answerableItems(round.round).forEach((item, row) => {
    rows[railPosition(round.round, item)] = row;
  });
  return rows;
}

// What clicking a rail item does: focus it in the forms view; in the review,
// jump to its row's item, as Enter on the row does, or show a notice's card,
// which has no row; null under the confirm, whose scrim takes the pointer, and
// with no round.
export function railPickAction(
  view: FormsView,
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
