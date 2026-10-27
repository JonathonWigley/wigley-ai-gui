# Notes popup — plan

Feature: Notes popup · Implements: none · Ticket: none
Target: wigley-ai-gui `main` · Written: 2026-10-27

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Add the `notes` plugin to wigley-ai-gui. `Space n n` opens a modal note popup over any mode. The user writes a
nitpick, attaches images (paste, drop, or a capture of the GUI), marks the images up, and sends the note to a new
follow-up, to an existing follow-up, or to a new background agent session. The selected session attaches as a
reference, so a follow-up about a skill names the session it came from.

## Architecture

Systems touched, all in wigley-ai-gui:

- core: the main `window` service gains `capture`; a new markup contract and its Fabric adapter, handed to plugins
  as a page service.
- `docs`: its main exports gain a guarded binary write and a guarded trash.
- `chat`: its main part gains exports that launch a session without selecting it.
- `backlog`: its main part gains exports (homes, and a note filed as a follow-up with its images); its delete trashes
  an item's image folders; its commit takes the changed images.
- `notes`: the new plugin (main and page parts).

## Preconditions

Re-run each before the first dispatch:

- The Backlog plan is closed: `test ! -d docs/features/backlog/plan-backlog && test -f
  src/plugins/backlog/main/start.ts && test -f src/plugins/backlog/page/start.ts` (2026-10-27: a Backlog run is in
  progress in this tree; tasks 02 and 08–12 are open). Tasks 05, 07 and 08 build on its landed code, so this plan
  starts only after that run closes. When the landed Backlog code differs from the names in this plan (taken from
  its task 08), the lead records each difference as a contract change before dispatch.
- wigley-ai-gui is on `main`, not behind origin: `git fetch -q && git status -sb` (2026-10-27: ahead 14, not
  behind).
- The docs below are committed: `git log --oneline -1 d3b1df9` and `git log --oneline -1 23e41de` here and `git -C ../wigley-ai-marketplace log
  --oneline -1 b8ffb96`.
- `fabric` is not yet a dependency: `grep -c '"fabric"' package.json` prints `0`. `npm view fabric@7.4.0 version`
  prints `7.4.0`. The user approved installing `fabric@7.4.0` with its optional `canvas` and `jsdom` in the
  2026-10-26 interview (round 2); no other package is approved.
- `MainServices.window` holds `show`, `isFocused` and `chooseFolder` only (`src/contracts/plugin.ts`, measured at
  plan time, re-verify).
- No `FuzzyMatcher` exists yet (`test ! -d src/renderer/fzf`, measured at plan time): AGENTS.md describes it ahead
  of the slash-completion plan. Task 08's pickers use the list picker and filter chat and docs use today; when the
  slash-completion plan lands first, the lead records that its pickers are the ones task 08 builds on.
- The chat main part returns no `exports` (`grep -n exports src/plugins/chat/main/start.ts`, measured at plan time:
  none).

## Docs written ahead

