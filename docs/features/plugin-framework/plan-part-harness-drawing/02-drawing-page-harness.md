# 02 — A page harness entry that draws layout parts

Status: not started
Type: Task
Wave: 2 · Depends on: 01 (shares `plugin-part-harness.test-support.ts` and its test)
Plan: [plan.md](plan.md)

Files:     modify `src/shared/plugin-part-harness.test-support.ts` · create `src/shared/page/layout-host/page-part-harness.test-support.ts` · test `src/shared/plugin-part-harness.test.ts` · test `src/shared/page/layout-host/page-part-harness.test.ts` (create)
Consumes:  `ownerLayoutShow(deps: OwnerShowDeps<L>): PageLayoutShow<L>` and `ownerKitServicesOf(api: OwnerKitApi): OwnerKitServices` in `src/shared/page/layout-host/owner-show.ts` (tree)
Produces:  `export type HarnessLayoutShow` and `PagePartHarnessOptions<M>['layoutShow']` in `src/shared/plugin-part-harness.test-support.ts` (exact shape in plan.md § File Structure)
           `export function startDrawingPagePart<M extends PluginManifest>(part: PagePart<M>, options?: Omit<PagePartHarnessOptions<M>, 'layoutShow'>): PagePartHarness<M>` in `src/shared/page/layout-host/page-part-harness.test-support.ts`
Decisions: a seam on the shared harness, filled on the page side (round 1) · the default stays the throwing show and existing page tests are unchanged (plan.md, Decided) · same options and harness surface as `startPagePart` (plan.md, Decided)

## Changes

- **The seam** (`plugin-part-harness.test-support.ts`). `PagePartHarnessOptions` gains `layoutShow?: HarnessLayoutShow`,
  documented in the interface's comment: what makes the part's `layouts.show`, handed the part's fake page API, its
  manifest, the show's options and the inner show. `fakeLayoutShow` splits in two:
  - the **inner show** (a `LayoutShow`): given options, it adds a listener to `record.shows` that hands each set to
    that options' `setLayouts`, its `refresh` does nothing, and its `dispose` removes the listener. This is what
    today's fake already does with the show's own `setLayouts`.
  - the **default `HarnessLayoutShow`**: the inner show plus a `draw` that throws `layouts.show draw not faked`,
    as today.

  `fakePageApi`'s `layouts.show(options)` calls `(world's layoutShow ?? default)(api, manifest, options, innerShow)`
  and passes the result through `register`, as today, so a stop disposes the show and its draws. The `api` handed in
  is the same fake page API object the part receives: build the API, then let its `layouts.show` close over it.
  `startPagePart` stores `options.layoutShow` where `fakePageApi` reads it; real provider parts in `parts` get the
  same `layoutShow`.
- **The entry** (`layout-host/page-part-harness.test-support.ts`, new). `startDrawingPagePart(part, options)` returns
  `startPagePart(part, { ...options, layoutShow })`, where `layoutShow` is
  `(api, manifest, showOptions, show) => ownerLayoutShow({ manifest, kit: ownerKitServicesOf(api), log: api.services.log, options: showOptions, show })`.
  A one-line comment on the function says it is `startPagePart` with a `layouts.show` that draws through the real
  owner show.
- No layer rule changes: the new file is a `.test-support.ts` in `src/shared/page/layout-host`, which may import
  `src/shared` and the test packages.

## Behaviour

GIVEN a page part whose start calls `api.layouts.show` with a `defaultLayout` defining part `row`, started with
`startDrawingPagePart`, and no `showLayouts` call WHEN the part draws `row` into a parent THEN the parent holds the
part's element, with `data-layout="default"` and `data-layout-owner="<plugin id>"`, and the draw's `layoutName` is
`default`.

GIVEN the same part and `harness.showLayouts({ layouts: new Map([['default', defaultLayout], ['mine', mine]]), user: 'mine' })`
where `mine` defines `row` WHEN it draws `row` THEN the draw's `layoutName` is `mine`.

GIVEN a `row` builder that calls `kit.keyHint` (or the base kit's anchor-drawing part) for one of the plugin's
commands WHEN it draws THEN `harness.anchors` holds an anchor naming that command.

GIVEN a part started with `startPagePart` (no `layoutShow`) WHEN it draws THEN it throws `layouts.show draw not faked`.

## Tests

- `layout-host/page-part-harness.test.ts` (new): `startDrawingPagePart draws a layout part with the layout the show
  picks` — table rows: no set shown (`default`), a set picking `mine` (`mine`); each asserts `layoutName` and the
  root's `data-layout`. A second `it`: the drawn kit's key hint lands in `harness.anchors` with the command id.
  Build the part, its manifest and both layouts in the test, as `owner-show.test.ts` builds its own; read that file
  for the shapes.
- `plugin-part-harness.test.ts`: one test, `layouts.show uses the layoutShow option` — a `layoutShow` fake records
  its call and returns a show whose `draw` returns a sentinel; the part's `draw` returns that sentinel, and a
  `showLayouts` call reaches the options' `setLayouts` through the inner show the fake was handed. Add a row for the
  default: with no option, `draw` throws `layouts.show draw not faked`, unless an existing test already pins it.

Done when: compiles; `npm run lint` passes (the layer check included); the test gate runs both test files above.
Commit:    one commit for the group

## Proof

