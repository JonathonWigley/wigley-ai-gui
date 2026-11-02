# 04 — Page core drop registry

Status: done
Type: Task
Wave: 3 · Depends on: 01, 02, 03
Plan: [plan.md](plan.md)

Files:     create `src/renderer/drop-targets.ts` · test `src/renderer/drop-targets.test.ts` ·
           modify `src/contracts/plugin.ts` · modify `src/renderer/plugins/page-api.ts` ·
           modify `src/renderer/plugins/page-api.test.ts` · modify `src/renderer/renderer.ts`
Consumes:  `export interface DroppedFile { … }`, `export interface DropTarget { … }`, `export interface PageDrops { addTarget(target: DropTarget): Disposable; savePasted(file: DroppedFile): Promise<string>; }` ← 01 ·
           `export const NOTHING_TAKES_FILES = 'Nothing here takes files';` ← 01 ·
           `Bridge.pathForFile(file: File): string;` ← 01 · `Bridge.savePasted(bytes: Uint8Array, mediaType: string): Promise<string>;` ← 01 ·
           `export function holdsPastedText(transfer: DataTransfer | null, files: File[]): boolean` ← 02 ·
           `export function filesOf(transfer: DataTransfer | null): File[]` ← 02 ·
           `export function insertionText(filePaths: readonly string[], charBefore: string): string;` ← 02 ·
           `ToastTone` (existing, `src/contracts/plugin.ts`) · `errorText` (existing, `src/shared/error-text.ts`)
Produces:  in `src/contracts/plugin.ts`: `PageApi.drops: PageDrops;`
           in `src/renderer/drop-targets.ts`:
           `export interface DropTargetsDeps { document: Document; bridge: Pick<Bridge, 'pathForFile' | 'savePasted'>; toast(text: string, tone: ToastTone): void; isShown(element: HTMLElement): boolean; }`
           `export function createDropTargets(deps: DropTargetsDeps): PageDrops`
           in `src/renderer/plugins/page-api.ts`: `PageApiDeps.drops: PageDrops`
