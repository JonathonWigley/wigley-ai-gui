# 02 — Doc re-read

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     modify, only where a line is stale: `docs/features/agent-chat/design.md` · `AGENTS.md`

Decisions:

- Read each doc written ahead line by line against the landed code: the "Starting a session from an agent" bullet in `docs/features/agent-chat/design.md` § Chat plugin, and the `chat/` line in the source tree of `AGENTS.md`. Fix every stale line.
- `docs/features/followups.md`'s signing item describes separate work and is not checked here.

Done when: each line matches the landed code, and any fix is committed

Commit:    one commit, only if a line changed

## Proof

Commit none · proof: both written-ahead lines read against 87fd8df5: the design.md bullet and the AGENTS.md chat/ line hold; launch passes select false in chat-sessions.ts; no line changed · concerns: none
