# 03 — Chat main: resting and restored sessions

Status: not started
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` ·
           modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` ·
           test `src/plugins/chat/main/start.test.ts` (only where it asserts what changed)
Consumes:  `OpenSessions`, `SavedSessions`, `SavedSession`, `createOpenSessions` ← 01
           `SessionsMainEvents.selected` ← 02
Produces:  in `src/plugins/chat/contract.ts`:
           `ChatSessionState.running: boolean` (replaces `ended`)
           `ChatChannel.invoke.loadHistory(sessionId: string): Promise<void>`
           `ChatChannel.messages.entries: { sessionId: string; entries: ChatEntry[] }`
           `ChatChannel.messages.sessionRested: { sessionId: string; error: string | null }` (replaces `sessionEnded`)
           `ChatChannel.messages.sessionRunning: { sessionId: string }`
           `SlashCommandContext` without `ended`
           the log line `session <rowId> process started (resume <true|false>)`
           in `src/plugins/chat/main/chat-sessions.ts`, on `ChatSessions`:
           `restore(saved: SavedSessions): void`
           `loadHistory(sessionId: string): Promise<void>`
           `selected(sessionId: string | null): void`
           and `ChatSessionsDeps.saved: OpenSessions`
Decisions: rows rest, process on first send (round 1) · close removes for good (round 1) · an exit rests (round 2) ·
           chat owns persistence (design review) · opening a row and starting its process split in two (design
           review) · history read on first show (design review) · only the user's close drops a record (design
           review) · busy flag saved (design review) · start prompt resume selects an existing row (design review)

The page stops compiling against this contract until task 04 lands; the task's compile check is `npm run typecheck`
with errors only under `src/plugins/chat/page/` (the series lands together, task 04 restoring a clean build).

## Contract

- `ChatSessionState`: `ended` becomes `running` — true while the session's process runs, false while it rests (no
  process yet, or its process exited). Rewrite the comment above it: a session's state lasts until the user closes
  its row, across a relaunch.
- `sessionEnded` becomes `sessionRested`, sent when a process that started exits, or when a newly opened row's
  start fails; `error` as today. A resting row whose start fails on send gets no `sessionRested`: it never left
  resting, and the send's rejection is the one report.
