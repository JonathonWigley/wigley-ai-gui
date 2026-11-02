# 04 — Workflow plan references

Status: not started
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify `docs/features/workflow/plan-workflow/*.md` (each file that `grep -rln "SessionRowPart"` names)
Consumes:  `SessionPart` ← 01
Produces:  no `SessionRowPart` left in `docs/features/workflow/plan-workflow/`
Decisions: this plan runs before the workflow plan, so it updates that plan's references (round 3, the user's note)

## Changes

- Run `grep -rn "SessionRowPart" docs/features/workflow/plan-workflow/`. Replace each `SessionRowPart` with
  `SessionPart`. Change no other text.
- A peer owns these files and may be editing them. Use one exact-string edit for each occurrence. Do not rewrite a file.
- **Commit rule.** Check `git ls-files docs/features/workflow/plan-workflow/`.
  - Commit only the files it lists, with only this change.
  - Leave the untracked files uncommitted, and name them in the Proof. They are the peer's files.

Done when: the grep prints nothing.
Commit:    one commit for the tracked files, or none when every file is untracked

## Proof

