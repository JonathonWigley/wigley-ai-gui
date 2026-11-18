# 12 — Session extras steps

Status: not started
Type: Parallel
Rung: deep · changes what session-log and session-stash save, and what usage publishes to its slot across the poller's life
Wave: 2 · Depends on: 01, 02 (both modify `src/plugins/usage/main/start.ts`: 02 makes the poller skip unlisted profiles, this task adds the sample snapshot), 03 (both modify `src/plugins/session-log/main/start.ts` and `src/plugins/session-stash/main/session-stash.ts`: 03's `ephemeral` skip keeps demo sessions out of both, this task adds the sample sections)
Plan: [plan.md](plan.md)

The demo steps of seven plugins: session-log, session-stash, agent-skills, context-sources, usage
and usage-tab-line in section `sessions`, and live-view in section `live`. The reference pattern
is task 11's (`11-session-chat-steps.md` § Reference pattern); this task follows it word for word
and lists only each plugin's own values.

Files paths are written from the `ai` repo root; every other path is relative to `wigley-ai-gui/`.

Files:
- create `wigley-ai-gui/src/shared/page/demo-start-prompt.ts` · test `wigley-ai-gui/src/shared/page/demo-start-prompt.test.ts`
- create `wigley-ai-gui/src/plugins/session-log/page/start.ts` · create `wigley-ai-gui/src/plugins/session-log/page/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/session-log/main/start.ts` · modify `wigley-ai-gui/src/plugins/session-log/main/recently-closed.ts` · modify `wigley-ai-gui/src/plugins/session-log/manifest.ts` · test `wigley-ai-gui/src/plugins/session-log/main/start.test.ts` · test `wigley-ai-gui/src/plugins/session-log/main/recently-closed.test.ts`
- create `wigley-ai-gui/src/plugins/session-stash/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/session-stash/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/session-stash/page/start.ts` · modify `wigley-ai-gui/src/plugins/session-stash/main/start.ts` · modify `wigley-ai-gui/src/plugins/session-stash/main/session-stash.ts` · test `wigley-ai-gui/src/plugins/session-stash/main/session-stash.test.ts` · test `wigley-ai-gui/src/plugins/session-stash/page/demo-steps.test.ts`
- create `wigley-ai-gui/src/plugins/agent-skills/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/agent-skills/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/agent-skills/page/start.ts` · modify `wigley-ai-gui/src/plugins/agent-skills/main/start.ts` · modify `wigley-ai-gui/src/plugins/agent-skills/manifest.ts`
- create `wigley-ai-gui/src/plugins/context-sources/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/context-sources/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/context-sources/page/start.ts` · modify `wigley-ai-gui/src/plugins/context-sources/main/start.ts` · modify `wigley-ai-gui/src/plugins/context-sources/manifest.ts`
- create `wigley-ai-gui/src/plugins/usage/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/usage/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/usage/page/start.ts` · modify `wigley-ai-gui/src/plugins/usage/main/start.ts` · test `wigley-ai-gui/src/plugins/usage/main/start.test.ts` · test `wigley-ai-gui/src/plugins/usage/page/start.test.ts`
- create `wigley-ai-gui/src/plugins/usage-tab-line/main/start.ts` · create `wigley-ai-gui/src/plugins/usage-tab-line/main/demo-steps.ts` · create `wigley-ai-gui/src/plugins/usage-tab-line/page/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/usage-tab-line/page/start.ts` · modify `wigley-ai-gui/src/plugins/usage-tab-line/manifest.ts`
- create `wigley-ai-gui/src/plugins/live-view/page/demo-steps.ts` · create `wigley-ai-gui/src/plugins/live-view/main/demo-steps.ts` · modify `wigley-ai-gui/src/plugins/live-view/page/start.ts` · modify `wigley-ai-gui/src/plugins/live-view/main/start.ts` · modify `wigley-ai-gui/src/plugins/live-view/window-pick.ts` · modify `wigley-ai-gui/src/plugins/live-view/manifest.ts` · test `wigley-ai-gui/src/plugins/live-view/window-pick.test.ts`

The page and main parts lists are not in this task's Files: 07 owns both part lists and adds the
new `sessionLogPagePart` and `usageTabLineMainPart`. See Produces.

Consumes:
- `DemoStep`, `DemoStage`, `DemoBeat`, `DemoPageContext`, `DemoMainStep`, `DemoMainStage`, `DemoMainContext`, `DEMO_HARNESS_ID`, `DEMO_PROFILE` from `src/contracts/demo.ts` ← 01
- `PageServices.demoSteps`, `MainServices.demoSteps` ← 01
- the poller's skip of unlisted profiles in `src/plugins/usage/main/start.ts` ← 02 (this task edits the same file after it)
- session-log's and session-stash's skip of events flagged `ephemeral` ← 03 (demo sessions launch ephemeral; this task adds no check of its own)
- `ChatPageExports.showHubForNow(sectionId: string): Disposable` ← 03
- in the tree: `ResumeSection`, `ResumeSectionRow` (`src/plugins/chat/contract.ts:241`, `264`); `ChatMainExports.send`; `SessionsPageExports.activate`; `usageFixture` (`src/plugins/usage/main/usage-fixture.ts`); `livePicksSlot` (`src/plugins/live-view/contract.ts`); `pickEditorWindow` (`src/plugins/live-view/window-pick.ts:53`); `WindowList`, `ScreenCapture.listWindows` (`src/contracts/screen-capture.ts`); `FAKE_CONTEXT_TEXT` (`src/shared/fake-agent-harness.ts:113`); `createNoteDialog`'s `open`, `cancel`, `isOpen` (`src/plugins/session-stash/page/note-dialog.ts`); `SessionsPageExports.shownSessionId` (`src/plugins/sessions/contract.ts`); `coreScopeSlot` (`src/contracts/core-state.ts:22`) and `SlotReader` (`src/contracts/state.ts:81`); `Timers` (`src/contracts/ambient.ts`)

Produces:
- `registerDemoSteps(services, deps): Disposable` in each `page/demo-steps.ts` and `main/demo-steps.ts` listed under Files, as task 11's pattern gives.
- `export const sessionLogPagePart: PagePart<typeof sessionLogManifest>` in `src/plugins/session-log/page/start.ts`; 07 adds it to `src/plugins/page.ts`.
- `export const usageTabLineMainPart: MainPart<typeof usageTabLineManifest>` in `src/plugins/usage-tab-line/main/start.ts`; 07 adds it to `src/plugins/main.ts`.
- `src/shared/page/demo-start-prompt.ts`: `export const DEMO_PROMPT_WAIT_MS = 5000`; `export interface DemoStartPromptDeps { runCommand(id: string): void; scope: SlotReader<ViewScope>; timers: Timers; log(line: string): void }`; `export interface DemoStartPrompt extends Disposable { open(): Promise<boolean>; isOpen(): boolean; cancel(): void }`; `export function demoStartPrompt(deps: DemoStartPromptDeps): DemoStartPrompt`
- `export function sampleRecentlyClosed(now: number, count: number, projectDir: string, isResumable: (hostSessionId: string) => boolean): ResumeSectionRow[]` in `src/plugins/session-log/main/recently-closed.ts`
- `export function sampleStashRows(now: number, projectDir: string, isResumable: (hostSessionId: string) => boolean): ResumeSectionRow[]` in `src/plugins/session-stash/main/session-stash.ts`; `SessionStashDeps` gains `isDemoRunning(): boolean` and `sampleProjectDir: string`
- `export function demoStreamPick(list: WindowList, ownProcessId: number): LivePick | null` in `src/plugins/live-view/window-pick.ts`
- The step ids: `session-log.recentlyClosed`, `session-stash.stash`, `agent-skills.skills`, `context-sources.context`, `usage.meters`, `usage-tab-line.line`, `live-view.stream`.

## Steps by plugin

"The demo runs" below means `services.agentHarnesses.get(DEMO_HARNESS_ID) !== null`: the demo
main registers the demo harness at start and disposes it at Stop (plan.md Run lifecycle). The
sample project folder of the resume rows is `paths.join(services.homeDir, 'dev', 'sample-app')`;
the prompt shows it as `~/dev/sample-app`.

| Step id | section | order | title | caption |
|---|---|---|---|---|
| `session-log.recentlyClosed` | `sessions` | 130 | `Recently closed` | `The start prompt offers the sessions the user closed lately, to resume.` |
| `session-stash.stash` | `sessions` | 140 | `Stash` | `Stashing closes a session with a note, and the start prompt offers it back.` |
| `agent-skills.skills` | `sessions` | 150 | `Skills` | `The session hub lists the skills the agent loaded in the session.` |
| `context-sources.context` | `sessions` | 160 | `Context` | `The session hub breaks the context window down by source.` |
| `usage.meters` | `sessions` | 170 | `Usage` | `Plan usage sits in the status bar, and each session shows its context and spend.` |
| `usage-tab-line.line` | `sessions` | 180 | `Usage in the tab bar` | `Each session's usage line can also sit in its tab bar.` |
| `live-view.stream` | `live` | 10 | `Live view` | `The session hub streams a window live, such as the Unity editor while an agent plays the game.` |

### The start prompt in a stage

The session-log and session-stash steps open chat's start prompt. `chat.newSession` opens it later: the prompt shows only after it reads its sections (`src/plugins/chat/page/start-prompt.ts`, `openPrompt`). Both steps reach it through one `demoStartPrompt` handle per stage, in `src/shared/page/demo-start-prompt.ts`. The prompt shows while the page key scope (`coreScopeSlot`) reads `chat.picker`.

- `open()`: when `isOpen()` is true, it resolves `true` at once. Else it runs `chat.newSession` and resolves `true` once the scope reads `chat.picker`, checked now and on each scope change. It resolves `false` after `DEMO_PROMPT_WAIT_MS` and logs `demo start prompt not shown`. It drops its subscription and its timer on either outcome.
- `isOpen()`: true from `open`'s `true` until the scope leaves `chat.picker` (the user's Esc or pick, or `cancel`). The next `open` then runs `chat.newSession` again.
- `cancel()`: runs `chat.pickerCancel` when `isOpen()`. While an `open` still waits, the wait runs `chat.pickerCancel` the moment the prompt shows and resolves `false`, so a prompt that shows after the stage left is closed.
- `dispose()`: `cancel()`. A wait still running keeps its subscription until it ends.
- The page deps of both steps carry `runCommand`, `scope` (`api.state.read(coreScopeSlot)`), the part's `timers` and its `log`; the stage builds the handle in `enter`.

