# Pane resize — plan

Feature: Pane resizing and primer columns · Implements: none · Ticket: none
Target: main · Written: 2026-10-28

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

**Contents**

- **Goal** — what the user gets.
- **Architecture** — the systems this plan touches.
- **Preconditions** — the repo facts the plan rests on, each with its check.
- **Docs written ahead** — the doc commit this plan implements.
- **Mandatory Reads** — what every implementer reads first.
- **Design Overview** — the after-state flow, the decisions and their source, out of scope.
- **File Structure** — files per task, boundary rules, and every shared name and signature.
- **Tasks** — the groups by wave, and the drafting parts.
- **Run log** — written by `wigley:make`.

## Goal

The user resizes every pane from the keyboard, as in tmux. `Alt+Shift+h` / `Alt+Shift+l` move the focused pane's
divider 24px. Every createSplit split (primer, forms, backlog, docs, gallery) and the shell side bar resize this way.
The side bar also gets a drag handle and a stored width. Splits lose their most width: a divider stops only where
the pane it squeezes reaches its least width. The Primer tab's nested rail becomes three columns, tasks | items |
card, each with its own focus, rows and keys. Every key is a named command that the user can rebind in
`~/.config/wigley-ai-gui/keymap.json` with hot reload.

## Architecture

Systems touched:

- **Split core** (`src/shared/page/ui/split.ts`, `split-width.ts`, `split.css`): gets deeper. It gets a keyboard
  nudge, a least width for each pane, no most width, and one divider core that `createSplit` and the shell side bar
  share. The clamp and nudge rules live in `split-width.ts`.
- **Contracts** (`src/contracts/panes.ts` new, `src/contracts/plugin.ts`): the `ResizeTarget` interface, the resize
  command ids, and the page plugin API call `api.panes.setResizeTarget`.
- **Page core** (`src/renderer/`): a new pane-resize module holds the target and runs the four core page commands.
  The scope stack tells it when the base scope changes. The shell (`src/renderer/shell/`) mounts the side bar's
  drag handle and divider.
- **Core commands and keys** (`src/config/keymap.ts`, `src/plugins/keymap.ts`): four core page commands and two
  default binds.
- **Primer plugin** (`src/plugins/primer/`): state, commands, manifest, view, kit, layout contract, default layout,
  CSS, tests and self-test move from the rail to three columns.
- **Forms, backlog, docs and gallery page parts**: each view sets its split as the resize target.

## Preconditions

Each claim was measured at plan time. Re-verify each one before the run starts.

| Claim | Command | Result at plan time |
| --- | --- | --- |
| `main` is level with `origin/main`, with the docs commit on top | `git rev-parse origin/main`; `git log --oneline -1` | origin `82093730d50040eb8a23d5cea68e8bb08ad8c1fe`; HEAD `6899a12`, the three doc commits below on top (not pushed) |
| `docs/features` is a plain folder at the repo root | `test -L docs/features` | not a symlink |
| Five non-test callers of `createSplit` | `grep -rln "createSplit(" src --include='*.ts' \| grep -v "test\|split.ts" \| wc -l` | 5: primer-view.ts, round-view.ts, backlog-view.ts, docs/page/start.ts, gallery-view.ts |
| `SplitLimits` is `{ initial, min, max }` and `createSplit` throws when `min > max` | read `src/shared/page/ui/split-width.ts`, `split.ts` | yes |
| No bind uses `<A-S-h>`, `<A-S-j>`, `<A-S-k>`, `<A-S-l>` | `grep -n "<A-S-[hjkl]>" src/plugins/keymap.ts` | none |
| `<A-S-o>` already parses and fires on the physical key | `grep -rn "<A-S-o>" src/plugins/keymap.ts src/plugins/forms/main/selftest-script.ts` | bound in keymap.ts, pressed in the forms self-test |
| Core commands are declared only in `coreCommands` (`src/config/keymap.ts`), today only `window.summon` (main) | read `src/config/keymap.ts` | yes; `commandInfos` in `src/shared/plugin-manifests.ts` merges them with `plugin: 'core'` |
| `src/config` is read only by main; `src/renderer` may import `src/contracts`, `src/shared`, `src/shared/page`, `src/shared/page/ui` | `grep -n "'src/renderer'" -A10 scripts/check-layers.mts` | yes |
| `ScopeStack` has `setBase`, `push`, `current`, `onChange` and no base-change listener | read `src/renderer/key-scope.ts` | yes |
| The side bar width is CSS only: `width: var(--wg-sidebar-width)` | `grep -rn "sidebar-width" src` | shell.css:174, gallery.css:260, theme-tokens.ts:144, catppuccin-mocha.json (`256px`) |
| uiState split keys today: `primer.primer-rail-width`, `forms.rail-width`, `backlog.listWidth`, `docs.sessionTree`, `gallery.split` | read each caller's `stateKey` | yes |
| `primer.rail` and `focusRail` references | `grep -rn "'primer.rail'\|primer\.rail\b" src --include='*.ts' \| wc -l`; same for `focusRail` | 19 and 10 (measured at plan time, re-verify) |
| The stopgap user layout exists | `ls ~/.config/wigley-ai-gui/layouts/primer/`; `cat ~/.config/wigley-ai-gui/settings.json` | `columns/` folder; `"primer": { "layout": "columns" }` |

