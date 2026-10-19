import type { VimMode } from '../../../contracts/editor';
import type { AnswerableKind, AnswerStatus, FindingAction } from '../contract';
import { actionLabel } from '../finding-origins';
import { findingSolution } from '../finding-pick';
import {
  type AnswerableItem,
  answerableItems,
  answerStatus,
  findingActionOf,
  itemAnswer,
  pickIsComplete,
  type Progress,
  progress,
  type RoundState,
  type SaveState,
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
        action === ''
          ? ''
          : (actionLabel(round.round.findings[item.index - 1].origin, action) ??
            ''),
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
