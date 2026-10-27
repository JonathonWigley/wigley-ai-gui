# 07 — Notes main part

Status: in progress
Type: Task
Wave: 3 · Depends on: 01, 04, 05, 06
Plan: [plan.md](plan.md)

**Contents**

- **Fields** — files, interfaces, decisions, the GIVEN/WHEN/THEN lines, tests.
- **The manifest** — settings, theme tokens, scopes and every command task 08 binds.
- **The draft store** — the data folder's files and each operation's write order.
- **The sender** — the two sends, the profile rule, the results and toasts.
- **start.ts** — the channel handlers and what each calls.

This task lands the notes plugin's manifest and main part. Main owns the kept draft and every write; the page
(task 08) only edits fields and calls the channel. The page part does not exist yet: no key names a notes command
until task 08, so the startup keymap check passes.

Files:     create `src/plugins/notes/manifest.ts` · create `src/plugins/notes/main/start.ts` · create
           `src/plugins/notes/main/draft-store.ts` + `draft-store.test.ts` · create
           `src/plugins/notes/main/note-sender.ts` + `note-sender.test.ts` · test `src/plugins/notes/main/start.test.ts`
           · modify `src/plugins/manifests.ts` (append `notesManifest` to `builtInManifests`, after every manifest it
           depends on) · modify `src/plugins/main.ts` (append `notesMainPart`)
Consumes:  `capture(): Promise<Uint8Array>` on `MainServices.window` ← 01 · `ChatMainExports.launch`,
           `profileNames`, `profileOf`, `LaunchRequest` ← 04 · `BacklogMainExports.load`, `fileNote`, `NoteTarget`
           ← 05 · `BacklogMainExports.tags(): string[]` ← 05 (Backlog's `tags` setting, as Backlog's main part reads it now) · every export of task 06 ·
           existing: `UserMessage`, `ChatImage` (`src/contracts/agent.ts`), `Files` (`src/contracts/files.ts`:
           `read`, `write`, `readBytes`, `writeBytes`, `trash`, `realPath`, `isMissingFile` beside it), `createMemoryFiles`
           (`src/shared/memory-files.ts`, tests), `definePlugin` (`src/shared/define-plugin.ts`), `errorText`
           (`src/shared/error-text.ts`), `MainApi`, `MainPart` (`src/contracts/plugin.ts`)
Produces:  `notesManifest` in `src/plugins/notes/manifest.ts` (§ The manifest)
           `notesMainPart` in `src/plugins/notes/main/start.ts`
           `export interface DraftStore` and `export function createDraftStore(files: Files, log: Log): DraftStore`
           in `draft-store.ts`, with `draft(): Promise<NoteDraft>`, `saveFields(fields: NoteFields): Promise<void>`,
           `image(id: number): Promise<Uint8Array>`, `addImage(png: Uint8Array): Promise<NoteDraft>`,
           `removeImage(id: number): Promise<NoteDraft>`, `markup(id: number): Promise<string | null>`,
           `saveMarkup(id: number, json: string): Promise<NoteDraft>`, `clear(): Promise<NoteDraft>`
           `export interface NoteSender` and `export function createNoteSender(deps: NoteSenderDeps): NoteSender` in
           `note-sender.ts`, with `toFollowup(request: FollowupRequest, flattened: readonly (Uint8Array | null)[]):
           Promise<NoteSendResult>` and `toSession(projectDir: string, flattened: readonly (Uint8Array | null)[]):
           Promise<NoteSendResult>`; `NoteSenderDeps` holds `store: DraftStore`, `backlog: Pick<BacklogMainExports,
           'fileNote'>`, `chat: Pick<ChatMainExports, 'launch' | 'profileNames' | 'profileOf'>`, `launchBrief(): string`,
           `paths: Paths`, `homeDir: Promise<string>` (the real home), `log: Log`
