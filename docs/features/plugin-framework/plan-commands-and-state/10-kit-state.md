# 10 — Layouts read slots

Status: done
Type: Task
Wave: 9 · Depends on: 09
Plan: [plan.md](plan.md)

Files:

- modify `src/shared/page/layout-host/kit.d.ts`
- modify `src/shared/page/layout-host/base-kit.ts` · test `src/shared/page/layout-host/base-kit.test.ts`
- create `src/shared/page/layout-host/fake-layout-state.test-support.ts`
- modify `src/renderer/renderer.ts`
- modify `src/plugins/forms/page/layout/card-kit.ts`, `src/plugins/forms/page/layout/layout-cards.ts` · test `src/plugins/forms/page/layout/layout-cards.test.ts`, `src/plugins/forms/page/layout/layout-panes.ts`, `src/plugins/forms/page/kinds/item-format.ts`, `src/plugins/forms/page/forms-view.ts`, `src/plugins/forms/page/round-view.ts`, and each forms test `tsc` names for a missing `recordAnchor` or `state`
- modify each page file that builds kit services (the list is in Decisions)
- modify `AGENTS.md` line "owner's kit extends" in § Architecture, to name `state` among the shared kit members

Consumes:

- `LayoutState`, `LayoutSlotReader` in `src/contracts/state.ts` ← 05
- `PageApi.state.forLayouts: LayoutState` ← 05
- `layoutState(store, pluginId, track)` in `src/shared/state/slot-store.ts` ← 05
- The page `SlotStore` from `createPageState` in `src/renderer/renderer.ts` ← 05
- `RollbackDeps.recordAnchor` and `createRecorder` in `src/shared/page/layout-host/draw-part.ts`, `ownerBaseKitDeps` and `createBaseKit` in `src/shared/page/layout-host/base-kit.ts` (tree)

Produces:

`src/shared/page/layout-host/kit.d.ts`:

```ts
export interface KitSlotReader {
  // A comment here states task 05's `readById` table for a layout author.
  get(key?: string): unknown;
  on(listener: (...args: unknown[]) => void): void;
}
// On BaseKit:
state: { read(id: string): KitSlotReader };
```

`src/shared/page/layout-host/base-kit.ts`:

- `BaseKitDeps.state: LayoutState`, required
- `BaseKitDeps.recordAnchor(anchor: Disposable): void`, required
- `OwnerKitServices.state: LayoutState`, required

`src/shared/page/layout-host/fake-layout-state.test-support.ts`: `export const noLayoutState: LayoutState`, whose `get` reads `undefined` and whose `on` returns a handle that does nothing. Test fakes use it, so that no fake restates the shape.

Decisions:

**The kit's read.**

- `kit.state.read(id)` calls `deps.state.read(id)`.
- `get` passes through.
- `on` calls the reader's `on` and hands the returned handle to `deps.recordAnchor`. It returns nothing, so a layout holds no handle and cannot leak one.
- The recorder takes any `Disposable`, as the markdown mount shows. No new recorder member lands.

**Why `recordAnchor` becomes required.** `createRecorder` disposes what it holds when an attempt fails and when the part is disposed. An optional recorder would leave a slot subscription live past its draw, with no compile error.

What must change for `recordAnchor` and `state`, and what need not (measured at plan time, re-verify):