## Docs written ahead

Commits on `main`:

- `72cee4c` ("Describe pane resizing and the three primer columns ahead of the code"): `docs/keymap.md`,
  `DESIGN.md`, `docs/features/primer/design.md`, `docs/features/layouts/design.md`, `AGENTS.md`
- `e52d697` (narrow tabs stack the primer columns, handles show the resize prompt):
  `docs/features/primer/design.md`, `docs/features/layouts/design.md`
- `6899a12` (the handles' resize prompt and split dispose): `AGENTS.md`, `DESIGN.md`, `docs/keymap.md`

These docs are hypotheses until task 05 re-reads them against the landed code.

## Mandatory Reads

- `AGENTS.md` (root): § Architecture (layers, plugins, keys, key scopes, key hints and anchors, layouts, the layer
  check) and § Running and testing. No other `AGENTS*.md`, `CLAUDE*.md` or `.claude/rules/*.md` applies: the copies
  under `.drive/` are drive-run homes, not project instructions.
- `DESIGN.md`: § Keys and focus (placement kinds), the primitives list (Split), § Surfaces (Side bar, Primer,
  Splits), the Breakpoints line.
- `docs/keymap.md` § Layers.
- `docs/features/primer/design.md` § The Primer tab and § Keys (tasks 03, 05).
- `docs/features/layouts/design.md` § The primer's columns (tasks 03, 05).
- Skills: `wigley:codebase-design`, `wigley:writing-code`, `wigley:writing-tests`.

## Design Overview

### After-state flow

```
 keydown <A-S-h> / <A-S-l>  (any scope; rebindable in keymap.json)
        │
        ▼
 page key engine ──runs──▶ core page command panes.resizePaneLeft / panes.resizePaneRight
                                   │
                                   ▼
                     src/renderer/pane-resize.ts  (PaneResize)
                     target ?? shell side bar divider
                                   │ nudge('left' | 'right')
                 ┌─────────────────┴──────────────────┐
                 ▼                                    ▼
      view's ResizeTarget (a Split)          shell.sideBarDivider (SplitDivider)
                 │                                    │
                 └──────────────┬─────────────────────┘
                                ▼
          split core (split.ts: createSplitDivider)
            handle has no layout box (stacked, over, hidden)? → do nothing
            width = nudgedSplitWidth(width, direction, limits, span)   (split-width.ts)
            show it; uiState.set(stateKey, width) when it changed

 who sets the target:
   view.shown / focus move ──▶ api.keys.setScope(scope)
                               │  base scope changed ──▶ ScopeStack.onBaseChange ──▶ PaneResize.dropTarget()
                               ▼
                         api.panes.setResizeTarget(split | null)   (tmux rule chosen by the view)

 Primer tab:
   ┌ outer Split 'tasks-width' ─────────────────────────────────────────────┐
   │ tasks column │ ┌ inner Split 'items-width' ───────────────────────────┐ │
   │  (min 160)   │ │ items column (min 160) │ card (min 320)              │ │
   │              │ └──────────────────────────────────────────────────────┘ │
   └─────────────────────────────── outer endMin = 160 + 320 = 480 ─────────┘
   focus tasks → target outer · focus items → target inner · focus card → target inner
```

### Decisions

- **One command pair, app-wide, tmux rule** — `panes.resizePaneLeft` / `panes.resizePaneRight` on `<A-S-h>` /
  `<A-S-l>` in scope `any`. `panes.resizePaneUp` / `panes.resizePaneDown` are declared and unbound. The command moves
  the focused pane's right divider when it has one, else its left divider; `h` moves it left, `l` right. (interview
  round 1)
- **Step 24px per press**; key repeat supplies the speed. A keyboard resize is written to uiState like a drag.
  (round 1)
- **No resize while stacked** — a divider whose handle has no layout box does nothing. One check covers
  `is-stacked`, the 640px media stack, and the side bar laid over or hidden. (round 1; the handle check is
  architecture)
- **No most width; every pane has a least width** — a divider stops only where the pane it squeezes reaches its least
  width. `createSplit` stays the one split module; the clamp rules live in `split-width.ts`. (round 2)
- **The side bar resizes through the split core** — one shared divider core (`createSplitDivider`) that
  `createSplit` builds on, so drag, store, clamp and nudge exist once. The shell keeps its grid and its replaceable
  `ShellLayout`: it mounts a handle over the side bar's right edge and gives the divider a `show` callback that sets
  the side bar's width. One width for every mode, key `shell.side-bar-width`. (round 2; the divider core is
  architecture: wrapping the side bar and main areas in a `createSplit` would break the `ShellLayout` contract)
