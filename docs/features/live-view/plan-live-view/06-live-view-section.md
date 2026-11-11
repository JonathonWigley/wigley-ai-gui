# 06 — live-view section, layout, preview and self-test

Status: not started
Type: Task
Rung: deep · media stream lifetime: getUserMedia, visibility and IntersectionObserver start and stop, and track end, across page reloads and tab moves
Wave: 3 · Depends on: 02, 05
Plan: [plan.md](plan.md)

Repo: wigley-ai-gui, worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-live-view`.

Files:
- create `src/plugins/live-view/layouts/layout.d.ts`
- create `src/plugins/live-view/layouts/default/layout.js` and `layout.css`
- create `src/plugins/live-view/page/layout/read-live-view-layout.ts`
- create `src/plugins/live-view/page/start.ts`
- create `src/plugins/live-view/page/live-section.ts` · test `src/plugins/live-view/page/live-section.test.ts`
- create `src/plugins/live-view/page/stream-source.ts` · test `src/plugins/live-view/page/stream-source.test.ts` (the source id routing only)
- create `src/plugins/live-view/page/live-view.css`, for the app-owned `<video>`, if the page's CSS pattern allows a plugin page stylesheet. Otherwise, inline styles in `live-section.ts`.
- create `src/plugins/live-view/main/selftest-script.ts`
- modify `src/plugins/live-view/main/start.ts`: `api.layouts.register({ layoutTypes })`, `services.selfTest?.run(...)`
- modify `src/plugins/page.ts` (import, and `pageParts` after `contextSourcesPagePart`)
- modify `src/shared/layouts/layout-contracts.test.ts`, only if owners are listed there by hand

Consumes:
- `ChatSidePart.shrinksLast` ← 02
- `livePicksSlot`, `LivePick`, `CaptureCrop`, `streamMoved` and the `live-view.openScreenSettings` command ← 05
- `FAKE_GAME_RECT`, `FAKE_EDITOR_PROCESS_ID` ← 01 (the self-test fixture)

Patterns to follow: `src/plugins/agent-skills/`, the whole plugin. It shows:
- `layouts/layout.d.ts`, `layouts/default/layout.js` and `.css`
- `page/layout/read-agent-skills-layout.ts`
- `page/skill-list.ts`: `createLayoutParts`, `layoutParts.draw`, and `setLayouts`
- `page/start.ts`: `chat.addSidePart` and `api.layouts.show`
- `main/start.ts`: `layoutTypes` and `selfTest`
- `main/selftest-script.ts`

For a keyed slot read in the page, with `followRows` to forget removed rows, follow `src/plugins/context-sources/page/start.ts`.
For `kit.button` in a layout, follow `src/plugins/unity-pool/layouts/default/layout.js:76-79`.

Produces:
- `layout.d.ts`:
  - `LiveViewInput { readonly notice: { readonly text: string; readonly action: { readonly label: string; readonly command: string } | null } | null }`
  - `LiveViewPart { readonly element: HTMLElement; readonly videoSlot: HTMLElement }`
  - `Layout { liveView?(parent: HTMLElement, input: LiveViewInput, kit: BaseKit): LiveViewPart }`
  - `CompleteLayout extends Required<Layout>`
- `stream-source.ts`: `openStream(sourceId: string, frameRate: number): Promise<MediaStream>`
- `liveViewPagePart` in `page/start.ts`

Decisions:
- **The side part:** `{ id: 'live-view.section', title: 'Live', order: 15, shrinksLast: true, build(parent, sessionId, section) }`.
  - With no pick for the session, `build` draws nothing, so chat hides the section.
  - A `stream` pick sets the summary to `pick.summary`. A `blocked` pick sets it to null.
  - The section redraws on every slot change for its session.
- **The layout's job:** it draws the notice line (`text-12`, `fg-secondary`) and, when the notice has an `action`, a
  `kit.button(parent, label, command, { variant: 'secondary' })`. It returns a `videoSlot` element under them. The
  page puts its own `<video muted autoplay playsinline>` into `videoSlot`. The layout never touches the video.
- **Video fit:**
  - The video's CSS `aspect-ratio` is the cropped frame's shape, `windowSize.width * crop.width / (windowSize.height * crop.height)`,
    or the window's shape with no crop.
  - The video has `width: 100%` and `max-height: 100%`, with `object-fit: contain` and
    `object-view-box: inset(<top>% <right>% <bottom>% <left>%)` from the crop.
  - The section body fills the height that chat's `shrinksLast` gives it, so a portrait frame shrinks to the hub's
    free height and the hub shows no scrollbar.
- **When it streams:** a section streams only while all of these are true:
  - its `videoSlot` intersects the viewport (an `IntersectionObserver`; `display: none` from a collapsed section, a
    hidden hub or a hidden tab counts as not intersecting)
  - `document.visibilityState` is `visible`
  - its pick is a `stream`

  When any of them turns false, the page stops every track and clears `srcObject`. When all of them are true again,
  it opens the stream again. One open stream per section at most. A slot change that replaces the pick closes the old
  stream first.
- **`openStream`:**
  - A source id starting `sample:` parses `<width>x<height>` and returns `canvas.captureStream(frameRate)` of a
    canvas that size. The canvas draws a test card that moves, so a frozen stream shows: a background in the theme's
    `block-background`, a grid, the text `Live sample`, and a frame counter.
  - Any other id calls `navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxFrameRate: frameRate } } })`,
    as the spike did. The spike's `git show spike/live-window-view:src/plugins/live-view/page/start.ts` is a working
    reference for this call only.
  - `frameRate` is `api.settings().frameRate`, read at each open.
- **Notices** (the texts are pinned below):
  - **moved:** on the video's `resize` event and at first frame, when
    `streamMoved(pick.windowSize, { width: video.videoWidth, height: video.videoHeight })` is true, drop the crop (show
    the whole window) and show the moved notice. A new pick clears it.
  - **closed:** when the stream's video track fires `ended` while the section still wants it, show the closed notice,
    hide the video, and stop trying until a new pick.
  - **blocked:** a `blocked` pick shows the blocked notice with the action `{ label: 'Open System Settings', command: 'live-view.openScreenSettings' }`, and no video.
  - **open failed:** when `openStream` rejects, show `Live could not start the stream: <error message>` and log it.
- **Page log lines** (the self-test waits on these):
  - `[live-view] streaming <summary> in <sessionId>` when a stream's first frame shows
  - `[live-view] stream stopped in <sessionId>` when it stops
  - `[live-view] notice in <sessionId>: <text>` when a notice shows
- **Self-test** (`main/selftest-script.ts`), shaped like `agent-skills/main/selftest-script.ts`:
  - `open()` makes the fixture project `selftest-unity` and writes `Library/EditorInstance.json` with
    `{"process_id": FAKE_EDITOR_PROCESS_ID}`. It closes and launches a session there, and activates it.
  - Then it calls the same internal `show` function the tool calls, with `{ projectPath, gameRect: FAKE_GAME_RECT }`.
    Expose that function from `live-tools.ts` (05) for the script, not through the tool API.
  - One group, `live section`: one step, `width: 1200`, `expect: '[live-view] streaming Game View · selftest-unity in <id>'`
    (match with `alsoExpect` or a RegExp when the id is not known up front), `checksFit: 'held'`,
    `screenshot: 'live-section'`, and `why`: "The hub shows only in a Chat tab at least 640px wide; the screenshot shows the cropped portrait sample fitting the hub."
  - `scrollsItself` is agent-skills' list plus the live-view section's own classes, if any ellipsize.
  - `npm run selftest -- --plugin live-view` runs it.

Pinned values (verbatim):
- moved: `The Game View moved. Live shows the whole editor until the agent shows it again.`
- closed: `The editor window closed.`
- blocked: `Screen Recording is off for Auri. Turn it on in System Settings, then restart Auri.`
- button: `Open System Settings`
- open failed: `Live could not start the stream: <error message>`
- side part: id `live-view.section`, title `Live`, order 15

GIVEN no pick for a session WHEN its section builds THEN it draws nothing
GIVEN a blocked pick WHEN the section draws THEN the layout gets the blocked notice with the Open System Settings action, and no stream opens
GIVEN a stream pick and the section not intersecting WHEN the pick arrives THEN no stream opens; WHEN it starts intersecting THEN one stream opens; WHEN it stops THEN every track stops
GIVEN an open stream WHEN the pick is deleted THEN the stream stops and the section draws nothing
GIVEN a stream whose size has a different aspect than windowSize WHEN its first frame shows THEN the crop drops and the moved notice shows
GIVEN a session row removed WHEN followRows reports it THEN its section's state and stream are gone

Tests:
- `live-section.test.ts`: the GIVENs above. Use a fake `openStream` (a stub `MediaStream` whose tracks record
  `stop()`) and a fake intersection hook. Make the observer an injected dependency of `live-section.ts`, so the test
  drives it.
- `stream-source.test.ts`: a `sample:` id takes the canvas path, and any other id takes `getUserMedia` with
  `maxFrameRate`, through stubs.
- The layout-contract typecheck covers `layout.d.ts`.

Done when:
- `npm run typecheck`, `npm run lint` and `npm run check` pass.
- The test gate runs both page tests.
- `npm run selftest -- --plugin live-view` passes.
- Its screenshot `live-view-live-section.png` shows the portrait sample under Main agent with no hub scrollbar. The
  agent reads the PNG. Record its path in Proof for [09](09-final-verification.md).

Commit: one commit for the group.

## Proof
