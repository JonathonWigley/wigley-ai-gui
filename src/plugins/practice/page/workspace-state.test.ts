import { describe, expect, it } from 'vitest';
import type { OpenedProblem, SubmissionRecord } from '../contract';
import {
  type ConsoleTab,
  draftMark,
  initialWorkspaceState,
  type PeekState,
  type ProblemTab,
  type WorkspaceAction,
  type WorkspaceState,
  workspaceReducer,
} from './workspace-state';

const SLUG = 'two-sum';

function submission(time: string): SubmissionRecord {
  return {
    time,
    verdict: 'wrongAnswer',
    passed: 1,
    total: 3,
    ms: 12,
    failing: null,
    code: '',
  };
}

function problem(
  fields: { peeked?: boolean; notes?: string; submissions?: string[] } = {},
): OpenedProblem {
  return {
    summary: {
      slug: SLUG,
      title: 'Two Sum',
      difficulty: 'easy',
      tags: [],
      lists: [],
      status: 'attempted',
      due: false,
    },
    statement: '',
    signature: { kind: 'function', method: 'f', params: [], returns: 'int' },
    code: 'int f();',
    notes: fields.notes ?? 'old notes',
    customCases: '[]',
    attempt: {
      id: 'a1',
      started: '2026-01-01T00:00:00Z',
      peeked: fields.peeked ?? false,
      interviewer: null,
    },
    submissions: (fields.submissions ?? []).map(submission),
  };
}

// A workspace just opened on `opened`, then changed by `actions`.
function stateAfter(
  actions: readonly WorkspaceAction[],
  opened: OpenedProblem = problem(),
): WorkspaceState {
  return actions.reduce(
    workspaceReducer,
    workspaceReducer(initialWorkspaceState(), {
      type: 'opened',
      problem: opened,
      problemTab: 'description',
      consoleTab: 'testcase',
    }),
  );
}

const HELD: PeekState = { status: 'held', approach: 'a', reference: 'r' };

