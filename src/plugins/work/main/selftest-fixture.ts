import type {
  DetailMessage,
  WorkCard,
  WorkDetail,
  WorkItem,
  WorkItemState,
  WorkSection,
} from '../contract';
import type { SeenSignal } from './detection';
import { EMPTY_WORK_FILE, type WorkFile } from './store';

// The self-test's and drive run's sample work: seven Slack items, six Jira cards and one local task, four detail
// records (two tickets, two threads), and three signals that suggest two moves and mark one done. No item, card,
// record or signal names a real place.

export const FIXTURE_ITEM_IDS: Readonly<
  Record<
    | 'needsYou'
    | 'promised'
    | 'waiting'
    | 'myThread'
    | 'around'
    | 'worthKnowing'
    | 'dismissed',
    string
  >
> = {
  needsYou: 'fixture-needs-you',
  promised: 'fixture-promised',
  waiting: 'fixture-waiting',
  myThread: 'fixture-my-thread',
  around: 'fixture-around',
  worthKnowing: 'fixture-worth-knowing',
  dismissed: 'fixture-dismissed',
};

export const FIXTURE_TASK_ID = 'fixture-task';

const MINUTE_MS = 60_000;

const isoBefore = (now: number, minutes: number) =>
  new Date(now - minutes * MINUTE_MS).toISOString();

interface ItemShape {
  id: string;
  section: WorkSection;
  state: WorkItemState;
  ticketKeys: string[];
  title: string;
  summary: string;
  author: string;
  channel: string;
  why?: string;
  draft?: string;
}

// Newest first: each item's `at` is ten minutes before the one above it, the first ten minutes before `now`.
const ITEM_SHAPES: readonly ItemShape[] = [
  {
    id: FIXTURE_ITEM_IDS.needsYou,
    section: 'needs_you',
    state: 'open',
    ticketKeys: ['WRK-1'],
    title: 'Can you look at WRK-1?',
    summary: 'Ann asks whether the user can look at WRK-1 today.',
    author: 'Ann',
    channel: 'DM',
    draft: "Yes, I'll take a look today.",
  },
  {
    id: FIXTURE_ITEM_IDS.promised,
    section: 'promised',
    state: 'open',
    ticketKeys: [],
    title: 'Notes from the planning call',
    summary: 'The user said they would share the planning notes.',
    author: 'Bo',
    channel: '#team',
  },
  {
    id: FIXTURE_ITEM_IDS.waiting,
    section: 'waiting',
    state: 'open',
    ticketKeys: [],
    title: 'Review of the sample doc',
    summary: 'The user asked Cy for a review two days ago.',
    author: 'Cy',
    channel: '#docs',
    draft: 'Any news on this?',
  },
  {
    id: FIXTURE_ITEM_IDS.myThread,
    section: 'my_threads',
    state: 'open',
    ticketKeys: [],
    title: 'Ideas for the next sprint',
    summary: 'The user started a thread on ideas for the next sprint.',
    author: 'Dee',
    channel: '#team',
  },
  {
    id: FIXTURE_ITEM_IDS.around,
    section: 'around',
    state: 'open',
    ticketKeys: ['WRK-3'],
    title: 'Tidy pass on WRK-3',
    summary: 'Eli asks how the tidy pass is going.',
    author: 'Eli',
    channel: '#builds',
    why: 'Mentions WRK-3',
  },
  {
    id: FIXTURE_ITEM_IDS.worthKnowing,
    section: 'worth_knowing',
    state: 'open',
    ticketKeys: [],
    title: 'Release freeze',
    summary: 'The release freeze starts on Friday.',
    author: 'Fay',
    channel: '#announcements',
    why: 'Release freeze starts Friday',
  },
  {
    id: FIXTURE_ITEM_IDS.dismissed,
    section: 'needs_you',
    state: 'dismissed',
    ticketKeys: [],
    title: 'Lunch order',
    summary: 'Gus asks what the user wants for lunch.',
    author: 'Gus',
    channel: 'DM',
  },
];

function fixtureItem(shape: ItemShape, index: number, now: number): WorkItem {
  return {
    id: shape.id,
    section: shape.section,
    channel: shape.channel,
    author: shape.author,
    at: isoBefore(now, (index + 1) * 10),
    title: shape.title,
    summary: shape.summary,
    latest: `${shape.author}: ${shape.summary}`,
    participants: [shape.author],
    url: `https://slack.example/${shape.id}`,
    ticketKeys: shape.ticketKeys,
    linkReason: null,
    why: shape.why ?? null,
    draft: shape.draft ?? null,
    state: shape.state,
    snoozedUntil: null,
    firstSeen: new Date(now).toISOString(),
    note: null,
    sending: null,
  };
}

function jiraCard(
  key: string,
  jiraStatus: string,
  priority: string | null,
  title: string,
  movedAt: string | null = null,
): WorkCard {
  return {
    kind: 'jira',
    id: key,
    key,
    title,
    url: null,
    column: '',
    movingTo: null,
    note: null,
    linkedSessionIds: [],
    movedAt,
    jiraStatus,
    priority,
    reachableStatuses: null,
  };
}

// A Slack ts `minutes` before `now`: seconds since the epoch, to the microsecond.
const slackTsBefore = (now: number, minutes: number) =>
  ((now - minutes * MINUTE_MS) / 1000).toFixed(6);