- `sessionRunning` is new, sent once `harness.start` returns a process, for every start (new, resume, launch, a
  resting row's first send), so the page flips `running` to true.
- `entries` replaces a session's whole entry list (the restored history arriving).
- `loadHistory(sessionId)` reads a restored session's earlier conversation once; a later call, or one for a session
  with nothing pending, resolves with nothing done.
- `pastSessions` and `resume` comments: a session with a chat row is listed, and resuming it selects that row.
- `SlashCommandContext.ended` goes, with its comment's clause: a resting session takes notices.

## chat-sessions.ts

Split `openSession` in two:

- **open the row**: `sessions.open` with the options given, the held state (`running: false`), `sessionStarted`, and
  the saved snapshot written. Used by new, resume, launch and restore.
- **start the process**: `harness.start` with `resume` as given, `running: true`, `sessionRunning` sent, the log
  line `session <rowId> process started (resume <true|false>)`, the folder recorded in `recent`. New, resume and launch call it right after opening; a resting row calls it on its first send. A
  start that throws for a row opened this call (new, resume, launch) ends the owned session and drops it, as today;
  one that throws for a resting row leaves the row resting and rethrows, so the page's send toasts it.

`HeldSession` gains `sent: boolean` (a message was ever sent: true for a resumed session, set on the first send of a
new one, read from the record on restore), `historyPending: boolean` (true only for a restored row until
`loadHistory` reads it) and `profileName: string` (the profile may be missing from settings, so the held profile is a
name, looked up at start). `process: AgentProcess | null` is null whenever the row rests.

- **send**: on a resting row, look the profile up (`requireProfile`'s throw is the error the page toasts: the row
  stays resting), start the process with `resume: sent`, then send. Any send sets `sent` and saves when it was false.
- **process exit** (`processEvents.ended`): instead of `ended = true`, set `running = false` and `process = null`,
  cancel and show pending permissions as today, add a notice, send `sessionRested`, show idle, save. Notice text,
  tone `info` when `code === 0` and `error === null`, else `error`:
  `Claude stopped (exit code <code>). Your next message resumes this session.` — with `: <error>` after the closing
  parenthesis when `error` is not null; `exit code unknown` when `code` is null.
- **interrupt, setControl, answerPermission** on a resting row: log and ignore, as for an ended one today
  (`setControl` keeps throwing, with `has no running process` in place of `has ended`).
- **notice**: works on a resting row (entries are kept).
- **closed**: a resting row drops its state, ends its owned session and saves at once; a running row ends its process
  as today and saves at once (the record goes with the user's close, not with the exit).
- **restore(saved)**: for each record in order, open its row with `select: false`, resting, `historyPending: true`,
  `sent` from the record. A record whose `busy` is true gets an `info` notice:
  `The app quit during this turn. Your next message resumes this session.` A record whose profile is not in
  `profiles()` gets an `error` notice: `Profile <name> is not in chat's profiles setting; add it back to resume this
  session.` Then, when `selectedHostSessionId` names a restored row, `sessions.activate` that row. A record whose host
  id is already open in the app (`openHostIds`) is skipped and logged.
- **loadHistory(sessionId)**: when `historyPending`, clear it, read the history through `harness.history` with the
  profile's config folder (a missing profile reads nothing: its notice already says why), and set entries to the
  history followed by the entries held so far; send `entries`. A read that fails uses the existing
  `Earlier conversation not read: <reason>` notice in place of the history.
- **busy**: whenever `updateActivity` changes `activity` between `idle` and anything else, save.
- **selected(sessionId)**: the sessions `selected` event. When chat holds the row, remember its host id as the saved
  selection and save; any other row (a terminal session, null) leaves the saved selection as it was.
- **pastSessions**: leave out only host ids open in the app on a row chat does not hold (relay sessions); chat's own
  rows list, running or resting.
- **resume**: a host id chat holds a row for is `sessions.activate`d and its row id returned, starting nothing and
  reading nothing; a host id open on a relay row rejects as today. `endedHolding` and `closeEnded`'s resume use go.
- **killAll**: kills as today, then stops all saving for the rest of the part's life, so the exits a quit causes
  never write `busy: false` over the record that says a turn was cut off.
- **saving waits for the restore**: chat saves nothing until `restore` has run or the load has rejected (a
  `restored` flag `restore` sets, which `start.ts` also sets on a rejected load through a `ChatSessions` call or by
  calling `restore` with nothing: implementer's choice), so a session opened before the load resolves (a drive
  `chat.start`, a `launch`) can never write over the saved records. `restore` saves once at its end, so such a
  session joins the file then.
- **snapshot**: chat's rows in held order (the sessions sidebar's order for owned rows), each as a `SavedSession`
  with `busy` = `activity !== 'idle'`, plus the saved selection. A save that rejects is logged
  (`open sessions not saved: <reason>`), never thrown.

## start.ts

- Create `createOpenSessions(api.data)` and pass it as `saved`.
- After the channel handlers are registered, `load()` and hand the snapshot to `chat.restore`; a rejected load is
  logged (`open sessions not read: <reason>`) and restores nothing.
- `api.channel.handle('loadHistory', (sessionId) => chat.loadHistory(sessionId))`.
- `api.events.on('sessions.selected', ({ sessionId }) => chat.selected(sessionId))`.
- Update the part's summary comment above `chatMainPart` to name keeping and restoring the sessions.
- The `chat.askPermission` drive action (`start.ts`, reading `state.ended`): reject when `!state.running` with
  `session <id> has no running process`, and update its description's "or when that session has ended" to "or when
  that session has no running process"; rewrite `start.test.ts`'s `askPermission rejects an ended session` as the
  resting-row case.

GIVEN a saved record with `sent: true` and `busy: true` WHEN chat restores it and the user sends a message THEN the
row opened unselected with the quit notice, no process started until the send, and the send started the harness with
`resume: true`.

Tests:     rewrite every `chat-sessions.test.ts` case that asserts `ended` to assert the resting behaviour below, and
           add (one test per rule, cases as rows):
           `restore_SavedSnapshot_OpensRestingRowsInOrder` — rows opened unselected in record order, the saved row
           activated, no harness `start` call
           `restore_RecordFlags_AddNotices` — table: busy → the quit notice; missing profile → the profile notice;
           neither → no entries
           `send_RestingRow_StartsProcessWithResumeFromSent` — table: `sent` true → `resume: true`; false →
           `resume: false`; then `sessionRunning` is sent and the message reaches the process
           `send_NewSession_SavesSentTrue` — table: new session then a send → saved `sent: true`; launch → saved
           `sent: true`; new session with no send → saved `sent: false`
           `save_BeforeRestore_WritesNothing` — a session started before `restore` runs saves nothing; after
           `restore` the saved snapshot holds the restored records and that session
           `send_RestingRowWithMissingProfile_RejectsAndStaysResting` — also asserts no `sessionRested` is sent
           `processExit_RunningRow_RestsWithNotice` — table over code/error: (0, null) → info, `exit code 0`;
           (1, 'boom') → error, text ending `: boom`; (null, null) → `exit code unknown`; `sessionRested` sent and the
           row not ended
           `closed_Row_DropsItsRecord` — table: resting row, running row; the saved snapshot no longer holds it
           `killAll_ThenExits_SavesNothing` — the store fake records no save after `killAll`
           `activity_IdleFlip_SavesBusy` — working → saved `busy: true`; back to idle → `busy: false`
           `loadHistory_PendingRow_PrependsOnce` — history before the restore notices; a second call reads nothing
           `resume_HostIdChatHolds_SelectsExistingRow` — returns the row id, no `open`, no `start`
           `pastSessions_OpenRows_ListsChatRowsOnly` — a chat-held host id listed, a relay-held one left out
           `selected_ChatRowThenOtherRow_KeepsLastChatSelection`
           Use a store fake holding the last snapshot saved and a call count; build profiles and records in the test.
Done when: `npm run typecheck` errors only under `src/plugins/chat/page/`; the test gate runs the tests above and
           `chat-sessions.test.ts` and `start.test.ts` as a whole
Commit:    one commit for the group

## Proof
