# 08 — Docs editor drop target

Status: in progress
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/docs/page/doc-links.ts` · test `src/plugins/docs/page/doc-links.test.ts` ·
           modify `src/plugins/docs/page/doc-view.ts` · test `src/plugins/docs/page/doc-view.test.ts` ·
           modify `src/plugins/docs/page/docs-view.ts` · modify `src/plugins/docs/page/start.ts` ·
           modify `src/plugins/docs/contract.ts` · modify `src/plugins/docs/main/start.ts`
Consumes:  `DroppedFile`, `PageDrops` (`api.drops.addTarget`) ← 01/04 · `TextEditor.insert(text)` ← 03 (a
           `DocumentEditor` is a `TextEditor`) · `TextEditor.charBeforeCursor()` ← 03 ·
           `export function fileStamp(epochMs: number): string` (`src/shared/file-stamp.ts`) ← 01 ·
           `export function extensionOf(mediaType: string): string;` ← 02 · `writeBytes(path, bytes)` in docs main (`src/plugins/docs/main/doc-files.ts`, in the tree) · `Paths`
           (`commonFolder`, `segmentsBelow`, `parent`, `base`, `join`, in the tree)
Produces:  in `src/plugins/docs/page/doc-links.ts`:
           `export function docLinkOf(filePath: string, docPath: string, mediaType: string, paths: Paths): string`
           `export function docLinksText(links: readonly string[], charBefore: string): string`
           `export function pastedImagePath(docPath: string, mediaType: string, at: number, index: number, paths: Paths): string`
           in `src/plugins/docs/contract.ts`: `DocsChannel.invoke.writeBytes(path: string, bytes: Uint8Array): Promise<WriteResult>`
           in `src/plugins/docs/page/doc-view.ts`: `DocViewDeps.drops: Pick<PageDrops, 'addTarget'>` and
           `DocViewDeps.now(): number`; `DocsViewDeps.drops` in `docs-view.ts`
Decisions:
- The doc pane's scroller (`div.docs-doc`, `pane` in `createDocView`) is a target only while the document editor is
  open: `openEditor` registers it, `dropEditor` and `dispose` dispose it. A read-only doc never opens the editor, so it
  takes no drop. While the doc shows rendered, a drop on it reaches no target and the core toasts
  `NOTHING_TAKES_FILES` from `src/contracts/drops.ts` (the rendered view has no cursor to insert at; Decided, as the
  brief recommends). That toast is the core's (04): this task registers no target there and shows no toast itself. `clear()`, `closeEditor` and `open()` reach
  `dropEditor`; `dispose()` does not today, so this task adds the target's dispose to `dispose()`.
- The page cannot reach `writeBytes` today: it is a docs main export only ("which has no channel method",
  `contract.ts`). This task adds the channel method `writeBytes`, handled in `docs/main/start.ts` by the `writeBytes`
  closure already there (the guarded `docFiles.writeBytes`), and rewrites that contract comment's "except
  writeBytes" clause to: each export runs the same code as the channel method of its name, except `addSource`,
  which has none, and `watchDoc`, which takes a callback.
- `take(files)` binds the shown doc and editor at its start, and reads `deps.now()` once. Each file in order: a
  `path` links as it is; a pasted file (path `''`) is written to `pastedImagePath(doc.filePath, mediaType, now,
  index, paths)` through `channel.invoke('writeBytes', path, await file.bytes())`; a
  rejection toasts main's error text, tone `error`, logs, and leaves the rest. Then, while the same doc and editor are
  still open, one `editor.insert(docLinksText(links, editor.charBeforeCursor()))`; otherwise it logs and inserts
  nothing. `doc.filePath` is the file the editor edits (a detail view's edited file, not its target).
- **`index`** comes from a counter the doc view keeps across takes: it holds the last stamp (`fileStamp(now)`) and
  the next index; a take whose stamp differs resets the index to 0, and each pasted file takes the next index. So a
  second paste in the same second gets `-2` instead of overwriting the first's picture; a new second starts again at
  no suffix.
- `docLinkOf`: `![name](dest)` when `mediaType` starts with `image/`, else `[name](dest)`. The image form is kept for
  other markdown renderers (GitHub and others show the picture); this app's docs view shows no image — its renderer
  (`markdown-it-renderer.ts`, `rules.image`) draws `![alt](src)` as the alt text — so in the app a pasted picture
  reads as its file name. `name` is `paths.base(filePath)` with `\`, `[` and `]` backslash-escaped. `dest` is
  `filePath` relative to the doc's folder, written with `/` on both OSes: `common = paths.commonFolder([docPath,
  filePath])` (it takes each path's parent); `../` repeated `paths.segmentsBelow(paths.parent(docPath),
  common).length` times, then `paths.segmentsBelow(filePath, common)` joined by `/`; the full path when `common` is
  null (two Windows drives). Then `%`, `#` and `?` in `dest` are percent-encoded (`%25`, `%23`, `%3F`; `%` first),
  since `resolveLink` cuts the href at `#` and `?` before it URI-decodes the path. A `dest` holding a space, `(`,
  `)`, `<` or `>` is then wrapped in `<…>`, `<` and `>` inside backslash-escaped (CommonMark link destination;
  Decided: wrap rather than percent-encode those, so the source stays readable).
