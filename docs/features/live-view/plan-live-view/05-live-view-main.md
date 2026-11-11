# 05 — live-view plugin: tools, slot, window pick

Status: not started
Type: Task
Rung: hard · adds the `live-view.picks` slot and the window-pick functions that 06 consumes
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Repo: wigley-ai-gui, worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-live-view`.

Files:
- create `src/plugins/live-view/manifest.ts`
- create `src/plugins/live-view/contract.ts`
- create `src/plugins/live-view/window-pick.ts` · test `src/plugins/live-view/window-pick.test.ts`
- create `src/plugins/live-view/main/start.ts` · test `src/plugins/live-view/main/start.test.ts`
- create `src/plugins/live-view/main/live-tools.ts`: the tool definitions and the per-session tool session
- modify `src/plugins/manifests.ts` (import, and `builtInManifests` after `contextSourcesManifest`)
- modify `src/plugins/main.ts` (import, and `mainParts` after `contextSourcesMainPart`)

Consumes:
- `ScreenCapture`, `CaptureWindow`, `ScreenRect`, `WindowList` ← 01
- `createFakeScreenCapture`, `FAKE_EDITOR_PROCESS_ID`, `FAKE_GAME_RECT` ← 01 (the preview sample and the tests)
- in the tree: `sessions.contributeTools`, `ToolDefinition`, `textResult`, `errorResult`, `AgentSession` (`src/plugins/sessions/contract.ts:88-240`); `CHAT_PREVIEW_HOST_ID` (`src/plugins/chat/contract.ts:29`); `KeyedSlotKey` (`src/contracts/state.ts`)

Patterns to follow:
- `src/plugins/context-sources/`: a keyed slot published by main, filled from events, deleted on `sessions.ended`, and
  its manifest
- `src/plugins/chat/main/set-headless-tool.ts`: a tool definition and its per-session `ToolSession`
- `src/plugins/window/`: a command with `runsIn: 'main'` and its handler in `start()`'s `commands`

Produces:
- `contract.ts`: `CaptureCrop`, `LivePick`, `livePicksSlot` (id `live-view.picks`), as in plan.md § File Structure
- `window-pick.ts`:
  - `pickEditorWindow(windows: readonly CaptureWindow[], processId: number, gameRect: ScreenRect | null): CaptureWindow | null`
  - `cropOf(rect: ScreenRect, bounds: ScreenRect): CaptureCrop`
  - `streamMoved(windowSize: { width: number; height: number }, streamSize: { width: number; height: number }): boolean`
  - `pickOf(list: WindowList, processId: number, gameRect: ScreenRect | null, folder: string): { pick: LivePick } | { error: string }`
- `liveViewManifest` in `manifest.ts`, `liveViewMainPart` in `main/start.ts`
- the command `live-view.openScreenSettings` (`runsIn: 'main'`)

Decisions:
- **Manifest:**
  - `id: 'live-view'`, `dependsOn: { main: ['chat', 'sessions'], page: ['chat'] }`, `reads: { main: [], page: ['sessions'] }`
  - `settings: { frameRate: 30, layout: 'default' }`, each with a `settingInfo` label and a one-line description
    (wording pinned below)
  - `themeTokens: {}`
  - `commands: { openScreenSettings: { label: 'open the Screen Recording settings', group: <the closest existing group>, runsIn: 'main' } }`
  - `id`, `label` and `description` follow `agent-skills/manifest.ts`. Task 06 adds `openPreview` only if it needs one.
    It does not: the sample rides chat's preview.
- **`pickEditorWindow`:**
  - It keeps the windows whose `processId` matches.
  - With a `gameRect`, it returns the first of them (front to back) whose bounds hold the rect with 1 point of slack
    on each edge.
  - With no `gameRect`, it returns the largest by area. On equal areas, the first wins.
  - It returns null when none fits.
- **`cropOf`** returns `((rect.x − bounds.x) / bounds.width, (rect.y − bounds.y) / bounds.height, rect.width / bounds.width, rect.height / bounds.height)`.
  Each value is clamped to `[0, 1]`, and `x + width` and `y + height` are clamped to at most 1, so the 1-point slack
  never crops past the edge.
- **`streamMoved`** is true when the two aspect ratios (`width / height`) differ by more than 2% of the window's ratio.
- **`pickOf`** builds the `LivePick` or the error text, from a `WindowList` the caller already has:
  - `blocked` gives `{ pick: { kind: 'blocked' } }`. The caller writes it, and the tool replies with an error.
  - A window found gives a stream pick with:
    - `sourceId`: the window's source id
    - `summary`: `Game View · <folder>` with a rect, or `Editor · <folder>` without one
    - `windowSize`: the window's bounds size
    - `crop`: `cropOf` with a rect, else null
  - No window gives an error (the texts are below).
- **`show_live_view`** handler, in order:
  1. validate the args
  2. `folder` = the last segment of `projectPath`, with trailing slashes trimmed
  3. read `<projectPath>/Library/EditorInstance.json` through `services.files`, then parse `process_id`
  4. `await services.screenCapture.listWindows()`
  5. `pickOf(...)`
  6. on a pick, `picks.set(session.id, pick)`
  7. reply

  A rejection from the service is an `errorResult(String(error))`, and the slot is left as it was.
- **`hide_live_view`:** `picks.delete(session.id)`, then reply.
- Contribute both tools with `sessions.contributeTools(LIVE_TOOLS, start)` and no `mainAgentOnly` option, because
  subagents may call them.
- `sessions.ended` deletes the session's pick.
- **The preview sample:** when a `chat.agentEvent` arrives whose `hostSessionId` is `CHAT_PREVIEW_HOST_ID` and the slot
  has no pick for that row's session, write `pickOf(await createFakeScreenCapture().listWindows(), FAKE_EDITOR_PROCESS_ID, toRect(FAKE_GAME_RECT), 'sample')`'s
  pick under the session id that the event carries.
  - Before relying on that id, read `src/plugins/agents/main/start.ts` (~line 86) for how agents keys its preview row.
  - This runs the real pick and crop on fake data, so the preview shows a cropped portrait sample.
- **`openScreenSettings`** handler: `services.screenCapture.openAccessSettings()`. A rejection is logged with
  `services.log`.

Pinned values (verbatim):
- tool `show_live_view`, description: "Streams a Unity editor's Game View live in this session's Live section in the app, beside the chat, so the user watches the game while the agent plays it. Call it after each `capture.py start` of the unity-playtest skill, `--append` included. `projectPath` is the Unity project folder the editor has open; `gameRect` is the Game View's render area in global screen points, top-left origin, `[x, y, width, height]`: the `game_view` field of `capture.py start`'s reply. Without `gameRect` the whole editor window streams. Call it again after the Game View moves or resizes."
- inputSchema: `projectPath` string (required); `gameRect` array of 4 numbers (`minItems: 4`, `maxItems: 4`); `additionalProperties: false`
- tool `hide_live_view`, description: "Stops the stream in this session's Live section and hides it. Call it after the last `capture.py stop` of a playtest."
- reply, Game View: `Streaming the Game View of <folder> in the Live section. It streams while the user has the section on screen.`
- reply, whole editor: `Streaming <folder>'s whole editor window in the Live section. It streams while the user has the section on screen.`
- reply, blocked: `Screen Recording is off for Auri. The Live section shows a button that opens System Settings; the user turns it on there and restarts Auri. Carry on without the stream.`
- reply, no editor: `No Unity editor has <folder> open: <projectPath>/Library/EditorInstance.json is missing or has no process_id.`
- reply, no window: `<folder>'s editor (process <pid>) has no window the app can stream; a minimized window cannot stream.`
- reply, rect outside: `The Game View rect [x, y, width, height] is not inside any window of <folder>'s editor. Call show_live_view again with the game_view of a fresh capture.py start, or with no gameRect to stream the whole editor.`
- reply, bad args: `projectPath is required.` · `gameRect must be four numbers: [x, y, width, height].`
- reply, hide: `The Live section stopped streaming.`
- settingInfo: `frameRate`: label `Frame rate`, description `The most frames a second the Live section's stream asks for.` · `layout`: label `Layout`, description `The live-view layout the session hub's Live section draws in: a folder name in live-view's layouts folder, or default.`

