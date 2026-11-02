# 03 — Pending rows, pull-back keys and put-back on the page

Status: done
Type: Task
Wave: 3 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/entry-list.ts` · test `src/plugins/chat/page/entry-list.test.ts` · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/chat-commands.ts` · test `src/plugins/chat/page/chat-commands.test.ts` · modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/manifest.ts` · modify `src/plugins/keymap.ts`
Consumes:  `QueuedMessage`, `ChatSessionState.queued`, `invoke.pullBack`, `messages.queued`, `messages.returned` ← 01
           `QueuedMessageInput`, `ChatLayout.queuedMessage` ← 02
           the entry list's stop model (`ListStop`, `cursorStops`, `focusAfterChange`) as the activity-line plan landed it
Produces:  in `src/plugins/chat/page/entry-list.ts`:
           `EntryList.setQueued(queued: readonly QueuedMessage[]): void` — draws one pending row per message after the last entry, in order, reusing a row whose id it already holds (`update`), removing the rest
           `EntryListDeps.pullBack(queuedId: string): void` — what a click on a pending row calls
           the focused-stop accessor returns a pending row's stop as `{ kind: 'queued'; message: QueuedMessage }` (a new `ListStop` member, or a union beside it in `entry-list.ts`, whichever keeps `activity-runs.ts` free of queued rows)
           in `src/plugins/chat/manifest.ts`: command `pullBackQueued` — label `pull back the newest pending message`, group `box`, `runsIn: 'page'`
           in `src/plugins/keymap.ts` `chatBoxBinds`: `{ keys: '<Leader>cp', command: 'chat.pullBackQueued' }`
Decisions: a pending row's stop id is `queued:<id>`; stops are the entry stops followed by the pending rows' ids, so `j` from the last entry reaches the first pending row and `G` the newest; `focusAfterChange` runs over the whole stop list, so a following focus moves onto a new pending row and a focus on a row that left follows the latest
           pending slots live at the end of the `ol` (the scroller): every new entry slot is inserted before the first pending slot instead of appended (the run slot still goes before its first step's slot), and `rebuild` adds the pending slots last; so `followBottom` keeps them in view; they draw through the `queuedMessage` part with `chatPartDraws` and `surfaceBaseKit`, as the `activity` part does, and a part that throws falls back to `default` the same way. `rebuild` (a layout reload) redraws them too
           the slot carries the same `is-cursor` mark entries do (02 owns the row's CSS)
           a click on a pending row calls `deps.pullBack(id)`, logs `pulling back a pending message in <session name>`, and does not move the cursor
           a key move onto a pending row (`j`, `k`, `gg`, `G`) logs `focused pending message`, beside 07's `focused activity line`
           `chat.toggleEntry` (Enter) on a focused pending row invokes `pullBack(sessionId, id)` and logs `pulling back a pending message in <session name>`; on any other stop it does what it does today
           `chat.pullBackQueued` invokes `pullBack` with the newest queued id of the session on screen; with none, logs `no pending message in <session name>`
           `chat.interrupt` is unchanged on the page: main returns the queue (01)
           chat-view keeps each session's queue from `sessions`, `sessionStarted` and `queued`, calls `setQueued`, and logs `<n> pending message(s) in <session name>` on each `queued` message (pinned: the self-test waits on it); `chat-view.ts` gives `createEntryList` its `pullBack`, which invokes the channel for that tab's session
           page `start.ts` listens for `returned` (it already holds the view as `tabs` and the command deps) and calls the widened, exported `export function putBack(deps: Pick<ChatCommandDeps, 'tabs' | 'log'>, session: ChatSession, messages: readonly UserMessage[]): void` in `chat-commands.ts` (writing-code: widen, never copy); each caller logs its own line. A held tab whose box is not mounted yet (no `ChatSession`) logs `returned for <session name> dropped: no box`. `putBack` applies them newest first so the oldest ends at the top, each text on its own line above the box's text, images ahead of any attached. Its refusal caller passes one message and keeps its log `put the refused message back in <name>`; the returned path logs `pulled back <n> message(s) in <session name>` (pinned: the self-test waits on it). A session closed since takes nothing back, as today
           a `returned` for a session with no tab on this page is dropped
GIVEN entries a, b and queued q1, q2, the focus on b not following (one `k` from the latest) WHEN `j` runs THEN the cursor is on q1; `j` again THEN q2; `k` back onto q1, then `setQueued([q2])` THEN q1's row is gone and the focus is on q2, following
GIVEN pending rows WHEN an entry is `put` THEN its slot sits before them
GIVEN the cursor on a pending row WHEN Enter runs THEN `pullBack` is invoked with that row's session and id
GIVEN two queued messages WHEN `<Leader>cp` runs THEN `pullBack` is invoked with the newest id; with none, nothing is invoked and the log reads `no pending message in <name>`
GIVEN a box holding `draft` WHEN `returned` brings `one` then `two` THEN the box reads `one\ntwo\ndraft` and the images sit in the order one's, two's, then the attached ones
Tests:     `entry-list.test.ts`: one test for pending rows as stops after the entries and their removal (the first GIVEN); one for a `put` entry landing before the pending rows; one for a click on a pending row calling `pullBack` without moving the cursor
           `chat-commands.test.ts`: Enter on a pending row and `<Leader>cp` (newest, and none) as rows of one table if the file's command tests are tabled, else two tests; the put-back of two returned messages over a draft as a row added to the existing refused-message put-back test, or a second test of the same function if that test is not tabled
Done when: compiles; `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 6c92273 · proof: diff read: every Produces present (putBack amended, see Contract changes); typecheck clean · concerns: held-tab-no-box branch near unreachable; npx --version ran once (nothing installed); activity slot helpers widened into generic slot-part helpers