### session-log

- Sample section: in `src/plugins/session-log/main/start.ts`, the Recently closed section's `rows` answers `sampleRecentlyClosed(now, recentlyClosedCount, sampleProjectDir, isResumable)` while the demo runs, and reads no log. Otherwise it answers as now.
- `sampleRecentlyClosed` builds these rows, oldest first, each `profile: DEMO_PROFILE`, `harness: DEMO_HARNESS_ID`, `projectDir` the sample folder; it first drops the rows `isResumable` refuses, then keeps the newest `Math.floor(count)` of the rows left (none for 0 or less), as `recentlyClosed` caps only rows that show:

  | hostSessionId | title | at |
  |---|---|---|
  | `demo-closed-1` | `Write the release notes` | `now - 86_400_000` |
  | `demo-closed-2` | `Profile the sidebar redraw` | `now - 7_200_000` |
  | `demo-closed-3` | `Fix the flaky upload test` | `now - 900_000` |

- Demo sessions stay out of the log through 03: their chat events carry `ephemeral: true`, and session-log appends nothing for them. This task adds no check of its own. Demo sessions are owned rows, so the `sessions.connected` handler already skips them.
- New page part `src/plugins/session-log/page/start.ts`: `sessionLogPagePart` calls `registerDemoSteps(api.services, { runCommand: (id) => api.commands.run(id), scope: api.state.read(coreScopeSlot), timers, log })` (§ The start prompt in a stage) and returns `{ commands: {} }`. The manifest keeps `dependsOn.page: []`, and its comment drops "Main only: it has no surface and no layout" for a line that names the page part as the demo step's only.
- `session-log.recentlyClosed`
  - files: `src/plugins/session-log/main/recently-closed.ts`, `src/plugins/chat/page/start-prompt.ts`
  - no main half
  - beat `recently closed`: `await prompt.open()` (the start prompt, with its resume sections)
  - dispose: `prompt.dispose()`

