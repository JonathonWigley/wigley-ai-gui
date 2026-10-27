# 11 — Gallery layout

Status: not started
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Gallery mode draws through a gallery layout: the head line, each primitive's sample block, and each sample cell.
The primitives inside the cells stay app-owned and themed.

Files:
- modify `src/plugins/gallery/layouts/layout.d.ts` — replace 02's placeholder (`export {};`) with the gallery
  Layout contract
- create `src/plugins/gallery/layouts/default/layout.js` — the built-in `default` layout, `// @ts-check`
- create `src/plugins/gallery/page/layout/read-gallery-layout.ts` · test `read-gallery-layout.test.ts`
- create `src/plugins/gallery/page/layout/gallery-parts.ts` — the kits and the part drawing over the host ·
  test `gallery-parts.test.ts`
- modify `src/plugins/gallery/page/gallery-view.ts`, `src/plugins/gallery/page/start.ts`,
  `src/plugins/gallery/manifest.ts`

This task does not edit `src/plugins/gallery/main/start.ts`, `src/plugins/main.ts` or `scripts/check-layers.mts`.

Consumes (← 02, names as `02-layout-core.md` § Produces writes them):
- the register-only main part `galleryMainPart` in `src/plugins/gallery/main/start.ts`, listed in
  `src/plugins/main.ts`. It registers the raw text of `src/plugins/gallery/layouts/layout.d.ts` with
  `api.layouts.register({ layoutTypes })` and disposes the registration. It needs no change when this task fills
  the contract.
- page `api.layouts.show<L>(options: ShowLayoutOptions<L>): LayoutShow`, `ShownLayouts<L>`, `LayoutShow`
- `readLayoutModule(module: unknown, name: string): Record<string, unknown>`, `isRecord`
- `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>): { built: R;
  layoutName: string; dispose(): void }` — options `owner`, `parent`, `pick`, `defaultLayout`, `part(layout)`, `build(builder,
  parent, rollback): R`, `log`, `logSource`, `partName` — with `PartPick<L>`, `RollbackDeps`,
  `requireElementIn(parent, element, partName)`. `dispose` disposes every anchor and box recorded through the
  successful attempt's `rollback`, once.
- `pickLayout<L>(chain, layouts, defines): PartPick<L>`
- `createBaseKit(deps: BaseKitDeps): BaseKit`, `BaseKitDeps` (`keys.keysFor` returns `string | null`; `scope:
  ViewScope | null`), `KitCommands { exists(id): boolean; run(id): void }`, `commandRunner(qualifiedId: CommandId,
  commands: KitCommands): () => void`
