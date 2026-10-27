# 08 — Notes page part

Status: done
Type: Task
Wave: 4 · Depends on: 02, 04, 07
Plan: [plan.md](plan.md)

**Contents**

- **Fields** — files, interfaces, decisions, the GIVEN/WHEN/THEN lines, tests.
- **The popup** — opening, the fields, closing, the field cursor.
- **Images** — paste, drop, capture, the strip, removal.
- **The markup view** — tools, colours, undo and redo, saving.
- **Session and pickers** — the chip, the four pickers.
- **Sending** — the three sends, discard, the toasts.
- **Keys** — every bind with its scope, the overlap check, and the keymap doc row.
- **Log lines** — every line the self-test (task 09) waits on.
- **Tests** — the pure page state; the live checks that go to task 11.

This task lands the note popup: a modal dialog over any mode, on `Space n n`, that edits the one kept draft through
notes main (task 07) and sends it. The page holds no file logic: every read and write is a channel call.

Files:     create `src/plugins/notes/page/start.ts` · create `src/plugins/notes/page/popup.ts` · create
           `src/plugins/notes/page/popup-state.ts` + `popup-state.test.ts` · create
           `src/plugins/notes/page/markup-view.ts` · create `src/plugins/notes/page/png-image.ts` · create
           `src/plugins/notes/page/notes.css` · create `src/shared/page/pasted-images.ts` · modify
           `src/plugins/chat/page/attachments.ts` (import the moved helpers) · modify `src/plugins/page.ts` (append
           `notesPagePart`) · modify `src/plugins/keymap.ts` (§ Keys)
Consumes:  `PageServices.markup: MarkupEditor`, `MarkupSession`, `MarkupTool` ← 02 · `NotesChannel` and every type
           in it, `sendRefusal`, `fieldsOf`, `sessionChipText`, `defaultTarget`, `launchFolder` ← 06 ·
           `notesManifest` (its commands and scopes) ← 07 · existing: `createDialog`
           (`src/shared/page/ui/dialog.ts`), `createListPicker` (`src/shared/page/list-picker.ts`, with
           `filterEditor`), `textBoxInput` (`src/shared/page/text-box.ts`), `inputFrame`, `textButton`, `iconButton`,
           `chip`, `tag`, `icon` (`src/shared/page/ui/`), `keyHint` / `appendKeyHint` (`src/shared/page/key-hint.ts`),
           `createReducerStore` (`src/shared/page/reducer-store.ts`), `startAutosave` and `DraftRevisions`
           (`src/shared/page/autosave.ts`), `SessionsPageExports.selectedSessionId` and events
           `sessions.sessionAdded`, `sessions.sessionRemoved` (`src/plugins/sessions/contract.ts`),
           `KeysPageExports.keysFor`, `onChanged` (`src/plugins/keys/contract.ts`), `EditorHost.create` and
           `TextEditor` (`src/contracts/editor.ts`), `IMAGE_TYPES` in `src/shared/image-types.ts` ← 04 · `filesOf`, `holdsPastedText` (today private or
           exported in `src/plugins/chat/page/attachments.ts`; this task moves them)
Produces:  `notesPagePart` in `src/plugins/notes/page/start.ts`
           `export const NOTE_FIELDS = ['target', 'title', 'body', 'tags', 'images', 'session'] as const` and
           `export type NoteField = (typeof NOTE_FIELDS)[number]` in `popup-state.ts`, with the functions § Tests
           names
           `export function filesOf(transfer: DataTransfer | null):
           File[]`, `export function holdsPastedText(transfer: DataTransfer | null, files: File[]): boolean` in
           `src/shared/page/pasted-images.ts`, moved unchanged from chat's `attachments.ts`; it imports `IMAGE_TYPES` from `src/shared/image-types.ts` ← 04
           `export function toPngBytes(blob: Blob): Promise<Uint8Array>` in `png-image.ts`
