# 02 — Visual scheme, guard and Bridge call

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/shared/visual-url.ts` · create `src/shared/visual-messages.ts` · create
           `src/main/data-protocol/visual-documents.ts` · modify `src/main/data-protocol/data-protocol.ts` ·
           modify `src/main/main.ts` · modify `src/main/window.ts` · modify `src/contracts/bridge.ts` ·
           modify `src/preload/preload.ts` · modify `index.html` ·
           test `src/shared/visual-url.test.ts` · test `src/main/data-protocol/visual-documents.test.ts`
Consumes:  none
Produces:  `export const VISUAL_SCHEME = 'wigley-visual';` in `src/shared/visual-url.ts`
Produces:  `export function visualUrl(hash: string): string;` in `src/shared/visual-url.ts`
Produces:  `export function visualHashOf(url: string): string | null;` in `src/shared/visual-url.ts`
Produces:  `export function refusesFrameNavigation(details: { url: string; isMainFrame: boolean }): boolean;` in
           `src/shared/visual-url.ts`
Produces:  `VISUAL_MESSAGES`, `VisualTheme`, `VisualThemeMessage`, `VisualHeightMessage`, `VisualEscapeMessage` in
           `src/shared/visual-messages.ts` (text below, verbatim)
Produces:  `export interface VisualDocuments { serve(source: string): string; response(url: string): Response; }` and
           `export function createVisualDocuments(): VisualDocuments;` in `src/main/data-protocol/visual-documents.ts`
Produces:  `export function serveVisualScheme(): (source: string) => string;` and `registerAppSchemes()` (renamed from
           `registerFileSchemes`) in `src/main/data-protocol/data-protocol.ts`
Produces:  `serveVisual(source: string): Promise<string>;` on `Bridge`, and `serveVisual: 'bridge:serve-visual'` in
           `BRIDGE_CHANNELS`, in `src/contracts/bridge.ts`
Decisions: Scripts run in the frame; the network is blocked (round 1). A served document on its own scheme with its own
           CSP header, not `srcdoc` (design review, round 3; `design.md` § Decisions). Main refuses frame navigation
           off the scheme, since CSP does not cover navigation (round 1, design review). Served sources live in memory,
           keyed by SHA-256 of the source, for the app's life (design review, round 3). The concept is named "visual"
           everywhere (round 2). The frame protocol is shared with 04 and is pinned here (plan drafter, from the brief).
GIVEN a hash WHEN `visualUrl(hash)` THEN the URL is `wigley-visual://visual/<hash>`, and `visualHashOf` reads the hash back
GIVEN a URL that is not a visual URL WHEN `visualHashOf(url)` THEN it returns null
GIVEN a subframe navigation WHEN its URL is not a visual URL THEN `refusesFrameNavigation` returns true; a subframe
      navigation to a visual URL, and every main-frame navigation, return false
GIVEN a source WHEN `serve(source)` THEN it returns the URL of the source's SHA-256 hash, the same URL for the same source
GIVEN a served URL WHEN `response(url)` THEN status 200, `text/html; charset=utf-8`, the pinned CSP header, and a body of
      the doctype, the bootstrap script and the source, in that order
GIVEN a URL with an unknown hash, or not a visual URL WHEN `response(url)` THEN status 404
Tests:     see § Tests
Approach:  see § Approach
Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

Before you edit `src/main/main.ts`, run `git status --short src/main/main.ts`. Another session has uncommitted
edits in this tree. Stage only your own hunks in every file you touch.

## Pinned text

### `src/shared/visual-url.ts`

- `VISUAL_SCHEME` is `'wigley-visual'`.
- `visualUrl(hash)` returns `` `${VISUAL_SCHEME}://visual/${hash}` ``. The host is always the fixed word `visual`. The
  hash is in the path, because a 64-character host label passes the 63-character DNS label limit.
- `visualHashOf(url)` parses `url` with `parsedSchemeUrl(url, VISUAL_SCHEME)` from `src/shared/file-url.ts`. It returns
  the hash when the hostname is `visual` and the pathname is `/` and then 64 lowercase hex characters
  (`/^\/([0-9a-f]{64})$/`). It ignores the search and the fragment. In every other case it returns null.
- `refusesFrameNavigation(details)` returns `!details.isMainFrame && visualHashOf(details.url) === null`. It is the
  frame-navigation decision, kept pure so a test pins it; `window.ts` only wires it (§ Frame navigation guard). The
  main frame is left to the existing `will-navigate` guard. Its comment: "Whether main refuses a frame's navigation:
  a subframe stays on the `wigley-visual:` scheme, since CSP does not cover navigation."
