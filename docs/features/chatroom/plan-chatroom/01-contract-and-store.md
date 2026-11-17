# 01 — Contract and room store

Status: not started
Type: Task
Rung: deep · sets the jsonl save format and serializes concurrent appends, and adds the contract every later task consumes
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chatroom/contract.ts` · create `src/plugins/chatroom/main/room-store.ts` · create `src/plugins/chatroom/main/jsonl-room-store.ts` · create `src/plugins/chatroom/main/memory-room-store.ts` · create `src/plugins/chatroom/main/room-store.test-support.ts` · test `src/plugins/chatroom/main/room-store.test.ts` · test `src/plugins/chatroom/main/jsonl-room-store.test.ts` · test `src/plugins/chatroom/main/memory-room-store.test.ts`
Consumes:  `Files` (`read`, `append`, `list`) and `readIfPresent` in `src/contracts/files.ts` · `PluginLog` in `src/contracts/log.ts` · `Disposable` in `src/contracts/disposable.ts` · `DependencyKey` in `src/contracts/plugin.ts` · `createSerialQueue(): SerialQueue` in `src/shared/serial-queue.ts` · `createMemoryFiles()` in `src/shared/memory-files.ts` (tests)
Produces:  in `src/plugins/chatroom/contract.ts`, every name in plan.md § File Structure under "Shared names", word for word: `PostKind`, `EntryKind`, `Participant`, `MessageRef`, `RoomMessage`, `NewMessage`, `RoomStore`, `ClaimTarget`, `Claim`, `ChatroomMirror`, `ChatroomMainExports`, `chatroomMainKey`. Also:
           `export const POST_KINDS: readonly PostKind[]` — the nine post kinds, in the order of the plan's union
           `export const ENTRY_KINDS: readonly EntryKind[]` — the four entry kinds, in the order of the plan's union
           `export const USER_PARTICIPANT: Participant` — `{ kind: 'human', rowId: null, agentId: null, mirrorId: null, name: 'you' }`
           `export const SYSTEM_PARTICIPANT: Participant` — `{ kind: 'system', rowId: null, agentId: null, mirrorId: null, name: 'system' }`
           `export function participantKey(participant: Participant): string` — `agent:<rowId>:<agentId or main>`, `human`, `system`, `mirror:<mirrorId>`
           in `src/plugins/chatroom/main/room-store.ts`:
           `export const ROOMS_FOLDER = 'rooms'`
           `export function roomFileName(room: string): string`
           `export function roomOfFileName(fileName: string): string | null`
           in `src/plugins/chatroom/main/jsonl-room-store.ts`:
           `export function createJsonlRoomStore(deps: { files: Pick<Files, 'read' | 'append' | 'list'>; log: PluginLog }): RoomStore`
           in `src/plugins/chatroom/main/memory-room-store.ts`:
           `export function createMemoryRoomStore(): RoomStore`
           in `src/plugins/chatroom/main/room-store.test-support.ts`:
           `export function describeRoomStoreContract(current: () => RoomStore): void`
Decisions: the plan's shared names are exact: copy them from plan.md § File Structure, `readonly` fields included (plan.md).
           `chatroomMainKey` is `{ id: 'chatroom', process: 'main' }`, the shape of `sessionsMainKey` in `src/plugins/sessions/contract.ts`.
           The comment on `RoomMessage.userWord` reads: true only for a post main stamped from the viewer, or the human post of a mirror that declares `verified` (design.md § Mirrors; task 05 sets it).
           Put no `BoardRow`, `RoomView` or slot key in the contract. Tasks 06 and 08 add them (plan.md).
           The store gives ids. The first message of a room gets id 1. Each next message of that room gets the last id plus 1. Ids of two rooms are independent (design.md § Store).
           Appends to one room run one at a time, in call order, through one `createSerialQueue()` per room. Two appends that are not awaited in turn never get the same id and never interleave in the file.
           `append` rejects when the write fails. A failed append uses no id: the next append gets the id the failed one would have had.
           `read(room, afterId)` returns the room's messages with an id above `afterId`, in id order. A room with no messages returns `[]`.
           `rooms()` returns each room that holds at least one message, sorted in plain string order (`<`, not `localeCompare`).
           A room name of `''` is refused: `roomFileName('')` throws, and `append` rejects for it.
           File name of a room: `roomFileName` keeps each of `a`–`z`, `0`–`9`, `_` and `-`. It writes every other character as `%` plus two uppercase hex digits for each of its UTF-8 bytes, then adds `.jsonl`. Uppercase letters and `.` are encoded too, so no name holds `..` or `/`, and two rooms never share a file on a case-insensitive volume. `roomOfFileName` reverses it; a name without `.jsonl`, or with a `%` not followed by two uppercase hex digits, or with bytes that are not UTF-8, returns null.
           The jsonl adapter writes one room to `rooms/<roomFileName(room)>` in plugin data (`api.data`, AGENTS.md § Plugin data). Each line is the JSON of one `RoomMessage`, the id included, then `\n`.
           The jsonl adapter reads a room's file once, at the first `append` or `read` of that room, and keeps its messages in memory after that. Main is the only writer of the folder, and each app instance has its own data folder (design.md § Store).
           A line that does not parse, or is not a whole `RoomMessage` (every field of the plan's interface, with its type), is skipped and logged as `rooms/<file> line <n> skipped: not a whole message`. Ids continue from the highest id of a whole line.
           A cut last line: the first append to a room file in an app run, and the first append after a failed append, starts with `\n`. This is the pattern of `createSessionEventLog` in `src/plugins/session-log/main/session-event-log.ts`.
           `rooms()` of the jsonl adapter lists `rooms/`, keeps each file whose `roomOfFileName` is not null, and adds the rooms it holds in memory.
           The memory adapter keeps the same rules in a `Map` and touches no file.
           The shared suite follows `describeFilesContract` in `src/shared/files-contract.test-support.ts`: one `describe('RoomStore contract')`, and `current()` called in each test.
GIVEN an empty room WHEN three messages are appended THEN they get ids 1, 2 and 3
GIVEN rooms `a` and `b` WHEN messages are appended to both THEN each room counts its own ids from 1
GIVEN 20 appends to one room not awaited in turn WHEN all settle THEN the ids are 1 to 20, each once, and `read(room, 0)` returns 20 messages in id order
GIVEN a room with ids 1 to 5 WHEN `read(room, 3)` runs THEN it returns ids 4 and 5
GIVEN a jsonl store with messages WHEN a new store opens the same files THEN it reads the messages and the next id continues after the highest
GIVEN a room file whose last line is cut WHEN a new store appends THEN the cut line is skipped and logged, and the new line parses
GIVEN the room name `../x` WHEN a message is appended THEN the file is `rooms/%2E%2E%2Fx.jsonl` and `rooms()` returns `../x`
Tests:     `describeRoomStoreContract` in `room-store.test-support.ts` holds these cases; `jsonl-room-store.test.ts` and `memory-room-store.test.ts` each run it, the jsonl one over `createMemoryFiles()`:
           - `append_AssignsIdsPerRoom` — rows: one room with three appends → ids `[1, 2, 3]`; rooms `a`, `b`, `a` interleaved → `a` gets `[1, 2]`, `b` gets `[1]`.
           - `append_ReturnsTheMessageWithItsId` — the result equals the input plus `id`; every field round-trips through `read`, with two `to` participants, two `refs`, a non-null `replyTo`, `answerBy`, `onNoAnswer` and `key`, and `userWord` true.
           - `append_Concurrent_GetsDistinctIdsInOrder` — 20 appends started together; the ids are 1 to 20 each once; `read(room, 0)` lists them in id order with the bodies matching their ids.
           - `read_AfterId` — rows: afterId 0 → all five; afterId 3 → ids 4, 5; afterId 5 → `[]`; unknown room → `[]`.
           - `rooms_ListsRoomsWithMessagesSorted` — rooms `b`, `Shop Revamp`, `a`, `é` appended in that order → `['Shop Revamp', 'a', 'b', 'é']` (plain `<` order); an empty store → `[]`.
           - `append_EmptyRoom_Rejects` — the append rejects and `rooms()` stays `[]`.
           `room-store.test.ts`:
           - `roomFileName_EncodesUnsafeCharacters` — rows: `shop` → `shop.jsonl`; `new-games_2` → `new-games_2.jsonl`; `Shop Revamp` → `%53hop%20%52evamp.jsonl`; `../x` → `%2E%2E%2Fx.jsonl`; `é` → `%C3%A9.jsonl`. Each row also asserts `roomOfFileName` of the result returns the room.
           - `roomOfFileName_NotARoomFile_Null` — rows: `notes.txt`, `%2.jsonl`, `%2e.jsonl`, `%FF.jsonl`, `.jsonl`.
           `jsonl-room-store.test.ts`, beside the shared suite:
           - `reopen_ContinuesIds` — store one appends ids 1 and 2; store two over the same files reads both and appends id 3.
           - `reopen_SkipsBrokenLines` — rows: a cut last line; a line `{}`; a line that is not JSON. Each: the whole lines read back, the log names the file and the line number, and the next append parses on a new line with the next id.
           - `append_WriteFails_RejectsAndUsesNoId` — a files fake whose first `append` rejects: the first append rejects; the next append resolves with id 1 and leads with `\n`.
           - `append_UnsafeRoom_StaysUnderRooms` — the room `../x` writes only `rooms/%2E%2E%2Fx.jsonl`.
Done when: compiles; the layer check passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof
