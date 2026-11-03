# 03 — The composer's working slot

Status: done
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/layouts/layout.d.ts` (`ComposerKit` only) ·
           modify `src/plugins/chat/layouts/default/layout.js` (`composer` only) ·
           modify `src/plugins/chat/page/composer-kit.ts` · modify `src/plugins/chat/page/chat.css` ·
           test `src/plugins/chat/page/composer-kit.test.ts` · test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `appSlot(element, name, rollback)` in `src/shared/page/layout-host/app-slot.ts` (exists) · the done
           markup `div.chat-working.is-done > div.chat-working-done` ← 02
Produces:  `working(parent: HTMLElement): HTMLElement` in `ComposerKit` in `src/plugins/chat/layouts/layout.d.ts`
           a `div.chat-working-slot` element built once per surface in `createComposerSurface` in
           `src/plugins/chat/page/composer-kit.ts`, hidden until task 06 draws into it
Decisions: dock slot in the composer, same `appSlot` path, `working placed twice`, left-out rule, hidden while
           empty (decision 1) · DESIGN.md § Chat order: composer parts, activity dock, attachments, box, status line
           (docs written ahead) · class names kept (decision 7) · the dock keeps its height in a short pane (D11) ·
           only `ComposerKit.working`'s and the composer's comments land here (D12)

## What changes

- `ComposerKit.working` doc comment: "The slot the `working` part draws into: the activity dock. The app hides it
  while there is nothing to show. A composer that leaves it out gets it just above the box." The `ComposerKit`
  head comment ("Each slot and the box mounts once per draw …") covers its second-call throw; add "the working slot
  just above the box" to its left-out sentence. These are the only `layout.d.ts` comments this task writes; the
  `working` part's comment and the `WorkingInput` comments change in task 06 (plan.md D12).
- `createComposerSurface` builds `workingSlot = element('div', 'chat-working-slot')`, `hidden = true`, beside
  `attachmentsSlot`. Each `drawComposer` attempt makes `appSlot(workingSlot, 'working', rollback)` and the kit's
  `working` member places it. After the builder returns and after `box.placeIfLeftOut(root)`, a slot no call
  placed goes in as the box's previous sibling (`pieces.box`'s parent, before `pieces.box`), recorded on the
  attempt's rollback as `appSlot` records its own placement. The implementer picks between extending the
  attempt's placement locally and a small helper in `composer-kit.ts`; `app-slot.ts` stays as it is.
- The default `composer` calls `kit.working(panel)` between `kit.contributedParts(panel)` and
  `kit.attachments(panel)`; its comment lists the working slot. The file's head and `working` comments stay for
  task 06.
- `chat.css`: styles for `.chat-working-slot` in the composer (spacing within the floating panel per DESIGN.md
  § Space, size and shape and the composer's other rows). The slot takes `flex-shrink: 0`, as `.chat-attachments`
  does: in a short pane the dock keeps its height, and the composer's existing overflow rule applies unchanged (the
  composer parts holder gives up height first and scrolls; the box shrinks past three `space-8` steps) (plan.md
  D11). Styles for the done line: `.chat-working.is-done` /
  `.chat-working-done` in `fg-tertiary`, `text-ui`, tabular numerals, one line ending in an ellipsis inside its
  box. The block's comment names the activity dock in place of "the working block". Existing `.chat-working*`
  rules stay; adjust them only where the composer's surface needs it, reading DESIGN.md first.
  `npm run lint` runs `scripts/check-styles.mts`; follow what it enforces.

GIVEN the default layout WHEN the composer draws THEN its panel's children are, in order, `contributedParts`,
`working`, `attachments`, `box`, `statusLine`
GIVEN a user composer that never calls `kit.working` WHEN it draws THEN the working slot sits right before the box
GIVEN a user composer that calls `kit.working` twice WHEN it draws THEN the draw falls back to `default` and logs
`working placed twice`
GIVEN a surface that has not drawn the dock WHEN the composer draws THEN the working slot is `hidden`

Tests:     `composer_Default_PlacesEachSlotOnce` in `layout.test.ts`: the expected list gains `working` between
           `contributedParts` and `attachments`; `fakeSurfaceKit` gains a `working` part ·
           the left-out table at `composer-kit.test.ts` (the `it.each` whose first row is
           `a composer that never calls kit.box`): add the field `expectsWorkingBeforeBox: boolean` to every row
           (`false` on the existing rows), asserted as
           `root.children[root.children.indexOf(box) - 1]?.className === 'chat-working-slot'` when `true`; add a
           row for a composer that never calls `kit.working` with the field `true` · add rows (or a test, when that
           table's shape cannot carry them) for `kit.working` called twice → drawn with `default`, log line contains
           `working placed twice` · `composer_ContributedParts_BuiltInAddOrderAboveTheBox`: assert the working slot
           (found by `.chat-working-slot`) sits after the parts holder and before the box in the default composer,
           and that it is `hidden` (the last GIVEN: no dock drawn yet)
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 8eebaabd · proof: diff read: ComposerKit.working and the hidden slot present; tree typecheck green at worker's end · concerns: left-out placement uses parentNode?.insertBefore since the test DOM has no before()
