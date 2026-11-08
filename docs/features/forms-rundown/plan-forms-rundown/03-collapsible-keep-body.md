# 03 — Collapsible keep-body option

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/ui/card.ts` · create `src/shared/page/ui/card.test.ts`
Consumes:  `installFakeDom`, `FakeElement`, `asHtml`, `asFake`, `findAll` in `src/shared/page/test-dom.ts` (the tree holds them)
Produces:  in `src/shared/page/ui/card.ts`:
           `export interface CollapsibleCardOptions { summary: string; mono?: boolean; plain?: boolean; leading?: HTMLElement | null; open?: boolean; keepBody?: boolean; onToggle?(): void; body(): HTMLElement }`
           `export function createCollapsibleCard(options: CollapsibleCardOptions): CollapsibleCard` (signature unchanged)

## Decisions

- `CollapsibleCardOptions` gains the two options plan.md § Shared names pins. Each gets a one-line comment:
  - `keepBody?: boolean` — build the body once, at creation, and hide it while closed.
  - `onToggle?(): void` — a head click calls it in place of toggling, so the caller owns the open state and calls
    `setOpen`.
- `keepBody: true`:
  - At creation, call `options.body()` once. Wrap it in `div.ui-collapsible-body`, append it to the root after the
    head, and set its `hidden` to `!open`.
  - `setOpen(next)` sets `hidden = !next` on that wrapper. It never calls `body()` again and never removes the
    wrapper. The class `is-open` and the chevron change as today.
  - With `open: true` as well, the body shows at creation, and `body()` still runs once.
- `onToggle` given: the head's click calls `options.onToggle()` and does not call `setOpen`. `setOpen` itself works
  the same with or without `onToggle`.
- Both options absent: the behaviour stays as it is. Each opening builds the body afresh from `body()`; closing drops
  it. Chat (`src/plugins/chat/page/chat-kit.ts`, `collapsibleCard`, `collapsibleRow`, `expander`) and the gallery
  (`src/plugins/gallery/page/gallery-view.ts`) pass neither option and do not change.
- Chat's public layout contract (`src/plugins/chat/layouts/layout.d.ts`) keeps its own `CollapsibleCardOptions`
  without `plain`, `keepBody` or `onToggle`. The new options are for the app's own callers (task 05). Do not edit the
  chat contract.
- Update the function comment over `createCollapsibleCard`: by default each opening builds the body afresh from
  `body()` and closing drops it; with `keepBody` the body is built once and hidden while closed; with `onToggle` the
  head click goes to the caller.
- `card.ts` knows nothing of forms (plan.md § Boundary rules). The comments name no forms concept.
- No test owns the collapsible rule today: `src/shared/page/ui/` has no `card.test.ts`. Chat's
  `collapsibleRow_RegistersWithExpanders` (`src/plugins/chat/page/chat-kit.test.ts`) proves the chat wiring only. A
  new `card.test.ts` owns the rule. It runs under `installFakeDom`, with `beforeEach` and `afterEach` as
  `chat-kit.test.ts` sets them up. A head click is `findAll(asFake(card.element), 'ui-collapsible-head')[0].click()`.

## Behaviour

GIVEN `keepBody: true` WHEN the card opens, closes and opens THEN `body()` ran once, and the same
`div.ui-collapsible-body` stays in the card, hidden while closed.
GIVEN no `keepBody` WHEN the card opens, closes and opens THEN `body()` ran twice, and the closed card holds no
`div.ui-collapsible-body`.
GIVEN `onToggle` WHEN the head is clicked THEN `onToggle` ran once and the card stays closed.

## Tests

In `src/shared/page/ui/card.test.ts` (new), `describe('createCollapsibleCard')`:

- `body lifetime: $case` — `it.each` over the body option. Each row creates the card closed with a `body` spy that
  returns a new `FakeElement('div')`, then calls `setOpen(true)`, `setOpen(false)`, `setOpen(true)`, and checks after
  the `setOpen(false)` and at the end:
  - row `rebuilt on each open` (no `keepBody`): `body` called 2 times; while closed, zero `ui-collapsible-body`.
    Break: the default path starts to keep the body, which changes chat's refill-on-open.
  - row `kept with keepBody` (`keepBody: true`): `body` called 1 time, at creation (before the first `setOpen`); while
    closed, one `ui-collapsible-body` with `hidden === true`; at the end the same element with `hidden === false`.
    Break: `keepBody` rebuilds on open, or removes the body on close, or leaves it visible while closed.
  - row `kept, created open` (`keepBody: true, open: true`; this row skips the first `setOpen(true)`): `body`
    called 1 time; at creation one `ui-collapsible-body` with `hidden === false`; after `setOpen(false)` the same
    element with `hidden === true`. Break: the constructor's `setOpen(true)` rebuilds or double-builds the kept body.
- `head click: $case` — `it.each` over `onToggle`. Each row clicks the head once:
  - row `toggles itself` (no `onToggle`): `isOpen()` is `true` after the click. Break: the default head click stops
    toggling.
  - row `defers to onToggle` (an `onToggle` spy): the spy called 1 time, and `isOpen()` stays `false`; then
    `setOpen(true)` makes `isOpen()` `true`. Break: the head toggles as well as calling `onToggle`, so the caller's
    open state and the card disagree.

Chat's tests do not change. `collapsibleRow_RegistersWithExpanders` and the chat layout tests prove the default path
still works through chat. The look of a kept body while it opens and closes belongs to "10 — Final verification".

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and
`src/plugins/chat/page/chat-kit.test.ts`.
Commit:    one commit for the group

## Proof

Commit 31cacc80 · proof: diff read: keepBody and onToggle in CollapsibleCardOptions as Produces pins, default path unchanged; worker typecheck, lint (own files), card and chat-kit tests pass · concerns: worker ran oxfmt on its two files to pass the format check
