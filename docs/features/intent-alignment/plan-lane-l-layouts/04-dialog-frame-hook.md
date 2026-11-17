# 04 — Dialog frame hook and shared kit types

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/layout-host/kit.d.ts` · modify `src/shared/page/ui/dialog.ts` ·
           modify `src/shared/page/confirm-prompt.ts` · modify `src/shared/page/layout-host/draw-part.ts` ·
           create test `src/shared/page/ui/dialog.test.ts` · test `src/shared/page/confirm-prompt.test.ts` ·
           test `src/shared/page/layout-host/draw-part.test.ts` ·
           create test `src/shared/page/layout-host/dialog-frame.test-d.ts`
Consumes:  `requireElementIn`, `drawPart` in `src/shared/page/layout-host/draw-part.ts` (in the tree) ·
           `installFocusFakeDom`, `FakeElement`, `findAll` in `src/shared/page/test-dom.ts` (in the tree)
Produces:  in `src/shared/page/layout-host/kit.d.ts` (the layout-facing types):
           `export interface DialogFrameInput { title: string; hasActions: boolean }`
           `export interface DialogFramePart { element: HTMLElement; body: HTMLElement; actions: HTMLElement | null }`
           `export interface ConfirmButtonsKit { keepButton(parent: HTMLElement): HTMLButtonElement; confirmButton(parent: HTMLElement): HTMLButtonElement }`
           `export interface PromptActionInput { command: string; label: string }`
           in `src/shared/page/ui/dialog.ts` (the app-side copies, see Decisions):
           `export interface DialogFrameInput { title: string; hasActions: boolean }`
           `export interface DialogFramePart { element: HTMLElement; body: HTMLElement; actions: HTMLElement | null }`
           `export type DrawDialogFrame = (parent: HTMLElement, input: DialogFrameInput) => DialogFramePart`
           `DialogOptions.drawFrame?: DrawDialogFrame`
           `Dialog.redrawFrame(): void`
           in `src/shared/page/confirm-prompt.ts`: `ConfirmPromptDeps.drawFrame?: DrawDialogFrame`; `ConfirmPrompt.redraw()` also redraws the frame
           in `src/shared/page/layout-host/draw-part.ts`:
           `export function requireDialogFrame(frame: unknown, input: DialogFrameInput, partName: string): DialogFramePart`

## Decisions

- **The layout draws the whole frame; the app keeps the rest** (plan round 1). The app keeps the scrim
  (`div.ui-scrim`, `hidden` until `show`), `role="dialog"`, `aria-modal="true"`, `aria-label` (the title),
  `show`, `hide`, `isShown`, the caller's keys and scopes, and `restoreFocusAfterDialog`. The layout draws the panel,
  the title and the actions row, and returns the panel as `element`, with `body` and `actions` inside it.
- **Two copies of the frame types, checked equal.** `npm run lint`'s layer check (`scripts/check-layers.mts`) lets
  `src/shared/page` and `src/shared/page/ui` import neither `src/shared/page/layout-host` nor its `kit.d.ts`; it
  counts a type-only import like any other. So `kit.d.ts` holds the types a layout author reads, and `dialog.ts`
  declares `DialogFrameInput` and `DialogFramePart` again, with the same names and members. This is the pattern the
  tree already has: `ConfirmBodyParts` in `confirm-prompt.ts` and each owner's `ConfirmBodyKit` are separate,
  structurally equal types. The type test `dialog-frame.test-d.ts` (in `layout-host`, which may import both) fails
  when the copies drift. Do not change the layer rules.
- **A bad frame falls back through the owner's part, not in the dialog.** The sessions `popup` part is the model:
  its build calls `requireElementIn(popup.element, popup.body, 'popup body')`, and the throw makes `drawPart` roll
  the attempt back and draw the part with `default` (a throw from `default` is rethrown). Each owner's
  `dialogFrame` build (task 07) calls `requireDialogFrame` on the builder's return in the same way. `createDialog`
  does not check the frame again and has no fallback of its own: `drawFrame` is the owner's part draw, which already
  checked it.
- **`requireDialogFrame` rules.** `drawPart` checks `element` itself (an element appended to the parent), so this
  function checks `body` and `actions` only. In this order, it throws:
  - `<partName> returned no frame` when `frame` is not an object;
  - `<partName> body is not inside its element` when `body` is not an `HTMLElement`, is `element` itself, or
    `element.contains(body)` is false;
  - `<partName> drew actions for a dialog with none` when `input.hasActions` is false and `actions !== null`
    (`undefined` fails too);
  - `<partName> actions is not inside its element` when `input.hasActions` is true and `actions` is not an
    `HTMLElement`, is `element` itself, or `element.contains(actions)` is false;
  - `<partName> body and actions overlap` when one contains the other.
  It returns `{ element, body, actions }`, read from `frame`. When `frame.element` is not an `HTMLElement`, it
  returns the frame unchecked past the first rule, so `drawPart`'s own `<partName> returned no element` names the
  fault.
- **`createDialog(title, options)` with `drawFrame`:** it makes the scrim, then calls
  `drawFrame(scrim, { title, hasActions: options.hasActions ?? true })`. On the returned `element` it sets `role`,
  `aria-modal` and `aria-label`. It adds no class: the look is the layout's. It sets the title field, role and
  `aria-label` itself and does not call `setTitle`, so `drawFrame` runs once at creation. With no `actions` (`hasActions`
  false), `Dialog.actions` is one detached `div.ui-dialog-actions` the dialog makes once and keeps, as today.
  Without `drawFrame` it builds today's code frame, unchanged (task 11 deletes it).
- **`Dialog.panel`, `body` and `actions` are getters** that read the current frame. Update the interface comment:
  "read each on use: `redrawFrame` replaces them". `element` (the scrim) never changes.
- **`Dialog.redrawFrame()`.** Without `drawFrame` it does nothing. With `drawFrame`, in this order:
  1. Note `document.activeElement` when it is an `HTMLElement` inside the scrim.
  2. Call `drawFrame(scrim, { title, hasActions })` with the current title.
  3. Append every child node of the old `body` to the new `body`, then every child node of the old `actions` (when
     the frame has actions) to the new `actions`, after anything the layout drew there. Set the new `body.hidden`
     and `actions.hidden` to the old ones' values (notes hides its actions row while the markup view shows).
  4. Remove the old `element` (it may already be detached: `LayoutParts.redraw` removes the earlier draw first).
  5. Set `role`, `aria-modal` and `aria-label` on the new `element`.
  6. When the noted element is still inside the scrim and is not `document.activeElement`, call
     `focus({ preventScroll: true })` on it. Moving a node blurs it; an input keeps its value and selection range.
  The scrim's `hidden` does not change, so a shown dialog stays shown. The new panel gets no `is-opening` fade.
  **When `drawFrame` throws** (the owner's `default` frame rethrows; `LayoutParts.redraw` has already disposed the
  earlier draw and removed its panel): `redrawFrame` assigns the new frame fields only after `drawFrame` returns,
  and never catches. `panel`, `body` and `actions` keep pointing at the detached old frame, the scrim is empty, the
  error propagates and aborts the owner's `setLayouts`, and a later `redrawFrame` retries. A default frame never
  throws in practice, and the dialog holds no fallback.
- **`Dialog.setTitle(next)`** with `drawFrame`: return when `next` equals the current title; otherwise keep `next`
  as the title and run `redrawFrame()`, so the frame draws the new title. Docs' box dialog and chat's dialogs call
  `setTitle` on each open, usually with an unchanged title, so an open does not rebuild the frame. Without
  `drawFrame`: as today.
- **`createConfirmPrompt`** passes `deps.drawFrame` to `createDialog(deps.title, { drawFrame: deps.drawFrame })`.
  `redraw()` runs `dialog.redrawFrame()`, then the body and buttons draw it runs today. That draw already reads
  `dialog.body` and `dialog.actions` on each call, so it fills the new frame. `ConfirmBodyParts` keeps its members;
  its comment names `ConfirmButtonsKit` as the layout-facing copy of its two buttons.
- **`kit.d.ts` comments**, beside each new type:
  - `DialogFrameInput`: "What a dialog's frame draws: its title, and whether it has an actions row."
  - `DialogFramePart`: "A dialog's frame: `element` is the panel the part appended to its parent; `body` and
    `actions` are inside it, the app fills them, and `actions` is null exactly when `hasActions` is false. The app
    keeps the scrim, showing and hiding, keys and focus. A frame that breaks these rules draws with `default`."
  - `ConfirmButtonsKit`: "A confirm prompt's own two buttons (label, variant, key anchor in the prompt's scope), each
    appended to `parent`. A button the part leaves out goes at the end of the frame's actions row."
  - `PromptActionInput`: "One action a cursor row's prompt shows: `command`, a qualified id, and its `label`. Draw it
    with `kit.keyHint(parent, command, { label })`."
- **`dialog.css` does not change.** It keeps `.ui-scrim` and `.ui-floating.ui-dialog` (the scrim and the panel
  primitive), and also `.ui-dialog-title`, `.ui-dialog-actions` and `.ui-dialog-actions > .ui-button`: these are
  the primitive's classes that each `default` frame draws with (task 07), as kit rows draw with `row.css`, and
  forms' code frame uses them until task 11. Restyling a primitive app-wide from a layout is out of scope
  (`docs/features/layouts/design.md` § Out of scope). The one rule that moves in task 07 is keys'
  `.ui-dialog.keys-help-dialog` width, from `src/plugins/keys/page/keys.css` to keys' default `layout.css`, since the
  frame that carries that class becomes the layout's.

## Behaviour

GIVEN `createDialog('Rename', { hasActions: false, drawFrame })` WHEN it returns THEN `drawFrame` was called once with
`(scrim, { title: 'Rename', hasActions: false })`, the frame's `element` is the scrim's child and carries
`role="dialog"`, `aria-modal="true"` and `aria-label="Rename"`, `dialog.panel` is that element, `dialog.actions` is not
inside the scrim, and the scrim is hidden until `show`.

GIVEN a shown dialog with a `drawFrame`, a focused input in its body and a button in its actions WHEN `redrawFrame`
runs THEN `drawFrame` drew a second frame, the input and the button are inside the new frame's body and actions, the
old frame is out of the scrim, the input has focus, `dialog.body` and `dialog.panel` are the new ones, and the scrim is
still shown.

GIVEN a dialog whose actions row is hidden WHEN `redrawFrame` runs THEN the new actions row is hidden.

GIVEN a dialog with a `drawFrame` WHEN `setTitle('Deny Bash?')` runs THEN the next frame's input title is
`Deny Bash?` and the new element's `aria-label` is `Deny Bash?`; and WHEN `setTitle` runs again with `Deny Bash?`
THEN `drawFrame` is not called again.

GIVEN a dialog whose `drawFrame` throws on its next call WHEN `redrawFrame` runs THEN the error propagates,
`dialog.panel`, `dialog.body` and `dialog.actions` are still the old frame's elements, and a later `redrawFrame`
with a working `drawFrame` draws the new frame.

GIVEN a confirm prompt with a `drawFrame` WHEN `redraw` runs THEN a second frame is drawn and both buttons are in the
new frame's actions row.

GIVEN a frame whose `body` is outside its `element` WHEN `requireDialogFrame` checks it THEN it throws
`dialogFrame body is not inside its element`.

## Tests

- `src/shared/page/ui/dialog.test.ts` (new), with `installFocusFakeDom` and a fake `drawFrame` that appends a panel
  holding a body and, when `hasActions`, an actions row, and records each input:
  - `createDialog_DrawFrame_TheAppKeepsTheScrimAndMarksThePanel` — the first GIVEN above; then `show()` leaves the
    scrim not hidden and `hide()` hides it again.
  - `redrawFrame_ShownDialog_MovesTheContentAndKeepsFocus` — the second GIVEN; asserts the scrim holds one child.
  - `redrawFrame_HiddenActions_StayHidden` — the third GIVEN.
  - `setTitle_DrawFrame_RedrawsWithTheTitle` — the fourth GIVEN, both halves (a changed title redraws; the same
    title does not).
  - `redrawFrame_DrawFrameThrows_KeepsTheOldFrameAndRetries` — the fifth GIVEN.
- `src/shared/page/confirm-prompt.test.ts`: `redraw_DrawFrame_DrawsTheFrameAndButtonsAgain` (new; `promptSetup`
  gains an optional `drawFrame` it hands on) — `drawFrame` called twice; `findAll(scrim, 'ui-dialog-actions')` of the
  new frame holds `Keepn` and `Cancel formy`; the scrim holds one panel.
- `src/shared/page/layout-host/draw-part.test.ts`: `requireDialogFrame_Rejects: $row` (new table beside
  `requireElementIn_Rejects`), one row per rule above, each asserting its exact message with `partName`
  `dialogFrame`: `dialogFrame returned no frame` (frame not an object); `dialogFrame body is not inside its element`
  (body outside, body not an `HTMLElement`, body is the element); `dialogFrame drew actions for a dialog with none`
  (actions given with `hasActions: false`, and `actions: undefined` with `hasActions: false`);
  `dialogFrame actions is not inside its element` (actions missing with `hasActions: true`, actions an
  `HTMLElement` outside the element, actions is the element); `dialogFrame body and actions overlap` (actions inside
  body, body inside actions). One more test, `requireDialogFrame_NonElementElement_ReturnsTheFrameUnchecked`: a
  frame whose `element` is not an `HTMLElement` returns without throwing. And `requireDialogFrame_ValidFrame_ReturnsIt` — a panel holding a body and
  an actions row returns those three elements; a panel holding only a body with `hasActions: false` returns
  `actions: null`.
- `src/shared/page/layout-host/dialog-frame.test-d.ts` (new): `expectTypeOf` that `kit.d.ts`'s `DialogFrameInput`
  and `DialogFramePart` equal `dialog.ts`'s, and that `ConfirmButtonsKit` equals
  `Pick<ConfirmBodyParts, 'keepButton' | 'confirmButton'>`.
- `src/shared/layouts/layout-contracts.test.ts`'s `every owner contract type-checks beside kit.d.ts` already compiles
  `kit.d.ts` with no lib check skipped, so the new kit types need no row there.

Live check: task 15.

## Done when

`npm run lint` and the typecheck pass; the test gate runs the tests above. No caller passes `drawFrame` yet, so every
dialog still draws today's code frame.

## Commit

One commit for the group: `git commit -- src/shared/page/layout-host/kit.d.ts src/shared/page/ui/dialog.ts
src/shared/page/ui/dialog.test.ts src/shared/page/confirm-prompt.ts src/shared/page/confirm-prompt.test.ts
src/shared/page/layout-host/draw-part.ts src/shared/page/layout-host/draw-part.test.ts
src/shared/page/layout-host/dialog-frame.test-d.ts`.

## Proof