- `docLinksText`: the links joined by one space, with one space before the first when `charBefore` is neither `''`
  nor whitespace (design § What a file becomes).
- `pastedImagePath`: `<doc folder>/images/<doc name>-<fileStamp(at)>[-<index + 1>].<ext>`: `<doc name>` the doc's
  base name without its last extension (`guide.md` → `guide`); the stamp is 01's `fileStamp` of `at` (epoch ms), the
  one copy of the format main's pasted files use; `-<index + 1>` only
  for `index` above 0, so two files pasted at once get two names; `<ext>` is `extensionOf(mediaType)` ← 02
  (`src/shared/image-types.ts`). The `images/`
  folder is made by the write (`writeBytes` makes folders, `doc-files.test.ts` `writeBytes_InsideFeaturesRoot_WritesBytesAndFolders`).
- `docs-view.ts` passes `drops` and `now: deps.now` to `createDocView`; `start.ts` passes `drops: api.drops` to
  `createDocsView`.
GIVEN a doc open in the vim editor WHEN `/n/docs/images/a.png` is dropped on the doc pane THEN `![a.png](images/a.png)`
  goes in at the cursor, focus and mode unchanged
GIVEN the editor open on `/n/docs/guide.md` WHEN a screenshot is pasted at 2026-11-02 09:05:07 THEN
  `/n/docs/images/guide-20261102-090507.png` is written through docs main's guard and
  `![guide-20261102-090507.png](images/guide-20261102-090507.png)` goes in
