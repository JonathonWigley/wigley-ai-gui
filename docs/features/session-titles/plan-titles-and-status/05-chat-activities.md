# 05 — Chat activities

Status: done
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/chat-state.ts` · modify `src/plugins/chat/page/chat-commands.ts` · modify `src/plugins/chat/page/start.ts` (wiring) · modify `src/plugins/chat/main/selftest-script.ts` · test `src/plugins/chat/page/chat-state.test.ts` · test `src/plugins/chat/page/chat-commands.test.ts`
Consumes:  `SessionsPageExports.setActivity`, `RowActivity`, `NEEDS_YOU_ACTIVITY` ← 03; `SessionsPageEvents.activeChanged`, `SessionsPageEvents.sessionHostChanged`, `SessionsPageExports.selectedSessionId` (tree)
Produces:  in `src/plugins/chat/page/chat-state.ts`: `export type Unseen = 'done' | 'error' | null`, `export function rowActivity(state: { activity: ProcessActivity; unseen: Unseen }): RowActivity | null`, `export function unseenAfterTurnEnd(unseen: Unseen, focused: boolean): Unseen`, `export function unseenAfterRest(unseen: Unseen, error: string | null, wasActive: boolean): Unseen`
           a `markSent(sessionId: string): void` on the chat tabs object the view returns, called by `chat-commands.ts` after every send it invokes (a slash command and an image-only message included)
           `ChatViewDeps` gains `onActiveChanged(listener: (sessionId: string | null) => void)` and `onSessionHostChanged(listener: (sessionId: string) => void)`, wired in `page/start.ts`; its `sessions` Pick gains `'setActivity' | 'selectedSessionId'`
Decisions:
- Chat sets its activity under source id `chat`. Pinned values, local constants in `chat-state.ts` except needs you, which is task 03's `NEEDS_YOU_ACTIVITY`:
  - working: `{ word: 'working', tone: 'running', rank: 20 }`
  - done: `{ word: 'done', tone: 'success', rank: 10 }`
  - error: `{ word: 'error', tone: 'error', rank: 30 }`
- `rowActivity`: process activity `waiting` → needs you; `working` → working; `idle` → done or error from `unseen`, else null. `unseen` is held per tab in the view.
- **Done.** A turn ending (the `activity` handler's existing `isTurnEnded`) sets `unseen = unseenAfterTurnEnd(unseen, focused)`, `focused` being `selectedSessionId() === sessionId`: `'error'` stays `'error'`; else focused → null, unfocused → `'done'`. Main sends `sessionRested` before the idle `activity` of the same exit (`chat-sessions.ts` `ended`), so the error must survive that idle.
- **Error.** `sessionRested` sets `unseen = unseenAfterRest(unseen, error, wasActive)`, `wasActive` being the tab's activity not idle when it arrives: `'error'` when `error !== null` or `wasActive`, else `unseen` unchanged — even when the session is focused. A close sends no `sessionRested` for the live process, so it shows no error.
- **Clearing.** `unseen` returns to null when `activeChanged` names the session, on `markSent`, when a turn starts (the `activity` handler sees idle → not idle, which covers sends from other plugins and queued writes), and on `sessionHostChanged` for the session (a clear: its own idle arrives before, so a clear never leaves done).
- **Page load.** When the view adds a session's tab, it sets the activity from `rowActivity({ activity: state.activity, unseen: null })`, so a session waiting on a permission shows needs you after a reload.
- Chat stops sending a status line: `TAB_STATUS`, `tabStatus`, `sendStatus`, the `HeldTab.status` field and its `status: ''` initial value go; the Chat tab's status is never set, so the row's second line shows other tabs' statuses only.
- `sessionRemoved` needs nothing from chat: sessions forgets the row's activities.
- **Self-test** (chat's script, over the fake harness): a group `row activity` whose why is `the row shows working during a turn, done after it in an unfocused session, and nothing once viewed`. Its steps expect log lines `[chat] row activity <name> <word>` (`working`, `done`, `needs you`, `error`) and `[chat] row activity <name> none`, one line per change; the group covers working → done in a session not focused (open a second session and focus it, as chat's script already does for two sessions), done → none on focusing it, and needs you through the fake harness's permission prompt.
GIVEN process activity working WHEN `rowActivity` runs THEN it returns working
GIVEN a turn ends while another session is focused WHEN the user focuses this session THEN its activity goes from done to none
GIVEN a turn ends in the focused session THEN its activity goes from working to none
GIVEN a process exits with an error while idle and focused THEN the row shows error until the user sends a message
Tests:     `chat-state.test.ts` — one table for `rowActivity` over (activity × unseen): waiting/any → needs you; working/any → working; idle/done → done; idle/error → error; idle/null → null. One table for `unseenAfterTurnEnd`: (null, false) → done; (null, true) → null; (error, false) → error; (error, true) → error; (done, true) → null. One for `unseenAfterRest`: (null, 'boom', false) → error; (null, null, true) → error; (done, null, false) → done; (null, null, false) → null. `chat-commands.test.ts` — the send row asserts `markSent` is called with the session id.
Done when: compiles; the test gate runs the tests above and `npm run selftest -- --plugin chat`
Commit:    one commit for the group

## Proof

Commit 4de1cf63 · proof: diff read (Unseen, rowActivity, unseenAfterTurnEnd, unseenAfterRest, markSent, ChatViewDeps listeners and Pick widened present), typecheck clean, lint and chat self-test passed per worker · concerns: needs you has no self-test step of its own: the fixture permission is asked during open, before any step; the permission card y step's 'none' line stands in; chat-state imports the value NEEDS_YOU_ACTIVITY from sessions' contract (layers pass); the done step depends on FAKE_VISUAL_HOLD_MS outlasting two key presses
