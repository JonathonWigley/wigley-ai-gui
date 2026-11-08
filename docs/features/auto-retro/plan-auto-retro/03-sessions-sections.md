# 03 — Sessions: sidebar section registration

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

All paths are under `src/plugins/sessions/`. This task touches no chat file.

Files:
- modify `contract.ts` · `page/sidebar-order.ts` · `page/sidebar-view.ts` · `page/sessions-view.ts` · `page/start.ts`
  · `page/consumer-view.ts` · `page/preview.ts` · `page/layout/sessions-parts.ts` · `layouts/layout.d.ts`
  · `layouts/default/layout.js` · `layouts/default/layout.css`
- test `page/sidebar-order.test.ts` · `page/sessions-view.test.ts` · `page/layout/sessions-parts.test.ts`
  · `page/consumer-view.test.ts` · `page/preview.test.ts` · `page/start.test.ts` · `page/sessions-view-fakes.ts`

Consumes: none. Every other name below is a member the tree already holds.

Produces:
- In `contract.ts`, word for word as plan.md's Shared names:
  ```ts
  export interface SidebarSection {
    id: string;            // unique among registered sections
    label: string;         // the section header's text
    order: number;         // sections sort by order after Favorites and Recent
    claims(row: SessionRow): boolean;
    header?: SectionPart;  // drawn at the header's end
  }
  export interface SectionPart {
    build(parent: HTMLElement): { dispose?(): void };
  }
  // in SessionsPageExports:
  addSection(section: SidebarSection): Disposable;
  ```
- In `layouts/layout.d.ts`:
  - `SectionInput.kind: 'favorites' | 'recent' | 'plugin'`
  - `SectionInput.id: string` — the kind for Favorites and Recent, the registration id for a plugin section
  - `SessionRowInput.section: string | null` — the id of the plugin section that claimed the row, null for none
  - `export interface SectionKit extends SessionsKit { headerPart(parent: HTMLElement): HTMLElement; }`
  - `Layout.section?(parent: HTMLElement, input: SectionInput, kit: SectionKit): SectionPane`
- In `page/sidebar-order.ts`:
  - `export interface RowClaim<R extends OrderedRow> { id: string; order: number; claims(row: R): boolean }`
  - `export interface ClaimedSection<R extends OrderedRow, S extends RowClaim<R>> { section: S; rows: R[] }`
  - `SidebarSections<R extends OrderedRow, S extends RowClaim<R> = RowClaim<R>>` gains `plugins: ClaimedSection<R, S>[]`
  - `sidebarSections<R extends OrderedRow, S extends RowClaim<R>>(rows, favorites, stamps, projectStamps, sections: readonly S[]): SidebarSections<R, S>`
- In `page/layout/sessions-parts.ts`: `SessionsParts.section(parent: HTMLElement, input: SectionInput, header: SectionPart | null): DrawnPart<SectionPane>`

Decisions:
- **The registry.** `page/start.ts` keeps the sections in a `createPartStore<SidebarSection>()` store, beside
  `rowParts`. `addSection` throws `section id <id> is reserved` for the id `favorites` or `recent`. The store throws
  on an id another registered section holds. `mountSessionsView` takes the store as a new dep `sections`, and draws
  the side bar again on each add and each dispose, as it does for `rowParts`.
- **`sessionsPageView`** (`page/consumer-view.ts`) files each `addSection` handle with `consumer.track`, as it does
  for `addRowPart`.
- **Claims.** `sidebarSections` asks each section's `claims` for each row on each call. A claimed row leaves the
  project groups. A row that two sections claim goes to the section with the lower `order`; on a tie, to the section
  registered first. `mountSessionsView` wraps each section's `claims` before it reaches `sidebarSections`: a
  `claims` that throws counts as false for that row and is logged once per draw as
  `section <id> claims failed: <error>`, so one plugin's bug never stops the side bar drawing. Rows inside a plugin section run newest first by row stamp, a row with no stamp older than every
  stamped row, ties in the order of `rows` — the same rule as inside a group.