- Follow the comment style of `src/shared/layout-url.ts`: one comment above each export that says the URL shape.

### `src/shared/visual-messages.ts` (verbatim, comments may be reworded)

```ts
import type { ColorScheme } from '../contracts/theme';

// The messages the page and a visual's frame trade through `postMessage`. The
// frame's origin is opaque, so each side checks the event's `source` (the
// frame checks `window.parent`, the page checks the frame's `contentWindow`),
// never its origin.
export const VISUAL_MESSAGES = {
  theme: 'wigley-visual:theme',
  height: 'wigley-visual:height',
  escape: 'wigley-visual:escape',
} as const;

// The page's theme as its theme applier wrote it: each custom property in
// write order (the tokens, then the reduced overrides while transparency is
// reduced, then the font settings), and the colour scheme.
export interface VisualTheme {
  properties: readonly (readonly [name: string, value: string])[];
  colorScheme: ColorScheme;
}

// Page → frame, on the frame's load and on every theme change.
export interface VisualThemeMessage extends VisualTheme {
  type: typeof VISUAL_MESSAGES.theme;
}

// Frame → page: the frame document's root element height, in CSS pixels,
// rounded up, each time it changes.
export interface VisualHeightMessage {
  type: typeof VISUAL_MESSAGES.height;
  height: number;
}

// Frame → page: the user pressed Esc inside the frame.
export interface VisualEscapeMessage {
  type: typeof VISUAL_MESSAGES.escape;
}
```

### The CSP response header (verbatim)

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'
```

`default-src 'none'` covers `connect-src`, `frame-src`, `media-src`, `object-src` and `worker-src`. Add nothing else.

### The served document

The body is the concatenation of these three parts, with no other text:

1. `<!doctype html>\n` — first, so the document parses in standards mode. The agent's own doctype comes later and the
   parser ignores it.
2. `<script>` + the bootstrap script + `</script>\n` — before the source, so the bootstrap runs before the agent's
   scripts and its listeners come first.
3. The source, unchanged.

### The bootstrap script

Build it once, at module level in `visual-documents.ts`, as a template string. Insert the message strings with
`JSON.stringify(VISUAL_MESSAGES)`, so main and the page share one source for them. The script text is:

```js
(() => {
  const messages = ${JSON.stringify(VISUAL_MESSAGES)};
  const root = document.documentElement;
  root.style.visibility = 'hidden';
  const isMessage = (data, type) =>
    typeof data === 'object' && data !== null && data.type === type;
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !isMessage(event.data, messages.theme)) {
      return;
    }
    for (const [name, value] of event.data.properties) {
      root.style.setProperty(name, value);
    }
    root.style.colorScheme = event.data.colorScheme;
    root.style.visibility = '';
  });
  let reported = -1;
  new ResizeObserver(() => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height !== reported) {
      reported = height;
      window.parent.postMessage({ type: messages.height, height }, '*');
    }
  }).observe(root);
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        window.parent.postMessage({ type: messages.escape }, '*');
      }
    },
    true,
  );
})();
```

Reasons for each choice:

- The root stays hidden until the first theme message (lead ruling after drafting). The page posts the theme on the
  frame's `load`, after the agent's scripts ran, so a visible root would paint once unthemed. Layout still runs while
  hidden, so the height reports as usual.
- The observer watches the root element, so the height tracks content that grows after load (a script that adds rows,
  a tab switch). It reads the root's box height, not `scrollHeight`: `scrollHeight` is never less than the frame's own
  height, so a frame could never shrink.
- The keydown listener is on `window` in the capture phase. It is added before the agent's scripts run, so it hears Esc
  first. It does not stop the event: the visual's own Esc handling still runs.
- `postMessage` targets `'*'`, because the page's origin differs between dev (`http://localhost`) and packaged
  (`file://`). The target is always `window.parent`, and the sandbox blocks top navigation, so the parent is always
  the app's page.

## Approach

### Scheme privileges — `src/main/data-protocol/data-protocol.ts`

- Rename `registerFileSchemes` to `registerAppSchemes`, because it now registers a scheme that serves no files. Update
  its call at `src/main/main.ts:152` and the import at `main.ts:78-82` (measured at plan time, re-verify).
