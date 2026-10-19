import type { VimMode } from '../../../contracts/editor';
import type { AnswerableKind, AnswerStatus, FindingAction } from '../contract';
import {
  type AnswerableItem,
  answerableItems,
  answerStatus,
  itemAnswer,
  type Progress,
  progress,
  type RoundState,
  type SaveState,
} from './form-state';
import { FINDING_ACTION_LABELS } from './kinds/finding/action-labels';
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
  // A finding's action while answered; '' otherwise, and on a question.
  action: FindingAction | '';
  actionLabel: string;
  // 0 unless answered; a not-applicable item's kept choice, and the solution
  // a finding left alone keeps, do not count.
  choice: number;
  choiceText: string;
  tookRecommendation: boolean;
  tookActionRecommendation: boolean;
  // What an untouched finding's picks still lack; null when it lacks both,
  // and on every question.
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

// How vim's status line names a visual mode's kind.
const VISUAL_KINDS: Partial<Record<string, string>> = {
  linewise: 'line',
  blockwise: 'block',
};

// Findings, then questions, as answerableItems orders them.
export function reviewRows(round: RoundState): ReviewRow[] {
  return answerableItems(round.round).map((item, row): ReviewRow => {
    const format = FORMATS[item.kind];
    const answer = itemAnswer(round, item);
    const status = answerStatus(round, item);
    const action = status === 'answered' ? findingActionOf(round, item) : '';
    const choice =
      status === 'answered' && action !== 'leave_it' ? answer.choice : 0;
    return {
      row,
      kind: item.kind,
      number: item.index,
      label: itemLabel(item),
      title: format.title(round.round, item.index),
      status,
      action,
      actionLabel: action === '' ? '' : FINDING_ACTION_LABELS[action],
      choice,
      choiceText:
        choice > 0
          ? format.choiceTexts(round.round, item.index)[choice - 1]
          : '',
      tookRecommendation:
        choice > 0 && choice === format.recommend(round.round, item.index),
      tookActionRecommendation:
        action !== '' &&
        action === round.round.findings[item.index - 1].recommend_action,
      missing: status === 'untouched' ? missingPick(round, item) : null,
      notes: answer.notes,
      dontAsk: answer.dontAsk,
      dontAskReason: answer.dontAskReason,
      isCursor: row === round.reviewRow,
    };
  });
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

// What an untouched item's picks lack: a solution among several for an
// action that needs one, or an action for a picked solution.
function missingPick(
  round: RoundState,
  item: AnswerableItem,
): ReviewRow['missing'] {
  if (item.kind !== 'finding') {
    return null;
  }
  const answer = round.findingAnswers[item.index - 1];
  const solutionCount = round.round.findings[item.index - 1].choices.length;
  const actionNeedsSolution =
    answer.action === 'fix_now' || answer.action === 'follow_up';
  if (actionNeedsSolution && solutionCount >= 2 && answer.choice === 0) {
    return 'solution';
  }
  return answer.choice > 0 && answer.action === '' ? 'action' : null;
}

// The round's title on its session's tab: its heading and how many of its
// questions and findings are answered or not applicable.
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

// The status line's mode: the focused box's vim mode as vim shows it, e.g.
// VISUAL LINE, or PAGE outside every box.
export function modeLabel(mode: VimMode | null): string {
  if (mode === null) {
    return 'PAGE';
  }
  const kind = VISUAL_KINDS[mode.subMode];
  const label = kind === undefined ? mode.mode : `${mode.mode} ${kind}`;
  return label.toUpperCase();
}
