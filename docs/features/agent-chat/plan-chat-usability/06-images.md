# 06 — Attached images and the image viewer

Status: in progress
Type: Batch
Wave: 4 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify `index.html` (CSP) · create `src/plugins/chat/page/attachments.ts` · create `src/plugins/chat/page/image-viewer.ts` ·
           modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/chat-commands.ts` ·
           modify `src/plugins/chat/page/chat-kit.ts` · modify `src/plugins/chat/page/start.ts` ·
           modify `src/plugins/chat/layouts/layout.d.ts` · modify `src/plugins/chat/layouts/default/layout.js` ·
           modify `src/plugins/chat/manifest.ts` · modify `src/plugins/keymap.ts` · modify `src/plugins/chat/page/chat.css` ·
           test `src/plugins/chat/page/attachments.test.ts` · test `src/plugins/chat/page/chat-commands.test.ts` ·
           test `src/plugins/chat/layouts/default/layout.test.ts`
Consumes:  `ChatImage`, `UserMessage`, the user entry's `images` ← 01 · channel `send(sessionId, message)` ← 04 ·
           the `send` command path and `ChatViewDeps` as task 05 left them ← 05 · `iconButton`, `floatingPanel`,
           `dialog` primitives in `src/shared/page/ui/` (tree)
Produces:  in `src/plugins/chat/page/attachments.ts`:
           `export const IMAGE_TYPES: readonly string[]` (`image/png`, `image/jpeg`, `image/gif`, `image/webp`)
           `export const MAX_IMAGE_BASE64 = 5 * 1024 * 1024`
           `export function refusalOf(type: string, base64Length: number): string | null`
           `export interface Attachments { images(): ChatImage[]; add(image: ChatImage): void; removeAt(index: number): void; removeLast(): boolean; clear(): void; onChange(listener: (images: ChatImage[]) => void): void }`
           `export function createAttachments(): Attachments`
           in `src/plugins/chat/page/image-viewer.ts`:
           `export interface ImageViewer { open(images: readonly ChatImage[], index: number): void; next(): void; previous(): void; close(): void }`
           `export function createImageViewer(deps: …): ImageViewer` (overlay, `pushScope`, log)
           in `layout.d.ts`: `UserInput.images: { mediaType: string; data: string }[]`;
           `ChatKit.images(): HTMLElement` (a user entry's images as thumbnails; clicking one opens the viewer;
           throws for any other entry kind, as `permissionActions` does)
           manifest commands `removeImage`, `nextImage`, `prevImage`, `closeImage` (page) and scope
           `image: 'In the image viewer'`
Decisions: paste and drop (round 2) · thumbnails before and after sending, full-size viewer (round 2) · in memory as
           base64 (round 2) · the 5 MB limit read on the base64 length, the API's per-image cap, so an image the app
           accepts is never refused by the API · paste and drop are composer DOM listeners, the editor contract
           unchanged (design review) · `<Leader>cx` box-only like its `c` siblings (`docs/keymap.md`)
Done when: compiles; lint passes; the test gate runs the tests below
Commit:    one commit for the group

## Items

**CSP.** `index.html`'s Content-Security-Policy is `default-src 'self'; …` with no `img-src`, which blocks `data:`
images; add `img-src 'self' data:` to it.

**Accept rules.** `refusalOf`: a type outside `IMAGE_TYPES` → `Only PNG, JPEG, GIF and WebP images can be attached`;
a base64 length over `MAX_IMAGE_BASE64` → `Images over 5 MB cannot be attached`; else null.

**Attachments per tab.** Each held tab owns one `Attachments`. The composer listens (capture phase) to `paste`, and
the Chat tab's root (`div.chat-tab`, the transcript and the composer) to `dragover` and `drop`, so a drop just
outside the composer attaches instead of navigating the window to the file: for each `File` in the clipboard or drop, read it with `FileReader.readAsDataURL`, strip the
`data:<type>;base64,` prefix, run `refusalOf`, and add or toast the refusal. A paste with no files passes through to
the editor untouched (text paste keeps working); a paste or drop that holds files is `preventDefault`ed. An ended
tab ignores paste and drop and logs it. Reading runs per file; a read failure toasts and logs.

**Strip.** Above the message box inside the composer: one thumbnail per image (`<img src="data:<type>;base64,<data>">`,
fixed square size from the space tokens, `object-fit: cover`), each with an `iconButton` remove (`close` icon) that
calls `removeAt`. The strip is hidden when empty; `followComposerHeight` already tracks the composer's growth.

**Send.** `send` sends `{ text, images: attachments.images() }`, sends when the text is empty but images exist, and
clears the attachments after sending. An app slash command leaves them attached (task 05).

**Manifest labels**: `removeImage` `remove the last attached image` (group `box`), `nextImage` `next image`,
`prevImage` `previous image`, `closeImage` `close the image` (group `image`).

**Remove last.** `chat.removeImage`: `removeLast()`; logs `no attached image` when there was none. Bind
`<Leader>cx` → `chat.removeImage` beside `<Leader>cc`, with the same `where`.

**Sent entries.** `layout.d.ts` and the kit gain `images()`; the default layout's `user` builder appends
`kit.images()` inside its `kit.card()` turn, under the markdown, when `input.images.length > 0`; its `update`
rebuilds both the markdown and the images. Each thumbnail click opens the viewer at its index.
`chat.toggleEntry` (Enter) on a focused user entry with images opens the viewer at index 0; on any other entry it
does what it does today.

**Viewer.** In the overlay layer over scope `chat.image`: the image fitted inside the window with its aspect kept,
on a dim backdrop, and `<n> of <count>` when there is more than one. `nextImage` / `prevImage` stop at the ends;
`closeImage` closes and pops the scope; another session's Chat tab showing closes it (`otherSessionShown`).
Binds: `h` → `chat.prevImage`, `l` → `chat.nextImage`, `<Esc>` → `chat.closeImage` in `chat.image`.

CSS in `chat.css`, tokens only; the backdrop and layering follow `DESIGN.md` § Layers (the viewer is a dialog-layer
surface).

## Tests

GIVEN a 6 MB base64 PNG WHEN `refusalOf` runs THEN it returns `Images over 5 MB cannot be attached`
GIVEN two attached images and the text `hi` WHEN send runs THEN the channel's `send` gets both images and the strip is empty

- `refusalOf_Pdf_RefusesType`; `refusalOf_OverLimit_RefusesSize`; `refusalOf_PngAtLimit_Accepts`
- `removeLast_Empty_False`; `onChange_AddAndRemove_Reports`
- `send_ImagesOnly_Sends`; `send_WithImages_ClearsAttachments`; `send_AppCommand_KeepsAttachments`
- `userEntry_WithImages_DrawsThumbnails` in `layout.test.ts` — the default layout's user builder with a kit fake
  records one `images()` call and the card holds its element under the markdown; `userEntry_NoImages_NoThumbnails`

## Proof
