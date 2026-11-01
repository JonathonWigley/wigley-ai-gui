# 08 — Doc re-read

Status: in progress
Type: Batch
Wave: 6 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     modify, only where a line is stale: `docs/features/usage/design.md` · `AGENTS.md` · `DESIGN.md` ·
           `docs/keymap.md` · `docs/features/agent-tower/design.md` · `docs/features/layouts/design.md` ·
           `docs/features/agent-chat/claude-stream.md`
Consumes:  every landed group, 01–07
Produces:  each doc above true of the landed code, line by line
Decisions: each doc written ahead in commit `444f673` is read line by line against the code 01–07 landed, under
           `wigley:writing-for-agents` § Doctrine before code. A line the code contradicts is fixed in the doc
           when the code follows the plan's decisions; a line where the code strayed from a settled decision is a
           finding for the run's review, not a doc edit
           The checks that matter most:
           - `design.md` § Records against `src/contracts/agent.ts`, and § Sources against the adapter's real mapping
             (labels per kind, the cache TTL rule, the poll timeout)
           - `design.md` § The usage plugin against usage main and page (poll timing, stale and error, what the line
             leaves out with no session)
           - `AGENTS.md`'s `usage/` entry and shell bullet against the plugin folder and the right bar's behaviour in
             a narrow window
           - `DESIGN.md` § Usage against the layout's real line order and tints
           - `agent-tower/design.md` § Status against what `chat.agentEvent` really carries
           - `claude-stream.md` § Usage against the shapes the adapter's tests build
Tests:     none: a doc change picks no test
Done when: every listed doc read in full against the code; every stale line fixed
Commit:    one commit for the group, naming each doc fixed, or no commit when nothing was stale (say so in Proof)

## Proof
