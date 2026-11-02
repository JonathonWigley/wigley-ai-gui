# 02 — Shared file-drop modules

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     move `src/shared/page/pasted-images.ts` → `src/shared/page/file-drop/pasted-text.ts` ·
           test `src/shared/page/file-drop/pasted-text.test.ts` (new) ·
           modify `src/plugins/chat/page/attachments.ts`, `src/plugins/notes/page/popup.ts` (import path only) ·
           create `src/shared/page/file-drop/file-chips.ts` · test `src/shared/page/file-drop/file-chips.test.ts` ·
           create `src/shared/page/file-drop/shrink-image.ts` · test `src/shared/page/file-drop/shrink-image.test.ts` ·
           create `src/shared/page/file-drop/canvas-encoder.ts` ·
           modify `src/shared/image-types.ts` · test `src/shared/image-types.test.ts` (new) ·
           modify `src/plugins/chat/image-rules.ts` · modify `scripts/check-layers.mts`
Consumes:  `Paths` (existing, `src/contracts/paths.ts`: `isAbsolute`, `base`, `parent`) · `IMAGE_TYPES` (existing,
           `src/shared/image-types.ts`) · `posixPaths`, `windowsPaths` (existing, `src/shared/paths/`, test only)
Produces:  in `src/shared/page/file-drop/pasted-text.ts` (moved, unchanged):
           `export function holdsPastedText(transfer: DataTransfer | null, files: File[]): boolean` ·
           `export function filesOf(transfer: DataTransfer | null): File[]`
           in `src/shared/page/file-drop/file-chips.ts`:
           `export interface FileChipRange { from: number; to: number; path: string; name: string }` ·
           `export function fileChipsIn(text: string, paths: Paths): FileChipRange[];` ·
           `export function insertionText(filePaths: readonly string[], charBefore: string): string;`
           in `src/shared/page/file-drop/shrink-image.ts`:
           `export interface EncodableImage { bytes: Uint8Array; mediaType: string }` ·
           `export interface ImageEncoder { encode(image: EncodableImage, scale: number, mediaType: string): Promise<Uint8Array>; }` ·
           `export async function shrinkToFit(image: EncodableImage, encoder: ImageEncoder): Promise<EncodableImage | null>;`
           in `src/shared/page/file-drop/canvas-encoder.ts`: `export const canvasEncoder: ImageEncoder;`
           in `src/shared/image-types.ts`: `export const MAX_IMAGE_BASE64 = 5 * 1024 * 1024;` ·
           `export function extensionOf(mediaType: string): string;` ·
           `export function base64LengthOf(byteCount: number): number;` ·
           `export function base64Of(bytes: Uint8Array): string;`
Decisions:
- **The move** is a `git mv` with no change to the code; only the importers' paths change. No test existed for it,
  so `pasted-text.test.ts` is new (plan.md File Structure lists one).
