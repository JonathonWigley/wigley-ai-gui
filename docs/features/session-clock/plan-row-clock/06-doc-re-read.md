# 06 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05
Plan: [plan.md](plan.md)

Files:     modify `docs/features/session-clock/design.md` · modify `docs/features/usage/design.md` ·
           modify `docs/features/agent-chat/design.md` (the Saved sessions line on `activeMs`) ·
           modify `DESIGN.md` (§ Surfaces, the Sessions rows sentence; re-read it at `main`'s tip, since the peer
           plan `session-groups` edits the same side-bar paragraph)
Consumes:  the landed code of tasks 01–05
Produces:  both docs true to the landed code
Decisions: a doc written before its code is a hypothesis (`wigley:writing-for-agents` § Doctrine before code)

Read each doc line by line against the landed code. Check every name, part id, event name, field name, save point
and rule. Fix each stale line. In `session-clock/design.md`, change the Status section to say the feature is built.
Also check the contract prose in `src/plugins/sessions/layouts/layout.d.ts`, `src/plugins/usage/layouts/layout.d.ts`
(its header lists the row line slot) and `src/plugins/chat/contract.ts` (`ChatPageExports` prose) against the code,
and fix what is stale.

Tests:     none
Done when: every line checked; the fixes committed
Commit:    one commit for the group

## Proof

