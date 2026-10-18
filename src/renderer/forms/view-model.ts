import type { AnswerStatus } from '../../contracts/forms';
import {
  type FormsState,
  type FormsView,
  type Progress,
  questionStatus,
  type RoundState,
  type SaveState,
} from './form-state';

// One question as the review lists it.
export interface ReviewRow {
  // 0-based, as `reviewJump` takes it.
  row: number;
  number: number;
  title: string;
  status: AnswerStatus;
  // 0 unless answered; a not-applicable question's kept choice does not count.
  choice: number;
  choiceText: string;
  tookRecommendation: boolean;
  what: string;
  why: string;
  dontAsk: boolean;
  dontAskReason: string;
  isCursor: boolean;
}

const STATUS_LABELS: Record<AnswerStatus, string> = {
  answered: 'Answered',
  not_applicable: 'Not applicable',
  untouched: 'Not answered',
};

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved',
};

export function reviewRows(round: RoundState): ReviewRow[] {
  return round.round.questions.map((question, row): ReviewRow => {
    const answer = round.answers[row];
    const status = questionStatus(answer);
    const choice = status === 'answered' ? answer.choice : 0;
    return {
      row,
      number: row + 1,
      title: question.title,
      status,
      choice,
      choiceText: choice > 0 ? question.choices[choice - 1] : '',
      tookRecommendation: choice > 0 && choice === question.recommend,
      what: answer.what,
      why: answer.why,
      dontAsk: answer.dontAsk,
      dontAskReason: answer.dontAskReason,
      isCursor: row === round.reviewRow,
    };
  });
}

// The view the page shows under the help overlay: the one help returns to.
export function baseView(state: FormsState): FormsView {
  return state.view === 'help' ? state.helpReturnView : state.view;
}

export function progressText(progress: Progress): string {
  const answered = `${progress.answered} of ${progress.total} answered`;
  return progress.notApplicable > 0
    ? `${answered}, ${progress.notApplicable} not applicable`
    : answered;
}

export function statusLabel(status: AnswerStatus): string {
  return STATUS_LABELS[status];
}

export function saveLabel(state: SaveState): string {
  return SAVE_LABELS[state];
}

// The status line's mode: the focused box's vim mode, or PAGE outside every box.
export function modeLabel(mode: string | null): string {
  return mode === null ? 'PAGE' : mode.toUpperCase();
}
