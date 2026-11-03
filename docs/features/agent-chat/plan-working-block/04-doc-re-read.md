# 04 — Doc re-read

Status: not started
Type: Task
Wave: 3 · Depends on: 02, 03
Plan: [plan.md](plan.md)

Files:     modify, only where a line is stale: `docs/features/agent-chat/design.md` · `DESIGN.md` ·
           `src/plugins/chat/layouts/layout.d.ts` · `src/plugins/chat/layouts/default/layout.js` ·
           `src/plugins/chat/page/entry-list.ts` · `src/plugins/chat/page/chat-view.ts` · `src/plugins/chat/page/chat.css`
Consumes:  the landed code of 01, 02, 03
Produces:  none
Decisions: the docs were written ahead of the code, so they are a hypothesis (`wigley:writing-for-agents` § Doctrine
           before code)

Read each line against the landed code:

- `docs/features/agent-chat/design.md`: § Chat plugin (the Chat tab bullet, Activity line, Working block, Pending
  messages), § Layouts (the `working` part sentence), § Plans (Plan G).
- `DESIGN.md` § Surfaces, the **Chat** bullet (the activity line and the working block).
- The comments this run touched in the code files above.

Fix every line the code contradicts. Another session may edit `DESIGN.md` or `design.md`: when either file has
uncommitted changes that this run did not make, stop and report instead of committing it.

Done when: every line in those places matches the code; the fixes are committed
Commit:    one commit, or none when nothing is stale

## Proof
