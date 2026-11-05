# 09 — Section editing

Status: not started
Type: Task
Wave: 5 · Depends on: 03, 07, 08
Plan: [plan.md](plan.md)

Files:     create `src/plugins/docs/page/section-edit.ts` · test `src/plugins/docs/page/section-edit.test.ts` · modify `src/plugins/docs/page/doc-view.ts` · test `src/plugins/docs/page/doc-view.test.ts` · modify `src/plugins/docs/page/docs-view.ts` · modify `src/plugins/docs/page/start.ts` · modify `src/plugins/docs/manifest.ts` · modify `src/plugins/keymap.ts` · modify `src/plugins/docs/layouts/layout.d.ts` · modify `src/plugins/docs/layouts/default/layout.js` · modify `src/plugins/docs/layouts/default/layout.css` · modify `src/plugins/docs/page/docs.css` · modify `docs/keymap.md`

Change in `docs-view.ts`, exactly:

- `DocsViewCommands` gains `editSection(): void`, `prevSection(): void`, `nextSection(): void`.
- `commands` gains `editSection: () => doc.editSection()`, `prevSection: () => doc.moveSection(-1)`, `nextSection: () => doc.moveSection(1)`.
- `showDocument` calls `doc.setEntries(next?.entries ?? [])` before `doc.refreshChips()`. This is the wiring task 07 left.

Change in `start.ts`, exactly: `commands` gains `editSection: onActiveView('editSection')`, `prevSection: onActiveView('prevSection')`, `nextSection: onActiveView('nextSection')`.

Consumes:  `sectionsOf(text: string): DocSection[]`, `spliceSection(text: string, section: DocSection, next: string): string`, `sectionAt(sections: readonly DocSection[], line: number): DocSection | null`, `sectionText(text: string, section: DocSection): string`, `DocSection` ← 03
           `DocView.setEntries(entries: readonly IndexEntry[]): void`, `shownSections` ← 07
           part `sectionEditControl`, `SectionEditControlKit.openSection()`, and `asideHeading`'s `prevSection` and `nextSection` edges ← 05

Produces:

- In `src/plugins/docs/page/section-edit.ts`:
  - `hiddenBlockFlags(lines: readonly (number | null)[], section: DocSection, bodyStartLine: number): boolean[]`
  - `relocateSection(fromText: string, startLine: number, toText: string): DocSection | null`
  - `sectionMoveTarget(headings: readonly { startLine: number; top: number }[], scrollTop: number, direction: 1 | -1, heldLine: number | null): number | null`
- In `src/plugins/docs/page/doc-view.ts`: `DocView.editSection(): void`, `DocView.moveSection(direction: 1 | -1): void`, private `closeEditor(doc: ShownDoc, after?: () => void): void`, private `refuseReadOnly(doc: ShownDoc): boolean`. Tasks 10 and 11 call `closeEditor`.
- In `src/plugins/docs/layouts/layout.d.ts`: `DocHeaderKit.sectionHint(parent: HTMLElement): HTMLElement`.
- Commands `docs.editSection`, `docs.prevSection`, `docs.nextSection`.

Decisions:

**Commands**, in `manifest.ts`, `group: 'doc'`, `runsIn: 'page'`:

| Command | Label |
|---|---|
| `editSection` | `edit this section` |
| `prevSection` | `previous section` |
| `nextSection` | `next section` |

**Binds**, in `keymap.ts`, beside `docs.edit`, in scope `docs.doc`:

| Keys | Command |
|---|---|
| `e` | `docs.editSection` |
| `<C-h>` | `docs.prevSection` |
| `<C-l>` | `docs.nextSection` |

Give no `where`. So `e` fires on the page only, and vim takes it inside a box. The chords take the page, and they fire inside a box too (`docs/keymap.md` § Where keys live), so they do not reach vim in the doc editor, by design.

**Anchors.** None of the three keys is one of vim's own keys (`src/plugins/keys/page/vim-keys.ts`), so each needs an anchor, per `AGENTS.md` § Architecture, "Every other bind has an anchor".

