# Per-session usage line — plan

Feature: usage · Implements: none · Ticket: none
Target: main · Written: 2026-11-01

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Each session shows its own context bar, cache countdown and spend in its own tab bar, so that split panes each show
their own session. The status bar keeps only the plan rows (5-hour, weekly, Fable), which every pane shares. After
this one rebuild, a layout file controls where the line sits and how it looks.

## Architecture

- **sessions** (page) gains bar parts beside row parts: `addBarPart(part: SessionPart)`. `SessionRowPart` becomes
  `SessionPart`, one shape for both. `TabBarKit` gains `contributedParts`, which places the bar parts the same way
  `RowKit.contributedParts` places the row parts.
- **usage** (page) registers one bar part. For each session, the part draws a new usage layout part, `sessionLine`.
  `StatusLineInput` loses `session`.
- **agents** (page) changes only the type name it imports.
- The usage plugin already depends on `sessions`, so no manifest changes.

## Preconditions

`wigley:make` runs each command again before the first dispatch.

- `grep -n "export interface SessionRowPart" src/plugins/sessions/contract.ts` prints one line.
- `grep -n "addRowPart" src/plugins/sessions/contract.ts` prints lines, and `grep -n "addBarPart" src/plugins/sessions/contract.ts` prints nothing.
- `grep -n "session: SessionLineInput | null" src/plugins/usage/layouts/layout.d.ts` prints one line.
- `grep -n "dependsOn" src/plugins/usage/manifest.ts` prints `['chat', 'sessions', 'keys']`.
- `git status --porcelain src/plugins/sessions/layouts/default/layout.js` prints nothing. At plan time it printed
  ` M`: a peer's uncommitted edit removes the harness name from the row detail. Task 01 edits this file and commits it.
  If the peer edit is still there, stop and ask the user. Do not commit or revert the peer's lines.
- The agent-chat `plan-pending-messages` and `plan-clear-command` runs (another session, started 2026-11-01) have
  landed: `test -d docs/features/agent-chat/plan-pending-messages || test -d docs/features/agent-chat/plan-clear-command`
  fails (`wigley:make` deletes a plan folder at Close). Those runs edit `src/plugins/sessions/contract.ts` and
  `src/plugins/sessions/page/start.ts`, which task 01 edits too. If either folder is still there, stop and ask the user.
- `grep -rn "SessionRowPart" docs/features/workflow/plan-workflow/` prints the lines that task 04 updates. At plan time
  it printed one line, in `plan.md`.

## Docs written ahead

Commit `2813b99`:

- `AGENTS.md`: the sessions and usage folder lines, and the **session part** / row part / bar part entry.
- `DESIGN.md` § Usage.
- `docs/features/usage/design.md`: Intent, Flow, The usage plugin › Page, Decisions, Rejected.
- `docs/features/layouts/design.md`: the `sessions` and `usage` rows of the owners table.

## Mandatory Reads

- `AGENTS.md` (repo root), whole. Look most at § Architecture: the layout, session tab and session part entries.
  Then § Running and testing.
- `DESIGN.md` § Usage and the tab and status bar entries.
- `docs/features/usage/design.md` § The usage plugin and § Decisions.
- `docs/features/layouts/design.md`.
- There is no `.claude/rules/` folder and there are no nested `AGENTS*.md` files under `src/` (checked at plan time).

## Design Overview

```
 usage main ──channel: snapshot──▶ usage page
                                    │
                                    ├─ status bar ── statusLine part: plan rows only
                                    │
                                    ├─ sessions.addBarPart(sessionLines.part)
                                    │     sessions draws each session's tab bar:
                                    │       ‹ tabs › [bar parts: usage sessionLine] ⌘W  split  split  close
                                    │     the part draws `sessionLine` for its session id,
                                    │     or nothing while that session has no usage
                                    │
                                    └─ right bar ── details part (unchanged; follows the focused session)
```

Decisions (from the interview, 2026-11-01):

- The per-session line uses an extension point that sessions owns, as row parts do. Chat does not depend on usage:
  usage already depends on chat, so that would be a cycle. There is no global data store.
- The tab bar of the session's frame holds the line. The frame moves with its session between panes and shows on
  every tab. A pane redraws only on focus and edge changes, and its input has no session.
