// The chatroom layout contract: what a layout in `layouts/chatroom/<name>/layout.js` draws Chatroom mode and the row
// badge with. In the mode's side bar the app draws one `sideBar`, listing every room and its threads. In the sheet,
// while a room shows, it draws one `board` (the room's board, then the shown thread's heading), one `message` per
// message of the shown thread, oldest first, and one `composer`. Under each session row, in the row part's wrapper, it
// draws one `rowBadge` while the row has unread posts, and nothing otherwise. The app sets
// `data-layout-owner="chatroom"` and `data-layout="<name>"` on the element each part returns, `<name>` being the
// layout that drew it, so `[data-layout-owner="chatroom"][data-layout="<name>"] …` in a layout's CSS selects only its
// own parts.
//
// The app keeps:
// - the keys and the focus: `j`/`k`/`gg`/`G` walk the side bar's cursor and Enter opens its thread; Alt+l gives the
//   keys to the log, where `j`/`k`/`gg`/`G` walk the log's cursor, `i` opens the composer for a note and `r` answers
//   the cursor's question or blocker; Enter in the composer sends and Esc leaves it, keeping the draft;
// - the composer's text box, placed through `kit.textBox(parent)`;
// - the scrolling: it scrolls the first `.is-cursor` of the side bar and of the log into view;
// - every redraw: on each change of the rooms, of the cursors, the shown thread or the composer.
// The clicks run commands through the kit: a thread row runs `chatroom.openThreadRow` with its `arg`, a row badge
// `chatroom.openRowRoom` with its `rowId`, and the composer's Send button `chatroom.send`.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

// One thread of a room. `label` is the thread's name, or `<session title> (session)` for a session's own thread.
// `unread` counts the user's unread posts in it and `mentions` those addressed to the user. `isCursor` is true on
// the one row the keyboard cursor is on while the side bar holds the keys; `isOpen` on the thread the sheet shows.
// `arg` is the `chatroom.openThreadRow` argument that opens it.
export interface ThreadRowInput {
  label: string;
  resolved: boolean;
  unread: number;
  mentions: number;
  isCursor: boolean;
  isOpen: boolean;
  arg: string;
}

// One room and its threads: the open ones newest first, then the resolved ones, newest first.
export interface RoomGroupInput {
  room: string;
  threads: ThreadRowInput[];
}

// The side bar: every room by name. `preview` is true while the layout preview's sample shows.
export interface SideBarInput {
  rooms: RoomGroupInput[];
  preview: boolean;
}

// One session of the room's board. `harness` is the harness's label (`Claude Code`), null when unknown. `state` is
// `working`, `idle`, `waiting`, `done`, `connected` or `gone`. `clone` reads `Unity 3` while the session works in a
// pool clone. `uncommitted` counts the clone's changed files and `claims` holds each claim's target in words.
export interface BoardLineInput {
  name: string;
  harness: string | null;
  state: string;
  branch: string | null;
  clone: string | null;
  uncommitted: number;
  claims: string[];
}

// The sheet's head: the room's board, then the shown thread's label, null while no thread shows. `room` is null
// while no room shows, when the part draws what to do instead. The log's `i compose` and `r reply` hints go in the
// thread's heading: `kit.keyHint(parent, 'compose', { label: true })`.
export interface BoardInput {
  room: string | null;
  thread: string | null;
  rows: BoardLineInput[];
  preview: boolean;
}

// One message of the log. `sender` is the sender's name, `you` for the user's word. `kind` is the post or entry
// kind (`question`, `dispatch` …), `quiet` true for an entry or `progress`, which draw dim. `time` is `HH:MM`.
// `body` is markdown: draw it with `kit.markdown`. `to` names the addressed participants, empty for the thread.
// `replyTo` is the id the message answers, drawn as `↪ #<id>`. `isCursor` is true on the log cursor's message while
// the log holds the keys; `canReply` on a question or blocker, which the cursor row's `r` prompt answers:
// `kit.keyHint(parent, 'reply', { label: true })`.
export interface MessageInput {
  id: number;
  sender: string;
  kind: string;
  quiet: boolean;
  time: string;
  body: string;
  refs: { type: string; value: string }[];
  to: string[];
  replyTo: number | null;
  isCursor: boolean;
  canReply: boolean;
}

// The composer under the log. `answerTo` is the id the post answers, null for a note to the thread. `error` is the
// room's refusal of the last send, null when none. `preview` is true while the preview's sample shows, when Send
// posts nothing. Place the box with `kit.textBox(parent)` and Send with
// `kit.button(parent, 'Send', 'chatroom.send')`, its `↩` hint drawn with `kit.keyHint(button, 'send')`.
export interface ComposerInput {
  answerTo: number | null;
  error: string | null;
  preview: boolean;
}

// The badge under a session row: `@2` while two unread posts are addressed to the user, else `3 new`. `isMention`
// is true for the first form. `rowId` is the `chatroom.openRowRoom` argument a click runs.
export interface RowBadgeInput {
  text: string;
  isMention: boolean;
  rowId: string;
}

// The kit every chatroom part gets.
export interface ChatroomKit extends BaseKit {}

// The composer's kit: `textBox` appends the app's text box to `parent` and returns it; a box the part leaves out
// goes at the end of its root.
export interface ComposerKit extends ChatroomKit {
  textBox(parent: HTMLElement): HTMLElement;
}

// What a part returns: its root, appended to `parent`.
export interface ChatroomPart {
  element: HTMLElement;
}

// Each part comes from the first layout that defines it among the `chatroom.layout` setting and `default`; a part
// that throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default`
// instead.
export interface Layout {
  sideBar?(
    parent: HTMLElement,
    input: SideBarInput,
    kit: ChatroomKit,
  ): ChatroomPart;
  board?(
    parent: HTMLElement,
    input: BoardInput,
    kit: ChatroomKit,
  ): ChatroomPart;
  message?(
    parent: HTMLElement,
    input: MessageInput,
    kit: ChatroomKit,
  ): ChatroomPart;
  composer?(
    parent: HTMLElement,
    input: ComposerInput,
    kit: ComposerKit,
  ): ChatroomPart;
  rowBadge?(
    parent: HTMLElement,
    input: RowBadgeInput,
    kit: ChatroomKit,
  ): ChatroomPart;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