- wigley-ai-gui `d3b1df9`: `docs/features/notes/design.md` (the settled design), `AGENTS.md` (the `notes` plugin,
  the `fabric/` markup adapter, Backlog's image folder and exports), `docs/keymap.md` (leader group `n`),
  `docs/features/backlog/design.md` (item images, their delete and commit, exports to notes).
- wigley-ai-gui `23e41de`: `docs/keymap.md` (the `n` row's popup binds, settled in round 3).
- wigley-ai-marketplace `b8ffb96`: `plugins/wigley/skills/review/triage.md` § The project's follow-ups (linked
  images and the source-session line). Its version bump folds into the unpushed bump the Backlog run made (its task
  07); the lead checks `plugins/wigley/.claude-plugin/plugin.json` against origin at preflight and bumps only when
  origin already has that version.

## Mandatory Reads

- `AGENTS.md` and `DESIGN.md` (every task; `DESIGN.md` for page work)
- `docs/features/notes/design.md` (every task)
- `docs/keymap.md` (task 08)
- `docs/features/backlog/design.md` (task 05)
- `.agents/skills/drive/SKILL.md` (task 11)
- No `CLAUDE*.md` or `.claude/rules/*.md` exists in the repo outside the git-ignored `.drive/` fixtures (`find .
  -name 'CLAUDE*.md' -not -path './node_modules/*' -not -path './.drive/*'`, measured at plan time).

## Design Overview

```
  Space n n ──► notes page: popup (createDialog)
                 │  Target · Title · Body (vim box) · Tags · images strip · session chip
                 │  image ──► markup view ── services.markup (MarkupEditor) ── src/renderer/fabric/ ── fabric
                 │  paste / drop ──► image bytes
                 │  capture ──► hide popup ─► channel.capture ─► main: services.window.capture() ─► reopen + attach
                 │
                 │ channel (notes contract)
                 ▼
               notes main: draft store (api.data: draft.json, images/<n>.png, images/<n>.markup.json)
                 ├─ to follow-up ── backlog main export fileNote(homeRoot, target, text, images)
                 │                    ├─ docs writeBytes  → <home>/followups-images/<folder>/<n>.png
                 │                    └─ applyFollowupEdit + docs writeDoc → <home>/followups.md
                 └─ to session ──── chat main export launch({ projectDir, profile, message })
                                      └─ new row, not selected; page toasts its label
```

Decisions (all in `docs/features/notes/design.md` unless named here):

- One kept draft, modal popup, three destinations, no global shortcut.
- Image sources: paste, drop, GUI capture.
- Images live beside the follow-ups file under `followups-images/<folder>/`; Backlog owns that folder.
- Fabric.js `7.4.0` behind one markup adapter; markup stays editable (its JSON kept) until send, and send flattens.
- The session line: `Source session: <harness label> <host session id> in <folder shown with ~>`.
- Launched sessions run in the background; the brief comes from the `notes.launchBrief` setting.
- `window.capture` extends the existing `window` main service rather than a new contract (agent, plan time): it is
  the window, and that service already holds the window's calls.
- `fileNote` is one deep Backlog export (agent, design review): Backlog names the folder, writes the images, links
  them, writes the follow-up, and trashes the images when the follow-up write fails, so no caller learns the folder
  or link shape.
- The image folder is `<UTC yyyyMMdd-HHmmss>-<title slug>`, fixed when the item first gets an image; an append to an
  item that already links a `followups-images/` folder reuses that folder and numbers on from its highest `<n>`
  (agent, plan time): a later title edit leaves the links valid.

Out of scope: a global shortcut; screen-region capture of other apps; sending into an open session; a list of saved
notes; images in rendered docs (an existing follow-up).

## File Structure

Existing files modified: `src/contracts/plugin.ts` (01, 02), `src/main/window.ts` (01), `src/renderer/renderer.ts`
(02), `package.json` and `package-lock.json` (02), `scripts/check-layers.mts` (02, 06: every notes `LAYERS` entry), `src/plugins/docs/contract.ts`
and `src/plugins/docs/main/start.ts` (03), `src/plugins/chat/contract.ts` and `src/plugins/chat/main/*` (04),
`src/plugins/sessions/contract.ts`, `src/plugins/sessions/main/session-list.ts` and `src/plugins/sessions/main/start.ts`
(04: `SessionsMainExports.open` takes `OpenOptions { select: boolean }`, since `open` selects the new row today),
`src/plugins/backlog/contract.ts` and `src/plugins/backlog/main/*` (05), `src/plugins/manifests.ts` and
`src/plugins/main.ts` (07), `src/plugins/page.ts` and `src/plugins/keymap.ts` (08), every place that builds a
`MainServices` or `PageServices` value for tests or the self-test (01, 02; each task greps for them).

New files:

- `src/contracts/markup.ts` — the markup seam; Fabric is a third-party library, so one contract and one adapter.
- `src/renderer/fabric/` — the Fabric adapter, the only `fabric` import.
- `src/shared/image-types.ts` (04) — the image types chat main, chat page and the notes page all accept; one list.
- `src/plugins/notes/` — the plugin: `manifest.ts`, `contract.ts`, `main/`, `page/`.

Names, signatures and types more than one task uses (every task's Consumes and Produces match these word for word):

```ts
// src/contracts/plugin.ts, MainServices.window (01)
capture(): Promise<Uint8Array>; // PNG of the window's content, as shown

// src/contracts/markup.ts (02)
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
// src/contracts/plugin.ts, PageServices.markup: MarkupEditor (02)

// src/plugins/docs/contract.ts, DocsMainExports (03)
writeBytes(path: string, bytes: Uint8Array): Promise<WriteResult>; // the write guard writeDoc uses; no changed-on-disk check
trashDoc(path: string): Promise<TrashResult>;                      // the channel's guarded trashDoc

// src/plugins/chat/contract.ts (04)
export interface LaunchRequest { projectDir: string; profile: string; message: UserMessage }
export interface ChatMainExports {
  // Starts a session and sends `message` as its first message; leaves the selected row as it was.
  // Resolves to the new row's sessionId.
  launch(request: LaunchRequest): Promise<string>;
  // Chat's profile names, in settings order.
  profileNames(): string[];
  // The profile of a session chat owns; null for any other session id.
  profileOf(sessionId: string): string | null;
}

// src/plugins/backlog/contract.ts (05)
export type NoteTarget =
  | { type: 'create'; title: string; oneLine: string; tags: string[] }
  | { type: 'append'; path: string; title: string };
export interface BacklogMainExports {
  load(): Promise<BacklogRead>;
  // The tag list Backlog's tag picker offers: the backlog `tags` setting as the user config now sets it.
  tags(): string[];
  // 'create' adds an item to the home's create-target file with `text` as its body; 'append' adds `text` to the
  // end of that item's body. Each PNG in `images` is saved under the home's followups-images/ and linked after
  // `text`. A refused or failed follow-up write trashes the images it saved.
  fileNote(homeRoot: string, target: NoteTarget, text: string, images: readonly Uint8Array[]): Promise<BacklogWriteResult>;
}
```

`BacklogRead`, `BacklogHome`, `BacklogWriteResult` and `FollowupItem` are the Backlog run's landed types
(its task 08, `src/plugins/backlog/contract.ts` and `src/shared/followups/followup-file.ts`).

Boundary rules:

- Only `src/renderer/fabric/` imports `fabric`.
- `notes` depends on `sessions`, `chat`, `backlog`, `keys` and `docs` only through their `contract.ts` and exports.
- Backlog alone writes under `followups-images/`; notes never builds a follow-up path or link.
- The notes page holds no file logic; the draft store and every write live in notes main.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Window capture](01-window-capture.md)
- [x] [Docs binary write and trash exports](03-docs-bytes.md)
- [x] [Chat launch export](04-chat-launch.md)
- [x] [Notes contract and pure modules](06-notes-core.md)

### Wave 2
- [x] [Markup contract and Fabric adapter](02-markup-adapter.md) — after 01 (shares `src/contracts/plugin.ts`), 06 (shares `scripts/check-layers.mts`)
- [x] [Backlog note filing](05-backlog-notes.md) — after 03

### Wave 3
- [x] [Notes main part](07-notes-main.md) — after 01, 04, 05, 06

### Wave 4
- [x] [Notes page part](08-notes-page.md) — after 02, 04, 07

### Wave 5
- [x] [Notes self-test](09-notes-selftest.md) — after 08

### Wave 6
- [x] [Doc re-read](10-doc-reread.md) — after every code task

### Wave 7
- [x] [Final verification](11-final-verification.md) — after 10

## Run log

Review base: 62cb6e9ed048d1e6aebf6629e8870abd37df98b8

### Groups
- 01 · b406450 · diff read: capture in MainServices.window and windowService; typecheck clean in its files (only failure is backlog start.test.ts DocsMainExports fake, from task 03 in flight) · concerns: none beyond the doc comment naming device pixels
- 04 · 009088b · diff read: ChatMainExports, LaunchRequest, OpenOptions and open(info, options?) present; moved names have no stale importers; typecheck clean in its files · concerns: AGENTS.md chat/ line does not name the new exports or image-rules.ts (for task 10 doc re-read); session-list.ts header comment line runs past the wrap width
- 06 · d2012f7 · diff read: every Produces export present in the named file; LAYERS entries as the task names; typecheck clean in notes · concerns: NotesChannel.invoke.tags() is the one sync signature in an IPC channel; PageChannel returns it as a Promise, so tasks 07/08 treat it as async
- 03 · c39ba2b · diff read: writeBytes and trashDoc in DocsMainExports and start.ts exports, DocFiles.writeBytes takes the write guard; typecheck clean except the backlog start.test.ts fake, fixed by the Backlog lead stub commit · concerns: task 03 Files missed src/plugins/backlog/main/start.test.ts, whose DocsMainExports fake needed the two members; the Backlog lead added the stubs by agreement
- 02 · 47e4908 · diff read: markup.ts verbatim, PageServices.markup, createFabricMarkupEditor in renderer.ts, history/fit-scale/png-data-url exports present, fabric layer only in src/renderer/fabric; typecheck clean · concerns: Fabric IText already stops Escape/Tab/arrows itself, so only typed characters needed the stop; hidden textarea lives in document.body; clearing a filled text on exit still adds one history step via object:modified; dispose removes the restored <canvas> rather than the wrapper; hiddenTextarea cast in the editing-entered handler
- 05 · 50fbdaa · diff read: NoteTarget, BacklogMainExports and exports present, every note-images export present, commitMessage takes imageFolders; typecheck clean · concerns: commit_HomeThroughSymlink test mock narrowed to answer only for docs/features once commit also asks for the images pathspec; tests use the existing /dev/r root
- 07 · dd55351 · diff read: notesManifest, notesMainPart, DraftStore/createDraftStore, NoteSender/createNoteSender present; appended last in manifests.ts and main.ts; typecheck clean; worker reports full lint clean · concerns: draft-store imageOf copies draft.ts private requireImage; note-sender repeats Pick a target first to narrow target; note-sender is the only non-test Buffer use under src/plugins
- 08 · 66955ed · diff read: notesPagePart appended in page.ts, paste helpers moved unchanged with chat importing them, keymap gains group n; typecheck and full lint clean; worker reports 187 tests pass · concerns: png-image.ts pngDataUrl copies src/renderer/fabric/png-data-url.ts; picker stacking over the dialog is a live check; an in-flight autosave is not awaited before send/discard/close, relying on main handling invokes in order; picker closed logs only on cancel
- 09 · 43fbe28 · diff read: notesSelfTestScript, addDriveActions present; start.ts hands the script to selfTest.run, adds drive actions in drive runs and disposes them, send waiters resolve on sent; typecheck clean · concerns: send signal in start.ts has no unit test; group 5 picks the follow-up by fuzzy filter Notes selftest, which a higher-ranked open follow-up from docs or Backlog steps could beat; local markRun copy of chat script helper
- 10 · 8fee070 · diff read: three gui docs trued and oxfmt clean; marketplace triage.md trued in f163f83, riding the unpushed 1.12.0 bump · concerns: notes/design.md line that the target is the launched session folder left as written though launchFolder takes a session folder when the home sits outside its clone; title-required and pick-another-row lines not checked against sendRefusal
- 11 · 3baf363 · lint, typecheck, 3604 unit tests, selftest all passed after the fit fix 3baf363; drive run passed popup over modes and restart, capture, markup, new follow-up with flattened PNG at image size, append reusing the folder, background launch keeping the selection; Backlog delete first FAILED because the drive run reseeded the fixture mid-run, re-check passed (other item kept, image folder trashed) · concerns: Space n c inside the body box in insert mode types " nc" instead of capturing; closing from insert mode takes three Escs; Discard breaks mid-word at 900px in the shared dialog actions row; picker over the dialog shows two outlines and covers the Target row; a fresh note right after a send opened with no target or session (after a restart removed the row); Docs-mode popup shown line not echoed in the drive output
### Contract changes
- commitMessage (Backlog landed): `(changes): string | null` as task 05 assumed → landed returns `string`, the plain subject `Follow-ups edited in Backlog` when nothing changed; task 05 adds `imageFolders: readonly string[]` and keeps `string`, so `commitMessage([], [])` returns the plain subject, not null · why: landed Backlog code · consumers: 05 · group lead (preflight for 05)
- writeFollowupEdit (Backlog landed): takes `edit: BacklogEdit`, whose `edit` variant carries `baseline: FollowupDraft`; an item on disk that differs from `baseline` returns `{ type: 'changed'; title; item }` and writes nothing → task 05 append passes the step-2 item (title, oneLine, tags, body) as `baseline`; a `changed` result trashes the images like any non-applied result and passes through · why: Backlog b804dd6 · consumers: 05, 07 · group lead (preflight for 05)
- BacklogDeps.files (Backlog landed): `Pick<Files, 'realPath'>` → task 05 widens it to `Pick<Files, 'realPath' | 'list'>` · why: landed shape · consumers: 05 · group lead (preflight for 05)
- LinkedImage: `{ folder; number }` → `{ folder; number; relative }`, `relative` the link target as written · why: delete and reuse resolve each link against the file's folder · consumers: none outside backlog · group 05
- pasted-images.ts: imports IMAGE_TYPES → does not (the moved helpers never read it); popup.ts imports it for the type check · why: unused import · consumers: none · group 08
- notesSelfTestScript result: { followups, send } → { folder, followups, send } · why: the no-session problem names the fixture folder, known only after realPath · consumers: none · group 09
### Rulings
- window.capture doc comment names device pixels beside "as the user sees it", so a consumer sizing the image knows — drop the clause if unwanted · group 01 · group 01
- ChatSessions.launch throws synchronously; the async export turns it into the rejection, so the reject tests use toThrow on ChatSessions.launch · group 04 · group 04
- launch checks images before the profile and harness lookups, so an over-cap image is refused even with an unknown profile; nothing opens either way · group 04 · group 04
- defaultTarget rule 2 ties on folder length go to the first home in order · group 06 · group 06
- firstSentence treats a line holding only whitespace, \r included, as blank, so CRLF bodies split the same as LF · group 06 · group 06
- test fixtures index the features home as a followup entry at <home>/followups.md, as a home follow-ups file is indexed · group 03 · group 03
- starting colour before the first setColour is the host computed color · group 02 · group 02
- text tool adds the IText on press and enters editing on release, since the press focus change would blur the textarea · group 02 · group 02
- while editing text every key without Ctrl/Alt/Cmd stops at the textarea, Tab and Enter included (unlike textBoxInput), since Enter types a newline in an IText · group 02 · group 02
- undo/redo move the history step at call time and queue only the load; a failed load rejects unhandled and later queued loads do not run · group 02 · group 02
- fileNote writes its text through applyEdit, adding the title-reads-back check, so an append to a hand-written bad title is refused and its images trashed · group 05 · group 05
- reuse and delete count only links resolving to a direct subfolder of <home>/followups-images/ · group 05 · group 05
- trash-on-failure runs only when at least one image was written · group 05 · group 05
- images pathspec is the fixed docs/features/followups-images, since landed Backlog makes an in-git home always docs/features · group 05 · group 05
- an images-only commit goes through; Nothing to commit only when no follow-up file and no image changed · group 05 · group 05
- toFollowup maps fileNote's landed `changed` result to refused `<request.title> changed on disk; send again`, keeping the draft — Backlog b804dd6 added the result after task 07 was written — the user re-sends once · lead
- check-layers gains a src/plugins/chat/contract.ts layer (imports src/contracts only), listed by the chat root, chat/main and chat/page — task 06's notes/main entry named it but no such layer existed — none · lead
- tags handler stays synchronous; MainChannel.handle accepts it and the page receives a Promise · group 07 · group 07
- clear with a failed draft.json write logs, returns the fresh draft and leaves old images untrashed, so the on-disk record never names missing files · group 07 · group 07
- realPath(homeDir) rejection logs and falls back to services.homeDir · group 07 · group 07
- store memory changes only after its disk write succeeds, except clear · group 07 · group 07
- off-screen flatten host is 50vw x 50vh at left -100vw, since notes has no length token · group 08 · group 08
- open loads only loadDraft and homes; the Tags picker calls tags() itself · group 08 · group 08
- picker closed: <title> logs only on cancel, as chat; a choice logs its own line, so task 09 must not wait for picker closed after a choice · group 08 · group 08
- append and session sends refuse with No features home at <repo or ~root> when the target names no current home · group 08 · group 08
- new lines: session none on remove, no image to mark up, No tags to pick toast; markup toolbar hides the actions row so a click cannot send mid-markup · group 08 · group 08
- every expect line in the task doc matches the landed page, so the doc is used as written · group 09 · group 09
- paths joined with node path as chat script does, since the deps hold no Paths · group 09 · group 09
- scrollsItself stays empty until a fit check flags the strip · group 09 · group 09
- drive data loss was the run itself: docs.connectSession rewrites the fixture follow-ups file (documented in the drive skill); no product change · lead · group 11
### Review rounds
### Test gate
- npm run lint, npm run typecheck, npm test (all 228 files: the plan names the full suite, and it runs in 4s), npm run selftest (task 11; runs every notes key path) · lint and typecheck clean, 3604 tests pass; selftest first run 1 FAIL (notes popup overflow at minimum width), fixed in 3baf363, re-run all passed
