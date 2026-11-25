# 11 — Doc re-read

Status: done
Type: Batch
Rung: standard · doc-only: prose checked against settled code
Wave: 7 · Depends on: 10 (it reads every code task's landed result; 10 is the last of them)
Plan: [plan.md](plan.md)

Files (wigley-ai-gui):
- modify `docs/features/terminal/design.md`
- modify `docs/features/session-host/design.md`

Files (ai):
- modify `wigley-agents/AGENTS.md`

Consumes:  the landed code of tasks 01–10
Produces:  the three docs, true to the landed code, with no planned mark

Decisions:
- Check each doc line by line against the landed code. Read the code each line names; do not trust the plan text.
- Fix every stale line in place. A line about behaviour the run dropped by a ruling is removed.
- Drop the planned note at the top of `docs/features/terminal/design.md` and at the top of
  `docs/features/session-host/design.md` § The host › Terminals.
- In `wigley-agents/AGENTS.md` § Communication forms, remove the clause `; planned in the app's `plan-terminal`, not
  built yet` from the terminal line, and keep the rest of the sentence.
- The `ai` repo edit is made in a worktree of the `ai` clone per `~/wigley-agents/WigleyRepos.md` § Landing (branch
  `terminal-type-rule-done` from `origin/main`), and landed with `wigley-land`.
- Also read `README.md`'s `terminal` row, the `auri:terminal` skill and `docs/keymap.md`'s terminal lines (all from
  task 10 and 09) against the code, and fix what is stale.

GIVEN the landed run WHEN this task ends THEN `grep -rn 'plan-terminal' docs/features/terminal/design.md
docs/features/session-host/design.md` finds nothing, and `grep -n 'plan-terminal' wigley-agents/AGENTS.md` in the
`ai` worktree finds nothing.

Tests:     none (doc-only)
Done when: both greps above find nothing; each doc's claims were read against the code.
Commit:    one commit in wigley-ai-gui for the two design docs; one commit in the `ai` worktree for `AGENTS.md`

## Proof

Commit d6d5fb72 · proof: diff read: planned notes gone from both design docs, stale lines fixed against the code; grep plan-terminal finds nothing in both docs and in ai wigley-agents/AGENTS.md (ai commit 36fefed32 on terminal-type-rule-done); oxfmt clean · concerns: Alt+j/k wording follows the code's focus moves, not the plan's 'between chat and drawer'
