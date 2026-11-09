# 11 — Doc re-read

Status: done
Type: Task
Wave: 8 · Depends on: 10
Plan: [plan.md](plan.md)

Files:     modify only the docs below, where a line no longer matches the landed code
Consumes:  every landed task, 01–10
Produces:  docs that describe the landed code
Decisions: the docs were written ahead of the code (commit `2308d790`); a line the code proved wrong is fixed in the
           doc, never by bending the code back (`wigley:writing-for-agents` § Doctrine before code)

Check each doc line by line against the landed code:

- `docs/features/practice/design.md` — every section: the file names, the `problem.json` kinds and case shapes, the
  settings and their defaults, the verdict names, the compare modes, the value types, the ladder rule, the keys table
  (against `src/plugins/keymap.ts`), the tool names and arguments, the chat and sessions changes.
- `AGENTS.md` — the `practice/` plugin tree entry, the chat entry's new exports (`launch` and `resume` with
  `instructions` and `owner`, page `mountChat`), the owned-session paragraph under § A chat pane, and the sessions
  plugin tree entry (add the row `owner` there if the landed code keeps it on `SessionRow`).
- `docs/features/layouts/design.md` — the `practice` adopter row against the parts `src/plugins/practice/layouts/layout.d.ts`
  declares.
- `docs/features/agent-chat/design.md` and `docs/features/chat-panes/design.md` — any line saying a session shows only
  in a Sessions pane, or that instructions are global only: grep both for `addInstructions`, `at most one pane`,
  `launch`, and fix what the owned rows and per-session instructions changed.
- `docs/keymap.md` — whether its leader group list names `Space k` and `Space v` members; add `p` and `i` if it lists
  members.

GIVEN the landed code WHEN each doc above is read THEN no line contradicts it
Tests:     none — a doc check
Done when: every stale line is fixed and the fixes are committed
Commit:    one commit, `Practice mode docs: match the landed code`

## Proof

Commit a1d139d2 · proof: diff read of five docs against code: AGENTS.md chat exports/sessions owner/practice entry, layouts practice row, chat-panes owned-session line, agent-chat per-session instructions, practice design keys/scopes/tools/interviewer/import/self-test; lint clean · concerns: design.md does not name the 'chat view unmounted' and 'watch not started' log lines
