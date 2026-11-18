import {
  type BoardRow,
  type Claim,
  participantKey,
  type RoomMessage,
  type RoomView,
  type RowUnread,
  type ThreadView,
  USER_PARTICIPANT,
} from '../contract';
import type { ThreadSummary } from './room-service';

// What one room's view is built from: the room service's threads, claims,
// the user's unread posts and every message, and the board's rows.
export interface RoomViewInput {
  readonly room: string;
  readonly threads: readonly ThreadSummary[];
  readonly board: readonly BoardRow[];
  readonly claims: readonly Claim[];
  readonly userUnread: readonly RoomMessage[];
  readonly messages: readonly RoomMessage[];
}

const USER_KEY = participantKey(USER_PARTICIPANT);

function addressesUser(message: RoomMessage): boolean {
  return message.to.some((target) => participantKey(target) === USER_KEY);
}

function threadView(
  summary: ThreadSummary,
  userUnread: readonly RoomMessage[],
): ThreadView {
  const unread = userUnread.filter(
    (message) => message.thread === summary.thread,
  );
  return {
    thread: summary.thread,
    resolved: summary.resolved,
    lastId: summary.lastId,
    userUnread: unread.length,
    userMentions: unread.filter(addressesUser).length,
  };
}

function rowUnread(
  row: BoardRow,
  userUnread: readonly RoomMessage[],
): RowUnread {
  const unread = userUnread.filter(
    (message) =>
      message.from.kind === 'agent' && message.from.rowId === row.rowId,
  );
  const newest = unread.reduce<RoomMessage | null>(
    (kept, message) => (kept === null || message.id > kept.id ? message : kept),
    null,
  );
  return {
    rowId: row.rowId,
    unread: unread.length,
    mentions: unread.filter(addressesUser).length,
    newestThread: newest?.thread ?? null,
  };
}

// Each `question` and `blocker` addressed to the user that no `answer` names
// in `replyTo`, in id order.
function openUserAsks(messages: readonly RoomMessage[]): RoomMessage[] {
  const answered = new Set(
    messages
      .filter((message) => message.kind === 'answer')
      .map((message) => message.replyTo),
  );
  return messages.filter(
    (message) =>
      (message.kind === 'question' || message.kind === 'blocker') &&
      addressesUser(message) &&
      !answered.has(message.id),
  );
}

export function buildRoomView(input: RoomViewInput): RoomView {
  return {
    room: input.room,
    threads: input.threads.map((summary) =>
      threadView(summary, input.userUnread),
    ),
    board: input.board,
    claims: input.claims,
    rowUnread: input.board.map((row) => rowUnread(row, input.userUnread)),
    userAsks: openUserAsks(input.messages),
  };
}