| Site | Today | Change |
|---|---|---|
| `base-kit.ts`, `BaseKitDeps` | `recordAnchor?` | required; rewrite the comment that begins "`recordAnchor`, the drawing attempt's", and drop its "left out, recording them is the `keys`' job" |
| `base-kit.ts`, `keyHint` | `deps.recordAnchor?.(anchor)` | `deps.recordAnchor(anchor)` |
| `forms/page/layout/card-kit.ts`, `baseKitDepsFor` | sets no `recordAnchor`; its `Pick` lacks it | adds `'recordAnchor'` and `'state'` to the `Pick`; passes both |
| `forms/page/kinds/item-format.ts`, `CardDeps` | `recordMount` only | gains `recordAnchor(anchor: Disposable): void` and `state: LayoutState` |
| `forms/page/layout/layout-panes.ts`, `PaneDeps` | `recordMount` only | gains `recordAnchor(anchor: Disposable): void` and `state: LayoutState` |
| `forms/page/layout/layout-cards.ts`, the private `MountingDeps` | `recordMount` only | gains `recordAnchor(anchor: Disposable): void` only: `recordingDeps` spreads the rest of `deps`, `state` included |
| `forms/page/layout/layout-cards.ts`, `recordingDeps` | `recordMount` calls `deps.recordMount`, then `rollback.recordAnchor` | adds `recordAnchor`, which calls `deps.recordAnchor`, then `rollback.recordAnchor` |
| `forms/page/start.ts`, the `mountFormsView` call | no `state` | adds `state: api.state.forLayouts` |
| `forms/page/forms-view.ts`, `FormsViewDeps` and the deps object it passes to `createRoundView` | no `state` | `FormsViewDeps` gains `state: LayoutState`; the object adds `state: deps.state` |
| `forms/page/round-view.ts`, `RoundViewDeps` | no `state` | gains `state: LayoutState` |
| `forms/page/round-view.ts`, the head's `baseKitDepsFor` call | no `recordAnchor`; `...deps` carries `state` | adds `recordAnchor: (anchor) => headAnchors.push(anchor)` |
| `forms/page/round-view.ts`, `paneDeps` and `cardDeps` | no `recordAnchor`, no `state` | each adds `recordAnchor: (anchor) => anchors.push(anchor)` and `state: deps.state` |
| `base-kit.test.ts`, the shared deps fake and the `createBaseKit({…})` literal in `draws markdown through one recorded mount` | none | adds a recorder |
| Forms tests that set `recordMount` (3 lines, measured at plan time, re-verify) | none | each adds a recorder and `state: noLayoutState` |
| `forms-view.test.ts` and `round-view.test.ts`, the deps literals | no `state` | each adds `state: noLayoutState` |
| `base-kit.ts`, `ownerBaseKitDeps` | passes `recordAnchor`; builds its fields one by one | adds `state: services.state` |
| `renderer/shell/shell-chrome.ts` | passes `recordAnchor`; `...services` carries `state` | none |
| `chat/page/chat-kit.ts` | passes `anchors.push` | none |
| `chat/page/row-clock.ts`, `row-clock.test.ts` | pass `() => undefined` | none: that kit reads only `duration` and makes no subscription |

**Forms records a key anchor twice.** Forms' recording `keys` records each anchor, and `keyHint` now also calls `recordAnchor`. So one anchor sits in the list twice. This is harmless: the dispose in `src/plugins/keys/page/anchors.ts` returns at once when `live.delete` finds nothing. Keep forms' recording `keys`, because `scopedAnchor` and the round view's direct `keys.anchor` calls depend on it. Do not de-duplicate. `recordingDeps` also files a slot handle twice. This is harmless too: `Registrations.track` makes a second dispose do nothing.

**Where the state comes from.** Each services object gains `state: api.state.forLayouts`. The shell chrome has no plugin, so `renderer.ts` sets `state: layoutState(store, 'shell', (handle) => handle)` in `mountShellChrome`'s `services`. The recorder is its only disposer, and the shell draws for the page load. Forms takes `state` at `mountFormsView` and carries it down to `CardDeps` and `PaneDeps`, by the rows in the table above. No forms file holds it in a closure.

Sites that set `platform: api.platform` for kit services (measured at plan time, re-verify; `tsc` names any other through the required member):

