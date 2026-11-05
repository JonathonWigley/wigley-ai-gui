# 10 — Section links and history

Status: not started
Type: Task
Wave: 6 · Depends on: 03, 09
Plan: [plan.md](plan.md)

Files:     create `src/plugins/docs/page/section-links.ts` · test `src/plugins/docs/page/section-links.test.ts` · modify `src/plugins/docs/page/doc-view.ts` · test `src/plugins/docs/page/doc-view.test.ts` · modify `src/plugins/docs/page/docs-view.ts` · modify `src/plugins/docs/page/start.ts` · modify `src/plugins/docs/manifest.ts` · modify `src/plugins/keymap.ts` · modify `src/plugins/docs/layouts/default/layout.js` · modify `src/plugins/docs/layouts/default/layout.css` · modify `docs/keymap.md`

Change in `docs-view.ts`, exactly:

- `DocsViewCommands` gains `historyBack(): void`, `historyForward(): void`.
- `commands` gains `historyBack: () => doc.historyBack()`, `historyForward: () => doc.historyForward()`.
- A private `openListed(path, line, fragment, options?: { isHistoryMove?: boolean })` takes `followFile`'s body and passes `options` to `doc.open`. `followFile` calls it with no options.
- `createDocView`'s deps gain `followPlace: (path, line) => openListed(path, line, null, { isHistoryMove: true })`.

Change in `start.ts`, exactly: `commands` gains `historyBack: onActiveView('historyBack')`, `historyForward: onActiveView('historyForward')`.

The markdown adapter (`src/renderer/markdown-it/markdown-it-renderer.ts`) stays unchanged. Blocks already hold `data-source-line`, and the match reads rendered text, so it needs nothing new.

Consumes:  `createDocHistory(): DocHistory`, `DocHistory` with `canBack(): boolean` and `canForward(): boolean`, `DocPlace` ← 03
           `IndexEntry.links`, `IndexLink` ← 02
           `DocView.setEntries(entries: readonly IndexEntry[]): void` ← 07
           `closeEditor(doc, after?: () => void)`, the private member in `doc-view.ts` ← 09

Produces:

- In `src/plugins/docs/page/section-links.ts`:
  - `matchText(raw: string): string`
  - `findRaw(runs: readonly string[], raw: string, fromIndex: number): RawMatch | null`
  - `RawMatch { start: RunPoint; end: RunPoint; nextIndex: number }`, `RunPoint { run: number; offset: number }`
  - `linksByBlock(links: readonly IndexLink[], blockLines: readonly number[], bodyStartLine: number): Map<number, IndexLink[]>`
  - `linkSections(body: HTMLElement, links: readonly IndexLink[], bodyStartLine: number, titleOf: (link: IndexLink) => string): void`
- In `src/plugins/docs/page/doc-view.ts`:
  - `DocView.open(target: DocTarget, options?: { isHistoryMove?: boolean }): Promise<boolean>`
  - `DocView.historyBack(): void`, `DocView.historyForward(): void`
  - `DocViewDeps.followPlace(path: string, line: number | null): void`
- Commands `docs.historyBack`, `docs.historyForward`.

Decisions:

## Section links

**Where the post-process runs.** In `drawBody`, in this order: `bodyMount.draw`, then `applySectionLinks()`, then task 07's `drawAside`, then task 09's `drawSectionControls`, then `drawBodyPart`. So a control's `edit` text is not in the text the match reads.

**Which links.** `applySectionLinks` uses the file entry's links: the first of `entries` with `paths.samePath(entry.path, shown.target.path)` and `entry.line === null`. A follow-up item's entry holds `[]` and its file's entry holds the links, so the view looks up by path and not by `target.entryId`. It runs only for a `.md` file with no `target.detail`, and takes only `form: 'section'`. A `form: 'markdown'` link already renders as `a.md-link`. It keeps the JSON of the links it applied, in `appliedLinks`.