- **The side bar opens at the `sidebar-width` theme token** — with no stored width, the divider's `initial` is the
  token's pixel value, read from the shell root's computed style at mount, `256` when it does not parse to a finite
  number. The token stays in the theme contract. (architecture; avoids a theme contract break)
- **Resize target interface** — `ResizeTarget` is one method, `nudge(direction)`, in `src/contracts/panes.ts`.
  Every `Split` and the side bar's `SplitDivider` extend it. The shell sees only the narrow interface, not the
  whole `Split`. The view, which knows its panes, applies the tmux rule and hands over the divider. The shell holds
  no pane registry. (design review)
- **Target lifetime** — `api.panes.setResizeTarget(target | null)`. A view calls it each time it sets its key
  scope, after `keys.setScope`. Every base scope change drops the target, so a stale target from a hidden view
  never moves; a view that sets none leaves the keys on the side bar. A pushed scope (help, which-key) is not a base
  change and keeps the target. (design review)
- **Core page commands** — the four commands are core commands, not a plugin's, since the core owns the side bar
  and the target. They are declared in `coreCommands` with `runsIn: 'page'` and registered in `renderer.ts`. Their
  ids live once in `src/contracts/panes.ts` (`PANE_RESIZE_COMMANDS`), because `src/renderer` cannot import
  `src/config`. (architecture)
- **uiState keys** — `primer.tasks-width`, `primer.items-width`, `shell.side-bar-width`. They replace
  `primer.primer-rail-width`. When `tasks-width` is unset and `primer-rail-width` holds a number, the primer view
  copies the number to `tasks-width` and deletes `primer-rail-width`, before it creates the outer split. (round 2)
- **Pane least widths** — primer tasks `160`, items `160`, card `320`, outer end `480`; tasks and items open at
  `240`. (round 2) Forms rail `160` / card `224` (kept). Backlog list `240` / detail `240`. Docs tree `160` / doc
  `240`. Gallery sample `160` / `160`. Side bar `160` / main `320`. The `initial` values stay as they are today.
  (agent-settled: each end least width keeps every split unstacked at the widths where it is unstacked today)
- **Primer columns** — two nested splits, tasks | (items | card). `OpenPrimer.pane` is `'tasks' | 'items' |
  'card'`; scopes `primer.tasks`, `primer.items`, `primer.card` replace `primer.rail` / `primer.card`. `j`/`k` (and
  `<C-l>`/`<C-h>`) step the focused column's own rows. `<A-h>`/`<A-l>` focus the column on either side. On the card,
  `<C-h>`/`<C-l>` step the column the card came from. The card follows the focused column's selection. (round 1)
- **Card choice** — tasks focused: the task card, or the feature card on the Feature row. Items focused: the
  selected item's card; with no item to select, the task (or feature) card. Card focused: the card of the column it
  came from (`cardColumn`). (round 1; the empty-items case is agent-settled)
- **Item selection** — selecting another task selects its first item, or no item when it has none. `j`/`k` in the
  items column clamp at both ends and never leave the task. (agent-settled)
- **Clicks** — a click on a task row selects it and focuses tasks. A click on an item row selects it and focuses
  items. A click on an item's mark toggles its include. (agent-settled)
- **Empty state copy** — Feature row: "Select a task to see its items." A task with no items: "No items. Press `a`
  on the task card to add one." (agent-settled; `DESIGN.md` § Empty states)
- **Headers the app keeps** — tasks header: save state, `⌃H ▲ ▼ ⌃L`, `⌥L items ›`. Items header: `‹ tasks ⌥H`,
  `⌃H ▲ ▼ ⌃L`, `⌥L card ›`. Card edge strip: `‹ items ⌥H`. The Review button stays in the tasks column's foot.
  (agent-settled, from the rail header today)
- **Primer layout contract** — the `rail` part splits into `tasks` and `items` parts. `RailRowInput`'s inline items
  and `expanded` go. A user layout that defines `rail` breaks; this is accepted. (round 2)
- **Stopgap removal** — after real columns land, remove `~/.config/wigley-ai-gui/layouts/primer/columns/` and the
  `"primer": {"layout": "columns"}` entry in `~/.config/wigley-ai-gui/settings.json`. This is user config outside
  the repo, so task 06 writes it as a per-run ask. (round 2; `~/wigley-agents/AGENTS.md` § Hard gates)

- **Resize key prompt** — an edge prompt `⌥⇧H ◂ ▸ ⌥⇧L` with no scope, drawn centred on each split handle and on
  the side bar handle. It shows while the pointer is over the handle, while a drag runs, and for a short moment
  after each keyboard nudge; it keeps no layout space. The divider core (`createSplitDivider`) draws it through an
  anchor function it is given, so every split and the side bar show it the same way: the shell anchors the side bar
  handle's prompt through the chrome keys (`chrome.setKeys`), each view anchors its own splits' prompts through its
  `keys.anchor`. This satisfies `AGENTS.md` § Key hints (no `[keys] unplaced <A-S-h> …` in the self-test). (user,
  round 4)
