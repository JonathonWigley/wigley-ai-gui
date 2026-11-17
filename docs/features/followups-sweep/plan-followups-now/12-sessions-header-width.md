# 12 — Sessions header holds at the side bar's least width

Status: not started
Type: Task
Rung: standard · a CSS rule scoped like the existing `.session-side > .ui-section-header` rule in `src/plugins/sessions/layouts/default/layout.css`
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-ups (one fix): `followups.md` L855 "Sessions header wraps at the side bar's least width", L909 "The Sessions
title wraps letter by letter at the least width", and the header half of L885 "Agent-lines row overflows at the side
bar's least width" ("the header breaks `Sessions` beside its hints").

Files:     modify `src/plugins/sessions/layouts/default/layout.css`

Preconditions (checked 2026-11-17 on `main` 9b671bd16, from the `wigley-ai-gui/` folder):

| Claim | Command | Expected |
|---|---|---|
| The side bar's header rule only pads | `sed -n 36,38p src/plugins/sessions/layouts/default/layout.css` | `.session-side > .ui-section-header {` / `padding: 0 var(--wg-space-2);` / `}` |
| No rule keeps the title on one line | `grep -c "ui-section-header-text" src/plugins/sessions/layouts/default/layout.css` | `0` |
| The shared header sets no wrap or least width | `grep -c "white-space\|min-width\|flex-wrap" src/shared/page/ui/section-header.css` | `0` |
| The header holds the title, the session edge and the `new` hint | `sed -n 70,74p src/plugins/sessions/layouts/default/layout.js` | `kit.sectionHeader(element, 'Sessions')`, `kit.sessionEdge(header)`, `kit.keyHint(header, 'chat.startNewSession', …)` |

Why it wraps: `.ui-section-header` is a `space-between` flex row. Its trailing session edge (`span.ui-key-edge`,
`white-space: nowrap`) and `new` hint keep their width even while hidden (`is-no-target` and hidden hints keep their
space), so at the side bar's least width (160px, `agent-lines/main/selftest-script.ts` `SIDE_BAR_STEPS_TO_LEAST`) the
title span is the one item that shrinks, and it breaks inside the word.

Consumes:  nothing from another task
Produces:  two rules in `layout.css`, after the `.session-side > .ui-section-header` rule:
- `.session-side > .ui-section-header` gains `flex-wrap: wrap` and `column-gap: var(--wg-space-1)`.
- `.session-side > .ui-section-header > .ui-section-header-text` with `flex: none` and `white-space: nowrap`.

Decisions:
- The title never breaks; when the title and the two prompts do not fit on one line, the prompts wrap to a second line
  of the header. Ellipsizing the title would trip the drive fit check (`overflow: hidden` content is wider than its
  box), and shrinking the prompts would clip key hints.
- Scoped to the sessions default layout, where the follow-ups point. The shared `.ui-section-header` stays as it is,
  so no other header changes how it wraps.
- The comment above the side bar rules (`/* The side bar: the "Sessions" header over the sections. */`) gains one
  sentence saying the title stays on one line and the prompts wrap under it when the bar is too narrow.
- L885's row overflow (`session-row holds 156px in 149px`) is not part of this change: 468bc288f ("Wrap a session
  row's end group whenever its parts overflow the footer", 2026-11-08) and 26b241085 (cards keep three fixed lines)
  landed after the follow-up was written (2026-11-05) and most likely fixed it. The final verification task's
  agent-lines self-test confirms it.

GIVEN the side bar at its least width (160px) WHEN the Sessions header draws THEN `Sessions` reads on one line, and
the session edge and `new` hint sit beside it or on the line under it, with no element cut off.

GIVEN the side bar at its open width WHEN the header draws THEN it looks as today: one line, title left, prompts
right.

Tests:     none: a CSS layout fix with no unit seam; the live look and the fit check go to the final verification task.
Done when: the rules are in the diff; no test runs for this group.
Commit:    one commit: "Sessions layout: the Sessions title stays on one line at the side bar's least width
           (follow-ups: Sessions header wraps at the least width; the title wraps letter by letter)".

## Proof

