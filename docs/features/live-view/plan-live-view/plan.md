# Live view — plan

Feature: Live view · Implements: none · Ticket: none
Target: `main` of wigley-ai-gui and of wigley-ai-marketplace, through each repo's `live-view` worktree branch · Written: 2026-11-10

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Each session's hub gets a **Live** section directly under Main agent. The section streams a Unity editor's Game View,
so the user watches the game beside the chat while the agent playtests. The agent alone shows and hides it, through
two tools: `show_live_view` and `hide_live_view`. The `wigley:unity-playtest` skill calls them. This rebuilds the
result that `docs/features/live-view/spike.md` describes. The spike's code (branch `spike/live-window-view`) is a
reference only.

## Architecture

Two repos:

- **wigley-ai-gui** (worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-live-view`, branch
  `live-view`):
  - a new core service `ScreenCapture` (`src/contracts/screen-capture.ts`), with macOS and Windows adapters in
    `src/main/screen-capture/`, picked in `src/main/main.ts`, and a fake for self-test and drive runs
  - a new chat side part option, `shrinksLast`
  - a new plugin `src/plugins/live-view/`: the tools, the `live-view.picks` slot, the window pick and the crop, the
    hub section, its layout, the preview sample and the self-test
- **wigley-ai-marketplace** (worktree
  `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-live-view`, branch `live-view`):
  - `capture.py start` replies with `game_view`
  - the `WigleyCapture.cs` probe rect loses the toolbar strip at its cause

Both worktrees land on their repo's `main` per `~/wigley-agents/WigleyRepos.md` § Landing.

## Preconditions

Run each command again before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| The gui worktree holds the docs written ahead | `git -C /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-live-view log --oneline -2` | `7b97e09d` (docs) on `3c5eca0e` |
| The marketplace worktree holds its docs written ahead | `git -C /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-live-view log --oneline -1` | `95a1dfb` |
| No code in the gui uses `desktopCapturer` or `systemPreferences` | `grep -rn 'desktopCapturer\|systemPreferences' /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-live-view/src` | no match |
| A running Unity editor writes its pid to `Library/EditorInstance.json` | `cat /Users/jonathonwigley/Documents/dev/peoplefun/new-games-prototypes/NewGamesPrototypes/Library/EditorInstance.json` | holds `"process_id" : <n>` (Unity 6000.3.12f1) while the editor is open |
| `services.openExternal` refuses non-http URLs | `grep -n "EXTERNAL_SCHEMES" /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-live-view/src/shared/external-links.ts` | `new Set(['http:', 'https:'])` |
| Both local `main` branches are current with origin | `git -C <repo> fetch origin && git -C <repo> rev-list --count main..origin/main` for `wigley-ai-gui` and `wigley-ai-marketplace` | **not verified**: `fetch` failed with `Permission denied (publickey)` (1Password SSH agent). Fetch again at preflight. When origin is ahead, rebase each `live-view` branch on `origin/main` |

## Docs written ahead

- wigley-ai-gui `7b97e09d`:
  - `docs/features/live-view/design.md` (new): the settled design. Every task reads it.
  - `docs/features/live-view/spike.md` (copied from `spike/live-window-view`)
  - `docs/features/chat-bar/design.md` § The session hub: the Live line in the tree, order 15, `shrinksLast` under
    Height
  - `docs/features/layouts/design.md`: the `live-view` owner row, and the Live section in the `Space z l c` row
  - `AGENTS.md`: `screen-capture.ts` in `src/contracts/`, `screen-capture/` in `src/main/`, the `live-view/` plugin,
    the side part list, the ambient service list, and the self-test script list
  - `DESIGN.md` § Surfaces: Live in the hub paragraph
- wigley-ai-marketplace `95a1dfb`:
  - `plugins/wigley/skills/unity-playtest/SKILL.md`: the Live view bullet in Session setup, and `hide_live_view` in
    Stopping
  - `plugins/wigley/skills/unity-playtest/capture.md`: `game_view` in the `start` row's output

## Mandatory Reads

- wigley-ai-gui `AGENTS.md`, the whole file: the plugin rules, layers, services, slots, layouts, self-tests and
  running tests
- wigley-ai-gui `DESIGN.md`: § Layers, § Tokens and themes, § Keys and focus, § Primitives, § Surfaces (the hub
  paragraph), § Icons and copy, § Checks
- `docs/features/live-view/design.md` and `spike.md`
- `docs/features/chat-bar/design.md` § The session hub (tasks 02, 06)
- `docs/features/layouts/design.md` (task 06)
- `docs/features/system-stats/design.md` § Reading the machine: the per-OS service pattern (tasks 01, 04)
- wigley-ai-marketplace `AGENTS.md` (tasks 03, 07, 08), and `plugins/wigley/skills/unity-playtest/SKILL.md` and
  `capture.md` (tasks 03, 07)
- `~/wigley-agents/WigleyRepos.md` (landing both repos)

## Design Overview

```
agent (main or subagent)
  │ capture.py start ──► reply.game_view [x,y,w,h]          (marketplace: 03, 07)
  │ show_live_view {projectPath, gameRect?}
  ▼
live-view main ── read <projectPath>/Library/EditorInstance.json ► process_id
  │            ── services.screenCapture.listWindows() ──► {access, windows front to back}
  │            ── pickEditorWindow(windows, pid, rect) + cropOf(rect, bounds)
  │            ── writes live-view.picks[sessionId] = stream pick | blocked
  ▼
live-view page ── reads live-view.picks ── chat.addSidePart({order 15, shrinksLast})
  │  section on screen? ── openStream(sourceId, frameRate)
  │                         sample:WxH ► canvas test card      desktop ► getUserMedia
  ▼
<video> cropped by object-view-box; moved / closed / blocked line + button from the layout

ScreenCapture (core) = createScreenCapture({ windows: OsWindowLister, sources, access, openSettings })
   macOS: JXA CGWindowList + desktopCapturer + systemPreferences + x-apple.systempreferences URL
   Windows: PowerShell user32/DWM (points = pixels / (dpi/96)) + desktopCapturer; access always granted
   Linux: rejects · self-test and drive: fake (sample sources)
```

**Decisions** (each was settled in the interview, as a user answer or a Decided notice):

- Live takes the room first. Other sections shrink to their heads and a few lines. This is the chat side part option
  `shrinksLast` (round 1, Q1).
- When the editor is resized mid-stream, the section shows the whole editor window with a moved line, until the agent
  shows it again. The page detects this by comparing aspect ratios (round 1, Q2).
- When Screen Recording is off, the section shows a line and an `Open System Settings` button, and the tool reply says
  the same (round 1, Q3).
- Both macOS and Windows get an adapter. The user checks Windows live (round 1, Q4).
- Window lookup and capture are a core service with one adapter per OS. No plugin imports electron.
- The editor process is found through `Library/EditorInstance.json`'s `process_id`, not by window title. A floating
  Game View is the frontmost window of that process whose bounds hold the rect.
- The toolbar strip is fixed at its cause in the probe, not trimmed by a fixed number.
- `capture.py start` returns `game_view` from a probe taken after recording starts, because the Recorder resizes the
  Game View at start.
- The tools are open to subagents (not `mainAgentOnly`).
- The per-session pick is a keyed slot owned by main, so a page reload keeps it.
- The window pick, the crop and the moved test are pure functions with vitest tables.
- The preview and the self-test use a sample source (`sample:<width>x<height>`), a canvas test card, so neither needs
  Unity or a Screen Recording grant.
- Live draws through its own layout (`live-view.layout`), sampled in chat's preview (`Space z l c`).
- The in-app stream with a real editor (macOS and Windows) is a check for the user, listed in the wrap-up. The agent
  checks the probe rect itself with `screencapture -R` (task 07, task 09).

**Out of scope:**

- Pick and Stop buttons for the user (rejected in the spike).
- A live ScreenCapture option for drive runs (`npm run drive`): drive runs use the fake.
- Showing more than one window per session.

## File Structure

**wigley-ai-gui** — new files:

| Path | Why |
|---|---|
| `src/contracts/screen-capture.ts` | the `ScreenCapture` seam that `live-view` main reads (01) |
| `src/main/screen-capture/screen-capture.ts` | `createScreenCapture`: merges OS windows with capture sources (01) |
| `src/main/screen-capture/unavailable-screen-capture.ts` | Linux (01) |
| `src/main/screen-capture/electron-capture.ts` | the Electron calls: `desktopCapturer` sources, `systemPreferences` access, `shell.openExternal` of the settings URL (01) |
| `src/main/screen-capture/mac-window-list.ts`, `windows-window-list.ts` + parsers + tests | the per-OS `OsWindowLister` (04) |
| `src/shared/fake-screen-capture.ts` | the fake for self-test, drive and part tests (01) |
| `src/plugins/live-view/**` | the plugin (05, 06) |

**wigley-ai-gui** — existing files modified: `src/contracts/plugin.ts` (`MainServices.screenCapture`), `src/main/main.ts`
(the pick and the mode wiring), `scripts/check-layers.mts` (the new folder), `src/shared/plugin-part-harness.test-support.ts`
(`notFaked`), `src/plugins/chat/contract.ts`, `src/plugins/chat/page/side-sections.ts`, `src/plugins/chat/page/chat.css`,
`src/plugins/chat/page/side-sections.test.ts`, `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts`.

**wigley-ai-marketplace** — existing files modified: `plugins/wigley/skills/unity-playtest/capturelib/commands.py`,
`tests/test_capture.py`, `tests/fakes.py`, `unity/WigleyCapture.cs`, both plugin manifests (version bump, task 08).

**Shared names** (written by one task, read by another):

```ts
// src/contracts/screen-capture.ts  (01)
export interface ScreenRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export interface CaptureWindow {
  readonly sourceId: string;      // the id the page hands getUserMedia, or a `sample:<w>x<h>` id
  readonly processId: number;     // the owning process
  readonly title: string;
  readonly bounds: ScreenRect;    // global screen points, top-left origin
}
export type WindowList =
  | { readonly access: 'granted'; readonly windows: readonly CaptureWindow[] }   // front to back
  | { readonly access: 'blocked' };
export interface ScreenCapture {
  listWindows(): Promise<WindowList>;
  openAccessSettings(): Promise<void>;
}

// src/main/screen-capture/screen-capture.ts  (01; 04 implements OsWindowLister)
export interface OsWindow { readonly number: number; readonly processId: number; readonly title: string; readonly bounds: ScreenRect; }
export interface OsWindowLister { list(): Promise<readonly OsWindow[]>; }   // front to back, on-screen only
export interface ScreenCaptureDeps {
  readonly windows: OsWindowLister;
  sources(): Promise<readonly { readonly id: string }[]>;
  access(): 'granted' | 'blocked';
  readonly blockedWhenNoSources: boolean;   // true on macOS: no window source means no grant yet
  openSettings(): Promise<void>;
}
export function createScreenCapture(deps: ScreenCaptureDeps): ScreenCapture;

// src/shared/fake-screen-capture.ts  (01; 05 and 06 read)
export const FAKE_EDITOR_PROCESS_ID: number;           // 4242
export const FAKE_GAME_RECT: readonly [number, number, number, number];  // inside the fake editor window
export function createFakeScreenCapture(options?: { access?: 'granted' | 'blocked' }): ScreenCapture;

// src/plugins/chat/contract.ts  (02; 06 sets it)
ChatSidePart.shrinksLast?: true

// src/plugins/live-view/contract.ts  (05; 06 reads)
export interface CaptureCrop { readonly x: number; readonly y: number; readonly width: number; readonly height: number; } // fractions
export type LivePick =
  | { readonly kind: 'stream'; readonly sourceId: string; readonly summary: string;
      readonly windowSize: { readonly width: number; readonly height: number }; readonly crop: CaptureCrop | null }
  | { readonly kind: 'blocked' };
export const livePicksSlot: KeyedSlotKey<LivePick, 'main', 'live-view'>;   // id 'live-view.picks'

// src/plugins/live-view/window-pick.ts  (05; 06 reads streamMoved)
export function pickEditorWindow(windows: readonly CaptureWindow[], processId: number, gameRect: ScreenRect | null): CaptureWindow | null;
export function cropOf(rect: ScreenRect, bounds: ScreenRect): CaptureCrop;
export function streamMoved(windowSize: { width: number; height: number }, streamSize: { width: number; height: number }): boolean;
export function pickOf(list: WindowList, processId: number, gameRect: ScreenRect | null, folder: string): { pick: LivePick } | { error: string };
export function rectOfTuple(values: readonly [number, number, number, number]): ScreenRect;

// src/plugins/live-view/main/live-tools.ts  (05; 06's self-test calls show)
export function createLiveTools(deps: LiveToolsDeps): {
  readonly definitions: readonly ToolDefinition[];
  startSession(session: AgentSession): ToolSession;
  show(sessionId: string, args: { projectPath: string; gameRect: readonly [number, number, number, number] | null }): Promise<ToolResult>;
};
// LiveToolsDeps: files, paths, screenCapture, the picks slot writer, log; 05 names the exact Picks.
```

**Boundary rules:** no plugin imports `electron` or `node:`. Only `src/main/screen-capture/electron-capture.ts` and
`src/main/main.ts` touch Electron for this feature. `live-view` reaches the OS only through `services.screenCapture`
and `services.files`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [ScreenCapture core service](01-screen-capture-core.md)
- [ ] [Chat side part option shrinksLast](02-chat-shrinks-last.md)
- [x] [capture.py start replies with game_view](03-capture-game-view.md)

### Wave 2
- [ ] [macOS and Windows window lists](04-os-window-lists.md) — after 01
- [ ] [live-view plugin: tools, slot, window pick](05-live-view-main.md) — after 01

### Wave 3
- [ ] [live-view section, layout, preview and self-test](06-live-view-section.md) — after 02, 05

### Wave 4 (Unity phase)
- [ ] [Probe rect without the toolbar strip](07-probe-toolbar-strip.md) — after 03

### Wave 5
- [ ] [Doc re-read](08-doc-re-read.md) — after every task above
- [ ] [Final verification](09-final-verification.md)

## Run log

Review base: 1449ada4

### Groups
- 03 · hard · d6a4c14 (marketplace) · diff read: game_view from a post-start probe, warning on failure, --append covered, four-row table plus append assertion; py_compile clean; tests run at the test gate · concerns: two existing tests rewritten to pick the start request rather than the last one; capture.md's start row does not list the new 'game view probe failed' warning (task 08)
### Contract changes
### Rulings
- Marketplace review base is 95a1dfb (live-view worktree tip at preflight); the gui base above covers wigley-ai-gui only — git fetch fails (Permission denied (publickey)) in and out of the sandbox, so both runs build on local main, which sits at the worktrees' base — a rebase at landing catches any origin drift · lead
- The second probe runs after save_run and write_current, so a probe failure cannot lose the run — none to consumers if wrong · group 03 · group 03
- FakeUnity gains window, recording and probe_while_recording; replies[...] still wins — a replies['stop'] override leaves recording set, no test depends on it · group 03 · group 03
### Review rounds
### Test gate
