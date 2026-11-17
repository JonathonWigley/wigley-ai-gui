import {
  type BoardRow,
  type Claim,
  type EntryKind,
  type Participant,
  type PostKind,
  type RoomMessage,
  type RoomView,
  SYSTEM_PARTICIPANT,
  USER_PARTICIPANT,
} from '../contract';

// The layout preview's sample room: two sessions on the board, one claim, one
// question to the user still open, and one thread holding a message of every
// post kind and every entry kind. Times run from a fixed noon.

export const PREVIEW_ROOM = 'sample-project';
export const PREVIEW_THREAD = 'plan-demo';

const LEAD_ROW = 'preview-row-shop';
const PEER_ROW = 'preview-row-docs';
const START = Date.UTC(2026, 0, 5, 12, 0);
const MINUTE = 60_000;

function agent(
  rowId: string,
  name: string,
  agentId: string | null = null,
): Participant {
  return { kind: 'agent', rowId, agentId, mirrorId: null, name };
}

const LEAD = agent(LEAD_ROW, 'Shop Revamp');
const PEER = agent(PEER_ROW, 'Docs Sweep');
const WORKER = agent(LEAD_ROW, 'Shop Revamp ▸ worker', 'preview-agent-1');

const CLAIM: Claim = {
  id: 'preview-claim-1',
  room: PREVIEW_ROOM,
  holder: LEAD,
  target: { paths: ['src/shop/**'] },
  reason: 'reworking the shop screens',
  expiresAt: START + 30 * MINUTE,
};

const BOARD: BoardRow[] = [
  {
    rowId: LEAD_ROW,
    name: 'Shop Revamp',
    harness: 'claude',
    state: 'working',
    folder: '/work/sample-project',
    branch: 'shop-revamp',
    clone: { pool: 'sample', number: 2, holder: 'this' },
    uncommitted: [
      { path: 'src/shop/view.ts', byRowId: LEAD_ROW, by: 'Shop Revamp' },
    ],
    uncommittedMore: 0,
    unpushedPaths: ['src/shop/model.ts'],
    unpushedMore: 0,
    claims: [CLAIM],
  },
  {
    rowId: PEER_ROW,
    name: 'Docs Sweep',
    harness: 'codex',
    state: 'idle',
    folder: '/work/sample-project-2',
    branch: 'main',
    clone: null,
    uncommitted: [],
    uncommittedMore: 0,
    unpushedPaths: null,
    unpushedMore: 0,
    claims: [],
  },
];

// One message per kind, in id order, with the body each one reads.
const SAMPLES: readonly {
  kind: PostKind | EntryKind;
  from: Participant;
  body: string;
  to?: readonly Participant[];
  replyTo?: number;
  userWord?: boolean;
}[] = [
  { kind: 'joined', from: SYSTEM_PARTICIPANT, body: 'Shop Revamp joined' },
  {
    kind: 'heads-up',
    from: LEAD,
    body: 'Holding **clone 2** for about an hour.',
  },
  {
    kind: 'dispatch',
    from: SYSTEM_PARTICIPANT,
    body: 'dispatched worker (opus-medium): build the shop view',
  },
  {
    kind: 'progress',
    from: WORKER,
    body: 'Reading done; writing `view.ts` next.',
  },
  {
    kind: 'question',
    from: LEAD,
    to: [USER_PARTICIPANT],
    body: 'Keep the old price badge, or drop it?',
  },
  {
    kind: 'blocker',
    from: WORKER,
    to: [USER_PARTICIPANT],
    body: 'Cannot build until the shop icons are in `assets/`.',
  },
  {
    kind: 'answer',
    from: USER_PARTICIPANT,
    to: [LEAD],
    replyTo: 6,
    userWord: true,
    body: 'They are in now.',
  },
  {
    kind: 'decision',
    from: LEAD,
    body: 'Prices stay in cents across the shop.',
  },
  {
    kind: 'handoff',
    from: PEER,
    to: [LEAD],
    body: 'Docs for the shop are in; the tree is clean.',
  },
  {
    kind: 'hand-back',
    from: SYSTEM_PARTICIPANT,
    body: 'worker handed back: view built',
  },
  { kind: 'result', from: LEAD, body: 'Landed the shop view in `a1b2c3d`.' },
  { kind: 'note', from: PEER, body: 'Thanks.' },
  { kind: 'left', from: SYSTEM_PARTICIPANT, body: 'Docs Sweep left' },
];

export const PREVIEW_MESSAGES: readonly RoomMessage[] = SAMPLES.map(
  (sample, index) => ({
    id: index + 1,
    room: PREVIEW_ROOM,
    thread: PREVIEW_THREAD,
    from: sample.from,
    to: sample.to ?? [],
    kind: sample.kind,
    body: sample.body,
    refs:
      sample.kind === 'result'
        ? [
            { type: 'commit', value: 'a1b2c3d' },
            { type: 'file', value: 'src/shop/view.ts' },
          ]
        : [],
    replyTo: sample.replyTo ?? null,
    answerBy: null,
    onNoAnswer: null,
    key: null,
    at: START + index * MINUTE,
    userWord: sample.userWord ?? false,
  }),
);

const LAST_ID = PREVIEW_MESSAGES.length;

export const PREVIEW_ROOM_VIEW: RoomView = {
  room: PREVIEW_ROOM,
  threads: [
    {
      thread: PREVIEW_THREAD,
      resolved: false,
      lastId: LAST_ID,
      userUnread: 2,
      userMentions: 1,
    },
    {
      thread: `session:${LEAD_ROW}`,
      resolved: false,
      lastId: 4,
      userUnread: 0,
      userMentions: 0,
    },
    {
      thread: 'old-release',
      resolved: true,
      lastId: 1,
      userUnread: 0,
      userMentions: 0,
    },
  ],
  board: BOARD,
  claims: [CLAIM],
  rowUnread: [
    { rowId: LEAD_ROW, unread: 2, mentions: 1, newestThread: PREVIEW_THREAD },
    { rowId: PEER_ROW, unread: 0, mentions: 0, newestThread: null },
  ],
  userAsks: [PREVIEW_MESSAGES[4]],
};
