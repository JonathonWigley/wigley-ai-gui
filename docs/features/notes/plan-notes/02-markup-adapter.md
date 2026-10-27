# 02 — Markup contract and Fabric adapter

Status: done
Type: Task
Wave: 2 · Depends on: 01, 06
Plan: [plan.md](plan.md)

Files:     modify `package.json`, `package-lock.json` (`npm install --save-exact fabric@7.4.0`) · create
           `src/contracts/markup.ts` · modify `src/contracts/plugin.ts` · create
           `src/renderer/fabric/fabric-markup-editor.ts` · create `src/renderer/fabric/markup-history.ts` + test
           `src/renderer/fabric/markup-history.test.ts` · create `src/renderer/fabric/fit-scale.ts` + test
           `src/renderer/fabric/fit-scale.test.ts` · create `src/renderer/fabric/png-data-url.ts` + test
           `src/renderer/fabric/png-data-url.test.ts` · modify `src/renderer/renderer.ts` · modify
           `scripts/check-layers.mts`
Consumes:  `Disposable` in `src/contracts/disposable.ts` (in the tree) · `PageServices` in `src/contracts/plugin.ts`
           (in the tree) · the `LAYERS` table in `scripts/check-layers.mts` (in the tree; task 06 adds its entries
           first)
Produces:  `src/contracts/markup.ts`, exactly as plan.md § File Structure gives it:
           ```ts
           export type MarkupTool = 'select' | 'pen' | 'text' | 'arrow' | 'box';
           export interface MarkupSession {
             setTool(tool: MarkupTool): void;
             setColour(colour: string): void; // a CSS colour the caller read from a theme token
             undo(): void;
             redo(): void;
             // The markup as JSON, to reopen with `open`'s `saved`.
             toJson(): string;
             // The image with its markup, flattened, at the image's own pixel size.
             toPng(): Promise<Uint8Array>;
             onChange(listener: () => void): Disposable;
             dispose(): void;
           }
           export interface MarkupEditor {
             // Draws the PNG `image` in `host`, scaled to fit, with the markup `saved` over it (null: none).
             open(host: HTMLElement, image: Uint8Array, saved: string | null): Promise<MarkupSession>;
           }
           ```
           in `src/contracts/plugin.ts`: `PageServices.markup: MarkupEditor`
           in `src/renderer/fabric/fabric-markup-editor.ts`: `export function createFabricMarkupEditor(): MarkupEditor`
           in `src/renderer/fabric/markup-history.ts`:
           `export interface MarkupHistory { push(snapshot: string): void; undo(): string | null; redo(): string | null; current(): string }`
           `export function createMarkupHistory(initial: string): MarkupHistory`
           `export const MARKUP_HISTORY_LIMIT = 100`
           in `src/renderer/fabric/fit-scale.ts`:
           `export function fitScale(image: { width: number; height: number }, host: { width: number; height: number }): number`
           in `src/renderer/fabric/png-data-url.ts`:
           `export function pngDataUrl(bytes: Uint8Array): string` · `export function dataUrlBytes(url: string): Uint8Array`
           in `src/renderer/renderer.ts`: `services.markup` is `createFabricMarkupEditor()`
Decisions: Fabric.js `7.4.0` (design.md § Images; the user approved this package and version, round 2) · one
           contract and one adapter folder, the only `fabric` import (AGENTS.md § Architecture, third-party tool) ·
           Fabric has no undo, so the adapter keeps a JSON history (below) · the markup stays editable until send:
           `toJson` keeps it, `toPng` flattens it (design.md § Images) · text typed with the text tool stays out of the page keys: Fabric's hidden textarea does not stop key
           propagation, so the adapter stops `keydown` from that textarea reaching the page, as `textBoxInput`
           (`src/shared/page/text-box.ts`) does for a text box, except Escape: on Escape while text is being edited the adapter ends
           the edit itself (`exitEditing`) and stops the event, so the first Esc ends the text edit and only a second Esc
           reaches the page and closes the markup view

## Step one: the install

Run `npm install --save-exact fabric@7.4.0` in the repo. The user approved `fabric@7.4.0` with its optional
dependencies `canvas` and `jsdom` (interview round 2). Install no other package. `--save-exact` writes
`"fabric": "7.4.0"` to `dependencies`, as the repo pins its newer dependencies (`markdown-it`, `vitest`) to an exact
version. App code never imports `canvas` or `jsdom`: Fabric uses them only under Node, and the page bundle takes
Fabric's browser build.