- `<C-h>` and `<C-l>`: the two `kit.edge` calls in the `asideHeading` part, `kind: 'sections'`, from task 05. They fill in once the commands exist.
- `e`: a new app element `sectionHint` (`element('span')`) in `doc-view.ts`, beside `editHint`. It lives for the view's life: `anchors.push(deps.anchor(sectionHint, 'editSection', { scope: 'doc', label: 'section' }))`. `DocHeaderKit.sectionHint` places it, in the pattern of `editHint`. `default`'s `docHeader` calls `kit.sectionHint(header)` just before `kit.editHint(header)`.
- `.docs-header`'s `grid-template-columns` in `layout.css` takes a third track for it: `minmax(0, 1fr) auto auto`. So both hints sit on the title's line.
- `showEditHint` also sets `sectionHint.hidden`: true when `editHint.hidden` is true, or when `shownSections` is empty.
- `drawHeader` runs before `drawBody`, and only `drawAside` (task 07) sets `shownSections`. So `drawBody` ends with one more `showEditHint()` call, after `drawAside` and `drawSectionControls`. The hint then reads the sections of the doc just drawn.

**State.** A new `let editingSection: EditingSection | null = null` in `doc-view.ts`:

```ts
interface EditingSection {
  // `endLine` counts the lines of the text last read or written, not the file's headings: the editor's text may hold
  // a new heading, and the next `:w` must replace all of it.
  section: DocSection;
  // The section's text as last read or written.
  savedText: string;
  // The direct children of the body hidden for this edit.
  hidden: HTMLElement[];
}
```

**Which section `e` opens.** `view.editSection()` runs these checks, in order:

1. `shown` is null: nothing.
2. `readOnly` is set: the same toast and log as `edit`. Extract the refusal from `view.edit` into `refuseReadOnly(doc): boolean`, and both call it. The toast text is `readOnlyText(readOnly)`, tone `info`.
3. `editor` is open, whole-file or section: `editor.focus()`, and nothing more.
4. `target.detail` is set, or `filePath` does not end in `.md`: toast `Only a markdown doc has sections`, tone `info`.
5. The line: `heldSection`'s line while it holds (see Moving), else `topVisibleLine(sourceBlocks(body, pane), pane.scrollTop, doc.bodyStartLine)`. The section: `sectionAt(shownSections, line)`.
6. The section is null: `view.edit()`, which opens the whole-file editor, as `i` does. This covers a doc with no headings, and text above the first heading, per task 03's decision. Such text has no section of its own, and `e` always opens an editor.
7. Otherwise: `openSectionEditor(doc, section, line - section.startLine + 1)`.

`sectionAt` gives the last section whose `startLine` is at or before `line`, so a line under `### B` gives `### B`, not its parent `## A`. A file's first `#` heading is task 03's lead section, so `e` at the very top of such a doc opens the title and intro only.

**Which blocks hide.** `openSectionEditor` reads `[...body.children]`. For each child, it reads `data-source-line` as a number, or null when absent. It calls `hiddenBlockFlags(lines, section, doc.bodyStartLine)`. The rule:

- A child's whole-file start is `line + bodyStartLine - 1`.
- Its range runs to the line before the next child that has a line. The last child's range has no end.
- A child with no line takes the flag of the child before it, or false when it is first.
- A child hides when its range overlaps `section.startLine..section.endLine`.

Overlap means a section whose heading sits inside `:::details` or a list hides the whole outer block. The text stays safe, since the file text never comes from the DOM. The view sets `hidden = true` on each flagged child and keeps them in `EditingSection.hidden`. A live fence stays in place, since `markdown-mount` keeps the placeholder that holds `data-source-line`.

**Where the editor box mounts.**

- Before the first hidden child: `body.insertBefore(bannerSlot, first)`, `body.insertBefore(promptSlot, first)`, `body.insertBefore(editorSlot, first)`.
- The banner and prompt move too, since the pane scrolls in this mode and they would sit out of sight at the article's top.
- On close, `dropEditor` puts them back in the article: `article.insertBefore(bannerSlot, bodySlot)`, `article.insertBefore(promptSlot, bodySlot)`, `article.append(editorSlot)`.
- The pane does not take `is-editing`, and `drawnBody.element.hidden` stays false. `drawBodyPart`'s line becomes `drawnBody.element.hidden = editor !== null && editingSection === null`.
- `data-doc` stays `editing`.
- `scrollTopBeforeEdit = pane.scrollTop` before the hide. Once the frame draws, `pane.scrollTop = topIn(pane, drawnEditorFrame.element)`.
- The editor opens with `createDocument(editorBox, sectionText(doc.text, section), { fileName: doc.name, readOnly: false, line }, editorEvents)`. So `doc.name` still picks the language.

**Editor height.** `createDocument` takes its parent's full height, so the box needs one. `editorBox.classList.add('is-section')`, and `editorBox.style.setProperty('--docs-section-rows', String(lineCount(text)))`, set at open and in `changed`. `docs.css` adds:

```css
.docs-editor.is-section {
  flex: none;
  height: min(
    60vh,
    calc((var(--docs-section-rows) + 2) * var(--wg-text-prose) * var(--wg-leading-prose))
  );
}
```

