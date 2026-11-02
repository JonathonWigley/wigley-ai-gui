# 04 — Visual frames service

Status: not started
Type: Task
Wave: 2 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     create `src/contracts/visual-frames.ts` · create `src/renderer/visual-frames/visual-frames.ts` ·
           create `src/renderer/visual-frames/visual-frames.css` · create `src/shared/page/fake-visual-frames.ts` ·
           modify `src/contracts/plugin.ts` · modify `src/renderer/theme.ts` · modify `src/renderer/renderer.ts` ·
           modify `scripts/check-layers.mts` ·
           test `src/renderer/visual-frames/visual-frames.test.ts` · test `src/renderer/theme.test.ts` ·
           test `src/renderer/transparency-override.test.ts` (call site only)
Consumes:  `serveVisual(source: string): Promise<string>` on `Bridge` ← 02
Consumes:  `VISUAL_MESSAGES`, `VisualTheme`, `VisualThemeMessage`, `VisualHeightMessage`, `VisualEscapeMessage` from
           `src/shared/visual-messages.ts` ← 02
Consumes:  `visualHashOf(url: string): string | null` from `src/shared/visual-url.ts` ← 02
Produces:  `export interface VisualFrame { readonly element: HTMLElement; dispose(): void; }` and
           `export interface VisualFrames { open(source: string): VisualFrame; }` in `src/contracts/visual-frames.ts`
Produces:  `visualFrames: VisualFrames;` on `PageServices` in `src/contracts/plugin.ts`
Produces:  `export interface VisualFramesDeps { serveVisual(source: string): Promise<string>; messages: Pick<Window,
           'addEventListener' | 'removeEventListener'>; focusPage(): void; log: Log; }`,
           `export interface LiveVisualFrames extends VisualFrames { themeApplied(theme: VisualTheme): void; }` and
           `export function createVisualFrames(deps: VisualFramesDeps): LiveVisualFrames;` in
           `src/renderer/visual-frames/visual-frames.ts`
Produces:  the page log line `[visual] visual frame loaded: <first 8 characters of the hash>`, once per frame `load`
           after its `src` is set — task 07's self-test waits on it before a screenshot
Produces:  a required third parameter `onApplied: (applied: VisualTheme) => void` on `createThemeApplier` in
           `src/renderer/theme.ts` (one type for the applied theme: 02's `VisualTheme`)
Produces:  `export interface FakeVisualFrame { readonly source: string; readonly element: HTMLElement; disposed:
           boolean; }` and `export function fakeVisualFrames(): { frames: VisualFrames; opened: FakeVisualFrame[] };`
           in `src/shared/page/fake-visual-frames.ts`
Decisions: The visual frames service has a live adapter and a fake (design review, round 3). Sandbox `allow-scripts`
           only (round 1). No height cap: the frame takes its content's full height, reported from inside (round 1).
           A click gives the visual focus; `Esc` inside it hands focus back to the page (round 2). The frame gets the
           whole token set, then reduced, then fonts, in the order `theme.ts` applies them, on load and on every theme
           change (round 2, design review). A frame's height is set through a CSS custom property (plan.md § Boundary
           rules). The load log line (lead ruling, for task 07). A source main did not serve shows as code (lead
           ruling).
GIVEN `open(source)` WHEN called THEN it returns a `div.visual-frame` holding an `iframe.visual-frame-document` with
      `sandbox="allow-scripts"`, and sets the iframe's `src` to the URL `serveVisual(source)` resolves
GIVEN `serveVisual` rejects WHEN the frame is not disposed THEN the service logs `visual not served: <error>` and the
      element holds the source as code in place of the iframe
GIVEN a frame with its `src` set WHEN it fires `load` THEN the service logs `visual frame loaded: <hash8>` and posts the
      latest theme message, when a theme was applied
GIVEN open frames WHEN `themeApplied(theme)` THEN the service posts the theme message to every frame not disposed
GIVEN a height message from the frame's own window WHEN it holds a finite, non-negative number THEN the iframe's
      `--visual-frame-height` is that number
GIVEN an escape message from the frame's own window WHEN heard THEN the iframe is blurred and the page window takes
      focus
GIVEN a message from any other window, from a `null` source, or of another shape WHEN heard THEN nothing changes
GIVEN a frame WHEN disposed THEN it hears no more messages, gets no more themes, leaves the DOM, and gets no `src`
      from a later `serveVisual` answer; a second `dispose` does nothing
GIVEN the theme applier WHEN it applies THEN `onApplied` hears every property it wrote, in write order, and the colour
      scheme
Tests:     see § Tests
Approach:  see § Approach
Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

Run `git status --short` on each file before you edit it. Another session has uncommitted edits in this tree. Stage
only your own hunks.

## Approach

### Contract — `src/contracts/visual-frames.ts`

Write the two interfaces exactly as plan.md § File Structure shows them. Comment `VisualFrames.open` with these
sentences:

- "Opens `source` as a live visual: a sandboxed frame, served by main, styled by the page's theme and sized to its
  content's full height."
- "The caller places `element` once. A move by `Element.moveBefore` between connected parents keeps the visual loaded;
  any other move (an append, `replaceChildren`, a detach and re-attach) reloads it, and its scripts start again with
  their state lost."
- "`dispose` removes `element` and stops the visual."

This agrees with task 01, whose mount moves a reused view with `moveBefore` when both ends are connected, and
otherwise with `replaceChildren` (01 § the staged draw). The second path reloads the frame, which the comment states.

In `src/contracts/plugin.ts`, import `VisualFrames` from `./visual-frames` and add `visualFrames: VisualFrames;` to
`PageServices` after `markup`, with the comment
`// Opens a visual's html in a sandboxed frame (`src/contracts/visual-frames.ts`).`

### Theme hook — `src/renderer/theme.ts`

- Import `type VisualTheme` from `../shared/visual-messages`. Do not declare a second type of the same shape.
- `createThemeApplier(root, reducedTransparency, onApplied: (applied: VisualTheme) => void)`. The new parameter is
  required.
- In `apply`, build one `properties` list in the current order: every `theme.tokens` entry as
  `[themeVariable(token), value]`; then, when reduced, every `theme.reduced` entry the same way; then the font
  settings in `applyFonts`' order (`ui`, `mono`, `uiSize`, `monoSize`, `proseSize`), each only when set, with the
  same values as now (`${size}px` for a size). Write each pair with `root.style.setProperty`. Then set
  `dataset.transparency` and `color-scheme` as now. Then call
  `onApplied({ properties, colorScheme: theme.colorScheme })`.
- The OS reduce-transparency listener calls `apply`, so it reaches `onApplied` too. The transparency override
  (`transparency-override.ts`) wraps this applier and calls its `apply`, so an override reaches `onApplied` too. No
  other hook is needed.
- Update `ThemeApplier`'s comment: `apply` also hands `onApplied` what it wrote.

### Live adapter — `src/renderer/visual-frames/visual-frames.ts`

`VisualFramesDeps` comment: "`serveVisual` is the Bridge's; `messages` is the page's window, where each frame's
messages arrive; `focusPage` moves keyboard focus to the page's own document; `log` is the page log."

- The module imports `./visual-frames.css`, as `src/renderer/toasts.ts` imports `./toasts.css`.
- It keeps `latest: VisualTheme | null` (null until the first `themeApplied`) and a `Set` of open frames.
- `themeApplied(theme)`: sets `latest` and posts the theme message to every open frame.
- Posting the theme: `iframe.contentWindow?.postMessage(message, '*')` with
  `message: VisualThemeMessage = { type: VISUAL_MESSAGES.theme, properties: theme.properties, colorScheme:
  theme.colorScheme }`. The target is `'*'` because the frame's origin is opaque. A detached iframe has a `null`
  `contentWindow`; the `?.` skips it.
- `open(source)`:
  1. `const element = document.createElement('div')`; `element.className = 'visual-frame'`.
     `const iframe = document.createElement('iframe')`; `iframe.className = 'visual-frame-document'`;
     `iframe.setAttribute('sandbox', 'allow-scripts')`. Set the sandbox before any `src`. Add no other sandbox token.
     `element.append(iframe)`. The wrapper lets a failed serve swap the iframe for code while the caller keeps one
     element.
  2. `iframe.addEventListener('load', …)`. A load before the `src` is set (the initial `about:blank`) does nothing.
     After the `src` is set, each load logs `deps.log('visual', `visual frame loaded: ${hash.slice(0, 8)}`)`, where
     `hash` is `visualHashOf(url)` of the served URL, and posts `latest` to this frame when `latest` is not null. A
     load fires for each document the frame loads, so a frame that reloads or navigates on the scheme gets the theme
     again.
  3. A `message` listener on `deps.messages`. It reads `const frameWindow = iframe.contentWindow` and ignores the
     event when `frameWindow === null` or `event.source !== frameWindow`. A detached or unloaded frame has a `null`
     `contentWindow`, and a message from a closed window has a `null` source; without the `null` check those two
     would match. It also ignores the event unless `event.data` is an object (not null). Then:
     - type `VISUAL_MESSAGES.height`, with `typeof height === 'number' && Number.isFinite(height) && height >= 0`:
       `iframe.style.setProperty('--visual-frame-height', String(height))`. The value is unitless pixels, as
       `--chat-composer-height` is (`src/plugins/chat/page/chat-view.ts:588`). The frame runs the agent's code, so a
       bad value is a real input: ignore it.
     - type `VISUAL_MESSAGES.escape`: `iframe.blur()`, then `deps.focusPage()`. See § Focus hand-back.
     - any other type: ignore.
  4. Add the frame to the set. Call `deps.serveVisual(source)`.
     - On resolve, when the frame is not disposed, call `iframe.setAttribute('src', url)` and keep `url` for the load
       log.
     - On reject, when the frame is not disposed, log `deps.log('visual', `visual not served: ${errorText(error)}`)`
       (`src/shared/error-text.ts`). Then build `pre.visual-frame-source` holding one `code` whose `textContent` is
       `source`, and call `iframe.replaceWith(pre)`. The surrounding markdown's `pre` and `code` rules style it, so
       it reads as the code block it was. Add no CSS for it. The frame then hears no messages: its `contentWindow` is
       `null`.
  5. Return `{ element, dispose }`. `dispose` marks the frame disposed, removes the `message` listener from
     `deps.messages`, drops the frame from the set and calls `element.remove()`. Removing the element unloads the
     document, so a disposed visual's scripts stop. A second `dispose` does nothing.
- One `message` listener per frame keeps each frame's lifetime in its own closure. Do not add a shared dispatcher.

### Focus hand-back

`iframe.blur()` alone is not enough. The HTML standard says `blur()` runs the unfocusing steps, but "User agents may
instead selectively or uniformly do nothing" (html.spec.whatwg.org, § `blur()` method, read at plan time). So the
service does both:

1. `iframe.blur()`.
2. `deps.focusPage()`, which `renderer.ts` wires to `() => window.focus()`. `window.focus()` runs the focusing steps
   with the page's own navigable; their focus target is the navigable's active document, and the focus update steps
   move the focus chain off every element in the old chain, inside the child frame included (html.spec.whatwg.org,
   § focusing steps and focus update steps). The allow-focus steps let it through: a top-level document is allowed
   to use `focus-without-user-activation`.

Focus then sits in the page document, where the page keys listen (`document` keydown,
`src/renderer/page-keys.ts:216`). The on-screen proof is 09 check 6. If that check fails, the fallback to name in the
09 report is to focus the nearest page element with a `tabIndex` of `-1` or more above the frame.

### Base CSS — `src/renderer/visual-frames/visual-frames.css`

```css
/* A visual's frame: the column's full width, and the height its content
   reports through `--visual-frame-height` (unitless pixels), 0 until the
   first report. */
.visual-frame-document {
  display: block;
  width: 100%;
  height: calc(var(--visual-frame-height, 0) * 1px);
  border: none;
}
```

`scripts/check-styles.mts` allows `1px` (the hairline) and `0`, and reads no raw value here. The `div.visual-frame`
wrapper takes no rule: a `div` is a block already.

### Fake — `src/shared/page/fake-visual-frames.ts`

Plugin page parts (task 05 onward) may import `src/shared/page`, but no plugin layer may import `src/renderer`
(`scripts/check-layers.mts`). So the fake lives in `src/shared/page/`, not beside the adapter. Follow
`src/shared/fake-drive-host.ts`: a function that returns the service and what it recorded.

