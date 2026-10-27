# 04 — Chat launch export

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/session-list.ts` · modify
           `src/plugins/sessions/main/start.ts` · test `src/plugins/sessions/main/session-list.test.ts` · modify
           `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · modify
           `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` · create
           `src/shared/image-types.ts` · create `src/plugins/chat/image-rules.ts` · modify `src/plugins/chat/page/attachments.ts` + `attachments.test.ts`Consumes:  `SessionsMainExports.open(info: SessionInfo): OwnedSession` in `src/plugins/sessions/contract.ts` (in the
           tree) · `ChatSessions.start`, `ChatSessions.send`, `ChatSessions.sessions` and the private `openSession`
           in `src/plugins/chat/main/chat-sessions.ts` (in the tree) · `UserMessage` in `src/contracts/agent.ts`
           (in the tree) · `ChatSessionState.profile` in `src/plugins/chat/contract.ts` (in the tree)
Produces:  in `src/plugins/chat/contract.ts`, as plan.md § File Structure gives:
           ```ts
           export interface LaunchRequest { projectDir: string; profile: string; message: UserMessage }
           export interface ChatMainExports {
             // Starts a session and sends `message` as its first message; leaves the selected row as it was.
             // Resolves to the new row's sessionId.
             launch(request: LaunchRequest): Promise<string>;
             // Chat's profile names, in settings order.
             profileNames(): string[];
             // The profile of a session chat owns; null for any other session id.
             profileOf(sessionId: string): string | null;
           }
           ```
           in `src/plugins/sessions/contract.ts` (a contract change beyond plan.md, see below):
           `export interface OpenOptions { select: boolean }`
           `SessionsMainExports.open(info: SessionInfo, options?: OpenOptions): OwnedSession`
           in `src/plugins/chat/main/chat-sessions.ts`, `ChatSessions`: `launch(request: LaunchRequest): string`
           in `src/plugins/chat/main/start.ts`: the part returns `exports` typed `ChatMainExports`
Decisions: the user stays where they were; the session runs in the background (design.md § Destinations, New
           session) · the selection is kept in sessions, where the row is selected (below) · the first message goes
           through the same `send` path the Chat tab uses

## What selects the row

Measured in this run: the drive action `chat.start` (`addDriveActions` in `src/plugins/chat/main/start.ts`) calls
`chat.start(...)` and then `sessions.activate(sessionId)`. But `chat.start` already selects the row before that:
`openSession` calls `sessions.open(...)`, and `SessionList.open` (`src/plugins/sessions/main/session-list.ts`) runs
`select(rows.at(-1))` and `sendState()`. The contract says so: "Starts an owned session with its row selected."
The page adds a Chat tab on `sessionStarted` and calls `tab.handle.select()`; that selects the tab inside its own
session and does not change the selected row.

So `launch` cannot keep the selection from chat alone. Selecting the old row again after the open
(`sessions.activate`) is not the same: it sends `activated` to the page, which moves the user, and it cannot restore
"no row selected". The change is an option on `open`:

- `SessionsMainExports.open(info, options?)`: `options.select` false adds the row unmarked and leaves
  `selectedSessionId` as it was, null included. With no `options`, or `select` true, the behaviour is as today. The
  doc comment says both.
- `SessionList.open` takes the same `options` and skips `select(rows.at(-1))` when `select` is false. It still calls
  `sendState()`, so the page shows the new row, and still emits `connected`.
- `sessions/main/start.ts` passes `options` through (`open: (info, options) => list.open(info, options)`). The drive
  action `sessions.open` keeps its call with no options.
- Later attention works as today: when the launched session's turn finishes, `announceTurnFinished` marks the row,
  since it is not selected.

## Launch

- `ChatSessions.launch(request)`: `openSession` with the same arguments `start` uses (a new host id from
  `randomUuid`, `resume` false, no entries), and `{ select: false }` passed to `sessions.open`. Then it calls the same
  `send(sessionId, request.message)` the `send` channel handler calls. It returns the row's sessionId.