Decisions: one draft, kept in plugin data (design.md § The popup) · the draft is cleared only after a send that
           succeeded (design.md § The popup) · the launched session's profile: the attached session's when chat owns
           it, else chat's first (design.md § Destinations) · the page reads image bytes over the channel, not through
           `api.dataUrl`: the page's CSP (`index.html`) allows `wigley-data:` for scripts and styles only, not
           `img-src` or `connect-src` (agent, plan time) · every draft operation runs on one serial queue, so two
           writes of `draft.json` never interleave (agent, plan time) · an image file is written before the
           `draft.json` that names it, and trashed after the `draft.json` that drops it, so the record never names a
           missing file (agent, plan time) · a removed image goes through `Files.trash`, the one removal `Files`
           offers (agent, plan time) · chat owns its 5 MB per-image cap: an image over it makes `launch` reject, and
           notes passes that text on as the refusal, holding no copy of the cap (agent, plan time; task 04 must
           reject so) · an `autosaveDelayMs` setting beside `launchBrief`, as forms and primer each declare one for
           their page's autosave (agent, plan time) · the session line's `~` uses the real home path, as docs' fixture
           uses `files.realPath(homeDir)`, so a folder under a linked home still shows with `~` (agent, plan time)
Done when: `npm test -- src/plugins/notes` passes; `npm run lint` and `npm run typecheck` pass.
Commit:    one commit for the group

## The manifest

`definePlugin` with:

- `id: 'notes'`, `dependsOn: ['sessions', 'chat', 'backlog', 'keys']`. Main reads chat and backlog; the page reads
  sessions and keys. Notes reaches docs only through Backlog, so docs is not listed.
- `settings: { launchBrief: 'A nitpick to fix, noted while working. Make the change, then report.', autosaveDelayMs: 400 }`
- `settingInfo`:
  - `launchBrief`: label `Launch brief`, description `The line a session started from a note reads first, before the note's text.`
  - `autosaveDelayMs`: label `Autosave delay`, description `Milliseconds the note popup waits after an edit before it saves the draft.`
- `themeTokens`, each `kind: 'color'`:
  - `markup-red`: `var(--wg-status-error)`
  - `markup-yellow`: `var(--wg-status-warning)`
  - `markup-green`: `var(--wg-status-success)`
  - `markup-blue`: `var(--wg-status-info)`
- `scopes`:
  - `popup`: `In the note popup`
  - `title`: `In the note title box`
  - `markup`: `In the markup view`
  - `picker`: `In a notes picker`
  - `confirm`: `In the discard confirmation`
- `commands`, every one `runsIn: 'page'` (label, group):

| Command | Label | Group |
|---|---|---|
| `open` | `open or close the note popup` | `notes` |
| `close` | `close the popup, keeping the draft` | `notes` |
| `nextField` | `next field` | `fields` |
| `prevField` | `previous field` | `fields` |
| `act` | `edit or pick the field` | `fields` |
| `editBox` | `type in the field` | `fields` |
| `nextBox` | `next text box` | `fields` |
| `prevBox` | `previous text box` | `fields` |
| `leaveBox` | `leave the box` | `fields` |
| `pickTarget` | `pick the target repo` | `fields` |
| `pickTags` | `add or remove a tag` | `fields` |
| `pickSession` | `attach another session` | `fields` |
| `nextImage` | `next image` | `images` |
| `prevImage` | `previous image` | `images` |
| `remove` | `remove the image or the session` | `fields` |
| `capture` | `capture the window` | `images` |
| `sendFollowup` | `send to a new follow-up` | `send` |
| `appendFollowup` | `append to a follow-up` | `send` |
| `sendSession` | `send to a new session` | `send` |
| `discard` | `discard the draft` | `send` |
| `toolSelect` | `select and move` | `markup` |
| `toolPen` | `pen` | `markup` |
| `toolText` | `text` | `markup` |
| `toolArrow` | `arrow` | `markup` |
| `toolBox` | `box` | `markup` |
| `nextColour` | `next colour` | `markup` |
| `prevColour` | `previous colour` | `markup` |
| `undo` | `undo` | `markup` |
| `redo` | `redo` | `markup` |
| `closeMarkup` | `back to the note` | `markup` |
| `pickerDown` | `next line` | `picker` |
| `pickerUp` | `previous line` | `picker` |
| `pickerChoose` | `pick` | `picker` |
| `pickerCancel` | `close` | `picker` |
| `pickerFilter` | `filter` | `picker` |
| `pickerList` | `back to the list` | `picker` |
| `confirmYes` | `yes, discard the draft` | `confirm` |
| `confirmNo` | `keep the draft` | `confirm` |

