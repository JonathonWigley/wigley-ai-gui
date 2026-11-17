import {
  type DraftRevisions,
  finishSave,
  startSave,
} from '../../../shared/page/autosave';
import type { JudgeResult, OpenedProblem, SubmissionRecord } from '../contract';

// The problem pane's tabs and the console's, in the order `gt` cycles them.
export type ProblemTab = 'description' | 'submissions' | 'notes' | 'solution';
export type ConsoleTab = 'testcase' | 'result';
export const PROBLEM_TABS: readonly ProblemTab[] = [
  'description',
  'submissions',
  'notes',
  'solution',
];
export const CONSOLE_TABS: readonly ConsoleTab[] = ['testcase', 'result'];

// The user's three files the workspace saves: `solution.cpp`, `notes.md` and
// `custom-cases.json`.
export type DraftId = 'code' | 'notes' | 'customCases';
export const DRAFT_IDS: readonly DraftId[] = ['code', 'notes', 'customCases'];

// One file's text as the user edits it; `slug` names its problem.
export interface Draft extends DraftRevisions {
  id: DraftId;
  slug: string;
  text: string;
}

// The Solution tab's peek: none held, the confirm asked, `peek` in flight, or
// its answer held until the next open.
export type PeekState =
  | { status: 'none' }
  | { status: 'asked' }
  | { status: 'fetching' }
  | { status: 'held'; approach: string; reference: string };

// The last Run or Submit: none yet, in flight, its result, or the failed
// invoke's error.
export type JudgeState =
  | { state: 'empty' }
  | { state: 'running'; kind: JudgeKind }
  | { state: 'done'; kind: JudgeKind; result: JudgeResult }
  | { state: 'failed'; kind: JudgeKind; message: string };

export type JudgeKind = 'run' | 'submit';

// The open problem's workspace; `problem` null until the first open.
// `submissionCursor` indexes the submissions newest first; `isSubmissionOpen`
// shows the cursor row's code in place of the rows.
export interface WorkspaceState {
  problem: OpenedProblem | null;
  problemTab: ProblemTab;
  consoleTab: ConsoleTab;
  submissionCursor: number;
  isSubmissionOpen: boolean;
  peek: PeekState;
  judge: JudgeState;
  drafts: Record<DraftId, Draft>;
}

export type WorkspaceAction =
  // An open: every tab, the result, the cursor and the peek start over, and
  // each draft holds the opened text, saved.
  | {
      type: 'opened';
      problem: OpenedProblem;
      problemTab: Exclude<ProblemTab, 'solution'>;
      consoleTab: ConsoleTab;
    }
  // The shown problem read again, with `mark` taken as the read began: each
  // draft saved then and not saved since takes the new text.
  | { type: 'refreshed'; problem: OpenedProblem; mark: DraftMark }
  | { type: 'nextTab'; pane: 'problem' | 'console' }
  | { type: 'prevTab'; pane: 'problem' | 'console' }
  | { type: 'showTab'; tab: ProblemTab | ConsoleTab }
  | { type: 'confirmYes' }
  | { type: 'confirmNo' }
  | { type: 'peeked'; approach: string; reference: string }
  | { type: 'peekFailed' }
  | { type: 'moveCursor'; to: 'down' | 'up' | 'top' | 'bottom' }
  // Shows the cursor row's code, or with `time` the code of that row.
  | { type: 'openSubmission'; time: string | null }
  | { type: 'closeSubmission' }
  | { type: 'draftChanged'; id: DraftId; slug: string; text: string }
  | { type: 'saveStarted'; id: DraftId; slug: string; revision: number }
  | {
      type: 'saveFinished';
      id: DraftId;
      slug: string;
      revision: number;
      error: string | null;
    }
  | { type: 'judgeStarted'; kind: JudgeKind }
  | { type: 'judgeDone'; slug: string; result: JudgeResult }
  | { type: 'judgeFailed'; slug: string; message: string };

// The slug the workspace showed and each draft's `savedRevision`, as a read
// of the problem began.
export interface DraftMark {
  readonly slug: string | null;
  readonly savedRevisions: Readonly<Record<DraftId, number>>;
}

export function draftMark(state: WorkspaceState): DraftMark {
  return {
    slug: state.problem?.summary.slug ?? null,
    savedRevisions: {
      code: state.drafts.code.savedRevision,
      notes: state.drafts.notes.savedRevision,
      customCases: state.drafts.customCases.savedRevision,
    },
  };
}

