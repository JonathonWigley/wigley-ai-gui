# 04 — Doc re-read

Status: not started
Type: Task
Wave: 3 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files:     modify `docs/features/agent-chat/design.md` (only where a line is stale)
Consumes:  the landed code of 01, 02, 03
Produces:  none
Decisions: the doc was written ahead of the code, so it is a hypothesis (`wigley:writing-for-agents` § Doctrine
           before code)

Read each line of these sections against the landed code: § Chat plugin › Activity line (Live run), § Chat plugin ›
Working block, § Layouts (the `working` part sentence), § Plans (Plan G). Fix every line the code contradicts.
Also read the comments in `layout.d.ts`, `entry-list.ts` and `chat.css` that this run touched.

Done when: every line in those sections matches the code; the fixes are committed
Commit:    one commit, or none when nothing is stale

## Proof