- `fakeVisualFrames()` returns `{ frames, opened }`.
- `frames.open(source)` creates `document.createElement('div')` with `className = 'visual-frame'` and
  `dataset.visualSource = source`. It pushes `{ source, element, disposed: false }` onto `opened` and returns
  `{ element, dispose }`. `dispose` sets that record's `disposed` to true.
- Comment: "A `VisualFrames` for plugin tests: `opened` holds each frame opened, in order, with its source and whether
  it was disposed."

### Wiring — `src/renderer/renderer.ts`

- Before `createThemeApplier` (`renderer.ts:102-107`, measured at plan time, re-verify), create
  `const visualFrames = createVisualFrames({ serveVisual: (source) => bridge.serveVisual(source), messages: window,
  focusPage: () => window.focus(), log });`.
- Pass `(applied) => visualFrames.themeApplied(applied)` as `createThemeApplier`'s third argument.
- Add `visualFrames` to `services` (`renderer.ts:196-206`) after `markup`.
- `src/renderer/plugins/page-api.ts` needs no edit: `PageApiDeps.services` is `Omit<PageServices, 'uiState'>` and
  `createPageApi` spreads it into each plugin's `services` (`page-api.ts:51`, `:115`). The new member reaches every
  plugin through that spread. `src/renderer/plugins/page-api.test.ts:108` casts `{}` to the type and needs no edit.

### Layers — `scripts/check-layers.mts`

- Add `'src/renderer/visual-frames': { layers: ['src/contracts', 'src/shared'], packages: [] },` beside
  `'src/renderer/fabric'`.
- Add `'src/renderer/visual-frames'` to the layers of `'src/renderer/renderer.ts'`.
- `src/shared/page/fake-visual-frames.ts` imports only `src/contracts`, which the `src/shared/page` layer allows.

## Tests

`src/renderer/theme.test.ts` — add a third argument to every existing `createThemeApplier` call (five calls, measured at
plan time, re-verify), and to the one in `src/renderer/transparency-override.test.ts:107`. Pass a recorder
`(applied) => heard.push(applied)` where a test asserts on it, else `() => {}`.

- New `it('hands onApplied every property it wrote, in write order')` — with the file's `theme`, apply
  `settings('reduced', { ui: 'Inter', uiSize: 15 })`. The one `VisualTheme` heard is:

  ```ts
  {
    properties: [
      ['--wg-fg', '#111111'],
      ['--wg-material-chrome-bg', '#22222280'],
      ['--wg-forms-origin-caused', 'var(--wg-fg)'],
      ['--wg-font-ui', 'System'],
      ['--wg-font-mono', 'Mono'],
      ['--wg-text-ui', '13px'],
      ['--wg-text-mono', '13px'],
      ['--wg-text-prose', '14px'],
      ['--wg-material-chrome-bg', '#222222'],
      ['--wg-font-ui', 'Inter'],
      ['--wg-text-ui', '15px'],
    ],
    colorScheme: 'dark',
  }
  ```

  Catches a reordered list (a frame would show the full value over the reduced one), a dropped reduced or font entry,
  and a token set cut to a subset.
- Row added to `it('follows the OS under system')` — after `query.listener?.()`, the last `VisualTheme` heard holds
  `['--wg-material-chrome-bg', '#22222280']` and no `'#222222'` entry. Catches an OS change that repaints the page but
  never reaches the frames.

`src/renderer/visual-frames/visual-frames.test.ts` — `describe('createVisualFrames')`. Use `installFocusFakeDom(vi.stubGlobal)`
from `src/shared/page/test-dom.ts`, and `vi.unstubAllGlobals()` after each test. Build in the test:

- `serveVisual`: a `vi.fn` that returns a deferred promise the test resolves or rejects.
- `messages`: an object whose `addEventListener` and `removeEventListener` keep the `message` listeners in an array, so
  the test calls each held listener with `{ source, data }`.
- `focusPage` and `log`: `vi.fn()`.
- `iframeOf(frame)`: the element's first child (`asFake(frame.element).childNodes[0]`).
- A frame window: `{ postMessage: vi.fn() }`, set as the iframe's `contentWindow`
  (`(iframe as unknown as { contentWindow: unknown }).contentWindow = frameWindow`). Another window, built the same
  way, stands for any other frame.
