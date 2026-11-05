# 09 — Doc re-read

Status: in progress
Type: Task
Wave: 7 · Depends on: 10
Plan: [plan.md](plan.md)

Files:     modify, when a line is stale: `docs/features/session-log/design.md` · `AGENTS.md` · `docs/features/agent-chat/design.md`
Consumes:  the landed code of tasks 01 to 08, and each fix from task 10
Produces:  none
Decisions: these docs were written before the code, so each is a hypothesis until read against it (`wigley:writing-for-agents` § Doctrine before code)

The sweep is: `docs/features/session-log/design.md` whole; every line `e8aa534b` and the plan's commit added to `AGENTS.md` and `docs/features/agent-chat/design.md`; and each line of those two docs that a case-insensitive grep finds for `connected`, `sessionOpened`, `start prompt`, `resume`, `Session step`, `editableTitle`, `list picker`. Read each line against the landed code. Fix each stale line. Check these also:

- `AGENTS.md`'s "A registration" and "A send gate" neighbours: add a short "A resume section" bullet only if a later plugin needs a fact the contract does not show.
- `AGENTS.md`'s `src/shared/page` entry: it must stay true with list picker headings.

Done when: every line of the sweep is true of the code, and the fixes are committed
Commit:    one commit for the group, or none when nothing is stale

## Proof