Decisions: a modal `createDialog` over any mode, one kept draft, closing keeps it (design.md § The popup) · leader
           group `n` is notes, `Space n n` opens it (design.md § The popup, `docs/keymap.md`) · the pickers are the list
           picker and its filter that chat and docs use today; the slash-completion plan's task 04 moves every picker
           onto the fuzzy matcher later (coordinator, plan time) · the paste helpers move to `src/shared/page/`, since
           a plugin imports no other plugin's page code and a copy would drift (writing-code § An existing helper is
           widened, never copied) · every image becomes a PNG on the page before it reaches main, since the markup
           editor and Backlog's `<n>.png` both take PNG (agent, plan time) · the popup opens with the body box focused
           in insert mode, so the user types the nitpick at once (agent, plan time) · send actions sit under the
           leader group `n`, so the same keys work from the page and from the body box (agent, plan time) · the base
           scope changing under the popup closes it, keeping the draft, as chat's dialogs close (agent, plan time) ·
           a thumbnail shows the image as attached, with a pen icon when it has markup; the markup shows in the markup
           view and in the sent PNG (agent, plan time) · a successful send closes the popup; a refused one keeps it
           open (agent, plan time) · discard asks first, since it drops the user's text and images (agent, plan time)
Done when: `npm test -- src/plugins/notes src/plugins/chat/page/attachments.test.ts` passes; `npm run lint` and `npm
           run typecheck` pass. Task 11 (Final verification) checks that the app starts with no keymap error.
Commit:    one commit for the group

## The popup

- `notesPagePart.start(api)` builds the popup once, contributes its dialog element to `api.areas.overlay`, and
  keeps a map of open session rows from `sessions.sessionAdded` (`sessionId` → `harness`, `projectDir`,
  `hostSessionId`) and `sessions.sessionRemoved`.
- Dialog title `Note`. Its body holds, top to bottom: a Target row (the repo and its home with `~`, or `No target`
  in `fg-tertiary`), a Title row (`textBoxInput('notes-title')` in an `inputFrame`), a Body row (an editor from
  `services.editor.create` in an `inputFrame`, at least five lines tall), a Tags row (one `tag` per chosen tag, or
  `No tags`), the image strip, and the session chip. Each row is labelled in the UI font, `fg-secondary`. Its actions
  row: `Discard` (ghost), `Append to follow-up` (secondary), `Start session` (secondary), `Add follow-up` (primary),
  each with its command's key hint from `keys.keysFor`, drawn again on `keys.onChanged`.
- `open`, while the popup is hidden and no open is loading: invoke `loadDraft`, `homes` and `tags` together, then
  `image(id)` for each image. When the draft is `fresh`, apply `openFields` (§ Tests) with the selected row
  (`sessions.selectedSessionId()` looked up in the row map) and save at once. Then push scope `popup`, show the
  dialog, put the field cursor on Body and focus the body box in insert mode. A load that fails toasts `Note not
  opened: <error>` (`error`) and shows nothing. `open` while loading does nothing; `open` while shown runs `close`.
- `close`: when the store's draft is unsaved, invoke `saveDraft` at once with its fields (no autosave wait); blur the
  boxes, pop every notes scope the popup pushed, hide the dialog. The pushed `popup` scope's `onBaseChanged` runs
  `close`.
- The page state is one reducer store (`createReducerStore`) holding the draft's fields, its images, the
  `DraftRevisions` fields, the field cursor and the image cursor. `startAutosave` saves it under one id, `note`,
  through `saveDraft`, with `delayMs` read from `api.settings().autosaveDelayMs`. Each successful save logs
  `[notes] draft saved`.
- The field cursor marks its row with the focus ring (`focus-border`, DESIGN.md § Keys and focus) while no box has
  focus. `nextField` and `prevField` move it, clamped at the ends. `act` on: Target → the Target picker; Title →
  focus the title box; Body → focus the body box in insert mode; Tags → the Tags picker; Images → the markup view of
  the image under the image cursor (no image: nothing, and it logs); Session → the Session picker. `editBox` on Title
  or Body focuses that box in insert mode; on any other field it logs `[notes] no box on <field>`.
- The title box pushes scope `title` on focus and pops it on blur. `nextBox` and `prevBox` step between the two
  boxes, clamped: from the page (no box focused) `nextBox` focuses the title box and `prevBox` the body box.
  `leaveBox` blurs the focused box and puts the field cursor on its row, logging `field <field>` as a move does.