- `src/plugins/settings/page/start.ts`
- `src/plugins/primer/page/start.ts`
- `src/plugins/agent-strip/page/start.ts`
- `src/plugins/forms/page/start.ts`
- `src/plugins/chat/page/start.ts` (two sites)
- `src/plugins/backlog/page/start.ts`
- `src/plugins/unity-pool/page/start.ts`
- `src/plugins/agent-skills/page/start.ts`
- `src/plugins/gallery/page/start.ts`
- `src/plugins/usage/page/start.ts`
- `src/plugins/docs/page/start.ts`
- `src/plugins/sessions/page/start.ts`
- `src/plugins/notes/page/start.ts`
- `src/plugins/visual/page/start.ts`
- `src/plugins/workflow/page/start.ts`
- `src/plugins/agent-lines/page/start.ts`
- `src/plugins/keys/page/start.ts` (its `kit:` object)

Views that rebuild `OwnerKitServices` from their own deps pass `state` on:

- `src/plugins/settings/page/settings-view.ts` (`SettingsViewDeps` gains `state`)
- `src/plugins/backlog/page/backlog-view.ts` (the same)

Forms' route is in the table above.

Test fakes use `noLayoutState`, including `src/plugins/docs/page/docs-page-fakes.ts`.

**What a layout may read.**

- `read` takes any id, because the plan's signature is a string and a layout has no manifest.
- An id with no slot reads `undefined`, with no throw. The layout starts listening anyway and hears a later first write.
- What `get` returns and what `on` passes are in the `readById` table in task 05 § The store.

**Redraw stays with the layout.** The kit does not redraw on a change. A part "redraws into its wrapper itself", as `draw-part.ts` leaves it, so the listener's body is the layout's. A listener that throws logs `<id> listener failed: <error>` under the owning plugin (task 05).

**A subscription outside a draw.** `api.state.forLayouts` also files each `on` in the part's registrations. So a kit built with a no-op recorder still stops at the part's stop.

**No user layout changes.** The app writes `kit.d.ts` to each owner's `layouts/` folder. A layout that does not use `state` keeps working. Plan.md's Preconditions name the check for user layouts.

GIVEN a layout that calls `kit.state.read('p.v').on(listener)` in a draw WHEN the attempt fails and rolls back THEN `listener` hears no later change.

GIVEN a part drawn with a subscription WHEN the part is disposed THEN `listener` hears no later change.

GIVEN an id with no slot WHEN a layout calls `get()` THEN it reads `undefined` and nothing throws.

Tests (each names the break it catches):

- `src/shared/page/layout-host/base-kit.test.ts`:
  - `stateRead_On_RecordsTheSubscription` — a recording `recordAnchor` holds one handle, and disposing it stops the listener. Catches a subscription that outlives the draw.
  - `stateRead_Get_ReadsThroughDeps` — rows for no key and a key. Catches a kit that drops the key argument.
- `src/plugins/forms/page/layout/card-kit.test.ts`: `baseKitDepsFor_RecordsSubscriptionThroughDeps` — catches forms' `recordAnchor` left unwired, which the types alone do not prove reaches the rollback.
- `src/plugins/forms/page/layout/layout-cards.test.ts`: `recordingDeps_RecordAnchor_RecordsInDepsAndRollback` — catches a wrapper that files a subscription in one list, which leaves the listener live after a round rebuild or a failed attempt.

The recorder in `draw-part.ts` holds any `Disposable`, and `draw-part.test.ts` already passes it one that is no anchor. No row goes there.

`kit.d.ts` is plain text the app writes out. `npm run typecheck` proves its `BaseKit` matches `createBaseKit`.

Runtime checks: [Final verification](16-final-verification.md).

Done when: `npm run typecheck` passes; `grep -n 'recordAnchor?' src/shared/page/layout-host/base-kit.ts` prints nothing; `npm run lint` passes; the test gate runs the tests above.

Commit: one commit for the group.

## Proof

Commit 265ca654 · proof: Diff stat and kit diffs read; kit.state.read present; typecheck and lint clean; the recordAnchor? grep prints nothing. · concerns: The shell's layoutState wiring reaches no test (task 16); no single test runs a layout that subscribes, throws and then hears nothing; a layout calling on inside its own listener adds a subscription each time; AGENTS.md does not list the new fake (task 15).
