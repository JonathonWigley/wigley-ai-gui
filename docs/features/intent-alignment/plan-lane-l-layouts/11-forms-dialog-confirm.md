# 11 — Forms dialog frame and cancel confirm

Status: not started
Type: Task
Wave: 5 · Depends on: 07, 10
Plan: [plan.md](plan.md)

**Gate.** This task waits for Lane E's forms chain (plan.md § Gate). It is written against the forms code as it
stood at plan time. Before the first edit, re-read every file in Files against the tree, and follow Lane E's names:
the renamed `FormsView` union, the kind registrations, and the layout unions opened to strings. The decisions below
hold as written.

Paths below are relative to the repo root. `F` is `src/plugins/forms`.

Files:
- modify `F/layouts/layout.d.ts` · `F/layouts/default/layout.js` · `F/layouts/default/layout.css`
- modify `F/page/layout/read-layout.ts` · `F/page/layout/layout-resolver.ts` · `F/page/forms-view.ts`
- create `F/page/layout/layout-dialog.ts` — the forms dialog parts' draws. They have no round, so they do not
  belong in `layout-panes.ts`; `forms-view.ts` names no layout part draw of its own.
- modify `src/shared/page/ui/dialog.ts` · `src/shared/page/confirm-prompt.ts`
- modify `AGENTS.md` · `docs/features/followups.md` · `docs/features/intent-alignment/master-plan.md`
- test `F/page/forms-view.test.ts` · `src/shared/page/confirm-prompt.test.ts` · every test that calls
  `createDialog` or `createConfirmPrompt` with no `drawFrame` (find them with
  `command grep -rln 'createDialog(\|createConfirmPrompt(' src --include='*.test.ts' --include='*.test-support.ts'`)

Consumes:
- `interface DialogFrameInput`, `interface DialogFramePart`, `interface ConfirmButtonsKit` in
  `src/shared/page/layout-host/kit.d.ts` ← 04
- `type DrawDialogFrame`, `DialogOptions.drawFrame?: DrawDialogFrame` in `src/shared/page/ui/dialog.ts` ← 04
- `ConfirmPromptDeps.drawFrame?: DrawDialogFrame`, and `ConfirmPrompt.redraw()` that also redraws the frame, in
  `src/shared/page/confirm-prompt.ts` ← 04
- the primer `default` layout's `dialogFrame` and `confirmBody` draws (`src/plugins/primer/layouts/default/layout.js`
  and its `layout.css`) ← 07: the forms defaults draw the same markup
- every other `createDialog` and `createConfirmPrompt` caller passing `drawFrame` ← 07
- `requireDialogFrame(frame: unknown, input: DialogFrameInput, partName: string): DialogFramePart` in
  `src/shared/page/layout-host/draw-part.ts` ← 04, and `Dialog.panel`, `body` and `actions` as getters ← 04
- members the tree already holds: `ConfirmBodyParts` (`confirm-prompt.ts`), `drawPart` and `DrawnPart`
  (`src/shared/page/layout-host/draw-part.ts`), `layoutChain` and `pickLayout` (`F/page/layout/layout-resolver.ts`),
  `createFormsBaseKit` and `baseKitDepsFor` (`F/page/layout/card-kit.ts`), `PaneDeps` (`F/page/layout/layout-panes.ts`)

Produces:
- `F/layouts/layout.d.ts`:
  ```ts
  import type { BaseKit, ConfirmButtonsKit, DialogFrameInput, DialogFramePart, KeyHintOptions, TagTone } from '../../../shared/page/layout-host/kit';

  // `body` is the prompt's body text.
  export interface ConfirmBodyInput { body: string }
  // The prompt's own buttons (label, variant, key anchor in `forms.confirm`), each appended to `parent`.
  export interface ConfirmBodyKit extends FormsBaseKit, ConfirmButtonsKit {}
  ```
  `Layout` gains, and `CompleteLayout` gains as required:
  ```ts
  // The cancel prompt's frame. Picked by the `forms.layout` setting, then `default`; never by a round or item.
  dialogFrame?(parent: HTMLElement, input: DialogFrameInput, kit: FormsBaseKit): DialogFramePart;
  // The cancel prompt's body, drawn into the frame's body. Picked as `dialogFrame` is.
  confirmBody?(parent: HTMLElement, input: ConfirmBodyInput, kit: ConfirmBodyKit): HTMLElement;
  ```
