# 04 — Doc re-read

Status: done
Type: Task
Wave: 4 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify (as needed) `docs/features/chat-bar/design.md` · `docs/features/agent-tower/design.md` · `AGENTS.md`
Consumes:  the landed code of 01–03
Produces:  none
Decisions:
- Re-read, line by line against the landed code: `chat-bar/design.md` § The agent strip and § Decisions, and
  `agent-tower/design.md` § Vocabulary (Roster), § Agent events table, § The agents plugin. Fix every stale line.
- Grep `AGENTS.md`, `docs/` and `src/` comments for `failed box`, `dimmed`, `until the next message`,
  `userMessage drops`, `marks them finished`, `failed items`, `finished item`, and fix any line still describing
  failed or finished items staying (the fake harness's header comment included).
Done when: every line read matches the code; fixes committed
Commit:    one commit for the group (none when nothing changed — say so in the Proof)

## Proof

Commit 2c273285 · proof: diff read: two stale design lines fixed; worker reports each grep term run, remaining hits true or about other surfaces; lint passes · concerns: worker did not re-verify chat-bar's keys and scrolling lines against page code beyond the log lines; agent-strip.css's 80% composer cap comment left for the review