- **Order.** `plugins` holds only the sections that claim at least one row, sorted by `order`, ties in registration
  order. `drawnRows` returns Favorites' rows, then Recent's, then each plugin section's rows in turn. `orderedRows`,
  the session step keys and the session prompts' `is-no-target` read `drawnRows`, so they include the plugin rows.
- **Drawing a plugin section** (`page/sidebar-view.ts`): after Recent, one `section` part per entry in `plugins`,
  with `{ kind: 'plugin', id: section.id, label: section.label, dropHint: '', isEmpty: false }`. Its `groups` box
  holds its rows directly: no `group` part, no star, no drag item. It registers no drag zone. Each of its rows
  draws with `section: <section id>`; every other row draws with `section: null`. `SECTION_TEXT` keeps only
  `favorites` and `recent`.
- **The header part.** `kit.headerPart(parent)` places `div.session-section-part` (`data-part="<section id>"`) at the
  end of `parent` and builds the section's `header` into it. It returns that div. A second call throws
  `headerPart placed twice`, so the section draws with `default`. A section with no `header`, or a Favorites or
  Recent section, gets an empty div. A section that leaves `headerPart` out draws no header part. A `build` that
  throws is logged as `section part <id> failed: <error>` and its div is removed. Its `dispose` runs before the side
  bar draws again; a `dispose` that throws is logged as `section part <id> dispose failed: <error>`.
