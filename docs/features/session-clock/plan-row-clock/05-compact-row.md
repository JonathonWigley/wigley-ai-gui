# 05 — Compact session row

Status: not started
Type: Task
Wave: 3 · Depends on: 04, and the peer plan `session-groups` task 05 (the lead checks this; see plan.md § Preconditions)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/layouts/default/layout.css` · modify `src/plugins/sessions/layouts/default/layout.js` ·
           modify `src/plugins/sessions/page/sessions.css`
Consumes:  the row part ids `usage.rowLine`, `usage.rowCache` ← 04 · `chat.rowClock` ← 03 (an id only; this task
           does not wait on 03's code; each plugin sets its own wrapper's `order`, not this task)
Produces:  the compact row in the sessions `default` layout, and a capture of the side bar before the change
Decisions: two tight lines; cards stay; padding and gaps shrink; the footer band becomes the card's plain second
           line (round 2) · the second line never wraps; the status chip ellipsizes (design doc)

Before you edit:

1. Re-read both layout files at `main`'s tip: the peer plan changed them. Keep every part it added.
2. Capture the side bar at 240px wide through a drive run (`AGENTS.md` § Running and testing), with at least three
   sessions that have a status and usage. Write the capture path in this task's Proof section. Task 07 compares
   against it.

Changes (pinned tokens):

- Card (`.ui-row.session-row`): `padding-block: var(--wg-space-1)`; set `padding-inline: var(--wg-space-1_5)`
  (no session rule sets it today; `.ui-row` gives `space-2`).
- Gap between row cards: `space-1`. This is `.session-sidebar`'s gap today, and the box that holds a group's rows
  after the peer plan (`.session-group-rows` or its equivalent). Leave the gaps between groups and between sections
  as the peer plan set them.
- Footer (`.session-row-foot`): remove the `block-background`, the `border-subtle` top border and the negative
  margins. Set `margin-top: var(--wg-space-0_5)`, padding 0, `column-gap: var(--wg-space-1_5)`,
  `flex-wrap: nowrap`. Keep its `display: none` rule while it holds nothing.
- The status chip keeps `flex: 0 1 auto; min-width: 0` and its ellipsis, so it shrinks first.
- `sessions.css` `.session-row-parts`: `flex-wrap: nowrap`, `column-gap: var(--wg-space-1_5)`. It keeps
  `flex: 1 1 auto`, so a part with `margin-left: auto` reaches the line's end. Update its comment: the parts stay
  on one line.
- Update the layout's top comment in `layout.js` and the CSS comments to describe the new row.
- Use only tokens in `src/config/theme-tokens.ts`. Add no new token.

GIVEN a row with a status, usage, a run time and a cache mark WHEN the side bar draws at 240px THEN the second line
reads status, meter, tokens, then the run time and the mark at the line's end, on one line

Tests:     none: copy and styling earn no test (`wigley:writing-tests` § What earns neither). Task 07 checks it on
           screen.
Done when: `npm run lint` passes (it includes the style check); the before capture's path is in Proof
Commit:    one commit for the group

## Proof

