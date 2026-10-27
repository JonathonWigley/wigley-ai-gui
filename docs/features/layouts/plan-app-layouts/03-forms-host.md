# 03 — Forms onto the host

Status: in progress
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Forms keeps every behaviour it has and draws through the page host from task 02. Its copies of the generic layout
code go: the rollback, the element check, the fallback to `default`, the command runner, the generic half of the head
kit, the pick walk and the reader skeleton. Forms keeps what only forms has: its item > round > setting > default
chain, its card kits, its review rows, its head slot and its layout validator's part table.

Files:

- modify `src/plugins/forms/page/layout/layout-cards.ts` · test `layout-cards.test.ts`
- modify `src/plugins/forms/page/layout/layout-panes.ts` · test `layout-panes.test.ts`
- modify `src/plugins/forms/page/layout/layout-resolver.ts` · test `layout-resolver.test.ts`
- modify `src/plugins/forms/page/layout/card-kit.ts` · test `card-kit.test.ts`
- modify `src/plugins/forms/page/layout/read-layout.ts` · test `read-layout.test.ts`
- delete `src/plugins/forms/page/layout/kit-commands.ts`
- modify `src/plugins/forms/page/round-view.ts` (head kit, pick and `KitCommands` imports)
- modify `src/plugins/forms/page/forms-view.ts` (the `KitCommands` import)
- modify `src/plugins/forms/page/kinds/item-format.ts` and `src/plugins/forms/page/kinds/card-parts.ts` only where
  the compiler flags a moved name
- modify `src/plugins/forms/layouts/layout.d.ts`
- modify `src/plugins/forms/layouts/default/layout.js` (the `TagTone` JSDoc import, if it moves)

Consumes ← 02 (`src/shared/page/layout-host/`, exact signatures in `02-layout-core.md` § Produces):

- `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>): { built: R; layoutName: string; dispose(): void }`,
  with `build(builder: B, parent: HTMLElement, rollback: RollbackDeps): R`, and `RollbackDeps { recordBox(destroy: () => void): void; recordAnchor(anchor: Disposable): void }` (`draw-part.ts`)
- `requireElementIn(parent: HTMLElement, element: unknown, partName: string): HTMLElement` (`draw-part.ts`)
- `PartPick<L>`, `pickLayout<L>(chain, layouts, defines): PartPick<L>` (`pick.ts`)
- `createBaseKit(deps: BaseKitDeps): BaseKit`, `BaseKitDeps` (`keys.keysFor` returns `string | null`; `scope` may be
  `null`), `KitCommands { exists(id): boolean; run(id): void }`, `commandRunner(qualifiedId, commands): () => void`
  (`base-kit.ts`)
- `readLayoutModule(module, name)`, `isRecord(value)` (`read-layout-module.ts`)
- `BaseKit`, `TagTone`, `ButtonVariant`, `KitButtonOptions`, `KeyHintOptions` (`kit.d.ts`)

Produces (forms-internal; no other task consumes them):

- `LayoutPick` in `layout-resolver.ts` becomes `export type LayoutPick = PartPick<Layout>;`
- `pickLayout(part: LayoutPart, chain, loaded)` in `layout-resolver.ts` keeps its signature and calls the host's
  `pickLayout(chain, loaded, (layout) => typeof PART_READS[part](layout) === 'function')`
- `layoutChain`, `itemLayout`, `roundLayoutNames`, `pickRoundLayouts`, `picksEqual` keep their signatures
- `buildLayoutCard`, `buildRailPane`, `buildReviewPane` keep their signatures
- `headKitDepsFor(deps, scope): BaseKitDeps` in `card-kit.ts` (was `HeadKitDeps`); `HeadKitDeps` and
  `createHeadKit` go, and every caller uses `createBaseKit(headKitDepsFor(deps, scope))`

## Decisions

