# 01 — Split core: nudge, least widths, shared divider

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `src/contracts/panes.ts`
- modify `src/shared/page/ui/split-width.ts`
- modify `src/shared/page/ui/split.ts`
- modify `src/shared/page/ui/split.css`
- test `src/shared/page/ui/split-width.test.ts`
- test `src/shared/page/ui/split.test.ts`
- modify the five callers (limits, `anchor`, `timers`, `dispose`), and the wiring that hands their views `timers`:
  - `src/plugins/primer/page/primer-view.ts`, `src/plugins/primer/page/start.ts`, test
    `src/plugins/primer/page/primer-view.test.ts` (deps fake gains `timers`)
  - `src/plugins/forms/page/round-view.ts`, `src/plugins/forms/page/forms-view.ts`, `src/plugins/forms/page/start.ts`,
    test `src/plugins/forms/page/round-view.test.ts`, test `src/plugins/forms/page/forms-view.test.ts` (deps fake
    gains `timers`)
  - `src/plugins/backlog/page/backlog-view.ts`, `src/plugins/backlog/page/start.ts`, test
    `src/plugins/backlog/page/backlog-view.test.ts` (deps fake gains `timers`)
  - `src/plugins/docs/page/start.ts`
  - `src/plugins/gallery/page/gallery-view.ts`, `src/plugins/gallery/page/start.ts`, test
    `src/plugins/gallery/page/layout/gallery-parts.test.ts` (its `view(...)` helper gains a fake `timers`)

