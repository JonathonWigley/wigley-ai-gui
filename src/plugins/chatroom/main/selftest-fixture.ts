import type { Clock, Timers } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { KeyedSlotReader } from '../../../contracts/state';
import { editableTitle, type SessionRow } from '../../sessions/contract';
import { type Participant, type RoomView, sessionThread } from '../contract';
import type { RoomService } from './room-service';

// The first messages of the two sessions, which title their rows.
const LEAD_TITLE = 'chatroom lead';
const PEER_TITLE = 'chatroom peer';

// The thread the fixture's plan posts sit in.
export const FIXTURE_THREAD = 'plan-demo';

// The run's step wait, which the fixture's waits keep to together.
const WAIT_TIMEOUT_MS = 5_000;
const WAIT_POLL_MS = 20;

// `launch` starts a session in the project folder with `title` as its first message and resolves to its row id.
// `rooms` reads the `chatroom.rooms` value of a room. `roomFor` is the room service the posts and the claim go
// through, asked once the room is known.
export interface ChatroomFixtureDeps {
  files: Pick<Files, 'makeFolder'>;
  clock: Clock;
  timers: Timers;
  launch(title: string): Promise<string>;
  rows: Pick<KeyedSlotReader<SessionRow>, 'get'>;
  rooms: (room: string) => RoomView | undefined;
  roomFor(roomName: string): Pick<RoomService, 'post' | 'claim'>;
}

// The lead's row first, then the peer's. `questionId` is the peer's question
// to `you`.
export interface ChatroomFixture {
  room: string;
  rowIds: readonly [string, string];
  titles: readonly [string, string];
  thread: string;
  questionId: number;
}

// Launches the lead and then the peer through `launch`, which starts them in
// `projectDir`, waits until both rows, their titles and the room's board rows
// are in, then posts as the two agents through the room `roomFor` names: the lead's heads-up, the peer's question to `you`
// and the lead's result in `plan-demo`, the lead's progress in its session
// thread, and the lead's claim on `src/**`. Throws on any refused post or claim.
export async function seedChatroomFixture(
  deps: ChatroomFixtureDeps,
  projectDir: string,
): Promise<ChatroomFixture> {
  const { files, rows, rooms } = deps;
  await files.makeFolder(projectDir);
  const leadId = await deps.launch(LEAD_TITLE);
  const peerId = await deps.launch(PEER_TITLE);
  const rowIds = [leadId, peerId] as const;

  const deadline = deps.clock.now() + WAIT_TIMEOUT_MS;
  await waitUntil(
    deps,
    deadline,
    () => rowIds.every((rowId) => rows.get(rowId) !== undefined),
    "the chatroom fixture's rows never reached sessions.rows",
  );
  const titleOf = (rowId: string) => {
    const titles = rows.get(rowId)?.titles;
    return titles === undefined ? '' : editableTitle(titles);
  };
  await waitUntil(
    deps,
    deadline,
    () => rowIds.every((rowId) => titleOf(rowId) !== ''),
    "the chatroom fixture's rows were never titled",
  );
  // A row's project can change after it shows, as a folder inside a repo
  // takes the repo's name, so the room is read again on each poll.
  const roomOfRows = (): string | null => {
    const project = rows.get(leadId)?.project;
    return project !== undefined && rows.get(peerId)?.project === project
      ? project
      : null;
  };
  await waitUntil(
    deps,
    deadline,
    () => {
      const roomName = roomOfRows();
      const board = roomName === null ? [] : (rooms(roomName)?.board ?? []);
      return rowIds.every((rowId) => board.some((row) => row.rowId === rowId));
    },
    "no room ever held both of the chatroom fixture's board rows",
  );
  const project = roomOfRows();
  if (project === null) {
    throw new Error("the chatroom fixture's rows are in two rooms");
  }
  const room = deps.roomFor(project);
  const titles = [titleOf(leadId), titleOf(peerId)] as const;
  const lead = agent(leadId, titles[0]);
  const peer = agent(peerId, titles[1]);

  const post = async (
    from: Participant,
    kind: 'heads-up' | 'question' | 'result' | 'progress',
    body: string,
    thread: string,
    extra: Partial<{ to: string[]; refs: { type: 'commit'; value: string }[] }>,
  ): Promise<number> => {
    const result = await room.post({
      room: project,
      followTargets: false,
      from,
      kind,
      body,
      to: extra.to ?? [],
      thread,
      refs: extra.refs ?? [],
      replyTo: null,
      answerBy: null,
      onNoAnswer: null,
      key: null,
    });
    if (!result.ok) {
      throw new Error(`fixture post refused: ${result.reason}`);
    }
    return result.id;
  };

  await post(
    lead,
    'heads-up',
    'Running the full build until 15:40',
    FIXTURE_THREAD,
    {},
  );
  const questionId = await post(
    peer,
    'question',
    'Shall I take clone 3 while the build runs?',
    FIXTURE_THREAD,
    { to: ['you'] },
  );
  await post(lead, 'result', 'Landed the contract', FIXTURE_THREAD, {
    refs: [{ type: 'commit', value: 'abc1234' }],
  });
  await post(
    lead,
    'progress',
    'Phase 2: wiring the hook',
    sessionThread(leadId),
    {},
  );

  const claim = await room.claim({
    room: project,
    holder: lead,
    target: { paths: ['src/**'] },
    reason: 'contract work',
    minutes: null,
  });
  if (!claim.ok) {
    throw new Error(`fixture claim refused: ${claim.reason}`);
  }

  return { room: project, rowIds, titles, thread: FIXTURE_THREAD, questionId };
}

function agent(rowId: string, name: string): Participant {
  return { kind: 'agent', rowId, agentId: null, mirrorId: null, name };
}

// Asks `holds` every WAIT_POLL_MS until it is true; throws `failure` once
// `deadline` (epoch ms) has passed.
async function waitUntil(
  { clock, timers }: Pick<ChatroomFixtureDeps, 'clock' | 'timers'>,
  deadline: number,
  holds: () => boolean,
  failure: string,
): Promise<void> {
  while (!holds()) {
    if (clock.now() > deadline) {
      throw new Error(failure);
    }
    await new Promise<void>((resolve) => {
      timers.set(resolve, WAIT_POLL_MS);
    });
  }
}
