# 05 — Doc re-read

Status: not started
Type: Task
Wave: 5 · Depends on: 04, 06
Plan: [plan.md](plan.md)

Files:     modify (as needed) `docs/features/session-popups/design.md` · `AGENTS.md` · `DESIGN.md` · `docs/keymap.md` · `docs/features/primer/design.md` · `docs/features/agent-chat/design.md` · `docs/features/chat-bar/design.md` · `docs/features/docs-browser/design.md` · `docs/features/docs-wiki/design.md` · `docs/features/ui-design/design.md` · `docs/features/file-drop/design.md` · `docs/features/usage/design.md` · `docs/features/layouts/design.md` · `docs/features/session-titles/design.md` · `docs/features/followups.md` · in wigley-ai-marketplace: `plugins/wigley/scripts/forms/README.md` · `plugins/wigley/skills/feature-primer/SKILL.md`
Consumes:  the landed code of 01–04 and any fix 06 made
Produces:  docs true to the landed code, in both repos
Decisions: `wigley:writing-for-agents` § Doctrine before code (a doc written ahead is a hypothesis) · runs after 06 so the docs meet the final code · the marketplace's two "Primer tab" lines are fixed here (`~/wigley-agents/WigleyRepos.md` § Landing: a worktree of its own, landed with this run)

## What to do

- Read each doc written ahead (the list above, as commit 051e6b41 changed them) line by line against the landed
  code: names (`addPopup`, `SessionPopupView`, `SessionPopupHandle`, `sessions.togglePopup`, `popup`, `popupBar`,
  `sessions.popup-top`, `session-form-popups.ts`, `docs-session-tab`), log lines, the default disabled list, the
  hidden bar's content and key hint, the empty text, the focus and press rules, the stack order. Fix every stale line.
- Run, from the repo root:
  `grep -rni "Form tab\|Primer tab\|takeOver\|take over\|takes .* over\|session-form-tabs\|idleText\|idle state" AGENTS.md DESIGN.md docs src --exclude-dir='plan-*' --include='*.md' --include='*.ts' --include='*.css' --include='*.js'`
  Every hit is fixed or still true. Expected true hits: `design.md`'s statement that the take-over leaves sessions,
  chat main's unrelated `takeOverSkipped`, and any other idle state that is not the forms/primer one.
- `docs/features/followups.md`, per `wigley:review` `triage.md` § The project's follow-ups:
  - `:413-417` (two tabs' take-overs released out of order) — close the take-over clause.
  - `:556-562` (fixed texts naming `emptyState(deps.idleText)` and a `drawIdle` hook on `createSessionFormTabs`) — trim
    to the layout-slot items that remain.
  - `:612-617` (a new round selects its Form tab, switching away from a Docs tab; a Form tab rebuilt in a hidden body)
    — close the Form-tab clauses.
  - `:703-706` and `:770` (Docs tab `sourceReplaced` / first-show items) — repoint to `docs-session-tab`.
  - Leave "Docs addView session wording" (`:672`) open. Line numbers are from plan time; find each item by its text.
- In wigley-ai-marketplace (its own worktree per `WigleyRepos.md` § Landing): `plugins/wigley/scripts/forms/README.md:363`
  and `plugins/wigley/skills/feature-primer/SKILL.md:17` say "Primer tab" → the primer popup; also grep that README
  for "Form tab" and fix any hit. Bump the marketplace plugin version per its repo rule (patch).

Done when: every doc agrees with the code, the grep shows only expected hits, and the marketplace edit is committed
Commit:    one commit per repo for the doc fixes

## Proof
