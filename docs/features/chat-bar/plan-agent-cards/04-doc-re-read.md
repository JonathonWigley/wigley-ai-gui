# 04 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify (as needed) `docs/features/chat-bar/design.md` · `docs/features/agent-tower/design.md` · `AGENTS.md`
Consumes:  the landed code of 01–03
Produces:  none
Decisions:
- Re-read, line by line against the landed code: `chat-bar/design.md` § The agent strip and § Decisions, and
  `agent-tower/design.md` § Vocabulary (Roster), § Agent events table, § The agents plugin. Fix every stale line.
- Grep `AGENTS.md` and `docs/` for `failed box`, `dimmed`, `until the next message`, `userMessage drops` and fix any
  line still describing failed boxes staying.
Done when: every line read matches the code; fixes committed
Commit:    one commit for the group (none when nothing changed — say so in the Proof)

## Proof
