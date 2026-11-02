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
- [ ] [Fence registry and markdown mount](01-fence-registry-and-mount.md)
- [ ] [Visual scheme, guard and Bridge call](02-visual-scheme.md)
- [ ] [Session instructions through the harness](03-session-instructions.md)

### Wave 2
- [ ] [Visual frames service](04-visual-frames.md) — after 02

### Wave 3
- [ ] [Visual plugin: fence, card and session note](05-visual-plugin.md) — after 01, 03, 04

### Wave 4
- [ ] [Overlay, key and chat wiring](06-overlay-and-chat.md) — after 05

### Wave 5
- [ ] [Test fixtures: mockup and flowchart](07-fixtures.md) — after 03, 06

### Wave 6
- [ ] [Doc re-read](08-doc-re-read.md) — after 07

### Wave 7
- [ ] [Final verification](09-final-verification.md) — after 08

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