GIVEN the guard refuses the write WHEN a screenshot is pasted THEN main's refusal toasts and nothing goes in
GIVEN a doc shown rendered WHEN a file is dropped on it THEN the toast `Nothing here takes files` shows
Tests:     `doc-links.test.ts`, posix paths unless the row says Windows:
           `docLinkOf_RelativeMarkdownLink` —
           | filePath | docPath | mediaType | link |
           |---|---|---|---|
           | `/n/docs/images/a.png` | `/n/docs/guide.md` | `image/png` | `![a.png](images/a.png)` |
           | `/n/notes/b.md` | `/n/docs/guide.md` | `text/markdown` | `[b.md](../notes/b.md)` |
           | `/n/docs/My File (1).pdf` | `/n/docs/guide.md` | `application/pdf` | `[My File (1).pdf](<My File (1).pdf>)` |
           | `/n/docs/a<b>.txt` | `/n/docs/guide.md` | `text/plain` | `[a<b>.txt](<a\<b\>.txt>)` |
           | `/n/docs/[x].svg` | `/n/docs/guide.md` | `image/svg+xml` | `![\[x\].svg]([x].svg)` |
           | `/n/docs/clips` | `/n/docs/guide.md` | `''` | `[clips](clips)` |
           | `/n/docs` (the doc's own folder) | `/n/docs/guide.md` | `''` | `[docs](../docs)` |
           | `/n/docs/C# notes.md` | `/n/docs/guide.md` | `text/markdown` | `[C# notes.md](<C%23 notes.md>)` |
           | `/n/docs/100%.md` | `/n/docs/guide.md` | `text/markdown` | `[100%.md](100%25.md)` |
           | `/n/docs/what?.md` | `/n/docs/guide.md` | `text/markdown` | `[what?.md](what%3F.md)` |
           | `/n/docs/a\b.md` | `/n/docs/guide.md` | `text/markdown` | `[a\\b.md](a\b.md)` |
           | Windows `C:\n\docs\img\a.png` | `C:\n\docs\g.md` | `image/png` | `![a.png](img/a.png)` |
           | Windows `D:\x\a.pdf` | `C:\n\g.md` | `application/pdf` | `[a.pdf](D:\x\a.pdf)` |
           `docLinksText_SpacesBetweenAndBefore` —
           | links | charBefore | text |
           |---|---|---|
           | `[a](a)`, `[b](b)` | `''` | `[a](a) [b](b)` |
           | `[a](a)` | `x` | ` [a](a)` |
           | `[a](a)` | `' '` | `[a](a)` |
           | `[a](a)` | `'\n'` | `[a](a)` |
           `pastedImagePath_BesideTheDoc` — `at` = `new Date(2026, 10, 2, 9, 5, 7).getTime()`:
           | docPath | mediaType | index | path |
           |---|---|---|---|
           | `/n/docs/guide.md` | `image/png` | 0 | `/n/docs/images/guide-20261102-090507.png` |
           | `/n/docs/guide.md` | `image/jpeg` | 0 | `/n/docs/images/guide-20261102-090507.jpg` |
           | `/n/docs/guide.md` | `image/png` | 1 | `/n/docs/images/guide-20261102-090507-2.png` |
           | `/n/docs/notes.v2.md` | `image/webp` | 0 | `/n/docs/images/notes.v2-20261102-090507.webp` |
           | `/n/docs/guide.md` | `''` | 0 | `/n/docs/images/guide-20261102-090507.bin` |
           `doc-view.test.ts`, its fake drops recording each target and its dispose, its fake document editor gaining
           `insert` (recorded) and `charBeforeCursor` (answering `''`), its channel answering `writeBytes`:
           `dropTarget_OnlyWhileEditing` —
           | steps | targets live |
           |---|---|
           | open a doc | none |
           | open a doc, `edit()` | one, on `div.docs-doc` |
           | open, `edit()`, `:q` | none (disposed) |
           | open a read-only doc, `edit()` | none |
           | open, `edit()`, `clear()` | none (disposed) |
           | open, `edit()`, `dispose()` | none (disposed) |
           `take_FilesBecomeDocLinks` — doc `/n/docs/guide.md` open in the editor, `now` at 2026-11-02 09:05:07 local:
           | files | writeBytes calls | inserts | toasts |
           |---|---|---|---|
           | `/n/docs/images/a.png` (`image/png`) | none | `['![a.png](images/a.png)']` | none |
           | pasted `image.png`, bytes `[1]` | `[['/n/docs/images/guide-20261102-090507.png', [1]]]` | `['![guide-20261102-090507.png](images/guide-20261102-090507.png)']` | none |
           | pasted `image.png`, `writeBytes` rejecting `Refused: outside the docs` | the one call | none | `['Refused: outside the docs']` |
           | pasted `image.png` bytes `[1]`, then `/n/notes/b.md` (`text/markdown`) | `[['/n/docs/images/guide-20261102-090507.png', [1]]]` | `['![guide-20261102-090507.png](images/guide-20261102-090507.png) [b.md](../notes/b.md)']` | none |
           | two takes, one pasted `image.png` each, `now` unchanged | `…/guide-20261102-090507.png`, then `…/guide-20261102-090507-2.png` | one per take | none |
           | pasted `image.png`, `writeBytes` resolved by the test only after `:q` | the one call | none (logged) | none |
Done when: compiles (`npm run typecheck`); the test gate runs the tests above
Commit:    one commit for the group

Live checks deferred to "10 — Final verification": its check 5 (a pasted PNG writes `images/<doc name>-<stamp>.png`
beside the doc and inserts the link; the app shows no picture) and check 11 (a dropped file whose path holds a
space, linked as `<…>`, renders and follows from the rendered doc after `:wq`).

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
