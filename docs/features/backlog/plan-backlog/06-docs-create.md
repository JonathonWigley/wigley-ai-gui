# 06 — Docs creates follow-ups through the shared module

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/kinds.ts` · test `src/plugins/docs/kinds.test.ts` · modify
           `src/plugins/docs/page/docs-dialogs.ts` only when the provisional entry's line changes
Consumes:  `applyFollowupEdit(text, edit)`, `newFollowupsFile(repo)`, `FollowupEditResult` ← 01
Produces:  `KIND_RULES.followup.contents(name, existing)` in `src/plugins/docs/kinds.ts` returns the text and line from
           `applyFollowupEdit`
Decisions: one writer of the follow-up shape (design.md § Seams) · Docs' create dialog keeps its one Title box: the
           draft is `{ title: name, oneLine: '', tags: [], body: '' }`, and the user fills the rest in the editor it
           opens on, as today

## What changes

- `appendedFollowup(name, existing)` (`kinds.ts`, the `followup` rule's `contents`) today appends `- **name** — `
  to any file. Replace its body: apply `{ type: 'create', draft }` to `existing` and return `{ text, line }` from the
  `applied` result.
- Docs offers a follow-up place only where the index already lists a `followups.md` (`placeFolder` returns null
  otherwise), so `existing` is null or `''` only when the file vanished or was emptied after the index read. Then
  start from `newFollowupsFile(<home folder base name>)`; Backlog, not Docs, creates new follow-ups files with the
  real repo name.
- `titleTaken` throws `A follow-up titled <title> already exists`, which the dialog already shows as an error toast.

GIVEN a section-shaped `followups.md` WHEN the user creates follow-up `Fix the badge` from Docs mode THEN a Contents line
and a `## Fix the badge` section are added, and the editor opens on the heading line.

Tests:     `kinds.test.ts`: create into a section-shaped file, a list-shaped file and a missing file · `titleTaken`
           throws. Build every file text in the test.
Done when: `npm test -- src/plugins/docs` passes; `npm run lint` and `npm run typecheck` pass.
Commit:    one commit for the group

## Proof
