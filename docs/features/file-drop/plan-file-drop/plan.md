# File drop — plan

Feature: File drop · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Paste and drop files into every text box in the app. A drop lands in the pane under the pointer,
whatever that pane's focus or vim mode; a paste lands in the focused box. A file goes in as its
path, drawn as a file chip in a vim box, a plain path in a one-line input, and a relative markdown
link in the Docs editor. Chat keeps images as attached images and shrinks any over 5 MB instead of
refusing it. The whole behaviour is `docs/features/file-drop/design.md`; this plan does not repeat it.

## Architecture

Systems touched:

- contracts (`src/contracts/`): a new `drops.ts`, the `Bridge`, `PageApi`, and `TextEditor`
- preload and main core: the `pathForFile` and `savePasted` bridge calls
- page core (`src/renderer/`): the drop registry, page-wide drop cancelling, and the one-line
  input fallback
- the CodeMirror adapter: `insert` and file chips
- shared page code (`src/shared/page/file-drop/`): the text-paste rule, the chip pattern, the
  image shrink
- plugins: chat, forms, primer, backlog (through `editor-boxes.ts`), notes, docs

## Preconditions

Each was verified at plan time; `wigley:make` re-runs them before the first dispatch.

- Electron is 44.9.1: `grep '"electron"' package.json`. `webUtils.getPathForFile(file)` runs in
  the renderer (the preload, under context isolation) and returns `''` for a `File` with no path
  on disk (electronjs.org/docs/latest/api/web-utils, read 2026-11-02).
- The docs main part already has a guarded binary write: `grep -n "writeBytes" src/plugins/docs/main/doc-files.ts`
  shows `writeBytes(path: string, bytes: Uint8Array): Promise<WriteResult>`.
- The paste helpers to move live in `src/shared/page/pasted-images.ts`, imported only by
  `src/plugins/chat/page/attachments.ts` and `src/plugins/notes/page/popup.ts`:
  `grep -rln "pasted-images" src` (measured at plan time, re-verify).
- The 5 MB rule lives in `src/plugins/chat/image-rules.ts` (`refusalOf`), used by
  `chat/page/attachments.ts` and `chat/main/chat-sessions.ts`: `grep -rln "refusalOf" src`.
- Notes sends images from main as PNG base64 (`src/plugins/notes/main/note-sender.ts`), so its
  shrink must happen on the page: `grep -n "base64" src/plugins/notes/main/note-sender.ts`.
- The editor host is built by `createCodeMirrorVimHost: CreateEditorHost` in
  `src/renderer/codemirror-vim/codemirror-vim-host.ts`.

## Docs written ahead

Commit `09ced0c` ("File drop design: paste and drop files into every text box"):

- `docs/features/file-drop/design.md` (new): the behaviour every task implements
- `AGENTS.md`: the **A drop target** bullet under Architecture, and the `file-drop/` entry in the
  `src/shared/page/` listing
- `docs/features/agent-chat/design.md` § Images and **Attached image**
- `docs/features/notes/design.md` § Images and the send to a session
- `docs/features/docs-browser/design.md` § Viewing and editing
- `docs/features/followups.md`: the non-image chat follow-up removed (folded into this feature)

Commit `b7230c4` (found while drafting): `docs/features/file-drop/design.md` § Words and § Routing (inputs win a drop,
the no-target toast, two-segment chips, visual-mode insert) and `DESIGN.md`'s **File chip** entry.

## Mandatory Reads

- `AGENTS.md`: Intent, Architecture (plugins, the page API, ambient services, paths, plugin
  data, a third-party tool), Running and testing (the self-test and drive runs)
- `DESIGN.md`: before the file chip's look (task 03)
- `docs/features/file-drop/design.md`: every task

## Design Overview

```
 OS drag / Cmd+V
      │
      ▼
 page core drop registry (src/renderer/drop-targets.ts)
   · document dragover/drop: cancel every file drop
   · drop  → innermost target under the pointer
   · paste → innermost target holding focus, else the target that last held it
   · no target, but an <input>/<textarea> → its plain paths at the caret
      │ DroppedFile[]  (name, mediaType, path ('' when none), bytes())
      ▼
 target.take(files)  — registered by each plugin through api.drops.addTarget
   chat      images → shrinkToFit → attachments · others → editor.insert(chip text)
   forms / primer / backlog (editor-boxes) → last used box, else the first → editor.insert
   notes     images → Images field (shrunk) · others → Body editor.insert
   docs      → markdown links relative to the doc; pasted bytes → docs writeBytes images/…
      │
      ├── a file with no path → api.drops.savePasted → Bridge.savePasted → main writes pasted/<name>
      └── editor.insert(text) → CodeMirror adapter: text at the cursor, focus and mode kept;
                                every absolute path in a box draws as a file chip (atomic)
```