## Images

- `src/shared/page/pasted-images.ts`: move `filesOf`, `holdsPastedText` and its private
  `isRealText` from chat's `attachments.ts` unchanged (`IMAGE_TYPES` already sits in `src/shared/image-types.ts`, task 04); chat imports them from there. Chat's existing tests stay and
  cover them through `listenForImages`.
- Paste: while the popup shows the fields, a `paste` listener on `document` in the capture phase takes the
  clipboard's files when `holdsPastedText` is false (a paste of real text reaches the focused box untouched).
  Drop: the dialog's scrim hears `dragover` (prevent default when the transfer holds `Files`) and `drop`.
- Each taken file: a type outside `IMAGE_TYPES` toasts `Only PNG, JPEG, GIF and WebP images can be attached`
  (`error`) and logs `[notes] image refused: <that text>`. Else `toPngBytes(file)`, then invoke `addImage`, and the
  new image is under the image cursor.
- `toPngBytes`: a `image/png` blob gives its bytes unchanged; any other type is drawn through `createImageBitmap`
  onto an `OffscreenCanvas` of the bitmap's size and read back with `convertToBlob({ type: 'image/png' })`.
- `capture`: log `[notes] capture started`; hide the dialog (the `popup` scope stays pushed); wait two
  `requestAnimationFrame` callbacks, so the window repaints without the popup; invoke `capture`; show the dialog
  again with no box focused, the field cursor on Images and the new image under the image cursor. A failure shows the dialog again and toasts `Capture failed:
  <error>` (`error`).
