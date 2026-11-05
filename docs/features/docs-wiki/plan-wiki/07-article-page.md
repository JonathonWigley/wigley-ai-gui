# 07 — Article page and right column

Status: in progress
Type: Task
Wave: 4 · Depends on: 03, 05 (and 02, which 05 waits on)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/docs/page/doc-view.ts` · test `src/plugins/docs/page/doc-view.test.ts`

Consumes:  `sectionsOf(text: string): DocSection[]`, `DocSection` ← 03
           `linkedFrom(entries: readonly IndexEntry[], targetPath: string): LinkedFromRow[]`, `LinkedFromRow` ← 02
           parts `pageFrame`, `pageAside`, `asideHeading`, `asideLink` with `PageFrameKit`, `PageAsideKit`, `AsideHeadingInput`, `AsideLinkInput` ← 05

Produces, in `src/plugins/docs/page/doc-view.ts`:

- `DocView.setEntries(entries: readonly IndexEntry[]): void`. It holds the index's entries and draws the right column again.
- The elements `div.docs-article` and `div.docs-aside`, placed by `pageFrame`.
- The view's private `shownSections: DocSection[]`: the sections of the text the rendered body shows. Tasks 09 and 10 read it.

Decisions:

**How doc-view receives entries.** `createDocView` gets no new dep, so `docs-view.ts` stays out of this task. Task 08 owns `docs-view.ts` in this wave, and two tasks in one wave never share a file. `DocView` gains the method `setEntries`, and `let entries: readonly IndexEntry[] = []` in the view. Task 09, the next task on `docs-view.ts`, wires it: `showDocument` calls `doc.setEntries(next?.entries ?? [])` before `doc.refreshChips()`. So until 09 lands, Linked from shows only in this task's tests.

**Frame.**

- `pane` holds `emptySlot`, then a new `frameSlot` (a `partSlot()`).
- A new `article` element (`element('div', 'docs-article')`) holds `headerSlot`, `bannerSlot`, `promptSlot`, `bodySlot`, `editorSlot`, in that order.
- A new `aside` element (`element('div', 'docs-aside')`) starts with `hidden = true`.
- `drawFrame` draws `pageFrame` into `frameSlot`, in the pattern of `drawPane`: `{}` input, `article` and `aside` kit members from `slotFor`, and `placeIfLeftOut` for both.
- The frame draws once at view creation, right after `drawPane`, and stays for the view's life. A doc open does not draw it again.
- `emptySlot` stays a direct child of `pane`, so the rule `.docs-doc > .docs-slot > .ui-empty` still centres the empty state.

**Right column.** `drawAside()` runs from `drawBody`, after `bodyMount.draw`, and from `setEntries`. It does this:

1. Saves `aside.scrollTop`. Disposes the drawn aside parts.
2. Finds the doc's kind. With `shown` null, a `target.detail`, or a `filePath` that does not end in `.md`: sets `shownSections = []`, sets `aside.hidden = true`, and stops. So hook, plugin and non-markdown docs keep today's draw, at full width.
3. Otherwise, in `drawBody` only, sets `shownSections = sectionsOf(shown.text)`. `setEntries` keeps the list, since the text did not change.
4. Reads `rows = linkedFrom(entries, shown.target.path)`.
5. With no section and no row: `aside.hidden = true`, and stops.
6. Sets `aside.hidden = false`, draws `pageAside` into `aside`, and places two `div.docs-aside-section` elements through `onThisPage` and `linkedFrom`. A section with nothing to show gets `hidden = true`, and draws no parts.
7. Sets back `aside.scrollTop`.

`drawBody` runs after `shown` changes, so the column and the body always show one text. A write with the section editor open (task 09) draws neither. `showDetail` and `clear` go through `drawBody`, so they hide the column.

**Copy, pinned.** `asideHeading` inputs: `{ title: 'On this page', kind: 'sections' }` and `{ title: 'Linked from', kind: 'linkedFrom' }`.

**`asideLink` inputs.** On this page: `{ title: section.title, depth: section.level - least }`, where `least` is the smallest `level` in `shownSections`, and the root's `title` (the tooltip) is `section.title`. Linked from: `{ title: row.title, depth: 0 }`, and the root's `title` is `paths.tilde(row.path, homeDir)`. Add to the tests: `asideLink_OnThisPage_RootTitleIsTheSectionTitle`, which reads the drawn root's `title` for a doc with `## A`.

**Clicks.** `draw` returns the part's element. The view calls `rowAction(drawn.element, action)` from `src/shared/page/ui/row.ts`, as `tree-view.ts` does for its rows.