GIVEN the fake's windows, process 4242 and `FAKE_GAME_RECT` WHEN `pickEditorWindow` runs THEN it returns the main editor window, not the floating one
GIVEN a rect inside the floating window WHEN `pickEditorWindow` runs THEN it returns the floating window
GIVEN no rect WHEN `pickEditorWindow` runs THEN it returns the largest window of the process, never the other process's
GIVEN access blocked WHEN `show_live_view` runs THEN the slot holds `{ kind: 'blocked' }` and the reply is the blocked error
GIVEN a project folder with no `Library/EditorInstance.json` WHEN `show_live_view` runs THEN the reply is the no-editor error and the slot is unchanged
GIVEN a stream pick WHEN `hide_live_view` runs, or the session ends THEN the slot has no key for the session

Tests:
- `window-pick.test.ts`: one `it.each` table per function:
  - `pickEditorWindow`: the four GIVENs above, plus a rect 1 point past the edge (picked) and 2 points past (null)
  - `cropOf`: a row with every value non-zero and unequal, plus the clamp at the edge
  - `streamMoved`: equal, 1% off, 3% off
- `main/start.test.ts`: `startMainPart(liveViewMainPart, { services: { screenCapture, files … } })`. Call the
  contributed tool session the way `chat/main` tests call `set_headless`, if they do. Otherwise call it through the
  harness's sessions dependency. Cover the blocked, no-editor, stream, hide and session-ended rows, and read
  `harness.state.read(livePicksSlot, …)`.

Done when: `npm run typecheck`, `npm run lint` and `npm run check` pass. The composition-root check passes with the
plugin in `manifests.ts` and `main.ts` and with no page part yet. The test gate runs both tests.

Commit: one commit for the group.

## Proof