Decisions:
- **Why wave 3**: `renderer.ts` is edited by task 03 (the editor host's chips) and by this task, and two groups in
  one wave never share a file, so this task follows 03.
- **`PageApi.drops` lands here**, with its implementation (task 01 added only the `drops.ts` types), so each commit
  compiles. The `PageApi` doc comment gains one line: `drops.addTarget` registers an element and what takes the
  files dropped or pasted on it, returning the `Disposable` that removes it; `drops.savePasted` saves a file with
  no path and returns its path. `createPageApi` passes `drops: deps.drops` through, as `panes` passes
  `paneTargets`; the `PageApiDeps` comment names it. `page-api.test.ts`'s `deps()` gains a `drops` fake
  (`{ addTarget: () => ({ dispose: () => {} }), savePasted: async () => '' }`).
- **Composition root** (`renderer.ts`), modelled on `createPaneTargets`: `const drops = createDropTargets({ document,
  bridge, toast: (text, tone) => toasts.show(text, tone), isShown: (element) => element.checkVisibility() })`,
  built beside `paneTargets`, and `drops` handed to every `createPageApi` call.
- **Listeners**: `createDropTargets` adds `dragover`, `drop`, `paste` and `focusin` listeners on `deps.document` in
  the **capture** phase, so the core decides before CodeMirror's own drop and paste handlers (CodeMirror reads a
  dropped file's text into the editor). A drag or drop is a file drag when `dataTransfer.types` includes `'Files'`;
  any other drag (text between boxes, out of scope) is left alone.
- **Cancelling**: every file `dragover` gets `preventDefault()` and `dropEffect = 'copy'`; every file `drop` gets
  `preventDefault()` and `stopPropagation()`, whatever takes it, so no drop navigates the window. Every cancel —
  these, and a taken paste's — runs synchronously in the listener, before the first `await`, or the native paste or
  drop goes ahead.
- **A file drag with no file**: a cancelled `drop` whose `dataTransfer.files` is empty (a virtual file from some
  apps, a folder the OS gives no `File` for) calls no target and no input and toasts `NOTHING_TAKES_FILES`, tone
  `info`: the user dropped something and nothing arrived.
- **`DroppedFile` from a `File`**: `name` `file.name`, or `pasted` when empty; `mediaType` `file.type`; `path`
  `bridge.pathForFile(file)`; `bytes()` `file.arrayBuffer()` as a `Uint8Array`. Files keep the `DataTransfer`'s order.
- **Routing** (design § Routing):
  - innermost target of an element: among live targets whose `element` contains it, the one whose element lies
    inside every other's; two targets on one element — the one registered last
  - drop: the innermost target of the event's `target` takes the files
  - paste: only when `filesOf(clipboardData)` is non-empty and `holdsPastedText` is false; otherwise the event is
    left alone and stays a text paste. This gate runs before the one-line input check below (design § Routing puts
    the stay-text rule on the paste as a whole), so a spreadsheet cell pasted into a filter input stays text. Then the innermost target of `document.activeElement`; with none, the target
    that last held focus while it is still registered and `isShown(element)`. Taking it calls `preventDefault()`
    and `stopPropagation()`.
  - last focus: each `focusin` whose target lies in a target records that innermost target; a `focusin` outside
    every target keeps the record
- **One-line input first** (design § Routing): before target routing (and, for a paste, after the text gate),
  when the drop's `target`, or for a paste `document.activeElement`, is a one-line input, the input takes the files
  and no target is asked. An element is one by `tagName`, not `instanceof` (the tests run in `node`, which has no
  `HTMLInputElement`): `tagName === 'TEXTAREA'`, or `tagName === 'INPUT'` with `type` `text`, `search` or `url`;
  and `readOnly` and `disabled` both falsy. The event is cancelled at once (above). Each file's path is its `path`,
  or for `path === ''` the result of `savePasted` (files saved one at a time, in order). After the saves resolve:
  when the element is no longer `isConnected`, nothing is inserted; otherwise `value`, `selectionStart` and
  `selectionEnd` are read then, and `setRangeText(insertionText(paths, value[selectionStart - 1] ?? ''),
  selectionStart, selectionEnd, 'end')` and one `new Event('input', { bubbles: true })` on the element, so its owner
  hears the change; focus does not move.
- **No target and no input**: a drop toasts `NOTHING_TAKES_FILES` (`Nothing here takes files`), tone `info` (design
  § Routing); a paste is left alone.
- **`savePasted(file)`**: `bridge.savePasted(await file.bytes(), file.mediaType)`. A rejected save in the input
  fallback toasts `Pasted file not saved: <errorText(error)>`, tone `error`, and inserts nothing.
- `addTarget` returns a `Disposable` whose `dispose` removes the target, and the last-focus record when it is that
  target; a second `dispose` does nothing.

GIVEN a Chat tab target holding a composer target WHEN a file is dropped on the composer THEN only the composer's
`take` runs, with the file's name, type and path
GIVEN focus on no box and a Form tab that last held focus WHEN the user pastes a screenshot THEN the Form tab's
target takes it, with `path` `''`
GIVEN a settings filter input with `ab` and the caret at 2 WHEN `/a/b` is dropped on it THEN its value is `ab /a/b`
and one `input` event fires
GIVEN a drop on the title bar THEN the toast `Nothing here takes files` shows and the window does not navigate
GIVEN a spreadsheet cell (text and a picture) pasted into a focused filter input THEN it stays a text paste

Tests:     `drop-targets.test.ts`, in `node`. `test-dom.ts`'s elements lack `setRangeText`, `dispatchEvent`,
           `readOnly`, `disabled`, `isConnected` and capture-phase dispatch, so the test owns its doubles: a fake
           document that records `{ capture: true }` listeners and whose `dispatch(type, event)` runs them in
           registration order; fake elements with `tagName`, `parent` and a `contains` that walks it; and a fake
           input (`tagName: 'INPUT'`, `type: 'text'`, `value`, `selectionStart`, `selectionEnd`, `readOnly`,
           `disabled`, `isConnected`, a `setRangeText` that edits `value` as the DOM does, and a `dispatchEvent`
           counting `input` events). `File`s built with `new File([...], name, { type })` and a fake bridge whose `pathForFile` reads a map and whose `savePasted` records its calls and resolves
           `/home/me/pasted/20261102-090507-1.png`:
- `a drop goes to the innermost target under the pointer` — targets outer ⊃ inner; rows: drop on inner's child →
  inner takes; drop on outer outside inner → outer takes; drop on an element in neither → neither takes, toast
  `(NOTHING_TAKES_FILES, 'info')`; a `drop` with types `['Files']` and no files, on inner → no take, toast
  `(NOTHING_TAKES_FILES, 'info')`
- `a dropped file carries its name, type and path` — `a.png`, `image/png`, path `/Users/me/a.png` → `take` gets
  `{ name: 'a.png', mediaType: 'image/png', path: '/Users/me/a.png' }` and `bytes()` resolves `[1, 2, 3]`
- `a paste goes to the focused target, else the last focused one still shown` — rows: focus in inner → inner;
  focus outside every target, outer focused last and shown → outer; same with `isShown` false → none; same after
  outer's `dispose` → none
- `a paste of real text stays a text paste` — rows: text `hello` with a file → no take, `defaultPrevented` false;
  text `a.png` with file `a.png` → taken; no files → no take; text `hello` with a file and a focused one-line input
  → input value unchanged, no `input` event, `defaultPrevented` false
- `every file drag is cancelled` — rows: `dragover` with types `['Files']` → `defaultPrevented` true; with
  `['text/plain']` → false; `drop` with `['Files']` on a target → `defaultPrevented` true
- `a one-line input takes plain paths at its caret` — rows `(value, selectionStart, selectionEnd, paths) → value`:
  `('ab', 2, 2, ['/a/b'])` → `'ab /a/b'` · `('ab ', 3, 3, ['/a/b'])` → `'ab /a/b'` ·
  `('abXXcd', 2, 4, ['/a/b'])` → `'ab /a/bcd'` · `('', 0, 0, ['/a/My File.md'])` → `'"/a/My File.md"'`; each fires
  one `input` event
- `a file with no path is saved before its path goes in` — a pasted `image/png` into an empty input → `savePasted`
  called once with `[1, 2, 3]` and `image/png`; value `/home/me/pasted/20261102-090507-1.png`
- `a failed save inserts nothing` — `savePasted` rejects `disk full` → value unchanged; toast
  `('Pasted file not saved: disk full', 'error')`
- `an input gone during the save takes nothing` — a pasted `image/png` into an input whose `isConnected` turns
  false before `savePasted` resolves → value unchanged, no `input` event, `defaultPrevented` true at dispatch
`createPageApi`'s one-line pass-through earns no test of its own (a change detector); the compile pins it.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and
           `src/renderer/plugins/page-api.test.ts`. A real OS drag, a clipboard screenshot and the no-navigate check
           are deferred to "10 — Final verification".
Commit:    one commit for the group

## Proof

Commit 2afa21b · proof: diff read: every Produces present; typecheck and lint pass · concerns: drops.ts DroppedFile.name comment says a pasted file is named image.png, while 04 names it pasted (stale comment, outside 04's Files); isShown's checkVisibility unchecked live; tests wait with vi.waitFor plus one setTimeout(0)
