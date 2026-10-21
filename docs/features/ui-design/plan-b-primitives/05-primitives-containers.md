# 05 — Primitives: rows, tabs, sheets, splits and floating panels

Status: not started
Type: Batch
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Files:     create `src/shared/page/ui/row.ts`, `row.css` · create `src/shared/page/ui/tabs.ts`, `tabs.css` ·
           create `src/shared/page/ui/sheet.ts`, `sheet.css` · create `src/shared/page/ui/split-width.ts` ·
           test `src/shared/page/ui/split-width.test.ts` · create `src/shared/page/ui/split.ts`, `split.css` ·
           create `src/shared/page/ui/card.ts`, `card.css` · create `src/shared/page/ui/floating-panel.ts`,
           `floating-panel.css` · create `src/shared/page/ui/dialog.ts`, `dialog.css` ·
           create `src/shared/page/ui/empty-state.ts`, `empty-state.css` ·
           create `src/shared/page/ui/section-header.ts`, `section-header.css`
Consumes:  `export interface UiState { get(key: string): unknown; set(key: string, value: unknown): void; }`
           in `src/contracts/ui-state.ts` ← plan A task 05 ·
           `export function icon(name: string): HTMLElement;` in `src/shared/page/ui/icon.ts` ← plan A task 04 ·
           `element` in `src/shared/page/dom.ts` ← tree ·
           `.material-floating` in `src/shared/page/ui/materials.css` ← 01 ·
           the core tokens (`reference/tokens.css` names, `--wg-` prefixed) ← plan A ·
           the `src/shared/page/ui` entry in `scripts/check-layers.mts` allowing `src/contracts`, `src/shared` and `src/shared/page` ← plan A task 04
Produces:  see **Produces** below — every signature lands in the file named beside it
Decisions: the naming, class and state convention in [04](04-primitives-controls.md) § Decisions
           (`ui-<name>`, `is-selected` / `is-active` / `is-cursor` / `is-disabled`, `is-hover` /
           `is-pressed` mirrors for the gallery, buttons never take focus, CSS reads tokens only)
           holds here word for word; the per-primitive decisions are below
Tests:     see **Tests** below
Done when: every file above exists with the signatures below; each builder file imports its own CSS;
           `npm run typecheck`, `npm run lint` (check-styles included once 03 lands) and `npm test`
           pass; the visual checks are in 08's live list (rows, tabs, sheet, Split drag and
           persistence, cards, floating panel, dialog)
Commit:    one commit for the group

## Inventory — primitive → the surfaces that will use it

Measured at plan time; re-verify before plan C maps them.

| Primitive | Replaces today | Surfaces (plan C) |
|---|---|---|
| Row | `.session-row` (`sidebar-view.ts`), `.docs-row` with its `rem` depth (`tree-view.ts`), `.list-picker-item` (`list-picker.ts`), `.rail-item` and `.review-row` (`round-view.ts`), `.docs-completion-item`, `.which-key-entry` | sessions list, docs tree (side bar and Docs tab), every list picker (chat, docs), forms rail and review, docs path completions, which-key, help |
| Tabs | `.session-tabs` / `.session-tab` with `is-active` (`session-tabs-view.ts`) | a session's tab strip (Form, Chat, Docs) |
| Sheet | `.session-body`, `.docs-doc`, `.form-tab`, `.chat-tab` backgrounds | each session tab's content, Docs mode's doc, the gallery |
| Split | `.round` (rail + main, `forms.css`), `.docs-view` with `is-tree-hidden` (`docs.css`) | the Form tab's rail, a session's Docs tab (tree + doc) |
| Card | `.item` cards in the forms default layout, `.chat-user`, `.chat-permission` | forms cards, chat user turns, permission prompts (`attention` edge) |
| Collapsible card | `buildExpander` (`chat-kit.ts`: `.chat-expander`, ▸ / ▾) | chat tool calls, thinking, raw events |
| FloatingPanel | `.which-key`, `.toast` (`toasts.ts`, `shell.css`), `.docs-completion` | which-key, toasts, docs completions, menus, the composer (plan C) |
| Dialog | `.overlay` + `.dialog` (`dialog.css`): help, list pickers, forms / chat / docs confirms, chat reason, docs box dialog | the same, over `scrim` |
| EmptyState | `.sessions-empty`, `.form-idle`, `.docs-status` while empty | Sessions with no session, an idle Form tab, an empty docs tree |
| SectionHeader | `.which-key-title`, `.keys-help-title`, `.review-title`, `.chat-section-label`, `.context-label`, `.field-label`, `.answer-label` | which-key, help, forms review and card sections, chat tool sections |

