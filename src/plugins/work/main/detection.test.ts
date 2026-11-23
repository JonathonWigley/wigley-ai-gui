import { describe, expect, it } from 'vitest';
import type {
  WorkCard,
  WorkColumnSetting,
  WorkSignalSetting,
  WorkSuggestion,
} from '../contract';
import { jiraCard, localCard } from '../contract.test-support';
import {
  commitKeyPattern,
  detectSuggestions,
  type SeenSignal,
  signalKeys,
} from './detection';
import type { SavedSuggestion, WorkNotYet } from './store';

const COLUMNS: WorkColumnSetting[] = [
  { name: 'Backlog', jiraStatuses: ['Backlog'] },
  { name: 'Todo', jiraStatuses: ['To Do'] },
  { name: 'In Progress', jiraStatuses: ['In Progress'] },
  { name: 'In QA', jiraStatuses: ['In QA'] },
  { name: 'Done', jiraStatuses: ['Done'] },
];

const SIGNALS: WorkSignalSetting = {
  branch: 'In Progress',
  commit: 'In Progress',
  pr_opened: 'In QA',
  pr_merged: 'Done',
  session: 'In Progress',
};

const T1 = '2026-11-20T10:00:00.000Z';
const T2 = '2026-11-21T10:00:00.000Z';
const T3 = '2026-11-22T10:00:00.000Z';

function branch(name: string, at: string): SeenSignal {
  return {
    signal: 'branch',
    at,
    reason: `Branch ${name} in repo`,
    keys: signalKeys(name),
    rowId: null,
    branch: name,
    prState: null,
  };
}

function commit(key: string, at: string): SeenSignal {
  return {
    signal: 'commit',
    at,
    reason: `Commit abc1234 "${key}: tidy" in repo`,
    keys: [key],
    rowId: null,
    branch: null,
    prState: null,
  };
}

function pullRequest(
  state: 'open' | 'merged',
  headBranch: string,
  at: string,
): SeenSignal {
  return {
    signal: state === 'open' ? 'pr_opened' : 'pr_merged',
    at,
    reason: `PR #7 ${state}: ${headBranch}`,
    keys: signalKeys(headBranch),
    rowId: null,
    branch: headBranch,
    prState: state === 'open' ? 'open' : null,
  };
}

function session(
  rowId: string,
  onBranch: string | null,
  at: string,
): SeenSignal {
  return {
    signal: 'session',
    at,
    reason: 'Session "Fix it"',
    keys: [],
    rowId,
    branch: onBranch,
    prState: null,
  };
}

// The entry `signal` gives card `cardId`.
function entry(
  cardId: string,
  signal: SeenSignal,
  column: string,
  state: WorkSuggestion['state'] = 'suggested',
): SavedSuggestion {
  return {
    cardId,
    signal: signal.signal,
    column,
    reason: signal.reason,
    at: signal.at,
    state,
    rowId: signal.rowId,
  };
}

const todo = jiraCard('ABC-12', 'To Do');
const fixBranch = branch('abc-12-fix', T1);
const linkedTask = localCard('local-1', 'Todo', { linkedSessionIds: ['S'] });
const mergedAtT1 = pullRequest('merged', 'abc-12-fix', T1);
const openAtT2 = pullRequest('open', 'abc-12-fix', T2);
const zuluLater = branch('abc-12-zulu', '2026-11-20T10:00:00Z');
const offsetEarlier = branch('abc-12-offset', '2026-11-20T11:30:00+02:00');
const sessionOnSpike = session('S', 'spike/x', T1);
const sessionOnMain = session('S', 'main', T1);
const commitAtT1 = commit('ABC-12', T1);
const commitAtT3 = commit('ABC-12', T3);
const branchAtT3 = branch('abc-12-fix', T3);

interface Row {
  case: string;
  cards: WorkCard[];
  seen: SeenSignal[];
  signals?: Partial<WorkSignalSetting>;
  notYet?: WorkNotYet[];
  expected: SavedSuggestion[];
}

