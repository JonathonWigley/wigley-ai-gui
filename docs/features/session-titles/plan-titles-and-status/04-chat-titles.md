# 04 — Chat saves titles, first-message fallback, the instruction

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/open-sessions.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · modify `src/plugins/chat/main/start.ts` · modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/page/start-prompt.ts` (`resumeSession` builds the `ResumeRequest`) · test `src/plugins/chat/main/open-sessions.test.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` · test `src/plugins/chat/page/start-prompt.test.ts`
Consumes:  `SessionsMainExports.setTitle`, `SessionsMainExports.titles`, `SessionsMainEvents.titleChanged`, `SessionTitles`, `TITLE_SOURCES` ← 01; chat's `addInstructions` (tree, after the `visuals` precondition)
Produces:  `SavedSession.titles: SessionTitles` in `src/plugins/chat/main/open-sessions.ts`; `ResumeRequest.title: string` in `src/plugins/chat/contract.ts`; `ChatSessions.titleChanged(sessionId: string): void` in `src/plugins/chat/main/chat-sessions.ts`; `ChatSessionsDeps.sessions` widened with `'setTitle' | 'titles'`
Decisions:
- **Saving.** `SavedSession` gains `titles`. `main/start.ts` hears `sessions.titleChanged` beside its `sessions.selected` listener and calls `ChatSessions.titleChanged(sessionId)`, which saves the snapshot when chat holds that row and does nothing otherwise; each snapshot writes the row's current `sessions.titles(id)`.
- **Reading an older file.** A saved session whose `titles` is missing reads as all null; a `titles` present but not an object with the three keys, each a string or null, fails the load as any other bad field does. Without this, the first launch after the change would reject the file and chat would stop saving rows.
- **Restoring.** Right after `sessions.open(...)` for a restored row, chat calls `setTitle` for each non-null saved source, in `TITLE_SOURCES` order.
- **First-message fallback.** In `deliver`, when `session.sent` turns true and the row's `titles(id)` has `firstMessage === null`, chat calls `setTitle(id, 'firstMessage', …)` with the first 200 code points of `message.text` (the row cuts it further to the limit; the cap keeps a pasted wall of text out of the saved file and every state). A message with empty text (images only) sets nothing. A clear sets `sent` false but keeps the titles, so the next first message sets nothing (its `firstMessage` is already set).
- **Resume.** `ResumeRequest` gains `title`, filled by the page from the `PastSessionRow` it resumes; chat main sets it as the `firstMessage` title of the new row. A resume of a session already on a chat row changes nothing.
- **Accepted as written:** a row restored from a file written before this change, or resumed with `sent` already true, never runs the first-message fallback and keeps its folder label until the agent names it; every process start, a resume included, carries the instruction, so a resumed agent may rename once more.
- **Instruction.** `main/start.ts` calls chat's `addInstructions` once at start (no dispose: the registry lives and dies with the part), with the text pinned: `This session shows as a row in the Auri app's side bar. At the end of your first turn, call the set_session_title tool with a short, specific title naming this session's work, and call it again only when the work's focus clearly changes.`
GIVEN a row's first message `"  fix the\nlogin bug"` WHEN it is delivered THEN `setTitle(id, 'firstMessage', …)` is called once with that text
GIVEN a cleared row whose `firstMessage` is set WHEN the new conversation's first message is delivered THEN no title is set
GIVEN `open-sessions.json` written before this change (no `titles`) WHEN chat loads it THEN every row comes back with no titles and saving still works
GIVEN a saved row with `{ user: null, agent: 'Plan review', firstMessage: 'hi' }` WHEN chat restores it THEN sessions holds those titles for its row
Tests:     `start-prompt.test.ts` — the resume row asserts the request carries `title: <the past row's title>`. `open-sessions.test.ts` — add rows to the load test: titles round-trip; missing `titles` → all null; `titles` with a number value → load rejects. `chat-sessions.test.ts` — rows: first delivery sets firstMessage; image-only sets none; after clear sets none; resume sets the request's title; restore calls `setTitle` per saved source; `titleChanged` for an owned row saves. The suite's fake `sessions` (built near the top of `chat-sessions.test.ts`) gains a recorded `setTitle` call list and a `titles` map it serves; expected lists are exact, e.g. first delivery of `"hello"` in `s1` → `[['s1', 'firstMessage', 'hello']]`, image-only → `[]`, after clear → `[]`.
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof
