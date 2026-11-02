# 05 — Doc re-read

Status: not started
Type: Task
Wave: 3 · Depends on: 03, 04
Plan: [plan.md](plan.md)

Files:     modify only as needed `AGENTS.md`, `DESIGN.md`, `docs/features/usage/design.md`, `docs/features/layouts/design.md`
Consumes:  the landed code of 01–03
Produces:  the docs written ahead (commit `2813b99`) agree with the code

## Changes

Read each changed line of commit `2813b99` (`git show 2813b99`) against the landed code. Check:

- **`AGENTS.md`**:
  - the sessions and usage folder lines
  - the session part / row part / bar part entry: the type name, the export names, and that sessions hands each part
    a wrapper and the session id
- **`DESIGN.md` § Usage**:
  - where the line sits in the tab bar
  - `text-12`
  - no line without usage
  - the status bar holds only the plan rows
- **`docs/features/usage/design.md`**:
  - the Flow diagram
  - The usage plugin › Page: the log line text `session line <session id>: <text>`, and the redraw triggers
  - Decisions and Rejected
- **`docs/features/layouts/design.md`**: the `sessions` and `usage` rows.

Fix each stale line. Also grep `docs/features/` (not `workflow/plan-workflow/`, which task 04 owns) and `src/` comments
for `SessionRowPart`, `createSessionRowParts`, `row-parts` and "status line" text that names the session's context.
Fix what is stale.

Done when: each checked line matches the code, and the greps print nothing stale.
Commit:    one commit for the doc fixes, or none when nothing is stale

## Proof