- On this page: `scrollToLine(section.startLine, shown.bodyStartLine)`.
- Linked from: `deps.followFile(row.path, row.line, null)`. This selects the row and opens the doc at the line, as a link does.

**Read-only docs.** The column stays, since it only reads. Task 09 draws no edit control on them.

**Whole-file editor.** `pane` has `is-editing`, and task 05's CSS hides `.docs-aside`. `dropEditor` removes the class, so the column returns.

**Scroll and redraw.**

- `reread` and `closeEditor` already save and set `pane.scrollTop` around `drawBody`. Keep this.
- `redraw` calls `keepingFocusAndScroll(root, [pane, aside], redrawParts)`.
- `redrawParts` adds `drawFrame()` in the `editor === null` branch, right after `drawPane()`, since the frame holds the editor while it is open.
- `dropEditor`'s deferred branch runs `drawPane()`, then `drawFrame()`.
- `redrawParts` calls `drawAside` while `aside.hidden` is false, with or without an editor.
- `dispose` disposes the frame and the aside parts.

**Comments.** Update the block comment above `DocView` so it names the frame and the right column.

GIVEN a markdown doc with headings and a doc that links to it WHEN it opens with entries set THEN both sections show, On this page first.
GIVEN a doc with no headings and no doc linking to it WHEN it opens THEN `aside.hidden` is true and the article takes the width.
GIVEN a scrolled doc WHEN the file changes on disk and reloads THEN `pane.scrollTop` and `aside.scrollTop` keep their values and On this page shows the new headings.

Tests, in `doc-view.test.ts`. Each records `asideHeading` and `asideLink` inputs through a user layout, with `withUser`.

- `open_DocKind_DrawsTheAsideSectionsItHas`: `it.each`, each row a path, text, detail and linked rows, with literal results:

| Path | Text | Detail | Linked rows | Headings drawn | Aside hidden |
|---|---|---|---|---|---|
| `/home/a.md` | `# A\n## B` | none | 1 | `On this page`, `Linked from` | false |
| `/home/a.md` | `plain` | none | 1 | `Linked from` | false |
| `/home/a.md` | `# A` | none | 0 | `On this page` | false |
| `/home/a.md` | `plain` | none | 0 | none | true |
| `/home/a.json` | `{}` | none | 1 | none | true |
| `/home/a.md` | `# A` | `hookDetail` | 1 | none | true |

- `open_ReadOnlyDoc_KeepsTheAside`: `readOnly` set; `aside.hidden` is false.
- `asideLink_NestedHeadings_IndentsFromTheLeastLevel`: text `## A\n### B`; depths `[0, 1]`.
- `clickOnThisPage_ScrollsToTheHeadingsBlock`: add `sourceBlock` elements; click the second link; `pane.scrollTop` is that block's top.
- `clickLinkedFrom_FollowsToTheLinkingLine`: `followFile` hears `(row.path, row.line, null)`.
- `setEntries_DocOpen_DrawsLinkedFromAgain`: open with none, then `setEntries` with a linking entry; `Linked from` draws, and `pane.scrollTop` keeps its value.
- `diskChanged_DocScrolled_KeepsBothScrollsAndShowsNewHeadings`: `reread` through `view.diskChanged` with a new `readDoc` reply.
- `redraw_NewFrameLayout_KeepsScrollAndFocus`: a layout with its own `pageFrame`, in the pattern of `redraw_NoEditor_KeepsThePaneScrollAndFocus`.
- `redraw_EditorOpen_DrawsTheFrameOnClose`: in the pattern of `redraw_EditorOpen_KeepsTheEditorAndRedrawsTheFrameOnClose`.

Live run, through the project's `drive` skill. A layout's look earns a run, not a test:

1. Open a doc with headings in Docs mode at a wide window. The title comes first, then the path and chips. The right column shows On this page and stays in sight while the article scrolls. A click on a row scrolls to the heading.
2. Narrow the window until `.docs-doc` is under 920px. The column goes, and the article's width does not shrink before it goes. If `.docs-body` is narrower than its `max-width` at 920px, raise the value in `layout.css` to that width plus 264px, and report it.
3. Open a session's Docs tab. The column is folded in the narrow split.
4. Press `i`. The whole-file editor fills the height with no column. `:q` brings the column back.
5. Capture one screenshot at each of steps 1 and 3. Linked from is not wired yet; task 09's live run checks it.

Done when: `npm run lint` passes; `npm test` runs the tests above and passes; the live run passes.
Commit:    one commit for the group

## Proof