const message = (author: string, at: string, text: string): DetailMessage => ({
  author,
  at,
  text,
});

const issue = (
  key: string,
  title: string,
  status: string,
  relation: string | null,
) => ({
  key,
  title,
  status,
  relation,
  url: `https://jira.example/browse/${key}`,
});

// Ticket details for WRK-1 and WRK-3, and thread details for the Needs you and Around items, each thread ending at its
// item's `at`.
function fixtureDetails(now: number): Record<string, WorkDetail> {
  const records: WorkDetail[] = [
    {
      kind: 'ticket',
      id: 'WRK-1',
      fetchedAt: isoBefore(now, 5),
      stamp: isoBefore(now, 90),
      type: 'Bug',
      priority: null,
      status: 'Backlog',
      assignee: 'Dee',
      reporter: 'Ann',
      updated: isoBefore(now, 90),
      description: 'The sample report shows **two** totals for one day.',
      comments: [
        message('Ann', isoBefore(now, 180), 'Seen on the sample data too.'),
        message('Bo', isoBefore(now, 90), 'It could be the `totals` rounding.'),
      ],
      subtasks: [issue('WRK-7', 'Check the rounding', 'To Do', null)],
      links: [issue('WRK-3', 'Tidy pass', 'In Progress', 'blocks')],
    },
    {
      kind: 'ticket',
      id: 'WRK-3',
      fetchedAt: isoBefore(now, 5),
      stamp: isoBefore(now, 240),
      type: 'Task',
      priority: 'High',
      status: 'In Progress',
      assignee: 'Dee',
      reporter: 'Eli',
      updated: isoBefore(now, 240),
      description:
        'Tidy the sample module:\n\n- rename the helpers\n- drop the dead branch',
      comments: [],
      subtasks: [],
      links: [],
    },
    {
      kind: 'thread',
      id: FIXTURE_ITEM_IDS.needsYou,
      fetchedAt: isoBefore(now, 5),
      stamp: slackTsBefore(now, 10),
      root: message('Ann', isoBefore(now, 40), 'Can you look at WRK-1?'),
      replies: [
        message('Bo', isoBefore(now, 20), 'I saw it too on the sample data.'),
        message('Ann', isoBefore(now, 10), 'Today would be great.'),
      ],
      replyCount: 2,
    },
    {
      kind: 'thread',
      id: FIXTURE_ITEM_IDS.around,
      fetchedAt: isoBefore(now, 5),
      stamp: slackTsBefore(now, 50),
      root: message(
        'Eli',
        isoBefore(now, 120),
        'Starting the tidy pass on WRK-3.',
      ),
      replies: [
        message('Eli', isoBefore(now, 50), 'How is the tidy pass going?'),
      ],
      replyCount: 3,
    },
  ];
  return Object.fromEntries(records.map((record) => [record.id, record]));
}

// The sample `work.json` at `now` (epoch ms): the items, then the cards in Board order, then the detail records, with
// no suggestions until detection runs over the signals.
export function fixtureFile(now: number): WorkFile {
  return {
    ...EMPTY_WORK_FILE,
    details: fixtureDetails(now),
    items: ITEM_SHAPES.map((shape, index) => fixtureItem(shape, index, now)),
    cards: [
      jiraCard('WRK-1', 'Backlog', null, 'Look into the sample report'),
      jiraCard('WRK-2', 'To Do', 'Medium', 'Board polish'),
      jiraCard('WRK-3', 'In Progress', 'High', 'Tidy pass'),
      jiraCard(
        'WRK-4',
        'In Review',
        null,
        "Tidy the board's column headers so long ticket titles wrap cleanly beside the key and priority",
      ),
      jiraCard('WRK-5', 'Done', null, 'Ship the sample', isoBefore(now, 30)),
      jiraCard('WRK-6', 'Blocked', null, 'Wait on the sample vendor'),
      {
        kind: 'local',
        id: FIXTURE_TASK_ID,
        title: 'Share the planning notes',
        url: null,
        column: 'Todo',
        movingTo: null,
        note: null,
        linkedSessionIds: [],
        movedAt: null,
        sourceItemId: FIXTURE_ITEM_IDS.promised,
      },
    ],
  };
}

// The signals the fixture's watch reports, an hour before `now`: a branch for WRK-2, an open PR for WRK-3, and a
// PR for WRK-5 merged before the card moved to Done.
export function fixtureSignals(now: number): SeenSignal[] {
  const at = isoBefore(now, 60);
  return [
    {
      signal: 'branch',
      at,
      reason: 'Branch wrk-2-board in fixture-repo',
      keys: ['WRK-2'],
      rowId: null,
      branch: 'wrk-2-board',
      prState: null,
    },
    {
      signal: 'pr_opened',
      at,
      reason: 'PR #12 open: WRK-3 tidy',
      keys: ['WRK-3'],
      rowId: null,
      branch: 'wrk-3-tidy',
      prState: 'open',
    },
    {
      signal: 'pr_merged',
      at,
      reason: 'PR #9 merged: WRK-5 ship',
      keys: ['WRK-5'],
      rowId: null,
      branch: 'wrk-5-ship',
      prState: null,
    },
  ];
}
