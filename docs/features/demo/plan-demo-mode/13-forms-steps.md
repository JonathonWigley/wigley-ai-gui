# 13 — Agent forms steps

Status: in progress
Type: Parallel
Rung: deep · each form step crosses main and page through async seams (a form service in main, a page store that must show the demo form before a beat acts), adds two shared helpers and two new exports, and the notes step reroutes the popup's channel while it lives
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files paths are written from the `ai` repo root; every other path in this document is relative to `wigley-ai-gui/`.

Files:
- create `wigley-ai-gui/src/shared/agent-forms/demo-form.ts`
- test `wigley-ai-gui/src/shared/agent-forms/demo-form.test.ts`
- create `wigley-ai-gui/src/shared/page/demo-form-wait.ts`
- test `wigley-ai-gui/src/shared/page/demo-form-wait.test.ts`
- create `wigley-ai-gui/src/plugins/forms/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/forms/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/forms/main/start.ts`
- modify `wigley-ai-gui/src/plugins/forms/page/start.ts`
- modify `wigley-ai-gui/src/plugins/forms/contract.ts`
- test `wigley-ai-gui/src/plugins/forms/main/demo-steps.test.ts`
- test `wigley-ai-gui/src/plugins/forms/page/demo-steps.test.ts`
- create `wigley-ai-gui/src/plugins/primer/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/primer/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/primer/main/start.ts`
- modify `wigley-ai-gui/src/plugins/primer/page/start.ts`
- test `wigley-ai-gui/src/plugins/primer/main/demo-steps.test.ts`
- test `wigley-ai-gui/src/plugins/primer/page/demo-steps.test.ts`
- create `wigley-ai-gui/src/plugins/audio-picker/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/audio-picker/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/audio-picker/main/start.ts`
- modify `wigley-ai-gui/src/plugins/audio-picker/page/start.ts`
- modify `wigley-ai-gui/src/plugins/audio-picker/main/fixtures.ts`
- test `wigley-ai-gui/src/plugins/audio-picker/main/fixtures.test.ts`
- test `wigley-ai-gui/src/plugins/audio-picker/main/demo-steps.test.ts`
- test `wigley-ai-gui/src/plugins/audio-picker/page/demo-steps.test.ts`
- create `wigley-ai-gui/src/plugins/agent-commands/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/agent-commands/page/start.ts`
- create `wigley-ai-gui/src/plugins/agent-commands/page/demo-steps.ts`
- modify `wigley-ai-gui/src/plugins/agent-commands/main/start.ts`
- modify `wigley-ai-gui/src/plugins/agent-commands/main/tools.ts`
- modify `wigley-ai-gui/src/plugins/agent-commands/manifest.ts`
- test `wigley-ai-gui/src/plugins/agent-commands/main/demo-steps.test.ts`
- create `wigley-ai-gui/src/plugins/notes/main/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/notes/page/demo-steps.ts`
- create `wigley-ai-gui/src/plugins/notes/page/sample-note.ts`
- test `wigley-ai-gui/src/plugins/notes/page/sample-note.test.ts`
- modify `wigley-ai-gui/src/plugins/notes/page/popup.ts`
- modify `wigley-ai-gui/src/plugins/notes/page/start.ts`
- modify `wigley-ai-gui/src/plugins/notes/main/start.ts`
- test `wigley-ai-gui/src/plugins/notes/page/popup.test.ts`

The page parts list is not in this task's Files: 07 owns the part lists and adds the new
`agentCommandsPagePart`.

