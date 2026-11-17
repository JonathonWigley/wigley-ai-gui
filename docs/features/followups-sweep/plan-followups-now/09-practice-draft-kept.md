# 09 — Practice keeps a draft saved during an open read

Status: in progress
Type: Task
Rung: deep · an async read/save race across the view, the workspace and main's `open` and save calls
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md` L929, "A re-picked problem's open read can overwrite a just-saved draft".

Files:     modify `src/plugins/practice/page/workspace-state.ts` · modify `src/plugins/practice/page/problem-workspace.ts` ·
           modify `src/plugins/practice/page/practice-view.ts` · test `src/plugins/practice/page/workspace-state.test.ts` ·
           test `src/plugins/practice/page/start.test.ts`

Preconditions (checked 2026-11-17 on `main` 9b671bd16, from the `wigley-ai-gui/` folder):

| Claim | Command | Expected |
|---|---|---|
| `refreshed` carries only the problem | `grep -n "type: 'refreshed'" src/plugins/practice/page/workspace-state.ts` | `73:  \| { type: 'refreshed'; problem: OpenedProblem }` |
| The reducer takes the read's text for any saved draft | `grep -n "const isSaved = draft.savedRevision === draft.revision" src/plugins/practice/page/workspace-state.ts` | one line, near 248 |
| The only dispatch of `refreshed` | `grep -rn "type: 'refreshed'" src/plugins/practice/page --include='*.ts' \| grep -v test` | `workspace-state.ts:73` and `problem-workspace.ts:1297` |
| The three reads that end in `applyOpened` | `grep -n "channel.invoke('open'" src/plugins/practice/page/practice-view.ts src/plugins/practice/page/problem-workspace.ts` | `openProblem` and `refreshOpen` in `practice-view.ts`, `reopen` in `problem-workspace.ts` |
| `applyOpened` has no caller outside the two files | `grep -rn "applyOpened" src/plugins/practice --include='*.ts'` | lines in `practice-view.ts` and `problem-workspace.ts` only |

The race: while a switch from A to B waits on A's save, picking A again (or `refreshOpen` after a `changed`) reads A
from disk. When that read began before A's save landed, the save's `saveFinished` sets `savedRevision === revision`,
and the read's older text then replaces the draft the save just wrote.

Consumes:  nothing from another task
Produces:
- `export interface DraftMark { readonly slug: string | null; readonly savedRevisions: Readonly<Record<DraftId,
  number>> }` in `workspace-state.ts`: the slug the workspace showed (`state.problem?.summary.slug ?? null`) and each
  draft's `savedRevision`, as a read began.
- `export function draftMark(state: WorkspaceState): DraftMark` in `workspace-state.ts`.
- `WorkspaceAction` member becomes `{ type: 'refreshed'; problem: OpenedProblem; mark: DraftMark }`.
- `ProblemWorkspace.readMark(): DraftMark` and `ProblemWorkspace.refresh(problem: OpenedProblem, mark: DraftMark): void`
  in `problem-workspace.ts`.
- `ProblemWorkspaceDeps.applyOpened(problem: OpenedProblem, mark: DraftMark): void` in `problem-workspace.ts`, and
  `PracticeView.applyOpened(problem: OpenedProblem, mark: DraftMark): void` in `practice-view.ts`.

Decisions:
- Fix in the reducer, fed by a mark taken when the read starts (the follow-up's first option). Ordering the read
  after the pending saves still loses a save that starts and lands during the read; the mark covers both.
- The mark is per draft and holds `savedRevision`, not `revision`: a draft whose `savedRevision` moved after the read
  began has saved text at least as new as the read, so it keeps its text. A draft unsaved at the read's end is kept
  by the existing rule. Rule in `refreshed`: a draft takes the read's text only while it is saved
  (`savedRevision === revision`), `mark.slug === problem.summary.slug`, and its `savedRevision ===
  mark.savedRevisions[id]`.
- A mark of another slug keeps every draft's text. It happens when a read of X starts while Y shows and X is shown
  (by an earlier read's show) when it lands; revision numbers of two problems are unrelated, so the mark proves
  nothing. Keeping is the safe side: X's drafts came from that earlier read a moment before, and the next `changed`
  reads again. The summary and submissions still refresh.
- Revision numbers suffice across opens: `opened` resets every draft to revision 0, but a read that spans an open is
  already dropped before it reaches `refresh` (`openProblem` and `refreshOpen` drop a read overtaken by a later
  `openProblem`; `reopen` drops one once a later `show` began; `refresh` ignores another slug).
- Each read takes its mark just before its `channel.invoke('open', …)`: `openProblem` and `refreshOpen` call
  `workspace.readMark()`; `reopen` in the workspace calls `draftMark(store.get())`. The mark rides with the result
  through `applyOpened(problem, mark)`; the show path (another slug) ignores it.
- `readMark()` returns `draftMark` of the workspace store's state as it stands, whatever problem it shows; the
  mark's slug lets `refreshed` tell.

GIVEN a notes draft edited to `typed` whose save started before an open read began and finished during it
WHEN `refreshed` carries that read's `old notes`
THEN the draft keeps `typed`, and the draft object is unchanged.

GIVEN a notes draft saved before an open read began WHEN `refreshed` carries the read's `new notes` THEN the draft
takes `new notes` (the mark keeps nothing it should not).

GIVEN the existing rows (a saved draft, an unsaved draft, the same text) WHEN `refreshed` carries a mark taken at the
read's start with nothing during the read THEN each row's result is as today.

GIVEN a saved notes draft and a mark whose slug is another problem's WHEN `refreshed` carries `new notes` THEN the
draft keeps its text and the draft object is unchanged.

GIVEN the page with a notes save that started before a `changed` read began and finished during it WHEN the read
lands with the old notes THEN the notes box keeps its editor (no refresh replaced the draft).

Tests:     extend the table `'refresh keeps unsaved drafts: $case'` in `workspace-state.test.ts`:
           - add a column `duringRead: readonly WorkspaceAction[]` (`[]` on the three existing rows) and a column
             `markedSlug: string` (`SLUG` on every row but the last below). Each row builds
             `before = stateAfter(edits)`, `mark = { ...draftMark(before), slug: markedSlug }`,
             `atRead = duringRead.reduce(workspaceReducer,
             before)`, then `next = workspaceReducer(atRead, { type: 'refreshed', problem: problem({ notes: diskNotes }),
             mark })`, and asserts `next.drafts.notes.text === notes` and
             `(next.drafts.notes === atRead.drafts.notes) === isSameDraft`.
           - new row `'a draft saved during the read keeps its text'`: `edits` =
             `[{ type: 'draftChanged', id: 'notes', slug: SLUG, text: 'typed' }, { type: 'saveStarted', id: 'notes',
             slug: SLUG, revision: 1 }]`, `duringRead` = `[{ type: 'saveFinished', id: 'notes', slug: SLUG, revision: 1,
             error: null }]`, `diskNotes: 'old notes'`, `notes: 'typed'`, `isSameDraft: true`.
           - new row `'a draft saved before the read takes the new text'`: `edits` = the same `draftChanged` and
             `saveStarted` plus that `saveFinished`, `duringRead: []`, `diskNotes: 'new notes'`, `notes: 'new notes'`,
             `isSameDraft: false`.
           - new row `'a mark of another problem keeps a saved draft'`: `edits: []`, `duringRead: []`,
             `markedSlug: 'other-problem'`, `diskNotes: 'new notes'`, `notes: 'old notes'`, `isSameDraft: true`.
           One new `it` in `start.test.ts`, `'keeps a notes draft saved while a changed read was pending'`, pinning
           that the view takes the mark before its read: `startWithProblemOpen` with a `held` answer that returns a
           deferred `save` for `saveNotes`, and a deferred `read` for the second `open` of `SECOND` (count the opens of
           `SECOND`; the first is the setup's). Then `commands.showTab({ arg: 'notes' })`, `editors.type('typed')`,
           `harness.advance(AUTOSAVE_DELAY_MS)`, `await settle()` (assert `saveNotes` was called with
           `[SECOND, 'typed']`); `harness.send('changed', { slug: SECOND })`, `await settle()`;
           `save.resolve(undefined)`, `await settle()`; `read.resolve({ ...opened(HARD), notes: '' })`, `await settle()`
           twice. Assert `editorsOf(boxEditors, 'notes')` holds one editor, not destroyed: a refresh that replaced the
           draft with `''` would mount a second (see `refreshedDraft_ShownNotesBox_MountsANewEditor`).
Done when: compiles (`npm run typecheck`); `npm test` runs `src/plugins/practice/page/workspace-state.test.ts` and the
           practice page tests (`src/plugins/practice/page/start.test.ts`) green.
Commit:    one commit: "Practice: an open read keeps a draft saved after the read began (follow-up: a re-picked
           problem's open read can overwrite a just-saved draft)".

## Proof

