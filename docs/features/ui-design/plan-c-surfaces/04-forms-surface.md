# 04 — Form tab: rail split, cards, layout kit

Status: done
Type: Batch
Wave: 2 · Depends on: 03 (the session's sheet the Form tab fills)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/forms/page/forms-view.ts` · modify `src/plugins/forms/page/round-view.ts` ·
           modify `src/plugins/forms/page/start.ts` · modify `src/plugins/forms/page/forms.css` ·
           modify `src/plugins/forms/page/view-model.ts` · test `src/plugins/forms/page/view-model.test.ts` ·
           modify `src/plugins/forms/page/kinds/card-parts.ts` · modify `src/plugins/forms/page/kinds/item-format.ts` ·
           modify `src/plugins/forms/page/layout/card-kit.ts` · modify `src/plugins/forms/layouts/layout.d.ts` ·
           modify `src/plugins/forms/layouts/default/layout.js`
Consumes:  `export function kbd(keys: string, platform: Platform): HTMLElement;` in `src/shared/page/ui/kbd.ts` ← plan B ·
           `export function textButton(label: string, onClick: () => void, options?: TextButtonOptions): HTMLButtonElement;`,
           `ButtonVariant`, `TextButtonOptions` in `src/shared/page/ui/button.ts` ← plan B ·
           `export function tag(text: string, tone?: TagTone): HTMLElement;`, `TagTone` in `src/shared/page/ui/tag.ts` ← plan B ·
           `export function statusDot(status: DotStatus): HTMLElement;`, `export function setDotStatus(dot: HTMLElement, status: DotStatus): void;`,
           `DotStatus` in `src/shared/page/ui/status-dot.ts` ← plan B ·
           `export function inputFrame(): HTMLElement;` in `src/shared/page/ui/input-frame.ts` ← plan B ·
           `export function row(options: RowOptions): HTMLElement;` in `src/shared/page/ui/row.ts` ← plan B ·
           `export function createSplit(options: SplitOptions): Split;`, `SplitLimits` in `src/shared/page/ui/split.ts` / `split-width.ts` ← plan B ·
           `export function card(edge?: CardEdge | null): HTMLElement;` in `src/shared/page/ui/card.ts` ← plan B ·
           `export function createDialog(title: string): Dialog;` in `src/shared/page/ui/dialog.ts` ← plan B ·
           `export function emptyState(text: string, hint?: HTMLElement | null): HTMLElement;` in `src/shared/page/ui/empty-state.ts` ← plan B ·
           `export function sectionHeader(text: string, trailing?: HTMLElement | null): HTMLElement;` in `src/shared/page/ui/section-header.ts` ← plan B ·
           `PageApi.platform: Platform`, `PageServices.uiState: UiState` in `src/contracts/plugin.ts` ← plan A ·
           `export type Platform` in `src/contracts/platform.ts`, `export interface UiState` in `src/contracts/ui-state.ts` ← plan A ·
           forms' `themeTokens` `origin-caused`, `origin-pre-existing`, `origin-design`, `origin-nit`, `severity-critical`,
           `severity-important`, `severity-minor` (read as `--wg-forms-<key>`) ← plan A task 01 ·
           `KeysPageExports.keysFor(command: CommandId, scope?: ViewScope): string | null` ← tree ·
           the session's L2 sheet: `div.session-bodies` is `sheet()`, and each session tab's element fills
           its `div.session-body` — Form, Chat and Docs tabs build no sheet of their own ← 03 ·
           `node scripts/check-styles.mts --no-legacy`: checks every file, ignoring LEGACY_FILES ← plan B task 03 ·
           the self-test's fit check treating the primitives' ellipsis parts (`.ui-row-label`, `.ui-row-detail`,
           `.ui-tab-label`, `.ui-collapsible-summary`) as allowed to clip ← plan B task 02
Produces:  see **Produces** below
Decisions: see **Decisions** below
GIVEN an untouched item WHEN the review flags it THEN its rail dot shows `warning`; otherwise an untouched item's dot is `idle`
GIVEN an answered item WHEN the rail draws it THEN its dot shows `success`
Tests:     see **Tests** below
Done when: compiles; `npm run typecheck`, `npm run lint` and `npm test` pass, the tests below among them;
           `node scripts/check-styles.mts --no-legacy 2>&1 | grep 'src/plugins/forms/'` prints nothing;
           `npm run selftest` passes; `grep -rn "appendKeys\|'button button\|badge-recommend\|badge-notice\|dialog.css" src/plugins/forms`
           prints nothing; `grep -rn "numberedCommand('jumpTo'" src/plugins/forms/page` prints nothing
           (the rail's jump hint; 05 removes the commands, and `jumpToReviewRow` in `form-state.ts` stays); this task's live checks are in
           [12 — Final verification](12-final-verification.md)
Commit:    one commit for the group

All plan B and plan A names above exist when this task runs (after plan B); check each signature in the tree
before building on it, since the code is the final word.

## Produces

```ts
// src/plugins/forms/layouts/layout.d.ts — the kit hands the primitives to user layouts.
// Each union repeats plan B's (`tag.ts`, `button.ts`) word for word, so card-kit.ts passing a kit value
// to the primitive type-checks; the file stays self-contained, as it is copied into the user's folder.
export type TagTone = 'neutral' | 'accent' | 'running' | 'success' | 'warning' | 'attention' | 'error';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface KitButtonOptions { variant?: ButtonVariant; keys?: string | null }
// HeadKit gains (every part appends itself to `parent` and returns what it appended):
//   card(parent: HTMLElement, className?: string): HTMLElement;
//   tag(parent: HTMLElement, text: string, tone?: TagTone): HTMLElement;
//   kbd(parent: HTMLElement, keys: string): HTMLElement;
//   button(parent: HTMLElement, label: string, onClick: () => void, options?: KitButtonOptions): HTMLButtonElement;
//   sectionHeader(parent: HTMLElement, text: string): HTMLElement;

// src/plugins/forms/page/view-model.ts
export function railDotStatus(status: AnswerStatus | 'notice', isFlagged: boolean): DotStatus;

// src/plugins/forms/page/kinds/card-parts.ts — null keys draw nothing, as appendKeys did
export function keyHint(keys: string | null, platform: Platform): HTMLElement | null;

// Members gained (no new exports):
//   FormsViewDeps (forms-view.ts) gains  platform: Platform; uiState: UiState
//   RoundViewDeps (round-view.ts) gains  platform: Platform; uiState: UiState
//   CardDeps (kinds/item-format.ts) gains platform: Platform
//   RailEntry (round-view.ts) becomes { element: HTMLElement; dot: HTMLElement } — the rail draws no key hint
//   createHeadKit (layout/card-kit.ts) takes Pick<CardDeps, 'markdown' | 'keysFor' | 'platform'>
```

The kit's comments in `layout.d.ts`, one line each above the member:

| Member | Comment |
|---|---|
| `card` | `` `div.ui-card` with `className` added: the card every built-in card draws on. `` |
| `tag` | `` `span.ui-tag`; tone `neutral` when left out. `` |
| `kbd` | `` A key hint for `keys` as `keys(command)` returns it, drawn for the platform. `` |
| `button` | `` `button.ui-button`, variant `secondary` when left out; never takes focus. `keys` draws its hint after the label. `` |
| `sectionHeader` | `` `h3.ui-section-header`: a sentence-case label over a part of the card. `` |

## Decisions

Structure:

- **The Form tab builds no sheet** (lead ruling, plan.md): its element is a plain `div.form-tab` (`height: 100%`)
  that fills task 03's `div.session-body` on the session's one L2 sheet, under the tab strip. The tab holds the
  round views and the idle state as today.
- **The idle state** is `emptyState('No round open. The agent's next round opens here.')` with no hint (DESIGN.md
  § Surfaces: one line; there is no key to offer). It replaces the `section.form-idle` with its `h1` and `p`.
- **The rail is the start pane of a split** (design.md § Surfaces). `createRoundView` creates the split once,
  `createSplit({ initial: 240, min: 160, max: 400, uiState: deps.uiState, stateKey: 'rail-width' })` (drafter:
  today's rail spans 176–256px; 240 opens near today's width, 400 keeps the main column readable), and its
  `element` takes the class `round` and is the view's root. The rail (`nav.rail` with `ol.rail-list`) builds into
  `split.start`; the round's main column builds into `split.end`, which takes the class `round-main` and is the
  `main` that `update` scrolls to the top. `setLayout` empties `split.start` and `split.end` (not the root), so a
  layout swap keeps the dragged width. The key is plugin-scoped by the page API (plan A task 05).
- **No rail background of its own** (drafter): the rail sits on the sheet colour; the split's handle line divides
  it from the cards (DESIGN.md § Space: gutters and hairlines separate, quieter than a second fill).
- **Breakpoints:** below `640px` the split stacks the rail above the cards (plan B's `split.css` does it; forms.css
  drops its own `@media (max-width: 640px)` block); below `800px` `.round-main` padding tightens (DESIGN.md
  § Breakpoints).
- **Rail entries are rows:** `row({ density: 'list', tag: 'li', label: title, leading, onClick })`, the class
  `rail-entry` added, `title` set to the item title (the tooltip for the ellipsis). `leading` is a `span.rail-lead`
  holding `statusDot(...)` and `span.rail-number` (the item label, `font-mono`, `fg-tertiary`). The focused item's
  row takes `is-selected`; a rail click that would do nothing (`railPickAction` returns null) adds `is-disabled`
  in place of `pick.disabled`. `data-status` stays on the row. `RailEntry` becomes `{ element: HTMLElement; dot:
  HTMLElement }`: **the rail draws no key hint** — jump to question goes in task 05, so the
  `numberedCommand('jumpTo', …)` call and the `keys` member go now. `updateRailEntry` sets the dot with
  `setDotStatus(entry.dot, railDotStatus(status, isFlagged))`, where `isFlagged` is today's `isReview && status ===
  'untouched'`; a flagged row's label is `status-warning`; a not-applicable row's label is `fg-tertiary`.
- **Rail dot statuses** (drafter, DESIGN.md § Colour: status colours only where status exists): answered →
  `success`; untouched → `idle`, or `warning` while flagged; not applicable → `idle`; notice → `idle`. Today's blue
  notice dot and grey not-applicable fill go: neither is a status, and the `N` prefix and the dimmed label tell them
  apart.
- **Review rows stay their own two-line layout** (drafter, against plan B's inventory): a row's answer holds
  markdown, a tag and wrapped detail lines, and the self-test's long unbroken word must wrap there, which a
  one-line `row()` cannot do. `li.review-row` and `button.review-pick` stay, restyled on tokens: hover
  `list-hover-background`; the cursor row takes `is-cursor` and `list-active-background` with `box-shadow: inset 0
  0 0 1px var(--wg-focus-border)` (the one focus ring); an untouched row's answer text is `status-warning`;
  `.review-question` and `.review-answer` take `overflow-wrap: anywhere`. The left status border goes (the answer
  text carries the status).
- **Cards:** the default layout builds each card with `kit.card(parent, 'item <kind>')` in place of
  `kit.el(parent, 'article', …)`, so every card is a `div.ui-card.item.<kind>`. Cards are not collapsible
  (AGENTS.md: every card shows all its choices).
- **Item head:** `buildItemHead` draws the kind as `tag(kind)` (neutral) in place of the uppercase pill, then
  `span.item-status` (`text-12`; `status-success` when answered, `fg-secondary` when not applicable).
- **Sections and labels** use `sectionHeader`: `buildSection`'s label (`Question`, `Context`, …), the answer area's
  `Your answer`, the action row's `Action`. Each keeps its wrapper class (`context`, `answer`, `finding-actions`).
- **Field captions:** `buildField` draws `sectionHeader(label, span.field-hint)` (the hint `text-12`,
  `fg-tertiary`, weight regular) and frames the box with `inputFrame()`, the class `box` added, as the editor's
  parent. The frame owns background, border, radius and the focus ring; forms.css keeps only the editor's height
  rules (`.box .cm-editor` `max-height: calc(var(--wg-space-8) * 8)`, `.box .cm-content` `min-height:
  var(--wg-row-list)`, `.box .cm-scroller` `overflow: auto`).
- **The recommended choice carries the accent** (design.md § Surfaces; Enter accepts it): its `choice-number` takes
  `accent` for border and text, and its `Recommended` mark is `tag('Recommended', 'accent')`. The selected choice
  takes `list-active-background`, its number filled `accent` with `fg-on-accent`. Choice rows stay `button.choice-
  pick` (multi-line markdown with a reason under each): hover `list-hover-background`, `radius-md`.
- **Buttons are `textButton`:**

  | Control | Variant | Hint (`keyHint` of `keysFor`, scope) | State |
  |---|---|---|---|
  | Accept (verdict) | `primary` | `acceptRecommendation`, `forms` | — |
  | Action picks (Fix now, …) | `secondary` | the action's command, `forms` | `is-selected` and `aria-pressed` when picked |
  | Not applicable, Don't ask me this | `ghost` | `toggleNotApplicable` / `toggleDontAsk`, `forms` | `is-selected` and `aria-pressed` when on |
  | Send answers (review) | `primary` | `submit`, `review` | — |
  | Cancel round (review) | `secondary` | `askCancel`, `review` | — |
  | Keep answering (confirm) | `secondary` | `dismissConfirm`, `confirm` | — |
  | Cancel round (confirm) | `danger` | `confirmCancel`, `confirm` | — |

  The recommended action pick also holds `tag('Recommended', 'accent')`, inserted before the hint. A locked list
  (`is-locked`, not applicable) keeps today's `opacity: 0.55` and `pointer-events: none`.
- **Origin and severity tags:** `tag(input.originChip)` with the class `badge-origin` and `data-origin`, and
  `tag(input.severityChip)` with `badge-severity` and `data-severity` (class names kept, as AGENTS.md § A finding
  origin names `.badge-origin`). Each rule sets `color` and `border-color` to its `--wg-forms-origin-<origin>` /
  `--wg-forms-severity-<severity>` token on a transparent background (drafter: DESIGN.md § Colour puts full-strength
  status colour only on small marks and text; the plugin tokens are full strength and have no tints). The
  `origin-pre-existing` rule reads `data-origin='pre_existing'`.
- **Notice badge tones** (drafter, DESIGN.md § Colour: one accent, other colours mean a status): `Applied` →
  `success`, `Dispatched` → `running`, `Decided` → `neutral`. The default layout's notice card draws them with
  `kit.tag`, holding the map as a `/** @type {Record<string, import('../layout').TagTone>} */` constant; an unknown
  badge takes `neutral`. The notice card's own kind label, `kit.el(head, 'span', 'item-kind', 'Notice')` in
  `layout.js`, becomes `kit.tag(head, 'Notice')` (neutral, like `buildItemHead`'s `tag(kind)`; plan B's
  `tag(text: string, tone?: TagTone): HTMLElement`), because the `.item-kind` rule is deleted below.
- **Key hints are Kbd:** every `appendKeys(control, keys)` in forms becomes `control.append(hint)` of
  `keyHint(keys, platform)`, or the `hint` option of `textButton`. `platform` reaches the views as
  `FormsViewDeps.platform` / `RoundViewDeps.platform` / `CardDeps.platform`, from `api.platform` in `start.ts`.
  The kit's `kbd` part and `button`'s `keys` option draw through the same `keyHint`.
- **The confirm prompt is `createDialog('Cancel this round?')`:** its body holds a `p` with `The agent is told the
  round was cancelled. Your answers stay saved.`, its actions Keep answering then Cancel round (the safe action
  first). `areas.overlay.contribute(dialog.element)`; `render` calls `dialog.show()` while `view === 'confirm'`
  and `dialog.hide()` otherwise, in place of toggling `confirm.hidden`. The dialog's role is plan B's `dialog`.
- **The status line** stays forms' status bar contribution (`footer.status-line` with `status-mode` and
  `status-save`), on L1: its own background, top border and mono font go (the bar is the chrome, task 01);
  `text-12`; the mode label `fg`, `weight-medium`, with no accent fill (the accent is not a status, DESIGN.md
  § Colour); the save label `fg-tertiary`, `status-warning` while unsaved. Its fill-and-wrap layout stays.
- **`start.ts`** drops `import '../../../shared/page/dialog.css'` (forms draws no legacy dialog, button or key hint
  now; task 10 deletes that file) and passes `platform: api.platform` and `uiState: api.services.uiState` to
  `mountFormsView`.
- **Every forms stylesheet reads tokens only** (DESIGN.md § Tokens and themes): each raw `rem`, `em` and `px` length
  in `forms.css` becomes the `space-*`, `text-*`, `radius-*`, `row-*` or `icon-button-sm` token of its role;
  `text-transform: uppercase` and `letter-spacing` go (sentence case); `.round-main > *` takes `max-width:
  var(--wg-prose-measure)` (drafter: the prose width DESIGN.md § Type names; today `60rem`); inline code in a
  choice or the overview reads `block-background`, `radius-sm`, `font-mono`. Rules for removed classes go
  (`.rail-item`, `.rail-dot`, `.key-hint`, `.toggle`, `.verdict-button`, `.action-pick`, `.badge`,
  `.badge-recommend`, `.badge-notice`, `.item-kind`, `.form-idle*`, `.overlay`/`.dialog*`).
- **Card prose stays 14px** (lead ruling): task 09 sets `.md` to `text-14` and `leading-prose` everywhere
  (DESIGN.md § Type: prose is 14px); forms adds no override, so card context and reason text grows from 13px.
- **No self-test script changes here** and no `LEGACY_FILES` edit: forms' `main/selftest-script.ts` is 05's (it
  drops the stale `.rail-title` entry), and only task 10 edits `LEGACY_FILES` (plan.md).

Copy (sentence case, plain verbs; DESIGN.md § Icons and copy), verbatim:

| Where | Today | After |
|---|---|---|
| Idle Form tab | `No round open` / `This session has no round for you now. Its agent's next round opens here.` | `No round open. The agent's next round opens here.` |
| Review submit button | `Submit` | `Send answers` (the toast already says `Answers sent: …`) |
| Confirm, danger button | `Cancel the round` | `Cancel round` |
| Notes hint | `your own answer or your reasoning - optional, sent to the agent` | `Optional. Your own answer or your reasoning, sent to the agent.` |
| Don't ask reason hint | `sent to the agent with your answer - optional` | `Optional. Sent to the agent with your answer.` |
| Comment hint | `optional - say if this needs a second look` | `Optional. Say if this needs a second look.` |
| Round note hint | `anything about the round as a whole - optional` | `Optional. Anything about the round as a whole.` |
| Review row, missing half | `needs a solution` / `needs an action` | `Needs a solution` / `Needs an action` |

Every other string stays: `Cancel this round?`, the confirm body, `Keep answering`, `Cancel round` (review),
`Review`, `Round note`, `Your answer`, `Action`, `Accept`, `Recommended`, `Not applicable`, `Don't ask me this`, the
status labels and the review summary.

## Tests

`src/plugins/forms/page/view-model.test.ts`, a `describe('railDotStatus')` block:

- `shows an answered item as success` — `railDotStatus('answered', false)` → `'success'`
- `flags an untouched item only while the review flags it` — `railDotStatus('untouched', true)` → `'warning'`;
  `railDotStatus('untouched', false)` → `'idle'`

The DOM work (split, rows, cards, tags, buttons, dialog, frames) decides nothing a test sees without a DOM (the test
environment is `node`); it is judged live in 12. `layout-actions.test.ts`, `card-answer.test.ts` and
`read-layout.test.ts` stand unchanged: the kit's actions, answers and the layout validator do not change.

## Live checks

Merged into [12 — Final verification](12-final-verification.md) § Form tab and forms keys.

## Proof

Commit `9045497`. Diff read against Decisions, the button and copy tables and Produces; typecheck, lint, tests (the `railDotStatus` block among them) and the self-test's forms script pass. Concerns: plan B's `is-disabled` row style greys rail rows under the confirm dialog (judge live); DESIGN.md's rail `block-background` line and AGENTS.md's kit-part list are stale (task 11); `.rail-title` in the forms self-test script (task 05).
