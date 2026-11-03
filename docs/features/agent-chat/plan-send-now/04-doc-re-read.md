# 04 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify (only if stale) `docs/features/agent-chat/design.md` · `docs/keymap.md` · `AGENTS.md`
Decisions:
- Read `docs/features/agent-chat/design.md` § Pending messages (the intro, Sending, Send now, Pulling back, Interrupt and exit) and the `queuedMessage` part line in its layout section line by line against the landed code: every log line, label, key, field name (`sentEntryId`, `messageDropped`) and behaviour. Fix each line that drifted.
- `docs/keymap.md`: the `c` leader row names `cs`; check the Cmd line still holds (Cmd+Enter is a send).
- `AGENTS.md`: if its Architecture text describes `AgentProcess.send` or when user entries arrive, check it.
Done when: each doc matches the code; fixes committed.
Commit:    one commit, or none when nothing was stale

## Proof

