# 06 — Backlog chunks and starts

Status: in progress
Type: Task
Rung: deep · crosses plugin data (one serial writer), chat's `launch` and its `sessionClosed` lifecycle, and removes main code the page still compiles against
Wave: 3 · Depends on: 05
Plan: [plan.md](plan.md)

Backlog main becomes the one writer of chunks: groups of one repo's follow-ups that one session works. It stores them in
plugin data, edits them for the page (and for 07's tool), starts each through chat's `launch` with a built first
message, and retires a chunk when chat closes its session. It also stops serving what only the old page used: the
follow-up editor's writes, the commit, the doc read, and plans and features.

Files:
- create `src/plugins/backlog/main/chunk-store.ts` · test `src/plugins/backlog/main/chunk-store.test.ts`
- create `src/plugins/backlog/main/chunk-message.ts` · test `src/plugins/backlog/main/chunk-message.test.ts`
- create `src/plugins/backlog/main/chunk-start.ts` · test `src/plugins/backlog/main/chunk-start.test.ts`
- modify `src/plugins/backlog/contract.ts`
- modify `src/plugins/backlog/manifest.ts`
- modify `src/plugins/backlog/main/start.ts` · test `src/plugins/backlog/main/start.test.ts`
- modify `src/plugins/backlog/main/homes.ts` · test `src/plugins/backlog/main/homes.test.ts`
- modify `src/plugins/backlog/main/followup-writes.ts` · test `src/plugins/backlog/main/followup-writes.test.ts`
- delete `src/plugins/backlog/main/commit-message.ts` · delete `src/plugins/backlog/main/commit-message.test.ts`
- modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/start.test.ts`

Consumes:
- `RowKey`, `RepoFolderSetting`, `BacklogHome.repoFolder` in `src/plugins/backlog/contract.ts` ← 05
- `rowKey(repo: string, title: string): RowKey` in `src/plugins/backlog/row-key.ts` ← 05
- `BacklogRow`, `backlogRows(read: BacklogRead): BacklogRow[]` in `src/plugins/backlog/main/rows.ts` ← 05
- `backlog.lastRead(): Promise<BacklogRead>` on `createBacklogMain` in `src/plugins/backlog/main/start.ts` ← 05
- the `launchBrief` setting in `src/plugins/backlog/manifest.ts` ← 05
- `ChatMainExports.launch(request: LaunchRequest): Promise<string>`, `ChatMainExports.defaultProfile(sessionId: string | null): string | null`,
  `ChatMainExports.profileOf(sessionId: string): string | null`, `ChatMainEvents.sessionClosed`, `chatMainKey` in
  `src/plugins/chat/contract.ts` — in the tree
- `services.randomHex` (`RandomHex` in `src/contracts/ambient.ts`), `api.data` — in the tree

Produces:
- `src/plugins/backlog/contract.ts`:
  - `export interface BacklogChunk { id: string; repo: string; name: string; titles: string[]; headless: boolean; sessionId: string | null }`
  - `export type ChunkEdit = | { type: 'add'; keys: RowKey[]; chunkId: string | null } | { type: 'remove'; keys: RowKey[] } | { type: 'rename'; chunkId: string; name: string } | { type: 'setHeadless'; chunkId: string; headless: boolean };`
  - `export type ChunkStart = { chunkId: string; sessionId: string } | { chunkId: string; refusal: string };`
  - `BacklogChannel.invoke` gains `chunks(): Promise<BacklogChunk[]>`, `editChunks(edit: ChunkEdit): Promise<BacklogChunk[]>`,
    `startChunks(chunkIds: string[]): Promise<ChunkStart[]>`
  - `BacklogChannel.messages` gains `chunksChanged: { chunks: BacklogChunk[] }`
  - `BacklogMainEvents` loses `followupDeleted`
- `src/plugins/backlog/main/chunk-store.ts`:
  - `export interface ChunkPlan { name: string; titles: string[] }`
  - `export interface ChunkStore { chunks(): Promise<BacklogChunk[]>; edit(edit: ChunkEdit): Promise<BacklogChunk[]>; replaceUnstarted(repo: string, plans: readonly ChunkPlan[], titles: ReadonlySet<string>): Promise<BacklogChunk[]>; setSession(chunkId: string, sessionId: string): Promise<BacklogChunk[]>; retire(sessionId: string): Promise<void>; retireUnheld(): Promise<BacklogChunk[]>; prune(titlesByRepo: ReadonlyMap<string, ReadonlySet<string>>): Promise<BacklogChunk[]>; }`
  - `export interface ChunkStoreDeps { data: Pick<Files, 'read' | 'write'>; randomHex: RandomHex; restored(): Promise<void>; isHeld(sessionId: string): boolean; log: PluginLog; changed(chunks: BacklogChunk[]): void }`
  - `export function createChunkStore(deps: ChunkStoreDeps): ChunkStore`
  - `export function titlesByRepo(rows: readonly BacklogRow[]): Map<string, Set<string>>`
- `src/plugins/backlog/main/chunk-message.ts`:
  - `export type ChunkItem = Pick<BacklogRow, 'title' | 'oneLine' | 'body' | 'path' | 'line'>;`
  - `export function chunkMessage(brief: string, items: readonly ChunkItem[]): string`
- `src/plugins/backlog/main/chunk-start.ts`:
  - `export interface ChunkStarterDeps { store: Pick<ChunkStore, 'retireUnheld' | 'setSession' | 'prune'>; rows(): Promise<BacklogRow[]>; chat: Pick<ChatMainExports, 'launch' | 'defaultProfile' | 'profileOf'>; launchBrief(): string; log: PluginLog }`
  - `export interface ChunkStarter { start(chunkIds: readonly string[]): Promise<ChunkStart[]> }`
  - `export function createChunkStarter(deps: ChunkStarterDeps): ChunkStarter`
  - `export function noFolderRefusal(repo: string): string`
- `src/plugins/chat/contract.ts`: `ChatMainExports` gains `restored(): Promise<void>`, with the comment `// Settles once
  main's restore of the saved rows ends, a failed one included, so it never rejects; until then profileOf is null for
  a row the restore is about to reopen.` `src/plugins/chat/main/start.ts` serves it as `restored: () => restored`, the
  promise the `restored` channel handler already returns.
- `src/plugins/backlog/main/followup-writes.ts`: `export type NoteEdit = Extract<FollowupEdit, { type: 'create' }> | (Extract<FollowupEdit, { type: 'edit' }> & { baseline: FollowupDraft });`
  and `writeFollowupEdit` takes `NoteEdit` in place of `BacklogEdit`.

Decisions:
- **Store** (interview: chunks in backlog's plugin data, one repo each, keyed by row key; design review: main is the one
  writer). File `chunks.json` in plugin data: `{ "chunks": BacklogChunk[] }`, in strip order (the order chunks were
  made). A chunk holds titles, not keys: its `repo` plus each title makes the row key (`rowKey`). Every store call runs
  after the one before it settles, as notes' `DraftStore` does (`src/plugins/notes/main/draft-store.ts`). A missing file
  reads as no chunks; an unreadable one logs `chunks.json unreadable; starting with no chunks` and reads as none. Each
  call that changes the list writes the file, then calls `deps.changed(chunks)`, which `start.ts` wires to
  `channel.send('chunksChanged', { chunks })`. A refused call writes nothing and sends nothing.
- **Ids**: a new chunk's `id` is `deps.randomHex()`.
- **`setSession(chunkId, sessionId)`** sets that chunk's `sessionId`, writes, and calls `changed`. For an id no chunk
  has (an assistant `set_backlog_chunks` deleted it during the launch) it changes nothing, sends nothing, and logs
  `No chunk <chunkId> for session <sessionId>`; it does not reject.
- **A session chat no longer holds.** `retireUnheld()` retires, and `edit` and `replaceUnstarted` retire before they
  apply, every chunk whose `sessionId` is not null and `deps.isHeld(sessionId)` is false (`start.ts` passes
  `(id) => chat.profileOf(id) !== null`). This frees a chunk whose session ended while the app was not running, since a
  quit fires no `sessionClosed`. `retireUnheld` resolves to the chunks after it, and `changed` runs only when it retired
  one. It runs only on these calls and at a start (the starter calls `retireUnheld` once, before its first id), never
  at load or in `chunks()`. Every `isHeld` check first awaits `deps.restored()` (`start.ts` passes
  `() => chat.restored()`): until chat's restore ends, a saved row is not yet reopened and `profileOf` is null for a
  live session (cold read: a `c`, `u` or `s` in the first seconds would otherwise retire every started chunk). The
  wait runs inside the serial queue, so later store calls wait behind it.
- **Pruning titles** (cold read: a title whose item left the backlog stays in its chunk, and a chunk of only such
  titles never goes). `prune(titlesByRepo)` takes, for each repo with at least one row, the set of its rows' titles
  (`titlesByRepo(rows)`, done rows included). For each unstarted chunk whose `repo` is a key of the map, it drops every
  title not in that repo's set, and deletes the chunk when none is left. A repo with no key (no row read, as when its
  home failed to read) is left as it is, so a failed read deletes nothing. Started chunks are left as they are: their
  session may be the one that removed the item. `changed` runs only when a title was dropped. `start.ts` calls it from
  `backlogRows(await backlog.lastRead())` before each `edit`; the starter calls it before `retireUnheld`.
- **Edit rules.** The key's repo and title are split at its first `\n`. An edit with an empty `keys` list refuses. A
  refusal rejects the call with the text below, verbatim, and the page shows it as a toast (08). The checks run in the
  table's order, top to bottom, and the first refusal that holds wins; within one row, keys are checked in `keys`
  order and the first key that breaks the rule names the refusal:

  | Edit | Case | Result |
  |---|---|---|
  | any with keys | `keys` empty | refuse `No follow-ups given` |
  | `add`, `chunkId` null | keys of two repos | refuse `<title> is in <repo>; a chunk holds one repo's follow-ups` (the first key of another repo than the first key's) |
  | `add`, `chunkId` null | otherwise | a new chunk at the end: `repo` the first key's, `name` the first key's title, `headless` false, `sessionId` null |
  | `add`, `chunkId` set | no such chunk | refuse `No chunk <chunkId>` |
  | `add`, `chunkId` set | the chunk has started | refuse `<name> has started; its follow-ups cannot change` |
  | `add`, `chunkId` set | a key of another repo | refuse `<title> is in <repo>, not <chunk repo>` |
  | `add` | a key in a started chunk | refuse `<title> is in <name>, which has started` |
  | `add` | a key in another unstarted chunk | moved: taken out of that chunk, added at the end of the target |
  | `add` | a key already in the target | left where it is |
  | `remove` | a key in a started chunk | refuse `<title> is in <name>, which has started` |
  | `remove` | a key in no chunk | ignored |
  | `rename` | no such chunk | refuse `No chunk <chunkId>` |
  | `rename` | `name.trim()` empty | refuse `A chunk needs a name` |
  | `rename` | otherwise | `name` set to `name.trim()`; a started chunk may be renamed |
  | `setHeadless` | no such chunk | refuse `No chunk <chunkId>` |
  | `setHeadless` | the chunk has started | refuse `<name> has started; its headless flag cannot change` |

  A chunk left with no titles after an `add` move or a `remove` is deleted.