describe('workspaceReducer', () => {
  it.each<{
    case: string;
    tab: ProblemTab;
    peek: PeekState;
    action: WorkspaceAction;
    shown: ProblemTab;
    peekStatus: PeekState['status'];
  }>([
    {
      case: 'next from description',
      tab: 'description',
      peek: { status: 'none' },
      action: { type: 'nextTab', pane: 'problem' },
      shown: 'submissions',
      peekStatus: 'none',
    },
    {
      case: 'next from notes, no peek held',
      tab: 'notes',
      peek: { status: 'none' },
      action: { type: 'nextTab', pane: 'problem' },
      shown: 'notes',
      peekStatus: 'asked',
    },
    {
      case: 'next from solution wraps',
      tab: 'solution',
      peek: HELD,
      action: { type: 'nextTab', pane: 'problem' },
      shown: 'description',
      peekStatus: 'held',
    },
    {
      case: 'previous from description, peek held',
      tab: 'description',
      peek: HELD,
      action: { type: 'prevTab', pane: 'problem' },
      shown: 'solution',
      peekStatus: 'held',
    },
  ])(
    'cycles the problem tabs: $case',
    ({ tab, peek, action, shown, peekStatus }) => {
      const before: WorkspaceState = {
        ...stateAfter([]),
        problemTab: tab,
        peek,
      };

      const next = workspaceReducer(before, action);

      expect(next.problemTab).toBe(shown);
      expect(next.peek.status).toBe(peekStatus);
    },
  );

  it('fetches the solution with no prompt once the attempt has peeked', () => {
    const next = stateAfter(
      [{ type: 'showTab', tab: 'solution' }],
      problem({ peeked: true }),
    );

    expect(next.peek.status).toBe('fetching');
    expect(next.problemTab).toBe('description');
  });

  it.each<{ from: ConsoleTab; type: 'nextTab' | 'prevTab'; to: ConsoleTab }>([
    { from: 'testcase', type: 'nextTab', to: 'result' },
    { from: 'result', type: 'nextTab', to: 'testcase' },
    { from: 'testcase', type: 'prevTab', to: 'result' },
    { from: 'result', type: 'prevTab', to: 'testcase' },
  ])('cycles the console tabs: $type from $from', ({ from, type, to }) => {
    const before: WorkspaceState = { ...stateAfter([]), consoleTab: from };

    expect(workspaceReducer(before, { type, pane: 'console' }).consoleTab).toBe(
      to,
    );
  });

  it.each<{
    case: string;
    action: WorkspaceAction;
    shown: ProblemTab;
    peek: PeekState;
  }>([
    {
      case: 'keep solving',
      action: { type: 'confirmNo' },
      shown: 'notes',
      peek: { status: 'none' },
    },
    {
      case: 'the answer landed',
      action: { type: 'peeked', approach: 'a', reference: 'r' },
      shown: 'solution',
      peek: HELD,
    },
  ])('answers the peek prompt: $case', ({ action, shown, peek }) => {
    const asked = stateAfter([
      { type: 'showTab', tab: 'notes' },
      { type: 'showTab', tab: 'solution' },
    ]);

    const next = workspaceReducer(asked, action);

    expect(next.problemTab).toBe(shown);
    expect(next.peek).toEqual(peek);
  });

  it.each<{
    case: string;
    edits: readonly WorkspaceAction[];
    duringRead: readonly WorkspaceAction[];
    markedSlug: string;
    diskNotes: string;
    notes: string;
    isSameDraft: boolean;
  }>([
    {
      case: 'a saved draft takes the new text',
      edits: [],
      duringRead: [],
      markedSlug: SLUG,
      diskNotes: 'new notes',
      notes: 'new notes',
      isSameDraft: false,
    },
    {
      case: 'an unsaved draft is kept',
      edits: [{ type: 'draftChanged', id: 'notes', slug: SLUG, text: 'typed' }],
      duringRead: [],
      markedSlug: SLUG,
      diskNotes: 'new notes',
      notes: 'typed',
      isSameDraft: true,
    },
    {
      case: 'the same text changes nothing',
      edits: [],
      duringRead: [],
      markedSlug: SLUG,
      diskNotes: 'old notes',
      notes: 'old notes',
      isSameDraft: true,
    },
    {
      case: 'a draft saved during the read keeps its text',
      edits: [
        { type: 'draftChanged', id: 'notes', slug: SLUG, text: 'typed' },
        { type: 'saveStarted', id: 'notes', slug: SLUG, revision: 1 },
      ],
      duringRead: [
        {
          type: 'saveFinished',
          id: 'notes',
          slug: SLUG,
          revision: 1,
          error: null,
        },
      ],
      markedSlug: SLUG,
      diskNotes: 'old notes',
      notes: 'typed',
      isSameDraft: true,
    },
    {
      case: 'a draft saved before the read takes the new text',
      edits: [
        { type: 'draftChanged', id: 'notes', slug: SLUG, text: 'typed' },
        { type: 'saveStarted', id: 'notes', slug: SLUG, revision: 1 },
        {
          type: 'saveFinished',
          id: 'notes',
          slug: SLUG,
          revision: 1,
          error: null,
        },
      ],
      duringRead: [],
      markedSlug: SLUG,
      diskNotes: 'new notes',
      notes: 'new notes',
      isSameDraft: false,
    },
    {
      case: 'a mark of another problem keeps a saved draft',
      edits: [],
      duringRead: [],
      markedSlug: 'other-problem',
      diskNotes: 'new notes',
      notes: 'old notes',
      isSameDraft: true,
    },
  ])(
    'refresh keeps unsaved drafts: $case',
    ({ edits, duringRead, markedSlug, diskNotes, notes, isSameDraft }) => {
      const before = stateAfter(edits);
      const mark = { ...draftMark(before), slug: markedSlug };
      const atRead = duringRead.reduce(workspaceReducer, before);

      const next = workspaceReducer(atRead, {
        type: 'refreshed',
        problem: problem({ notes: diskNotes }),
        mark,
      });

      expect(next.drafts.notes.text).toBe(notes);
      expect(next.drafts.notes === atRead.drafts.notes).toBe(isSameDraft);
    },
  );

  it.each<{
    case: string;
    cursor: number;
    to: 'down' | 'up' | 'top' | 'bottom';
    moved: number;
  }>([
    { case: 'down at the last row stays', cursor: 2, to: 'down', moved: 2 },
    { case: 'top', cursor: 2, to: 'top', moved: 0 },
    { case: 'down', cursor: 0, to: 'down', moved: 1 },
  ])('moves the submission cursor: $case', ({ cursor, to, moved }) => {
    const before: WorkspaceState = {
      ...stateAfter(
        [],
        problem({
          submissions: [
            '2026-01-01T00:00:00Z',
            '2026-01-02T00:00:00Z',
            '2026-01-03T00:00:00Z',
          ],
        }),
      ),
      submissionCursor: cursor,
    };

    expect(
      workspaceReducer(before, { type: 'moveCursor', to }).submissionCursor,
    ).toBe(moved);
  });

  it('holds one judge call', () => {
    const running = stateAfter([{ type: 'judgeStarted', kind: 'run' }]);

    expect(
      workspaceReducer(running, { type: 'judgeStarted', kind: 'submit' }),
    ).toBe(running);
  });
});