## The layer check

In `scripts/check-layers.mts` `LAYERS`:

- add `'src/renderer/fabric': { layers: ['src/contracts'], packages: ['fabric'] }`, beside `src/renderer/markdown-it`
- add `'src/renderer/fabric'` to the `layers` of `'src/renderer/renderer.ts'`

No other layer lists `fabric`.

## The adapter: pinned behaviour

Fabric 7 facts the adapter rests on (fabricjs.com, 7.0 upgrade notes and the `Canvas` API page):
`originX` / `originY` now default to `'center'`; `loadFromJSON(json, reviver?, options?)` returns
`Promise<Canvas>`; `toDataURL(options)` takes `format` and `multiplier`; `dispose()` returns `Promise<boolean>`;
`isDrawingMode` and `freeDrawingBrush` drive free drawing; `setDimensions` replaces `setWidth` / `setHeight`.

- **Image load.** `open` turns `image` into a `data:image/png;base64,` URL with `pngDataUrl` and loads it as a
  `FabricImage`. The page CSP (`index.html`) allows `img-src 'self' data:` and no `blob:`, so the adapter uses a data
  URL and the CSP does not change. An image that does not load rejects `open` with `Error('Markup image did not load')`.
- **Scale.** `open` measures `host.clientWidth` and `host.clientHeight` once. `fitScale` gives the scale `s`. The
  canvas size is `Math.round(width × s)` by `Math.round(height × s)`, and the canvas zoom is `s`
  (`setViewportTransform([s, 0, 0, s, 0, 0])`). Every object lives in the image's own pixel space. So a saved JSON
  reopens at the right place in a host of any size, and the flattened PNG needs no coordinate change.
- **Background.** The image is the canvas `backgroundImage`, at left 0, top 0, `originX: 'left'`,
  `originY: 'top'`. It is not in the JSON: `toJson` deletes the `backgroundImage` key from `canvas.toJSON()`
  before `JSON.stringify`. After each `loadFromJSON` (open with `saved`, undo, redo), the adapter sets its kept
  `FabricImage` as `backgroundImage` again and renders, since a load replaces the background.
- **Origins.** Every object the adapter creates sets `originX: 'left'` and `originY: 'top'`, because Fabric 7
  defaults to `'center'` and a drag places an object by its corner.
- **Sizes**, in screen pixels at open, stored in image pixels (divided by `s`): stroke width `3`, text font size
  `20`, arrow head length `4 ×` the stroke width, arrow head half-angle `30°`. The text font family is the computed
  `font-family` of `host`, so markup text matches the app.
- **Tools.**
  - `select`: `isDrawingMode` false, `skipTargetFind` false, `selection` true. The user moves, scales and turns
    marks.
  - `pen`: `isDrawingMode` true, a `PencilBrush` with the current colour and the stroke width.
  - `text`: a press on the canvas adds an `IText` with empty text at the pointer and enters editing. When editing
    exits (`text:editing:exited`), an `IText` whose text is empty or only spaces is removed, with no history step.
  - `arrow`: a drag from press to release draws one `Path`: the shaft, then the two head strokes, as
    `M x1 y1 L x2 y2 M h1x h1y L x2 y2 L h2x h2y`, `stroke` the current colour, `fill` `''`, `strokeLineCap` and
    `strokeLineJoin` `'round'`. The path shows while the pointer moves.
  - `box`: a drag draws a `Rect` from press to release, `fill` `'transparent'`, `stroke` the current colour.
  - A drag of `arrow` or `box` shorter than 4 screen pixels in both axes adds nothing.
  - While `pen`, `text`, `arrow` or `box` is the tool, `selection` is false and `skipTargetFind` is true, so a drag
    draws over a mark and never moves it. `setTool` discards the active selection.
- **Colour.** `setColour` sets the colour of the brush and of every later mark. When the tool is `select` and marks
  are selected, it also recolours them (a `Path` or `Rect` its `stroke`, an `IText` its `fill`) and adds one
  history step.
- **History.** The adapter holds one `MarkupHistory`, its `initial` the `toJson()` right after `open`. It pushes
  `toJson()` after each `path:created`, each finished arrow or box, each `text:editing:exited` that keeps its text,
  each `object:modified`, and each recolour. It never pushes on `object:added`, which also fires for the brush's
  path. `undo` and `redo` load the snapshot the history returns; a null return does nothing. Loads run one at a time,
  in call order (a promise chain), and the adapter pushes nothing while a load runs.
