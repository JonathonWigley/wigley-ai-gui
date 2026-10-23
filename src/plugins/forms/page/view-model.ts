import type { Log } from '../../../contracts/log';
import type { DotStatus } from '../../../shared/page/ui/status-dot';
import type { AnswerableKind, AnswerStatus, FindingAction } from '../contract';
import { findingSolution } from '../finding-pick';
import {
  activeRound,
  type AnswerableItem,
  answerableItems,
  answerStatus,
  findingActionOf,
  findingActionWord,
  type FormsAction,
  type FormsState,
  type FormsView,
  itemAnswer,
  pickIsComplete,
  type Progress,
  progress,
  type RailItem,
  type RoundState,
  type SaveState,
  saveState,
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
  // The choice the agent gets while the item's pick is complete and it
  // applies, else 0: on a finding, the solution findingSolution gives.
  choice: number;
  choiceText: string;
  tookRecommendation: boolean;
  tookActionRecommendation: boolean;
  // Whether the row earns its Recommended badge: a finding's for its action,
  // and for its solution unless left alone; a question's for its choice.
  recommended: boolean;
  // What an applicable finding's incomplete pick still lacks, whatever its
  // notes; null when it lacks both, when the pick is complete, and on every
  // question.
  missing: 'solution' | 'action' | null;
  notes: string;
  dontAsk: boolean;
  dontAskReason: string;
  isCursor: boolean;
}

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved',
};

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
    const tookRecommendation =
      choice > 0 && choice === format.recommend(round.round, item.index);
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
      recommended: tookEveryRecommendation(
        item.kind,
        action,
        tookRecommendation,
        tookActionRecommendation,
      ),
      missing: isApplicable && !pickCounts ? missingPick(round, item) : null,
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
  const solutionCount = round.round.findings[item.index - 1].choices.length;
  return findingSolution(solutionCount, answer.choice, answer.action);
}

// A finding left alone needs only its action recommendation; one fixed or
// followed up needs both; a row with no action earns it only as a question.
function tookEveryRecommendation(
  kind: AnswerableKind,
  action: FindingAction | '',
  tookRecommendation: boolean,
  tookActionRecommendation: boolean,
): boolean {
  if (action === 'leave_it') {
    return tookActionRecommendation;
  }
  if (action === '') {
    return kind === 'question' && tookRecommendation;
  }
  return tookRecommendation && tookActionRecommendation;
}

// What an item's incomplete pick lacks: on a finding, an action still needs a
// solution, and a solution with no action needs an action.
function missingPick(
  round: RoundState,
  item: AnswerableItem,
): ReviewRow['missing'] {
  if (item.kind !== 'finding') {
    return null;
  }
  const answer = round.findingAnswers[item.index - 1];
  if (answer.action !== '') {
    return 'solution';
  }
  return answer.choice > 0 ? 'action' : null;
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

// `error` is the last failed save's message, shown while the round is unsaved.
export function saveLabel(state: SaveState, error: string | null): string {
  const hasError = state === 'unsaved' && error !== null;
  return hasError ? `${SAVE_LABELS[state]} — ${error}` : SAVE_LABELS[state];
}

// The status line's save text: `Sending…` while the round's finish is with
// main, else its save state.
export function roundSaveLabel(round: RoundState): string {
  return round.sending === null
    ? saveLabel(saveState(round), round.saveError)
    : 'Sending…';
}

// The status line's save state, which colours its text; null while the
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
    activeRound(before)?.focus !== activeRound(after)?.focus
  );
}

// A click on the rail entry of `item`, at rail position `position`: dispatches
// its railPickAction and logs the jump when it moved the focus or the view,
// doing nothing when that action is null.
export function pickRailItem(
  deps: {
    dispatch(action: FormsAction): void;
    getState(): FormsState;
    log: Log;
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
    deps.log('forms', jumpedToLine(item));
  }
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