- `F/page/layout/layout-dialog.ts`:
  ```ts
  export type FormsDialogDeps = Pick<PaneDeps, 'markdown' | 'platform' | 'log' | 'keys' | 'commands' | 'state'>;
  export function drawFormsDialogFrame(parent: HTMLElement, input: DialogFrameInput, pick: LayoutPick, deps: FormsDialogDeps): DrawnPart<DialogFramePart>;
  export function drawFormsConfirmBody(parent: HTMLElement, parts: ConfirmBodyParts, pick: LayoutPick, deps: FormsDialogDeps): DrawnPart<{ element: HTMLElement }>;
  ```
  Both draw through `drawPart` (`owner: 'forms'`, `partName` `dialogFrame` / `confirmBody`), with kits in the
  `forms.confirm` scope whose anchors and mounts go to drawPart's rollback, so the drawn part's `dispose` disposes
  them. `drawFormsDialogFrame`'s build passes the layout's return through `requireDialogFrame(frame, input,
  'dialogFrame')`, as every task 07 owner does, so a bad frame falls back to `default`. Code that reads the
  dialog's `panel`, `body` or `actions` reads them on each use, since a frame redraw replaces them.
- `F/page/layout/layout-resolver.ts`: `LayoutPart` gains `'dialogFrame' | 'confirmBody'`, and `PART_READS` reads
  `layout.dialogFrame` and `layout.confirmBody`. `RoundPicks` and `PANES` do not change.
- `src/shared/page/ui/dialog.ts`: `DialogOptions.drawFrame: DrawDialogFrame` (required);
  `createDialog(title: string, options: DialogOptions): Dialog` (no `= {}` default).
- `src/shared/page/confirm-prompt.ts`: `ConfirmPromptDeps.drawFrame: DrawDialogFrame` (required).

Decisions:
- Every dialog gets the frame hook; the layout draws the whole frame; the confirm's `drawBody` stays and its frame
  comes through the same `drawFrame` (plan § Decisions, Design review).
- One confirm serves every round, and a dialog follows its opener's setting, so both parts are picked by
  `pickLayout(part, layoutChain(null, null, active.shown.user), active.shown.layouts)`: the `forms.layout` setting,
  then `default`. A round's or item's `layout` never picks them.
- `forms-view.ts` passes `drawBody` and `drawFrame` closures to `createConfirmPrompt`. Each closure keeps its last
  `DrawnPart` and its pick, disposes the last draw before it draws again, and returns the new draw's `built`.
  `createConfirmPrompt` draws once as it is created, so move the `active` layouts above the `createConfirmPrompt`
  call.
- `setLayouts` sets `active.shown`, then calls `confirm.redraw()` only when the `dialogFrame` or `confirmBody` pick
  differs from its last draw's (name or layout object), as the round views compare picks.
- The forms `default` draws:
  - `dialogFrame`: the markup the primer `default`'s `dialogFrame` draws (task 07), so the forms cancel dialog looks
    as it does now. Copy its CSS rules into `F/layouts/default/layout.css` only if task 07 put them in the primer
    default's `layout.css` and not in shared CSS.
  - `confirmBody`: `kit.el(parent, 'p', '', input.body)` and return it. It places neither button, so the prompt
    appends both to the frame's actions row, as the dialog draws today.