- `openSession` gains the `OpenOptions` it hands to `sessions.open`; `start` and `resume` pass `{ select: true }`.
- No wait between start and send: `harness.start` returns the `AgentProcess` at once (it is synchronous, and
  `openSession` sets `session.process` before it returns). The Claude adapter's `send` writes the message as one JSON
  line to the child's stdin pipe, which holds it until the CLI reads; the fake harness's `send` takes it at once. The
  user's own first message from a Chat tab takes this same path.
- A failed start (an unknown profile, no chat harness, a harness `start` that throws) throws before any send, as
  `start` does today; the export's promise then rejects with that error. A process that fails after it spawned ends
  its session as any chat session does.
- The image cap: `launch` checks every image with `refusalOf(image.mediaType, image.data.length)` before it opens
  anything, and rejects with the first refusal's text (`Images over 5 MB cannot be attached` for size). Move
  `IMAGE_TYPES` unchanged from `src/plugins/chat/page/attachments.ts` to a new `src/shared/image-types.ts` (task 08's
  page paste helpers import it from there too), and `MAX_IMAGE_BASE64` and `refusalOf` unchanged to a new
  `src/plugins/chat/image-rules.ts`, which imports `IMAGE_TYPES` from `src/shared/image-types.ts` and which both parts import (as forms' `finding-origins.ts` sits at the plugin
  root); `attachments.ts` and its test import them from there, and `refusalOfFile` stays in `attachments.ts`.
  `scripts/check-layers.mts` already lets `src/plugins/chat/main` and `src/plugins/chat/page` import the
  `src/plugins/chat` layer, so it does not change.
- `launch` logs `[chat] launched session <sessionId> in <projectDir>`, the source `chat`, so the notes self-test
  (task 09) can wait for it.

## The exports

In `chatMainPart.start`, return `exports`:

- `launch: async (request) => chat.launch(request)`
- `profileNames: () => api.settings().profiles.map((profile) => profile.name)`. The drive actions' `profileNames`
  dependency uses this same function, so one function reads the names.
- `profileOf: (sessionId) => chat.sessions().find((held) => held.sessionId === sessionId)?.profile ?? null`. The
  id is the sessions row id. An ended session chat still holds counts as owned.

GIVEN a selected row `row-1` WHEN `SessionList.open(info, { select: false })` runs THEN `selectedSessionId()` is
`row-1`, the new row is in the state unmarked, and `connected` is emitted.
GIVEN no selected row WHEN `SessionList.open(info, { select: false })` runs THEN `selectedSessionId()` is null.
GIVEN the chat-sessions fake WHEN `launch({ projectDir: PROJECT_DIR, profile: <first test profile>, message: { text:
'fix the chip', images: [] } })` runs THEN the sessions fake's `open` got `{ select: false }`, the fake harness's
first process has calls `[{ method: 'send', text: 'fix the chip', imageCount: 0 }]`, and `activated` is empty.
GIVEN the chat-sessions fake WHEN `start(...)` runs THEN the sessions fake's `open` got `{ select: true }`.
GIVEN an unknown profile WHEN `launch` runs THEN it throws and the harness started no process.
GIVEN a message with one PNG whose `data` is `6 * 1024 * 1024` characters long WHEN `launch` runs THEN it rejects
with `Images over 5 MB cannot be attached`, and `opened` is empty.

Tests:     `session-list.test.ts`: `open_SelectFalse_KeepsSelectedRow` · `open_SelectFalse_NoneSelected_StaysNone` ·
           `chat-sessions.test.ts`: `launch_OpensUnselectedAndSendsFirstMessage` · `start_OpensSelected` ·
           `launch_UnknownProfile_ThrowsAndStartsNothing` · `launch_ImageOverCap_RejectsAndOpensNothing`. The chat-sessions `setUp` fake for `open` records each
           call's options in a new `openOptions: (OpenOptions | undefined)[]` array it returns beside `opened`.
           The `exports` lines in `start.ts` are wiring the compiler checks against `ChatMainExports`; the
           background launch on screen is a check in task 11 (Final verification).
Done when: compiles; `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

Commit 009088b · proof: diff read: ChatMainExports, LaunchRequest, OpenOptions and open(info, options?) present; moved names have no stale importers; typecheck clean in its files · concerns: AGENTS.md chat/ line does not name the new exports or image-rules.ts (for task 10 doc re-read); session-list.ts header comment line runs past the wrap width
