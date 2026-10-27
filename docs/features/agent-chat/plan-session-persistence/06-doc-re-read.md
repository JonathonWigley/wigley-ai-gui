# 06 — Doc re-read

Status: not started
Type: Task
Wave: 5 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify (only where stale) `docs/features/agent-chat/design.md` · `AGENTS.md`
Consumes:  the landed code of 01–05
Produces:  the docs written ahead (commit `3ff5036`) true to the landed code
Decisions: a doc written before its code is re-read line by line against it (`wigley:writing-for-agents` § Doctrine
           before code)

Read each passage below line by line against the code, fix every stale line, and commit the fixes:

- `docs/features/agent-chat/design.md`: glossary **Owned session**; Chat plugin § Chat tab (the resting-session
  sentence); § Saved sessions (every claim: the record's fields, what removes a record, the restore order and
  selection, history on first show, `--resume` versus `--session-id`, the notices, the missing-profile send, the
  unreadable file, the close confirmation); § App slash commands; § Resume and archive.
- `AGENTS.md`: the owned-session paragraph in Architecture.
- Search `docs/`, `AGENTS.md` and `DESIGN.md` for `chat.ended`, `ended session`, `ended row` and `sessionEnded`
  and fix any line still describing the ended state.

Done when: every line above matches the code; the fixes are committed (none is also a valid outcome, recorded in
           the Proof)
Commit:    one commit for the group, when there are fixes

## Proof
