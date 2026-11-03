# 04 — Doc re-read

Status: done
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
- `docs/features/agent-chat/design.md`, the Claude adapter's **Interrupt** bullet (commit `ad630fd7`) — the 5 s
  grace, its notice, and the second Ctrl+C that ends the process; § Pending messages' **Interrupt and exit** bullet.
- `docs/features/agent-chat/claude-stream.md` § Init (the `capabilities` entry), § Effort and § Model (they describe
  the CLI; add one line where they say the adapter's command carries no id), § Subagents (Claude's own turns), and
  § Message lifecycle's local slash command paragraph (commit `e38f1bb7`).
- `docs/features/agent-chat/design.md` § Working block: its header time counts from the turn's user entry; add that a
  turn Claude runs on its own has no user entry and counts from its `turnStarted`.
- `AGENTS.md`, the Claude adapter readings line — the adapter tracks each message by its client uuid.

Then run `grep -rn "pendingTurns\|one result per\|own result" docs AGENTS.md` and fix each line that says the
adapter counts results, sets working only on its own sends, or that a `/effort` or `/model` command carries no id.

GIVEN a doc line that the landed code contradicts WHEN the re-read finds it THEN the line is rewritten to the code
Tests:     none (a doc change)
Done when: every section listed above, and every line the grep finds, agrees with the landed code; the fixes are committed, or the report states
           that no line was stale.
Commit:    one commit for the group, when a fix was needed

## Proof

Commit 4987c3e4 · proof: diff read: each listed section stale-and-fixed or already true; the grep finds no stale line outside plan folders · concerns: design.md § Working block line not written: no working-block code on this branch (it belongs to the unlanded plan-working-block); an own turn with uuids stays unmeasured
