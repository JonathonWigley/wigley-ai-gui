# 05 — Chat drop target

Status: done
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/attachments.ts` · modify `src/plugins/chat/page/chat-view.ts` ·
           modify `src/plugins/chat/page/start.ts` · test `src/plugins/chat/page/attachments.test.ts`
Consumes:  `DroppedFile`, `PageDrops` (`api.drops.addTarget`, `api.drops.savePasted`) ← 01/04 ·
           `TextEditor.insert(text)` ← 03 · `TextEditor.charBeforeCursor()` ← 03 ·
           `insertionText(filePaths, charBefore)`, `shrinkToFit(image, encoder)`, `canvasEncoder`, `ImageEncoder`,
           `EncodableImage` ← 02 · `export function base64LengthOf(byteCount: number): number;`,
           `export function base64Of(bytes: Uint8Array): string;` in `src/shared/image-types.ts` ← 02 ·
           `refusalOf` (`src/plugins/chat/image-rules.ts`, in the tree) ·
           `IMAGE_TYPES` (`src/shared/image-types.ts`, in the tree)
Produces:  in `src/plugins/chat/page/attachments.ts`:
           `export const SHRINK_REFUSED = 'Image could not be shrunk under 5 MB';`
           `export interface AttachReport { attached(image: ChatImage): void; refused(reason: string): void;
             failed(name: string, what: 'read' | 'saved', error: string): void; inserted(paths: readonly string[]): void }`
           `export interface ChatDropDeps { attachments: Pick<Attachments, 'add'>;
             box: Pick<TextEditor, 'insert' | 'charBeforeCursor'>; savePasted(file: DroppedFile): Promise<string>;
             encoder: ImageEncoder; report: AttachReport }`
           `export async function takeChatFiles(files: readonly DroppedFile[], deps: ChatDropDeps): Promise<void>`
           in `src/plugins/chat/page/chat-view.ts`: `ChatViewDeps.drops: Pick<PageDrops, 'addTarget' | 'savePasted'>`
Decisions:
- `listenForImages`, `ImageTab`, `ImageTargets`, `ImageListenerDeps`, `attachFiles`, `refusalOfFile`, the private
  `base64LengthOf` (02 exports the one copy from `src/shared/image-types.ts`) and the `FileReader` read
  (`readBase64`; `base64Of` from 02 replaces it) go: the core registry (04) owns drop and paste listening, page-wide cancelling and the text-paste
  rule (plan.md § Boundary rules). The `pasted-images` import goes with them.
- The target is the Chat tab root `div.chat-tab`, registered through `deps.drops.addTarget` in `createTab` once
  `tab.box` exists, so a take always has a box. `HeldTab` keeps the `Disposable`; the `onSessionRemoved` handler
  disposes it beside `tab.box?.destroy()`. `start.ts` passes `drops: api.drops`.
- **A take that outlives its session**: the `box` and `attachments` chat-view hands `takeChatFiles` are wrappers
  that do nothing once `tabs.get(sessionId)` is gone (`insert` and `add` return, `charBeforeCursor` answers `''`),
  so a session removed during the take's awaits drops the rest of the take silently.
- `takeChatFiles` walks the files in the order given. A file whose `mediaType` is in `IMAGE_TYPES` is an image; any
  other file (folder, video, doc, an image type the API refuses such as TIFF) is an other file.
- Image: `bytes()` → `shrinkToFit({ bytes, mediaType }, deps.encoder)` on every image (02 hands back the same
  object, calling no encoder, when it is within the cap, so the cap is measured in one place); null →
  `report.refused(SHRINK_REFUSED)`; otherwise the result (its `mediaType` may change: a GIF comes back PNG, per
  design § Images over 5 MB) → `attachments.add` with `base64Of(bytes)` as the data and `report.attached`. Between
  the two, `refusalOf(mediaType, base64LengthOf(bytes.length))` stays only as a guard: the type is in
  `IMAGE_TYPES` and the length within the cap by construction, so it never refuses here and no row drives it; a
  refusal, were it to come, goes to `report.refused(reason)`. A pasted image (path `''`) attaches the same way and
  is never saved (design § Pasted files).
- Other file: its `path`, or `await savePasted(file)` when the path is `''`. All other files' paths gather in order
  and go in with one `box.insert(insertionText(paths, box.charBeforeCursor()))` after the walk, then
  `report.inserted(paths)`; no insert when none gathered.
- One file's failure leaves the rest: `bytes()` and `shrinkToFit` sit in one try, so a `bytes()` rejection or an
  encoder rejection (02: `shrinkToFit` passes it on) → `report.failed(name, 'read', errorText)`; a `savePasted`
  rejection → `report.failed(name, 'saved', errorText)`.
- chat-view's report keeps the old listener's log and toast lines: attached → log `attached a <type> image in
  <tab>`; refused → log `image refused: <reason>` and toast the reason, tone `error`; failed → log and toast
  `<name> not <what>: <error>`, tone `error`; inserted → log `inserted <n> file path(s) in <tab>`.
- The encoder chat-view hands `takeChatFiles` is `canvasEncoder`; tests hand a fake.
- The `start.ts` header comment's "Images pasted or dropped into a Chat tab attach to its next message" gains: other
  files go into the box as file chips.
GIVEN a Chat tab WHEN a PNG and a PDF on disk are dropped on it with the box unfocused THEN the PNG attaches as a
  thumbnail and the PDF's path goes into the box at its cursor, focus and vim mode unchanged
GIVEN a 7 MB JPEG WHEN dropped THEN it is shrunk to fit and attached; no refusal toast
GIVEN an image no step brings under the cap WHEN dropped THEN the toast `Image could not be shrunk under 5 MB` shows
  and nothing attaches
GIVEN a screenshot on the clipboard WHEN pasted into the Chat box THEN it attaches as an image and no file is saved
GIVEN a pasted non-image (path `''`) WHEN taken THEN it is saved through `savePasted` and its saved path goes in
Tests:     in `attachments.test.ts`, with a fake box recording `insert` calls and answering `charBeforeCursor` `'x'`, a
           fake `savePasted` answering `/app/pasted/20261102-090000-1.txt`, and a fake encoder; `LARGEST_ACCEPTED_BYTES`
           as the file defines it:
           `takeChatFiles_EachFile_GoesWhereItsKindGoes` — one row per case; asserts the attached images, the insert
           calls, the `savePasted` calls and the report calls:
           | files | attached | inserts | savePasted |
           |---|---|---|---|
           | PNG `a.png`, 3 bytes, path `/d/a.png` | `[{ image/png, base64 of the bytes }]` | none | none |
           | PNG `image.png`, 3 bytes, path `''` | `[{ image/png, … }]` | none | none |
           | PDF `a b.pdf`, path `/d/a b.pdf` | none | `[insertionText(['/d/a b.pdf'], 'x')]` | none |
           | text `notes.txt`, path `''` | none | `[insertionText(['/app/pasted/20261102-090000-1.txt'], 'x')]` | `[notes.txt]` |
           | PNG `/d/1.png`, MP4 `/d/v.mp4`, GIF `/d/2.gif`, folder `/d/f` (mediaType `''`) | `[png, gif]` in that order | `[insertionText(['/d/v.mp4', '/d/f'], 'x')]` (one call) | none |
           `takeChatFiles_OverCap_ShrinksOrRefuses` —
           | file | encoder returns | attached | refused |
           |---|---|---|---|
           | JPEG of `LARGEST_ACCEPTED_BYTES + 1` bytes | 300 bytes | `[{ image/jpeg, base64 of the 300 bytes }]` | none |
           | PNG of `LARGEST_ACCEPTED_BYTES + 1` bytes | `LARGEST_ACCEPTED_BYTES + 1` bytes at every scale | none | `['Image could not be shrunk under 5 MB']` |
           `takeChatFiles_OneFails_RestTaken` —
           | failing file | report.failed | still taken |
           |---|---|---|
           | PNG whose `bytes()` rejects `gone` | `('a.png', 'read', 'gone')` | the GIF after it attaches |
           | text, path `''`, `savePasted` rejects `disk full` | `('t.txt', 'saved', 'disk full')` | `/d/v.mp4` inserted alone |
           | PNG `a.png` of `LARGEST_ACCEPTED_BYTES + 1` bytes, encoder rejecting `bad image` | `('a.png', 'read', 'bad image')` | the GIF after it attaches |
           `base64Of` over a large image is 02's test; the disposal of the target when a session goes, and the
           box wrapper's no-op, are one-line wiring in `chat-view.ts`, which has no test harness, and are left to
           review.
           Remove `describe('listenForImages paste')` (the text-paste rule is the core's, tested by 02/04) and
           `describe('refusalOfFile')`; keep `refusalOf` and `attachments`.
Done when: compiles (`npm run typecheck`); the test gate runs the tests above; `grep -rn "listenForImages\|pasted-images"
           src/plugins/chat` finds nothing
Commit:    one commit for the group

Live checks deferred to "10 — Final verification": its check 2 (a 6 MB PNG dropped on the Chat tab attaches shrunk)
and check 12 (a JPEG over 5 MB attaches re-encoded as JPEG).

## Proof

Commit 20ccf47 · proof: diff read: every Produces present; chat compiles (typecheck's only errors were in 06's in-progress forms files); chat files pass oxfmt and oxlint · concerns: only add, insert and charBeforeCursor are guarded once the session is gone, as the Decision lists, so a take outliving its session still logs and still saves a pasted non-image
