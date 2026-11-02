# 05 — Doc re-read

Status: in progress
Type: Task
Wave: 5 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     modify, as needed, `docs/features/agent-chat/design.md` · `docs/keymap.md`
Consumes:  the landed code of 01–04
Produces:  each doc written ahead (commit `cb9591f`) true to the landed code
Decisions: check line by line against the code:
           `design.md` § Chat plugin › Pending messages: the queue condition, the drain and the hidden idle, pull-back's three routes and its log line, interrupt and exit returning every message oldest first, slash commands
           `design.md` § Chat plugin › Chat tab: the Enter and Ctrl+C wording
           `design.md` § Layouts: the `queuedMessage` part and its input
           `docs/keymap.md` § Leader groups: the `c` row's `cp`
           fix every stale line; leave every other section alone
Done when: every line above matches the code; the fixes are committed
Commit:    one commit, docs only

## Proof