- Keep one `protocol.registerSchemesAsPrivileged` call. Pass the two file schemes with `FILE_SCHEME_PRIVILEGES` as now,
  and add `{ scheme: VISUAL_SCHEME, privileges: VISUAL_SCHEME_PRIVILEGES }`.
- `VISUAL_SCHEME_PRIVILEGES` is `{ standard: true, secure: true }`. Write the reasons in its comment:
  - `standard`: the URL parses with a host and a path, as `visualHashOf` reads it, and a relative URL (`#anchor`)
    inside the visual resolves.
  - `secure`: the frame is a secure context, so Chromium's mixed-content check does not block it inside the page.
  - No `supportFetchAPI` and no `corsEnabled`: nothing fetches a visual; the page only loads it in a frame.
  - No `bypassCSP`: the frame's own CSP header must hold.
- Update the comment above the function so it names all three schemes.

### Store and response — `src/main/data-protocol/visual-documents.ts`

- This module imports `node:crypto` and `src/shared`, and not `electron`, so the test runs without Electron. The
  `src/main/data-protocol` layer already allows `node:` and `src/shared` (`scripts/check-layers.mts`): no `LAYERS`
  change.
- `createVisualDocuments()` holds a `Map<string, string>` from hash to source.
- `serve(source)`: hash = `createHash('sha256').update(source, 'utf8').digest('hex')`. Store the source under the hash.
  Return `visualUrl(hash)`.
- `response(url)`: `const hash = visualHashOf(url)`. When the hash is null or not in the map, return
  `new Response(null, { status: 404 })`. Otherwise return `new Response(document, { headers })` with exactly two
  headers: `'Content-Type': 'text/html; charset=utf-8'` and `'Content-Security-Policy': <the pinned CSP>`. Do not add
  `Access-Control-Allow-Origin`.

### Handler — `src/main/data-protocol/data-protocol.ts`

`serveVisualScheme()` creates the documents, calls
`protocol.handle(VISUAL_SCHEME, (request) => documents.response(request.url))`, and returns
`(source) => documents.serve(source)`. Write its comment in the style of `serveDataScheme`.

### Bridge call

- `src/contracts/bridge.ts`: add `serveVisual: 'bridge:serve-visual'` to `BRIDGE_CHANNELS`. Add to `Bridge`, with a
  comment: `serveVisual(source: string): Promise<string>;` — "Keeps a visual's source in main and resolves the
  `wigley-visual:` URL that serves it; the same source always gets the same URL."
- `src/preload/preload.ts`: add `serveVisual: (source) => ipcRenderer.invoke(BRIDGE_CHANNELS.serveVisual, source),`
  beside `layouts`.
- `src/main/main.ts`: in the `whenReady` callback, after `serveLayoutScheme(...)` (`main.ts:913`, measured at plan
  time, re-verify), add:
  `const serveVisual = serveVisualScheme();` and
  `ipcMain.handle(BRIDGE_CHANNELS.serveVisual, (_event, source: string) => serveVisual(source));`
  Both run before `createWindow`, so the handler exists before the page loads.

### Frame navigation guard — `src/main/window.ts`

Electron 44's `webContents` event `will-frame-navigate` takes one `details` event with `url`, `isMainFrame`, `frame`,
`initiator` and `preventDefault()`. It fires for the main frame and for every subframe. It does not fire for a
same-document navigation (`#anchor`) (electronjs.org/docs/latest/api/web-contents, read at plan time).

- Beside the `will-navigate` listener (`window.ts:48-53`), add a `will-frame-navigate` listener.
- When `refusesFrameNavigation(details)` returns true, call `details.preventDefault()` and log
  `log('main', `frame navigation refused: ${details.url}`)`. Put no other condition in the listener.
- The app has no subframe other than visuals, so the rule covers every subframe.
- Add one sentence to `createMainWindow`'s comment: a frame inside the page stays on the `wigley-visual:` scheme, and
  a frame navigation off it is refused and logged.

### Page CSP — `index.html`

Append `; frame-src wigley-visual:` to the end of the `content` attribute. The whole attribute becomes:

```
default-src 'self'; script-src 'self' wigley-data: wigley-layout:; style-src 'self' 'unsafe-inline' wigley-data: wigley-layout:; font-src 'self' data: wigley-layout:; img-src 'self' data: wigley-layout:; connect-src 'self' wigley-layout: ws://localhost:*; frame-src wigley-visual:
```

Add one line to the comment above the meta tag: `frame-src carries wigley-visual: for the visual frames.`

### Layers