The `+ 2` leaves room for the mode line. A longer section scrolls inside the box. `dropEditor` removes the class and the property.

**`sectionText` and `spliceSection`.** Task 03 pins these as inverses for a file with one kind of line ending. So a section's trailing blank lines show in the editor and write back unchanged. The editor holds `\n` text, and `spliceSection` writes the file's line ending. A section that holds only its heading opens with that one line and its blank lines. It takes no special path. Only the heading's block hides.

**`writeEditor`.** In section mode:

- `const next = writing.text()`, `const text = spliceSection(doc.text, editingSection.section, next)`.
- `writingText = text`. `writeDoc(doc.filePath, text, overwrite ? null : doc.text)` as today.
- On `written`: `doc.text = text`; `editingSection.savedText = next`; `editingSection.section.endLine = section.startLine + lineCount(next) - 1`. `lineCount(text)` is `text.split('\n').length`: a text that ends in `\n` counts its last empty line, since `spliceSection` writes that line. `scanLines` would count one line less, and the next `:w` would leave one old line in the file. `--docs-section-rows` uses `lineCount` too. The toast and log stay as they are.
- The rest of the page stays as it was rendered until the editor closes, since drawing the body would destroy the editor. `after === 'close'` renders it through `closeEditor`.

**`hasUnsavedEdits`.** One private `hasUnsaved()`: `editor !== null && shown !== null && editor.text() !== (editingSection?.savedText ?? shown.text)`. `quitEditor` and `view.hasUnsavedEdits` both call it. `refuseWithUnsavedEdits` and `open` follow.

**`:q`, `:wq`, `:q!`, Esc.** They use the same events and the same `docs.quitEditor` bind as the whole-file editor, with no new path. `:q` and Esc refuse with `UNSAVED_TEXT` while `hasUnsaved()`. `:q!` drops the edits and logs `dropped edits on <name>`. `:wq` writes and closes. `closeEditor` restores the scroll from when the editor opened and renders the body from `doc.text`. `dropEditor` sets `hidden = false` on each hidden child, since `clear()` renders nothing that replaces them.

**`closeEditor(doc, after?: () => void)`.** It gains an optional `after`, which runs in the `.then` after `drawBody`, inside the existing guard. A render failure logs and does not run it.

**Disk banner.** `reread` already calls `showBanner(true)` while `editor !== null`. There is no change, and the slot's move keeps it beside the editor. `:w` then takes the conflict flow, since the expected text is `doc.text`.

**Conflict.** `showConflict`, the prompt, `conflictCancel` and `closeConflict` stay as they are.

- `conflictOverwrite`: `writeEditor(true, held.after)`. So the file becomes `spliceSection(doc.text, section, editorText)`, and the disk's other changes are lost. This is what overwrite means in the whole-file flow.
- `conflictReload`, in section mode, replaces the file text, then closes and opens again, so the page and the editor both show the disk:
  1. `endConflict(false)`.
  2. `const moved = relocateSection(doc.text, section.startLine, held.diskText)`.
  3. `doc.text = held.diskText`. `showBanner(false)`. Log `reloaded <name>`.
  4. `moved` not null: `closeEditor(doc, () => openSectionEditor(doc, moved, 1))`.
  5. `moved` null: `closeEditor(doc)`, and toast `The section "<title>" is no longer in the file`, tone `info`.
- `relocateSection` finds the section at `startLine` in `sectionsOf(fromText)`, by its `title`, `level` and its count among earlier sections with both the same. It returns the section with the same three in `sectionsOf(toText)`, or null.

**`i` and `e` across modes.** With any editor open and focus on the page, both keys only focus the open editor. So `i` with a section editor open does not swap to the whole file, and `e` with a whole-file editor open does not swap to a section. No swap can lose edits. Inside the editor, both are vim's. With no editor open, `i` keeps opening the whole file (`../design.md` § Section editing).

**The `edit` control.** `drawSectionControls()` runs in `drawBody`, after task 07's `drawAside` sets `shownSections`, and before `drawBodyPart`. It disposes the old controls: it disposes each part and removes each slot span from its heading. `redrawParts` runs it without a body redraw, so a kept slot would stack. It draws none while `shown` is null, `readOnly` is set, `detail` is set, or the file is not markdown. For each child of `body` that has `data-anchor` and whose whole-file line equals a section's `startLine`, it:

1. Appends `element('span', 'docs-slot')` to the heading, and keeps `{ part, slot }` as a pair.
2. Calls `parts.draw('sectionEditControl', slot, { title: section.title }, (kit) => ({ ...kit, openSection: () => clickSection(anchor) }))`.