- **Layout contract text** (`layouts/layout.d.ts`). Write a doc comment on each changed member. Change every line
  that names two sections: the Panes paragraph (lines 10–15), the `SectionInput` comment (line 68, "Both sections
  always draw"), and the `SideBarPane` comment (line 121). New text: the app fills the side bar's `rows` with
  Favorites, Recent, then each plugin section that claims a row, by order; Favorites and Recent always draw; a
  plugin section's `groups` holds its `row`s directly, with no `group`, and is no drop zone. Add `headerPart` to the
  "The app keeps" list. `default` draws `New Chat` and the rest as now.
- **The `default` layout** (`layout.js`, `layout.css`; theme tokens only, since `npm run lint` runs check-styles):
  - `section` sets `data-section="<id>"` on its element for every kind. For kind `plugin` it adds the class
    `session-section--plugin`, leaves the drop hint out, and calls `kit.headerPart` inside the label element.
  - A plugin section's label always shows (`display: flex`). The header part sits after the hairline, at the line's
    end (`order` on `.session-section-part`; `::after` is the hairline).
  - Favorites and Recent labels keep today's rule: they show while `has-favorites` or `is-reordering`.
  - `row` adds `session-row--claimed` while `input.section !== null`. A claimed row is muted: its title takes
    `--wg-fg-secondary`, and its card has no `card-background` at rest. It takes a dashed accent edge on its start:
    `border-inline-start: var(--wg-indicator-width) dashed var(--wg-accent)`. The edge stays accent in every state:
    write `.ui-row.session-row.session-row--claimed { border-inline-start-color: var(--wg-accent) }` after today's
    hover, `is-selected` and `is-on-screen` rules, at a specificity above theirs, so their `border-color` shorthand
    recolours only the other three sides. Hover, selection and on-screen otherwise keep today's rules: a selected
    claimed row takes today's selected fill and title colour; the muted title applies at rest and on hover. A
    claimed row with an emphasis draws its `session-row-edge--*` status edge on top of the dashed edge, as today.
  - Update the file's top comment to name the plugin sections and the claimed row.
- **The layout preview** (`page/preview.ts`): add a sample section and one claimed sample row, so `Space z l s`
  shows the claimed look. Section: `{ id: 'preview-section', label: 'Plugin', order: 0, claims: (row) =>
  row.sessionId === 'preview-6' }`. Row: `sampleRow('preview-6', 'wigley-agents 2', 'wigley-agents', 'claude',
  false)` with titles `{ user: 'Retro of Scratchpad', agent: null, firstMessage: null }`, activity
  `{ word: 'working', tone: 'running', rank: 20 }`, status null. `previewSections` passes the sample section.
- **Doc comments.** The `SessionsPageExports` block comment above `addTab` says what `addSection` does: the
  registration, the reserved ids, the claim rule, the order, the redraw on add and dispose, and that `header` builds
  on each side-bar draw, so a header whose content changes between draws redraws into its own div. Update the
  `sessionsPagePart` comment in `page/start.ts` ("The rows group by project under Favorites and Recent", line 200),
  the `mountSidebarView` comment, and the `sidebar-order.ts` file comment ("two sections of project groups").
  In `layout.d.ts` also rewrite the `SectionPane` comment ("one `group` per project", line 126) and the
  `Layout.section` comment ("its label and drop hint over the box of its groups", line 222) to say a plugin
  section's `groups` holds `row`s directly, and give `SessionRowInput.section` (near line 46) its comment.
- **Docs.** `docs/features/session-groups/design.md` § Order and § Drawing are written ahead (plugin sections);
  this task edits no doc.

GIVEN rows `a1` and `r1` in project `alpha` and a section `retro` that claims `r1`
WHEN the side bar draws
THEN group `alpha` holds only `a1`, a section labelled `Retro` follows Recent holding `r1` with no group, and
`orderedRows` is `a1, r1`

GIVEN that section registered
WHEN its handle is disposed
THEN `r1` draws in group `alpha` again and no plugin section draws

GIVEN a section that claims no row
WHEN the side bar draws
THEN no section part draws for it

Tests:
- `sidebar-order.test.ts`, `sidebarSections_ordersSectionsGroupsAndRows`: add an optional `sections` field
  (`[id, order, claimed session ids][]`, default `[]`) and an `expectedPlugins` field (`'<id>: <ids>'` per drawn
  section, default `[]`). Add rows:
  - `a claimed row leaves its group and draws after recent`: rows `a1 alpha`, `a2 alpha`, `b1 beta`; favorites
    `[]`; stamps `{ a1: 1, a2: 2, b1: 3 }`; projectStamps `{ alpha: 2, beta: 3 }`; sections `[['retro', 0, ['a2']]]`
    → recent `['beta: b1', 'alpha: a1']`, plugins `['retro: a2']`, drawn `['b1', 'a1', 'a2']`
  - `plugin sections sort by order, a tie by registration`: rows `x1 alpha`, `y1 alpha`, `z1 alpha`; sections
    `[['late', 5, ['x1']], ['first', 1, ['y1']], ['tied', 5, ['z1']]]` → recent `[]`, plugins
    `['first: y1', 'late: x1', 'tied: z1']`, drawn `['y1', 'x1', 'z1']`
  - `a section that claims no row is left out`: rows `a1 alpha`; sections `[['empty', 0, []]]` → recent
    `['alpha: a1']`, plugins `[]`, drawn `['a1']`
  - `a row two sections claim goes to the lower order`: rows `a1 alpha`; sections `[['high', 9, ['a1']], ['low',
    2, ['a1']]]` → plugins `['low: a1']`, drawn `['a1']`
  - `rows in a plugin section run newest first`: rows `a1 alpha`, `a2 alpha`; stamps `{ a1: 1, a2: 2 }`; sections
    `[['retro', 0, ['a1', 'a2']]]` → plugins `['retro: a2 a1']`, drawn `['a2', 'a1']`
  - `a favorite's claimed row leaves Favorites`: rows `f1 fav`, `f2 fav`; favorites `['fav']`; sections
    `[['retro', 0, ['f1']]]` → favorites `['fav*: f2']`, plugins `['retro: f1']`, drawn `['f2', 'f1']`
- `sessions-view.test.ts`, new `sessionsView_SectionAddedThenDisposed_RedrawsTheSideBar`: rows `a1` and `r1`, each
  `{ ...sessionRow(id), project: 'alpha' }`. Add `{ id: 'retro', label: 'Retro', order: 0, claims: (row) => row.sessionId === 'r1', header }`,
  where `header.build` appends a `span` with text `2 queued` and records each dispose. After the add: a
  `session-section--plugin` element holds the label text `Retro`, the text `2 queued` inside its
  `session-section-part`, and one row, the one whose tooltip holds `label r1` (find it with `rowNamed`), carrying `session-row--claimed`; row `a1` does not
  carry it; `orderedRows()` ids are `['a1', 'r1']`. After a `render` of the same state, the header's dispose count is
  1. After the handle's `dispose`: no `session-section--plugin` element; `orderedRows()` ids are `['a1', 'r1']` with
  `r1` inside group `alpha`; the header's dispose count is 2.
- `sessions-view.test.ts`, new `sessionsView_ClaimsThrows_RowStaysInItsGroupAndLogs`: a section whose `claims`
  throws `boom` for `r1` → `r1` draws in group `alpha` with no `session-row--claimed`, no plugin section draws, and
  the log holds `section retro claims failed: boom` once for that draw.
- `page/start.test.ts`, new `addSection_ReservedId_Throws` (`it.each` over `favorites` and `recent`): the started
  part's `addSection` with that id throws `section id <id> is reserved`, and the side bar draws no plugin section.
  The sessions-view test above adds its section through the view's `sections` store, not through the exports.
- `sessions-view-fakes.ts`, `drawnRows`: also collect the rows inside a plugin section's groups box, in drawn order,
  so every existing test that counts rows still counts them. Add a `sections` option to `sessionsViewSetup`
  (default a new store).
- `sessions-parts.test.ts`, `groupAndSectionParts_Draw_KeepsTheContract`: add rows:
  - `default plugin section` — input `{ kind: 'plugin', id: 'retro', label: 'Retro', dropHint: '', isEmpty: false }`,
    header building text `1 queued` → drawn by `default`, holds `['Retro1 queued']` (`sectionShape` reads the
    label's `textContent`, and the header part sits inside the label), boxes inside, failure null. `sectionShape`
    gains an optional third argument `header: SectionPart | null`, default `null`, passed on to `parts.section`;
    the existing rows pass nothing
  - `user section places its header part twice` → drawn by `default`, failure `headerPart placed twice`
  - `header part build throws` → drawn by `default` with no header text, failure `section part retro failed`
- `consumer-view.test.ts`, `disposes the tabs and parts a consumer added when its registrations dispose`: add a
  section to what the consumer adds, and assert its handle is disposed with the rest.
- `preview.test.ts`, `previewRowState_PinnedSample_ShowsItsTitleAndActivity`: add the row
  `{ label: 'wigley-agents 2', title: 'Retro of Scratchpad', activity: 'working' }`. In
  `preview_SampleRows_CoverEveryRowState`, assert `previewSections(PREVIEW_STATE).plugins` holds one section whose
  rows are `['preview-6']`. `sessionsView_StepPreview_MovesSampleSelectionOnly`'s `by -1` row now lands on
  `wigley-agents 2`: `preview-6` is the last drawn row and `stepSession` wraps. Update that expected value; keep
  the preview's row order.

Approach: the existing rows of `sidebarSections_ordersSectionsGroupsAndRows` stay as they are, with
`expectedPlugins` defaulting to `[]`. Build each test section with `{ id, order, claims: (row) =>
ids.includes(row.sessionId) }`.

Done when: `npm run typecheck` passes; `npm test` passes on the tests above and on every test in
`src/plugins/sessions/`; `npm run lint` passes (check-layers and check-styles included). The report names each user
layout under `~/.config/wigley-ai-gui/layouts/sessions/` that the contract change leaves behind (none exists at plan
time).

Commit: one commit for the group.

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
