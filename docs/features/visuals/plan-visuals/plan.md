# Visuals — plan

Feature: Visuals · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

An agent writes an ```` ```html ```` code block in its reply, and the app draws it as a live **visual**: a sandboxed,
offline frame styled by the user's theme. Visuals render in chat agent replies, forms rounds, the primer and the docs
browser. The test case is two visuals: a UI mockup preview and a systems flowchart.

## Architecture

Systems touched:

- **Core markdown** — `MarkdownRenderer` (`src/contracts/markdown.ts`, adapter `src/renderer/markdown-it/`) gains a
  fence registry. A new markdown mount (`src/shared/page/markdown-mount.ts`) draws markdown into an element and owns
  live fence views. Every site that puts markdown HTML into the DOM draws through it.
- **Core main** — a third privileged scheme `wigley-visual:` in `src/main/data-protocol/`, a frame-navigation guard,
  and a Bridge call that serves a visual's source.
- **Core page** — a visual frames service (`src/renderer/visual-frames/`) handed to plugins as
  `PageServices.visualFrames`.
- **Agent harness** — `AgentStart` carries session instructions; the Claude Code adapter appends them to the system
  prompt.
- **Chat plugin** — exports `addInstructions` (main) and `focusedEntry` (page); keeps the transcript pinned when an
  entry grows on its own; user entries draw with live fences off.
- **New `visual` plugin** — the `html` fence contribution, the "drawing visual…" card, the full-size overlay and its
  `v` key, the session note, its layout.
- **Test fixtures** — the fake harness's `fake: visual` reply and the chat layout preview carry the mockup and the
  flowchart.

## Preconditions

`wigley:make` re-runs each command before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| The page CSP has no `frame-src` | `grep -c "frame-src" index.html` | `0` |
| Raw HTML is off in the markdown adapter | `grep -n "html: false" src/renderer/markdown-it/markdown-it-renderer.ts` | line 70 |
| Two privileged schemes exist, in one call | `grep -n "registerSchemesAsPrivileged" -A3 src/main/data-protocol/data-protocol.ts` | `[DATA_SCHEME, LAYOUT_SCHEME]` |
| The Claude CLI takes `--append-system-prompt` | `claude --help \| grep -c -- "--append-system-prompt <prompt>"` | `1` |
| `AgentStart` has no instructions field | `grep -n "interface AgentStart" -A7 src/contracts/agent.ts` | five fields, no `instructions` |
| No new package is needed | `git diff ec09d7c -- package.json` | empty |
| Docs written ahead are committed | `git log --oneline -1 ec09d7c` · `git -C ../wigley-ai-marketplace log --oneline -1 6fb5a28` | both exist |
| Another session has uncommitted work | `git status --short` | modified files under `src/plugins/{agents,sessions,workflow}/`, `src/plugins/chat/contract.ts`,
`src/plugins/chat/main/start.ts` (03 and 06 edit both: stage only their own hunks), `docs/features/workflow/` and `docs/features/followups.md`; untracked `src/plugins/workflow/{layouts,page}/`. No task stages them. Before a task edits `src/plugins/manifests.ts`, `main.ts`, `page.ts` or `keymap.ts`, it runs `git status --short` on that file and stages only its own hunks. |
| `origin` was not fetched | `git fetch origin` | refused (SSH key) at plan time; `main` was 10 ahead of the last fetched `origin/main` |

## Docs written ahead

- `docs/features/visuals/design.md` — new: the feature's design and rejected approaches. Commit `ec09d7c`.
- `AGENTS.md` — the folder map: `visual-url.ts`, the markdown mount, `visual-frames/`, the `wigley-visual:` scheme,
  the `visual` plugin, chat's new exports. Commit `ec09d7c`; corrected in `eb69a83`.
- `docs/features/followups.md` — the markdown follow-up keeps only `addBlock`. Commit `ec09d7c`.
- `plugins/wigley/skills/visuals/SKILL.md` in wigley-ai-marketplace — new: how an agent writes a visual. Commits
  `6fb5a28`, `e711df9`, `819c7a7`, `91b8ed2` (plugin 1.14.0, not pushed).

## Mandatory Reads

- `AGENTS.md` — every task.
- `DESIGN.md` — tasks 05, 06 (a view, its CSS, a layout, a key).
- `docs/keymap.md` — task 06 (the `v` key).
- `docs/features/layouts/design.md` — tasks 05, 06 (a new layout owner and its preview).
- `docs/features/visuals/design.md` — every task.
- `.agents/skills/drive/SKILL.md` — tasks 07, 09.

## Design Overview

```
agent reply ── ```html … ``` ──► MarkdownRenderer (adapter)
                                   a fence whose language has a contribution → placeholder element
                                   (language, closed flag, escaped source as the fallback text)
                                          │
                                          ▼
                                 markdown mount (src/shared/page/markdown-mount.ts)
                                   innerHTML, then each placeholder → contribution.mount(source, closed)
                                   reuses a FenceView while language + source are unchanged; disposes the rest
                                          │  (liveFences: false → placeholders stay as code)
                                          ▼
                       visual plugin: html FenceContribution
                         open block   → "drawing visual…" card (layout part)
                         closed block → services.visualFrames.open(source)
                                          │
                                          ▼
   core page: visual frames ── Bridge.serveVisual(source) ──► core main: wigley-visual scheme
     <iframe sandbox="allow-scripts" src=url>                   memory store by sha-256 of source
     posts theme in (load + every change)                       document = bootstrap script + source,
     takes height and Esc out                                   CSP header, no network; frame-navigation guard

   chat main: addInstructions(text) ──► AgentStart.instructions ──► claude --append-system-prompt
```

**Out of scope**

- `MarkdownRenderer.addBlock` and moving the `:::` blocks out of the adapter (stays in `followups.md`).
- Any diagram or chart library (Mermaid and the like): a later fence contribution, each package the user's ask.
- A `show_visual` MCP tool, a visual in its own pane, live-updating a visual by id.
- Persisting served visuals to disk.

**Decisions** (interview rounds 1–3)

- An html code block is the only authoring surface (round 1).
- Scripts run inside the frame; the network is blocked (round 1).
- Agents draw flowcharts as hand-written SVG; no library (round 1).
- Inline, plus a full-size overlay (round 1). The overlay key is `v` on the focused chat entry; `h`/`l` move between
  the entry's visuals; `Esc` closes. Each visual has an expand control, the route outside chat (rounds 2, 3).
- No height cap: the frame takes its content's full height (round 1).
- Test case: scripted fixtures for the build, then a real-agent run in the wrap-up for the user (round 1).
- Agents learn of visuals from an app session note that points at `wigley:visuals` (round 1).
- The concept is named **visual** everywhere (round 2).
- Visuals render everywhere markdown renders; the user's own chat messages keep html blocks as code (round 2).
- An open html block shows a "drawing visual…" card until its closing fence arrives (round 2).
- A click gives the visual focus; `Esc` inside it hands focus back to the page (round 2).
- Design review (round 3): the adapter stays string-only and the mount owns the DOM; fence contributions see the
  closed flag; the visual frames service has a live adapter and a fake; served sources live in memory by hash; chat
  exports `addInstructions` and `focusedEntry`; unregistering a fence leaves drawn views until their next redraw.

## File Structure

**Shared names** — every task that uses one of these uses it exactly as written here.

```ts
// src/contracts/markdown.ts — added beside MarkdownRenderer
export interface FenceView {
  readonly element: HTMLElement;
  dispose(): void;
}
// `closed` is false while the block's closing fence has not arrived (a streaming reply).
// `live` is true when the view runs the source (html), false when it only formats it (diff).
// A draw with liveFences: false skips live contributions only.
export interface FenceContribution {
  language: string;
  live: boolean;
  mount(source: string, closed: boolean): FenceView;
}
// MarkdownRenderer gains:
//   addFence(fence: FenceContribution): Disposable   — throws on a language already registered
//   fence(language: string): FenceContribution | undefined

// src/contracts/visual-frames.ts — new
export interface VisualFrame {
  readonly element: HTMLElement;   // sized to the content's full height by the service
  dispose(): void;
}
export interface VisualFrames {
  open(source: string): VisualFrame;
}
// PageServices (src/contracts/plugin.ts) gains:  visualFrames: VisualFrames;

// src/contracts/bridge.ts — Bridge gains:
//   serveVisual(source: string): Promise<string>     — resolves the frame's wigley-visual: URL

// src/shared/visual-url.ts — new
export const VISUAL_SCHEME = 'wigley-visual';
export function visualUrl(hash: string): string;
export function visualHashOf(url: string): string | null;

// src/contracts/agent.ts — AgentStart gains:
//   instructions: readonly string[];                 — [] when none