- **Change.** Each `onChange` listener runs after every push and after every undo or redo load. Its `dispose`
  removes it.
- **Flatten.** `toPng` calls `canvas.toDataURL({ format: 'png', multiplier: width / canvasWidth })`, `width` being the
  image's own width, and turns the URL into bytes with `dataUrlBytes`. The PNG is the image's own width; its height
  is within 1 pixel of the image's own height (the canvas size rounds). The PNG shows no selection box or controls.
- **Dispose.** `dispose` calls `canvas.dispose()` without waiting, removes the canvas wrapper element from `host`,
  and drops every `onChange` listener.
- The adapter adds no key listener. The caller (the notes page, task 08) calls `setTool`, `undo` and `redo` from its
  own commands.

## The pure modules

`markup-history.ts`, `fit-scale.ts` and `png-data-url.ts` import nothing from `fabric`, so their tests run in
Vitest's `node` environment without `canvas` or `jsdom`.

- `createMarkupHistory(initial)`: `current()` starts at `initial`. `push(snapshot)` does nothing when `snapshot`
  equals `current()`; else it makes `snapshot` current and clears every redo step. It keeps at most
  `MARKUP_HISTORY_LIMIT` (100) snapshots, the current one included, and drops the oldest past that. `undo()` makes
  the snapshot before current the current one and returns it; with none before, it returns null and changes nothing.
  `redo()` does the same forward.
- `fitScale(image, host)`: `Math.min(host.width / image.width, host.height / image.height, 1)`. It never scales an
  image up, so a small capture stays sharp. A host with a zero width or height throws
  `Error('Markup host has no size')`.
- `pngDataUrl(bytes)`: `data:image/png;base64,` and the base64 of `bytes`. `dataUrlBytes(url)`: the bytes of the
  base64 after the first comma of any `data:` URL.

GIVEN history `createMarkupHistory('a')` WHEN `push('b')`, `push('c')`, `undo()` run THEN `undo()` returns `'b'` and
`current()` is `'b'`.
GIVEN that history after the undo WHEN `push('d')` runs THEN `redo()` returns null and `current()` is `'d'`.
GIVEN a history at `'a'` WHEN `undo()` runs THEN it returns null and `current()` stays `'a'`.
GIVEN a history at `'a'` WHEN `push('a')` runs THEN `undo()` returns null.
GIVEN `createMarkupHistory('s0')` and pushes `'s1'` to `'s100'` WHEN `undo()` runs 100 times THEN the 99th returns
`'s1'` and the 100th returns null.
GIVEN an image 2000 × 1000 and a host 800 × 600 WHEN `fitScale` runs THEN it returns `0.4`.
GIVEN an image 400 × 300 and a host 800 × 600 WHEN `fitScale` runs THEN it returns `1`.
GIVEN a host 0 × 600 WHEN `fitScale` runs THEN it throws `Markup host has no size`.
GIVEN bytes `[137, 80, 78, 71]` WHEN `pngDataUrl` runs THEN it returns `data:image/png;base64,iVBORw==`, and
`dataUrlBytes` of that URL returns the same four bytes.

Tests:     `markup-history.test.ts`: `undo_AfterTwoPushes_ReturnsPrevious` · `push_AfterUndo_ClearsRedo` ·
           `undo_AtStart_ReturnsNull` · `push_SameAsCurrent_AddsNoStep` · `push_PastLimit_DropsOldest` ·
           `fit-scale.test.ts`: `fitScale_LargerImage_ScalesDown` · `fitScale_SmallerImage_KeepsOne` ·
           `fitScale_ZeroHost_Throws` · `png-data-url.test.ts`: `pngDataUrl_Bytes_RoundTrips`. Data built in each
           test. Drawing, the tools, undo on screen and the flattened PNG are checks in task 11 (Final
           verification).
Done when: compiles; `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above.
Commit:    one commit for the group

## Proof

Commit 47e4908 · proof: diff read: markup.ts verbatim, PageServices.markup, createFabricMarkupEditor in renderer.ts, history/fit-scale/png-data-url exports present, fabric layer only in src/renderer/fabric; typecheck clean · concerns: Fabric IText already stops Escape/Tab/arrows itself, so only typed characters needed the stop; hidden textarea lives in document.body; clearing a filled text on exit still adds one history step via object:modified; dispose removes the restored <canvas> rather than the wrapper; hiddenTextarea cast in the editing-entered handler
