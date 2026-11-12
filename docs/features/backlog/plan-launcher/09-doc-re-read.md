# 09 — Doc re-read

Status: not started
Type: Task
Rung: standard · doc-only: prose checked against landed code
Wave: 6 · Depends on: 08
Plan: [plan.md](plan.md)

Files:     modify `wigley-ai-gui/docs/features/backlog/design.md` · modify `wigley-ai-gui/docs/features/scoped-agents/design.md` · modify `wigley-ai-gui/docs/features/practice/design.md` · modify `wigley-ai-gui/AGENTS.md` · modify `wigley-ai-gui/docs/keymap.md` · modify `wigley-ai-gui/DESIGN.md` · modify `wigley-ai-gui/docs/features/layouts/design.md` · modify `wigley-ai-gui/docs/features/file-drop/design.md` · modify `wigley-ai-gui/docs/features/docs-browser/design.md`
Consumes:  the landed code of 01–08
Produces:  the docs written ahead (and the layouts design doc's owners table, which 03, 04 and 08 edit), true to the code, with every `planned in \`backlog/plan-launcher\`, not built yet` mark removed; the two docs outside that set that name removed Backlog behaviour, made true
Decisions: the docs were written ahead of the code (plan.md § Docs written ahead); each stays the design record of its area. What is read (sized for one standard worker: `AGENTS.md` alone is about 33k tokens):
- `docs/features/backlog/design.md`, `docs/features/scoped-agents/design.md` and `docs/features/layouts/design.md`'s owners table: read whole.
- `AGENTS.md`, `DESIGN.md`, `docs/keymap.md` and `docs/features/practice/design.md`: only the lines `grep -n "plan-launcher"` finds, each with its paragraph or table, and the lines that `grep -n -i -E "backlog|practice|interviewer|scoped-agents|ask box|askBox|side bar|followup-editor|plans view|commit"` finds in the Backlog, Practice and scoped-agents passages; not the whole file.
- `docs/features/file-drop/design.md:62`: "Backlog editor" leaves the vim boxes list (08 deletes the editor and its drop target).
- `docs/features/docs-browser/design.md:137`: "as Backlog mode writes it" is untrue (the page writes nothing now); name the assistant's edits, or say "the file's own shape" with no writer.
GIVEN a doc line naming a key, setting, default, file, part, tool, log line or behaviour WHEN it is read against the landed code THEN it matches the code, or is rewritten to match
Tests:     none: a doc change picks no test (`wigley:writing-tests` § Picking tests for a gate)
Done when: the lines named in Decisions are read against the code; every stale line is fixed; `grep -rn "plan-launcher" wigley-ai-gui/docs wigley-ai-gui/AGENTS.md wigley-ai-gui/DESIGN.md` finds only the plan folder itself; `grep -n "Backlog editor" wigley-ai-gui/docs/features/file-drop/design.md` finds nothing; the edits follow `wigley:writing-for-agents`
Commit:    one commit for the group

## Proof
