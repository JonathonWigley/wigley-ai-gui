import type { RowActivity, SessionRow } from '../../sessions/contract';
import {
  type BoardRow,
  ENTRY_KINDS,
  type RoomMessage,
  type RoomView,
  type RowUnread,
  sessionThreadRowId,
  type UserPost,
} from '../contract';

// What a row shows while its agents asked the user a question or blocker no
// answer replies to: over error (30) and working (20), under needs you (40).
export const ASKS_YOU_ACTIVITY: RowActivity = {
  word: 'asks you',
  tone: 'attention',
  rank: 35,
  emphasis: 'raised',
};

function boardNameOf(
  board: readonly BoardRow[],
  rowId: string | null,
): string | null {
  return board.find((row) => row.rowId === rowId)?.name ?? null;
}

// `@<mentions>` while any unread post is addressed to the user, else
// `<unread> new` while any is unread, else null: nothing draws.
export function badgeText(
  unread: Pick<RowUnread, 'unread' | 'mentions'> | undefined,
): string | null {
  if (unread === undefined) {
    return null;
  }
  if (unread.mentions > 0) {
    return `@${unread.mentions}`;
  }
  return unread.unread > 0 ? `${unread.unread} new` : null;
}

// The room a session row sits in, and the row's unread posts there.
export function rowUnreadOf(
  rooms: readonly RoomView[],
  row: Pick<SessionRow, 'sessionId' | 'project'>,
): RowUnread | undefined {
  return rooms
    .find((view) => view.room === row.project)
    ?.rowUnread.find((unread) => unread.rowId === row.sessionId);
}

// Each row's activity: `asks you` while any room's `userAsks` holds a post by
// one of the row's agents, else null.
export function rowActivities(
  rooms: readonly RoomView[],
  rowIds: readonly string[],
): Map<string, RowActivity | null> {
  const askingRows = new Set(
    rooms.flatMap((view) => view.userAsks.map((ask) => ask.from.rowId)),
  );
  return new Map(
    rowIds.map((rowId) => [
      rowId,
      askingRows.has(rowId) ? ASKS_YOU_ACTIVITY : null,
    ]),
  );
}

// A thread as the side bar lists it: `label` is a `session:<row id>`
// thread's `<session title> (session)`, else the thread's own name.
export interface ThreadListRow {
  room: string;
  thread: string;
  label: string;
  resolved: boolean;
  lastId: number;
  unread: number;
  mentions: number;
}

export interface ThreadListGroup {
  room: string;
  threads: ThreadListRow[];
}

// The name a thread shows under: a `session:<row id>` thread takes the
// title of that row on the room's board, and its raw name when the board has
// no such row.
export function threadLabel(
  board: readonly BoardRow[],
  thread: string,
): string {
  const rowId = sessionThreadRowId(thread);
  const title = rowId === null ? null : boardNameOf(board, rowId);
  return title === null ? thread : `${title} (session)`;
}

// The side bar's list: rooms by name, each room's open threads newest first
// by `lastId`, then its resolved threads, also newest first.
export function threadList(rooms: readonly RoomView[]): ThreadListGroup[] {
  return [...rooms]
    .sort((a, b) => compareText(a.room, b.room))
    .map((view) => ({
      room: view.room,
      threads: [...view.threads]
        .sort(
          (a, b) =>
            Number(a.resolved) - Number(b.resolved) || b.lastId - a.lastId,
        )
        .map((thread) => ({
          room: view.room,
          thread: thread.thread,
          label: threadLabel(view.board, thread.thread),
          resolved: thread.resolved,
          lastId: thread.lastId,
          unread: thread.userUnread,
          mentions: thread.userMentions,
        })),
    }));
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

// One key per thread of the side bar: `<room>\n<thread>`, the arg of the
// thread row's click.
export function threadKey(room: string, thread: string): string {
  return `${room}\n${thread}`;
}

// The room and thread of a `threadKey`; null for text that is no key.
export function parseThreadKey(
  key: string,
): { room: string; thread: string } | null {
  const at = key.indexOf('\n');
  if (at <= 0 || at === key.length - 1) {
    return null;
  }
  return { room: key.slice(0, at), thread: key.slice(at + 1) };
}

export type CursorMove = 'down' | 'up' | 'top' | 'bottom';

// The cursor index after `move` over `length` items, held at both ends; 0 for
// no items.
export function movedIndex(
  index: number,
  length: number,
  move: CursorMove,
): number {
  if (length === 0) {
    return 0;
  }
  switch (move) {
    case 'down':
      return Math.min(index + 1, length - 1);
    case 'up':
      return Math.max(index - 1, 0);
    case 'top':
      return 0;
    case 'bottom':
      return length - 1;
  }
}

// What the user writes: a note to the thread, or an answer to `message`.
export type ComposerIntent =
  | { kind: 'note' }
  | { kind: 'reply'; message: RoomMessage };

// Entries and `progress` draw dim in the log.
export function isQuietKind(kind: RoomMessage['kind']): boolean {
  return kind === 'progress' || ENTRY_KINDS.some((entry) => entry === kind);
}

// Whether `r` answers `message`: a question or blocker.
export function canReplyTo(message: RoomMessage): boolean {
  return message.kind === 'question' || message.kind === 'blocker';
}

// The post the composer sends in `thread`, null when the intent has nothing
// to answer. A note in a `session:<row id>` thread is to that row's board
// name; any other note is to the thread. An answer goes to the board name of
// the sender's row, which for a subagent is its lead's, since a post names
// only main agents; empty when the board no longer holds that row.
export function userPostFor(
  intent: ComposerIntent,
  thread: string,
  board: readonly BoardRow[],
  body: string,
): UserPost | null {
  if (intent.kind === 'note') {
    const rowId = sessionThreadRowId(thread);
    const name = rowId === null ? null : boardNameOf(board, rowId);
    return {
      kind: 'note',
      body,
      to: name === null ? [] : [name],
      replyTo: null,
    };
  }
  if (!canReplyTo(intent.message)) {
    return null;
  }
  const name = boardNameOf(board, intent.message.from.rowId);
  return {
    kind: 'answer',
    body,
    to: name === null ? [] : [name],
    replyTo: intent.message.id,
  };
}

// The sender a message shows: `you` for the user's word.
export function senderName(message: RoomMessage): string {
  return message.userWord ? 'you' : message.from.name;
}

// `HH:MM` in local time.
export function clockTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
