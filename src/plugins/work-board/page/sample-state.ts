import {
  OTHER_COLUMN,
  type WorkCard,
  type WorkItem,
  type WorkState,
} from '../../work/contract';

const MINUTE_MS = 60_000;

// The card the demo's first beat puts the cursor on: in a middle column, with a suggestion and one thread.
export const SAMPLE_SUGGESTION_CARD = 'ABC-12';
// The local task the demo's second beat puts the cursor on.
export const SAMPLE_LOCAL_TASK = 'local-sample-1';

const JIRA = 'https://jira.example/browse';

function jira(
  key: string,
  title: string,
  column: string,
  overrides: Partial<Extract<WorkCard, { kind: 'jira' }>> = {},
): WorkCard {
  return {
    kind: 'jira',
    id: key,
    key,
    title,
    url: `${JIRA}/${key}`,
    column,
    jiraStatus: column,
    priority: null,
    reachableStatuses: null,
    movingTo: null,
    note: null,
    linkedSessionIds: [],
    movedAt: null,
    ...overrides,
  };
}

// A thread holding `ABC-12`, so that card's `1 thread` chip shows.
function sampleItem(at: string): WorkItem {
  return {
    id: 'https://slack.example/archives/C1/p1',
    section: 'my_threads',
    channel: '#client',
    author: 'Sam',
    at,
    title: 'Login fails after the token refresh',
    summary: 'The fix for ABC-12 is on a branch; QA wants a build.',
    latest: 'Sam: any ETA on the build?',
    participants: ['Sam'],
    url: 'https://slack.example/archives/C1/p1',
    ticketKeys: [SAMPLE_SUGGESTION_CARD],
    linkReason: null,
    why: null,
    draft: null,
    state: 'open',
    snoozedUntil: null,
    firstSeen: at,
    note: null,
    sending: null,
  };
}

// The Board demo's sample: every default column, Jira cards in three of them (one with a priority), one in Other,
// one with a suggestion and one moving, a local task in Todo, a thread for the suggestion card, and a finished sweep
// with a transcript.
export function sampleBoardState(now: number): WorkState {
  const ago = (minutes: number) =>
    new Date(now - minutes * MINUTE_MS).toISOString();
  const local: WorkCard = {
    kind: 'local',
    id: SAMPLE_LOCAL_TASK,
    title: 'Reply to Sam about the build',
    url: 'https://slack.example/archives/C1/p1',
    column: 'Todo',
    sourceItemId: 'https://slack.example/archives/C1/p1',
    movingTo: null,
    note: null,
    linkedSessionIds: [],
    movedAt: null,
  };
  return {
    items: [sampleItem(ago(20))],
    cards: [
      jira('ABC-7', 'Tidy the settings copy', 'Backlog'),
      jira('ABC-9', 'Crash on resume', 'Todo', { priority: 'High' }),
      local,
      jira(SAMPLE_SUGGESTION_CARD, 'Fix the login refresh', 'Todo'),
      jira('ABC-15', 'Profile the board redraw', 'In Progress', {
        movingTo: 'In QA',
      }),
      jira('ABC-3', 'Ship the onboarding tweak', 'In QA'),
      jira('ABC-21', 'Spike the export format', OTHER_COLUMN, {
        jiraStatus: 'Blocked',
      }),
    ],
    suggestions: [
      {
        cardId: SAMPLE_SUGGESTION_CARD,
        signal: 'branch',
        column: 'In Progress',
        reason: 'Branch ABC-12-fix-login in wigley-ai-gui',
        at: ago(5),
        state: 'suggested',
      },
    ],
    columns: ['Backlog', 'Todo', 'In Progress', 'In QA', 'Done', OTHER_COLUMN],
    job: {
      running: null,
      last: {
        kind: 'sweep',
        state: 'done',
        rowId: 'sample-sweep-row',
        at: ago(3),
        note: null,
      },
    },
    problem: null,
  };
}