- `URL_A` = `'wigley-visual://visual/' + 'ab'.repeat(32)`.
- Themes `A` = `{ properties: [['--wg-fg', '#111111']], colorScheme: 'dark' }` and `B` =
  `{ properties: [['--wg-fg', '#eeeeee']], colorScheme: 'light' }`.

Tests:

- `it('opens a sandboxed frame on the URL main serves for the source')` — `open('<p>a</p>')`: `serveVisual` was called
  with `'<p>a</p>'`; the element is a `DIV` with class `visual-frame`; its one child is an `IFRAME` with class
  `visual-frame-document`, attribute `sandbox` `'allow-scripts'`, and no `src` yet. Resolve with `URL_A` and flush:
  attribute `src` is `URL_A`. Catches a widened or missing sandbox, and the wrong source served.
- `it('shows the source as code when main does not serve it')` — `open('<p>a</p>')`, reject with `new Error('boom')`
  and flush: `log` was called with `('visual', 'visual not served: boom')`; the element's one child is a `PRE` with
  class `visual-frame-source` whose `code` child's `textContent` is `'<p>a</p>'`; no `IFRAME` remains. Catches a
  rejection that leaves an empty, zero-height frame, and an unhandled rejection.
- `it('logs each load and posts the latest theme on it and on every theme change')` — open a frame and `fire('load')`
  before the URL resolves: no post, no log. Resolve with `URL_A`, flush, `fire('load')`: `log` was called with
  `('visual', 'visual frame loaded: abababab')`, and no post (no theme yet). `themeApplied(A)`: one post,
  `({ type: 'wigley-visual:theme', ...A }, '*')`. `fire('load')`: a second post of `A` and a second log line.
  `themeApplied(B)`: a post of `B`. A second frame opened after `B` posts `B` on its first load after its URL
  resolves. Catches a missing load line (task 07's self-test would screenshot an empty frame), a frame that gets the
  theme only once or only on change, and a stale theme on a late frame.
- `it.each` `'$case'` — `'takes height and Esc only from its own frame'`. Before each row, focus the iframe
  (`asFake(iframe).focus()`). Each row: `{ case, from: 'own' | 'other' | 'null', data, height, blurred }`, where
  `from: 'null'` sets the iframe's `contentWindow` to `null` and sends `source: null`; `height` is the expected
  `iframe.style['--visual-frame-height']` (`undefined` when unset); `blurred` is whether `document.activeElement` left
  the iframe and `focusPage` was called once (false: still focused, `focusPage` not called):
  - `height from its frame` · own · `{ type: 'wigley-visual:height', height: 240 }` · `'240'` · false
  - `height from another frame` · other · same data · `undefined` · false
  - `height from a null source to a detached frame` · null · same data · `undefined` · false
  - `negative height` · own · `{ type: 'wigley-visual:height', height: -1 }` · `undefined` · false
  - `height as text` · own · `{ type: 'wigley-visual:height', height: '240' }` · `undefined` · false
  - `infinite height` · own · `{ type: 'wigley-visual:height', height: Infinity }` · `undefined` · false
  - `Esc from its frame` · own · `{ type: 'wigley-visual:escape' }` · `undefined` · true
  - `Esc from another frame` · other · same data · `undefined` · false
  - `Esc from a null source to a detached frame` · null · same data · `undefined` · false
  - `not an object` · own · `'wigley-visual:escape'` · `undefined` · false

  Catches a dropped source check (another frame's script resizes or blurs this one), a `null === null` match, a
  dropped value check, and an Esc that blurs without moving focus to the page.
- `it('stops a disposed frame')` — open a frame, append its element to a parent, leave `serveVisual` unresolved, then `dispose()`. The
  element has no parent, the `message` listener array is empty, `themeApplied(A)` posts nothing, and resolving
  `serveVisual` afterwards sets no `src`. A second `dispose()` does not throw and leaves the listener array empty.
  Catches leaked listeners, a disposed frame that still loads, and a double dispose that throws.

The fake earns no test of its own: it records what it is handed, and the plugin tests that use it exercise it.

→ 09 Final verification: a visual's frame paints in the page, takes its content's full height and grows with it;
it shows the user's theme and follows a theme change and a transparency switch; `Esc` inside a focused visual hands
the keys back to the page (check 6); a mount redraw that reuses a frame keeps it loaded (no second
`visual frame loaded` line for it).

## Proof

