# 09 — Doc re-read

Status: not started
Type: Task
Wave: 5 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08
Plan: [plan.md](plan.md)

Files:     modify (only where a line is stale) `DESIGN.md` · `docs/features/agent-chat/design.md` · `docs/features/layouts/design.md` · `AGENTS.md` · `docs/features/ui-design/design.md` · `docs/features/followups.md`
Consumes:  every landed group
Produces:  each doc written ahead (commits `80ed832` and `fc51bc8`) true to the landed code
Decisions: read each passage line by line against the code, and fix every stale line (`wigley:writing-for-agents` § Doctrine before code):
           - `DESIGN.md` § Type (Scale, Prose, the `fonts` line), § Motion (What moves), § Keys and focus (the chat exception), § Primitives (Card, the plain variant), § Surfaces (Chat: the activity line and its time)
           - `docs/features/agent-chat/design.md` § Vocabulary (Chat entry's `at`, Step, Activity line), § Agent harness seam (the `at` stamping), § Chat plugin (Chat tab keys; Activity line, its timer and its log lines), § Layouts (the `activity` part, its input with the three time fields, `collapsibleRow`), § Plans (plan E)
           - `docs/features/layouts/design.md` § Adopters (the chat row), § Previews (the `Space z l c` row)
           - `AGENTS.md` § Architecture, the agent harness paragraph (`at`) and the "A chat layout" paragraph (`collapsibleRow`, the `activity` part)
           - `docs/features/ui-design/design.md`, the "Font settings win over the theme" line
           - `docs/features/followups.md`, the per-tool-call duration item
           also check that `layout.d.ts`'s comments and these docs name the same input fields and the same log lines
GIVEN the landed code WHEN each passage is read against it THEN no line states what the code does not do
Tests:     none
Done when: every stale line is fixed and committed, or the re-read finds none and says so in the Proof
Commit:    one commit for the fixes, when any

## Proof

