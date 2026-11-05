# 05 — Layout parts

Status: not started
Type: Task
Wave: 3 · Depends on: 02, 04, 06
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/layouts/layout.d.ts` · modify `src/plugins/docs/layouts/default/layout.js` · modify `src/plugins/docs/layouts/default/layout.css` · modify `src/plugins/docs/page/layout/docs-parts.ts` · modify `src/plugins/docs/page/layout/read-layout.ts` · modify `src/plugins/docs/page/docs.css` · modify `src/plugins/docs/manifest.ts` · modify `DESIGN.md` · test `src/plugins/docs/page/layout/docs-parts.test.ts`

Consumes:  none. The wave order comes from `plan.md`. No type from 02 enters this task.

Produces, in `src/plugins/docs/layouts/layout.d.ts`:

```ts
// pageFrame, scope docs.doc. Input: Record<string, never>.
export interface PageFrameKit extends DocsKit {
  // The app's `div.docs-article`: the header, banner, prompt, body and editor slots. Appended first when left out.
  article(parent: HTMLElement): HTMLElement;
  // The app's `div.docs-aside`. The app sets `hidden` on it while it holds nothing, so a layout's CSS does not set
  // `display` on it. Appended last when left out.
  aside(parent: HTMLElement): HTMLElement;
}
// pageAside, scope docs.doc. Input: Record<string, never>.
export interface PageAsideKit extends DocsKit {
  // The app's `div.docs-aside-section` for On this page. The app fills it with one `asideHeading` and an `asideLink`
  // per heading, and sets `hidden` on it while the doc has no heading. Appended first when left out.
  onThisPage(parent: HTMLElement): HTMLElement;
  // The same for Linked from, hidden while no doc links here. Appended last when left out.
  linkedFrom(parent: HTMLElement): HTMLElement;
}
// asideHeading, scope docs.doc. `kind: 'sections'` is the heading of what `Ctrl+h` and `Ctrl+l` move through.
export interface AsideHeadingInput {
  title: string;
  kind: 'sections' | 'linkedFrom';
}
// asideLink, scope docs.doc. The app sets the click and the `title` (the tooltip) on the root, and keeps the mouse
// from taking focus there, so an `asideLink` gives `kit.row` no `onClick`. The app sets the section's `title` on an
// On this page row, and the `~` path on a Linked from row. `depth` indents a heading under its parent.
export interface AsideLinkInput {
  title: string;
  depth: number;
}
// sectionEditControl, scope docs.doc: drawn inside a rendered heading.
export interface SectionEditControlInput {
  // The section's heading text.
  title: string;
}
export interface SectionEditControlKit extends DocsKit {
  // Opens this section in the editor.
  openSection(): void;
}
// recentChanges, scope docs.doc.
export interface RecentChangesInput {
  rows: {
    sha: string;
    subject: string;
    time: { text: string; title: string };
    pages: { title: string; path: string }[];
  }[];
}
export interface RecentChangesKit extends DocsKit {
  // Appends the app's link to the page at `path` to `parent` and returns it.
  pageLink(parent: HTMLElement, title: string, path: string): HTMLElement;
}
// listRow, scope docs.doc. The app sets `is-selected`, `is-cursor` and the click on the row's root element.
export interface ListRowInput {
  title: string;
  path: string;
  time: { text: string; title: string } | null;
}
// listPage, scope docs.doc.
export interface ListPageInput {
  title: string;
  count: number;
  groups: { title: string; rows: ListRowInput[] }[];
}
export interface ListPageKit extends DocsKit {
  // The app's `ol.docs-list-rows` for group `groupIndex`, which the app fills with `listRow` parts. One slot per group,
  // each placed at most once per draw. One left out is appended at the end of the part's root, in group order.
  rows(parent: HTMLElement, groupIndex: number): HTMLElement;
}
// sidebarSwitch, scope docs.tree. Its kit is DocsKit. The app sets the click on the root and keeps the mouse from
// taking focus there; a click anywhere on the control switches the view.
export interface SidebarSwitchInput {
  view: 'wiki' | 'all';
}
// mainEmpty, scope docs.doc.
export interface MainEmptyInput {
  // The Main page's path, shown with `~`.
  path: string;
}
export interface MainEmptyKit extends DocsKit {
  // The app's hint that offers to create the Main page. Appended at the end of the part's root when left out.
  createMainHint(parent: HTMLElement): HTMLElement;
}
```

`Layout` gains these optional members:

| Part | Input | Kit |
|---|---|---|
| `pageFrame` | `Record<string, never>` | `PageFrameKit` |
| `pageAside` | `Record<string, never>` | `PageAsideKit` |
| `asideHeading` | `AsideHeadingInput` | `DocsKit` |
| `asideLink` | `AsideLinkInput` | `DocsKit` |
| `sectionEditControl` | `SectionEditControlInput` | `SectionEditControlKit` |
| `recentChanges` | `RecentChangesInput` | `RecentChangesKit` |
| `listPage` | `ListPageInput` | `ListPageKit` |
| `listRow` | `ListRowInput` | `DocsKit` |
| `sidebarSwitch` | `SidebarSwitchInput` | `DocsKit` |
| `mainEmpty` | `MainEmptyInput` | `MainEmptyKit` |

Also produced:

- Theme token `docs.aside-width`, read as `--wg-docs-aside-width`, in `src/plugins/docs/manifest.ts`.
- Container `docs-doc` on `.docs-doc` in `src/plugins/docs/page/docs.css`.

Decisions:

**Scopes.** `PART_SCOPES` in `docs-parts.ts` maps `sidebarSwitch` to `tree`. It maps the other nine new parts to `doc`. `LAYOUT_PARTS` in `read-layout.ts` adds all ten as `true`.

**Why `read-layout.ts` is in Files.** `plan.md` § File Structure names four layout files. `LAYOUT_PARTS` is a `Record<keyof Layout, true>`, so the build fails until it holds the new names. Report this in the Run log as a file beyond `plan.md`.

**`docHeader` in `default`.** It already draws the design's order: the title (`h1.docs-title`) with the `i edit` hint on its line, the path (`div.docs-path`) under it, and the chips (`div.docs-chips`) under the path, then the read-only line. Keep this order. Do not change `docHeader`. `DocHeaderInput.path` stays the `~` path, and `fullPath` stays its tooltip.

**`default` builders in `layout.js`.** Each builder appends its root to `parent` first.

| Part | Root | Draws, in order |
|---|---|---|
| `pageFrame` | `div.docs-page-frame` | `kit.article(root)`, then `kit.aside(root)` |
| `pageAside` | `div.docs-aside-body` | `kit.onThisPage(root)`, then `kit.linkedFrom(root)` |
| `asideHeading` | `div.docs-aside-heading` | For `kind: 'sections'`: `kit.edge(root, 'prevSection', { side: 'start' })`, then `span.docs-aside-title` with `input.title`, then `kit.edge(root, 'nextSection', { side: 'end' })`. For `linkedFrom`: the title only |
| `asideLink` | `kit.row` | `{ density: 'tree', label: input.title, depth: input.depth }`, with no `onClick` |
| `sectionEditControl` | `kit.button` | `kit.button(parent, 'edit', kit.openSection, { variant: 'ghost' })`, with class `docs-section-edit` added |
| `recentChanges` | `div.docs-recent` | `kit.sectionHeader(root, 'Recent changes')`, then per row `div.docs-recent-row`: `span.docs-recent-time` (`time.text`, title `time.title`), `span.docs-recent-subject` (`subject`, title `sha`), `span.docs-recent-pages` with `kit.pageLink(pages, page.title, page.path)` per page. With no rows: `p.docs-recent-empty` reading `No commits touch these pages yet` |
| `listPage` | `div.docs-list-page` | `h1.docs-title` with `title`, `div.docs-list-count` with `<count> docs` (`1 doc` for 1), then per group `kit.sectionHeader(root, group.title)` and `kit.rows(root, index)` |
| `listRow` | `kit.row` | `{ density: 'list', tag: 'li', label: input.title, detail: input.path, trailing }`. `trailing` is `span.docs-row-time` with `time.text` and title `time.title`, or null with no time |
| `sidebarSwitch` | `div.docs-sidebar-switch` | `span.docs-sidebar-switch-option` reading `Wiki`, then one reading `All pages`. The option for `input.view` adds `is-active` |
| `mainEmpty` | `kit.emptyState(parent, 'No Main page at ' + input.path)` | `kit.createMainHint(root)` |

`kit.edge` draws an empty anchor for a command the owner does not hold yet (`kit.d.ts`), so `prevSection` and `nextSection` draw nothing until task 09 adds them. The `sidebarSwitch` shows no key hint, because `Space v w` is a leader sequence and shows in which-key.

**Width token.** Add to `themeTokens` in `manifest.ts`: `'aside-width': { kind: 'length', default: '240px' }`. It is the docs plugin's own token, so it belongs in the plugin per `DESIGN.md` § Tokens and themes.

**Narrow rule.** `docs.css` adds to `.docs-doc`: `container: docs-doc / size`. The scroller already has a definite size, because it scrolls. `size` also gives `cqh` for the aside's height. `layout.css` holds:

```css
@container docs-doc (width < 920px) {
  .docs-aside {
    display: none;
  }
}
```

The value is `920px`: the article's `76ch` prose measure at `text-prose` (at most 656px), plus the `space-6` gap (24px), plus the aside's 240px. So the aside hides before the article gives up width, per `../design.md` § Page. The query reads the scroller's content box, so a session tab's narrow split hides the aside too. CSS reads no variable in `@container`, so a theme that changes `docs.aside-width` does not move this value.

**CSS in `layout.css`.** All lengths are tokens, per `scripts/check-styles.mts`.

- `.docs-page-frame`: `display: flex; gap: var(--wg-space-6); align-items: flex-start; min-width: 0`.
- `.docs-article`: `flex: 1 1 0; min-width: 0; min-height: 0`.
- `.docs-aside`: `flex: none; width: var(--wg-docs-aside-width); position: sticky; top: 0; max-height: 100cqh; overflow-y: auto`. It sets no `display`, because the app sets `hidden`.
- Whole-file editor, so the editor keeps filling the height: `.docs-doc.is-editing .docs-page-frame { flex: 1; min-height: 0; align-items: stretch }`, `.docs-doc.is-editing .docs-article { display: flex; flex-direction: column }`, `.docs-doc.is-editing .docs-aside { display: none }`.
- `.docs-section-edit`: hidden by `opacity: 0`, shown at `opacity: 1` on `.md :is(h1, h2, h3, h4, h5, h6):hover .docs-section-edit` and on `.docs-section-edit:focus-visible`, so a keyboard user who tabs to the button sees it, with `transition` over `--wg-duration-fast`, `margin-inline-start: var(--wg-space-2)`.
- `.docs-aside-heading`: `display: flex; align-items: baseline; gap: var(--wg-space-1_5); color: var(--wg-fg-secondary); font-size: var(--wg-text-12)`.
- `.docs-aside-section + .docs-aside-section`: `margin-top: var(--wg-space-4)`.
- `.docs-recent`, `.docs-list-page`, `.docs-recent-row`, `.docs-list-rows`, `.docs-sidebar-switch` and its options: use `space-*`, `text-12` and `fg-tertiary` as the tree's rows do. `.docs-sidebar-switch-option.is-active` uses `--wg-fg`, and the other option `--wg-fg-tertiary`. `.docs-list-rows` has `list-style: none; margin: 0; padding: 0`.

**`DESIGN.md`.** Per § Tokens and themes, a new token and breakpoint enter the matching section:

- § Space, size and shape, Density: add `docs.aside-width`, the docs page's right column.
- § Space, size and shape, Breakpoints: add `920px` on `docs-doc`, which hides the docs page's right column.
- § Surfaces, Docs: add one sentence: the page draws through a frame of article and right column, and the column holds On this page and Linked from and sticks while the article scrolls.

GIVEN a user layout that defines none of the new parts WHEN a part draws THEN `default` draws it.
GIVEN `listPage` with 2 groups WHEN `default` draws it THEN `kit.rows` runs once per group, with indexes 0 and 1.
GIVEN a `.docs-doc` under 920px wide WHEN the aside holds entries THEN the aside takes no width.

Tests, in `docs-parts.test.ts`:

- `draw_NewPart_FiresInItsScope`: `it.each` over the ten parts. `sidebarSwitch` → `tree`, the other nine → `doc`. Read the scope from the `baseKit` call. It catches a part missing from `PART_SCOPES`, which draws with an undefined scope.
- `listPage_DefaultDraw_PlacesEachGroupsRowsInOrder`: two groups; the kit's `rows` records `[0, 1]`; the drawn part's `layoutName` is `default`, which proves no throw and no fallback.
- `sidebarSwitch_DefaultDraw_MarksTheShownView`: `it.each` over `wiki` and `all`; the `is-active` option's text is `Wiki` or `All pages`.

`src/shared/layouts/layout-contracts.test.ts` already checks the new kit members against `BaseKit`. The look earns a live run in tasks 07, 08 and 11, not a test here, since no view draws these parts until then.

Done when: `npm run lint` passes; `npm test` runs the tests above and passes; no view draws the new parts yet.
Commit:    one commit for the group

## Proof