export function initialWorkspaceState(): WorkspaceState {
  return {
    problem: null,
    problemTab: 'description',
    consoleTab: 'testcase',
    submissionCursor: 0,
    isSubmissionOpen: false,
    peek: { status: 'none' },
    judge: { state: 'empty' },
    drafts: {
      code: savedDraft('code', '', ''),
      notes: savedDraft('notes', '', ''),
      customCases: savedDraft('customCases', '', ''),
    },
  };
}

// The problem's submissions, newest first by their ISO 8601 `time`.
export function submissionsNewestFirst(
  submissions: readonly SubmissionRecord[],
): SubmissionRecord[] {
  return [...submissions].sort((a, b) => b.time.localeCompare(a.time));
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'opened':
      return opened(action.problem, action.problemTab, action.consoleTab);
    case 'refreshed':
      return refreshed(state, action.problem, action.mark);
    case 'nextTab':
    case 'prevTab':
      return cycledTab(state, action.pane, action.type === 'nextTab' ? 1 : -1);
    case 'showTab':
      return isConsoleTab(action.tab)
        ? withConsoleTab(state, action.tab)
        : withProblemTab(state, action.tab);
    case 'confirmYes':
      return state.peek.status === 'asked'
        ? { ...state, peek: { status: 'fetching' } }
        : state;
    case 'confirmNo':
      return state.peek.status === 'asked'
        ? { ...state, peek: { status: 'none' } }
        : state;
    case 'peeked':
      return {
        ...state,
        problemTab: 'solution',
        peek: {
          status: 'held',
          approach: action.approach,
          reference: action.reference,
        },
      };
    case 'peekFailed':
      return state.peek.status === 'fetching'
        ? { ...state, peek: { status: 'none' } }
        : state;
    case 'moveCursor':
      return movedCursor(state, action.to);
    case 'openSubmission':
      return openedSubmission(state, action.time);
    case 'closeSubmission':
      return state.isSubmissionOpen
        ? { ...state, isSubmissionOpen: false }
        : state;
    case 'draftChanged':
      return withDraft(state, action.id, action.slug, (draft) =>
        draft.text === action.text
          ? draft
          : { ...draft, text: action.text, revision: draft.revision + 1 },
      );
    case 'saveStarted':
      return withDraft(state, action.id, action.slug, (draft) =>
        startSave(draft, action.revision),
      );
    case 'saveFinished':
      return withDraft(state, action.id, action.slug, (draft) =>
        finishSave(draft, action.revision, action.error),
      );
    case 'judgeStarted':
      return state.judge.state === 'running'
        ? state
        : {
            ...state,
            consoleTab: 'result',
            judge: { state: 'running', kind: action.kind },
          };
    case 'judgeDone':
    case 'judgeFailed':
      return judged(state, action);
  }
}

function opened(
  problem: OpenedProblem,
  problemTab: Exclude<ProblemTab, 'solution'>,
  consoleTab: ConsoleTab,
): WorkspaceState {
  const slug = problem.summary.slug;
  return {
    problem,
    problemTab,
    consoleTab,
    submissionCursor: 0,
    isSubmissionOpen: false,
    peek: { status: 'none' },
    judge: { state: 'empty' },
    drafts: {
      code: savedDraft('code', slug, problem.code),
      notes: savedDraft('notes', slug, problem.notes),
      customCases: savedDraft('customCases', slug, problem.customCases),
    },
  };
}

function savedDraft(id: DraftId, slug: string, text: string): Draft {
  return {
    id,
    slug,
    text,
    revision: 0,
    savingRevision: null,
    savedRevision: 0,
    saveError: null,
  };
}

// The problem read again; another slug than the shown one changes nothing. A
// draft takes the read's text only while it is saved and its save is the one
// `mark` holds, so neither an unsaved edit nor a save that landed during the
// read is overwritten. A mark of another problem keeps every draft's text.
function refreshed(
  state: WorkspaceState,
  problem: OpenedProblem,
  mark: DraftMark,
): WorkspaceState {
  if (state.problem?.summary.slug !== problem.summary.slug) {
    return state;
  }
  const texts: Record<DraftId, string> = {
    code: problem.code,
    notes: problem.notes,
    customCases: problem.customCases,
  };
  const isMarkOfThisProblem = mark.slug === problem.summary.slug;
  const drafts = { ...state.drafts };
  for (const id of DRAFT_IDS) {
    const draft = drafts[id];
    const isSaved = draft.savedRevision === draft.revision;
    const isSavedDuringRead = draft.savedRevision !== mark.savedRevisions[id];
    const takesRead =
      isSaved &&
      isMarkOfThisProblem &&
      !isSavedDuringRead &&
      draft.text !== texts[id];
    if (takesRead) {
      drafts[id] = { ...draft, text: texts[id] };
    }
  }
  const rowCount = problem.submissions.length;
  return {
    ...state,
    problem,
    drafts,
    submissionCursor: Math.max(
      Math.min(state.submissionCursor, rowCount - 1),
      0,
    ),
  };
}