**Line narrowing.** `linksByBlock` takes the `data-source-line` of every block in `body.querySelectorAll('[data-source-line]')`, in document order. For a link, the body line is `link.line - bodyStartLine + 1`. A body line under 1 is in the frontmatter, and the link is left out. Its block is the last block in document order whose line is at or before the body line. A link with no such block (its line is before the first block's line) is left out, like frontmatter. The map's key is the 0-based index into `blockLines`. This is the same rule as `scrollToLine`. A multi-line paragraph holds all its lines, since the next block starts after them. Links keep the index's order within a block.

**The block's text runs.** The DOM walk collects the block's own text nodes, in order, as `runs`. It does not enter an element that:

- holds its own `data-source-line` (it is its own block);
- is a `pre`, a `.md-fence` or a `.md-image` (code shows as written);
- is an `a` (no link nests in a link).

An inline `code` element is walked. This is how a `raw` with backticks spans nodes.

**The match.** Markdown renders `` `AGENTS.md` § Intent `` as `<code>AGENTS.md</code> § Intent`, so the match works on rendered text with backticks removed, and needs no parser:

- `matchText(raw)` removes every backtick and `*`, turns a line break with its lead (`/\n[ \t>]*/`) into one space, turns each other whitespace run into one space, and trims. The marks go because task 01's `raw` keeps them and rendering drops them. The lead goes because task 01's `raw` keeps a wrapped reference's real line break and lead.
- `findRaw` joins `runs` with the same `*` and whitespace rules, and keeps a map from each joined character to its `RunPoint`. It runs `indexOf(matchText(raw), fromIndex)`. `end` is exclusive. `nextIndex` is the joined index after the match, so two equal references in one block take the first and then the second.
- `end` is in the run that holds the match's last character, at the offset after it. It is never offset 0 of the next run: that point does not exist at the end of a block, and its `splitText(0)` leaves an empty node.
- It is an exact match. A `raw` with `\_` or another mark that renders otherwise finds nothing.

**What stays text.** No block, no match, or a match that the wrap cannot enclose: the text stays plain, with no toast and no log. No link is a guess (`../design.md` § Links). This also covers a body edited since the last index build, whose lines or text no longer agree. The link returns at the next build.

**The wrap.** `linkSections` wraps one match:

0. Order. `linkSections` collects `runs` once per block, and runs `findRaw` for every link of the block first. A link with no match leaves `fromIndex` where it was. It then wraps the matches last-match-first, so the `RunPoint`s of the earlier matches stay valid, since a wrap only splits the nodes at or after its own start. A match whose points no longer fit (a run index out of range, or a node no longer in the block) stays text.
1. `splitText` at `end`, then at `start`, so `first` and `last` are whole text nodes.
2. Lift `first`: while its parent is not the block, `first` is the parent's first child, and the parent does not hold `last`, `first` becomes the parent. Lift `last` the same way, by last child.
3. If `first.parentNode !== last.parentNode`, stop and call `normalize()` on the parents: the text stays plain. This is a match that begins or ends inside an inline element.
4. Else make the anchor, insert it before `first`, and move `first` through `last` into it.

So `<code>AGENTS.md</code> § Intent` becomes `<a …><code>AGENTS.md</code> § Intent</a>`, and the prose after it stays outside.

**The anchor.** An `a` element, built as the renderer builds a link: `class="md-link"`, `href="#"`, and `title` from `titleOf(link)`: `paths.tilde(link.target, homeDir)`, then `:<targetLine>` when it is not null. It holds `data-doc-path` (`link.target`), and `data-doc-line` (`String(link.targetLine)`, absent when null). So `body`'s click listener and Tab reach it, as every other `a.md-link`.

**`followLink`.** After `closest('a.md-link')` and `preventDefault`: when `anchor.dataset.docPath` is set, the target is `{ type: 'file', path: docPath, line: Number(docLine) or null, fragment: null }`, and `resolveLink` does not run. Any other anchor reads `data-href` as today. Then the `switch` handles both.

**`followFile` opens path and line.** `case 'file'`, with a path other than the shown doc's: `deps.followFile(target.path, target.line, target.fragment)`, as today. In `docs-view.ts` this checks `isListed`, toasts `Not an indexed doc: <path>` when it fails, finds the entry, opens through `targetFor`, and selects the tree row. `view.open` then runs `scrollToLine`.

**A same-file link scrolls.** `case 'file'` with `paths.samePath(target.path, shown.target.path)`, and `case 'heading'`, do not reopen the doc. Reopening would read the file again and close an open editor. A private `moveWithinDoc(line, fragment)` does this:

1. Finds the target first. `fragment` set and `scrollToHeading` finds no heading: `toastMissingHeading`, and return. Nothing is recorded, since `scrollTop` has not moved.
2. Records the place being left (see History). Its line comes from `shownSourceBlocks()`.
3. `line` set: `scrollToLine(line, shown.bodyStartLine)`, else `pane.scrollTop = 0`.
4. Scrolls to the heading, when `fragment` is set.
5. Records the new place.

A section editor stays open through this, since the scroll changes no text. Task 07's On this page click also goes through `moveWithinDoc(section.startLine, null)`.

**Visible blocks.** While a section edits, the blocks that task 09 hid have a zero rect, and `topVisibleLine` would count them as above the pane. One private helper `shownSourceBlocks()` returns `sourceBlocks(body, pane)` without each block that a member of `editingSection.hidden` holds or is. `scrollToLine` (task 09), the place-left read in `view.open` and `moveWithinDoc`, and `e`'s `topVisibleLine` all use it.

**A later index build.** `setEntries` compares the file entry's links, as JSON, with `appliedLinks`. They differ, with `shown` a markdown doc and `editor` null: it renders `shown.text` again through `renderText` and `drawBody`, and sets back `pane.scrollTop`, with the same guards as `reread`. With an editor open it does nothing, since `closeEditor` renders. So links show once the index arrives, on a doc opened before it.

## History

**Owner.** Each `DocView` holds one `createDocHistory()`, and each docs view has one `DocView`. So each docs view has its own history, per `../design.md` § Keys. The view holds it because every doc open passes through `view.open`, and same-file moves do not leave the view.

**Pushes.** Each record is `history.push(place)`. Task 03's `push` changes nothing when `place` equals the current entry, so a repeat costs nothing and keeps the forward entries.

- `view.open`, on success and without `isHistoryMove`:
  - After the `count !== openCount` check, and before `shown` changes: record the place being left, when `shown` is set, `editor` is null and `detail` is null. Its line is null at `pane.scrollTop === 0`, else `topVisibleLine(shownSourceBlocks(), pane.scrollTop, shown.bodyStartLine)`.
  - After the scroll: record `{ path: target.path, line }`. `line` is `target.line`, else the whole-file line of the `target.fragment` heading's `data-source-line`, else null.
- `moveWithinDoc`, as above.
- So a tree leaf, a link, a Linked from row, an `openDoc` and `docs.openMain` (task 11, which opens `Main.md` through `doc.open`) each push, with no code in those callers.

`Ctrl+o` and `Ctrl+i` push nothing, since `isHistoryMove` skips both records. A record of the place left would drop the forward entries. Recording the place left means a move back returns to where the user read, not to the place's first line.

**`historyBack` and `historyForward`**, one private `moveInHistory(step)`:

1. `view.refuseWithUnsavedEdits()` true: stop. The history's cursor does not move, so the press loses nothing. The chords fire inside a box, so this runs with focus in the editor.
2. `place = history.back()` or `history.forward()`. Null: log `no earlier place` or `no later place`, and stop.
3. `shown` holds the same path: with an open, clean editor, `closeEditor(shown, () => scrollTo(place))`; else `scrollTo(place)`. `scrollTo` is `scrollToLine(place.line, shown.bodyStartLine)`, or `pane.scrollTop = 0` for a null line.
4. Another path: `deps.followPlace(place.path, place.line)`. `view.open` closes a clean editor, as it does for any open.

**Where the doc is gone.** `openListed` toasts `Not an indexed doc: <path>`, or `view.open` toasts `Could not open <path>: …`, as both do today. The shown doc stays. The cursor stays on the gone place, since `DocHistory` holds no removal. So the next press moves past it.

**Limits, settled.** `DocPlace` holds a path and a line. So a hook or plugin detail view reached by history reopens through `openListed`'s entry lookup, which takes the first entry with that path. A move of a file does not rewrite the history's paths; the old path is a gone doc.

**Commands**, in `manifest.ts`, `group: 'doc'`, `runsIn: 'page'`: `historyBack` label `go back`, `historyForward` label `go forward`.

**Binds**, in `keymap.ts`, beside task 09's, in scope `docs.doc`:

| Keys | Command |
|---|---|
| `<C-o>` | `docs.historyBack` |
| `<C-i>` | `docs.historyForward` |

Give no `where`. So the chords take the page, and fire inside a box too. In the doc editor they do not reach vim, by design, per `docs/keymap.md` § Layers.

**Anchors.** Neither key is one of vim's own, so each needs one, per `AGENTS.md` § Architecture. `default`'s `docPane` draws them in `div.docs-doc-top`, after the `‹ tree` edge, in a new `div.docs-history`:

- `kit.edge(history, 'historyBack', { side: 'start', label: 'back' })`
- `kit.edge(history, 'historyForward', { side: 'end', label: 'forward' })`

`layout.css`: `.docs-doc-top { display: flex; align-items: baseline }`, `.docs-history { display: flex; gap: var(--wg-space-3); margin-inline-start: auto }`. The existing `[data-doc='none'] .docs-doc-top` rule hides the row with no doc. The pair does not add `docs-edge--start`, so `.is-tree-hidden` does not hide it.

**The pair hides at the history's ends.** `DESIGN.md` § Keys and focus says a pair hides when there is nothing to move to. A private `showHistoryEdges()` sets `data-history-back` and `data-history-forward` (`'true'` or `'false'`) on the element that holds `data-doc`, from `history.canBack()` and `history.canForward()`. It runs after every record, every move in `moveInHistory`, and every `view.open`. `layout.css`: `[data-history-back='false'] .docs-history > :first-child, [data-history-forward='false'] .docs-history > :last-child { display: none }`. The row keeps its place, since `.docs-history` holds `margin-inline-start: auto`.

**`docs/keymap.md`.** In § Layers, under Ctrl+hjkl, add one line: `Ctrl+o`/`Ctrl+i` go back and forward through the docs view's places, as vim's jump list does.

GIVEN a paragraph `` see `AGENTS.md` § Intent for more `` and an IndexLink with that `raw` on its line WHEN the doc draws THEN `AGENTS.md § Intent` is one `a.md-link` whose click opens the target at `targetLine`, and `for more` is outside it.
GIVEN a `§ Intent` link with no match in its block WHEN the doc draws THEN the text stays plain and nothing logs.
GIVEN a link to a heading in the same file WHEN it is clicked with a section editor open THEN the pane scrolls and the editor stays.
GIVEN doc A scrolled to line 200 and a link to B WHEN `Ctrl+o` fires THEN A shows at line 200, and `Ctrl+i` then shows B.
GIVEN a doc with no earlier place WHEN it shows THEN the back edge is hidden, and the forward edge shows after a move back.
GIVEN unsaved edits WHEN `Ctrl+o` fires THEN the toast shows `UNSAVED_TEXT` and a later `Ctrl+o`, after `:w`, goes to the same place.

Tests. `section-links.test.ts` covers the pure functions. The fake DOM holds no text nodes or `splitText`, so `linkSections`' walk and wrap are checked in the live run and in task 12's self-test group.

- `matchText`: `it.each`: `` `AGENTS.md` § Intent `` → `AGENTS.md § Intent`; `` `wigley:make` § Run log › Groups `` → `wigley:make § Run log › Groups`; `§ The  \n key` → `§ The key`; `§ The **bold** part` → `§ The bold part`; `` `a.md`\n> § B `` → `a.md § B`.
- `findRaw`: `it.each`, each row runs, raw, from, expected points and `nextIndex`, with literal values: one run; a match that ends on a run boundary: runs `['see ', 'AGENTS.md', ' tail']`, raw `` `AGENTS.md` ``, start `{ run: 1, offset: 0 }`, end `{ run: 1, offset: 9 }`; a raw across `['see ', 'AGENTS.md', ' § Intent for more']` → start `{ run: 1, offset: 0 }`, end `{ run: 2, offset: 9 }`; a wrap as `['a.md\n§ B']` with raw `` `a.md` § B ``; no match → null; two equal references, the second found from the first's `nextIndex`.
- `linksByBlock`: `blockLines [1, 3, 8]`, `bodyStartLine 4`: file line 7 (body line 4) → block 1; file line 12 → block 2; file line 2 (frontmatter) → left out; a `form: 'markdown'` link → left out.

`doc-view.test.ts`:

- `followLink_DataDocPath_FollowsItsPathAndLine`: a fake `a.md-link` with `dataset.docPath` and `dataset.docLine` `'12'`; `followFile` hears `(path, 12, null)`. A second row with no line hears `null`.
- `followLink_SamePathLink_ScrollsAndReadsNothing`: no second `readDoc`; `pane.scrollTop` is the block's top; a section editor stays.
- `setEntries_LinksChanged_RendersTheBodyAgainKeepingScroll` and `setEntries_LinksSame_RendersNothing`: count `markdown.document` calls.
- `history_BackAndForward_ReturnToTheReadPlace`: open A, scroll to a block, open B, `historyBack`: `followPlace` hears `(A, <that line>)`. Then the fake open with `isHistoryMove`, and `historyForward`: `followPlace` hears `(B, null)`.
- `history_HistoryMove_PushesNothing`: after back and open with `isHistoryMove`, `historyBack` again reaches the older place, not B.
- `history_SameFilePlace_ScrollsWithNoFollowPlace`: `followPlace` is not called.
- `history_UnsavedEdits_RefusesAndKeepsTheCursor`: toast `UNSAVED_TEXT`; `:w`; `historyBack` reaches the place the first press would have.
- `history_CleanEditor_ClosesItAndMoves`: `it.each` over same path and other path.
- `history_Edges_HideAtTheEnds`: `it.each`: one place → both attributes `'false'`; two places at the end → back `'true'`, forward `'false'`; after `historyBack` → forward `'true'`.
- `moveWithinDoc_SectionEditorOpen_RecordsTheVisibleLine`: a section editor with hidden blocks open; a same-file link; `historyBack` returns the line that was visible.
- `moveWithinDoc_MissingHeading_RecordsNothing`: a fragment with no heading; toast; a later `historyBack` reaches the earlier place, not a repeat of the current one.
- `history_AtTheEnds_MovesNothing`: `it.each` over back on the first place and forward on the last; `followPlace` is not called.
- `open_RefusedOrFailed_RecordsNoPlace`: a read that rejects; `historyBack` does not reach the failed path.

Live run, through the project's `drive` skill, over a seeded doc whose body holds each form:

1. `` `decisions.md` § Asking ``, `wigley:make § Run log`, a bare `§ <heading>` of the same file, and a `` `file.md` § Section `` split across a line wrap each render as one link. A bare `` `AGENTS.md` `` stays text. Prose after each link stays outside it.
2. Tab reaches a § link. A click on a `wigley:make § Run log` link opens the skill at that heading, which proves the index's `target` agrees with `isListed`.
3. A click on the bare § link scrolls in place, with no reload.
4. Follow a link, then `Ctrl+o`: the first doc shows at the place left. `Ctrl+i` returns. The `‹ ⌃O back` and `⌃I forward ›` edges show in the top row.
5. Rename the target doc, then `Ctrl+o` onto it: the toast shows, the doc shown stays, and a second `Ctrl+o` moves past it.

`linkSections` with two links in one block is also checked in task 12's self-test (two `§` references in one paragraph, both wrapped). Ask task 12 to add a self-test step for one § link with backticks and its click, since Vitest cannot reach the DOM wrap.

Done when: `npm run lint` passes; `npm test` runs the tests above and passes; the live run passes.
Commit:    one commit for the group

## Proof