- **The 5 MB cap moves to shared.** `MAX_IMAGE_BASE64` (with its comment, "The API's per-image cap, measured on the
  base64 text it receives") moves from `src/plugins/chat/image-rules.ts` to `src/shared/image-types.ts`, since
  `src/shared/page/file-drop/` may not import a plugin. `image-rules.ts` imports it for `refusalOf` and re-exports it
  (`export { MAX_IMAGE_BASE64 } from '../../shared/image-types'`), so `chat/page/attachments.test.ts` and every
  other importer stay as they are.
- **`extensionOf`** (plan.md File Structure; task 01 names pasted files by it, task 08 Docs images): the type is
  cut at the first `;` (parameters such as `;charset=utf-8` go), trimmed and lower-cased; then a map: `image/png` →
  `png`, `image/jpeg` → `jpg`, `image/gif` → `gif`, `image/webp` → `webp`, `text/plain` → `txt`, `text/markdown` →
  `md`, `application/pdf` → `pdf`, `video/mp4` → `mp4`; any other type gives the subtype after `/` cut at the first
  `+` (`image/svg+xml` → `svg`) only when it matches `^[a-z0-9]{1,8}$`, else `bin` (`''`, a type with no `/`,
  `application/octet-stream`, a long vendor type). The rule keeps a path separator, a space or a long name out of
  the saved file's name. This task owns every `image-types.ts` edit, so task 01 waits on it.
- **`base64LengthOf(byteCount)`** is `4 * Math.ceil(byteCount / 3)`, the one copy of the formula: `shrinkToFit`
  measures by it and Chat (05) calls it for `refusalOf`; the private copy in `chat/page/attachments.ts` goes in 05.
- **`base64Of(bytes)`** builds the base64 text by `String.fromCharCode` over 32 KB (`0x8000`-byte) slices of
  `bytes`, joined, then one `btoa`: a single spread of a 3–5 MB array overflows the stack. Chat (05) turns image
  bytes into `ChatImage.data` with it.
- **Layers** (`scripts/check-layers.mts`): a new entry `'src/shared/page/file-drop': { layers: ['src/contracts',
  'src/shared'], packages: [] }`, which enforces plan.md's boundary rule; a test-file entry
  `'src/shared/page/file-drop/file-chips.test.ts'` with `['src/contracts', 'src/shared', 'src/shared/paths',
  'src/shared/page/file-drop']` (as `src/shared/layouts/layout-contracts.test.ts` has its own), since the test runs
  the real path adapters. `'src/shared/page/file-drop'` is added to the `layers` of every entry that imports it now
  or in a later task, so tasks 03–08 never touch this file: `src/plugins/chat/page`, `src/plugins/notes/page`,
  `src/plugins/docs/page`, `src/plugins/forms/page`, `src/plugins/primer/page`, `src/plugins/backlog/page`,
  `src/shared/page`, `src/renderer`, `src/renderer/codemirror-vim`.
- **`fileChipsIn`** scans left to right, without overlap:
  - at a `"`: a quoted span is that `"`, then characters other than `"` and a line break, then `"`; the range covers
    both quotes and `path` is the text between them. When the span is a chip, scanning resumes after its closing
    quote; when it is not (or the `"` has no closing `"` before a line break), only the opening `"` is passed and
    scanning resumes right after it
  - otherwise an unquoted token: a maximal run of characters other than whitespace and `"` (a token stops before
    any `"`), less any trailing run of `.` `,` `;` `:` `!` `?` `)`; the range covers the token and `path` is it
  - either is a chip only when `paths.isAbsolute(path)` and the path has at least two segments, tested as
    `paths.base(paths.parent(path)) !== ''`, so `/` and a one-segment path such as the slash command `/compact`
    stay text (design § Words)
  - `path` is the text as written, not normalized; `name` is `paths.base(path)`
- **`insertionText`**: each path written as is, or in double quotes when it holds whitespace (`/\s/`) or ends in
  one of `.` `,` `;` `:` `!` `?` `)` (the characters `fileChipsIn` strips from an unquoted token's end, so the chip
  reads the quoted form whole); paths
  joined by one space, in the order given; one leading space when `charBefore` is non-empty and not whitespace; no
  trailing space. `charBefore` is the one character before the cursor, `''` at the start of the text.
- **`shrinkToFit`** (plan.md: the image unchanged within the cap, null when six steps leave it over): length is
  `base64LengthOf(bytes.length)`. An image whose length is at most
  `MAX_IMAGE_BASE64` returns the same object, calling no encoder, whatever its type. Over it, an image outside
  `IMAGE_TYPES` returns null. Otherwise step `k` (1 to 6) calls `encoder.encode(image, 0.75 ** k, outType)` on the
  original image — scales `0.75, 0.5625, 0.421875, 0.31640625, 0.2373046875, 0.177978515625` — and returns
  `{ bytes, mediaType: outType }` from the first step that fits; null after six steps over the cap. `outType` is the
  image's own type for `image/jpeg` and `image/webp`, and `image/png` for `image/png` and `image/gif` (design §
  Images over 5 MB). `shrinkToFit` does not catch: an `encode` rejection (a corrupt image, an unsupported output
  type) rejects `shrinkToFit` with the same error, and each caller (05, 07) reports it as that file's failed read and
  carries on with the next file.
- **`canvasEncoder`**: decodes with `createImageBitmap(new Blob([bytes], { type }))` (a GIF decodes to its first
  frame), draws onto an `OffscreenCanvas` of `Math.max(1, Math.round(width * scale))` by the same for height, and
  encodes with `convertToBlob({ type: mediaType, quality: 0.9 })` — quality 0.9 pinned by the design, ignored by
  the canvas for PNG. It has no unit test: it is the canvas adapter behind the seam, as
  `src/plugins/notes/page/png-image.ts` is; it is checked live.

GIVEN a box holding `see /Users/me/a.png now` WHEN chips are found THEN one chip covers characters 4–19 named `a.png`
GIVEN two dropped files, one with a space in its path, after `x` WHEN inserted THEN the text is
` "/a/My File.md" /a/c`
GIVEN a 12 MB JPEG WHEN shrunk THEN it re-encodes as JPEG at the first step whose base64 fits 5 MB

Tests:
- `image-types.test.ts` — `extensionOf names a file's extension by its media type` — rows: `image/png` → `png` ·
  `image/jpeg` → `jpg` · `image/gif` → `gif` · `image/webp` → `webp` · `image/svg+xml` → `svg` ·
  `application/pdf` → `pdf` · `video/mp4` → `mp4` · `text/plain` → `txt` · `text/plain;charset=utf-8` → `txt` ·
  `text/markdown` → `md` · `application/octet-stream` → `bin` · `''` → `bin` · `nonsense` → `bin`
