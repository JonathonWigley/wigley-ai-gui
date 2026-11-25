import {
  OTHER_COLUMN,
  type WorkCard,
  type WorkDetail,
  type WorkItem,
  type WorkState,
} from '../../work/contract';

const MINUTE_MS = 60_000;

// The thread the suggestion card's chip counts and the local task came from.
const SAMPLE_THREAD = 'https://slack.example/archives/C1/p1';

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
    commenting: [],
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
    id: SAMPLE_THREAD,
    section: 'my_threads',
    channel: '#client',
    author: 'Sam',
    at,
    title: 'Login fails after the token refresh',
    summary: 'The fix for ABC-12 is on a branch; QA wants a build.',
    latest: 'Sam: any ETA on the build?',
    participants: ['Sam'],
    url: SAMPLE_THREAD,
    ticketKeys: [SAMPLE_SUGGESTION_CARD],
    linkReason: null,
    why: null,
    seenAt: null,
    state: 'open',
    snoozedUntil: null,
    firstSeen: at,
    note: null,
    sending: null,
  };
}

// The Board demo's sample: every default column, Jira cards in four of them (one with a priority), one in Other,
// one with a suggestion and a queued comment and one moving, a local task in Todo, a thread for the suggestion card,
// and a finished sweep with a transcript.
export function sampleBoardState(now: number): WorkState {
  const ago = (minutes: number) =>
    new Date(now - minutes * MINUTE_MS).toISOString();
  const local: WorkCard = {
    kind: 'local',
    id: SAMPLE_LOCAL_TASK,
    title: 'Reply to Sam about the build',
    url: SAMPLE_THREAD,
    column: 'Todo',
    sourceItemId: SAMPLE_THREAD,
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
      jira(SAMPLE_SUGGESTION_CARD, 'Fix the login refresh', 'Todo', {
        commenting: ['The fix is on `ABC-12-fix-login`; a build follows.'],
      }),
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
    lastSweepAt: ago(3),
    sweepFailedAt: null,
    problem: null,
  };
}

// The Board demo's detail records: the suggestion card's ticket and the local task's thread. `ABC-9` keeps none, so
// its pane reads the missing-detail line.
export function sampleBoardDetails(now: number): WorkDetail[] {
  const ago = (minutes: number) =>
    new Date(now - minutes * MINUTE_MS).toISOString();
  return [
    {
      kind: 'ticket',
      id: SAMPLE_SUGGESTION_CARD,
      fetchedAt: ago(3),
      stamp: ago(40),
      type: 'Bug',
      priority: null,
      status: 'Todo',
      assignee: 'Alex',
      reporter: 'Sam',
      updated: ago(40),
      description: [
        'After the access token refreshes, the next request goes out with the old token and the server answers 401.',
        '',
        'Seen on:',
        '',
        '- the web client after an idle hour',
        '- the desktop app on wake from sleep',
      ].join('\n'),
      comments: [
        {
          author: 'Sam',
          byUser: false,
          at: ago(120),
          text: 'QA reproduced it twice this morning.',
        },
        {
          author: 'Alex',
          byUser: false,
          at: ago(30),
          text: 'The retry reads the token before `refresh()` resolves; fix is on a branch.',
        },
      ],
      subtasks: [
        {
          key: 'ABC-13',
          title: 'Add a refresh test',
          status: 'Todo',
          relation: null,
          url: `${JIRA}/ABC-13`,
        },
      ],
      links: [
        {
          key: 'ABC-9',
          title: 'Crash on resume',
          status: 'Todo',
          relation: 'relates to',
          url: `${JIRA}/ABC-9`,
        },
      ],
    },
    {
      kind: 'thread',
      id: SAMPLE_THREAD,
      fetchedAt: ago(3),
      stamp: '1763892000.000300',
      root: {
        author: 'Sam',
        byUser: false,
        at: ago(90),
        text: 'Login fails after the token refresh. Is ABC-12 on anyone?',
      },
      replies: [
        {
          author: 'Alex',
          byUser: false,
          at: ago(45),
          text: 'On it: the fix is on a branch.',
        },
        {
          author: 'Sam',
          byUser: false,
          at: ago(20),
          text: 'Any ETA on the build?',
        },
      ],
      replyCount: 4,
    },
  ];
}