- The strip: one thumbnail per image in strip order, as an `<img>` with a `data:image/png;base64,` URL of its bytes
  (the page's CSP allows `data:` images), the image under the image cursor marked `is-selected`, a pen `icon` on an
  image with markup, and an `iconButton('close', 'Remove the image', …, 'sm')`. `nextImage` and `prevImage` move the
  image cursor, clamped. `remove` on the Images field invokes `removeImage` for the image under the cursor; the
  cursor stays at its index, clamped to the new last image.

## The markup view

- `act` on an image swaps the dialog body's content for the markup view: a toolbar and a host element that fills the
  rest of the dialog. Push scope `markup`. Invoke `markup(id)`, then `services.markup.open(host, bytes, saved)`. Set
  the tool to `pen` and the colour to the first in the list below. Log `[notes] markup shown for image <pos>`.
- Colours, in this order: `red`, `yellow`, `green`, `blue`, each the CSS value of the theme token
  `--wg-notes-markup-<name>`, read with `getComputedStyle(document.documentElement).getPropertyValue(…).trim()` each
  time a colour is set, so a theme change reaches the next stroke.
- `toolSelect`, `toolPen`, `toolText`, `toolArrow`, `toolBox` call `setTool` with `select`, `pen`, `text`, `arrow`,
  `box` and log `[notes] tool <tool>`. `nextColour` and `prevColour` step through the list and wrap at the ends, and
  log `[notes] colour <name>`. `undo` and `redo` call the session's and log `[notes] undo` and `[notes] redo`.
- The toolbar shows each tool and colour as a button with its key hint (`keysFor` in scope `notes.markup`); the
  active tool and colour take `is-active`; each colour button's swatch reads its token in CSS.
- `closeMarkup`: when the session reported a change (`onChange`) since it opened, invoke `saveMarkup(id,
  session.toJson())` and log `[notes] markup saved for image <pos>`; else log `[notes] markup closed for image <pos>`.
  Then dispose the session, pop `markup`, and show the fields with the field cursor on Images. Closing the popup
  while the markup view shows runs `closeMarkup` first.

## Session and pickers

- The chip: `sessionChipText` of the draft's session in a `chip`, with an `iconButton('close', 'Remove the
  session', …, 'sm')`; `No session` in `fg-tertiary` when none. `remove` on the Session field sets the session to
  null and keeps the target as it is, defaulted or picked (`detachSession` in `popup-state.ts`, tested).
- One `createListPicker` with `pushScope: () => api.keys.pushScope('picker')`, `logSource: 'notes'` and
  `filterEditor: services.editor`, its element appended inside the dialog's scrim so it stacks over the dialog.
- Target (`pickTarget`): title `Target`, the homes from `homes()`, label `<repo> — <home root with ~>`, the current
  target selected. Chosen: the target is that root and `targetPicked` true; log `[notes] target <repo>`. No homes:
  toast the homes' `message`, or `No features home found` when it is null (`error`), and open nothing.
- Tags (`pickTags`): title `Tags`, the list from `tags()`, label `Remove <tag>` for a chosen tag and `Add <tag>` for
  any other. Chosen: `toggleTag`; log `[notes] tags <tags joined with ", ", or none>`.
- Session (`pickSession`): title `Session`, the open rows from `sessionOptions`, label `sessionChipText`. Chosen:
  `attachSession`; log `[notes] session <host session id>`. No row to offer: toast `No other session is open`
  (`info`).
- Follow-up (`appendFollowup`): see § Sending.

## Sending

Each send first checks `sendRefusal` on the store's fields; a refusal toasts its text (`error`), logs `[notes] send
refused: <text>`, and stops. While one send is in flight, another send command logs `[notes] send in flight` and does
nothing.

1. Invoke `saveDraft` with the fields at once, so main sends what the user sees.
2. Flatten: for each image with markup, `services.markup.open` on a host element appended to the dialog that is laid out but not seen (`position: fixed`, far off screen,
   `visibility: hidden`, a fixed non-zero size from a notes length token: `open` measures the host, and `toPng`
   renders at the image's own pixel size whatever the host size), given the image's bytes and `markup(id)`; `toPng()`; `dispose()`; remove the host. An image
   without markup gives null.
3. Invoke the send:
   - `sendFollowup`: `sendToFollowup({ type: 'create' }, flattened)`.
   - `appendFollowup`: open the picker titled `Follow-up` over the target home's `followups`, label the title. No
     open follow-up: toast `No open follow-ups in <repo>` (`info`). Chosen: `sendToFollowup({ type: 'append', path,
     title }, flattened)`, flattening after the choice.
   - `sendSession`: the folder is `launchFolder(home, launchFolders(…), paths)`; null toasts `No folder for <repo>;
     attach a session in that repo` (`error`) and stops. Else `sendToSession(folder, flattened)`.
4. `sent`: close the popup without a save (main's draft is already the fresh one), toast `result.toast` (`success`),
   log `[notes] sent: <result.toast>`. `refused`: toast the reason (`error`), log `[notes] send refused: <reason>`,
   keep the popup open. A rejected invoke is handled as a refusal with its error text.

Discard (`discard`): a second `createDialog('Discard this note?')`, built as chat's `createCloseConfirm` is
(`src/plugins/chat/page/chat-dialogs.ts`), body `Its title, text and images are removed.`, buttons `Keep` (secondary,
`confirmNo`) then `Discard` (danger, `confirmYes`), pushing scope `confirm`. Log `[notes] discard asked`.
`confirmYes`: invoke `discard`, load the returned draft into the store, keep the popup open with no box focused and the
field cursor on Body, log `[notes] draft discarded`. `confirmNo` or the base changing: log `[notes] draft kept`.

## Keys

In `src/plugins/keymap.ts`: add `'<Leader>n': 'notes'` to `groups`, and a `// ── Notes ──` section:

| Keys | Scope | Command | Where |
|---|---|---|---|
| `<Leader>nn` | `any` | `notes.open` | default (page and box) |
| `j` / `k` | `notes.popup` | `notes.nextField` / `notes.prevField` | page |
| `<CR>` | `notes.popup` | `notes.act` | page |
| `i` | `notes.popup` | `notes.editBox` | page |
| `t` | `notes.popup` | `notes.pickTarget` | page |
| `#` | `notes.popup` | `notes.pickTags` | page |
| `s` | `notes.popup` | `notes.pickSession` | page |
| `l` / `h` | `notes.popup` | `notes.nextImage` / `notes.prevImage` | page |
| `x` | `notes.popup` | `notes.remove` | page |
| `<Esc>` | `notes.popup` | `notes.close` | page |
| `<Esc>` | `notes.popup` | `notes.leaveBox` | box |
| `<C-n>` / `<C-p>` | `notes.popup` | `notes.nextBox` / `notes.prevBox` | page (a chord fires in the box too) |
| `<D-Enter>` | `notes.popup` | `notes.sendFollowup` | page |
| `<Leader>nf` | `notes.popup` | `notes.sendFollowup` | both |
| `<Leader>na` | `notes.popup` | `notes.appendFollowup` | both |
| `<Leader>ns` | `notes.popup` | `notes.sendSession` | both |
| `<Leader>nc` | `notes.popup` | `notes.capture` | both |
| `<Leader>nd` | `notes.popup` | `notes.discard` | both |
| `<Esc>` | `notes.title` | `notes.leaveBox` | page |
| `<CR>` / `<Tab>` | `notes.title` | `notes.nextBox` | page |
| `<C-n>` / `<C-p>` | `notes.title` | `notes.nextBox` / `notes.prevBox` | page |
| `<D-Enter>` | `notes.title` | `notes.sendFollowup` | page |
| `s` `p` `t` `a` `b` | `notes.markup` | `notes.toolSelect` `toolPen` `toolText` `toolArrow` `toolBox` | page |
| `c` / `C` | `notes.markup` | `notes.nextColour` / `notes.prevColour` | page |
| `u` / `<C-r>` | `notes.markup` | `notes.undo` / `notes.redo` | page |
| `<Esc>` | `notes.markup` | `notes.closeMarkup` | page |
| `j` / `k` | `notes.picker` | `notes.pickerDown` / `notes.pickerUp` | page |
| `<CR>` | `notes.picker` | `notes.pickerChoose` | page |
| `<Esc>` | `notes.picker` | `notes.pickerCancel` | page |
| `/` | `notes.picker` | `notes.pickerFilter` | page |
| `<CR>` | `notes.picker` | `notes.pickerChoose` | box, and `mode: 'insert'` |
| `<Esc>` | `notes.picker` | `notes.pickerList` | box |
| `y` | `notes.confirm` | `notes.confirmYes` | page |
| `n` / `<Esc>` | `notes.confirm` | `notes.confirmNo` | page |

Write the picker binds as chat's `chatListPageBinds` and `chatListBoxBinds` are written. The reasons: `t`, `s`,
`x`, `u`, `<C-r>` and the picker keys follow vim and the app's pickers (`docs/keymap.md` § Layers); the tool letters
are each tool's first letter; `#` reads as tags; `c` / `C` is colour and its reverse, Shift being the variant;
`<D-Enter>` is the app's send chord.

Overlap check, done at plan time against `src/plugins/keymap.ts` (re-run it on the landed Backlog keys): the only
scope that overlaps a notes scope is `any`. Its binds are `<Leader>ks`, `kn`, `kd`, `k,`, `vt`, `;`, `?`,
`zlo`, `zg`, `zs`, `<A-S-o>`, `<A-S-i>`, `<A-o>`, `<A-i>` and `<D-w>`, plus Backlog's `<Leader>kb`, `vd` and `va`
(`docs/keymap.md`, not yet in the tree); none equals a notes key, and no box bind in
any scope starts with `<Leader>n`, so the box maps `<Leader>nn`, `nf`, `na`, `ns`, `nc` and `nd` neither clash nor
begin one another. `docs/keymap.md`'s `n` row already lists these binds (written ahead; task 10 re-reads it).

## Log lines

Every line is `[notes] …`. An image is named by `<pos>`, its 1-based place in the strip, not by its id: ids count up
across drafts, so only the place gives the self-test a fixed line.

- `popup shown: title "<title>", <n> images, target <repo or none>, session <host session id or none>`
- `popup closed`
- `session <host session id or none> listed`, on each `sessions.sessionAdded`
- `field <field>`, on each field cursor move
- `draft saved`
- `picker shown: <title>` and `picker closed: <title>` (the list picker's own lines under `logSource: 'notes'`)
- `target <repo>`, `tags <list or none>`, `session <host session id>`
- `capture started`, `image <pos> attached (capture|pasted|dropped)`, `image <pos> removed`, `image refused: <text>`
- `markup shown for image <pos>`, `tool <tool>`, `colour <name>`, `undo`, `redo`, `markup saved for image <pos>`,
  `markup closed for image <pos>`
- `sent: <toast>`, `send refused: <text>`, `send in flight`
- `discard asked`, `draft discarded`, `draft kept`
- `no box on <field>`

## Tests

Unit tests in `popup-state.test.ts`, each building its draft, homes and rows in the test, over the POSIX `Paths`
adapter. `popup-state.ts` exports:

- `moveField(field: NoteField, step: 1 | -1): NoteField`, clamped at `target` and `session`.
- `imageCursorAfterRemove(count: number, removedIndex: number): number`: the same index clamped to `count - 1`, −1
  when no image is left.
- `openFields(draft: NoteDraft, selected: NoteSession | null, homes: readonly NoteHome[], paths: Paths): NoteFields`:
  a fresh draft gets `selected` as its session and, unless `targetPicked`, `defaultTarget`'s root (or null) as its
  target; `fresh` becomes false.
- `attachSession(fields: NoteFields, session: NoteSession | null, homes: readonly NoteHome[], paths: Paths):
  NoteFields`: sets the session; the target follows `defaultTarget` only while `targetPicked` is false.
- `detachSession(fields: NoteFields): NoteFields`: sets the session to null; the target stays as it was.
  GIVEN fields with a defaulted target and `targetPicked` false WHEN `detachSession` runs THEN the session is null
  and the target is unchanged (`detachSession_KeepsDefaultedTarget`).
- `toggleTag(tags: readonly string[], tag: string): string[]`: removes a chosen tag, else appends it.
- `sessionOptions(rows: readonly NoteSession[], attached: NoteSession | null): NoteSession[]`: the rows in row order,
  the attached one left out.
- `launchFolders(attached: NoteSession | null, rows: readonly NoteSession[]): string[]`: the attached session's
  folder first, then each row's, nulls and repeats left out.

The row map holds rows with a non-null `hostSessionId` only, as `NoteSession` values; a row with none can be neither
attached nor named.

GIVEN a fresh draft, the selected row in `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui` and the worked
example's homes (task 06) WHEN `openFields` runs THEN the session is that row, the target is home A's root and
`fresh` is false.
GIVEN fields with `targetPicked` true and target B WHEN `attachSession` attaches a row in
`/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui` THEN the target stays B.
GIVEN fields with `targetPicked` false WHEN `attachSession` attaches null THEN the target becomes null.

The DOM wiring earns no unit test: what it shows and how keys move through it is checked live. The live checks go to
task 11 (Final verification), each tagged by why it is there:

- expected: `Space n n` opens the popup over Sessions, Docs and Backlog modes, its body box in insert mode, and Esc
  closes it; the strip, chip and Target row read as DESIGN.md asks (L3 dialog, one accent, the focus ring on the
  field cursor).
- low-confidence: a paste of a screenshot (Cmd+V) and a drop of a JPEG file attach a PNG; a paste of text into the
  body types text. Paste and drop have no unit test.
- low-confidence: a capture shows the app without the popup in it (the two-frame wait).
- low-confidence: the markup view draws with each tool and colour, undo and redo work, text typed with the text tool
  stays out of the page keys (task 02's adapter owns that), and the sent PNG holds the markup.
- low-confidence: the picker layer stacks over the dialog and its filter types.
- expected: after a restart (the drive run's `restart`), `Space n n` shows the kept title, body and images.

## Proof

Commit 66955ed · proof: diff read: notesPagePart appended in page.ts, paste helpers moved unchanged with chat importing them, keymap gains group n; typecheck and full lint clean; worker reports 187 tests pass · concerns: png-image.ts pngDataUrl copies src/renderer/fabric/png-data-url.ts; picker stacking over the dialog is a live check; an in-flight autosave is not awaited before send/discard/close, relying on main handling invokes in order; picker closed logs only on cancel