The control shows on heading hover and on `:focus-visible` of the button, so a keyboard user sees it after Tab. Task 05 owns that CSS rule. A heading inside another block gets no control. `redrawParts` draws the controls again. `dispose` disposes them.

**`clickSection(anchor)`.**

- No editor: finds the heading by `[data-anchor]`, reads its line, finds the section in `shownSections`, and calls `openSectionEditor(doc, section, 1)`.
- `hasUnsaved()`: `view.refuseWithUnsavedEdits()`, which toasts `UNSAVED_TEXT`. The open editor stays.
- Clean editor: `closeEditor(doc, () => …)`, and the `after` looks the anchor up in the new body and opens its section. An anchor that is gone logs `no heading #<anchor> to edit`. This one path also covers a clean editor after a `:w`, whose rendered lines are stale.

Read-only docs draw no control, so the refusal is `e`'s only.

**Drop target.** It registers on `pane` while the editor is open, as today. `takeFiles` inserts at the editor's cursor and links relative to `doc.filePath`. There is no change.

**Layout reload during a section edit.** `redrawParts` already leaves `drawPane` and task 07's `drawFrame` for later. It also skips `drawBodyPart` while `editingSection !== null`, since the body holds the editor, and sets `isBodyRedrawDeferred = true`. `dropEditor` then runs `drawBodyPart()` and clears the flag. The header, the aside and the controls draw at once. The controls' slots are in the body and move with it.

**Other doc-view reads.** While a section edits, `scrollToLine` leaves out each block that a member of `editingSection.hidden` holds or is (`hidden.some((child) => child.contains(block))`). So an On this page click on a hidden section lands on the block above the editor.

**Moving with `Ctrl+h` and `Ctrl+l`.** `view.moveSection(direction)`:

1. `shown` is null, or no section is shown: log `no section to move to`.
2. Any editor is open: log `not moved: the editor is open`, and do nothing more. The keys do not reach vim and do not close the editor.
3. `headings` is `shownSections`, in order, each with the `top` of its block from `sourceBlocks`. A section with no block is left out.
4. `heldLine` is `heldSection.line` while `pane.scrollTop === heldSection.scrollTop`, else null.
5. `sectionMoveTarget` returns the new `startLine`, or null. With `heldLine`: the neighbour of that heading. With none: for `1`, the first heading with `top > Math.round(scrollTop)`; for `-1`, the last heading with `top < Math.round(scrollTop)`.
6. Null: log `no next section` or `no previous section`. It does not wrap, and no toast shows.
7. Else: `pane.scrollTop = top`; `heldSection = { line, scrollTop: pane.scrollTop }`; log `section <title>`.

`heldSection` is needed since the last headings cannot reach the top of sight. Without it, `Ctrl+l` near the doc's end would stop at the first such heading for good, and `e` would open the wrong section. `drawBody` clears it.

**`docs/keymap.md`.** In § Layers, the `Ctrl+h`/`Ctrl+l` sentence's list of units gains `a doc's sections`. In the raw-keys bullet, the letters gain: `e` edits the doc's section at the top of sight.

**Comments.** Update the block comment above `DocView`, and the `DocBodyKit.body` and `EditorFrameKit.editor` comments in `layout.d.ts`: while a section edits, the app places the editor host and the banner and prompt slots inside the body, and the docBody part's root stays shown.

GIVEN a doc scrolled so `## B` is at the top of sight WHEN `e` is pressed THEN the editor shows `## B`'s text, and every other block stays rendered.
GIVEN a section editor with edits WHEN `:w` runs THEN `writeDoc` gets the whole file with that section replaced, and the expected text is the file text last read or written.
GIVEN `:w` wrote text that adds a heading WHEN `:w` runs again THEN the second write replaces all of the first's lines, and no text is doubled.
GIVEN a section editor with unsaved edits WHEN another section's `edit` is clicked THEN the toast shows `UNSAVED_TEXT` and the editor keeps its section.
GIVEN a conflict and a disk text without the section WHEN reload is chosen THEN the editor closes, the page shows the disk text and the toast names the section.
GIVEN `Ctrl+l` on the last section WHEN it fires THEN the scroll does not change.

Tests. `section-edit.test.ts`, one `describe` per function:

- `hiddenBlockFlags`, with section lines 5–8, `bodyStartLine` 3 (body line 3 is file line 5): `{lines: [1, 3, 5, 7], → [false, true, true, false]}`; `{[3, null, 7] → [true, true, false]}`; `{[null, 3] → [false, true]}`; an outer block that starts above the section: `{[1, 9], section lines 5–8 → [true, false]}`.
- `relocateSection`: the section moved down by inserted lines → its new lines; two sections with one title, the second asked → the second; the heading removed → null.
- `sectionMoveTarget`: `it.each` with headings at tops 0, 100, 200, and at scrollTop 150: `1 → third`; `-1 → second`. At scrollTop 100: `-1 → first`. At scrollTop 200: `1 → null`. At scrollTop 0: `-1 → null`. With `heldLine` on the second heading at a scrollTop that cannot reach it: `1 → third`; `-1 → first`.

`doc-view.test.ts`, extending `docViewOver` so its fake editor's text can change and `writeDoc` calls are recorded. Each uses `sourceBlock` children with `data-source-line`:

- `editSection_TopOfSightInASection_OpensThatSectionsText`: text `# T\n\n## A\nx\n\n## B\ny`, at `## B`'s block; the editor's text is `## B\ny`, and `line` is 1.
- `editSection_AboveTheFirstHeading_OpensTheWholeFile`: `it.each` over text above the first heading and a doc with no heading; the editor's text is the whole file, and `is-editing` is set.
- `editSection_Refuses_ToastsAndOpensNothing`: `it.each`: a `.json` doc and a `hookDetail` doc → `Only a markdown doc has sections`; read-only → `readOnlyText`.
- `editSection_EditorOpen_OnlyFocusesIt`: `it.each` over a whole-file and a section editor; no second editor is made. The same for `view.edit()` with a section editor.
- `openSection_HidesTheSectionsBlocksAndNotTheBody`: the blocks' `hidden` values; `drawnBody` is not hidden; `is-editing` is absent; `data-doc` is `editing`.
- `write_SectionEditor_WritesTheSplicedFileTwice`: a first `:w` whose text adds a heading, then a second; the two `writeDoc` calls, with literal text and expected text. Add a row whose first `next` ends in `\n` (`## A\na\n`): the second `:w` replaces all its lines, and no old line stays.
- `hasUnsavedEdits_SectionEditor_ComparesWithTheSectionsSavedText`: false at open, true after a change, false after `:w`.
- `quit_SectionEditor_ActsAsTheWholeFileEditor`: `it.each`: `quit(false)` with edits refuses with `UNSAVED_TEXT`; `quit(true)` closes; `writeQuit` closes after the write; the scroll returns to its value at open.
- `conflictReload_SectionStillThere_OpensItWithTheDiskText` and `conflictReload_SectionGone_ClosesAndToasts`.
- `conflictOverwrite_SectionEditor_WritesWithNoExpectedText`: expected text is null.
- `clickEdit_OtherSection_RefusesWithUnsavedEdits` and `clickEdit_OtherSection_SwitchesWhenClean`.
- `sectionControls_ReadOnlyOrDetail_DrawNone`: `it.each`.
- `sectionControls_Redraw_LeavesOneSlotPerHeading`: run `redrawParts` twice; each heading holds one `docs-slot` span.
- `sectionHint_OpenAfterOpen_FollowsTheDrawnDocsHeadings`: on a fresh view, open a doc with headings: `sectionHint.hidden` is false. Then open a doc with no heading: it is true.
- `moveSection_EditorOpen_ScrollsNothing` and `moveSection_AtTheLastHeading_StaysAndKeepsTheScroll`.
- `moveSection_ThenEdit_OpensTheHeldSection`: a heading that cannot reach the top; `e` opens it.
- `drop_SectionEditor_InsertsAtTheCursor`: a take through the recorded drop target adds a link through the fake editor's `insert`.

Live run, through the project's `drive` skill. A layout's look and the real editor's height earn a run:

1. Open a doc with `##` and `###` headings, wide window. Linked from shows for a doc another doc links to, which is this task's wiring of task 07.
2. Hover a heading: `edit` shows. Click it: the editor opens in place, with the rendered text above and below, and the right column stays.
3. The key hint `e section` and the `‹ ⌃H On this page ⌃L ›` edges show. `Ctrl+l` moves heading by heading to the end, and stops.
4. Type, `:w`, then change the file on disk: the banner shows just above the editor. `:w` shows the prompt there. `r` reloads, and the page and the editor show the disk text.
5. Esc with no edits closes the editor at the scroll from before it opened.
6. Three-line section: the editor shows no scroll bar. Capture one screenshot of the open editor.

Done when: `npm run lint` passes; `npm test` runs the tests above and passes; the live run passes.
Commit:    one commit for the group

## Proof