- **Cards.** `buildLayoutCard` calls `drawPart` with `owner: 'forms'`, `parent`, `pick`, `defaultLayout`,
  `part: (layout) => layout.cards?.[item.kind]`, `partName: '<kind> card'`, `logSource: 'forms'`. Its `build` makes
  the card kit over deps whose `mountBox` calls `rollback.recordBox(() => deps.destroyBox(target))` after mounting,
  and whose `keys.anchor` calls `rollback.recordAnchor` on each anchor it returns. It then builds the card, mounts the
  unmounted boxes and places the unplaced parts, and returns `{ element: card.element, card, kit }`: `BuiltCard` gains
  `element`, since `drawPart`'s `R` extends `{ element: HTMLElement }`. `hostCard` takes `built` and `layoutName` from
  the call's `{ built, layoutName }` and stays as it is otherwise. `drawPart` sets `data-layout` and
  `data-layout-owner="forms"` on the card's root. A layout's `layout.css` selects under `[data-layout-owner="forms"][data-layout="<name>"]`. The log line
  stays `layout <name> <kind> card failed: <error>`. `drawRollingBack`, `RollbackDeps` (forms') and forms'
  `requireElementIn` go; the element check is `drawPart`'s.
- **Panes.** `hostPane` goes. `buildRailPane` and `buildReviewPane` call `drawPart` with `owner: 'forms'`,
  `part: (layout) => layout.rail` (or `review`) and `partName: 'rail'` (or `'review'`), recording boxes and anchors
  as the cards do. The log line stays `layout <name> rail failed: <error>`. `DEFAULT_NAME` in `layout-panes.ts`
  goes.
- **A default that throws** now rolls back and throws out of `buildLayoutCard` with no log line. Before, forms
  logged `layout default <kind> card failed` and built `default` a second time, which threw again. The caller sees
  the same throw.
- **Head.** The head keeps forms' own slot and try/catch in `round-view.ts`: `default` defines no head, so a head
  that throws leaves the slot empty and logs `layout <name> head failed: <error>`, as today. Its kit is
  `createBaseKit(headKitDepsFor(deps, formsScope('forms')))`.
- **Kit.** `headKitDepsFor` returns `BaseKitDeps` with `keys` = the keys plugin's `anchor` and `keysFor`,
  `scope` = the scope it is given, `commandNamed: formsCommandNamed`, and `commands` as today. The card kit, rail
  kit and review kit spread `createBaseKit(...)` where they spread `createHeadKit(...)`. Forms' own
  `keysOfNamed`, `keyHint`, `section` and `command` copies go. `card-parts.ts`' `buildSection` stays for forms' own
  card parts that call it.
- **Commands.** `kit-commands.ts` goes; `card-kit.ts` and `forms-view.ts` take `KitCommands` and `commandRunner`
  from the host. The `commands` deps in `page/start.ts` keep their shape (`exists`, `run`).
- **Reader.** `readLayout` takes its record from `readLayoutModule(module, name)`; its part tables and messages stay.
  Forms' `isRecord` goes; `requireCards` uses the host's.
- **Contract.** `layouts/layout.d.ts` writes
  `import type { BaseKit, ButtonVariant, KitButtonOptions, TagTone } from '../../../shared/page/layout-host/kit';`
  (the specifier 02 pins; the registry rewrites it to `'../kit'` in the user's copy). It drops its own `TagTone`,
  `ButtonVariant`, `KitButtonOptions` and `HeadKit`, and re-exports `TagTone` so the default layout's JSDoc
  `import('../layout').TagTone` keeps working. `Kit`, `RailKit` and `ReviewKit` extend `BaseKit`; `head` takes
  `kit: BaseKit`. `keyHint` is now `keyHint(parent, command, options?: KeyHintOptions)`. `ReviewKit` extends
  `Omit<BaseKit, 'row'>`: its own `row(parent, row: number)` keeps its shape, so the default review pane does not
  change, and `BaseKit.row(parent, options: KitRowOptions)` would not type-check beside it. `BaseKit` also brings
  `statusDot`, `setDotStatus`, `row` (to `Kit` and `RailKit`), `emptyState` and `keyPrompt`; forms' contract declares
  none of them today, so nothing else drops.
- No change to what a forms layout draws, to its log lines (except the default case above), or to the tool contract.

GIVEN a round whose item names layout `fancy`, whose finding card mounts its notes box and then throws
WHEN the round view builds the card
THEN the notes box is destroyed, `[forms] layout fancy finding card failed: <error>` is logged, and the `default`
finding card draws with `data-layout="default"` and mounts the notes box once.

## Tests

The generic cases now live in the host's tests (task 02). This task deletes forms' copies and keeps the cases that
prove forms' own wiring.

- delete from `layout-cards.test.ts`: the `drawRollingBack` describe (its three cases are `draw-part.test.ts` rows).
- `layout-cards.test.ts`: add `buildLayoutCard_CardThrowsAfterMountingABox_DestroysItAndDrawsDefault` — one case
  proving the card wires its box and anchor recording into `drawPart`. Break: `mountBox` not recorded, so the
  default card's mount of the same box throws `mounted twice`.
- `layout-panes.test.ts`: keep `hostPane_ReviewThrows_DestroysTheBoxesItMounted` (renamed
  `reviewPane_Throws_DestroysTheBoxesItMounted`, the review's box recording) and
  `hostPane_PickedPaneDraws_MarksItWithItsLayout` (renamed `railPane_PickedDraws_MarksItWithItsLayout`); delete the
  other `hostPane_*` fallback rows, which `draw-part.test.ts` holds.
- `layout-resolver.test.ts`: keep `layoutChain_*`, `itemLayout_*`, `roundLayoutNames_*`, `pickRoundLayouts_*`,
  `picksEqual_*`; keep one `pickLayout` case, `pickLayout_PartialLayout_FallsToNextInChain`, proving forms' part
  reads; delete the rest of `pickLayout_*` (rows of `pick.test.ts`).
- `card-kit.test.ts`: delete `kitCommand_KnownId_RunsOnlyWhenCalled`, `kitCommand_UnknownId_Throws`,
  `kitKeyHint_UnknownName_AnchorsNothing` (host rows). Keep `kitKeysFor_ReadsTheCardScope` and
  `kitKeyHint_NamedCommand_AnchorsInTheCardScope`, which prove the card kit hands the host the forms scope and
  `formsCommandNamed`.
- `read-layout.test.ts`: keep its tables; the "default export missing" rows stay, since they prove forms calls the
  host reader.

Done when: `npm test` and `npm run lint` pass. `grep -rn "drawRollingBack\|createHeadKit\|HeadKit\b\|kit-commands"
src/plugins/forms` prints nothing. `grep -n "export type TagTone\|export interface HeadKit"
src/plugins/forms/layouts/layout.d.ts` prints nothing. The live checks go to task 17 (Final verification).

Commit: one commit for the group.

## Proof
