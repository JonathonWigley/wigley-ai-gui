# 01 — Titles on session rows

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/session-list.ts` · modify `src/plugins/sessions/main/start.ts` · modify `src/plugins/sessions/manifest.ts` · create `src/plugins/sessions/session-title.ts` · test `src/plugins/sessions/main/session-list.test.ts` · test `src/plugins/sessions/session-title.test.ts`
Consumes:  none
Produces:  in `src/plugins/sessions/contract.ts`: `TITLE_SOURCES`, `TitleSource`, `SessionTitles`, `SessionRow.titles`, `SessionsMainExports.setTitle(sessionId: string, source: TitleSource, title: string | null): void`, `SessionsMainExports.titles(sessionId: string): SessionTitles | null`, `SessionsMainEvents.titleChanged: { sessionId: string; titles: SessionTitles }`, `SessionsChannel.invoke.setUserTitle(sessionId: string, title: string | null): void`
           in `src/plugins/sessions/session-title.ts`: `normalizedTitle(text: string): string`, `titleLimit(setting: number): number`, `titleProblem(text: string, max: number): string | null`, `shownTitle(titles: SessionTitles, max: number): string | null`, `editableTitle(titles: SessionTitles): string` (`user ?? agent ?? firstMessage`, uncut, `''` when none)
           in `src/plugins/sessions/manifest.ts`: setting `titleMaxLength: 40` with its `settingInfo`
Decisions:
- Each `SessionEntry` holds its `SessionTitles`, all null at `connect` and `open`; it is the source, and `rowOf` copies it onto the row, and `state()` copies `titles` too (not only the row's top level), so the page never shares main's object. They stay through `setHostSessionId` (a clear) and while the row is closed, as the label does, and go with the entry when the session ends.
- `setTitle` stores `normalizedTitle(title)` for a string, null for null, on the entry — only when the value changed — then updates the row and sends the state when the session has a row (a row the user closed has none; `mark` later rebuilds it from the entry), and emits `titleChanged` with the new titles either way. A session with no entry (never connected, or ended) is logged and ignored, as `mark` is. It does not check the limit: callers do (task 02 refuses, task 04 stores the full first message and `shownTitle` cuts it). A string that normalizes to empty stores null.
- `setUserTitle` (channel) is a `SessionList` member, `setUserTitle(sessionId, title, maxLength: number)`, which `start.ts`'s handler calls with `titleLimit(api.settings().titleMaxLength)` read per call. A string that normalizes to empty clears the user title (null); otherwise it throws `titleProblem`'s text when there is one, since the page checks first, else calls `setTitle(sessionId, 'user', title)`.
- `titleLimit` floors the setting and clamps it to at least 2; every reader of the setting (tool, page, channel) goes through it. `shownTitle`'s cut trims trailing spaces before the `…`.
- Setting copy: label `Title length`, description `The most characters a session title may hold; longer titles from the agent or the rename dialog are refused, and a first-message title is cut.`
- Pinned strings in `session-title.ts`: the two problems and the `…` cut, as plan.md § File Structure gives them.
GIVEN a connected session WHEN `setTitle(id, 'agent', '  Fix  login\nbug ')` runs THEN the row's `titles.agent` is `'Fix login bug'` and `titleChanged` is emitted once
GIVEN an agent title WHEN `setTitle` repeats the same title THEN no state is sent and no event is emitted
GIVEN an owned session with titles WHEN `setHostSessionId` moves it THEN its titles are unchanged
GIVEN a row the user closed WHEN `setTitle(id, 'agent', 'X')` runs and then `mark(id)` THEN `titleChanged` is emitted, no state is sent by `setTitle`, and the row `mark` brings back has `titles.agent` `'X'`
GIVEN titles `{ user: null, agent: 'B', firstMessage: 'C' }` WHEN `shownTitle` runs THEN it returns `'B'`; with `user: 'A'` it returns `'A'`
Tests:     `session-title.test.ts` — one table for `shownTitle` (user wins; agent over first message; first message of 45 code points at max 40 → 39 code points + `…`; exactly 40 → unchanged; a cut landing after a space → no space before `…`; all null → null), one for `titleLimit` (40 → 40; 12.7 → 12; 1 → 2; 0 → 2; -5 → 2), one for `editableTitle` (user wins; first message uncut; none → `''`), one for `titleProblem` (empty after normalizing; 41 code points at max 40 with an emoji counted as one; 40 → null). `session-list.test.ts` — add rows to the owning tests: setTitle stores normalized text and emits once; a repeat emits nothing; null clears one source; unknown session ignored; titles survive `setHostSessionId`; set on a closed row then `mark` shows it; mutating a `state()` row's `titles` leaves the next `state()` unchanged; `setUserTitle` — 41 characters at 40 throws and stores nothing, `'   '` clears the user title, the limit argument applies per call.
Done when: compiles; `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 3b62145d · proof: diff read (every Produces present), typecheck clean, lint clean per worker · concerns: worktree guard refuses nvm-sourced npm, so npm runs by its absolute v24.22.1 path; per-call limit covered across two table rows rather than one list