- `BaseKit` from `kit.d.ts`, imported in `layout.d.ts` as
  `import type { BaseKit } from '../../../shared/page/layout-host/kit';` (the registry rewrites it to `'../kit'` in
  the user's copy). This task uses `el`, `sectionHeader` and `keyHint`.
- the `LAYERS` entries for `src/plugins/gallery/layouts`, and for `src/plugins/gallery/main` (allowing
  `src/contracts`, `src/shared`, `src/plugins/gallery`, `src/plugins/gallery/layouts`), with `src/plugins/gallery/main`
  listed in the `src/plugins/main.ts` entry, and `src/plugins/gallery/page` listing `src/plugins/gallery/layouts` and
  `src/shared/page/layout-host` (02 adds them; this task does not edit `scripts/check-layers.mts`)

Produces:
- in `layouts/layout.d.ts`:
  - `export interface GalleryHeadInput { transparency: 'full' | 'reduced' | null }`
  - `export interface GalleryCellInput { caption: string; isWide: boolean }`
  - `export interface GallerySectionInput { name: string; rows: GalleryCellInput[][] }`
  - `export interface GalleryFramedInput { name: string; isDialog: boolean }`
  - `export interface GalleryPart { element: HTMLElement }`
  - `export interface GalleryKit extends BaseKit {}`
  - `export interface HeadKit extends GalleryKit { transparencyHint(parent: HTMLElement): HTMLElement }`
  - `export interface SectionKit extends GalleryKit { cell(parent: HTMLElement, row: number, column: number):
    HTMLElement }`
  - `export interface SampleKit extends GalleryKit { sample(parent: HTMLElement): HTMLElement }`
  - `export interface Layout { head?(parent: HTMLElement, input: GalleryHeadInput, kit: HeadKit): GalleryPart;
    section?(parent: HTMLElement, input: GallerySectionInput, kit: SectionKit): GalleryPart;
    framedSection?(parent: HTMLElement, input: GalleryFramedInput, kit: SampleKit): GalleryPart;
    cell?(parent: HTMLElement, input: GalleryCellInput, kit: SampleKit): GalleryPart }`
  - `export interface CompleteLayout extends Required<Layout> {}`
- `export function readGalleryLayout(module: unknown, name: string): Layout` in `read-gallery-layout.ts`
- `GalleryView.setLayouts(shown: ShownLayouts<Layout>): void` in `gallery-view.ts`
- manifest setting `layout`

Decisions:
- **The main part is 02's.** Task 02 creates `src/plugins/gallery/main/start.ts`, lists it in
  `src/plugins/main.ts`, and creates the placeholder contract. This task fills the contract only; the main part
  registers the new text with no edit.
- **No picker or prompt.** The gallery opens no list picker and no confirm prompt, so this task fills neither hook.
- **Parts, from `gallery-view.ts`:**
  - `head` — the status line (`gallery-status`): `Transparency: <override or 'from settings'>` and the transparency
    hint. The one-tab strip and the sheet stay app-owned.
  - `section` — one per primitive drawn by `section(name, ...rows)`: the section header over each row of cells.
  - `framedSection` — one per primitive drawn by `framedSection(name, frame)`: Split, FloatingPanel, Dialog
    (`isDialog` true for Dialog only).
  - `cell` — one per state drawn by `cell(sample, caption, isWide)`: the sample over its caption.
- **The samples stay app-owned.** The app builds every sample element with the primitives as today. `kit.sample`
  appends the cell's or framed section's sample and returns it. A cell or framed section that leaves it out gets the
  sample appended at the end of its element, so every primitive shows. A layout never restyles a primitive: its CSS
  selects under its own `[data-layout-owner="gallery"][data-layout="<name>"]` root only (`plan.md` Decisions, 02's
  Layout CSS decision).
- **Cells the section leaves out are drawn:** after `section` draws, the app draws every cell the section did not
  draw with `kit.cell`, at the end of the section's element, in row order.
- **The app restructures `gallery-view.ts`** into one ordered table of section specs, each a name, a kind
  (`section` or `framed`) and a function that builds its samples fresh. The section order and every sample, caption
  and wide flag stay as today. The frame (`gallery-frame`, `gallery-frame--dialog`) is drawn by `framedSection`,
  not by the app.
- **`transparencyHint`** anchors `gallery.toggleTransparency` in scope `gallery.gallery` with label `transparency`,
  as today, through `kit.keyHint(parent, 'toggleTransparency', { label: 'transparency' })`. `showTransparency`
  redraws the `head` part with the new input.
- **Disposing a part on a redraw:** the view keeps the `dispose` of each part's last draw: one for `head`, and one
  per section, framed section and cell. It calls that `dispose` before it draws the same part again (`head` on each
  `t` press and each `setLayouts`, every section and cell on `setLayouts`) and before it drops the part's element. So
  the transparency hint, and any `kit.keyHint` a user part calls, hold one anchor however often the part draws.
- **BaseKit deps:** `scope` is `gallery.gallery`; `commandNamed(short)` returns `qualify('gallery', short)` when
  `short` is a key of `galleryManifest.commands`, else null; `markdown` is `api.services.markdown`; `platform` is
  `api.platform`; `keys` is the keys page export; `commands` is the `KitCommands` `{ exists: (id) =>
  api.keys.command(id) !== undefined, run: (id) => api.commands.run(id) }`, as 02's Kit commands decision writes it.
- **Pick chain:** `[shown.user, 'default']`. Fallback per part through `drawPart` with `owner` `gallery`,
  `logSource` `gallery` and `partName` the part's key. Each part root carries `data-layout="<name>"` and
  `data-layout-owner="gallery"`.
- **Reload keeps work:** the gallery holds no user work. On `setLayouts` the app reads the sheet's `scrollTop`,
  redraws the head and every section with fresh samples, and sets `scrollTop` back. The transparency override lives
  in `api.transparency` and is kept. The split sample's width lives in `uiState` and is kept. The live ToggleMark and
  the Tabs sample go back to their first state; that is accepted.
- **`default` layout** reproduces today's look with today's class names (`gallery-status`, `gallery-status-text`,
  `gallery-section`, `gallery-section--framed`, `gallery-states`, `gallery-frame`, `gallery-frame--dialog`,
  `gallery-cell`, `gallery-cell--wide`, `gallery-caption`), so `gallery.css` keeps working unchanged. Sections draw
  their header with `kit.sectionHeader`.
- **Page:** `start` calls `api.layouts.show<Layout>({ defaultLayout, read: readGalleryLayout, userLayout: () =>
  api.settings().layout, setLayouts: (shown) => view.setLayouts(shown) })`. The show refreshes on each change of
  gallery's settings by itself, so `start` calls no `refresh`. Before the first set the view draws with `default`
  alone.
- **Setting:** manifest `settings: { layout: 'default' }`; `settingInfo.layout`: label `Layout`, description
  `"The gallery layout Gallery mode's sample blocks draw in: a folder name in gallery's layouts folder, or default."`
- The manifest's comment says "Page-only"; update it to say the main part only registers the layout contract, if
  02 left it unchanged.

GIVEN a user gallery layout whose `cell` throws WHEN Gallery mode draws THEN every cell draws with `default` and
carries `data-layout="default"`, and each sample shows.
GIVEN a user `section` that draws only its header WHEN Gallery mode draws THEN every cell of that section follows
the header, drawn by the `cell` part.
GIVEN the gallery scrolled to the Card section WHEN the gallery layout file is saved THEN the sheet redraws at the
same scroll position.

Tests:
- `readGalleryLayout_BadShape_ThrowsNamingIt` — `it.each` rows: default export missing; not an object; key `blocks`
  (no such part); `cell: {}` (not a function). Each asserts the message names the layout and the key. Catches a
  reader that lets a bad layout reach drawing.
- `galleryParts_PartFails_DrawsWithDefault` — `it.each` rows: `section` throws; `cell` throws; `framedSection`
  returns an element not in `parent`. Each asserts `data-layout="default"` and `data-layout-owner="gallery"` on the
  part's root. Catches a missing
  fallback.
- `galleryParts_PieceLeftOut_AppendsIt` — `it.each` rows: a `cell` that never calls `kit.sample` (the sample ends
  the cell); a `section` that draws no cell (every cell follows the header, in row order); a `framedSection` that
  never calls `kit.sample` (the sample ends it). Catches a primitive that a layout can hide.
- `galleryParts_HeadRedraw_LeavesOneTransparencyAnchor` — a recording `anchor` double. Draw `head`, call
  `showTransparency` twice, then `setLayouts` with a new set. Asserts one live `gallery.toggleTransparency` anchor.
  Catches a redraw that leaks an anchor on each `t` press or reload.
- `galleryView_Relayout_KeepsTheScroll` — with the fake DOM, set the sheet's `scrollTop`, call `setLayouts` with a
  new set, assert `scrollTop` is back. Catches a redraw that jumps to the top.

Done when: `npm run lint` and the type check pass; the test gate runs the tests above. Runtime and visual checks are
task 17's (Final verification).

Commit: one commit for the group.

## Proof