const ROWS: Row[] = [
  {
    case: 'branch key, Todo card',
    cards: [todo],
    seen: [fixBranch],
    expected: [entry('ABC-12', fixBranch, 'In Progress')],
  },
  {
    case: 'lower-case feature/abc-12-fix',
    cards: [todo],
    seen: [branch('feature/abc-12-fix', T1)],
    expected: [
      entry('ABC-12', branch('feature/abc-12-fix', T1), 'In Progress'),
    ],
  },
  {
    case: 'ABC-123 and XABC-12 against card ABC-12',
    cards: [todo],
    seen: [branch('ABC-123-fix', T1), branch('XABC-12-fix', T1)],
    expected: [],
  },
  {
    case: "signal column before the card's",
    cards: [jiraCard('ABC-12', 'In QA')],
    seen: [fixBranch],
    expected: [],
  },
  {
    case: "Jira card moved into the signal's column after the signal",
    cards: [jiraCard('ABC-12', 'Done', { movedAt: T2 })],
    seen: [mergedAtT1],
    expected: [entry('ABC-12', mergedAtT1, 'Done', 'done')],
  },
  {
    case: "Jira card in the signal's column, movedAt null",
    cards: [jiraCard('ABC-12', 'Done')],
    seen: [mergedAtT1],
    expected: [],
  },
  {
    case: "Jira card in the signal's column, movedAt before the signal",
    cards: [
      jiraCard('ABC-12', 'Done', { movedAt: '2026-11-19T10:00:00.000Z' }),
    ],
    seen: [mergedAtT1],
    expected: [],
  },
  {
    case: "local task in the signal's column",
    cards: [
      localCard('local-1', 'In Progress', {
        linkedSessionIds: ['S'],
        movedAt: T2,
      }),
    ],
    seen: [session('S', null, T1)],
    expected: [],
  },
  {
    case: 'two signals, In Progress and In QA',
    cards: [todo],
    seen: [openAtT2, branchAtT3],
    expected: [entry('ABC-12', openAtT2, 'In QA')],
  },
  {
    case: 'tie on column',
    cards: [todo],
    seen: [fixBranch, branch('abc-12-other', T2)],
    expected: [entry('ABC-12', branch('abc-12-other', T2), 'In Progress')],
  },
  {
    case: 'tie on column and at',
    cards: [todo],
    seen: [branch('abc-12-other', T1), fixBranch],
    expected: [entry('ABC-12', branch('abc-12-other', T1), 'In Progress')],
  },
  {
    case: 'at values with mixed offsets',
    cards: [todo],
    seen: [zuluLater, offsetEarlier],
    expected: [entry('ABC-12', zuluLater, 'In Progress')],
  },
  {
    case: 'signals.branch set to " in progress "',
    cards: [todo],
    seen: [fixBranch],
    signals: { branch: ' in progress ' },
    expected: [entry('ABC-12', fixBranch, 'In Progress')],
  },
  {
    case: 'pr_merged while an open PR names the card',
    cards: [jiraCard('ABC-12', 'In Progress')],
    seen: [openAtT2, pullRequest('merged', 'abc-12-old', T3)],
    expected: [entry('ABC-12', openAtT2, 'In QA')],
  },
  {
    case: 'signal set off',
    cards: [todo],
    seen: [fixBranch],
    signals: { branch: 'Off' },
    expected: [],
  },
  {
    case: 'signal naming an unknown column',
    cards: [todo],
    seen: [fixBranch],
    signals: { branch: 'Started' },
    expected: [],
  },
  {
    case: "commit before the card's movedAt",
    cards: [jiraCard('ABC-12', 'To Do', { movedAt: T2 })],
    seen: [commitAtT1],
    expected: [],
  },
  {
    case: "commit after the card's movedAt",
    cards: [jiraCard('ABC-12', 'To Do', { movedAt: T2 })],
    seen: [commitAtT3],
    expected: [entry('ABC-12', commitAtT3, 'In Progress')],
  },
  {
    case: 'commit with movedAt null',
    cards: [todo],
    seen: [commitAtT1],
    expected: [entry('ABC-12', commitAtT1, 'In Progress')],
  },
  {
    case: 'card in Other (unmapped status Blocked)',
    cards: [jiraCard('ABC-12', 'Blocked')],
    seen: [fixBranch],
    expected: [],
  },
  {
    case: 'card with movingTo set',
    cards: [jiraCard('ABC-12', 'To Do', { movingTo: 'In Progress' })],
    seen: [fixBranch],
    expected: [],
  },
  {
    case: "mark with at equal to the signal's",
    cards: [todo],
    seen: [fixBranch],
    notYet: [{ cardId: 'ABC-12', signal: 'branch', at: T1, rowId: null }],
    expected: [],
  },
  {
    case: "mark with at after the signal's",
    cards: [todo],
    seen: [fixBranch],
    notYet: [{ cardId: 'ABC-12', signal: 'branch', at: T2, rowId: null }],
    expected: [],
  },
  {
    case: 'mark older than a newer signal',
    cards: [todo],
    seen: [fixBranch, openAtT2],
    notYet: [{ cardId: 'ABC-12', signal: 'branch', at: T1, rowId: null }],
    expected: [entry('ABC-12', openAtT2, 'In QA')],
  },
  {
    case: 'mark of another card',
    cards: [todo],
    seen: [fixBranch],
    notYet: [{ cardId: 'ABC-99', signal: 'branch', at: T2, rowId: null }],
    expected: [entry('ABC-12', fixBranch, 'In Progress')],
  },
  {
    case: 'session mark, session signal re-stamped later',
    cards: [linkedTask],
    seen: [session('S', null, T3)],
    notYet: [{ cardId: 'local-1', signal: 'session', at: T1, rowId: 'S' }],
    expected: [],
  },
  {
    case: 'session mark, a later session of another row',
    cards: [localCard('local-1', 'Todo', { linkedSessionIds: ['S', 'R'] })],
    seen: [session('R', null, T3)],
    notYet: [{ cardId: 'local-1', signal: 'session', at: T1, rowId: 'S' }],
    expected: [entry('local-1', session('R', null, T3), 'In Progress')],
  },
  {
    case: 'local task, session link by row id',
    cards: [linkedTask],
    seen: [session('S', null, T1)],
    expected: [entry('local-1', session('S', null, T1), 'In Progress')],
  },
  {
    case: "local task, PR on the linked session's branch",
    cards: [linkedTask],
    seen: [sessionOnSpike, pullRequest('open', 'spike/x', T2)],
    expected: [entry('local-1', pullRequest('open', 'spike/x', T2), 'In QA')],
  },
  {
    case: 'linked session on main, unrelated branch main signal',
    cards: [linkedTask],
    seen: [sessionOnMain, branch('main', T3)],
    expected: [entry('local-1', sessionOnMain, 'In Progress')],
  },
  {
    case: 'status matched case-insensitively (in qa)',
    cards: [jiraCard('ABC-12', 'in qa', { movedAt: T3 })],
    seen: [openAtT2],
    expected: [entry('ABC-12', openAtT2, 'In QA', 'done')],
  },
  {
    case: 'cards in input order',
    cards: [jiraCard('ABC-13', 'To Do'), todo],
    seen: [fixBranch, branch('abc-13-fix', T2)],
    expected: [
      entry('ABC-13', branch('abc-13-fix', T2), 'In Progress'),
      entry('ABC-12', fixBranch, 'In Progress'),
    ],
  },
];

describe('detectSuggestions', () => {
  it.each(ROWS)('$case', (row) => {
    const suggestions = detectSuggestions({
      cards: row.cards,
      seen: row.seen,
      signals: { ...SIGNALS, ...row.signals },
      columns: COLUMNS,
      notYet: row.notYet ?? [],
    });

    expect(suggestions).toEqual(row.expected);
  });
});

describe('commitKeyPattern', () => {
  it.each([
    { key: 'ABC-12', expected: '(^|[^A-Za-z0-9])ABC-12([^0-9]|$)' },
    { key: 'ab c-1', expected: null },
    { key: 'A-1', expected: null },
  ])('$key → $expected', ({ key, expected }) => {
    expect(commitKeyPattern(key)).toBe(expected);
  });
});
