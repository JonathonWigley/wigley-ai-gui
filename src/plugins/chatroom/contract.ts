import type { Disposable } from '../../contracts/disposable';
import type { DependencyKey } from '../../contracts/plugin';

// What an agent posts in a room.
export type PostKind =
  | 'question'
  | 'answer'
  | 'blocker'
  | 'heads-up'
  | 'handoff'
  | 'decision'
  | 'result'
  | 'progress'
  | 'note';

// What the app writes in a room and an agent never posts.
export type EntryKind = 'dispatch' | 'hand-back' | 'joined' | 'left';

export const POST_KINDS: readonly PostKind[] = [
  'question',
  'answer',
  'blocker',
  'heads-up',
  'handoff',
  'decision',
  'result',
  'progress',
  'note',
];

export const ENTRY_KINDS: readonly EntryKind[] = [
  'dispatch',
  'hand-back',
  'joined',
  'left',
];

export interface Participant {
  readonly kind: 'agent' | 'human' | 'system' | 'mirror';
  readonly rowId: string | null; // the session row, for an agent
  readonly agentId: string | null; // null for a main agent, the subagent's id otherwise
  readonly mirrorId: string | null;
  readonly name: string; // the session title, `Title ▸ type` for a subagent, `you`, `system`
}

export const USER_PARTICIPANT: Participant = {
  kind: 'human',
  rowId: null,
  agentId: null,
  mirrorId: null,
  name: 'you',
};

export const SYSTEM_PARTICIPANT: Participant = {
  kind: 'system',
  rowId: null,
  agentId: null,
  mirrorId: null,
  name: 'system',
};

// One string per participant, the same for every message it sends:
// `agent:<rowId>:<agentId or main>`, `human`, `system` or `mirror:<mirrorId>`.
export function participantKey(participant: Participant): string {
  switch (participant.kind) {
    case 'agent':
      return `agent:${participant.rowId}:${participant.agentId ?? 'main'}`;
    case 'human':
      return 'human';
    case 'system':
      return 'system';
    case 'mirror':
      return `mirror:${participant.mirrorId}`;
  }
}

export interface MessageRef {
  readonly type: 'file' | 'branch' | 'commit' | 'plan' | 'message';
  readonly value: string;
}

export interface RoomMessage {
  readonly id: number; // given by the store, monotonic per room
  readonly room: string;
  readonly thread: string;
  readonly from: Participant;
  readonly to: readonly Participant[];
  readonly kind: PostKind | EntryKind;
  readonly body: string;
  readonly refs: readonly MessageRef[];
  readonly replyTo: number | null;
  readonly answerBy: number | null; // epoch ms
  readonly onNoAnswer: string | null;
  readonly key: string | null;
  readonly at: number; // epoch ms, from the injected clock
  // True only for a post main stamped from the viewer, or the human post of a
  // mirror that declares `verified`.
  readonly userWord: boolean;
}

export type NewMessage = Omit<RoomMessage, 'id'>;

// The rooms' messages. `append` gives the message the room's next id, 1 for
// a room's first, and rejects, using no id, when the room name is empty or
// the write fails; appends to one room never share an id. `read` returns the
// room's messages above `afterId` in id order, `[]` for a room with none.
// `rooms` returns each room holding a message, in plain string order.
export interface RoomStore {
  append(message: NewMessage): Promise<RoomMessage>;
  read(room: string, afterId: number): Promise<RoomMessage[]>;
  rooms(): Promise<string[]>;
}

export type ClaimTarget =
  | { readonly paths: readonly string[] }
  | { readonly branch: string }
  | { readonly resource: string };

export interface Claim {
  readonly id: string;
  readonly room: string;
  readonly holder: Participant;
  readonly target: ClaimTarget;
  readonly reason: string;
  readonly expiresAt: number;
}

// A session's state on the board. `connected` and `gone` are a terminal or
// Codex session's, which has no app row: its connection is open or closed.
export type BoardState =
  | 'working'
  | 'idle'
  | 'waiting'
  | 'done'
  | 'connected'
  | 'gone';

// The unity-pool clone a session works in, and who holds it: `this` the
// session, `other` another session, `user` a hold, `none` no claim.
export interface BoardClone {
  readonly pool: string;
  readonly number: number;
  readonly holder: 'this' | 'other' | 'user' | 'none';
}

// A changed file of the session's clone, `/`-separated below its top folder,
// with the session whose agent last wrote it; both null when no session did.
// `by` is `an ended session` for a row no longer on any board.
export interface BoardFile {
  readonly path: string;
  readonly byRowId: string | null;
  readonly by: string | null;
}

// One session of a room's board. `harness` is the harness id (`claude`,
// `codex`), never a label; null when none is known. `uncommitted` and
// `unpushedPaths` list their first files in plain string order, and the
// `More` counts give the files left out. `unpushedPaths` is null when the
// clone has no upstream or the board has no git state for it.
export interface BoardRow {
  readonly rowId: string;
  readonly name: string;
  readonly harness: string | null;
  readonly state: BoardState;
  readonly folder: string | null;
  readonly branch: string | null;
  readonly clone: BoardClone | null;
  readonly uncommitted: readonly BoardFile[];
  readonly uncommittedMore: number;
  readonly unpushedPaths: readonly string[] | null;
  readonly unpushedMore: number;
  readonly claims: readonly Claim[];
}

// Copies the room out to a cloud service and brings the user's replies back.
export interface ChatroomMirror {
  readonly id: string;
  readonly verified: boolean;
  publish(message: RoomMessage): Promise<void>;
  onHumanMessage(
    listener: (room: string, thread: string, body: string) => void,
  ): Disposable;
}

export interface ChatroomMainExports {
  addMirror(mirror: ChatroomMirror): Disposable;
}

export const chatroomMainKey: DependencyKey<
  ChatroomMainExports,
  'main',
  'chatroom'
> = { id: 'chatroom', process: 'main' };
