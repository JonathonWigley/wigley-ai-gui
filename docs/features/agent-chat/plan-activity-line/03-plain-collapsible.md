# 03 — Plain collapsible primitive

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/ui/card.ts` · modify `src/shared/page/ui/card.css` · modify `src/plugins/gallery/page/gallery-view.ts`
Consumes:  none
Produces:  `plain?: boolean` on `CollapsibleCardOptions` in `src/shared/page/ui/card.ts`
Decisions: `createCollapsibleCard` with `plain: true` builds its root as `div.ui-collapsible.ui-collapsible--plain` in place of `card()`: no card background, border or padding. The head, chevron, leading part, summary, `isOpen`/`setOpen` and body-on-open behaviour do not change (DESIGN.md § Primitives, written ahead: "a one-line row with no card chrome that opens its body in place under it")
           `card.css`: `.ui-collapsible--plain` has no background and no border; its head keeps `row-list` height and the hover tint; `.ui-collapsible--plain .ui-collapsible-head` padding is `0 var(--wg-space-2)`; its body padding is `0 var(--wg-space-2) var(--wg-space-2)` with its left edge in line with the summary text. Tokens only
           the chat layout contract's own `CollapsibleCardOptions` in `layout.d.ts` does not gain `plain` (05 exposes the variant as `collapsibleRow`)
           gallery: `collapsibleCells()` gains a second row of cells: a plain one closed (mono, `success` dot, `Bash  npm test`, label `Plain, closed`) and a plain one open (label `Plain, open`), so the gallery shows the variant in its states (DESIGN.md § Primitives: every primitive in every state)
GIVEN a plain collapsible WHEN its head is clicked THEN its body opens under the head, as the card one does — the behaviour is the existing one; the look is a live check in 10
Tests:     none: the variant changes classes only, and the open/close behaviour is the existing tested path
Done when: compiles; `npm run lint` passes
Commit:    one commit for the group

## Proof

Commit cff8715 · proof: diff read matches Produces; lint passes; tsc clean in group files · concerns: body left edge lines up past the chevron, not past a leading status dot; the live look in 10 settles it