### session-stash

- `createSessionStash` (`src/plugins/session-stash/main/session-stash.ts`):
  - `rows` answers `sampleStashRows(deps.now(), deps.sampleProjectDir, isResumable)` while `deps.isDemoRunning()`, and reads no record.
  - `start.ts` passes `isDemoRunning: () => services.agentHarnesses.get(DEMO_HARNESS_ID) !== null` and the sample folder.
- `sampleStashRows` builds these rows, oldest first, each `profile: DEMO_PROFILE`, `harness: DEMO_HARNESS_ID`, `projectDir` the sample folder, and drops the rows `isResumable` refuses:

  | hostSessionId | title | note | at |
  |---|---|---|---|
  | `demo-stash-1` | `Spike the offline cache` | `Paused until the sync API settles.` | `now - 172_800_000` |
  | `demo-stash-2` | `Tidy the settings form` | `Halfway through the field layout.` | `now - 10_800_000` |

- `session-stash.stash`
  - files: `src/plugins/session-stash/page/note-dialog.ts`, `src/plugins/session-stash/main/session-stash.ts`
  - main key: `session` ← `Plan the next change.`
  - page deps: `activate`, `shownSessionId` (sessions' page export), `hasRow(sessionId): boolean` (true while `sessionsRowsSlot` holds the id; the part already reads that slot), `nameOf` (the function at `src/plugins/session-stash/page/start.ts`), `noteDialog: Pick<…, 'open' | 'cancel' | 'isOpen'>`, and the start-prompt deps (§ The start prompt in a stage)
  - beats:
    - `note`:
      1. `prompt.cancel()`.
      2. When `hasRow(session)` is false, it logs `demo stash session gone` and does nothing more.
      3. It activates `session`, then waits until `shownSessionId() === session`, checked now and every 100 ms through `timers`, for at most 5000 ms. A miss logs `demo stash session not shown` and does nothing more. The dialog cancels itself when the key base scope changes (`scope.onBaseChanged` in `note-dialog.ts`), and an activation from another mode changes it, so the dialog opens only after the session shows.
      4. When `noteDialog.isOpen()` is false, it calls `noteDialog.open({ sessionId: session, name: nameOf(session) })`, then blurs the focused element (`if (document.activeElement instanceof HTMLElement) document.activeElement.blur()`). `open` focuses the note box, and a focused box takes `Space d n` and `Space d p` as typed text; the `note` scope's Enter and Esc still accept and cancel.
    - `stashed in the prompt`: `noteDialog.cancel()` when `isOpen()`; then `await prompt.open()`.
  - dispose: `noteDialog.cancel()` when `isOpen()`; `prompt.dispose()`
  - An accept in the dialog closes the demo session as any stash does; `closed` then drops the stash, since the close event is flagged `ephemeral` (03), so nothing is saved. The step's session is then gone until `Space d r` (`demo.reset`) enters the step again with a new session: `note` logs `demo stash session gone` and opens nothing, and `stashed in the prompt` still opens the prompt. 06 closes the gone id at leave as it closes any step's sessions.

### agent-skills

- `agent-skills.skills`
  - files: `src/plugins/agent-skills/page/skill-list.ts`, `src/plugins/agent-skills/layouts/default/layout.js`
  - main deps: `chat: Pick<ChatMainExports, 'send'>` (agent-skills main already holds chat)
  - main key: `session` ← `/wigley:explore Map the session list.`; then `chat.send(session, { text: '/wigley:writing-code', images: [] })`, which queues behind the first turn. Each typed `/<skill>` makes the fake emit `skillStarted` (`src/shared/fake-agent-harness.ts:48-49`).
  - page deps: `activate`, `showHubForNow` (the chat page export the part already holds); the manifest's `dependsOn.page` becomes `['chat', 'sessions']`
  - `enter` takes `showHubForNow('agent-skills.list')` (the side part's id, `src/plugins/agent-skills/page/skill-list.ts:124`); the stage's dispose disposes it
  - beat `skills`: activates `session`

### context-sources

- `context-sources.context`
  - files: `src/plugins/context-sources/page/context-section.ts`, `src/plugins/context-sources/page/breakdown-input.ts`
  - main key: `session` ← `FAKE_CONTEXT_TEXT` (the echo turn, then `fakeContextBreakdownEvent`: 128k of a 1M window)
  - page deps: `activate`, `showHubForNow` (the chat page export the part already holds); the manifest's `dependsOn.page` becomes `['chat', 'sessions']`
  - `enter` takes `showHubForNow('context-sources.breakdown')` (the side part's id, `src/plugins/context-sources/page/context-section.ts:151`); the stage's dispose disposes it
  - beat `sources`: activates `session`

### usage

- Sample snapshot in `src/plugins/usage/main/start.ts`:
  - The part keeps its own snapshot in a variable, `real`, which `apply`, `seed` and the folds change as they change the slot now. It publishes `sample ?? real` to `usage.snapshot` on each change. `snapshot()` (the self-test's, the drive actions' and `sessionUsage`'s reader) reads `real`.
  - `showSample(sample: UsageSnapshot): Disposable` publishes `sample` until its dispose, then publishes `real` again. A second call replaces the first sample; an older handle's dispose then does nothing. The poller, the live rows and the folds keep running under the sample.
  - At start, `real` takes the slot's value or `EMPTY_USAGE_STATE.snapshot`, as now. The part's `dispose` publishes `real` when a sample shows, so a restart never takes a sample for the real snapshot.
- Page, in `src/plugins/usage/page/start.ts`: `setDetailsShown(shown: boolean)` opens or closes the details as `toggleDetails` does (`:247-258`), and writes nothing to `uiState`. `detailsShown(): boolean` returns the closure's `detailsOpen`. `toggleDetails` stays as it is.
- `usage.meters`
  - files: `src/plugins/usage/page/usage-view-model.ts`, `src/plugins/usage/main/usage-fixture.ts`, `src/plugins/usage/layouts/default/layout.js`
  - main deps: `clock`, `showSample`
  - main key: `session` ← `Plan the next change.`; then `showSample(usageFixture('fresh', clock.now(), session))`
  - main dispose: the sample handle's dispose
  - page deps: `activate`, `setDetailsShown`, `detailsShown`. `registerDemoSteps` runs once at the part's start, so the step reads the value in `enter`, never from deps.
  - `enter` keeps `before = detailsShown()` and `lastSet = before`.
  - beats: `meters` activates `session`, then `setDetailsShown(before)`; `details` activates `session`, then `setDetailsShown(true)`. Each beat sets `lastSet` to the value it set.
  - dispose: `setDetailsShown(before)` when `detailsShown() === lastSet`. When they differ the user toggled the details during the step, and the dispose leaves the user's choice.
  - The demo profile is unlisted, so the poller never reads it (02); the step shows the fixture's plans `work` and `personal` and its session line, never a poll of the user's profiles.

### usage-tab-line

- New main part `src/plugins/usage-tab-line/main/start.ts`: `usageTabLineMainPart` calls `registerDemoSteps(api.services, {})` and returns `{ commands: {} }`. The manifest keeps `dependsOn.main: []`; its comment drops "a page-only plugin" for a line that names the main part as the demo step's only.
- `usage-tab-line.line`
  - files: `src/plugins/usage-tab-line/page/start.ts`, `src/plugins/usage/page/session-line-parts.ts`
  - main key: `session` ← `Plan the next change.` (its echo turn reports a `usage` event, so the line reads a context)
  - page deps: `activate` (the sessions page export the part already holds)
  - beat `tab line`: activates `session`
  - usage-tab-line is off by default; the run starts it in memory (01, 06).

### live-view

- `demoStreamPick(list, ownProcessId)` in `src/plugins/live-view/window-pick.ts`:
  - `blocked` access → `{ kind: 'blocked' }` (the section shows its Screen Recording line and button)
  - else the first window, front to back, whose `title` matches `/ - Unity \d/` names the Unity editor's process; the pick streams that process's largest window (`pickEditorWindow(windows, processId, null)`), `summary: 'Unity editor'`, `crop: null`
  - else the largest window of `ownProcessId`, `summary: 'This app'`, `crop: null`
  - else null
  - `windowSize` is the picked window's bounds' width and height, as `pickOf` writes it.
- `live-view.stream`
  - files: `src/plugins/live-view/page/live-section.ts`, `src/plugins/live-view/window-pick.ts`
  - main deps: `screenCapture` (`services.screenCapture`), `picks` (the `livePicksSlot` writer of `src/plugins/live-view/main/start.ts`), `ownProcessId: number` (`process.pid` of the main process, which owns the app's window), `log`
  - main key: `session` ← `Watch the game.`; then `listWindows()`, `demoStreamPick(list, ownProcessId)`, and `picks.set(session, pick)` for a pick. A null pick logs `demo live view: no window to stream`; a rejected list logs `demo live view: windows not listed: <error>`. The section then stays hidden.
  - main dispose: `picks.delete(session)`. The page streams only while the session's key is set and the section is on screen (`src/plugins/live-view/page/live-section.ts`), so the stream stops when the step is left.
  - page deps: `activate`, `showHubForNow` (the chat page export the part already holds); the manifest's `dependsOn.page` becomes `['chat', 'sessions']`
  - `enter` takes `showHubForNow('live-view.section')` (the side part's id, `src/plugins/live-view/page/live-section.ts:441`); the stage's dispose disposes it
  - beat `stream`: activates `session`, `dwellSeconds: 8`

Decisions:
- The resume sections show their samples, never the user's rows, for as long as the demo runs, not only during their own steps: the start prompt can open during any step, and the user asked that a demo never show saved sessions (round 1; design.md § Real state stays untouched). The sample rows carry `DEMO_PROFILE`, and the start prompt resumes none of them (task 11).
- Demo sessions never reach session-log's event log or session-stash's file through task 03's `ephemeral` flag alone: this task adds no `DEMO_PROFILE` check to either plugin, so one rule keeps them out.
- The usage step publishes a sample over the real snapshot instead of seeding it: `seed` stops the poller for the app's life (`src/plugins/usage/main/start.ts`, `seed`), and the live app must keep polling after the demo.
- The details panel opens for the `details` beat without writing `uiState`, so the user's choice of open or closed survives a demo that stops mid-step.
- The `agent-skills`, `context-sources` and `live-view` captions promise the session hub. Each step holds `showHubForNow` (03) on its own section from `enter` to the stage's dispose, so the hub and the section show even when the user hid the hub or collapsed the section, and the user's `hub-hidden` and `collapsed-sections` uiState are never written (lead ruling on the cold read's gap 6, option c). The hub still hides in a tab narrower than 640 px (03).
- The live view picks the Unity editor by its window title, since the window list carries no process name (`CaptureWindow`, `src/contracts/screen-capture.ts:10`), and the app's own window by `process.pid` of main. No service exposes the app's pid today.
- The live view's beat dwells 8 seconds, so a stream that takes a moment to start shows during autoplay.
- The start prompt is tracked by the key scope, not by the commands that open and close it: `chat.newSession` shows the prompt only after its reads settle, so a stage that left before then would leave the prompt open. One shared handle (`src/shared/page/demo-start-prompt.ts`) serves session-log and session-stash, since neither plugin may import the other. This adds one file outside the plugin folders that plan.md gives task 12; the report names it.
- The stash dialog opens only after its session shows, and with no box focused, so the dialog lives through the activation and the demo keys still work.
- An accepted stash spends the step until Reset: the demo session is closed, and the step does not launch another one from the page.

GIVEN the demo runs WHEN chat asks the Recently closed section for rows THEN it answers the three sample rows and reads no log line.
GIVEN `recentlyClosedCount` is 2 and the demo runs WHEN the section answers THEN it holds `demo-closed-2` and `demo-closed-3`.
GIVEN count 2 and an `isResumable` that refuses `demo-closed-3` WHEN `sampleRecentlyClosed` runs THEN it holds `demo-closed-1` and `demo-closed-2`.
GIVEN a stage whose `open` still waits WHEN the stage is disposed and the prompt then shows THEN `chat.pickerCancel` runs at once.
GIVEN the demo started from another mode WHEN the `note` beat runs THEN the dialog opens only once `shownSessionId()` is the step's session, and no box holds focus.
GIVEN the details were closed at enter and the `details` beat opened them WHEN the user closes them and the step is left THEN the dispose leaves them closed and sets nothing.
GIVEN the demo runs WHEN chat asks the Stashed section THEN it answers the two sample rows and the store is not read.
GIVEN a sample shows WHEN a usage event folds THEN the slot keeps the sample; WHEN the sample's handle is disposed THEN the slot holds the real snapshot with that event folded.
GIVEN the user hid the session hub WHEN the `agent-skills.skills` step is entered THEN the hub shows with the skills section expanded; WHEN the step is left THEN the hub is hidden again and the hub uiState was never written.
GIVEN a window list with an app window and a Unity editor window WHEN `demoStreamPick` runs THEN it picks the Unity editor's largest window.

Tests:
- `src/plugins/session-log/main/start.test.ts`: add `the section answers samples while the demo runs` — with a harness `demo` registered and a log line for a real user close, the section's rows are the sample hostSessionIds and hold no real one; with no demo harness, the real row comes back.
- `src/plugins/session-log/main/recently-closed.test.ts`: add an `it.each` table for `sampleRecentlyClosed`'s cap — count 2 keeps `demo-closed-2`, `demo-closed-3`; count 0 keeps none; count -1 keeps none; count 2.7 keeps `demo-closed-2`, `demo-closed-3`; count 2 with an `isResumable` refusing `demo-closed-3` keeps `demo-closed-1`, `demo-closed-2`. Break: a cap counted before the filter, or a fraction that keeps an extra row.
- `src/plugins/session-stash/main/session-stash.test.ts`: add `rows answers samples while the demo runs` (the store holds one record; `isDemoRunning` true answers the sample ids only, false answers the record), and a case where `isResumable` refuses `demo-stash-1` and only `demo-stash-2` comes back. The skip of a demo close is 03's test.
- `src/shared/page/demo-start-prompt.test.ts`, with a fake scope reader and fake timers: `it.each` `'open resolves $result when $name'`, rows the prompt shows (`true`, `chat.newSession` ran once) and the prompt never shows (`false` after 5000 ms, the log line); `'open runs newSession again once the prompt closed'`; `'cancel runs pickerCancel only while the prompt shows'`; `'a dispose during the wait cancels a prompt that shows later'`. Each case also asserts no subscription is left. Break: a prompt that stays open after the step, or a beat that never reopens it.
- `src/plugins/session-stash/page/demo-steps.test.ts`, with fake deps and fake timers: `'note opens the dialog once the session shows, with no box focused'`; `'note on a gone session logs and opens nothing'`. Break: a dialog cancelled by the activation, or demo keys typed into the note.
- `src/plugins/usage/main/start.test.ts`: add `a sample shows over the real snapshot until its dispose` — `showSample` publishes the sample; a usage event folds into `real` and leaves the slot on the sample; the dispose publishes the real snapshot holding that event. Add `a second sample replaces the first` — the second `showSample` publishes its sample, and the first handle's dispose leaves the slot on the second. Add `the part's dispose publishes the real snapshot over a sample`. Break: a sample left in the slot after the demo or a restart.
- `src/plugins/usage/page/start.test.ts`: add `setDetailsShown opens and closes the details and writes no uiState`. Break: a demo that changes the user's saved details choice.
- `src/plugins/live-view/window-pick.test.ts`: add a table for `demoStreamPick` — blocked → blocked pick; Unity window and app window → the Unity process's largest window, `Unity editor`; app windows only → the largest of `ownProcessId`, `This app`; neither → null.

Done when: compiles (`npm run typecheck`); `npm run lint` passes apart from the known composition-root failure of `scripts/check-layers.mts` naming `sessionLogPagePart` and `usageTabLineMainPart`, which stays until 07 lists them (plan.md Boundary rules); the gate records that failure as known and does not edit `src/plugins/page.ts` or `src/plugins/main.ts`; the test gate runs the tests above. Live checks of the steps are in task 17.
Commit: one commit for the group.

## Proof