- The prompt's texts, commands and scope do not change: title `Cancel this round?`, body `The agent is told the round
  was cancelled. Your answers stay saved.`, keep `Keep answering` (`forms.dismissConfirm`), confirm `Cancel round`
  (`forms.confirmCancel`), scope `forms.confirm`.
- `drawFrame` becomes required once every opener passes one (plan § Decisions, Headless picks). Delete the
  code-built frame from `createDialog`: the `h2.ui-dialog-title`, `div.ui-dialog-body` and `div.ui-dialog-actions`
  it builds, and the branch that builds them. `dialog.css` stays as task 07 left it.
- Doc edits, in `AGENTS.md` § Architecture › **A forms layout**:
  - first sentence after: "**A forms layout** draws the forms view: a card per item kind (`question`, `finding`,
    `notice`), the `head`, `rail`, `review` and `notices` panes, and the cancel prompt's frame and body
    (`dialogFrame`, `confirmBody`), which the `forms.layout` setting picks, never a round."
  - "the rail header's open count and saved state, and the cancel dialog." becomes "the cancel prompt's lifecycle,
    and the rail header's open count and saved state."
  - "it defines every card and the rail, review and notices panes" becomes "it defines every card, the rail, review
    and notices panes, and `dialogFrame` and `confirmBody`".
  - Also the `CompleteLayout` comment in `F/layouts/layout.d.ts` ("defines every card and pane but the head") becomes
    "defines every part but the head".
- Bookkeeping, in this task's commit:
  - `docs/features/followups.md`: delete the bullet `- **Dialog frames and confirms through the opener's layout**`
    through its last line, the line before `- **Forms and primer column chrome through their layouts**`.
  - `docs/features/intent-alignment/master-plan.md` § Lane L: in the line
    `- [ ] Dialog frames and confirms through the opener's layout, then [ ] Forms and primer column chrome through their`,
    change only the first `[ ]` to `[x]`.

GIVEN the default layout WHEN the user asks to cancel a round THEN the dialog's frame and body roots carry `data-layout="default"` and `data-layout-owner="forms"`.
GIVEN the `forms.layout` setting names a user layout defining `confirmBody` WHEN `setLayouts` hands it over THEN the prompt draws again with the user's body.
GIVEN only the active round names that user layout WHEN the prompt draws THEN it draws with `default`.
GIVEN `setLayouts` with picks the same as the last draw's WHEN it runs THEN the prompt does not draw again.

Tests:
- new in `F/page/forms-view.test.ts`, `cancelPrompt_Layout_FollowsTheSettingNotTheRound`: `it.each` with rows
  `the setting names it` → the frame and body roots carry the user layout's name, and `only the round names it`
  → both carry `default`; each row sets the layouts through `view.setLayouts`, then dispatches `askCancel`.
- new in `F/page/forms-view.test.ts`, `cancelPrompt_SetLayoutsSamePicks_DrawsNothingAgain`: a user
  `confirmBody` that counts its draws; a second `setLayouts` with the same layout objects leaves the count unchanged.
- `src/shared/page/confirm-prompt.test.ts`: `promptSetup` passes a fake `drawFrame` (the one task 04's rows in this
  file use) for every case; the `drawBody_ButtonNotInTheDialog_AppendedToActions` rows find the actions row through
  that fake frame's `actions`. Delete each test that asserts the code-built frame's markup.
- every other test the Files grep finds passes a fake `drawFrame`; delete any test that drew the code-built frame
  (task 04 may have added one to `dialog.ts`'s tests).

Done when: `npm run lint` and the typecheck pass; the test gate runs `F/page/forms-view.test.ts`,
`F/page/layout/read-layout.test.ts`, `F/page/layout/layout-resolver.test.ts`, `src/shared/page/confirm-prompt.test.ts`,
each test file the Files grep lists, and `src/shared/layouts/layout-contracts.test.ts`. Live check: task 15.

Commit: one commit for the group, pathspecs `src/plugins/forms` `src/shared/page` and each other test file the
Files grep lists, `AGENTS.md`, `docs/features/followups.md`, `docs/features/intent-alignment/master-plan.md`.

## Proof
