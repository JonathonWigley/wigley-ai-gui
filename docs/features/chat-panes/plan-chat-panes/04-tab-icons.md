# 04 — Tab icons

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/layouts/layout.d.ts` · modify `src/plugins/sessions/layouts/default/layout.js` · modify `src/plugins/sessions/page/session-tabs-view.ts` (`drawTab` only) · modify `src/plugins/sessions/page/sessions.css` · modify `src/shared/page/session-form-tabs.ts` · modify the forms and primer sites that build `session-form-tabs` deps (`src/plugins/forms/page/forms-view.ts`, `src/plugins/primer/page/primer-view.ts`, or wherever each passes `title`) · modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/docs/page/start.ts` · test the fakes and tests that build a `SessionTabView` (`src/plugins/sessions/page/sessions-view-fakes.ts`, `session-form-tabs.test.ts`, `layout/sessions-parts.test.ts`, `layout/read-sessions-layout.test.ts`)

Consumes:  nothing

Produces:  `SessionTabView.icon: string` in `src/plugins/sessions/contract.ts` — a required Codicon name
           `SessionTabInput.icon: string` in `src/plugins/sessions/layouts/layout.d.ts`
           an `icon: string` field beside `title` in the deps of `src/shared/page/session-form-tabs.ts`

Decisions:
- The icons, verbatim: Chat `comment`, Form `checklist`, Docs `book`, Primer `lightbulb`.
- `icon` is required, so the compiler flags every tab site.
- The default layout's `tab` part draws the icon only, through the kit's icon (the one
  `src/shared/page/ui/icon.ts` builds), with no label span. `drawTab` keeps `entry.title =
  view.title` as the tooltip, and sets `aria-label` to the title so the tab keeps its accessible
  name.
- Update the layout contract's comments and the default layout's header comment to say a tab draws
  its icon. Icon colour follows `DESIGN.md` § Icons and copy: `fg-secondary` at rest, `fg` on hover
  or active.

GIVEN a tab added with `icon: 'comment'` WHEN the tab bar draws THEN the tab shows the `comment` Codicon, its tooltip is the tab's title, and no label text draws

Tests: no new test. Drawn look earns a live check (07). Update every fake and fixture that builds a
`SessionTabView` or `SessionTabInput` with an `icon`.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the touched tests.
Commit:    one commit for the group

## Proof

Commit ed4d503 · proof: diff read (SessionTabView.icon, SessionTabInput.icon, form-tabs deps icon present) + typecheck clean in its files; 3 touched test files pass per the worker (22); peer chat-view.ts hunk left unstaged · concerns: contract.ts SessionTabView comment's first line runs past the wrap width