function isConsoleTab(tab: ProblemTab | ConsoleTab): tab is ConsoleTab {
  return (CONSOLE_TABS as readonly string[]).includes(tab);
}

// `pane`'s tab `step` places on, wrapping; the Solution tab goes through the
// peek rule.
function cycledTab(
  state: WorkspaceState,
  pane: 'problem' | 'console',
  step: 1 | -1,
): WorkspaceState {
  if (pane === 'console') {
    return withConsoleTab(state, stepped(CONSOLE_TABS, state.consoleTab, step));
  }
  return withProblemTab(state, stepped(PROBLEM_TABS, state.problemTab, step));
}

function stepped<T>(tabs: readonly T[], from: T, step: 1 | -1): T {
  const at = tabs.indexOf(from);
  return tabs[(at + step + tabs.length) % tabs.length];
}

function withConsoleTab(
  state: WorkspaceState,
  tab: ConsoleTab,
): WorkspaceState {
  return state.consoleTab === tab ? state : { ...state, consoleTab: tab };
}

// Shows `tab`. The Solution tab shows only while a peek is held; else it asks
// first, or fetches at once when the attempt has peeked already, keeping the
// shown tab until the peek lands.
function withProblemTab(
  state: WorkspaceState,
  tab: ProblemTab,
): WorkspaceState {
  const isPeekNeeded = tab === 'solution' && state.peek.status !== 'held';
  if (!isPeekNeeded) {
    return state.problemTab === tab ? state : { ...state, problemTab: tab };
  }
  if (state.peek.status !== 'none') {
    return state;
  }
  const hasPeeked = state.problem?.attempt.peeked === true;
  return {
    ...state,
    peek: { status: hasPeeked ? 'fetching' : 'asked' },
  };
}

// One row down or up, held at the ends, or to the first or last row.
function movedCursor(
  state: WorkspaceState,
  to: 'down' | 'up' | 'top' | 'bottom',
): WorkspaceState {
  const last = (state.problem?.submissions.length ?? 0) - 1;
  if (last < 0) {
    return state;
  }
  let cursor: number;
  switch (to) {
    case 'down':
      cursor = Math.min(state.submissionCursor + 1, last);
      break;
    case 'up':
      cursor = Math.max(state.submissionCursor - 1, 0);
      break;
    case 'top':
      cursor = 0;
      break;
    case 'bottom':
      cursor = last;
      break;
  }
  return cursor === state.submissionCursor
    ? state
    : { ...state, submissionCursor: cursor };
}

// Shows the code of the row `time` names, or of the cursor row; a time no
// row holds, or no rows, changes nothing.
function openedSubmission(
  state: WorkspaceState,
  time: string | null,
): WorkspaceState {
  const rows = submissionsNewestFirst(state.problem?.submissions ?? []);
  const cursor =
    time === null
      ? state.submissionCursor
      : rows.findIndex((row) => row.time === time);
  if (rows[cursor] === undefined) {
    return state;
  }
  return {
    ...state,
    problemTab: 'submissions',
    submissionCursor: cursor,
    isSubmissionOpen: true,
  };
}

// `state` with draft `id` changed by `change`, while `slug` is the shown
// problem's.
function withDraft(
  state: WorkspaceState,
  id: DraftId,
  slug: string,
  change: (draft: Draft) => Draft,
): WorkspaceState {
  const draft = state.drafts[id];
  if (draft.slug !== slug) {
    return state;
  }
  const next = change(draft);
  return next === draft
    ? state
    : { ...state, drafts: { ...state.drafts, [id]: next } };
}

function judged(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'judgeDone' | 'judgeFailed' }>,
): WorkspaceState {
  const { judge } = state;
  const isShownRun =
    judge.state === 'running' && state.problem?.summary.slug === action.slug;
  if (!isShownRun) {
    return state;
  }
  return {
    ...state,
    judge:
      action.type === 'judgeDone'
        ? { state: 'done', kind: judge.kind, result: action.result }
        : { state: 'failed', kind: judge.kind, message: action.message },
  };
}