All nine expected containers are used; none is cut. Card's collapsible variant is built because
chat uses it; forms cards are not collapsible (AGENTS.md: every card shows all its choices).

## Produces

```ts
// src/shared/page/ui/row.ts
export type RowDensity = 'list' | 'tree';
export interface RowOptions {
  density: RowDensity;
  label: string;
  detail?: string | null;
  leading?: HTMLElement | null;
  trailing?: HTMLElement | null;
  depth?: number;
  tag?: 'div' | 'li';
  onClick?: () => void;
}
export function row(options: RowOptions): HTMLElement;

// src/shared/page/ui/tabs.ts
export function tabStrip(tabs: readonly HTMLElement[]): HTMLElement;
export function tab(label: string, onSelect: () => void): HTMLButtonElement;

// src/shared/page/ui/sheet.ts
export function sheet(): HTMLElement;

// src/shared/page/ui/split-width.ts
export interface SplitLimits { initial: number; min: number; max: number }
export function clampSplitWidth(width: number, limits: SplitLimits): number;
export function storedSplitWidth(state: UiState, key: string, limits: SplitLimits): number;

// src/shared/page/ui/split.ts
export interface SplitOptions extends SplitLimits { uiState: UiState; stateKey: string }
export interface Split {
  element: HTMLElement;
  start: HTMLElement;
  end: HTMLElement;
  width(): number;
  setStartHidden(hidden: boolean): void;
}
export function createSplit(options: SplitOptions): Split;

// src/shared/page/ui/card.ts
export type CardEdge = 'attention' | 'error';
export function card(edge?: CardEdge | null): HTMLElement;
export interface CollapsibleCardOptions {
  summary: string;
  mono?: boolean;
  leading?: HTMLElement | null;
  open?: boolean;
  body(): HTMLElement;
}
export interface CollapsibleCard {
  element: HTMLElement;
  isOpen(): boolean;
  setOpen(open: boolean): void;
}
export function createCollapsibleCard(options: CollapsibleCardOptions): CollapsibleCard;

// src/shared/page/ui/floating-panel.ts
export function floatingPanel(): HTMLElement;

// src/shared/page/ui/dialog.ts
export interface Dialog {
  element: HTMLElement;
  body: HTMLElement;
  actions: HTMLElement;
  setTitle(title: string): void;
  show(): void;
  hide(): void;
  isShown(): boolean;
}
export function createDialog(title: string): Dialog;

// src/shared/page/ui/empty-state.ts
export function emptyState(text: string, hint?: HTMLElement | null): HTMLElement;

// src/shared/page/ui/section-header.ts
export function sectionHeader(text: string, trailing?: HTMLElement | null): HTMLElement;
```

## Decisions

- **No primitive here imports one from 04** (drafter): a slot (`leading`, `trailing`, `hint`)
  takes the caller's element — a `statusDot`, a `kbd`, a `tag` — so 04 and 05 land in parallel and
  a row never learns the platform.
- **Row** (`<div>` or `<li>` per `tag`, default `div`; `ui-row ui-row--<density>`): `leading`, then
  `span.ui-row-label` (`label`), then `span.ui-row-detail` when `detail` is not null or empty, then
  `trailing` wrapped in `span.ui-row-trailing`. Flex, `align-items: center`, `gap:
  var(--wg-space-2)`, `min-height: var(--wg-row-list)` (`--wg-row-tree` for tree), `padding: 0
  var(--wg-space-2)`, `border-radius: var(--wg-radius-sm)`, `color: var(--wg-fg)`. Label and detail
  end in an ellipsis (`min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space:
  nowrap`); detail is `text-12` in `fg-tertiary`; trailing sits right (`margin-left: auto`) in
  `fg-tertiary`. States: hover `list-hover-background`; `is-selected` `list-active-background` with
  `list-active-foreground`; `is-cursor` `box-shadow: inset 0 0 0 1px var(--wg-focus-border)`;
  `is-disabled` `fg-disabled` with no hover. `onClick` adds `ui-row--action` (`cursor: pointer`),
  prevents the default on `mousedown` and runs `onClick` on `click` unless the row holds
  `is-disabled`.
- **Tree depth** (drafter): `depth` (default 0) is written as the unitless custom property
  `--ui-row-depth` on the row's inline style, and `row.css` indents with `padding-left:
  calc(var(--wg-space-2) + var(--ui-row-depth, 0) * var(--wg-space-3))`, so no raw length reaches an
  inline style. The same pattern carries Split's width.
- **Tabs**: `tabStrip` returns `nav.ui-tabs` holding `tabs` (the caller appends more later);
  `tab` returns `button.ui-tab` holding `span.ui-tab-label` (ellipsis) and runs `onSelect` on click.
  Strip: flex, `align-items: flex-end`, `margin: var(--wg-sheet-gutter) var(--wg-sheet-gutter) 0`,
  transparent (it sits on L1). Tab: `height: var(--wg-tab-height)`, `padding: 0 var(--wg-space-3)`,
  `border-radius: var(--wg-radius-md) var(--wg-radius-md) 0 0`, `font-size: var(--wg-text-13)`,
  rest `tab-inactive-background` / `tab-inactive-foreground`, hover `fg`; `is-active`
  `tab-active-background` / `tab-active-foreground` with `font-weight: var(--wg-weight-medium)` and
  `box-shadow: inset 0 var(--wg-indicator-width) 0 var(--wg-tab-active-indicator)` (the 2px accent
  top mark, DESIGN.md § Surfaces).
- **Sheet** (`div.ui-sheet`): `background: var(--wg-sheet-background)`, `border-radius:
  var(--wg-radius-lg)`, `margin: var(--wg-sheet-gutter)`, `min-width: 0`, `min-height: 0`,
  `overflow: auto`, no padding (each surface pads its own content); `.ui-tabs + .ui-sheet {
  margin-top: 0 }` so the strip sits on the sheet's top edge. No shadow (DESIGN.md § Space).
- **Split widths** (drafter): the start pane's width in CSS pixels, an integer. `clampSplitWidth`
  rounds to the nearest integer and clamps to `[min, max]`; a non-finite width takes `initial`,
  clamped. `storedSplitWidth` reads `state.get(key)`: a finite number is clamped, anything else
  (missing, a string, null) gives `initial` clamped. `createSplit` throws
  `Split <stateKey>: min <min> is above max <max>` when `min > max`, since the limits are kept and
  read on every drag.
- **Split DOM**: `div.ui-split` holding `div.ui-split-start`, `div.ui-split-handle`,
  `div.ui-split-end`. The width is written as the unitless `--ui-split-start` on the root's inline
  style and read by `grid-template-columns: calc(var(--ui-split-start) * 1px) var(--wg-space-1)
  1fr`. Panes: `min-width: 0`, `min-height: 0`, `overflow: auto`. Handle: `cursor: col-resize`, a
  centred 1px line (`::after`, `left: 50%`, `width: 1px`) in `border-default`; hover and
  `is-active` (while dragging) turn it `focus-border`.
- **Split drag**: `pointerdown` with the primary button on the handle captures the pointer
  (`setPointerCapture`), adds `is-active` and prevents the default; each `pointermove` while
  captured sets the width to `clampSplitWidth(event.clientX − root's left edge)`; `pointerup` or
  `pointercancel` releases, removes `is-active`, and calls `uiState.set(stateKey, width)` when the
  width changed since `pointerdown`. One write per drag, never one per move. `width()` returns the
  width in force.
- **Split below 640px** (`@media (max-width: 640px)`, DESIGN.md § Breakpoints): one column, rows
  `auto 1fr`; the handle hides; the start pane takes `max-height: 40%` and a `border-bottom: 1px
  solid var(--wg-border-default)`. The stored width is untouched. `setStartHidden(true)` adds
  `is-start-hidden`, which hides the start pane and handle and gives the end pane the whole width.
- **Card** (`div.ui-card`, with `ui-card--<edge>` when `edge` is given): `background:
  var(--wg-card-background)`, `border: 1px solid var(--wg-card-border)`, `border-radius:
  var(--wg-radius-md)`, `padding: var(--wg-space-3)`; the edge is `box-shadow: inset
  var(--wg-indicator-width) 0 0 var(--wg-status-<edge>)`. `is-cursor` sets the border to
  `focus-border`. No shadow, no glass (content is solid).
- **Collapsible card**: a card (`ui-card ui-collapsible`, padding 0, `is-open` while open) whose
  head is a `button.ui-collapsible-head` (never takes focus) holding `icon('chevron-right')` or
  `icon('chevron-down')` when open, `leading`, and `span.ui-collapsible-summary` (ellipsis; in
  `--wg-font-mono` at `text-12` when `mono`, else the UI font at `text-13`). Head: `min-height:
  var(--wg-row-list)`, `padding: 0 var(--wg-space-3)`, `color: var(--wg-fg-secondary)`, hover
  `button-ghost-hover` / `fg`. A click toggles. `setOpen(true)` runs `body()` and appends its element
  in `div.ui-collapsible-body` (`padding: 0 var(--wg-space-3) var(--wg-space-3)`), replacing the
  last; `setOpen(false)` removes it; `setOpen` with the state in force does nothing — the same
  contract as chat's `buildExpander`, so plan C swaps it in place. `open` (default false) opens it
  at build.
- **FloatingPanel** (`div.ui-floating.material-floating`): `border-radius: var(--wg-radius-lg)`,
  `padding: var(--wg-space-1)`, `color: var(--wg-fg)`, `z-index: var(--wg-z-floating)`; the caller
  places it and shows it by `hidden`. Opening fades in: `transition: opacity var(--wg-duration-base)
  var(--wg-ease-out)` with `@starting-style { opacity: 0 }`; closing is instant (DESIGN.md
  § Motion: small things opening take `duration-base`; content does not animate).
- **Dialog**: `element` is `div.ui-scrim` (`position: fixed`, `inset: 0`, grid centred, `padding:
  var(--wg-space-6)`, `background: var(--wg-scrim)`, `z-index: var(--wg-z-dialog)`), hidden at
  build; it holds a floating panel with `ui-dialog` (`border-radius: var(--wg-radius-xl)`,
  `padding: var(--wg-space-4)`, `width: min(100%, var(--wg-prose-measure))`, `max-height: 100%`,
  `overflow: auto`, a flex column with `gap: var(--wg-space-3)`, `role="dialog"`,
  `aria-modal="true"`, `aria-label` the title) holding `h2.ui-dialog-title` (`text-14`,
  `weight-semibold`, `fg`), `div.ui-dialog-body` (`body`) and `div.ui-dialog-actions` (`actions`:
  flex, `justify-content: flex-end`, `gap: var(--wg-space-2)`). `setTitle` sets the heading and
  `aria-label`; `show` / `hide` set `hidden`; `isShown` is `!hidden`. A click on the scrim does
  nothing (keys close a dialog, as today). The caller contributes `element` to the `overlay` area
  and owns its key scope.
- **EmptyState** (`p.ui-empty`): `text`, then `hint` when given; flex, `flex-wrap: wrap`,
  `justify-content: center`, `align-items: baseline`, `gap: var(--wg-space-2)`, `padding:
  var(--wg-space-6)`, `color: var(--wg-fg-secondary)`, `font-size: var(--wg-text-13)`. One line, no
  illustration (DESIGN.md § Surfaces).
- **SectionHeader** (`h3.ui-section-header`): `span.ui-section-header-text`, then `trailing` when
  given; flex, `justify-content: space-between`, `align-items: center`, `min-height:
  var(--wg-row-tree)`, `margin: 0`, `font-size: var(--wg-text-12)`, `font-weight:
  var(--wg-weight-semibold)`, `color: var(--wg-fg-secondary)`. Sentence case comes from the caller's
  text; no `text-transform` (DESIGN.md § Type).

GIVEN a width outside the limits WHEN clamped THEN it lands on the nearer limit, rounded.
GIVEN a stored value that is not a finite number WHEN the split opens THEN it takes `initial`,
clamped.

## Tests

`src/shared/page/ui/split-width.test.ts`, limits `{ initial: 240, min: 160, max: 400 }` built in the
test; `storedSplitWidth` reads a fake `UiState` over a `Map` the test fills:

- `clamps a width below min to min` — `clampSplitWidth(100, limits)` → `160`
- `clamps a width above max to max` — `clampSplitWidth(500, limits)` → `400`
- `rounds a width inside the limits` — `clampSplitWidth(250.6, limits)` → `251`
- `takes initial for a width that is not finite` — `clampSplitWidth(NaN, limits)` → `240`;
  `clampSplitWidth(Infinity, limits)` → `240`
- `clamps an initial outside the limits` — `clampSplitWidth(NaN, { initial: 900, min: 160, max:
  400 })` → `400`
- `reads a stored width` — map `{ 'docs-tree': 300 }`, key `'docs-tree'` → `300`
- `clamps a stored width` — map `{ 'docs-tree': 999 }` → `400`
- `takes initial when nothing is stored` — empty map → `240`
- `takes initial for a stored value that is not a number` — map `{ 'docs-tree': '300' }` → `240`

The drag, the write on release and the stacking are judged live (08: Split drag, persistence
across a restart, stacking below 640px). Row, Tabs, Sheet, Card, FloatingPanel, Dialog, EmptyState
and SectionHeader decide nothing a test can see without a DOM: the test environment is `node`.

## Proof