Decisions (interview rounds 1–2 and the design review):

- Images outside Chat are file chips; a pasted screenshot is saved to `pasted/` first (round 1).
- A drop off any box goes to the pane's own box; a pane with no box toasts `Nothing here takes files` (round 1).
- A paste with no focused box goes to the focused pane's box, without moving focus or mode (round 1).
- The agent receives the plain full path, in double quotes when it holds a space (round 1).
- The Docs editor inserts relative markdown links; a pasted screenshot saves beside the doc in
  `images/` (rounds 1, 2).
- Chat keeps image thumbnails; other files become chips there (Decided).
- Images over 5 MB shrink to fit (Decided); `refusalOf` keeps the 5 MB check as the API's cap in main, and on the
  page runs after the shrink only as a guard (a shrunk image is within the cap by construction).
- A chip is one character in vim (Decided); any absolute path of two or more segments draws as one, typed or
  dropped. An insert in visual mode replaces the selection and drops to normal, as vim's `p` (Decided).
- A one-line input under the pointer or focused takes plain paths ahead of its surrounding target; a drop on no
  target and no input toasts `Nothing here takes files`, tone `info` (Decided).
- One-line inputs get plain paths, handled by the core fallback, so no caller of `textBoxInput`
  changes (Decided).
- Drop routing is a core registry like the focus target, with page-wide cancelling (design review).

Out of scope: dragging text between boxes; dropping onto the Docs file tree to copy files.

## File Structure

New files:

- `src/contracts/drops.ts`: the seam every target crosses
- `src/shared/file-stamp.ts` (+ `.test.ts`): the `yyyyMMdd-HHmmss` stamp main's pasted files and the Docs images
  share
- `src/main/pasted-files.ts` (+ `.test.ts`): naming and saving pasted files in main
- `src/renderer/drop-targets.ts` (+ `.test.ts`): the registry and routing
- `src/shared/page/file-drop/pasted-text.ts` (+ `.test.ts`): moved from `src/shared/page/pasted-images.ts`, unchanged
- `src/shared/page/file-drop/file-chips.ts` (+ `.test.ts`): the chip pattern and insertion text
- `src/shared/page/file-drop/shrink-image.ts` (+ `.test.ts`): the step-down rule behind an encoder seam
- `src/shared/page/file-drop/canvas-encoder.ts`: the canvas adapter for that seam
- `src/renderer/codemirror-vim/chip-decorations.ts` (+ `.test.ts`): the chip decorations and the pure cursor rules
  (`snapHead`, `widenRange`) that make a chip one character

Existing files every task may not touch: `scripts/check-layers.mts` is edited by 02 alone (the new
`src/shared/page/file-drop` layer, listed ahead in every layer that will import it).

Shared names more than one task uses; every task matches them word for word:

```ts
// src/contracts/drops.ts
export interface DroppedFile {
  readonly name: string;        // the file's name, or a made-up one for a pasted file ("image.png")
  readonly mediaType: string;   // File.type; '' when the OS gave none (a folder)
  readonly path: string;        // full path on disk; '' for a pasted file
  bytes(): Promise<Uint8Array>;
}
export interface DropTarget {
  readonly element: HTMLElement;
  take(files: readonly DroppedFile[]): void;
}
export interface PageDrops {
  addTarget(target: DropTarget): Disposable;
  // Saves a file with no path under the app's pasted/ folder and returns its full path.
  savePasted(file: DroppedFile): Promise<string>;
}
// The toast for a drop no box takes: the core (04) and the editor-box targets (06) show it (a rendered Docs doc gets
// the core's, 08).
export const NOTHING_TAKES_FILES = 'Nothing here takes files';

// src/shared/file-stamp.ts (task 01) — local time, zero-padded, 24-hour: 2026-11-02 09:05:07 → '20261102-090507'.
// Main's pasted files (01) and the Docs pasted images (08) both name files by it.
export function fileStamp(epochMs: number): string;

// src/contracts/bridge.ts — Bridge gains
pathForFile(file: File): string;
savePasted(bytes: Uint8Array, mediaType: string): Promise<string>;
// BRIDGE_CHANNELS gains  savePasted: 'bridge:save-pasted'

// src/contracts/plugin.ts — PageApi gains
drops: PageDrops;

// src/contracts/editor.ts — TextEditor gains
// Types `text` at the cursor — after the character under a normal-mode cursor, as vim's `p`; over the main range of
// a visual selection, which then drops to normal — adding one space after it when the next character is not
// whitespace; keeps focus and the mode (visual excepted); reports `changed`.
insert(text: string): void;
// The character just before the point `insert` puts text at (in normal mode, the character under the cursor);
// '' at the start of the text.
charBeforeCursor(): string;

// src/contracts/editor.ts — what the host needs to draw file chips; CreateEditorHost gains it as a fourth
// parameter, passed by src/renderer/renderer.ts (task 03)
export interface FileChipDrawing { paths: Paths; fileIcon(): HTMLElement }

// src/shared/image-types.ts gains, from task 02 (main and page both name pasted files by it),
// beside MAX_IMAGE_BASE64, which moves here from chat/image-rules.ts (re-exported there)
// Parameters cut at ';'. A map first: 'png', 'jpg', 'gif', 'webp' for the image types, 'txt' for text/plain, 'md'
// for text/markdown, 'pdf', 'mp4'; else the subtype after '/' up to any '+' ('image/svg+xml' → 'svg') when it
// matches /^[a-z0-9]{1,8}$/; else 'bin' ('', 'application/octet-stream').
export function extensionOf(mediaType: string): string;
// The base64 text length of `byteCount` bytes: 4 * Math.ceil(byteCount / 3).
export function base64LengthOf(byteCount: number): number;
// `bytes` as base64, built in 32 KB slices so a 5 MB image does not overflow the stack.
export function base64Of(bytes: Uint8Array): string;

// src/shared/page/file-drop/file-chips.ts
export interface FileChipRange { from: number; to: number; path: string; name: string }
export function fileChipsIn(text: string, paths: Paths): FileChipRange[];
export function insertionText(filePaths: readonly string[], charBefore: string): string;

// src/shared/page/file-drop/shrink-image.ts
export interface EncodableImage { bytes: Uint8Array; mediaType: string }
export interface ImageEncoder {
  // Re-encodes `image` scaled by `scale` (0–1] as `mediaType`.
  encode(image: EncodableImage, scale: number, mediaType: string): Promise<Uint8Array>;
}
// Returns `image` unchanged when its base64 text is within MAX_IMAGE_BASE64; null when six steps leave it over.
// An encoder rejection (a corrupt image) rejects shrinkToFit too; the caller reports it as a failed read.
export async function shrinkToFit(image: EncodableImage, encoder: ImageEncoder): Promise<EncodableImage | null>;

// src/shared/page/file-drop/canvas-encoder.ts
export const canvasEncoder: ImageEncoder;
```

Boundary rules:

- Only the preload touches `webUtils`; the page reads paths through `Bridge.pathForFile`.
- Plugins reach drops only through `api.drops`; no plugin adds its own `drop` or `paste`
  listener for files after this plan. The listeners in `chat/page/attachments.ts`
  (`listenForImages`) and `notes/page/popup.ts` go.
- `src/shared/page/file-drop/` imports only `src/contracts` and `src/shared`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Shared file-drop modules](02-shared-file-drop.md)

### Wave 2
- [ ] [Drop contracts, bridge and pasted files](01-drop-contracts-bridge.md) — after 02
- [ ] [Editor insert and file chips](03-editor-insert-chips.md) — after 02

### Wave 3
- [ ] [Page core drop registry](04-drop-registry.md) — after 01, 02, 03

### Wave 4
- [ ] [Chat drop target](05-chat-target.md) — after 01, 02, 03, 04
- [ ] [Editor-box pane targets: Forms, Primer, Backlog](06-editor-box-targets.md) — after 01, 03, 04
- [ ] [Notes popup drop target](07-notes-target.md) — after 02, 03, 04
- [ ] [Docs editor drop target](08-docs-target.md) — after 01, 02, 03, 04

### Wave 5
- [ ] [Doc re-read](09-doc-re-read.md) — after 01–08
- [ ] [Final verification](10-final-verification.md) — after 09

## Run log

Review base: 87a254cb76dee43042396e82e9a353b6c9573795

### Groups
- 02 · a717159 · diff read: every Produces present; typecheck and lint (layers included) pass · concerns: AGENTS.md's image-types.ts line still says media types only (goes to 09); 05 and 07 still name pasted-images in their text and Done-when greps
### Contract changes
### Rulings
- canvasEncoder copies the bytes into a new Uint8Array before the Blob — TS rejects Uint8Array<ArrayBufferLike> as a BlobPart; avoids a cast — one extra copy per encode step on a cold path · group 02
- fileChipsIn ends a quoted span at \r as well as \n — the task said only 'a line break' — only CRLF text is affected if wrong · group 02
- The 05 and 07 briefs name the moved module src/shared/page/file-drop/pasted-text.ts wherever their task text says pasted-images, and their Done-when greps search for both names — the task text predates 02's move — a grep for the old name alone would pass without checking anything · lead
### Review rounds
### Test gate