- **`replaceUnstarted(repo, plans, titles)`** (plan.md: `set_backlog_chunks` replaces a repo's unstarted chunks through
  the store). `titles` is every title of `repo`'s rows. Checks, in this order, each refusing with the text verbatim:
  a plan whose `name.trim()` is empty → `A chunk needs a name`; a plan with no titles → `<name> holds no follow-ups`; a
  title not in `titles` → `No follow-up titled <title> in <repo>`; a title in two plans, or twice in one →
  `<title> is in two chunks`; a title in a started chunk → `<title> is in <name>, which has started`. Then it deletes
  every unstarted chunk of `repo` and appends one chunk per plan in order: `name` trimmed, `sessionId` null. A plan
  whose trimmed name equals an unstarted chunk of `repo` it deletes keeps that chunk's `id` and `headless` flag; each
  old chunk is matched once, by the first plan with its name, in plan order. Any other plan gets a fresh id and
  `headless` false (cold read: the assistant re-passes every chunk the repo keeps, and a chunk set headless with `H`,
  or under the page's strip cursor, must not come back reset). Started chunks and other repos' chunks keep their
  places. An empty `plans` list deletes the repo's unstarted chunks.
- **`retire(sessionId)`** deletes the chunk whose `sessionId` equals it, and does nothing when none does (interview:
  chat's `sessionClosed` for that session retires the chunk). `start.ts` hears `chat.sessionClosed` and calls
  `store.retire(event.sessionId)`, logging a rejection as `chunk of <sessionId> not retired: <error text>`. Every
  close reason retires, the user's own close (`reason: 'user'`) included, and so does the stash, which takes a session
  through a user close. Accepted: a stashed and resumed session gets a new row id that no chunk names, so its items
  read as unchunked while it works them; the plan has no map from a resumed row back to a chunk.
- **First message** (interview: the `launchBrief` setting, then each item's title, one line, body and file location;
  follow `launchText` in `src/plugins/notes/main/note-text.ts`). `chunkMessage` joins its parts by blank lines, each part
  trimmed and an empty part left out: the brief, then one block per item in the chunk's title order. An item's block is
  its own parts joined the same way: `## <title>`, the one line, the body, and `From <path>:<line>` (the full path of the
  follow-up file, and `FollowupItem.line`). Backlog writes its own `joinParts`; it cannot import notes' file (notes
  depends on backlog, not the other way).
- **Starting** (interview: one session through chat's `launch` in the repo's folder, chat's default profile, headless
  off unless the chunk's toggle is on). `start.ts` makes one starter, `createChunkStarter(deps)`, at start. Its
  `start(ids)` reads `deps.rows()` once, calls `store.prune(titlesByRepo(rows))`, reads the chunks from
  `store.retireUnheld()`, then runs the ids one after another and gives one `ChunkStart` per id, in order. The starter
  keeps an in-memory set `starting` of chunk ids whose launch is in flight (cold read: a second `s` or `S` during a
  launch both saw `sessionId` null and launched twice; the guard is in main so 07's path and the page's share it).
  For each id, the first case that holds:

  | Case | Result |
  |---|---|
  | no chunk has the id | refusal `No chunk <id>` |
  | the chunk has a `sessionId` | refusal `<name> has started` |
  | `starting` holds the id | refusal `<name> is starting` |
  | no row of `deps.rows()` has `rowKey(chunk.repo, title)` for any of its titles | refusal `None of <name>'s follow-ups are in the backlog` |
  | the first found row's `repoFolder` is null | refusal `noFolderRefusal(chunk.repo)` |
  | `chat.defaultProfile(null)` is null | refusal `Chat has no profiles` |
  | `chat.launch` rejects | refusal: the error text (`errorText`), logged as `chunk <name> not started: <error text>` |
  | `chat.launch` resolves and `chat.profileOf(sessionId)` is null | refusal `<name>'s session closed as it started`, logged as `chunk <name>: session <sessionId> closed before it was stored`; no `setSession` |
  | `chat.launch` resolves | `store.setSession(id, sessionId)`; result `{ chunkId, sessionId }` |

  The id joins `starting` just before `chat.launch` and leaves it in a `finally` around the launch and the
  `setSession` call. Between `launch` resolving, the `profileOf` check and the `setSession` call there is no `await`,
  so a `sessionClosed` heard later queues its `retire` behind the `setSession` and retires the chunk.

  `noFolderRefusal(repo)` returns, verbatim:
  `` `${repo} has no folder: add { "repo": "${repo}", "folder": "<its folder>" } to the backlog setting repoFolders` ``
  (interview: refused with a toast naming the setting). The launch request is
  `{ projectDir: repoFolder, profile, message: { text: chunkMessage(deps.launchBrief(), items), images: [] }, headless: chunk.headless }`
  with `items` the found rows in the chunk's title order; titles with no row are left out of the message. No `owner`:
  the row is the user's own session.
- **Wiring in `start.ts`.** `createChunkStore` takes `api.data`, `services.randomHex`,
  `restored: () => chat.restored()`, `isHeld`, `services.log` and `changed`. `const starter = createChunkStarter({ store,
  rows: async () => backlogRows(await backlog.lastRead()), chat, launchBrief: () => api.settings().launchBrief, log })`.
  Handlers: `chunks` → `store.chunks()`; `editChunks(edit)` → `store.prune(titlesByRepo(backlogRows(await
  backlog.lastRead())))`, then `store.edit(edit)`; `startChunks(ids)` → `starter.start(ids)`.
  The manifest's `dependsOn.main` becomes `['docs', 'chat', 'sessions']` (plan.md boundary rules; `sessions` is for
  07's tools). `BacklogApi`'s heard events become `QualifiedEvents<'docs', DocsMainEvents> & QualifiedEvents<'chat', ChatMainEvents>`,
  as `src/plugins/context-sources/main/start.ts` writes two.
- **Removals in main** (interview: backlog is read-and-start only; plans and features go; main keeps `load`, `tags` and
  `fileNote` for notes). Notes uses `load` (`noteHomes` reads each home's `repo`, `root`, `gitRoot`, `isCreateTarget`
  and `followupFiles`), `tags` and `fileNote` (`src/plugins/notes/main/start.ts`, `note-homes.ts`, `note-sender.ts`):
  each stays as it is.
  - The channel handlers `readDoc`, `applyEdit` and `commit` go. `rescan` and `load` stay.
  - `commit`, `headText`, `isUncommitted`, `imageFolderOf`, `IMAGES_PATHSPEC` and `commit-message.ts` go.
  - Plans and features stop being read: `readPlan`, `planHeader`, `withProgress`, `PLAN_TITLE_SUFFIX`,
    `PLAN_DATES_LINE`, the `plan-copies` and `plan-progress` imports, `LoadGit`, `worktreesListedOnce`,
    `watchWorktrees`, `worktreeNames` and `WORKTREES` go. Those watches existed only so a plan run in a worktree showed
    live. `watchHomes` keeps the follow-up file watches. `src/shared/plan-copies.ts` and `src/shared/plan-progress.ts`
    stay: `workflow-large` uses them.
  - `homes.ts`: `groupHomes` keeps only `followup` entries; `PlanShape`, the plan, feature and task branches of
    `addEntry` and `attachTasks` go; `HomeShape` becomes `Pick<BacklogHome, 'repo' | 'root'> & { followupFiles: { path: string }[] }`.
  - The internal `applyEdit` stays for `fileNote` and takes `NoteEdit`: its `delete` branch (`orphanedImageFolders`
    and the trash after the write) goes, `titleProblem` and `existingTitleProblem` handle `create` and `edit` only, and
    `emitFollowupEvent` fires `followupCreated` and `followupEdited` only.
  - **Contract members the old page still reads stay in `contract.ts` until 08 deletes them with the page code:** the
    `readDoc`, `applyEdit` and `commit` invokes, `BacklogEdit`, `BacklogPlan`, `BacklogTask`, `BacklogFeature`, and
    `BacklogHome.plans`, `features` and `uncommitted`. Each gets the comment `// Removed in 08: main no longer serves this.`
    Main fills `plans: []`, `features: []` and `uncommitted: false`. Main imports none of them. This keeps the page
    compiling between this wave and 08.
- **Self-test fixture**: no change. Its plan files stay on disk (docs' fixture lists the same files in the machine
  index); main no longer reads them. The backlog self-test's plan, editor and commit groups fail from this task until
  08 rewrites the script; this task does not run the backlog self-test.

GIVEN two unstarted chunks A (x) and B (y) of one repo WHEN the page sends `add` of x to B THEN A is deleted, B holds
y and x, and `chunksChanged` carries one chunk.

GIVEN a chunk started with session S WHEN chat fires `sessionClosed` for S THEN the chunk is gone from `chunks.json`
and `chunksChanged` is sent.

GIVEN a chunk whose session chat does not hold WHEN any edit runs THEN that chunk is retired first and the edit
applies to its titles as unchunked.

GIVEN a chunk of a `~/wigley-features` repo with no `repoFolders` entry WHEN it starts THEN the result is the
`noFolderRefusal` text and chat's `launch` is not called.

GIVEN a headless chunk with two items WHEN it starts THEN `launch` gets `headless: true`, the default profile, the repo
folder and the `chunkMessage` text, and the chunk holds the session id.

GIVEN a started chunk whose session chat's restore has not reopened yet WHEN an edit runs before `chat.restored()`
settles THEN the edit waits, and once the restore settles and `profileOf` knows the session the chunk stays started.

GIVEN a chunk whose launch is in flight WHEN a second `startChunks` names it THEN the second result is
`<name> is starting` and `launch` runs once.

GIVEN an unstarted chunk holding titles A and B and a load where B's item is gone WHEN the page sends an edit THEN
B is dropped from the chunk before the edit applies, and a chunk left with no title is deleted.

Tests:
- `chunk-message.test.ts`: `chunkMessage_TwoItems_BriefThenEachBlock` — brief `Brief.`, items
  `{ title: 'A', oneLine: 'gist a', body: 'Body a.', path: '/r/docs/features/followups.md', line: 3 }` and
  `{ title: 'B', oneLine: '', body: 'Body b.', path: '/r/docs/features/followups.md', line: 9 }` give exactly
  `'Brief.\n\n## A\n\ngist a\n\nBody a.\n\nFrom /r/docs/features/followups.md:3\n\n## B\n\nBody b.\n\nFrom /r/docs/features/followups.md:9'`;
  `chunkMessage_BlankBrief_LeftOut`.
- `chunk-store.test.ts` (memory files as plugin data):
  - `edit_Cases_RefuseOrApply` — one `it.each` row per line of the edit table above, each asserting the refusal text
    or the resulting chunks, plus a row for one `add` that breaks two table rows (a key of another repo and a key in
    a started chunk): the refusal of the upper row.
  - `edit_Refused_WritesAndSendsNothing`.
  - `edit_WriteFails_RejectsAndSendsNothing` — `data.write` rejects: `edit` rejects with that error and `changed` is
    not called.
  - `edit_ChunkLeftEmpty_Deleted`.
  - `edit_SessionNotHeld_RetiresBeforeApplying`.
  - `edit_BeforeRestored_WaitsThenKeepsHeldChunk` — `restored` is a promise the test settles; `isHeld` answers false
    before it settles and true after: the edit settles only after it, and the started chunk stays.
  - `replaceUnstarted_Cases_RefuseOrReplace` — one row per check above, plus: keeps started and other repos' chunks;
    an empty list deletes the repo's unstarted chunks; a plan named as an existing unstarted chunk keeps its id and
    `headless: true`; two plans of one name keep the old id on the first only.
  - `replaceUnstarted_SessionNotHeld_RetiresBeforeApplying`.
  - `retireUnheld_Cases_ChangedOnlyWhenRetired` — rows: one unheld chunk → retired, `changed` once; all held →
    nothing retired, `changed` not called.
  - `retire_HeldSession_DeletesItsChunk` and `retire_UnknownSession_ChangesNothing`.
  - `setSession_Cases` — rows: a known id → `sessionId` set, written, `changed` once; an unknown id → nothing
    written, `changed` not called, the log line.
  - `prune_Cases` — rows: a title with no row dropped from an unstarted chunk; a chunk left empty deleted; a started
    chunk's missing title kept; a repo with no key in the map left as it is; nothing to drop → `changed` not called.
  - `calls_Overlapping_RunInOrder` — two `edit` calls made without awaiting the first both land.
  - `chunks_FileUnreadable_LoggedAndEmpty`.
- `chunk-start.test.ts`: `startChunks_Cases` — one row per line of the start table, asserting the `ChunkStart` and
  whether `launch` ran and `setSession` ran, plus a row for a chunk whose session is no longer held (retired by the
  one `retireUnheld` call, then started); `startChunks_Launch_PassesFolderProfileHeadlessAndMessage`;
  `startChunks_TwoIds_RunInOrder`; `startChunks_TwoCallsAtOnce_LaunchOnce` (the first `launch` held open by the test;
  the second call resolves `<name> is starting`); `startChunks_RowClosedBeforeStored_ChunkNotStarted` (`profileOf`
  null after `launch` resolves); `startChunks_LaunchRejects_StartingCleared` (a later start of the same id launches);
  `startChunks_PrunesThenRetiresOnce` (call order `prune`, `retireUnheld`, then the first `launch`).
- `start.test.ts`:
  - add `chunks_Invoke_ServesTheStore`, `startChunks_Invoke_LaunchesThroughChat` (fake chat export),
    `sessionClosed_StartedChunk_Retired` (emit `chat.sessionClosed` on the test host, one `it.each` row per
    `SessionCloseReason`, `user` included), `sessionClosed_RetireRejects_Logged`,
    `editChunks_ItemGone_PrunedBeforeEdit`.
- `src/plugins/chat/main/start.test.ts`: `exports_Restored_SettlesWithTheRestore` — the export settles when the
  channel's `restored` does, and after a failed restore too.
  - delete every test of the removed handlers and readers: `commit_*`, `applyEdit_*`, `delete_*`, `load_Plan*`,
    `load_PlansInOneClone_ListWorktreesOnce`, and the worktree watch tests; move a rule they own that `fileNote` still
    runs into a `fileNote_` test (a path that is not one of the home's follow-up files refuses). In
    `followupEvents_EditLands_FireByType` drop the `applyEdit` cases and keep the `fileNote` cases.
- `homes.test.ts`: delete `groupHomes_Tasks_AttachToTheirPlanOrFeature`; trim the expected homes of the others to the
  new `HomeShape`.
- `followup-writes.test.ts`: delete the `setTags` and `delete` rows; the shared module's own tests keep those rules.

Done when: `npm run typecheck` passes; `npm test -- src/plugins/backlog src/plugins/notes src/plugins/chat/main/start.test.ts`
passes; `npm run lint` passes. Every other `ChatMainExports` fake in the tree is a cast (`as unknown as
ChatMainExports`, `({}) as ChatMainExports`), so the new member breaks none. The live start of a chunk session is `10-final-verification.md`'s.

Commit: one commit for the group.

## Proof
