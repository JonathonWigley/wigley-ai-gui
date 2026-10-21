# 05 — Start prompt: the session step

Status: done
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/manifest.ts` · modify `src/plugins/chat/page/start-prompt.ts` ·
           modify `src/plugins/chat/page/picker.ts` · modify `src/plugins/chat/page/start.ts` ·
           create `src/plugins/chat/page/resume-items.ts` · test `src/plugins/chat/page/resume-items.test.ts`
Consumes:  `PastSessionRow`, `ResumeRequest`, `ChatChannel.invoke.pastSessions`, `.setArchived`, `.resume` in
           `src/plugins/chat/contract.ts` ← 04 ·
           from plan A, in the tree once it landed: `createPicker`, `Picker`, `PickerRequest<T>`, `PickerDeps`
           (`page/picker.ts`, its task 09); `chatCommand`, `chatScope`, `ChatScopeName` (`src/plugins/chat/ids.ts`, 09);
           the manifest's `picker` scope and its `pickerDown`, `pickerUp`, `pickerPick`, `pickerClose`,
           `pickerFilter`, `pickerList` commands (09); `openStartPrompt`, `StartPromptDeps` (`page/start-prompt.ts`,
           its task 10) and its flow steps 1–5; `displayPath(projectDir, homeDir)` (`page/start-prompt-items.ts`, 10);
           `ChatView.reveal(sessionId)` (09); chat's `newSession` handler in `page/start.ts` (10)
Produces:  in `src/plugins/chat/page/resume-items.ts`:
           ```ts
           export type SessionItem =
             | { kind: 'new'; label: string }
             | { kind: 'past'; row: PastSessionRow; label: string };
           export const NEW_SESSION_LABEL = 'New session';
           export const SESSION_STEP_TITLE = 'Session';
           // Local time as `YYYY-MM-DD HH:mm`.
           export function sessionTime(modified: number): string;
           export function sessionItems(rows: readonly PastSessionRow[], showArchived: boolean): SessionItem[];
           export function withArchived(rows: readonly PastSessionRow[], hostSessionId: string, archived: boolean): PastSessionRow[];
           // The cursor index in `after` for the item under `cursor` in `before`.
           export function selectedAfterChange(before: readonly SessionItem[], cursor: number | null, after: readonly SessionItem[]): number;
           ```
           in `src/plugins/chat/page/picker.ts`: `PickerRequest<T>` gains `scope?: 'picker' | 'resume';` (comment:
           `` The scope pushed while it is open; `picker` when left out. ``) · `Picker` gains
           `cursorIndex(): number | null;` (comment: `` The open request's item index under the cursor; null when
           closed or nothing is visible. ``) · `PickerDeps.pushScope(scope: ChatScopeName): PushedScope`
           in `src/plugins/chat/page/start-prompt.ts`: `export interface StartPrompt { open(): void; toggleArchive():
           void; showArchived(): void }` and `export function createStartPrompt(deps: StartPromptDeps): StartPrompt`,
           replacing `openStartPrompt`
           in `src/plugins/chat/manifest.ts`: scope `resume: 'In the session list'`; commands `toggleArchive: { label:
           'archive or restore the session', group: 'picker', runsIn: 'page' }` and `showArchived: { label: 'show or hide
           archived sessions', group: 'picker', runsIn: 'page' }`; page binds in scope `resume`: `j` pickerDown, `k`
           pickerUp, `Enter` pickerPick, `Escape` pickerClose, `/` pickerFilter, `x` toggleArchive, `.` showArchived;
           editor binds in scope `resume`: `<CR>` pickerPick, `<Esc>` pickerList
Decisions: the session step is the picker plan A already has, opened in a scope of its own so `x` and `.` exist only
           in the session list: the `resume` scope repeats the `picker` scope's list binds, which the key engine
           allows for distinct scopes (plan A task 09, Key clash check) · the picker pushes `request.scope ?? 'picker'`;
           a request replacing an open one with the same scope keeps the pushed scope, with another scope pops it and
           pushes the new one; every existing caller (folder, profile, control pickers) passes no scope and is
           unchanged; `start.ts` builds the picker with `pushScope: (scope) => api.keys.pushScope(scope)` (the page API qualifies the
           short scope name itself, `src/renderer/plugins/page-api.ts:65`; `PickerDeps.pushScope(scope: ChatScopeName)`
           stays as above) ·
           **flow**, replacing task 10's step 5 entry, every log line under `chat`:
           1. after the profile (task 10 step 4) the prompt invokes `pastSessions(projectDir, profile.name)`. A rejection
              logs `saved sessions not listed: <errorText>`, toasts `Saved sessions not listed: <errorText>`
              (`error`) and opens the step with `New session` alone. An empty answer runs task 10's step 5 at once (as
              one profile skips the profile step).
           2. the step opens the picker `{ title: SESSION_STEP_TITLE, scope: 'resume', items: sessionItems(rows,
              showArchived), label: item.label, selected: 0 }` with `showArchived` false at each `open()`.
           3. picking `New session` runs task 10's step 5 unchanged; picking a past item logs `resuming <title> in
              <displayPath> with <profile name>` and invokes `resume({ projectDir, profile: name, hostSessionId })`;
              the answer goes to `reveal(id)`; a rejection logs `session not resumed: <errorText>` and toasts
              `Session not resumed: <errorText>` (`error`).
           4. `toggleArchive` (`x`): the item at `picker.cursorIndex()` of the step's current items; with the step not
              open or nothing under the cursor it logs `no session under the cursor`; on `New session` it logs `New
              session cannot be archived`; on a past item it invokes `setArchived(hostSessionId, !archived)`, then sets
              `rows = withArchived(rows, hostSessionId, !archived)`, reopens the picker with the new items and
              `selected: selectedAfterChange(before, cursor, after)`, and only then logs `archived <title>` or
              `restored <title>`; a rejection logs `archive failed: <errorText>`, toasts `Archive failed:
              <errorText>` (`error`) and leaves the list as it was.
           5. `showArchived` (`.`): with the step open, flips `showArchived`, reopens as in 4, then logs `archived
              sessions shown` or `archived sessions hidden`; with it not open it logs `no session list shown`.
           A reopen clears the filter (the picker's `open` does) and logs `picker shown: Session` before the step's
           own line, so a self-test step's last line is the step's own ·
           `sessionItems`: `{ kind: 'new', label: NEW_SESSION_LABEL }` first, then each row in the given order, the
           archived ones only when `showArchived`, label `<title> · <sessionTime(modified)>` plus ` · archived` for
           an archived row · `sessionTime` reads the `Date`'s local fields, zero-padded ·
           `withArchived`: a copy with that row's `archived` set, the rest unchanged ·
           `selectedAfterChange`: `cursor` null or out of range, or `before[cursor]` the new item → 0; else the index
           in `after` of the past item with the same `hostSessionId`; else the index in `after` of the first past item
           after `cursor` in `before` that `after` holds; else `after.length - 1` ·
           `start.ts`: `const prompt = createStartPrompt(deps)`; `newSession: () => prompt.open()`,
           `toggleArchive: () => prompt.toggleArchive()`, `showArchived: () => prompt.showArchived()`
GIVEN `sessionTime(new Date(2026, 9, 20, 9, 5).getTime())` THEN `2026-10-20 09:05`
GIVEN rows `a` (title `alpha`, not archived) and `b` (`beta`, archived), each `modified` from `new Date(2026, 0, 2, 3, 4)`
      WHEN `sessionItems(rows, false)` runs THEN labels `['New session', 'alpha · 2026-01-02 03:04']`; with `true` THEN
      `['New session', 'alpha · 2026-01-02 03:04', 'beta · 2026-01-02 03:04 · archived']`
GIVEN rows `a`, `b` WHEN `withArchived(rows, 'b', false)` runs THEN `b.archived` is false, `a` is unchanged and the input
      rows are unchanged
GIVEN before `[new, a, b, c]`, cursor 1 (`a`), and after `[new, b, c]` (a archived and hidden) WHEN `selectedAfterChange`
      runs THEN 1 (`b`); cursor 3 (`c`) and after `[new, a, b]` THEN 2 (the last); cursor 2 (`b`) and after `[new, a,
      b, c]` THEN 2; cursor 0 THEN 0; cursor null THEN 0
GIVEN the self-test's session step WHEN `j` `x`, `.`, `k` `x`, `.` run THEN the lines `archived fake past session one`,
      `archived sessions shown`, `restored fake past session one`, `archived sessions hidden` (task 07 steps 25–28)
GIVEN the session step WHEN Enter on a past session runs THEN `Chat tab shown in chat-selftest` with the history drawn
      (task 07 step 29)
Tests:     `resume-items.test.ts`: `sessionTime_LocalFieldsZeroPadded`, `sessionItems_NewFirstArchivedOnlyWhenShown`,
           `withArchived_CopiesWithTheFlagSet`, `selectedAfterChange_SameItemNextOrLast` (every case above) — rows built
           in the test; the flow over the overlay, the scope and the channel is pinned by task 07's self-test steps
Done when: the typecheck and `npm run lint` pass (the page's key checks accept the `resume` binds at startup in the
           self-test); the test gate runs `resume-items.test.ts`
Commit:    one commit for the group

## Proof

Commit `959f5a1`. Proof: diff read (every Produces present, plus the `resume` scope's insert `<CR>` bind and `ListPicker.cursorIndex`) and `npm run typecheck` pass. Concerns: a palette-run `toggleArchive` after another picker replaced the step acts on the old step; the reopen after archiving runs even after the list closed.