- `image-types.test.ts` — `base64LengthOf measures base64 text` — rows: 0 → 0 · 1 → 4 · 3 → 4 · 4 → 8 ·
  3 932 160 → 5 242 880
- `image-types.test.ts` — `base64Of encodes bytes of any size` — rows: `[1, 2, 3]` → `'AQID'` · `[]` → `''` ·
  100 001 bytes, byte `i` = `i % 256` → length `base64LengthOf(100001)` (133 336), and `atob` of it gives back the
  same 100 001 bytes
- `pasted-text.test.ts` — `holdsPastedText treats text standing for the files as no text` — `transfer` faked as
  `{ getData: () => text }`, files `[new File([], 'a.png')]` unless the row says none; rows: `''` → false; `'  '` →
  false; `'a.png'` → false; `'https://x.com/i.png'` → false; `'file:///tmp/a.png'` → false; `'hello'` → true;
  `'hello'` with no files → true; a null transfer → false
- `file-chips.test.ts` — `fileChipsIn finds each absolute path` — rows (posix unless noted), expected as
  `[from, to, path, name]`:
  `'see /Users/me/a.png now'` → `[4, 19, '/Users/me/a.png', 'a.png']` ·
  `'"/Users/me/My File.md"'` → `[0, 22, '/Users/me/My File.md', 'My File.md']` ·
  `'/a/b /c/d'` → `[0, 4, '/a/b', 'b']`, `[5, 9, '/c/d', 'd']` ·
  `'end /tmp/x/y.md.'` → `[4, 15, '/tmp/x/y.md', 'y.md']` ·
  `'/compact now'` → none · `'/'` → none · `'and/or a/b'` → none · `'https://x.com/a/b'` → none ·
  `'"/a/b\n/c"'` → `[1, 5, '/a/b', 'b']` (the first `"` has no closing quote before the line break, so it is
  passed alone; `/c` stops before its `"` and has one segment) ·
  `'it"s "/a/b/c.md"'` → `[5, 16, '/a/b/c.md', 'c.md']` (`it` stops before `"`; `"s "` is no chip, so scanning
  resumes after its opening quote; the second `"` opens `"/a/b/c.md"`) ·
  windows `'C:\\Users\\me\\a.png'` → `[0, 17, 'C:\\Users\\me\\a.png', 'a.png']` ·
  windows `'C:/Users/me/a.png'` → `[0, 17, 'C:/Users/me/a.png', 'a.png']`
- `file-chips.test.ts` — `insertionText spaces and quotes the paths` — rows `(paths, charBefore) → text`:
  `(['/a/b.png'], '')` → `'/a/b.png'` · `(['/a/b.png'], 'x')` → `' /a/b.png'` · `(['/a/b.png'], ' ')` → `'/a/b.png'` ·
  `(['/a/b.png'], '\n')` → `'/a/b.png'` · `(['/a/My File.md', '/a/c'], 'x')` → `' "/a/My File.md" /a/c'` ·
  `(['C:\\My Docs\\a.txt'], '')` → `'"C:\\My Docs\\a.txt"'` · `(['/a/b/foo(1)'], '')` → `'"/a/b/foo(1)"'` ·
  `(['/a/b/file.'], '')` → `'"/a/b/file."'`
- `shrink-image.test.ts`, over a fake encoder that records each `(scale, mediaType)` and returns
  `Math.round(original length * scale * scale)` bytes (cap in bytes: 3 932 160):
  - `leaves an image within the cap as it is` — 3 932 160 bytes `image/png` → the same object; no encoder call
  - `steps down until the image fits` — rows: 3 932 161 bytes `image/png` → `image/png`, calls `[0.75]` ·
    8 000 000 bytes `image/jpeg` → `image/jpeg`, calls `[0.75, 0.5625]` · 8 000 000 bytes `image/gif` → `image/png`,
    calls `[0.75, 0.5625]`, each call's `mediaType` `image/png` · 8 000 000 bytes `image/webp` → `image/webp`
  - `refuses an image still over the cap after six steps` — an encoder that always returns 4 000 000 bytes → null,
    calls at the six scales above
  - `refuses an over-cap type it cannot re-encode` — 4 000 000 bytes `image/bmp` → null; no encoder call
  - `passes an encoder rejection on` — 4 000 000 bytes `image/png`, an encoder rejecting `bad image` → `shrinkToFit`
    rejects `bad image`

Done when: `npm run typecheck` and `npm run lint` pass (the layer check included); the test gate runs the tests
           above and `src/plugins/chat/page/attachments.test.ts`. The canvas encoder is checked live in
           "10 — Final verification".
Commit:    one commit for the group

## Proof