- **The side bar narrows with the window** — while the side bar is beside, the shell draws it at its width clamped
  to the current span (a `ResizeObserver` on the shell root, and again on each side bar layout change), so the main
  area keeps its 320px least width. Laid over or hidden, it draws at its width unclamped: an overlay squeezes no
  main area. uiState keeps the user's
  width; only a drag or nudge writes it. (user, round 5) `Alt+h` on the card always focuses the items column.
  (user, round 5)
- **Narrow windows stack** — the primer's least widths (160 + 160 + 320) stack its columns below a 640px tab, about a
  950px window with the side bar beside it. That is accepted: there is no second layout mode. (user, round 4)
- **`dispose` on every split and divider** — `Split` and `SplitDivider` gain `dispose()`: it disconnects the
  ResizeObserver, removes the drag listeners and disposes the handle's prompt anchor. Every view that drops a split
  on a redraw or on its own dispose calls it (primer view, forms round view, docs session tabs, gallery's `Split`
  sample, the shell on unmount; the backlog view keeps its one split for the page's life). The forms round view's
  call lands in 01, which keeps `round-view.test.ts` green once its split carries prompt anchors. Task 05 removes the follow-up "Split has no dispose" from
  `docs/features/followups.md`. (user, round 4)

### Out of scope

- Vertical (up/down) splits: `resizePaneUp` / `resizePaneDown` exist only as declared commands.
- Swap, split and close a pane (`Ctrl+Alt+hjkl`, `Alt+'`, `Alt+;`, `Alt+w` stay reserved).
- Making Settings' sections | rows, the Backlog homes pane or Docs mode's tree a split.
- Migrating user layouts that define the primer `rail` part.

## File Structure

### Task 01 — split core

- modify `src/shared/page/ui/split-width.ts` — the new `SplitLimits`, `SPLIT_NUDGE_STEP`, `clampSplitWidth`,
  `nudgedSplitWidth`, `storedSplitWidth`.
- modify `src/shared/page/ui/split.ts` — `createSplitDivider`, `SplitDivider`, and `createSplit` built on it;
  `Split extends ResizeTarget`; the `min > max` throw goes.
- test `src/shared/page/ui/split-width.test.ts` — clamp and nudge cases as table rows.
- test `src/shared/page/ui/split.test.ts` — nudge, store, stacked.
- create `src/contracts/panes.ts` — `ResizeDirection`, `ResizeTarget`, `PANE_RESIZE_COMMANDS`. Justification: a
  seam type that `src/shared/page/ui`, `src/renderer` and `src/config` all need; only `src/contracts` reaches all
  three.
- modify the five callers' limits (drop `max`, add `endMin`): `src/plugins/primer/page/primer-view.ts`,
  `src/plugins/forms/page/round-view.ts`, `src/plugins/backlog/page/backlog-view.ts` (`LIST_SPLIT`),
  `src/plugins/docs/page/start.ts` (`SESSION_TREE_SPLIT`), `src/plugins/gallery/page/gallery-view.ts`. The tree then
  compiles after 01 alone. 01 also passes each caller's `anchor` and adds the `split.dispose()` calls: primer form
  view dispose, `RoundView.dispose`, docs `addView` handle dispose, gallery `splitSample`. 03 and 04 keep these
  calls and add none of their own for the same splits.
- 01 also adds `timers: Timers` to `PrimerViewDeps`, `RoundViewDeps`, `FormsViewDeps`, `BacklogViewDeps` and
  `GalleryViewDeps`, and passes `services.timers` from the primer, forms, backlog, gallery and docs `start.ts`
  (modify `forms-view.ts` and those `start.ts` files; the deps fakes in `primer-view.test.ts`, `forms-view.test.ts`,
  `backlog-view.test.ts` and `round-view.test.ts`, and the `view(...)` helper in
  `src/plugins/gallery/page/layout/gallery-parts.test.ts`, gain `timers`).
- test `src/plugins/forms/page/round-view.test.ts` — the rebuild and dispose tests leave out the split's two prompt
  anchors (`PANE_RESIZE_COMMANDS.left`, `.right`).

### Task 02 — resize command, plugin API, side bar

- modify `src/contracts/plugin.ts` — `PageApi.panes`.
- create `src/renderer/pane-resize.ts` — `createPaneResize`. Justification: the target, the fallback and the
  commands are one small module that the composition root wires; `renderer.ts` stays wiring only.
- test `src/renderer/pane-resize.test.ts`.
- modify `src/renderer/key-scope.ts`, test `src/renderer/key-scope.test.ts` — `ScopeStack.onBaseChange`.
- modify `src/renderer/plugins/page-api.ts`, test `src/renderer/plugins/page-api.test.ts` — `panes`.
- modify `src/renderer/renderer.ts` — wire `PaneResize`, register the four commands, pass uiState to the shell.
- modify `src/renderer/shell/shell.ts`, `src/renderer/shell/shell.css`, test `src/renderer/shell/shell.test.ts` —
  side bar handle and divider.
- modify `src/config/keymap.ts` — four core page commands.
- modify `src/plugins/keymap.ts` — accept core page commands in `binds`; a `── Panes ──` banner with the two binds.
- modify `src/plugins/gallery/page/gallery.css` — the test shell layout's side bar reads `--shell-side-bar-width`.
- modify `src/plugins/forms/main/selftest-script.ts` — a step pressing `<A-S-l>` and `<A-S-h>` on the Form tab.
- The resize prompt anchor for the side bar handle, per the Resize key prompt decision.

### Task 03 — primer columns

- modify `src/plugins/primer/page/primer-state.ts`, `primer-commands.ts`, `primer-view.ts`, `primer.css`,
  `boxes.ts`, `primer-review.ts`, `start.ts`, `layout/primer-kit.ts`, `layout/read-primer-layout.ts`;
  `src/plugins/primer/manifest.ts`, `ids.ts`;
  `src/plugins/primer/layouts/layout.d.ts`, `layouts/default/layout.js`; `src/plugins/primer/main/selftest-script.ts`;
  the primer section of `src/plugins/keymap.ts`.
- test `primer-state.test.ts`, `primer-view.test.ts`, `primer-commands.test.ts`, `boxes.test.ts`,
  `primer-events.test.ts`, `primer-review.test.ts`, `layout/read-primer-layout.test.ts`.
- No new files.

### Task 04 — views set the resize target

- modify `src/plugins/forms/page/round-view.ts` and its wiring (`forms-view.ts` / `start.ts`, where `setScope` is
  wired); `src/plugins/backlog/page/backlog-view.ts`, `backlog/page/start.ts`; `src/plugins/docs/page/start.ts`
  (the docs split and every `setScope` call live there); `src/plugins/gallery/page/gallery-view.ts`,
  `gallery/page/start.ts`.
- tests: rows added to `round-view.test.ts`, `forms-view.test.ts` and `backlog-view.test.ts`. Docs' and gallery's
  `start.ts` have no test, so their wiring is a live check in 06.
- No new files.

### Boundary rules

- `src/contracts/panes.ts` imports nothing (`AGENTS.md`: contracts import nothing; `LAYERS['src/contracts']`).
  `plugin.ts` may import it: same layer.
- `src/shared/page/ui/split*.ts` imports `src/contracts` and its own layer (`../dom`, `./key-anchors`) only.
- `src/renderer/**` reaches the split core through `src/shared/page/ui` (allowed) and never imports `src/config`
  (read only by main). The core command ids come from `src/contracts/panes.ts`.
- Plugins reach the resize target only through `api.panes.setResizeTarget`, passed into their views as a dep beside
  `setScope`. No plugin imports `src/renderer`.
- No new layer, adapter or plugin folder, so `scripts/check-layers.mts` needs no new `LAYERS` entry.

### Shared names and signatures

`src/contracts/panes.ts` (01; consumed by 02, 03, 04):

```ts
export type ResizeDirection = 'left' | 'right';

// A divider between two panes that the resize keys move one step. A divider
// that cannot move (stacked panes, a pane at its least width) stays.
export interface ResizeTarget {
  nudge(direction: ResizeDirection): void;
}

export const PANE_RESIZE_COMMANDS = {
  left: 'panes.resizePaneLeft',
  right: 'panes.resizePaneRight',
  up: 'panes.resizePaneUp',
  down: 'panes.resizePaneDown',
} as const;
```

`src/shared/page/ui/split-width.ts` (01):

```ts
// `min` is the start pane's least width, `endMin` the end pane's; no most width.
export interface SplitLimits { initial: number; min: number; endMin: number }
export const SPLIT_NUDGE_STEP = 24;
// `span` is the width both panes share: the split's width less the handle's.
// Non-finite `width` takes `initial`; the result is rounded, then held in
// [min, span - endMin], `min` winning when the span is too small.
export function clampSplitWidth(width: number, limits: SplitLimits, span: number): number;
// `width` moved SPLIT_NUDGE_STEP left (smaller) or right (larger), then clamped.
export function nudgedSplitWidth(width: number, direction: ResizeDirection, limits: SplitLimits, span: number): number;
// The stored width clamped with span Infinity; `initial` when not a finite number.
export function storedSplitWidth(state: UiState, key: string, limits: SplitLimits): number;
```

`src/shared/page/ui/split.ts` (01; `createSplitDivider` consumed by 02, `Split` by 03 and 04):

```ts
// `AnchorNamer` from `./key-anchors`; `never` options, so the prompt has no scope.
export interface SplitOptions extends SplitLimits { uiState: UiState; stateKey: string; anchor: AnchorNamer<never>; timers: Timers }
export interface Split extends ResizeTarget {
  element: HTMLElement; start: HTMLElement; end: HTMLElement;
  width(): number; reloadWidth(): void; setStartHidden(hidden: boolean): void;
  dispose(): void;
}
// `measure` reads the start pane's left edge in client pixels and the span
// both panes share; `show` draws a width. The divider owns the drag on
// `handle`, the stored width under `stateKey` and `nudge`; a drag writes
// uiState once at its end, a nudge on each press, each only when the width
// changed; nudge does nothing while `handle` has no layout box.
export interface SplitDividerOptions extends SplitLimits {
  uiState: UiState; stateKey: string; handle: HTMLElement;
  measure(): { left: number; span: number };
  show(width: number): void;
  // Places the handle's `⌥⇧H ◂ ▸ ⌥⇧L` prompt; the view's or shell's own anchor function.
  anchor: AnchorNamer<never>;
  // Runs the prompt's linger after a nudge; the page's Timers seam (src/contracts/ambient.ts).
  timers: Timers;
}
export interface SplitDivider extends ResizeTarget { width(): number; reloadWidth(): void; dispose(): void }
export function createSplitDivider(options: SplitDividerOptions): SplitDivider;
export function createSplit(options: SplitOptions): Split;
```

`src/contracts/plugin.ts` (02; consumed by 03 and 04):

```ts
// in PageApi:
panes: { setResizeTarget(target: ResizeTarget | null): void };
```

`src/renderer/key-scope.ts` (02):

```ts
// in ScopeStack: runs after `setBase` moves the base to another scope.
onBaseChange(listener: (base: ViewScope) => void): void;
```

`src/renderer/pane-resize.ts` (02):

```ts
export interface PaneResize {
  setTarget(target: ResizeTarget | null): void;
  dropTarget(): void;
  // Nudges the target, or the side bar when no target is set.
  resize(direction: ResizeDirection): void;
}
export function createPaneResize(sideBar: ResizeTarget): PaneResize;
```

`src/renderer/shell/shell.ts` (02):

```ts
export function mountShell(root: HTMLElement, layout: ShellLayout, uiState: UiState, timers: Timers): Shell; // uiState scoped 'shell'
// in Shell:
sideBarDivider: ResizeTarget; // stateKey 'side-bar-width', min 160, endMin 320
// Anchors the side bar handle's prompt; the renderer calls it beside chrome.setKeys, once the plugins started.
setKeys(keys: BaseKitDeps['keys']): void;
dispose(): void; // disposes the side bar divider and removes its handle
```

Core commands (02), in `coreCommands` (`src/config/keymap.ts`), group `panes`, `runsIn: 'page'`:

| Id | Label | Default bind (scope `any`) |
| --- | --- | --- |
| `panes.resizePaneLeft` | `move the pane divider left` | `<A-S-h>` |
| `panes.resizePaneRight` | `move the pane divider right` | `<A-S-l>` |
| `panes.resizePaneUp` | `move the pane divider up` | none |
| `panes.resizePaneDown` | `move the pane divider down` | none |

`resizePaneUp` / `resizePaneDown` handlers log `log('page', 'no pane divider runs up or down')` and move nothing.

uiState keys (`<prefix>.<stateKey>`): `shell.side-bar-width` (02), `primer.tasks-width`, `primer.items-width` (03,
replacing `primer.primer-rail-width`). The other splits keep their keys.

Primer names (03; used across state, commands, view, kit, layout and tests):

```ts
export type PrimerPane = 'tasks' | 'items' | 'card';
export type PrimerColumn = 'tasks' | 'items';
export type TaskRow = { kind: 'feature' } | { kind: 'task'; entryId: string };
// RailRow is renamed PrimerRow: the row a card shows.
export type PrimerRow = TaskRow | { kind: 'item'; entryId: string; item: number };
// in OpenPrimer, replacing `selected`:
selectedTask: TaskRow;
selectedItem: number | null; // 1-based in the selected task's items; null on the Feature row or a task with none
pane: PrimerPane;
cardColumn: PrimerColumn;    // equals `pane` while a column has focus
export function cardRow(primer: OpenPrimer): PrimerRow;
```

- Scopes (manifest): `tasks: 'In the primer tasks'`, `items: 'In the primer items'`, `card`, `review`, `confirm`,
  `idle`. `rail` goes.
- Commands: `focusTasks` (label `focus the tasks`), `focusItems` (`focus the items`), `focusCard` (kept), group
  `panes`. `focusRail` goes. `nextRow` / `prevRow` stay and step the focused column, or the card's column on the
  card.
- Actions: `selectRow` is replaced by `{ type: 'selectTask'; row: number }` (position in the tasks column's rows)
  and `{ type: 'selectItem'; item: number }` (1-based). `focusPane` takes a `PrimerPane`.
- Layout contract: `TaskRowInput` (`feature` | `task`, no `expanded`), `TaskGroupInput { group; header; rows }`,
  `TasksInput { feature; groups }`, `ItemRowInput { position; entryId; number; text; include; added }`,
  `ItemsInput { task: { entryId: string; name: string } | null; rows: ItemRowInput[]; empty: string | null }`
  (`empty` is the empty state copy, null while rows show), `TasksKit extends PrimerKit { taskRow(parent,
  position); addPrompt(parent) }`, `ItemsKit extends PrimerKit { itemRow(parent, position) }`, parts
  `tasks?(parent, input: TasksInput, kit: TasksKit)` and `items?(parent, input: ItemsInput, kit: ItemsKit)`, each
  returning `PrimerLayoutPane`. `RailRowInput`, `RailGroupInput`, `RailInput`, `RailKit` and `rail` go.
- Primer binds (`src/plugins/keymap.ts`):

| Keys | Scope | Command |
| --- | --- | --- |
| `j`, `<C-l>` / `k`, `<C-h>` | `primer.tasks`, `primer.items` | `primer.nextRow` / `primer.prevRow` |
| `y` / `n` / `u` | `primer.tasks`, `primer.items` | `primer.needYes` / `needNo` / `needUnclear` |
| `A`, `D` | `primer.tasks` | `primer.addExtraTask`, `primer.removeExtraTask` |
| `x` | `primer.items`, `primer.card` | `primer.toggleInclude` |
| `<A-l>` | `primer.tasks` / `primer.items` | `primer.focusItems` / `primer.focusCard` |
| `<A-h>` | `primer.items` / `primer.card` | `primer.focusTasks` / `primer.focusItems` |
| `<Leader><Leader>` | `primer.tasks`, `primer.items` (`where: 'page'`); `primer.card` (`where: 'both'`) | `primer.openReview` |
| card binds today (`<C-l>`, `<C-h>`, `c`, `C`, `a`, `i`, `<C-n>`, `<C-p>`, scroll, `<Esc>` box) | `primer.card` | unchanged |

- Primer resize target: tasks focused → the outer split; items or card focused → the inner split; review, confirm
  and idle → `null`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Split core: nudge, least widths, shared divider](01-split-core.md)

### Wave 2
- [x] [Resize commands, plugin API and side bar](02-resize-commands.md) — after 01

### Wave 3
- [x] [Primer columns](03-primer-columns.md) — after 01, 02
- [x] [Views set the resize target](04-views-resize-target.md) — after 01, 02

### Wave 4
- [x] [Doc re-read](05-doc-re-read.md) — after 01–04
- [ ] [Final verification](06-final-verification.md) — after 01–04

Wave notes: 01 changes `SplitLimits`, so it updates the five callers in the same group to keep the tree compiling.
02 and 03 both edit `src/plugins/keymap.ts`, and 03 consumes `api.panes`, so 03 waits for 02. 03 and 04 touch
disjoint files.

### Drafting parts

Each part reads `plan.md` (about 9k tokens) and the files below. Estimates are bytes ÷ 4, measured at plan time.

| Part | Tasks | Files the drafter reads | Estimate |
| --- | --- | --- | --- |
| A | 01, 02 | `src/shared/page/ui/split.ts`, `split-width.ts`, `split.css`, `split.test.ts`, `split-width.test.ts`; `src/contracts/plugin.ts` (§ PageApi, lines 405–495); `src/renderer/key-scope.ts` + test, `plugins/page-api.ts` + test (grep the fake deps), `renderer.ts` (lines 90–290), `shell/shell.ts`, `shell/shell.css` (side bar rules), `shell/shell.test.ts`; `src/config/keymap.ts`; `src/plugins/keymap.ts` (lines 1–40, 151–175); `src/shared/page/ui/key-anchors.ts` (for the OPEN item); the five callers' split lines only | ~33k + plan ≈ 42k |
| B | 03 | `src/plugins/primer/page/primer-state.ts`, `primer-commands.ts`, `primer-view.ts`, `primer.css`, `layout/primer-kit.ts`, `layout/read-primer-layout.ts`; `src/plugins/primer/manifest.ts`, `ids.ts`, `layouts/layout.d.ts`, `layouts/default/layout.js`, `main/selftest-script.ts`; `src/plugins/keymap.ts` lines 62–75 and 225–277; the primer tests by grep for `rail`, `focusRail`, `selectRow`, `railRow`, `expanded` (not in full); `docs/features/primer/design.md` § The Primer tab and § Keys | ~31k + plan ≈ 40k (tests in full would add ~16k: grep them) |
| C | 04, 05, 06 | `src/plugins/forms/page/round-view.ts`, `forms-view.ts`, `start.ts`; `src/plugins/backlog/page/start.ts` and `backlog-view.ts` (grep `split`, `focus`, `setScope`); `src/plugins/docs/page/start.ts` (grep `setScope`, `split`); `src/plugins/gallery/page/gallery-view.ts` (lines 480–530), `gallery/page/start.ts`; `git show 72cee4c` (the docs written ahead); `docs/features/followups.md` line 56; AGENTS.md § Running and testing (self-test, drive) | ~32k + plan ≈ 41k |

Seams between parts: `ResizeTarget`, `PANE_RESIZE_COMMANDS`, `Split`, `SplitLimits` (A → B, C); `PageApi.panes`
(A → B, C); the primer names above (B only, read by C's doc re-read and final verification).

## Run log

Review base: 5997110

### Groups
- 01 · c174a1a · diff read: every Produces present in panes.ts, split-width.ts, split.ts; typecheck and lint pass; 7 changed test files pass (worker) · concerns: a right nudge on a stored width wider than the window snaps it to span - endMin and writes it; a nudge during a drag is not blocked
- 02 · fe29dbe · diff read: PageApi.panes, ScopeStack.onBaseChange, createPaneResize, Shell.sideBarDivider/setKeys/dispose, mountShell(root, layout, uiState, timers), four coreCommands and two binds present; typecheck passes; worker: lint, 167 tests in 9 files, selftest pass · concerns: the side bar laid over draws its stored width unclamped, so a stored width wider than a narrow window runs past its edge; the forms self-test resize steps nudge the side bar until 04 sets the forms split as target
- 04 · 2694625 · diff read: RoundView.resizeTarget, setResizeTarget deps in forms/backlog, docs and gallery wiring present; worker typecheck and lint pass, 22 tests in 3 files; lead typecheck deferred to after 03 lands (03 mid-edit in tree) · concerns: forms Form tab shown can set null for a moment before the round view exists, then confirm.setBaseScope sets the split; task doc's askCancel row did not hold (askCancel only from review), test dispatches openReview first; forms-view deps comment has an over-long line
- 03 · 1245740 · diff read: PrimerPane, PrimerColumn, TaskRow, PrimerRow, cardRow, selectTask/selectItem, focusTasks/focusItems, tasks/items scopes, TasksKit/ItemsKit/ItemsInput, setResizeTarget wiring, rail width migration present; no rail names left in src/plugins/primer or keymap; lead typecheck and lint pass on the whole tree with 04; worker: full suite 4083 pass, selftest pass · concerns: a step from an add-item box now moves through the tasks column, since showTarget for a newItem target shows the card from the tasks column (test 'steps rows from a box' re-pinned to 'selected task s1')
- 05 · e2bb8df · diff read: 4 doc fixes, follow-up removed after confirming Split.dispose and its gallery call; keymap.md and layouts/design.md needed none · concerns: none
### Contract changes
### Rulings
- dispose mid-drag ends the drag through endDrag, which writes a changed dragged width — the decision names the endDrag path — a dropped split may store an unreleased width (harmless) · group 01
- gallery keeps its last split in a closure-local kept.split inside sectionSpecs, not exposed yet — task 04 reads it for the resize target — task 04 lifts kept into createGalleryView · group 01
- prompt CSS: sheet background, border-default, radius-sm, z-index 1; show selectors written against the parent (:hover/.is-hover/.is-active/.is-nudged > .ui-split-prompt) so 02's side bar handle reuses them — styling only · group 01
- the side bar prompt anchors through a forwarding anchor that re-anchors on each shell.setKeys, anchoring nothing before the first — the shell mounts before the keys plugin starts — no prompt keys before plugins start (none shown then anyway) · group 02
- test names are prose sentences, as 01's and the vitest guide, not the task's Method_Condition_Result names — naming only · group 02
- gallery resizeTarget() returns non-null and throws 'the gallery drew no split sample' when none was drawn — createGalleryView draws before returning, so unreachable — a deferred first draw would throw in Gallery shown instead of falling back to the side bar · group 04
- kept lifted from sectionSpecs into createGalleryView as KeptSplit, passed to sectionSpecs — one copy — rename only · group 04
- forms setBaseScope takes the FormsState, not the view — needs activeForm — none · group 04
- primerColumnBinds(scope) helper beside primerScrollBinds, spread into primer.tasks and primer.items — the two columns share every row bind — inline rows are mechanical if wanted · group 03
- outer end pane styled as .primer-tab .primer-form > .ui-split-end { overflow: hidden }, inner split .primer-inner { height: 100% } — no class pinned by the plan — a nested scroll or height bug shows only in the running app · group 03
- columns scroll into view only when their selection name changes — a redraw that keeps the selection does not scroll — a row selected by a path keeping the name may not scroll · group 03
- focusCard keeps today's handler (no add-item commit, no box leave); focusTasks/focusItems commit and leave as focusRail did — decision 12 names only those two — one line and one test row · group 03
### Review rounds
- 1 · e5cba07 · NEEDS FIXES — 1 important, 5 minor, 1 pre-existing; 8 lead-applied in 320d579; report scratchpad/review-e5cba07.md
### Test gate
- 21 files: every test the run added or edited (16), plus shell-chrome (mountShell signature), keymap and plugin-manifests (new core commands, binds, primer scopes/commands), user-config and config-store (default keymap validation) · 445 passed