Consumes: nothing from another task. These names are already in the tree:
- `AnchorNamer<Options>` in `src/shared/page/ui/key-anchors.ts`
- `keyEdge(className, parts)` and `keyChevron(text)` in `src/shared/page/ui/key-anchors.ts`
- `KeysPageExports['anchor']` in `src/plugins/keys/contract.ts` (each plugin caller passes it)
- `Timers` (`set(run, ms): number; clear(handle): void`) in `src/contracts/ambient.ts`, and `PageServices.timers` in
  `src/contracts/plugin.ts` (each plugin's `start` hands it to its view)

Produces:
- in `src/contracts/panes.ts`:
  - `export type ResizeDirection = 'left' | 'right';`
  - `export interface ResizeTarget { nudge(direction: ResizeDirection): void; }`
  - `export const PANE_RESIZE_COMMANDS = { left: 'panes.resizePaneLeft', right: 'panes.resizePaneRight', up: 'panes.resizePaneUp', down: 'panes.resizePaneDown' } as const;`
- in `src/shared/page/ui/split-width.ts`:
  - `export interface SplitLimits { initial: number; min: number; endMin: number }`
  - `export const SPLIT_NUDGE_STEP = 24;`
  - `export function clampSplitWidth(width: number, limits: SplitLimits, span: number): number;`
  - `export function nudgedSplitWidth(width: number, direction: ResizeDirection, limits: SplitLimits, span: number): number;`
  - `export function storedSplitWidth(state: UiState, key: string, limits: SplitLimits): number;`
- in `src/shared/page/ui/split.ts`:
  - `export interface SplitOptions extends SplitLimits { uiState: UiState; stateKey: string; anchor: AnchorNamer<never>; timers: Timers }`
  - `export interface Split extends ResizeTarget { element: HTMLElement; start: HTMLElement; end: HTMLElement; width(): number; reloadWidth(): void; setStartHidden(hidden: boolean): void; dispose(): void; }`
  - `export interface SplitDividerOptions extends SplitLimits { uiState: UiState; stateKey: string; handle: HTMLElement; measure(): { left: number; span: number }; show(width: number): void; anchor: AnchorNamer<never>; timers: Timers; }`
  - `export interface SplitDivider extends ResizeTarget { width(): number; reloadWidth(): void; dispose(): void }`
  - `export function createSplitDivider(options: SplitDividerOptions): SplitDivider;`
  - `export function createSplit(options: SplitOptions): Split;`
- the prompt's anchor commands, which tests and task 04 rely on: every `Split` and `SplitDivider` calls its
  `anchor` exactly twice, with `PANE_RESIZE_COMMANDS.left` (`panes.resizePaneLeft`) then
  `PANE_RESIZE_COMMANDS.right` (`panes.resizePaneRight`), and no options. A test that counts a view's anchors tells
  the split's prompt anchors apart by these two command ids.

The anchor type is `AnchorNamer<never>` (`AnchorNamer<Options>` in `src/shared/page/ui/key-anchors.ts`, which
`recordingAnchor` already uses): the divider passes no options, so the prompt has no scope. `KeysPageExports['anchor']`
(`src/plugins/keys/contract.ts`) and `BaseKitDeps['keys']['anchor']` both fit `AnchorNamer<never>`. Do not import
`src/plugins/keys/contract.ts` into `src/shared/page/ui`: the layer check forbids it.

Decisions:
- No most width. Every pane has a least width. A divider stops where the pane it squeezes reaches its least width.
  The `min > max` throw goes. (plan.md › Decisions, round 2)
- Step 24px per press. A keyboard nudge writes uiState on each press, only when the width changed. A drag writes
  uiState once at its end, only when the width changed (unchanged from today). (round 1)
- A nudge does nothing while the handle has no layout box (`handle.getClientRects().length === 0`). This one check
  covers `is-stacked`, the 640px media stack, `is-start-hidden`, and a hidden side bar handle. (round 1;
  architecture)
- One divider core. `createSplitDivider` owns the drag on `handle`, the width, the stored width, `nudge`, the
  prompt and `dispose`. `createSplit` builds the two panes and the handle, then builds on `createSplitDivider`.
  (round 2)
- The resize prompt. The divider core draws the edge prompt `⌥⇧H ◂ ▸ ⌥⇧L` centred on `handle`. The prompt is
  `keyEdge('ui-split-prompt', [leftAnchor, keyChevron('◂'), keyChevron('▸'), rightAnchor])`, appended to `handle`.
  `leftAnchor` and `rightAnchor` are new empty `span` elements. The divider calls
  `options.anchor(leftAnchor, PANE_RESIZE_COMMANDS.left)` and `options.anchor(rightAnchor, PANE_RESIZE_COMMANDS.right)`,
  with no options. The prompt shows while the pointer is over
  the handle (`:hover`, and the gallery's `.is-hover`), while a drag runs (`.is-active`), and for 1000ms after each
  keyboard nudge (`.is-nudged` on the handle). It keeps no layout space. (user, round 4; the 1000ms is
  agent-settled)
- The linger timer runs on `options.timers`, the page's `Timers` seam (`src/contracts/ambient.ts`), never the global
  `setTimeout`: `src/shared/page/autosave.ts` and `src/renderer/page-keys.ts` already take `Timers` this way, and
  `PageServices.timers` reaches every plugin. A nudge clears the pending timer and sets a new one for 1000ms.
  (`wigley:codebase-design`: an ambient service is passed in)
- A nudge that does not change the width still shows the prompt for 1000ms, so the user sees the key run against a
  stop. A nudge on a handle with no layout box shows nothing. (agent-settled)
- `dispose()` on `Split` and `SplitDivider`: disconnect the ResizeObserver (`Split` only; the divider has none),
  remove every listener on the handle, remove the window listeners only while a drag holds them (through the path
  `endDrag` takes, so `dispose` touches no `window` outside a drag), clear the prompt's linger timer, and dispose
  both prompt anchors. Tests run in vitest's node environment with no `window`, and `round-view.test.ts` and
  `gallery-parts.test.ts` reach `dispose` outside a drag. After `dispose`, a drag and a nudge do nothing. A second `dispose` does nothing. `dispose` does not
  remove the element: its owner does. (user, round 4)
- The five callers pass their view's existing anchor function and call `dispose` where they drop the split. They
  set no resize target: that is tasks 03 and 04. (plan.md › Wave notes)
- Caller limits (plan.md › Pane least widths). `initial` stays as today:

  | Caller | Limits after |
  | --- | --- |
  | primer-view.ts `createPrimerFormView` | `{ initial: 240, min: 160, endMin: 320 }` (card least width; task 03 replaces this split) |
  | round-view.ts `createRoundView` | `{ initial: 240, min: 160, endMin: 224 }` |
  | backlog-view.ts `LIST_SPLIT` | `{ initial: 380, min: 240, endMin: 240 }` |
  | docs/page/start.ts `SESSION_TREE_SPLIT` | `{ initial: 288, min: 160, endMin: 240 }` |
  | gallery-view.ts `splitSample` | `{ initial: 240, min: 160, endMin: 160 }` |

- Caller anchors and dispose:

  | Caller | `anchor` | `timers` | `dispose` call |
  | --- | --- | --- | --- |
  | primer-view.ts | `deps.keys.anchor` | `deps.timers`; `PrimerViewDeps` gains `timers: Timers`, primer `start.ts` passes `services.timers` | in the form view's `dispose` |
  | round-view.ts | `deps.keys.anchor` | `deps.timers`; `RoundViewDeps` and `FormsViewDeps` gain `timers: Timers`, `forms-view.ts` passes it to `createRoundView`, forms `start.ts` passes `services.timers` | in the round view's `dispose`, after `parts.dispose()`; `rebuild` keeps the split and does not dispose it |
  | backlog-view.ts | `deps.keys.anchor` | `deps.timers`; `BacklogViewDeps` gains `timers: Timers`, backlog `start.ts` passes `services.timers` | none: the backlog view lives as long as the page |
  | docs/page/start.ts `addView` | `keys.anchor` (the `api.dependency<KeysPageExports>('keys')` in `start`) | `services.timers` | in the handle's `dispose`, after `added.view.dispose()`; the session-removed path also reaches it |
  | gallery-view.ts `splitSample` | `deps.keys.anchor`, passed through `sectionSpecs` | `deps.timers`, passed through `sectionSpecs`; `GalleryViewDeps` gains `timers: Timers`, gallery `start.ts` passes `api.services.timers` | `sectionSpecs` keeps the split `splitSample` made last; `splitSample` disposes it before it makes a new one, since each `setLayouts` draws fresh samples. Task 04 reads that kept split for the resize target |

  Pass `deps.keys.anchor` itself, not the primer's or forms' recording anchor: the split disposes its own anchors.
  Each new `timers` dep gets a one-line mention in its deps comment.

GIVEN a split 800px wide at width 240 WHEN the user presses the right resize key THEN the width is 264, uiState holds
264 under `stateKey`, and the prompt shows for 1000ms.
GIVEN a split whose end pane is at its least width WHEN the user presses the right resize key THEN the width stays,
uiState is not written, and the prompt shows.
GIVEN a stacked split WHEN the user presses either resize key THEN nothing changes and no prompt shows.
GIVEN a stored width larger than the window WHEN the split opens THEN it shows the stored width (no most width), and
CSS gives the end pane its least width.
GIVEN a view that drops its split WHEN it calls `dispose` THEN the observer stops, a later pointer event moves
nothing, and both prompt anchors are disposed.

Tests:
- `split-width.test.ts`, `clampSplitWidth` — one `it.each` table; it catches a lost least-width stop or a most width
  that came back. Limits `{ initial: 240, min: 160, endMin: 200 }` unless a row says other:

  | width | span | expected | row catches |
  | --- | --- | --- | --- |
  | 100 | 800 | 160 | start least width |
  | 700 | 800 | 600 | end least width (`span - endMin`) |
  | 250.6 | 800 | 251 | rounding |
  | NaN | 800 | 240 | non-finite takes `initial` |
  | Infinity | 800 | 240 | non-finite takes `initial` |
  | 300 | 300 | 160 | `min` wins when the span is too small |
  | 5000 | Infinity | 5000 | no most width |
  | NaN (`initial: 900`) | 800 | 600 | `initial` is clamped too |

- `split-width.test.ts`, `nudgedSplitWidth` — one `it.each` table, same limits; it catches a wrong step or a nudge
  past a stop:

  | width | direction | span | expected |
  | --- | --- | --- | --- |
  | 240 | right | 800 | 264 |
  | 240 | left | 800 | 216 |
  | 170 | left | 800 | 160 |
  | 160 | left | 800 | 160 |
  | 590 | right | 800 | 600 |
  | 600 | right | 800 | 600 |

- `split-width.test.ts`, `storedSplitWidth` — keep the table; change the `999` row to expect `999` (no most width)
  and add the row `{ 'docs-tree': 100 }` → `160`.
- `split.test.ts` — the existing drag, `reloadWidth` and `endMin` tests stay, moved to the new limits
  `{ initial: 240, min: 160, endMin: 200 }` and a fake `anchor`. The fake root reports a client rect
  `{ left: 0, width: 800 }`, and the fake handle a width of 0 and one client rect unless a test empties it.
- `split.test.ts`, `createSplit nudge` — `it.each`: `nudges one step and stores only a changed width`. Rows
  `{ stored, direction, width, written }`: `(240, 'right', 264, 264)`, `(240, 'left', 216, 216)`,
  `(160, 'left', 160, not written)`. Every row also asserts the handle has `is-nudged` and one 1000ms timer is
  armed. It catches a nudge that skips uiState, writes an unchanged width, or returns before the prompt at a stop.
- `split.test.ts`, `does nothing while the handle has no layout box` — the handle's `getClientRects()` returns
  `[]`; a nudge leaves width 240, writes nothing, and adds no `is-nudged`. It catches a resize of stacked panes.
- `split.test.ts`, `shows the prompt for 1000ms after a nudge` — with a fake `Timers` that records each armed
  `{ run, ms }` and each clear (as `fakeTimers` in `src/renderer/page-keys.test.ts`): after a nudge the handle has
  `is-nudged` and one timer is armed for 1000ms; a second nudge clears it and arms a new 1000ms one; running the armed
  timer removes `is-nudged`. It catches a prompt that never hides or a nudge that does not restart the moment.
- `split.test.ts`, `anchors the resize prompt in the handle` — the fake anchor records two calls, commands
  `panes.resizePaneLeft` then `panes.resizePaneRight`, options `undefined`, each element inside the handle's
  `ui-split-prompt`. It catches a prompt drawn with a scope or a wrong command.
- `split.test.ts`, `dispose stops the split` — mid-drag, `dispose` leaves no `pointerup` or `pointercancel`
  listener on the fake window; the fake ResizeObserver records `disconnect`; both recorded anchors are disposed; a
  later `pointermove` and a later nudge leave the width as it was; the pending linger timer is cleared. It catches
  each leak the decision names.
- `primer-view.test.ts`, `forms-view.test.ts`, `backlog-view.test.ts`, `round-view.test.ts` — each deps fake gains
  `timers` (a fake that arms nothing until fired); no test changes its claim.
- `round-view.test.ts` — the two tests that fail once the split takes `deps.keys.anchor`:
  - `rebuild_DisposesTheFirstBuildsAnchors`: filter the anchors whose command is `panes.resizePaneLeft` or
    `panes.resizePaneRight` out of `firstBuild`, since a rebuild keeps the split and its prompt. It still catches a
    rebuild that leaks the first build's anchors.
  - `dispose_DisposesEveryAnchor`: unchanged; it passes because `RoundView.dispose()` now calls `split.dispose()`.
    It now also catches a round view that forgets to dispose its split.
- `split.test.ts`, `createSplitDivider drags a handle it did not build` — `measure` returns
  `{ left: 100, span: 800 }`; a drag to `clientX` 400 calls `show(300)`, and a drag to `clientX` 900 calls
  `show(600)` (`endMin` 200). It catches a divider that reads the root rect instead of `measure`.

Approach:
- `createSplit`: `measure()` reads `root.getBoundingClientRect().left` and
  `root.getBoundingClientRect().width - handle.getBoundingClientRect().width`; `show(width)` sets
  `--ui-split-start`, as `showWidth` does now. It always sets `--ui-split-end-min` to `${endMin}px` and always
  observes the root for `is-stacked` (narrower than `min + endMin`), since `endMin` is now required.
- `split.css`: `.ui-split-prompt` is absolutely placed at the handle's centre (`top: 50%; left: 50%`, translated
  by half its size), with `pointer-events: none`, `visibility: hidden`, and a z-index over both panes. It shows
  under `.ui-split-handle:hover`, `.is-hover`, `.is-active` and `.is-nudged` on its handle. Write the selectors
  against the prompt's parent handle, not `.ui-split-handle` alone, since the shell's side bar handle (task 02)
  holds the same prompt. Give it a solid fill and border from `DESIGN.md` tokens so pane text does not show
  through it. No animation.
- The linger timer uses `options.timers.set` / `options.timers.clear` (see the decision above).

Done when: `npm run typecheck` and `npm run lint` (layer check, style check, oxlint, oxfmt) pass; the test gate
runs the tests above.

Commit: one commit for the group.

## Proof

