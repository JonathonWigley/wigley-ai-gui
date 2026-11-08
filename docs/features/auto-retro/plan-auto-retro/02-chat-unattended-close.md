# 02 — Chat: unattended launch and close by id

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

All paths are relative to the GUI worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-auto-retro`.

Files:
- modify `src/plugins/chat/contract.ts`
- modify `src/plugins/chat/main/chat-sessions.ts`
- modify `src/plugins/chat/main/start.ts`
- modify `src/plugins/chat/main/open-sessions.ts`
- modify `src/plugins/chat/main/permission-tool.ts`
- modify `src/plugins/session-log/main/recently-closed.ts`
- modify `src/plugins/session-stash/main/session-stash.ts`
- test `src/plugins/chat/main/chat-sessions.test.ts`
- test `src/plugins/chat/main/start.test.ts`
- test `src/plugins/chat/main/open-sessions.test.ts`
- test `src/plugins/session-log/main/recently-closed.test.ts`
- test `src/plugins/session-stash/main/session-stash.test.ts`

Consumes: none

Produces:
- In `src/plugins/chat/contract.ts`:
  ```ts
  export interface LaunchRequest {
    projectDir: string;
    profile: string;
    message: UserMessage;
    // True for a session nobody answers: chat denies each permission prompt at
    // once. Kept with the row across a relaunch.
    unattended?: boolean;
  }
  export type SessionCloseReason = 'user' | 'start-failed' | 'project-closed' | 'finished';
  export function isUserClose(reason: SessionCloseReason): boolean; // backed by a Record<SessionCloseReason, boolean>
  // in ChatMainExports:
  close(sessionId: string, reason: SessionCloseReason): Promise<void>;
  ```
- In `src/plugins/chat/main/open-sessions.ts`: `SavedSession` gains `unattended: boolean`.
- In `src/plugins/chat/main/permission-tool.ts`: `export const UNATTENDED_REASON: string`, with the text in Decisions.

Decisions:
- **The flag lives on the row.** `HeldSession` gains `unattended: boolean`. `openRow`'s `opening` gains
  `unattended: boolean`, and so does `openAndStart`'s `opening`. Only `launch` sets it true, from
  `request.unattended === true`. `start`, `resume` and `openAndAttach` pass false. `restoreRecord` passes
  `record.unattended`. A `clear` keeps the same `HeldSession`, so the flag stays with the row.
- **Saved with the row.** `savedSessionOf` writes `unattended`. In `open-sessions.ts`, `unattended` joins
  `LaterSavedField`. `isStoredSession` accepts it when it is absent or a boolean. `parseSavedSessions` reads an
  absent field as `false`. A skipped record keeps its flag unchanged, as it keeps its other fields.
- **Deny at once.** In `askPermission`, a row with `unattended` true does not wait. It puts the permission entry
  with its answer already set to `{ allowed: false, reason: UNATTENDED_REASON }`, so the transcript shows the denied
  call. It resolves the call at once with `permissionReplyText({ allowed: false, reason: UNATTENDED_REASON },
  request.input)`. It adds nothing to `session.pending`, so the row never shows `waiting`. The checks in
  `permissionCall` stay first: a detached chat, an aborted signal or a row with no running process still answers
  `CANCELLED_REASON`.
- **The reason text**, verbatim:
  `This session runs unattended: nobody answers its permission prompts, so the app denied this tool call. Work without it, and report what it would have done.`
- **No Turn finished alert.** `announceTurnFinished`'s call site in `chat-sessions.ts` (the `turnFinished &&
  userIsElsewhere && …` condition) adds `!session.unattended`: an unattended row raises no alert and is not marked.
- **No harness change.** Chat adds no `AgentStart` field and no control for an unattended row. The harness keeps
  its default permission mode. No file under `src/main/claude-code/` changes (plan.md § Boundary rules).
- **`close` is modelled on `closeSessionsIn`.** In `start.ts`, the export calls `requireHeld(sessionId)`, so a
  session chat does not hold rejects with `chat holds no session <id>` and nothing fires. It then sets an `endWaits`
  entry for the id, calls `chat.closed(sessionId, reason)`, and awaits the entry. The part's `dispose` already
  resolves every wait, so a close resolves when chat stops too. `chat.closed` fires `sessionClosed` with `reason` and
  asks no close guard, since the guards run only on the sessions plugin's `closeSession` path.
- **No double wait on one id.** `chat.closed` drops the row from `held` at once. A second `close`, or a
  `closeSessionsIn`, for the same id then finds no held row, so two waits never share one `endWaits` key.
- **`close` takes any reason.** Chat does not judge the reason. A caller that passes `user` gets a user close.
- **`isUserClose` sits in `contract.ts`**, beside `SessionCloseReason`. A module-level
  `const USER_CLOSES: Record<SessionCloseReason, boolean>` backs it: `user` true, `start-failed`, `project-closed`
  and `finished` false. The `Record` makes the compiler ask for each new member.
- **Consumers.** `recently-closed.ts` `candidateOf` reads `isUserClose(entry.reason)` in place of
  `entry.reason === 'user'`. `session-stash.ts` `closed` reads `!isUserClose(closed.reason)` in place of
  `closed.reason !== 'user'`. These are the only two reason checks in `src/`. `session-event-log.ts` and
  `start.test.ts` use the type only and need no change. The event log's parser checks field presence only, so a
  `finished` line reads back.
- **Doc comments.** Update the comment of every member this task touches:
  - `ChatMainExports.launch` names `unattended`.
  - `ChatMainExports.close` takes plan.md's text: "Ends one session chat owns, as a sessions.closed would, without
    asking the close guards; fires sessionClosed with `reason`. Resolves once its row is gone; rejects for a session
    chat does not hold." Add "or chat stops" after "once its row is gone", as `closeSessionsIn` says.
  - `SessionCloseReason` gets a comment naming each member's source: `user` the sessions plugin's close, `start-failed`
    a start that threw, `project-closed` `closeSessionsIn`, `finished` a plugin's `close` for a session whose work ended.
  - `isUserClose`: true only for the user's own close, the one Recently closed and the stash take.
  - `ChatSessions.launch` in `chat-sessions.ts` names the flag.
  - `HeldSession.unattended` and `SavedSession.unattended` say what the flag does.
  - The `endWaits` comment in `start.ts` names `close` beside `closeSessionsIn`.
- **Design doc.** `docs/features/agent-chat/design.md` § Chat plugin (**Saved sessions**, **Permissions**) is written
  ahead; this task edits no doc.

GIVEN a row launched with `unattended: true` and a running process WHEN Claude calls `permission_prompt` THEN the call
resolves at once with a deny whose message is `UNATTENDED_REASON`, the entry shows that answer, and the row never
shows `waiting`.
GIVEN a row launched with no `unattended` WHEN Claude calls `permission_prompt` THEN the call waits for the user as
today.
GIVEN a saved record with `unattended: true` WHEN chat restores it and its process runs THEN a permission call is
denied at once.
GIVEN a row chat holds WHEN a plugin calls `close(rowId, 'finished')` THEN `sessionClosed` fires with reason
`finished`, and the promise resolves only after the row's owned session ended.
GIVEN a row id chat does not hold WHEN a plugin calls `close` THEN it rejects and fires nothing.
GIVEN an unattended row and the window unfocused WHEN its turn finishes THEN no alert is announced and the row is not
marked.
GIVEN a `finished` close WHEN Recently closed or the stash reads it THEN neither lists nor stashes it.

Tests:
- `chat-sessions.test.ts`, beside `turnFinished_unfocused_alertsAndMarks`: `turnFinished_unattendedRow_NoAlertNoMark`
  — the same setup with a row launched `unattended: true`; no `alerts.announce` call and no `mark`.
- `chat-sessions.test.ts`, in `describe('createChatSessions')` beside the `permission_` tests:
  `it.each` `permission_LaunchedRow_AnswersByUnattended: $given`. Each row launches with
  `{ projectDir: PROJECT_DIR, profile: DEFAULT_PROFILES[0].name, message: { text: 'go', images: [] } }` plus the row's
  flag, lets the process start, sets activity `working`, and calls `permission_prompt` with `BASH_ARGS`.
  - `unattended: true`: reply text is
    `{"behavior":"deny","message":"This session runs unattended: nobody answers its permission prompts, so the app denied this tool call. Work without it, and report what it would have done."}`
    (build it from `UNATTENDED_REASON`); the last `entry` sent has `answer: { allowed: false, reason: UNATTENDED_REASON }`;
    no `activity` sent is `waiting`.
  - `unattended` absent: the call is still `pending`; the last `activity` sent is `waiting`.
- `chat-sessions.test.ts`, in `describe('createChatSessions saved sessions')`:
  `save_LaunchedRow_RecordKeepsUnattended` — a launch with `unattended: true` and a `start` save records whose
  `unattended` is `[true, false]`, in row order.
- `chat-sessions.test.ts`, same describe: `restore_UnattendedRecord_DeniesPermissionAtOnce` — restore one record with
  `unattended: true`, send a message so its process starts, call `permission_prompt`; the reply's message is
  `UNATTENDED_REASON` and the call is not pending.
- `start.test.ts`, in `describe('chat main part')` beside the `closeSessionsIn` tests:
  - `exports_Close_EndsTheRow_ResolvesOnceItEnded` — start rows in `/p` and `/q`, `holdProcessEnds()`, call
    `chat.exports.close('row-1', 'finished')`; before the release it has not resolved and `chat.ended` is `[]`; after
    the release it resolves, `chat.ended` is `['row-1']`, `sessionsInSlots()` ids are `['row-2']`, and
    `closeReasons()` is `['finished']`.
  - `exports_Close_NotHeld_RejectsAndFiresNothing` — `close('row-9', 'finished')` rejects with
    `chat holds no session row-9`; `closeReasons()` is `[]`.
- `open-sessions.test.ts`:
  - `TWO_SESSIONS`: `s-alpha` gets `unattended: true`, `s-beta` `unattended: false`; `ONE_SESSION`'s record gets
    `unattended: false`. The existing round-trip rows then prove the save and the load.
  - Each `→ snapshot` row whose file has no `unattended` expects `unattended: false`.
  - New `→ rejects` row: `{ file: 'unattended a string', … }`, a record with `unattended: 'yes'`.
- `recently-closed.test.ts`, the `recentlyClosed_Excluded_NotListed` table: add
  `{ name: 'a finished close', entry: closed('a', 10, { reason: 'finished' }) }`.
- `session-stash.test.ts`, the table holding `'a project closing'`: add a row `given: 'a finished close'` that
  requests a stash for `s1` with note `n`, closes `s1` with `{ reason: 'finished' }`, and expects `logged: []`.
- Every other `SavedSession` literal in the tests (`record()` in `chat-sessions.test.ts`, among others) gains
  `unattended: false`; the compiler lists each one.

Done when: `npm run typecheck` passes; `npm test -- src/plugins/chat/main/chat-sessions.test.ts
src/plugins/chat/main/start.test.ts src/plugins/chat/main/open-sessions.test.ts
src/plugins/session-log/main/recently-closed.test.ts src/plugins/session-stash/main/session-stash.test.ts` passes;
`npm run lint` passes.

Commit: one commit for the group, message
"Chat: unattended launches deny permission prompts at once, and close(sessionId, reason) with the finished reason" with
a body naming `isUserClose` and the two consumers that read it.

## Proof

Commit fb6ba21b · proof: diff read; Produces present (LaunchRequest.unattended, finished, isUserClose, close, SavedSession.unattended, UNATTENDED_REASON); typecheck clean outside sessions/ (03 in flight); 5 test files 534 pass; oxfmt clean on touched folders · concerns: selftest-script.ts:1185 also closes with project-closed, not named by the new SessionCloseReason comment; npm run lint fails on docs/keymap.md formatting, untouched since 3e3c2fcb (pre-existing)
