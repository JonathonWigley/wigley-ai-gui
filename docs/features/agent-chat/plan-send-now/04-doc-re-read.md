# 04 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify (where stale) `docs/features/agent-chat/design.md` · `docs/keymap.md`
Decisions:
- Read `docs/features/agent-chat/design.md` § Pending messages line by line against the landed code: the intro, Sending, Send now, Pulling back, Interrupt and exit. Also read the `queuedMessage` part line in its layout section, which was updated ahead to name `sent`. Check every log line, label, key, field name (`sentEntryId`, `messageDropped`) and behaviour, and fix each line that drifted.
- `docs/keymap.md`: the `c` leader row names `cs`, and the Cmd line still holds (Cmd+Enter is a send).
- `AGENTS.md`: nothing expected. Confirm with `grep -n "AgentProcess\|queuedMessage\|user entr" AGENTS.md` that no line describes send timing.
Done when: each doc matches the code; fixes committed.
Commit:    one commit, or none when nothing was stale

## Proof

