# 09 — Practice keeps a draft saved during an open read

Status: not started
Type: Task
Rung: hard · threads a read mark through the workspace and view around async saves and reads; every choice is settled below
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md` L929, "A re-picked problem's open read can overwrite a just-saved draft".

Files:     modify `src/plugins/practice/page/workspace-state.ts` · modify `src/plugins/practice/page/problem-workspace.ts` ·
           modify `src/plugins/practice/page/practice-view.ts` · test `src/plugins/practice/page/workspace-state.test.ts`

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
- `export type DraftMark = Readonly<Record<DraftId, number>>;` in `workspace-state.ts`: each draft's `savedRevision`
  as a read of the shown problem began.
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
  (`savedRevision === revision`) and its `savedRevision === mark[id]`.
- Revision numbers suffice across opens: `opened` resets every draft to revision 0, but a read that spans an open is
  already dropped before it reaches `refresh` (`openProblem` and `refreshOpen` drop a read overtaken by a later
  `openProblem`; `reopen` drops one once a later `show` began; `refresh` ignores another slug).
- Each read takes its mark just before its `channel.invoke('open', …)`: `openProblem` and `refreshOpen` call
  `workspace.readMark()`; `reopen` in the workspace calls `draftMark(store.get())`. The mark rides with the result
  through `applyOpened(problem, mark)`; the show path (another slug) ignores it.
- `readMark()` returns `draftMark` of the workspace store's state as it stands, whatever problem it shows.

GIVEN a notes draft edited to `typed` whose save started before an open read began and finished during it
WHEN `refreshed` carries that read's `old notes`
THEN the draft keeps `typed`, and the draft object is unchanged.

GIVEN a notes draft saved before an open read began WHEN `refreshed` carries the read's `new notes` THEN the draft
takes `new notes` (the mark keeps nothing it should not).

GIVEN the existing rows (a saved draft, an unsaved draft, the same text) WHEN `refreshed` carries a mark taken at the
read's start with nothing during the read THEN each row's result is as today.

Tests:     extend the table `'refresh keeps unsaved drafts: $case'` in `workspace-state.test.ts`:
           - add a column `duringRead: readonly WorkspaceAction[]` (`[]` on the three existing rows). Each row builds
             `before = stateAfter(edits)`, `mark = draftMark(before)`, `atRead = duringRead.reduce(workspaceReducer,
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
Done when: compiles (`npm run typecheck`); `npm test` runs `src/plugins/practice/page/workspace-state.test.ts` and the
           practice page tests (`src/plugins/practice/page/start.test.ts`) green.
Commit:    one commit: "Practice: an open read keeps a draft saved after the read began (follow-up: a re-picked
           problem's open read can overwrite a just-saved draft)".

## Proof