Consumes:
- `DemoStep`, `DemoStage`, `DemoBeat`, `DemoPageContext`, `DemoMainStep`, `DemoMainStage`, `DemoMainContext`, `DEMO_HARNESS_ID` in `src/contracts/demo.ts` ← 01
- `PageServices.demoSteps` and `MainServices.demoSteps` ← 01 (each `register` handle is filed in the part's registrations)
- the page-part and main-part harnesses give a working `services.demoSteps` ← 01
- `DemoMainContext.launchSession` ← 01 (the type; 06 implements it in the same wave: it launches on the demo profile, ephemeral, in the scratch folder)
- tree members:
  - `createAgentFormPreview` and `PreviewConnection` (`src/shared/agent-forms/agent-form-preview.ts:12,52`)
  - `AgentFormOwner` and `AgentFormService.startSession` (`src/contracts/agent-forms.ts:21`)
  - each form plugin's `previewService` in `main/start.ts`: a memory store, a quiet presenter, `NO_FORM_WAKE` (forms `src/plugins/forms/main/start.ts:140`, primer `src/plugins/primer/main/start.ts:119`, audio-picker `src/plugins/audio-picker/main/start.ts:149`)
  - `askConfirm` (`src/plugins/forms/main/confirm.ts`), `FormsMainExports.confirm` (`src/plugins/forms/contract.ts:597`)
  - `PREVIEW_ROUND_ARGS` (`src/plugins/forms/main/preview/preview-round.ts:6`), `PREVIEW_PRIMER_ARGS` (`src/plugins/primer/main/preview/preview-primer.ts:5`), `previewPickerArgs` (`src/plugins/audio-picker/main/preview/preview-picker.ts:8`), `SAMPLE_SOUNDS` and `writeSampleSounds` (`src/plugins/audio-picker/main/fixtures.ts`)
  - `activeForm` (`src/shared/page/session-forms.ts:160`), `ReducerStore.subscribe` returning `Disposable` (`src/shared/page/reducer-store.ts:10`), `Timers` (`src/contracts/ambient.ts:16`)
  - the page commands `forms.focusItem` (arg: 0-based rail position), `forms.openReview`, `forms.closeReview`, `forms.askCancel`, `forms.dismissConfirm`; `primer.selectTask`, `primer.selectItem`, `primer.needUnclear`, `primer.openReview`, `primer.closeReview`, `primer.dismissConfirm`; `audio-picker.selectRow`, `audio-picker.dismissConfirm` (each manifest's `commands`)
  - `SessionsPageExports.activate` (`src/plugins/sessions/contract.ts:668`), `SessionsMainExports.activate`
  - `confirmRequest` in `src/plugins/agent-commands/main/tools.ts:322` (not exported today)
  - `NotePopupDeps.channel: PageChannel<NotesChannel>` (`src/plugins/notes/page/popup.ts:97`), `NotesChannel` and `NOTE_FIELDS` (`src/plugins/notes/contract.ts:88,117`)

Produces:
- `src/shared/agent-forms/demo-form.ts`:
  - `export interface SampleFormDeps<Payload> { forms: AgentFormService<Payload>; activate(sessionId: string): void; log: (line: string) => void; noun: string }`
  - `export function openSampleForm<Payload>(deps: SampleFormDeps<Payload>, owner: AgentFormOwner, args: unknown): Disposable`
- `src/shared/page/demo-form-wait.ts`:
  - `export const DEMO_FORM_WAIT_MS = 5000`
  - `export interface DemoFormWaitDeps { store: { get(): SessionFormsState<SessionForm, string>; subscribe(listener: () => void): Disposable }; activate(sessionId: string): void; timers: Timers }`
  - `export function showDemoForm(deps: DemoFormWaitDeps, sessionId: string): Promise<boolean>`
- `src/plugins/forms/contract.ts`: `FormsMainExports.confirmSample(sessionId: string, request: ConfirmRequest, signal: AbortSignal): Promise<boolean>`
- `src/plugins/forms/main/demo-steps.ts`: `export function registerDemoSteps(services: MainServices, deps: FormsMainDemoDeps): Disposable`, `export interface FormsMainDemoDeps`, `export const DEMO_ROUND_ARGS: Record<string, unknown>`
- `src/plugins/forms/page/demo-steps.ts`: `export function registerDemoSteps(services: PageServices, deps: FormsPageDemoDeps): Disposable`, `export interface FormsPageDemoDeps`
- the same pair (`registerDemoSteps`, `<Plugin>MainDemoDeps` / `<Plugin>PageDemoDeps`) in `src/plugins/primer/`, `src/plugins/audio-picker/`, `src/plugins/agent-commands/` and `src/plugins/notes/`, under `main/demo-steps.ts` and `page/demo-steps.ts`; primer also exports `DEMO_PRIMER_ARGS`
- `src/plugins/audio-picker/main/fixtures.ts`: `export function writeSampleSoundsIn(files: Pick<Files, 'writeBytes'>, dir: string, paths: Pick<Paths, 'join'>): Promise<void>`
- `src/plugins/agent-commands/main/tools.ts`: `export function confirmRequest(deps: Pick<AgentCommandToolDeps, 'senderName'>, callerId: string, info: CommandInfo, session: string | undefined, arg: unknown): ConfirmRequest` — exported, its `deps` narrowed to the one member it reads; the existing callers pass their full deps unchanged
- `src/plugins/agent-commands/main/demo-steps.ts`: `export interface AgentCommandsMainDemoDeps { senderName(sessionId: string): string; list(): readonly CommandInfo[]; forms: Pick<FormsMainExports, 'confirmSample'>; log: (line: string) => void }`
- `src/plugins/agent-commands/page/start.ts`: `export const agentCommandsPagePart: PagePart<typeof agentCommandsManifest>`
- `src/plugins/notes/page/sample-note.ts`: `export interface SampleNoteDeps { session: NoteSession | null; drawImage(): Promise<Uint8Array> }`, `export function createSampleNoteChannel(deps: SampleNoteDeps): NoteDraftChannel`, `export const SAMPLE_NOTE: NoteDraft`
- `src/plugins/notes/page/popup.ts`: `export type NoteDraftChannel = Pick<PageChannel<NotesChannel>, 'invoke'>`; `NotePopupDeps.channel: NoteDraftChannel`; `NotePopup.showSample(channel: NoteDraftChannel): NoteSampleView`; `export interface NoteSampleView extends Disposable { show(field: NoteField): Promise<void> }`

## Shared pattern

Every step in this task follows the plan's per-plugin pattern (`plan.md` › Per-plugin step files) and these rules:

- **Main half builds the sample.** Each form step's main half launches one demo session with `context.launchSession(<text>)`, then opens a sample form on it through the plugin's own `previewService` (memory store, quiet presenter, `NO_FORM_WAKE`). The stage's sessions are `{ session: <id> }`.
- **No real store.** No step calls the agents' service, the folder store, `createLayoutPreview`, `createPrimerPreview`, the picker's layout preview or any `openPreview` command. The preview commands cycle the user's saved rounds (`store.recentArgs`) and have no uniform close (`plan.md` line 124).
- **Main dispose.** It ends the form and nothing more. It never closes the session: when the run leaves the step, the demo main (06) disposes the page stage, then the main stage, then closes every session id in the main stage's `sessions` map with chat's `close(id, 'finished')`. `'finished'` is not a user close, so no close guard asks.
- **Page beats.** Each beat first calls `showDemoForm(deps, context.sessions.session)`. On `false` it logs `demo form for <id> not shown` and does nothing more. Then it puts the form in the beat's whole state through the plugin's own page commands (`api.commands.run`), so the demo can show beats in any order.
- **Page dispose** runs the plugin's `dismissConfirm` and `closeReview` commands while the demo form is active, so a cancel confirm does not outlive the step.

### `openSampleForm`

It wraps `createAgentFormPreview` with a sessions shim:
- `connect` returns `{ session: owner, end() {} }`. The demo session already exists, so no row is connected and session-log writes no `terminalConnected` entry.
- `activate` is the given `deps.activate`.

It calls `ask(args)` once. A draft outcome collects again, as the preview does. A submit or a cancel ends the form and the connection, and logs `<noun> sample closed: <outcome>`. Its dispose ends an open form and does nothing on a closed one.

### `showDemoForm`

1. It calls `deps.activate(sessionId)`.
2. It resolves `true` when `activeForm(store.get())?.sessionId === sessionId`, checked now and on every store change.
3. It resolves `false` after `DEMO_FORM_WAIT_MS`. It drops its subscription and its timer on either outcome.

## Per-plugin values

### forms — step `forms.round`

| Field | Value |
|---|---|
| section | `forms` |
| order | `10` |
| title | `Review rounds` |
| caption | `Review rounds: an agent asks its questions, findings and notices in one form` |
| files | `src/plugins/forms/main/start.ts`, `src/plugins/forms/main/round-type.ts`, `src/plugins/forms/page/start.ts`, `src/plugins/forms/page/round-view.ts`, `src/plugins/forms/page/round-model.ts`, `src/plugins/forms/page/forms-commands.ts`, `src/shared/page/session-forms.ts` |

Main half:
- `launchSession('A sample session for the forms step.')`
- `openSampleForm` on forms' `withKnownLayouts(previewService, …)` with owner `{ id: <session id>, info: { sessionId: null, projectDir: null } }` and args `DEMO_ROUND_ARGS`.
- `DEMO_ROUND_ARGS` is `PREVIEW_ROUND_ARGS` with these two fields replaced:
  - `heading: 'Daily quests: first pass'`
  - `overview: 'A sample round for the demo; nothing answered here reaches an agent.'`

`createForms` in `src/plugins/forms/main/start.ts` also returns `samples` (the same `withKnownLayouts(previewService, …)` it hands the layout preview), so the step and `confirmSample` share one sample service.

Beats, in order. Rail positions follow `railItems` (`src/plugins/forms/page/round-model.ts:90`): findings first, then questions, then the one notices stop. With `PREVIEW_ROUND_ARGS` (3 findings, 2 questions, 3 notices; measured at plan time, re-verify), the positions are:

| name | show() |
|---|---|
| `Question` | `dismissConfirm`, `closeReview`, then `focusItem` 3 |
| `Finding` | `dismissConfirm`, `closeReview`, then `focusItem` 0 |
| `Notice` | `dismissConfirm`, `closeReview`, then `focusItem` 5 |
| `Review` | `dismissConfirm`, then `openReview` |
| `Cancel` | `dismissConfirm`, `openReview`, then `askCancel` |

`dismissConfirm` and `closeReview` apply only from their own view (`src/shared/page/session-forms.ts` reducer), so running them from any other view does nothing.

`FormsMainExports.confirmSample(sessionId, request, signal)`:
- It runs `askConfirm` on the sample service, with owner `{ id: sessionId, info: { sessionId: null, projectDir: null } }`, a fresh `randomHex` nonce, and no tool-use id.
- It ends the form in `finally`.
- It saves nothing and wakes nothing.
- It resolves the user's Allow (`true`) or Deny (`false`), and `false` on an abort.

### primer — step `primer.primer`

| Field | Value |
|---|---|
| section | `forms` |
| order | `20` |
| title | `Feature primer` |
| caption | `Feature primer: an agent lays out a feature's tasks for the user to confirm before planning` |
| files | `src/plugins/primer/main/start.ts`, `src/plugins/primer/main/primer-type.ts`, `src/plugins/primer/page/start.ts`, `src/plugins/primer/page/primer-view.ts`, `src/plugins/primer/page/primer-commands.ts`, `src/plugins/primer/page/primer-state.ts` |

Main half:
- `launchSession('A sample session for the primer step.')`
- `openSampleForm` on primer's `previewService`, with the same owner shape and args `DEMO_PRIMER_ARGS`.
- `DEMO_PRIMER_ARGS` is `PREVIEW_PRIMER_ARGS` with `feature` replaced:
  - `name: 'Daily quests'`
  - `slug: 'daily-quests'`
  - `spec: 'A sample primer for the demo; nothing confirmed here reaches an agent.'`
  - `summary: 'Three tasks and the standing tests, each with the need the agent sees.'`
  - `entries` unchanged

Beats. The `selectTask` arg is a 0-based position in `taskRows` (`src/plugins/primer/page/primer-state.ts:369`): 0 is the feature row, 1 is task `1` (`Quest data model`, need `yes`, six items). The `selectItem` arg is 1-based in the selected task's items. `entries` stay as `PREVIEW_PRIMER_ARGS` has them, so these positions hold.

| name | show() |
|---|---|
| `Tasks` | `dismissConfirm`, `closeReview`, then `selectTask` 1 |
| `Items` | `dismissConfirm`, `closeReview`, `selectTask` 1, then `selectItem` 3 (the long `Reset daily quests …` item) |
| `A need` | `dismissConfirm`, `closeReview`, `selectTask` 1, then `needUnclear` (task 1's need changes from `yes` to `unclear`, so the chip changes on screen) |
| `Review` | `dismissConfirm`, then `openReview` |

`needUnclear` on the sample changes only the sample form's memory store. A later beat keeps task 1 at `unclear`: no other beat shows a need.

### audio-picker — step `audio-picker.picker`

| Field | Value |
|---|---|
| section | `forms` |
| order | `30` |
| title | `Audio picker` |
| caption | `Audio picker: an agent offers sound candidates for each moment, to hear and choose` |
| files | `src/plugins/audio-picker/main/start.ts`, `src/plugins/audio-picker/main/fixtures.ts`, `src/plugins/audio-picker/page/start.ts`, `src/plugins/audio-picker/page/picker-view.ts`, `src/plugins/audio-picker/page/picker-commands.ts`, `src/plugins/audio-picker/page/picker-audio.ts` |

Main half:
1. Sound folder: `dir = paths.join(context.scratchDir, 'audio-picker', 'sample-sounds')`.
2. `writeSampleSoundsIn(services.files, dir, services.paths)` writes every `SAMPLE_SOUNDS` entry under `dir` through `Files.writeBytes`, which makes missing parent folders.
3. `launchSession('A sample session for the audio picker step.')`.
4. `openSampleForm` on the picker's `previewService` with args `previewPickerArgs(dir, services.paths)`, with two fields replaced:
   - `heading: 'Daily quests: sounds'`
   - `overview: 'A sample picker for the demo; nothing chosen here reaches an agent.'`

`writeSampleSounds(api.data)` stays as it is: `api.data` takes `/`-separated paths relative to the plugin data folder, and `paths.join` writes `\` on Windows. The two functions share only the `SAMPLE_SOUNDS` list. `writeSampleSoundsIn` joins `dir` and each file with `paths.join`, against `services.files`, which takes absolute paths.

Beats (`selectRow` arg `{ moment, row }`, both 0-based):

| name | show() |
|---|---|
| `Candidates` | `dismissConfirm`, then `selectRow` `{ moment: 0, row: 0 }` |
| `Choose` | `dismissConfirm`, then `selectRow` `{ moment: 1, row: 1 }` |
| `Broken file` | `dismissConfirm`, then `selectRow` `{ moment: 2, row: 0 }` (the moment whose candidate is `broken.wav`) |

No beat plays a sound. The user plays one with the picker's own keys.

### agent-commands — step `agent-commands.confirm`

| Field | Value |
|---|---|
| section | `forms` |
| order | `40` |
| title | `Agent commands` |
| caption | `Agent commands: an agent runs app commands, and a risky one waits on the user's Allow` |
| files | `src/plugins/agent-commands/main/tools.ts`, `src/plugins/agent-commands/main/start.ts`, `src/plugins/forms/main/confirm.ts`, `src/plugins/forms/page/forms-view.ts` |

Main half. `agentCommandsMainPart` calls `registerDemoSteps(api.services, deps)` with `AgentCommandsMainDemoDeps` built from what it already holds: `senderName` from chat, `list` from `api.commands.list()`, `forms` from its forms dependency, and its `log`.
1. `launchSession('A sample session for the agent commands step.')`.
2. It finds the `sessions.closeSession` entry in `deps.list()`. When none is listed, it logs `demo confirm: sessions.closeSession not listed`, asks nothing, and the stage's sessions are still `{ session: <id> }`; the page beat then shows the session with no confirm.
3. It builds the request with `confirmRequest(deps, <session id>, <that command info>, <session id>, undefined)` (`src/plugins/agent-commands/main/tools.ts:322`: caller, info, target session, argument), the same text a real `run_command` call shows.
4. It calls `forms.confirmSample(<session id>, request, <the stage's AbortController signal>)`.
5. The answer runs nothing. It is logged `sample confirm answered: allow` or `… deny`.
6. Dispose aborts the signal; 06 closes the session (§ Shared pattern).

Page half (new page part):
- `agentCommandsPagePart` starts and calls `registerDemoSteps(services, { activate: sessions.activate })`.
- The manifest changes:
  - `dependsOn.page` becomes `['sessions']`
  - the comment `Main only: it has no surface` becomes `Its page half holds only its demo step.`
- 07 lists `agentCommandsPagePart` in `pageParts` of `src/plugins/page.ts`, after `audioPickerPagePart`.

One beat:

| name | show() |
|---|---|
| `Allow or Deny` | `activate(context.sessions.session)` |

The confirm is the forms page's own `confirm` view for the active session, so the page half needs no forms store.

### notes — step `notes.note`

| Field | Value |
|---|---|
| section | `forms` |
| order | `50` |
| title | `Notes` |
| caption | `Notes: a quick note over any mode, filed as a follow-up or sent to a new session` |
| files | `src/plugins/notes/page/popup.ts`, `src/plugins/notes/page/popup-state.ts`, `src/plugins/notes/page/markup-view.ts`, `src/plugins/notes/main/start.ts`, `src/plugins/notes/main/note-sender.ts` |

Main half:
- `launchSession('A sample session for the notes step.')`, so the session chip names a demo row.
- The stage's sessions are `{ session: <id> }`. Dispose does nothing; 06 closes the session (§ Shared pattern).

Page half:
- `enter` builds `createSampleNoteChannel({ session, drawImage })`. `session` is `{ sessionId: <id>, harness: DEMO_HARNESS_ID, hostSessionId: <id>, projectDir: context.scratchDir }`. `drawImage` draws the sample image.
- It then calls `popup.showSample(channel)`.

`SAMPLE_NOTE`:
- `target: null`, `targetPicked: false`
- `title: 'Quest timer drifts'`
- `body: 'The daily quest timer shows one hour more after the device clock changes.'`
- `tags: ['bug']`, `session: null` (set from `deps.session`), `fresh: false`
- `images: [{ id: 1, hasMarkup: false }]`, `nextImageId: 2`

The sample channel is in memory and touches no main handler:
- `loadDraft` returns the sample.
- `saveDraft`, `addImage`, `removeImage` and `saveMarkup` change only the copy in memory.
- `discard` resets the copy to the sample.
- `image` returns `drawImage()`. `markup` returns null.
- `homes` returns `{ homes: [], message: 'A sample note files nowhere.' }`. `tags` returns `['bug', 'idea']`.
- `sendToFollowup` and `sendToSession` resolve `{ type: 'refused', reason: 'A sample note sends nothing.' }`.
- `capture` rejects with `A sample note captures nothing.`

`NotePopup.showSample(channel)` returns its view at once. It acts in this order:
1. A draft operation in flight (`inFlight` not null: a send, a capture or a discard): the view is inert. `show` logs `note sample not shown: <operation> in flight` and does nothing; dispose does nothing. `Space d r` tries again.
2. Phase `loading` (an `open` waiting on `loadDraft` and `homes`): it sets phase `closed` and writes the place (`isOpen: false`). The load's `isStillLoading` check then drops the real draft when it arrives, so it never lands in the sample.
3. Phase `open`: it calls `close()`. `close` starts `saveNow`, whose `saveDraft` invoke reaches the real channel at once, before step 5 changes the routing; `close` also writes the place (`isOpen: false`).
4. It waits for that save, when step 3 started one. A failed save makes the view inert: the routing does not change, `close`'s toast shows as today, the log reads `note sample not shown: draft not saved`, and the user's fields stay in the store for autosave.
5. It routes every `invoke` to `channel`. The markup view gets the same routed channel.
6. It skips `deps.placeChanged` while the sample shows, so the user's place stays `isOpen: false`.

`show(field)` first awaits steps 1 to 6. It then opens the popup at `field` with no box focused (as `open(restored)` does for a place), or moves the field cursor when open.

Dispose closes the popup (its save goes to the sample channel), routes back to the real channel, then lets place writes resume, in that order. It does not reopen the user's popup, so a reload shows what the user last saw. A dispose before step 5 cancels the routing change.

Beats:

| name | show() |
|---|---|
| `Target` | `show('target')` |
| `Body` | `show('body')` |
| `Images` | `show('images')` |
| `Session` | `show('session')` |

## Decisions

- **Sample service.** Each form step uses its plugin's existing `previewService` (memory store, quiet presenter, `NO_FORM_WAKE`). It never writes saved rounds and never wakes chat. The layout preview is not reused: it reads `store.recentArgs` (the user's saved rounds), and design.md § Rejected turns it down.
- **One shared opener.** `openSampleForm` sits in `src/shared/agent-forms/` beside `createAgentFormPreview`, and `showDemoForm` sits in `src/shared/page/` beside `session-forms.ts`, since three plugins use each. This adds two files outside the plugin folders that plan.md gives task 13; the report names it.
- **The demo form.** Its owner is the demo chat session, so the forms page shows it on the demo row. The connect shim makes no row: the demo session already has one.
- **Agent commands.** `confirmSample` is a new forms export, not a second `confirm`. `confirm` saves a round in the user's saved-rounds folder and wakes chat, through the agents' service. The sample request is built by `confirmRequest` itself, so the step shows the real wording.
- **Agent commands page part.** It is new because the confirm beat needs `sessions.activate` in the page, and a step's page half is required (`DemoStep`). It holds nothing else.
- **Notes reroute.** The sample routes the popup's channel and does not stand up a second popup. One popup keeps the `notes.open` toggle, the `popup` scope and the layout parts as they are. Closing a user's open draft first saves it, so no typing is lost.
- **No audio auto-play.** The picker plays only on the user's key, so autoplay does not make sound in a team demo.
- **Wait timeout.** 5000 ms (`DEMO_FORM_WAIT_MS`) covers a main launch and a form push. A miss logs and leaves the beat inert, so a slow machine does not fail the demo.
- **An answered sample is spent until Reset.** A submit or a cancel (the `Cancel` beat's confirm, an answer, the picker's keys) ends the sample form. Every beat after that, Previous included, waits `DEMO_FORM_WAIT_MS`, logs `demo form for <id> not shown` and does nothing. `Space d r` (`demo.reset`) enters the step again with a new form. The main half does not reopen the form, so an answer the user gives in a demo ends that form as it would end a real one.
- **Primer bases.** `selectTask` counts `taskRows` positions with the feature row at 0; `selectItem` counts items from 1. The beats use task 1 because its need is `yes`, so `needUnclear` changes what shows.
- **Notes order.** `showSample` closes and saves the user's popup on the real channel before it routes anything, abandons a load in flight, and refuses to start under a draft operation or after a failed save, so the user's draft never lands in the sample and the sample never lands in the user's draft.
- **Session close.** No stage closes its own session: 06 closes every session in a main stage's `sessions` map when the run leaves the step, after both stages are disposed.

GIVEN a demo session `s1` WHEN `openSampleForm` asks a round and the presenter returns a draft THEN it asks again; WHEN it returns submit THEN the form ends and the log reads `round sample closed: submit`.
GIVEN `openSampleForm` with an open form WHEN its Disposable is disposed THEN the form ends; WHEN disposed again THEN nothing happens.
GIVEN a store whose active form is another session WHEN `showDemoForm(deps, 's1')` runs and the store then makes `s1` active THEN it resolves `true` and `activate` was called with `s1`; GIVEN the store never does THEN it resolves `false` after 5000 ms and holds no subscription.
GIVEN the forms step entered WHEN the main half runs THEN nothing is written under the saved-rounds folder and the chat wake is never called.
GIVEN `confirmSample` asked WHEN the presenter answers Allow THEN it resolves `true`, the sample form ended, and the agents' service started no session.
GIVEN the agent-commands step entered WHEN the user allows THEN no command runs and the log reads `sample confirm answered: allow`.
GIVEN the audio-picker step entered WHEN the main half runs THEN each `SAMPLE_SOUNDS` file exists under `<scratchDir>/audio-picker/sample-sounds/` and nothing under the plugin's data folder changed.
GIVEN the notes sample shows WHEN a send to follow-up or to a session runs THEN it is refused with `A sample note sends nothing.` and the real channel's `invoke` is never called; WHEN the sample is disposed THEN the next `invoke` goes to the real channel and `placeChanged` fires again.
GIVEN the user's popup is open with a typed draft WHEN `showSample` runs THEN `saveDraft` reaches the real channel once before the sample shows, and the place written last reads `isOpen: false`.
GIVEN the popup is loading the real draft WHEN `showSample` runs and the load then resolves THEN the real draft does not show and the sample shows on `show`.
GIVEN a send in flight WHEN `showSample` runs and `show` is called THEN nothing opens and the log reads `note sample not shown: send in flight`.
GIVEN the first close's save fails WHEN `show` is called THEN nothing opens, and the next `invoke` still goes to the real channel.
GIVEN the forms sample was cancelled WHEN a beat runs THEN after 5000 ms it logs `demo form for <id> not shown` and runs no command.
GIVEN the agent-commands step entered with no `sessions.closeSession` listed THEN no confirm is asked and the log reads `demo confirm: sessions.closeSession not listed`.

## Tests

Follow the local naming style: `describe` by unit, `it` names the behaviour; tables through `it.each`.

- `src/shared/agent-forms/demo-form.test.ts`, with `scripted-presenter.ts` and `test-form-type.ts`:
  - `it.each` `'closes on a final outcome: $outcome'`, rows `submit` and `cancel`. Each asserts the form ended and the log line. Break: a final outcome that leaves the form open, so a stage leave hangs.
  - `'asks again after a draft'`. Break: a draft that ends the sample form.
  - `'dispose ends an open form once'`. Break: a dispose that throws on an ended form at Stop.
- `src/shared/page/demo-form-wait.test.ts`, with a fake store and fake timers:
  - `it.each` `'resolves $result when $name'`, rows: `{ name: 'the form is active already', result: true }`, `{ name: 'the form becomes active', result: true }`, `{ name: 'the form never shows', result: false }`. Each row also asserts the subscription is disposed. Break: a beat that acts on another session's form, or a leaked subscription.
- `src/plugins/forms/main/demo-steps.test.ts`, through the main-part harness:
  - `'entering forms.round asks the sample service and saves no round'`: the saved-rounds folder in the harness files stays empty, and the wake is not called. Break: a step wired to the agents' service.
  - `'DEMO_ROUND_ARGS keeps 3 findings, 2 questions and notices'`: asserts the counts the page rail positions rest on. Break: a sample edit that moves the page's `focusItem` positions.
  - `'confirmSample resolves the answer and starts no agent session'`.
  - `'leaving forms.round ends the form and closes no session'`. Break: a step that closes its own session, which 06 then closes again.
- `src/plugins/forms/page/demo-steps.test.ts`, with a fake store and a recording `runCommand`:
  - `it.each` `'beat $name runs $commands'`, one row per beat of the forms table, the `focusItem` args included. Break: a beat that depends on the beat before it.
  - `'a beat whose form never shows logs and runs nothing'`, with fake timers. Break: a beat that acts on another session's form.
  - `'dispose dismisses the confirm and closes the review while the demo form is active'`, and runs neither when another form is active.
  - `'the rail puts the first question at 3 and the notices at 5'`: `railItems` of a round with 3 findings, 2 questions and 3 notices, built with `./test-rounds`, holds a finding at 0, the first question at 3 and the notices stop at 5. Break: a rail order change that sends the `Question` and `Notice` beats to the wrong item.
- `src/plugins/primer/main/demo-steps.test.ts`, through the main-part harness: `'entering primer.primer asks the sample service and saves nothing'` — nothing is written under the harness files, and the wake is not called.
- `src/plugins/primer/page/demo-steps.test.ts` and `src/plugins/audio-picker/page/demo-steps.test.ts`, as the forms page test: `it.each` over each beat's command sequence (primer's `selectTask` 1 and `selectItem` 3; the picker's `selectRow` args), and the not-shown case.
- `src/plugins/audio-picker/main/demo-steps.test.ts`, through the main-part harness: `'entering audio-picker.picker writes the sounds under the scratch folder only'` — each `SAMPLE_SOUNDS` file exists under `<scratchDir>/audio-picker/sample-sounds/`, and the harness's plugin data holds no new file.
- `src/plugins/agent-commands/main/demo-steps.test.ts`: `it.each` `'answer $answer runs nothing'`, rows `allow` and `deny`. Each asserts no command handler ran and the log line. Break: a sample confirm that closes the demo session through the real tool path. Add `'a missing closeSession asks nothing'`.
- `src/plugins/audio-picker/main/fixtures.test.ts`: `'writeSampleSoundsIn writes every sample under the given folder'`. Break: sounds written under plugin data, which leaves them in the user's audio picker data.
- `src/plugins/notes/page/sample-note.test.ts`: `it.each` `'$call is refused or inert'`, rows `sendToFollowup`, `sendToSession`, `capture`, `discard`. Break: a sample action that reaches main.
- `src/plugins/notes/page/popup.test.ts`:
  - `'showSample routes invoke to the sample and back at dispose'`
  - `'showSample saves an open draft to the real channel first'`
  - `'showSample skips placeChanged while it shows'`
  - `'showSample writes the closed place before it skips place writes'`
  - `'showSample during a load drops the real draft'`
  - `'showSample stays inert while a draft operation is in flight'`
  - `'showSample keeps the real channel when the first save fails'`
  - `'dispose leaves the user popup closed'`

  Breaks: a sample that writes the user's draft, loses the user's typing, overwrites the user's saved place, or reopens a popup the user no longer sees.

Done when: `npm run typecheck` and the tests above pass; `npm run lint` passes apart from the known composition-root failure of `scripts/check-layers.mts` naming `agentCommandsPagePart`, which stays until 07 lists it (plan.md Boundary rules); the gate records that failure as known and does not edit `src/plugins/page.ts`; `grep -rln "registerDemoSteps" src/plugins/forms src/plugins/primer src/plugins/audio-picker src/plugins/agent-commands src/plugins/notes` lists a `demo-steps.ts` in each of the five plugins.

Commit: one commit for the group.

## Proof
