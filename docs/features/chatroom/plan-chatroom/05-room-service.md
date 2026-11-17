# 05 — Room service

Status: not started
Type: Task
Rung: deep · keeps cursors, claims and threads in save files, serializes concurrent posts per room, and fans out to mirrors asynchronously
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chatroom/main/room-service.ts` · create `src/plugins/chatroom/main/claim-paths.ts` · test `src/plugins/chatroom/main/room-service.test.ts` · test `src/plugins/chatroom/main/claim-paths.test.ts`
Consumes:  `RoomStore`, `RoomMessage`, `NewMessage`, `Participant`, `PostKind`, `EntryKind`, `MessageRef`, `ClaimTarget`, `Claim`, `ChatroomMirror`, `POST_KINDS`, `USER_PARTICIPANT`, `participantKey(participant: Participant): string` ← 01
           `createMemoryRoomStore(): RoomStore` ← 01 (tests)
           `Clock`, `RandomHex` in `src/contracts/ambient.ts` · `Files` and `readIfPresent` in `src/contracts/files.ts` · `PluginLog` in `src/contracts/log.ts` · `Disposable` in `src/contracts/disposable.ts` · `createSerialQueue(): SerialQueue` in `src/shared/serial-queue.ts` · `createMemoryFiles(clock?)` in `src/shared/memory-files.ts` (tests)
Produces:  in `src/plugins/chatroom/main/room-service.ts`:
           `export interface ChatroomLimits { readonly bodyCap: number; readonly postsPerMinute: number; readonly claimMinutes: number }`
           `export interface RoomServiceDeps { readonly store: RoomStore; readonly files: Pick<Files, 'read' | 'write'>; readonly clock: Clock; readonly randomHex: RandomHex; limits(): ChatroomLimits; participants(room: string): readonly Participant[]; readonly log: PluginLog }`
           `export interface PostRequest { readonly room: string; readonly from: Participant; readonly kind: PostKind; readonly body: string; readonly to: readonly string[]; readonly thread: string | null; readonly refs: readonly MessageRef[]; readonly replyTo: number | null; readonly answerBy: number | null; readonly onNoAnswer: string | null; readonly key: string | null }`
           `export type HumanPostRequest = Omit<PostRequest, 'from'>`
           `export type PostResult = { readonly ok: true; readonly id: number; readonly duplicate: boolean } | { readonly ok: false; readonly reason: string }`
           `export interface EntryRequest { readonly room: string; readonly thread: string; readonly from: Participant; readonly kind: EntryKind; readonly body: string; readonly refs: readonly MessageRef[] }`
           `export type ReadQuery = { readonly kind: 'unread' } | { readonly kind: 'thread'; readonly thread: string } | { readonly kind: 'message'; readonly id: number }`
           `export interface ReadItem { readonly id: number; readonly thread: string; readonly from: string; readonly to: readonly string[]; readonly kind: PostKind | EntryKind; readonly text: string; readonly refs: readonly MessageRef[]; readonly replyTo: number | null; readonly answerBy: number | null; readonly onNoAnswer: string | null; readonly at: number }`
           `export type ReadResult = { readonly ok: true; readonly items: readonly ReadItem[] } | { readonly ok: false; readonly reason: string }`
           `export interface ThreadSummary { readonly thread: string; readonly resolved: boolean; readonly count: number; readonly lastId: number; readonly lastAt: number }`
           `export interface ClaimRequest { readonly room: string; readonly holder: Participant; readonly target: ClaimTarget; readonly reason: string; readonly minutes: number | null }`
           `export type ClaimResult = { readonly ok: true; readonly claim: Claim; readonly overlaps: readonly Claim[] } | { readonly ok: false; readonly reason: string }`
           `export type ReleaseResult = { readonly ok: true; readonly released: readonly Claim[] } | { readonly ok: false; readonly reason: string }`
           `export interface RoomService {`
           `  post(request: PostRequest): Promise<PostResult>;`
           `  postHuman(request: HumanPostRequest): Promise<PostResult>;`
           `  addEntry(entry: EntryRequest): Promise<RoomMessage>;`
           `  read(room: string, reader: Participant, query: ReadQuery): Promise<ReadResult>;`
           `  unreadAddressed(room: string, reader: Participant): Promise<RoomMessage[]>;`
           `  userUnread(room: string): Promise<RoomMessage[]>;`
           `  markUserRead(room: string, thread: string, upToId: number): Promise<void>;`
           `  rooms(): Promise<string[]>;`
           `  messages(room: string, afterId: number): Promise<RoomMessage[]>;`
           `  threads(room: string): Promise<ThreadSummary[]>;`
           `  resolveThread(room: string, thread: string): Promise<void>;`
           `  claim(request: ClaimRequest): Promise<ClaimResult>;`
           `  release(room: string, holder: Participant, claimId: string | null): Promise<ReleaseResult>;`
           `  claims(room: string): Promise<Claim[]>;`
           `  claimsTouching(room: string, target: ClaimTarget, asker: Participant): Promise<Claim[]>;`
           `  endClaimsOf(rowId: string): Promise<Claim[]>;`
           `  addMirror(mirror: ChatroomMirror): Disposable;`
           `  onMessage(listener: (message: RoomMessage) => void): Disposable;`
           `  settled(): Promise<void>;`
           `}`
           `export function createRoomService(deps: RoomServiceDeps): RoomService`
           in `src/plugins/chatroom/main/claim-paths.ts`:
           `export function matchesClaimPattern(pattern: string, path: string): boolean`
           `export function claimPathsOverlap(a: readonly string[], b: readonly string[]): boolean`
           `export function normalizeClaimPath(path: string): string | null`
Decisions: Only this module writes through `RoomStore` (plan.md § Boundary rules). The clock and claim ids come from `deps.clock` and `deps.randomHex`, which task 08 fills from `api.services` (AGENTS.md § An ambient service).
           `limits()` is read at each call, so a settings change applies to the next post. Task 08 fills it from the plugin settings `bodyCap` 1500, `postsPerMinute` 10 and `claimMinutes` 30 (plan.md, agent-decided).
           `participants(room)` returns the main agents of the room's live sessions and `USER_PARTICIPANT`. Task 08 fills it from the session rows and their titles. A subagent is never a target of `to` (design.md § The model: agents address each other by session title).
           Per room, `post`, `postHuman` and `addEntry` run one at a time in call order, through one `createSerialQueue()` per room, so each guard sees every earlier post.
           **Post: checks in this order.** The first check that fails returns `{ ok: false, reason }` and writes nothing:
           1. `kind` is one of `POST_KINDS`. An entry kind is refused: `<kind> is an entry the app writes; post one of <the nine kinds>`.
           2. `body` trimmed is not empty, and its length is at most `limits().bodyCap`. Over the cap the reason is `body is <n> characters, over the cap of <cap>: put the content in a file and post its path with a short summary` (design.md § Guards).
           3. Each `refs` item has a `type` of `file`, `branch`, `commit`, `plan` or `message`, and a `value` that is not empty after a trim.
           4. `replyTo`, when set, names a message id in the room. An `answer` must set `replyTo`.
           5. A `question` names at least one target in `to`. `answerBy` and `onNoAnswer` are refused on every other kind. `answerBy` must be later than `clock.now()`.
           6. Each `to` name matches, trimmed and case-insensitively, the `name` of exactly one participant from `participants(room)`. No match or more than one match is refused: `no participant named "<name>"` or `"<name>" names <n> participants`, then `; the room holds: <names, comma-separated, in participants order>`.
           7. Thread (see below) is valid.
           8. Idempotency: an earlier message in the room with the same `participantKey(from)` and the same non-null `key` returns `{ ok: true, id: <that id>, duplicate: true }` and writes nothing.
           9. Identical body: an earlier message from the same `participantKey(from)`, with the same `body`, whose `at` is less than 2 minutes (120000 ms) before now, is dropped: `dropped: the same body was posted as #<id> <s> seconds ago`.
           10. Rate cap: when the sender already has `limits().postsPerMinute` messages with `at` greater than now minus 60000 ms, the post is refused: `rate cap: <cap> posts a minute; wait <s> seconds`, where `<s>` is the seconds until the oldest of those leaves the window, rounded up.
           Steps 9 and 10 apply to agent and mirror senders only. `postHuman` skips them: the user is not capped.
           The guards read the room's messages through `store.read(room, 0)`. They keep no state of their own.
           **Thread.** An explicit `thread` is trimmed and must be 1 to 80 characters with no line break. With `thread` null: the thread of the `replyTo` message when `replyTo` is set; else `session:<from.rowId>` for an agent sender; else `general`.
           A post (not an entry) into a resolved thread opens the thread again.
           **Stamping.** `at` is `clock.now()`. `to` holds the matched participants. `post` sets `userWord` false. `postHuman` sets `from` to `USER_PARTICIPANT` and `userWord` true, so an agent cannot forge the user's word (design.md § The user in the room). `PostRequest` has no `userWord` field.
           **Mirror human input.** `addMirror` hears the mirror's `onHumanMessage(room, thread, body)` and posts a `note` from `{ kind: 'mirror', rowId: null, agentId: null, mirrorId: mirror.id, name: 'you via <mirror.id>' }` into that thread, through the same checks as `post`, with `userWord` equal to `mirror.verified`. An unverified mirror's post is information only (design.md § Mirrors). A refused mirror post is logged as `mirror <id> post refused: <reason>`.
           **Entries.** `addEntry` runs no check and no guard. A body longer than `limits().bodyCap` is cut to `bodyCap - 1` characters plus `…`. `to` is `[]`, `userWord` false, the other fields null. An entry never opens a resolved thread.
           **Fan-out.** After each append (post, human post, mirror post, entry), the service calls every `onMessage` listener with the new message, then each registered mirror's `publish`, except the mirror the message came from. A listener that throws, and a `publish` that rejects, is logged as `mirror <id> publish failed: <error>`; the post still succeeds. The disposable from `addMirror` stops the mirror's publish and disposes its `onHumanMessage` subscription.
           **Read.** A reader's cursor is the last message id it read in a room, 0 when none. `cursors.json` in plugin data holds `{ "<room>": { "<participantKey>": <id> } }`.
           `unread` returns the messages above the cursor that are not entries, not `progress`, not from the reader (same `participantKey`), and either name the reader in `to` (same `participantKey`) or sit in an open thread the reader takes part in. A reader takes part in a thread when it posted there or a message there names it in `to`. A main agent (`agentId` null) always takes part in `session:<rowId>`. Then the cursor moves to the room's highest id. `text` is the first non-blank line of the body, cut to 200 characters with `…`.
           **The user's reads.** The user reads in the viewer one thread at a time, so the user has a cursor per thread: `user-cursors.json` in plugin data holds `{ "<room>": { "<thread>": <id> } }`. `userUnread(room)` returns the room's messages above their thread's user cursor that are not entries, not `progress` and not from `USER_PARTICIPANT`, in id order. `markUserRead(room, thread, upToId)` sets that thread's cursor to `upToId` when it is higher. Task 08 builds the viewer's counts from these. The user is never an agent reader, so `read` and `cursors.json` never hold the user.
           `thread` returns every message of that thread whole, entries and `progress` included; for `thread` and `message`, `ReadItem.text` is the whole body. `message` returns one message whole; an id not in the room is refused `no message #<id> in <room>`. Neither moves the cursor.
           `ReadItem.from` is the sender's `name`; `ReadItem.to` is the targets' names.
           `unreadAddressed` returns the messages above the cursor that name the reader in `to` and are not from the reader. It does not move the cursor. Task 08 uses it for the hook line and the idle send (design.md § Delivery).
           **Threads.** `threads.json` in plugin data holds `{ "<room>": ["<resolved thread>", …] }`. `threads(room)` returns one summary per thread that holds a message, ordered by `lastId`, newest first. `resolveThread` adds the thread to the list. No agent tool resolves a thread in this plan; the viewer (task 09) is the caller.
           **Claims.** `claims.json` in plugin data holds every live claim of every room as a `Claim[]`. A claim with `expiresAt` at or before now is dropped at each read or write of the claims.
           `claim` validates: `reason` trimmed not empty; `minutes` null or a finite number above 0; a `paths` target holds at least one path, each made by `normalizeClaimPath`, and a null result refuses the claim (`<path> is not a repo-relative path`); a `branch` or `resource` is not empty after a trim.
           `expiresAt` is now plus `(minutes ?? limits().claimMinutes) * 60000`.
           Renew: when the holder (same `participantKey`) already holds a claim in the room with an equal target (same kind; paths equal as sorted lists; branch or resource equal), the claim keeps its id and gets the new `expiresAt` and `reason`. Else the new claim gets the id `randomHex()`.
           Overlap: two targets overlap when both are paths and `claimPathsOverlap` is true, both are branches and equal, or both are resources and equal. Targets of two kinds never overlap. `overlaps` and `claimsTouching` list the live claims in the room that overlap the target, held by another session: a claim whose `holder.rowId` equals the asker's `rowId` is left out, so a lead and its workers never warn each other.
           `release` with an id ends that claim; an id held by another participant is refused `claim <id> is held by <name>`; an unknown id is refused `no claim <id>`. `release` with null ends every claim of the holder in the room. Claims are advisory and never block (design.md § Claims).
           `endClaimsOf(rowId)` ends every claim whose `holder.rowId` is `rowId`, in every room, and returns them. Task 08 calls it at the session's end.
           **Claim paths.** Claim paths are repo-relative and `/`-separated, so clones of one pool compare the same file (design.md § The model: a pool's clones share a room). Task 08 makes the hook's full paths repo-relative before it asks.
           `normalizeClaimPath` trims, turns `\` into `/`, drops a leading `./`, and returns null for an empty path, an absolute path (leading `/` or a drive letter), or a path with a `..` segment.
           `matchesClaimPattern`: `**` matches any number of whole segments, zero included; `*` matches any characters inside one segment; `?` matches one character that is not `/`; every other character matches itself. No braces and no classes. No glob library: the tree has none, and an install needs the user's yes.
           `claimPathsOverlap(a, b)` is true when any pattern of `a` overlaps any pattern of `b`. A pattern with no `*` or `?` is a literal. Two literals overlap when equal. A literal and a pattern overlap when the pattern matches the literal. Two patterns overlap when the part before the first `*` or `?` of one is a prefix of the same part of the other. This can warn on two patterns that share no file; a claim is advisory, so a false warning costs one question.
           **Files.** Cursors, threads and claims load at first use. A file that is missing reads as empty. A file that does not parse reads as empty and is logged as `<file> unreadable, starting empty`. Each change writes the whole file through `files.write`, one write at a time per file through a `createSerialQueue()`. `settled()` resolves once every queued append and file write has settled.
GIVEN a post with a body of 1501 characters and `bodyCap` 1500 WHEN it is posted THEN it is refused naming 1501 and 1500, and nothing is written
GIVEN `to: ['shop revamp']` and a participant `Shop Revamp` WHEN posted THEN `to` holds that participant
GIVEN a post with key `k1` already in the room from the same sender WHEN posted again with `k1` THEN it returns the first id with `duplicate: true`
GIVEN the same body from the same sender 119 seconds later WHEN posted THEN it is dropped naming the first id
GIVEN 10 posts from one agent in the last minute WHEN it posts again THEN it is refused with the wait in seconds
GIVEN an unverified mirror WHEN its human posts THEN the message has `userWord` false; a verified mirror's has true
GIVEN a reader with a message addressed to it, a `progress` in its thread and an entry WHEN it reads unread THEN it gets only the addressed message, and a second read returns nothing
GIVEN a claim on `src/a/**` by session A WHEN session B claims `src/a/b.ts` THEN B's claim is made and `overlaps` holds A's claim
GIVEN a claim that expired WHEN `claims(room)` runs THEN it is not listed
Tests:     `room-service.test.ts`, over `createMemoryRoomStore()`, `createMemoryFiles()`, a clock fake with a settable `now`, a counting `randomHex` fake, `limits` `{ bodyCap: 1500, postsPerMinute: 10, claimMinutes: 30 }`, and participants `Shop Revamp`, `Docs Fix`, `Docs Fix` (two sessions, one title) and `you`:
           - `post_Refused` — one row per check 1–7: kind `dispatch`; body `'  '`; body of 1501 characters (reason holds `1501` and `1500`); ref type `url`; `replyTo` 99 not in the room; `answer` with no `replyTo`; `question` with empty `to`; `answerBy` on a `note`; `answerBy` before now; `to: ['Nobody']` (reason lists `Shop Revamp, Docs Fix, Docs Fix, you`); `to: ['docs fix']` (reason says 2 participants); thread of 81 characters; thread `a\nb`. Each row: `ok` false, the reason holds the row's text, and `store.read(room, 0)` is `[]`.
           - `post_BodyCap_Boundary` — rows: 1500 characters → accepted; 1501 → refused.
           - `post_Stamps` — `to: [' shop revamp ']` resolves to the `Shop Revamp` participant; `at` is the clock's now; `userWord` false; the id is the store's.
           - `post_DefaultThread` — rows: explicit `plan-x` → `plan-x`; `replyTo` a message in `plan-x` → `plan-x`; agent of row `r1` with neither → `session:r1`; `postHuman` with neither → `general`.
           - `post_Key_ReturnsTheFirstId` — rows: same sender, same key → first id, `duplicate` true, one message stored; another sender, same key → new id; same sender, null key twice with different bodies → two ids.
           - `post_Key_Concurrent_WritesOnce` — two posts with one key, not awaited in turn → both return the same id; one message stored.
           - `post_IdenticalBody` — rows: same sender at +119999 ms → dropped naming `#1`; at +120000 ms → accepted; another sender at +1 ms → accepted; same sender, other body → accepted; two `postHuman` calls with one body 1 ms apart → both accepted.
           - `post_RateCap` — 10 posts with different bodies, 1 s apart from +0 s, are accepted; the 11th at +10 s is refused with `wait 50 seconds`; at +60 s from the first it is accepted; `postHuman` 11 times in a second is accepted.
           - `post_UserWord` — rows: `post` → false and `from` as given; `postHuman` → true and `from` is `USER_PARTICIPANT`; unverified mirror's human message → false, `from.mirrorId` the mirror's id; verified mirror → true.
           - `post_IntoResolvedThread_OpensIt` — after `resolveThread`, a post opens it; an `addEntry` does not.
           - `addEntry_SkipsChecksAndCutsBody` — a `dispatch` entry with a 1600-character body and a sender over the rate cap is written; its body is 1500 characters ending in `…`.
           - `read_Unread` — one room built with: a `question` to reader A from B; a `note` in A's thread `session:rA`; a `progress` in `session:rA`; a `dispatch` entry in `session:rA`; A's own `note`; a `note` in a thread B posted in and A never did; a `note` in a resolved thread A posted in. A's first unread read returns the question and the `session:rA` note, in id order, each `text` the first line; a second read returns `[]`.
           - `read_TextIsFirstLineCut` — rows: `'\n\nfirst\nsecond'` → `first`; a first line of 250 characters → 200 characters ending in `…`.
           - `read_CursorSurvivesANewService` — a second service over the same files and store returns `[]` for the unread read the first service made.
           - `read_ThreadAndMessage` — rows: `thread: 'session:rA'` → every message of it whole, entries and `progress` included; `message` 2 → that one whole; `message` 99 → refused `no message #99 in <room>`. The cursor does not move.
           - `unreadAddressed_CountsOnlyNamed` — a question to A, a note to the thread, A's own post to A → returns the question; the cursor does not move.
           - `userUnread_PerThread` — threads `t1` (a note from A, a `progress`, an entry, a `postHuman`) and `t2` (a question to `you`): first call → the note and the question; after `markUserRead(room, 't1', <note id>)` → the question only; `markUserRead` with a lower id leaves the cursor; a new service over the same files returns the same.
           - `threads_Summaries` — two threads, one resolved → two summaries, newest `lastId` first, with counts and `resolved`.
           - `claim_ExpiryAndRenew` — rows: `minutes` null → `expiresAt` now + 1800000; `minutes` 5 → now + 300000; same holder and same paths in another order → same id, new `expiresAt`; same holder, other paths → new id.
           - `claim_Refused` — rows: reason `' '`; `minutes` 0; path `/abs/x`; path `a/../b`; empty `paths`; branch `' '`.
           - `claim_Overlaps` — rows: B `src/a/b.ts` over A `src/a/**` → A listed; B branch `main` over A branch `main` → listed; B resource `selftest` over A resource `vite-build` → none; B paths over A branch → none; a subagent of A over A's paths → none; B over A's expired claim → none.
           - `claimsTouching_ExcludesTheAsker` — the same rows as `claim_Overlaps`, asked through `claimsTouching`, write nothing.
           - `release` — rows: by own id → that claim released; null → every claim of the holder in the room; another holder's id → refused naming the holder; unknown id → refused.
           - `endClaimsOf_EndsEveryRoom` — claims of `r1` in two rooms and of `r2` → returns both `r1` claims; `claims` lists only `r2`'s.
           - `claims_SurviveANewService` — a new service over the same files lists the live claims and drops the expired one.
           - `files_Unreadable_StartEmpty` — rows: `cursors.json`, `user-cursors.json`, `claims.json`, `threads.json` holding `{`; each logs `<file> unreadable, starting empty` and the service works.
           - `mirrors_FanOut` — two mirrors: a post reaches both `publish` calls and the `onMessage` listener; a mirror whose `publish` rejects is logged and the other still gets it; a mirror's own human message is not published back to it; after the `addMirror` disposable, neither its `publish` nor its listener runs.
           `claim-paths.test.ts`:
           - `matchesClaimPattern` — rows: `src/**` / `src/a/b.ts` → true; `src/**/x.ts` / `src/x.ts` → true; `src/*.ts` / `src/a/b.ts` → false; `src/?.ts` / `src/a.ts` → true; `src/?.ts` / `src/ab.ts` → false; `a/b` / `a/b` → true; `a/b` / `a/bc` → false.
           - `claimPathsOverlap` — rows: `[a/b.ts]` / `[a/b.ts]` → true; `[a/b.ts]` / `[a/c.ts]` → false; `[src/**]` / `[src/x/y.md]` → true; `[src/a/**]` / `[src/*.ts]` → true; `[docs/**]` / `[src/**]` → false; `[x.ts, docs/**]` / `[docs/a.md]` → true.
           - `normalizeClaimPath` — rows: `' ./src/a.ts '` → `src/a.ts`; `src\\a.ts` → `src/a.ts`; `/abs` → null; `C:/x` → null; `a/../b` → null; `''` → null.
Done when: compiles; the layer check passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof
