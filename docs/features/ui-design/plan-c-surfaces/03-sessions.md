# 03 — Sessions: session rows and session tabs

Status: not started
Type: Task
Wave: 1 · Depends on: none (plans A and B closed)
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/page/sidebar-view.ts` · modify `src/plugins/sessions/page/session-tabs-view.ts` ·
           modify `src/plugins/sessions/page/sessions-view.ts` · modify `src/plugins/sessions/page/start.ts` ·
           modify `src/plugins/sessions/page/sessions.css`
Consumes:  `row(options: RowOptions): HTMLElement` in `src/shared/page/ui/row.ts` ← plan B ·
           `tabStrip(tabs: readonly HTMLElement[]): HTMLElement`, `tab(label: string, onSelect: () => void): HTMLButtonElement` in `src/shared/page/ui/tabs.ts` ← plan B ·
           `sheet(): HTMLElement` in `src/shared/page/ui/sheet.ts` ← plan B ·
           `statusDot(status: DotStatus): HTMLElement` in `src/shared/page/ui/status-dot.ts` ← plan B ·
           `emptyState(text: string, hint?: HTMLElement | null): HTMLElement` in `src/shared/page/ui/empty-state.ts` ← plan B ·
           `kbd(keys: string, platform: Platform): HTMLElement` in `src/shared/page/ui/kbd.ts` ← plan B ·
           `SessionsView` with `sideBar: HTMLElement` and no `layOut`, the side bar handed to `modes.add` ← plan A task 04 ·
           `PageApi.platform: Platform` ← plan A · `KeysPageExports.keysFor(command: CommandId, scope?: ViewScope): string | null` ← tree ·
           `node scripts/check-styles.mts --no-legacy`: checks every file, ignoring LEGACY_FILES ← plan B task 03 ·
           the self-test's fit check treating the primitives' ellipsis parts (`.ui-row-label`, `.ui-row-detail`,
           `.ui-tab-label`, `.ui-collapsible-summary`) as allowed to clip ← plan B task 02 ·
           `src/shared/page/ui` in every plugin page layer in `scripts/check-layers.mts` ← plan B task 06
Produces:  `SessionsViewDeps.noSelectionHint(): HTMLElement | null` in `src/plugins/sessions/page/sessions-view.ts` ·
           `SessionTabsDeps.noSelectionHint(): HTMLElement | null` in `src/plugins/sessions/page/session-tabs-view.ts` ·
           the session's L2 sheet: `div.session-bodies` is `sheet()`, and each session tab's element fills
           its `div.session-body` — Form, Chat and Docs tabs build no sheet of their own
Decisions: see **Decisions** below
GIVEN a row with harness `claude`, not marked, no status WHEN drawn THEN it reads its label, then `Claude` dimmed, and nothing after
GIVEN a marked row WHEN drawn THEN an `attention` dot ends its first line
GIVEN no session selected while rows exist WHEN the tab area draws THEN it reads `Pick a session in the side bar` and the next-session keys
Tests:     none new: the row and tab choices (`tabs.ts`) are tested today and do not change; the rest is DOM, judged on screen
Done when: compiles; `npm run typecheck`, `npm run lint`, `npm test` and `npm run selftest` pass (the forms, chat and docs
           scripts' session steps and their minimum-width fit checks among them);
           `node scripts/check-styles.mts --no-legacy 2>&1 | grep 'src/plugins/sessions/'` prints nothing;
           this task's live checks are in [12 — Final verification](12-final-verification.md)
Commit:    one commit

## Decisions

- **A session row** is `row({ density: 'list', label: row.label, detail: harnessText(row.harness) || null,
  trailing: row.marked ? statusDot('attention') : null, onClick: () => activate(row.sessionId) })` plus class
  `session-row`; `title` stays `label` or `label · status`; the selected row adds `is-selected` and
  `aria-current="true"` (DESIGN.md § Surfaces: the selected row takes `list-active-background` and `fg`).
- **The round mark is `attention`, not the accent.** `statusDot` has no accent status, and DESIGN.md § Colour
  names an open round "needs you", peach `status-attention` (drafter; the brief said an accent dot).
- **No cursor ring on a session row.** The sessions list has no key scope: its chords move the selection from any
  scope (design.md § Keys), so the keys never rest on a row, and a ring there would claim they do (drafter).
- **The status line stays a second line.** A row with a status (the round's title, chat's activity) appends
  `span.session-row-status` after the primitive's parts; `.session-row` takes `flex-wrap: wrap`, and the status
  takes `flex-basis: 100%`, `font-size: var(--wg-text-12)`, `color: var(--wg-fg-secondary)`, `padding-bottom:
  var(--wg-space-1)`, one line ending in an ellipsis. The row primitive is one line, and moving the status into the
  tooltip alone would hide what each session is doing (drafter). The class name stays, so the chat and docs
  self-test scripts' `.session-row-status` scroller entry still matches.
- **The tab strip** is `tabStrip([])` plus class `session-tabs` and `aria-label="Tabs"`; `draw` replaces its
  children with one `tab(view.title, select)` per tab, each with `title` set to the tab's title, `is-active` on the
  selected one and `aria-current` `"true"` / `"false"` as today. The strip is never hidden: with no tab it holds no
  children, its height collapses, and its top margin (`sheet-gutter`, plan B) is the gutter above the sheet, which
  sits flush under it through plan B's `.ui-tabs + .ui-sheet` rule (drafter: hiding it would drop the sheet's top
  gutter, since `+` still matches a hidden sibling).
- **The sheet.** `bodies` becomes `sheet()` plus class `session-bodies`, holding one `div.session-body` per session
  and the empty-state slot; it is the one L2 sheet under the strip (design.md § Surfaces: session tab content is
  L2, tabs on its top edge). Its children share one grid cell: `.session-bodies { display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr); }`, every child `grid-area: 1 / 1`, `.session-body { min-height:
  0; }`. A tab's own element fills its body.
- **Empty states** use `emptyState` in the slot `div.sessions-empty` (`display: grid; place-content: center;`
  hidden when nothing is to say), rebuilt on every `draw` while shown, so a rebound key shows at the next redraw.
  Copy, restated as one line each (DESIGN.md § Surfaces: one line saying what to do, and the key that does it):

  | When | Today (title · text) | After | Hint |
  |---|---|---|---|
  | `showsEmptyText` | `No sessions` · `An agent session shows here once its relay connects: when it starts while the app runs, or at its first round.` | `No sessions yet: one shows here when its agent's relay connects` | none |
  | `showsNoSelectionText` | `No session selected` · `Pick a session in the sidebar.` | `Pick a session in the side bar` | `deps.noSelectionHint()` |
  | nothing open | `Nothing open` · `This session has nothing open yet. Its first round opens a Form tab here.` | `Nothing open yet: this session's first round opens a Form tab here` | none |

  `Text` becomes `{ text: string; hasHint: boolean }`; `.sessions-empty-title` and its `font-size: 1.3rem` go.
- **The hint** comes from `start.ts`: `noSelectionHint: () => { const shown =
  keys.keysFor(qualify(sessionsManifest.id, 'nextSession')); return shown === null ? null : kbd(shown,
  api.platform); }` — the next-session chord (`<A-S-o>`, drawn ⌥⇧O on macOS), since it selects a session from
  anywhere. `SessionsViewDeps` passes it through to `mountSessionTabsView`.
- **The side bar list** is `nav.session-sidebar` (`aria-label="Sessions"`) holding the rows, `display: flex;
  flex-direction: column; gap: var(--wg-space-0_5)`; plan A left it `min-height: 0`. The list adds no padding
  of its own: task 01 (wave 2) pads the side bar area `var(--wg-space-1)` and puts it on dense chrome
  glass. The 680px rule stays in the core (plan A); `sessions.css` holds no breakpoint.

## `sessions.css` after this task — every rule

| Selector | Declarations |
|---|---|
| `.sessions` | `height: 100%` |
| `.session-sidebar` | `display: flex`, `flex-direction: column`, `gap: var(--wg-space-0_5)`, `min-height: 0` |
| `.session-row` | `flex-wrap: wrap` |
| `.session-row-status` | as **Decisions** says, with `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`, `white-space: nowrap` |
| `.session-area` | `display: grid`, `grid-template-columns: minmax(0, 1fr)`, `grid-template-rows: auto minmax(0, 1fr)`, `height: 100%`, `min-height: 0` |
| `.session-tabs` | `overflow-x: auto`, `scrollbar-width: none` |
| `.session-bodies`, `.session-bodies > *`, `.session-body` | the grid in **Decisions** |
| `.sessions-empty` | `display: grid`, `place-content: center` |

Every `.session-row-*` rule for the label, harness and marker, `.session-tab`, `.session-tab-label`,
`.session-tab.is-active`, `.sessions-empty-title` and any rule plan A left for the old side bar layout go: the
primitives draw them.

## Self-test

No key changes, and no self-test script is edited here. The forms, chat and docs scripts list
`.session-row-label` and `.session-tab-label` as scrollers; after this task no element carries those classes (the
primitives draw `.ui-row-label` and `.ui-tab-label`, which plan B task 02's fit check already lets clip), so those
entries match nothing. The task owning each script drops them later: forms' 05, chat's 07, docs' 08.

## Live checks

Merged into [12 — Final verification](12-final-verification.md) § Sessions mode.

## Proof