## The draft store

The data folder (`api.data`, paths `/`-separated and relative to it):

```
draft.json              the NoteDraft as JSON.stringify(draft, null, 2)
images/<id>.png         an image as attached, its bytes unchanged
images/<id>.markup.json the MarkupSession's toJson() text, verbatim; present only while hasMarkup is true
```

`createDraftStore(files, log)` keeps the draft in memory after its first read. Every method runs on one serial queue
(each call chains onto the last call's promise, its own failure leaving the chain usable), and reads the draft
through that queue:

- First read: `files.read('draft.json')`. Missing (`isMissingFile`) → `emptyDraft(1)`. `parseDraft` null → log
  `[notes] draft.json unreadable; starting a fresh draft` and `emptyDraft(1)`. Nothing is written by a read.
- `saveFields`: `withFields`, then write `draft.json`.
- `addImage`: `withImageAdded`; `writeBytes('images/<id>.png')`; then write `draft.json`. Returns the new draft.
- `removeImage`: `withImageRemoved`; write `draft.json`; then trash `images/<id>.png` and, when the image had
  markup, `images/<id>.markup.json`. A failed trash logs `[notes] <path> not removed: <reason>` and the method still
  resolves.
- `image(id)` and `markup(id)`: an id the draft lacks throws `No image <id> in the draft`. `markup` returns null
  without a read when `hasMarkup` is false.
- `saveMarkup`: write `images/<id>.markup.json`; `withMarkup`; write `draft.json`.
- `clear`: the next draft is `emptyDraft(<old nextImageId>)`, set in memory first; write `draft.json`; then trash
  each old image's files as `removeImage` does. A failed `draft.json` write logs `[notes] draft not cleared: <reason>`
  and still resolves to the fresh draft, since the note was already sent.

## The sender

`toFollowup(request, flattened)`:

1. Read the draft. `sendRefusal(draft, request.type === 'create' ? 'followup' : 'append')` non-null →
   `{ type: 'refused', reason }`.
2. `flattened.length` differs from `draft.images.length` → throw `flattened holds <a> images; the draft holds <b>`.
3. The images: each `flattened[i]`, or `store.image(draft.images[i].id)` where it is null.
4. The line: `sessionLine(draft.session, paths, await homeDir)`, or null with no session.
5. The target: `create` → `{ type: 'create', title: draft.title.trim(), oneLine: firstSentence(draft.body), tags:
   draft.tags }`; `append` → `{ type: 'append', path: request.path, title: request.title }`.
6. `backlog.fileNote(draft.target, target, followupText(draft, line, request.type), images)`.
7. The result:
   - `applied` → `store.clear()`, then `{ type: 'sent', draft, toast }`, toast `Follow-up added: <title>` for create,
     `Added to <request.title>` for append.
   - `missing` → refused `No follow-up named <title>`.
   - `titleTaken` → refused `A follow-up named <title> already exists`.
   - `refused` → refused with its `reason`.
   - `fileNote` rejects → refused with `errorText(error)`.

`toSession(projectDir, flattened)`:

1. `sendRefusal(draft, 'session')` and the length check, as above.
2. The profile: `chat.profileOf(draft.session.sessionId)` when the draft names a session, else null; null → the
   first of `chat.profileNames()`; none → refused `Chat has no profiles`.
3. The message: `{ text: launchText(launchBrief(), draft, line), images }`, each image `{ mediaType: 'image/png',
   data: <base64 of its bytes> }` (`Buffer.from(bytes).toString('base64')`).
4. `chat.launch({ projectDir, profile, message })`. A rejection → refused with `errorText(error)`, the draft kept.
5. Resolved → `store.clear()`, then sent with toast `Session started in <paths.tilde(projectDir, home)>`.

GIVEN a draft attached to session `s1` that chat owns under profile `personal` WHEN `toSession` runs THEN `launch`
gets profile `personal`.
GIVEN a draft attached to a session chat does not own (`profileOf` returns null) and chat profiles `['work',
'personal']` WHEN `toSession` runs THEN `launch` gets profile `work`.
GIVEN `fileNote` resolves `{ type: 'refused', reason: 'outside the index' }` WHEN `toFollowup` runs THEN the result
is refused with `outside the index` and `draft.json` still holds the title and images.
GIVEN a draft of two images, the first with markup, and `flattened` `[<png A>, null]` WHEN `toFollowup` runs THEN
`fileNote` gets `[<png A>, <the second image's stored bytes>]` in that order.

## start.ts

`notesMainPart.start(api)`: build the store over `api.data` and `services.log`, the sender over it with
`api.dependency<BacklogMainExports>('backlog')`, `api.dependency<ChatMainExports>('chat')`, `() =>
api.settings().launchBrief`, `services.paths` and `services.files.realPath(services.homeDir)` (one promise, made at
start). Handle every channel method:

- `loadDraft` → `store.draft()`; `saveDraft` → `store.saveFields`; `image`, `addImage`, `removeImage`, `markup`,
  `saveMarkup` → the store method of the same meaning; `discard` → `store.clear()`.
- `capture` → `store.addImage(await services.window.capture())`.
- `homes` → `noteHomes(await backlog.load(), services.paths)`.
- `tags` → `backlog.tags()`.
- `sendToFollowup` → `sender.toFollowup`; `sendToSession` → `sender.toSession`.

Return `{ commands: {} }` (every command runs in the page). Task 09 adds the self-test script and the drive actions
here.

## Tests

- `draft-store.test.ts`, over `createMemoryFiles()`: a first read with no file gives `emptyDraft(1)`, and with bad
  JSON logs the pinned line; `addImage` writes `images/1.png` with the given bytes and `draft.json` lists image 1;
  `removeImage` drops it from `draft.json` and the PNG is gone; `saveMarkup` writes the JSON verbatim and sets
  `hasMarkup`; `markup` of an image with none returns null; an unknown id throws the pinned text; `clear` keeps
  `nextImageId` and removes every image file; two `saveFields` calls made at once leave the second's fields in
  `draft.json`; a fresh store over the same files reads the saved draft back (the reload case).
- `note-sender.test.ts`, over a memory-files store and fake `fileNote`, `launch`, `profileNames` and `profileOf`
  that record their calls: the four GIVEN lines above; a refusal from `sendRefusal` calls neither export; a `create`
  target carries `firstSentence` of the body and the trimmed title; `applied` clears the draft and the toast reads
  `Follow-up added: <title>`; `titleTaken` and `missing` map to the pinned texts; a `launch` rejection keeps the
  draft and passes its text; the launched message's text is `launchText`'s and its images are base64 PNGs; no
  profiles refuses with `Chat has no profiles`; a length mismatch throws the pinned text.
- `start.test.ts`, over a fake `MainApi` (as `src/plugins/docs/main/start.test.ts` builds one) with a fake
  `window.capture` resolving fixed bytes: `capture` adds an image holding those bytes; `homes` maps a fake
  `BacklogRead`; `tags` passes Backlog's list through.

## Proof

<written by wigley:make: commit sha, proof result, concerns; empty until the group lands>
