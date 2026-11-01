# 11 — Doc re-read against the landed code

Status: not started
Type: Task
Wave: 6 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
Plan: [plan.md](plan.md)

Files:     modify, where a line is stale: `docs/features/agent-tower/design.md` · `AGENTS.md` ·
           `docs/features/layouts/design.md` · `docs/features/agent-chat/claude-stream.md` (01's section)
Consumes:  every Produces of 01–10
Decisions: the docs were written ahead in `fd57454` as a hypothesis (`~/wigley-agents/decisions.md` § Docs); the code
           is the source of truth, and a doc line that disagrees with it is rewritten to match
GIVEN the landed code WHEN each doc line below is read against it THEN every line holds, or is fixed

Check line by line:

- `docs/features/agent-tower/design.md` § Status, § Vocabulary, § Agent events (the event table's names and fields
  against `AgentEvent` in `src/contracts/agent.ts`), § The agents plugin (the log path, `sessionEnded` handling, the
  line's fields, the ticker, the click).
- `AGENTS.md`: the `agents/` entry in the Architecture tree (file names under `src/plugins/agents/`), the sessions
  entry's "row parts", the "A row part" bullet (`addRowPart`, `contributedParts`, the wrapper's place), the "An agent
  event" bullet (`agentEvent`, `chat.agentEvent`), and the self-test paragraph in § Running and testing when the
  agents plugin hands a script (name its script beside chat's and docs').
- `docs/features/layouts/design.md`: the `agents` owner row (setting name, surfaces) and the `Space z l a` preview
  row.
- `docs/features/agent-chat/claude-stream.md`: 01's section against what 03's decoder reads.

Tests:     none — a doc change
Done when: every line above checked; fixes committed
Commit:    one commit for the group, naming each doc changed

## Proof