- The built-in layout puts the bar parts after the next-tab prompt and before the close prompt and pane controls.
- `SessionRowPart` becomes `SessionPart`. This plan runs before the workflow plan, so task 04 updates that plan's references.
- The line shows the context meter, the cache countdown and the spend (today's `SessionLineInput`).
- A session with no usage event yet draws nothing in its slot.
- The line redraws on each snapshot, each layouts set and the one-minute tick. This is the subagent-lines pattern.
- The status bar plan rows still follow the focused session's profile. The details panel stays as it is.

Out of scope: forms' `addCardPart` has the same shape but stays its own type (another owner and another key).
Chat's `addComposerPart` belongs to the workflow plan.

## File Structure

Modified:

- `src/plugins/sessions/contract.ts` — `SessionPart`, `addBarPart`.
- `src/plugins/sessions/page/row-parts.ts` → renamed `session-part-store.ts` (`SessionPartStore`, `createSessionPartStore`), and
  its test `row-parts.test.ts` → `session-part-store.test.ts`.
- `src/plugins/sessions/page/start.ts`, `sessions-view.ts`, `sessions-view-fakes.ts`, `session-tabs-view.ts`,
  `layout/sessions-parts.ts`, `layout/sessions-parts.test.ts`, `sessions.css`.
- `src/plugins/sessions/layouts/layout.d.ts`, `src/plugins/sessions/layouts/default/layout.js`.
- `src/plugins/agents/page/subagent-lines.ts` — the type name only.
- `src/plugins/usage/layouts/layout.d.ts`, `src/plugins/usage/layouts/default/layout.js`, `src/plugins/usage/page/usage.css`.
- `src/plugins/usage/page/usage-view-model.ts` and its test, `src/plugins/usage/page/layout/usage-parts.ts`.
- `src/plugins/usage/page/start.ts`, `src/plugins/usage/main/selftest-script.ts`.
- `docs/features/workflow/plan-workflow/*.md` (a peer's plan, untracked at plan time).

New:

- `src/plugins/usage/page/session-lines.ts` and `session-lines.test.ts`: the usage bar part. It keeps the wrapper that
  sessions hands it for each session and redraws each line in place. It is a module of its own, as
  `agents/page/subagent-lines.ts` is, so that its tests drive it without the page.

Boundary rules: sessions imports nothing from usage. Usage imports only `sessions/contract.ts` (already allowed by
`dependsOn`). `npm run lint` (`scripts/check-layers.mts`) enforces this.

Shared names:

- `export interface SessionPart { id: string; build(parent: HTMLElement, sessionId: string): { dispose?(): void } }` in `src/plugins/sessions/contract.ts`
- `addBarPart(part: SessionPart): Disposable` on `SessionsPageExports`
- `sessionLine?(parent: HTMLElement, input: SessionLineInput, kit: UsageKit): HTMLElement` on usage's `Layout`
- `export function sessionLineInput(snapshot: UsageSnapshot, sessionId: string, now: number): SessionLineInput | null` and `export function sessionLineText(input: SessionLineInput): string` in `usage-view-model.ts`
- `sessionLine(parent: HTMLElement, input: SessionLineInput): Drawn` on `UsageParts`

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Sessions bar parts](01-sessions-bar-parts.md)
- [x] [Usage session line part](02-usage-session-line-part.md)

### Wave 2
- [ ] [Usage draws each session's line](03-usage-session-lines.md) — after 01, 02
- [ ] [Workflow plan references](04-workflow-plan-references.md) — after 01

### Wave 3
- [ ] [Doc re-read](05-doc-re-read.md) — after 03, 04
- [ ] [Final verification](06-final-verification.md) — after 05

## Run log

Review base: d66a196a007248071a0c7ad363f22effdd460db7

### Groups
- 01 · f034f08 · diff read; Produces present (SessionPart, addBarPart, SessionPartStore/createSessionPartStore, TabBarKit.contributedParts, tabBar(parent, sessionId)); typecheck + lint pass; worker ran sessions+agents tests 255 pass · concerns: AddAndDispose same-element check is vacuous on the row surface; bar part build gets a session id and redrawBars runs only on add/dispose, so usage redraws in place
- 02 · 9eb4d06 · diff read; Produces present (sessionLine on Layout, StatusLineInput without session, sessionLineInput, sessionLineText, UsageParts.sessionLine); typecheck + lint pass after 01; usage-view-model.test.ts 54 pass (worker) · concerns: usage selftest expects the old status line text until task 03 updates selftest-script.ts
### Contract changes
- statusLineInput (outside the Produces list): statusLineInput(snapshot, shownSessionId, now) → statusLineInput(snapshot, shownSessionId) · why: now went unused once session left the input · consumers: 03 · group 02
### Rulings
- Bar-row tests drive through view.panes.load rather than tabs.place directly — place with a fresh slot draws outside view.element — none, same place path · group 01 · group 01
- Extra CSS beyond the spec: .session-bar-parts display flex, align-items center, gap space-2; .session-bar-part flex none — look decision for the drive run · group 01 · group 01
- Fallback with no slot appends bar parts before the strip containment check, matching the row — nothing visible · group 01 · group 01
- statusLineInput drops now and start.ts drawStatusLine follows — now went unused — task 03 re-adds if needed · group 02 · group 02
- .usage-divider removed (nothing draws it); session line children use usage-text, the usage-session class pair dropped — one CSS tweak if wrong · group 02 · group 02
### Review rounds
### Test gate