No new folder appears in this task, so `scripts/check-layers.mts` does not change. `src/shared/visual-*.ts` sit in the
`src/shared` layer, which imports only `src/contracts` (`ColorScheme`) and `src/shared` (`file-url.ts`).

## Tests

`src/shared/visual-url.test.ts` (shape of `layout-url.test.ts`; `H` is `'ab'.repeat(32)`, built in the test):

- `visualUrl puts the hash in the path of the visual host` — `visualUrl(H)` is
  `'wigley-visual://visual/' + H`. Catches a hash moved to the host or a wrong scheme.
- `visualHashOf reads back a visual URL's hash` — a table: `visualUrl(H)` → `H`; `visualUrl(H) + '#top'` → `H`;
  `visualUrl(H) + '?x=1'` → `H`. Catches a parser that fails on its own builder's output, on a fragment, or on a
  query (the guard would then refuse a visual that navigates to its own URL with a query).
- `visualHashOf refuses a URL that is not a visual URL: $case` — one `it.each` table, each row → `null`:
  - other scheme: `'wigley-layout://visual/' + H`
  - other host: `'wigley-visual://other/' + H`
  - short hash: `'wigley-visual://visual/' + H.slice(1)`
  - uppercase hex: `'wigley-visual://visual/' + H.toUpperCase()`
  - extra segment: `'wigley-visual://visual/' + H + '/x'`
  - no hash: `'wigley-visual://visual/'`
  - not a URL: `'not a url'`

  Catches a dropped host check, a loose hash pattern or a missing scheme check. The guard in `window.ts` relies on
  these refusals.
- `refusesFrameNavigation decides by frame and scheme: $case` — one `it.each` table of
  `{ case, url, isMainFrame, refused }`:
  - subframe to a visual · `visualUrl(H)` · false · false
  - subframe to the network · `'https://example.com/'` · false · true
  - subframe to a blank page · `'about:blank'` · false · true
  - subframe to another app scheme · `'wigley-layout://forms/x/~1/layout.js'` · false · true
  - main frame to the network · `'https://example.com/'` · true · false
  - main frame to a visual · `visualUrl(H)` · true · false

  Catches a flipped `isMainFrame` test, a `!== null` read the wrong way, and a guard that refuses visuals themselves.

`src/main/data-protocol/visual-documents.test.ts`:

- `serves a source at the URL of its SHA-256 hash` — `serve('a')` is
  `'wigley-visual://visual/ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'` (the SHA-256 of `a`,
  written as a literal). A second `serve('a')` returns the same URL. `serve('b')` returns a different URL. Catches a
  hash of something other than the source, or a URL that changes per call (a page reload must find the same URL).
- `answers a served URL with the document under its CSP` — `const url = serve('<p>hi</p>')`, then
  `const answer = documents.response(url)`:
  - `answer.status` is `200`
  - `answer.headers.get('Content-Type')` is `'text/html; charset=utf-8'`
  - `answer.headers.get('Content-Security-Policy')` is the pinned CSP, written as a literal in the test. A loosened
    CSP (an added `connect-src`) is the break this catches; the browser parses this text, so the full text is asserted.
  - `answer.headers.get('Access-Control-Allow-Origin')` is `null`
  - `await answer.text()` starts with `'<!doctype html>\n<script>'`, ends with `'</script>\n<p>hi</p>'`, and contains
    `'wigley-visual:theme'`, `'wigley-visual:height'` and `'wigley-visual:escape'`. Catches the source placed before
    the bootstrap, a quirks-mode document, and a bootstrap whose message strings drift from the page's.
- `answers 404 for a URL it did not serve: $case` — one `it.each` table, each row `status` `404`:
  - unknown hash: `'wigley-visual://visual/' + 'cd'.repeat(32)`
  - not a visual URL: `'wigley-layout://forms/x/~1/layout.js'`

  Catches a handler that serves the last document, or throws, for a URL it does not hold.

No unit test reaches the `index.html` CSP edit, the scheme privileges, the `protocol.handle` call, the
`ipcMain.handle` wiring or the `will-frame-navigate` listener itself: each needs Electron. They are checked only in 09.

→ 09 Final verification: the `wigley-visual:` frame loads in the page (the page CSP allows it); a `fetch` inside a
visual fails under its CSP; a frame that sets `location` to an `https:` URL stays put and main logs
`frame navigation refused: <url>`; the bootstrap's height, theme and Esc messages reach the page (with 04).

## Proof

