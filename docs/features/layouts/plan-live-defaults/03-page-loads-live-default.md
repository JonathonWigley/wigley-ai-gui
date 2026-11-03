# 03 — The page loads a live default, links the default stylesheet, and falls back to the bundled default

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/entry-list.ts` · test `src/plugins/chat/page/entry-list.test.ts` · test `src/plugins/primer/page/primer-view.test.ts` · modify `src/contracts/plugin.ts` (`ShowLayoutOptions` only) · modify `src/shared/page/layout-host/layout-loader.ts` · modify `src/shared/page/layout-host/show-layouts.ts` · modify `src/shared/page/layout-host/draw-part.ts` · modify `src/plugins/primer/page/primer-view.ts` (line 1171 only) · modify the 16 `show` call sites listed below · test `src/shared/page/layout-host/layout-loader.test.ts` · test `src/shared/page/layout-host/show-layouts.test.ts` · test `src/shared/page/layout-host/draw-part.test.ts`
Consumes:  the registry entry shape `{ name, revision, hasCss, builtIn }` (`LayoutEntry`, `src/contracts/layouts.ts`, in the tree) — a `default` with `builtIn: false` is a live default (plan.md § File Structure; task 01 makes main send it)
Produces:  `defaultStylesheet: string | null` on `ShowLayoutOptions<L>` in `src/contracts/plugin.ts`
           `defaultStylesheet: string | null` on `LayoutLoaderDeps<L>` in `src/shared/page/layout-host/layout-loader.ts`
           `drewPick: boolean` on `DrawnPart<R>` in `src/shared/page/layout-host/draw-part.ts`

Decisions:
- The page sees a live default as an ordinary entry (`builtIn: false`). The loader's import, revision and last-good
  paths carry it. The bundled default stays the final fallback in `draw-part.ts` (plan.md § Decisions, design
  review). `pick.ts` and `layout-parts.ts` do not change: `pickLayout` already returns whatever `layouts` holds
  under `default`, and `createLayoutParts` already passes the bundled object to `drawPart`.
- **Always load the default.** `load` treats `default` as asked on every load, whatever `names` holds. A `default`
  entry with `builtIn: false` is imported from `layoutUrl('default', revision, 'layout.js')` and read with
  `deps.read(module, 'default')`, the owner's reader. A built-in `default` entry is never imported, as today
  (`layout-loader.ts` line 95).
- **A live default must define every part.** After the read, the loader checks the read layout against
  `deps.defaultLayout`. Every key whose bundled value is a function must hold a function in the live default. Check
  one level of nesting too: for a key whose bundled value is a plain object (chat's `entries`), check that object's
  function keys, named with the prefix (`entries.<key>`). The first missing part fails the load with
  `layout default has no <part>`. Non-function, non-object values are not checked.
- **Last good, then bundled.** A failed import, read or part check of a live default keeps its last good live
  version, through the existing `failedRevisions` and `good` maps. With no good live version, `layouts` holds
  `deps.defaultLayout` under `default`, as today (line 112). A `default` entry that turns built in shows
  `deps.defaultLayout`.
- **Toast.** Each failure reaches `result.failed`. `show-layouts.ts` already logs and toasts each failed entry
  (`Layout default failed: <error>`, lines 118–121). Add no new toast.
- **Default stylesheet link.** The loader keeps one `<link rel="stylesheet" data-layout="default"
  data-layout-owner="<owner>">` in `head`:
  - while a live default version is in the load's layouts and its entry has `hasCss` → href
    `layoutUrl('default', revision, 'layout.css')`
  - while a live default version is in the load's layouts and its entry has no `hasCss` → no default link, so a
    deleted live `layout.css` takes its rules away (plan.md § Decisions)
  - while no live default version is in the load's layouts → href `deps.defaultStylesheet`; no default link when
    it is null
  - the link moves only after the live script has loaded and read, as a user layout's link does (lines 68–72)
- **Link at creation.** `createLayoutLoader` adds the bundled default link at once when `defaultStylesheet` is not
  null, so the default look holds before the first set arrives. Keep one element for the default link and change
  only its href, so its place in `head` stays before the user layouts' links. `dispose` removes it with the others;
  a load after `dispose` adds it again.
- **show-layouts.ts** (lines 77–84): pass `options.defaultStylesheet` into `createLayoutLoader`. Nothing else
  changes there.
- **Bundled fallback by identity.** `drawPart` (line 77) attempts the picked layout when the pick defines the part
  and `pick.layout !== options.defaultLayout`. Today it tests `pick.name !== 'default'`. So a live default under the
  name `default` is attempted, rolled back and logged once on a throw, and the bundled default draws in its place.
  A live default that lacks the part draws the bundled default with no log, as a user layout that lacks a part does.
- **Draw-time throws log and do not toast**, as a user layout's draw-time throw does today. The toast covers every
  load, read and part-check failure.
- **`drewPick`.** `DrawnPart` gains `drewPick: boolean`: true when the picked layout drew, false when the bundled
  default drew in its place. Both a live default and the bundled default draw as `layoutName: 'default'`, so
  `layoutName` no longer tells them apart. `primer-view.ts` line 1171 reads `drawn.drewPick` in place of
  `drawn.layoutName === pick.name`. `chat/page/entry-list.ts` line 897 (`isDefaultView`) stays: both copies are
  the default view.
- **`ShowLayoutOptions<L>.defaultStylesheet`** is required: the compiler then names any owner that leaves it out.
  Its comment says: the bundled URL of the owner's `layouts/default/layout.css`, or null for an owner with no
  default CSS. Pass `defaultStylesheet: null` at every call site in this task. Task 05 replaces each null with the
  `?url` import.
- The 16 call sites (each a `show` call; measured at plan time, re-verify with
  `grep -rn "layouts.show" src --include='*.ts' | grep -v test`):
  `src/renderer/renderer.ts:250`, and `src/plugins/<id>/page/start.ts` for settings `:74`, primer `:173`,
  agent-strip `:66`, forms `:188`, chat `:205`, backlog `:92`, gallery `:53`, usage `:238`, docs `:265`,
  sessions `:620`, notes `:88`, visual `:62`, workflow `:234`, keys `:123`, agent-lines `:70`.
  `src/renderer/plugins/page-api.ts:122` passes the options through and does not change.

GIVEN a set whose `default` is `builtIn: false` at revision 3 WHEN the page loads with no names THEN the loader
imports `default` at revision 3, reads it with the owner's reader under the name `default`, and `layouts` holds it
under `default`
GIVEN a live default that lacks a part the bundled default defines WHEN it loads THEN the load fails with
`layout default has no <part>`, the toast shows, and `layouts` holds the last good live default, else the bundled one
GIVEN a live default with `layout.css` WHEN it loads THEN the default link's href is its live `layout.css` URL; WHEN
a later revision fails THEN the link keeps the last good href
GIVEN no live default WHEN the loader is created THEN `head` holds the default link at `defaultStylesheet`
GIVEN a live default whose part throws WHEN the part draws THEN it rolls back, `layout default <part> failed: <error>`
is logged once, the bundled default draws, and `drewPick` is false

Tests:
- `layout-loader.test.ts` — `loaderWith` gains a `defaultStylesheet` argument (default null, so the existing tests
  keep their meaning). Add a `liveDefault(revision, hasCss)` entry builder.
  - `load_LiveDefault_ImportedAndReadAsDefault` — new: with no names, the loader imports
    `url:default/layout.js@3`, `read` receives the module and `default`, and `layouts.get('default')` is the read
    layout.
  - `load_LiveDefaultLacksAPart_FailsNamingIt` — new `it.each`. Build a bundled default with function parts `card`
    and `entries: { row }`. Rows: live lacks `card` → error matches `layout default has no card`; live lacks
    `entries.row` → matches `layout default has no entries.row`. Each row: `failed` holds the `default` entry and
    `layouts.get('default')` is the bundled object.
  - `load_LiveDefaultFails_KeepsLastGoodElseBundled` — new `it.each`. Rows: first revision fails → bundled object;
    revision 3 good, revision 4 fails → the revision 3 layout.
  - `load_DefaultStylesheetLink_FollowsTheShownDefault` — new `it.each` asserting `shownLinks` for the `default`
    link. Rows: built in with `defaultStylesheet` `bundled.css` → `bundled.css`; built in with null → no link;
    live with CSS at 3 → `url:default/layout.css@3`; live without CSS → no default link; live that never loaded
    good, with `bundled.css` → `bundled.css`; live good at 3 with CSS, then 4 fails → `url:default/layout.css@3`.
  - `create_DefaultStylesheet_LinkedBeforeAnyLoad` — new: after `createLayoutLoader` with `bundled.css` and no
    load, `head` holds one default link at `bundled.css`; after a load that shows a live default with CSS, the same
    element holds the live href (`appended` has length 1).
  - `load_AlwaysHoldsDefault_NoLinkForBuiltIn` stays: it pins that a built-in `default` is never imported.
- `show-layouts.test.ts` — `showing()` passes `defaultStylesheet`.
  - `show_DefaultStylesheet_HandedToTheLoader` — new, one case for the wiring: a show with `defaultStylesheet`
    `bundled.css` leaves a link with that href and `data-layout` `default` in `head`.
  - `showLayouts_LoadFails_LogsAndToasts` — add a row (or a second case): a live `default` entry whose import throws
    logs `layout default failed` and toasts `error: Layout default failed: <error>`.
- `draw-part.test.ts`
  - `drawPart_DrewPick_TrueOnlyWhenThePickedLayoutDrew` — new `it.each`. Rows: user layout draws → `drewPick` true,
    `layoutName` the user's; user lacks the part → false, `default`; user throws → false, logged; the bundled
    object picked as `default` → true, no log; a live default (another object) picked as `default` draws → true,
    its own element text; live default throws → false, the bundled element drawn, log line
    `[forms] layout default rail failed: <error>`; live default lacks the part → false, no log.

Done when: `npm run typecheck` passes with every call site holding `defaultStylesheet: null`; the test gate runs the
tests above.
Commit:    one commit for the group.

## Decisions from the cold plan read

These close gaps a cold reader found. Each binds as the Decisions above do.

- **Chat entries fall back on an update throw.** In `src/plugins/chat/page/entry-list.ts`, `redrawSlot` takes the
  "draw with the bundled default" branch (sets `drawsWithDefault`, so the slot draws with `DEFAULT_ENTRY_PICK`)
  whenever the slot's drawn pick is not the bundled object. Test this with the pick's identity (`drewPick` or the
  layout object), not `isDefaultView`, because a live default is also named `default`. Only a throw from the bundled
  object itself takes today's "log and redraw" branch. After a user layout throws, the slot draws the bundled
  default, as `DEFAULT_ENTRY_PICK` gives today. Test: add a row to the test that owns `redrawSlot`. GIVEN a live
  default whose entry `update` throws WHEN the entry updates THEN the slot draws with the bundled default and the
  live default is not called again for that slot.
- **The default link keeps its place in `head`.** The loader creates the default link element once, at creation,
  and keeps it. "No default link" means the element is detached. Re-attaching it inserts it before the first link
  the loader owns for a user layout (`head.insertBefore`), else appends it. `dispose` detaches it, and a later load
  re-attaches it by the same rule. The fake `head` in `layout-loader.test.ts` gains `insertBefore` and records
  child order. Test: add a row (live with CSS → live without CSS → live with CSS again, with a user layout's link
  present) that asserts the default link sits before the user's link in `head` order.
- **The part check order and the missing nested object.** Walk the bundled default's keys in `Object.keys` order,
  and a nested plain object's keys in its own order. The first key the live default lacks is the one the error
  names. A live default with no value, or a non-object value, where the bundled default holds a plain object lacks
  that object's first function key: the error is `layout default has no <object>.<firstKey>` (for chat,
  `layout default has no entries.<first key of the bundled entries>`). Test: add an `it.each` row "live lacks the
  whole nested object" to the part-check test.
- **Draw-time throws log only.** A part that throws while drawing logs and draws the bundled part, with no toast,
  as a user layout's part does today. A load, read or missing-part failure raises the existing toast. The design
  doc's Fallback bullet says the same.
- **Lifecycle rows.** Add rows to `load_DefaultStylesheetLink_FollowsTheShownDefault` and the live-default load
  test: a `default` that was live and turns built in → `layouts.get('default')` is the bundled object and the link
  href returns to `defaultStylesheet`, even though the last good live version is still cached. Add one
  `dispose_DefaultLink_DetachedThenReattached` test for `dispose` and a later load.
- **Primer's `drewPick` consumer.** Add one row to primer's existing layout-fallback test. GIVEN a live default
  (named `default`, not the bundled object) whose part throws at draw WHEN primer reaches its later update path
  THEN it uses the bundled `defaultLayout`.

## Proof

