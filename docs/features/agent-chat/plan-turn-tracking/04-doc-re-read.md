# 04 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 01, 02, 03
Plan: [plan.md](plan.md)

Files:     modify (when stale) `docs/features/agent-chat/claude-stream.md` · `docs/features/agent-chat/design.md` ·
           `AGENTS.md`
Consumes:  the landed code of 01, 02, 03
Produces:  docs that match the landed code
Decisions: docs written ahead are hypotheses until re-read against the code (`wigley:writing-for-agents` § Doctrine
           before code)

Read each doc written ahead (commits `33b38475`, `21ef5f8a`) line by line against the landed code:

- `docs/features/agent-chat/claude-stream.md` — § Result (one result can answer more than one message), § Interrupt
  (the idle-process case), § Queued messages, § Message lifecycle. Check every statement about what the adapter does
  against `claude-code-harness.ts` and `turn-tracker.ts`.
- `docs/features/agent-chat/design.md` § Pending messages — Claude's own turn shows working; held messages wait
  through it; the turn-finished alert fires when it ends; a message written into a running tool turn folds.
- `AGENTS.md`, the Claude adapter readings line — the adapter tracks each message by its client uuid.

Also check `docs/features/agent-chat/design.md` for any other line that says the adapter counts results, sets working
only on its own sends, or that a `/effort` or `/model` command carries no id; fix each.

GIVEN a doc line that the landed code contradicts WHEN the re-read finds it THEN the line is rewritten to the code
Tests:     none (a doc change)
Done when: every line in the three docs agrees with the landed code; the fixes are committed, or the report states
           that no line was stale.
Commit:    one commit for the group, when a fix was needed

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