// src/plugins/chat/contract.ts
//   ChatMainExports gains:  addInstructions(text: string): Disposable;
//   ChatPageExports gains:  focusedEntry(): HTMLElement | null;   — the active Chat tab's focused entry

// src/shared/page/layout-host/kit.d.ts — BaseKit.markdown becomes:
//   markdown(parent: HTMLElement, text: string, className?: string,
//            options?: { liveFences?: boolean }): HTMLElement;   — liveFences defaults to true
```

**Existing files modified** (the task that owns each)

- `src/contracts/markdown.ts`, `src/renderer/markdown-it/markdown-it-renderer.ts`, `src/shared/page/dom.ts`,
  `src/shared/page/layout-host/base-kit.ts`, `src/shared/page/layout-host/kit.d.ts`,
  `src/plugins/forms/page/layout/card-kit.ts`, `src/plugins/forms/page/kinds/card-parts.ts`,
  `src/plugins/forms/page/layout/layout-panes.ts`, `src/plugins/backlog/page/backlog-view.ts`,
  `src/plugins/docs/page/doc-view.ts`, `src/shared/page/markdown.css` (the fence wrapper's margins),
  `src/renderer/shell/shell-chrome.ts` (the shell kit's mount disposed), `src/plugins/forms/page/round-view.ts`,
  `src/plugins/forms/page/layout/layout-cards.ts`, `src/plugins/forms/page/kinds/item-format.ts` (forms mounts
  disposed), `src/shared/page/test-dom.ts`
  (`FakeElement.querySelectorAll`), and every test or fake that builds a `MarkdownRenderer` literal (22, measured at
  plan time, re-verify) — 01
- `src/main/data-protocol/data-protocol.ts`, `src/main/main.ts`, `src/main/window.ts`, `src/contracts/bridge.ts`,
  `src/preload/preload.ts`, `index.html` — 02
- `src/contracts/agent.ts`, `src/main/claude-code/claude-launch.ts`, `src/plugins/chat/contract.ts`,
  `src/plugins/chat/main/chat-sessions.ts`, `src/plugins/chat/main/start.ts`; the `AgentStart` literals in
  `src/main/claude-code/claude-code-harness.test.ts` and `src/shared/fake-agent-harness.test.ts` — 03
- `src/contracts/plugin.ts`, `src/renderer/renderer.ts`, `src/renderer/theme.ts` (+ `theme.test.ts`,
  `transparency-override.test.ts`), `scripts/check-layers.mts` — 04 (`page-api.ts` already spreads the services)
- `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts`, `scripts/check-layers.mts` (the
  `src/plugins/visual*` layers) — 05
- `src/plugins/keymap.ts`, `src/plugins/chat/contract.ts` (`focusedEntry`), `src/plugins/chat/page/start.ts`,
  `src/plugins/chat/page/chat-view.ts`,
  `src/plugins/chat/page/entry-list.ts`, `src/plugins/chat/layouts/default/layout.js` (user entries draw with live
  fences off; assistant and thinking updates draw the new markdown before removing the old, so a frame stays loaded) — 06
- `src/shared/fake-agent-harness.ts` (+ test; the `fake: visual` reply), `src/plugins/chat/main/start.ts` (the drive
  `chat.start` description lists `fake: visual`), `src/plugins/chat/main/preview/preview-session.ts`,
  `src/plugins/chat/main/selftest-script.ts`, and every `createFakeAgentHarness` call (it gains a required `timers`
  argument: 21 calls measured at plan time, re-verify — two in `src/main/main.ts`, after 02 lands; the rest in
  `chat-sessions.test.ts`, `accounts.test.ts`, `folder-choices.test.ts`, `usage/main/drive-actions.test.ts`,
  `fake-agent-harness.test.ts`) — 07

**New files**

- `src/shared/page/markdown-mount.ts` (+ test, + `markdown-mount.test-support.ts`) — the one module that puts markdown into the DOM and owns fence
  views, so reuse and disposal live in one place (01).
- `src/shared/visual-url.ts` (+ test) — the scheme's URL pair, beside `layout-url.ts` (02).
- `src/shared/visual-messages.ts` — the frame message protocol main's bootstrap and the page's frames service share;
  in `src/shared` since the renderer cannot import main (02).
- `src/main/data-protocol/visual-documents.ts` (+ test) — the SHA-256 memory store, bootstrap and CSP, with no
  electron import so it is unit-tested (02).
- `src/renderer/visual-frames/` (+ test) — the live visual frames adapter (04).
- `src/shared/page/fake-visual-frames.ts` — the fake plugins test against; plugins cannot import `src/renderer` (04).
- `src/contracts/visual-frames.ts` — the seam plugins open a visual through (04).
- `src/shared/sample-visuals.ts` — the mockup and flowchart sources the fake reply and the chat preview share, so
  the two fixtures cannot drift (07).
- `src/plugins/visual/` — `manifest.ts`, `contract.ts`, `main/start.ts`, `page/start.ts`, the fence contribution, the
  overlay, `layouts/layout.d.ts`, `layouts/default/layout.js`, and `page/visual.css` (built-in layouts ship no CSS
  file; built-in CSS lives in `page/<plugin>.css`) (05, 06).

**Boundary rules**

- Only `src/main/data-protocol/` registers or serves a scheme; only main imports `electron`.
- The `visual` plugin imports only `src/contracts`, `src/shared`, its own folder, `src/plugins/chat/contract.ts` and
  `src/plugins/keys/contract.ts` (every layout kit reads `keys.anchor`); its manifest depends on `chat` and `keys`.
- Nothing outside `src/main/claude-code/` names `--append-system-prompt`.
- Every new folder gets its `LAYERS` entry in `scripts/check-layers.mts`; `npm run lint` passes.
- CSS reads `var(--wg-*)` only, and a frame's height is set through a CSS custom property (`scripts/check-styles.mts`).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Fence registry and markdown mount](01-fence-registry-and-mount.md)
- [x] [Visual scheme, guard and Bridge call](02-visual-scheme.md)
- [x] [Session instructions through the harness](03-session-instructions.md)

### Wave 2
- [x] [Visual frames service](04-visual-frames.md) — after 02

### Wave 3
- [x] [Visual plugin: fence, card and session note](05-visual-plugin.md) — after 01, 03, 04

### Wave 4
- [x] [Overlay, key and chat wiring](06-overlay-and-chat.md) — after 05

### Wave 5
- [x] [Test fixtures: mockup and flowchart](07-fixtures.md) — after 03, 06

### Wave 6
- [x] [Doc re-read](08-doc-re-read.md) — after 07

### Wave 7
- [x] [Final verification](09-final-verification.md) — after 08

## Run log

Review base: d7578311fe99437ccefe407289916bbcfa049eb8

### Groups
- 02 · a224d7a · diff read: every Produces present; typecheck + lint clean; 21 tests pass filtered · concerns: the guard refuses a subframe on about:blank or srcdoc, so 04 sets the iframe src only once serveVisual resolves (live check in 09)
- 03 · da9a67f · diff read: every Produces present, no --append-system-prompt outside src/main/claude-code; typecheck clean for its files; 262 tests pass filtered · concerns: none
- 04 · cf5e079 · diff read: every Produces present, src set only after serveVisual resolves; lint clean; 25 tests pass filtered; typecheck errors only in task 01's in-flight fakes · concerns: fake-visual-frames.ts sits in src/shared/page beside task 01's files (no file of 01 edited)
- 01 · 2a9c0ef · diff read: every Produces present, markdownElement gone; typecheck + lint clean; filtered tests 2779 pass · concerns: AGENTS.md says the mount reuses by language and source, but the key also holds the closed flag (for 08); a target redrawn without a view it lent out costs one extra mount
- 05 · 9e07f590 · diff read: every Produces present; typecheck + lint clean; 15 tests pass filtered · concerns: DESIGN.md Surfaces lacks the visual card and box; a user layout that appends its root after kit.frame reloads the visual on a layouts change; visualMainPart start order before keys not run live
- 06 · 93a87a8f · diff read: every Produces present, the v bind in keymap.ts, updates draw new markdown before removing the old; typecheck + lint clean; 1577 filtered tests pass · concerns: registry.sourcesIn(host) never matches the root itself, so the tests read it around the host (matches real use under chat's slot); the self-test logs 'unplaced v visual.openVisuals in chat.chat' until 07 draws a visual; one edit made by a python3 heredoc; overlay look untested until 09
- 07 · 69395151 · diff read: every Produces present, all 21 createFakeAgentHarness calls pass timers; typecheck + lint clean; 239 filtered tests pass; self-test steps run at 09 · concerns: the self-test's frame-loaded waits hash each sample source plus a trailing newline, matching what the mount's textContent hands main — the waits time out at 5 s if wrong; a send reaching the process during the 1.5 s hold does not clear it
- 08 · 6cc0e3a1 + marketplace f78537d · diff read: each fix states the code; items 3, 6, 7 no stale lines; marketplace Done commands pass · concerns: none
- 09 · 8d2b7965 (check 2 fix) · 1 PASS (window captures; element capture of an iframe fails UnknownVizError) · 2 FAIL then fixed in 8d2b7965: a scrollbar/height feedback loop on the width-scaled flowchart, re-run shows no strip (.drive/visuals-fix/screenshots/after-fix.png) · 3 PASS (2 mounted + 2 loaded lines, src unchanged, preview card) · 4 FALLBACK: no new loaded line; colours not visible offscreen → user check · 5 PASS (overlay 1 of 2, 2 of 2, closed) · 6 PASS low-confidence (slot 4→5; activeElement still the iframe) · 7 PASS (height 432, sandbox allow-scripts) · 8 PASS · 9 PASS (npm run selftest whole, every key placed, chat-visuals.png) · concerns: a visual wider than the column gets a horizontal scrollbar over its bottom ~15 px (reported height leaves it out); opening the preview or switching sessions reloads every frame; the preview's session-body stays un-hidden at width 0
### Contract changes
- MarkdownRenderer fakes: 22 files → 23 (composer-kit.test.ts too) · why: plan-time count missed it · consumers: none · group 01
- shell kit log: from createShellChrome → from mountShellChrome · why: createShellChrome does not exist · consumers: none · group 01
- docViewOver and roundViewSetup test helpers gain optional markdown/layout params; docs-page-fakes SourceLineFakeElement.querySelectorAll passes class selectors through · why: new tests need them · consumers: none · group 01
- createVisualCommands deps: inline type → exported VisualCommandsDeps, same members · why: repo *Deps convention · consumers: none · group 06
- VisualParts.visual(parent, frame) → visual(parent, frame, expand), plus overlay(parent, frame, input); createVisualBaseKit gains a scope argument; new createOverlayKit · why: one base-kit builder for three scopes · consumers: none outside the plugin · group 06
### Rulings
- the served body is doctype, script, source with no trailing newline in the bootstrap — matches the pinned order — whitespace only if wrong · group 02 · group 02
- registrations held in a Set of {text} objects rather than an array — insertion order kept, identity delete makes a second dispose a no-op, matches drop-targets addTarget — none if wrong · group 03 · group 03
- src/renderer/visual-frames layer also allows src/shared/page, since its test imports test-dom.ts and check-layers rules cover tests — the adapter itself imports none of it — a reviewer may want a test-only carve-out · group 04 · group 04
- the load log falls back to an empty hash when visualHashOf returns null — main only serves visual URLs — a blank hash in the log if wrong · group 04 · group 04
- a superseded view in another target of the same parent is taken outright, not borrowed — it would be disposed anyway — an early dispose of a still-shown view if wrong · group 01 · group 01
- a view lent to a sibling cannot be taken by another draw in the same task — avoids two placeholders sharing one view — an extra mount if wrong · group 01 · group 01
- new views mount after the staged children are appended — a contribution sees a connected placeholder — none · group 01 · group 01
- Drawn.element is the part's root and Drawn.dispose removes its div.visual-draw — fits redraw-then-dispose — none · group 05 · group 05
- the card part gets a plain BaseKit, only visual gets frame — matches the Layout contract — none · group 05 · group 05
- redraw runs over every live view with callEach so one failure does not stop the rest — none · group 05 · group 05
- blurFocusedElement moved unchanged to src/shared/page/dom.ts and chat's three callers repointed, rather than copied — writing-code reuse rule — four chat files carry an import-only change · group 06 · group 06
- installFakeDom's ResizeObserver stub gains an empty unobserve — existing entry-list tests threw without it — none · group 06 · group 06
- overlay CSS sets .visual-draw to display: contents under the scrim and pads the scrim with --wg-space-8 — the parts host puts a div between scrim and part root — the overlay look if wrong (09) · group 06 · group 06
- sample hash includes the trailing newline markdown-it leaves in the fence content — both ends keep it — self-test timeouts if wrong · group 07 · group 07
### Review rounds
### Test gate
- whole vitest suite picked: the range touches every MarkdownRenderer fake (23 files), every createFakeAgentHarness caller, the base kit every plugin draws through, and the chat entry list — the whole suite runs in ~16 s, so no narrower pick is worth its risk; typecheck and lint with it · 349 files / 5396 tests pass, no type errors
