# 10 — Sessions layout and preview

Status: done
Type: Task
Wave: 3 · Depends on: 02, 05 (`src/plugins/keymap.ts`)
Plan: [plan.md](plan.md)

Sessions mode's side bar rows, the side bar pane, and the session tab bar draw through a sessions layout.
`Space z l s` shows a sample of session rows in every state, with no agent.

Files:
- create `src/plugins/sessions/layouts/layout.d.ts` — the sessions Layout contract
- create `src/plugins/sessions/layouts/default/layout.js` — the built-in `default` layout, `// @ts-check`
- create `src/plugins/sessions/page/layout/read-sessions-layout.ts` · test `read-sessions-layout.test.ts`
- create `src/plugins/sessions/page/layout/sessions-parts.ts` — the kits and the part drawing over the host ·
  test `sessions-parts.test.ts`
- create `src/plugins/sessions/page/preview.ts` — the sample rows and statuses · test `preview.test.ts`
- modify `src/plugins/sessions/page/sidebar-view.ts`, `session-tabs-view.ts`, `sessions-view.ts`, `start.ts`
- modify `src/plugins/sessions/main/start.ts`, `src/plugins/sessions/manifest.ts`
- modify `src/plugins/keymap.ts` (one bind)
- modify `docs/keymap.md` — the `zl` row gains `zls`

Consumes (← 02, names as `02-layout-core.md` § Produces writes them):
- main `api.layouts.register(options: { layoutTypes: string }): Disposable`
- page `api.layouts.show<L>(options: ShowLayoutOptions<L>): LayoutShow`, `ShownLayouts<L>`, `LayoutShow`
- `readLayoutModule(module: unknown, name: string): Record<string, unknown>` and `isRecord` from
  `src/shared/page/layout-host/read-layout-module.ts`
- `drawPart<L extends object, B, R extends { element: HTMLElement }>(options: DrawPartOptions<L, B, R>): { built: R;
  layoutName: string; dispose(): void }` — options `owner`, `parent`, `pick`, `defaultLayout`, `part(layout)`, `build(builder,
  parent, rollback): R`, `log`, `logSource`, `partName` — with `PartPick<L>`, `RollbackDeps` and
  `requireElementIn(parent, element, partName)` from `draw-part.ts`. `dispose` disposes every anchor and box
  recorded through the successful attempt's `rollback`, once.
- `pickLayout<L>(chain, layouts, defines): PartPick<L>` from `pick.ts`
- `createBaseKit(deps: BaseKitDeps): BaseKit`, `BaseKitDeps` (`keys.keysFor` returns `string | null`; `scope:
  ViewScope | null`), `KitCommands { exists(id): boolean; run(id): void }` and `commandRunner(qualifiedId: CommandId,
  commands: KitCommands): () => void` from `base-kit.ts`
- `BaseKit` and `DotStatus`, `KitRowOptions` from `kit.d.ts`, imported in `layout.d.ts` as
  `import type { BaseKit } from '../../../shared/page/layout-host/kit';` (the registry rewrites it to `'../kit'` in
  the user's copy). This task uses the members `el`, `row`, `statusDot` and `keyHint`.
- the `LAYERS` entries for `src/plugins/sessions/layouts` and its use from `sessions/main` and `sessions/page`
  (02 adds them; this task does not edit `scripts/check-layers.mts`)
- the `<Leader>zl` group named `layout previews` ← 05

Produces:
- in `layouts/layout.d.ts`:
  - `export interface SessionRowInput { sessionId: string; label: string; harness: string; marked: boolean;
    status: string | null }` — `harness` is `harnessText(row.harness)`, `''` for none
  - `export interface SessionTabInput { title: string }`
  - `export interface EmptyTextInput { text: string; hasHint: boolean }`
  - `export interface SessionsPart { element: HTMLElement }`
  - `export interface SideBarPane extends SessionsPart { rows: HTMLElement }`
  - `export interface TabBarPane extends SessionsPart { strip: HTMLElement }`
  - `export interface SessionsKit extends BaseKit {}`
  - `export interface SideBarKit extends SessionsKit { sessionEdge(parent: HTMLElement): HTMLElement }`
  - `export interface TabBarKit extends SessionsKit { prevTabEdge(parent: HTMLElement): HTMLElement;
    nextTabEdge(parent: HTMLElement): HTMLElement; closeHint(parent: HTMLElement): HTMLElement }`
  - `export interface EmptyTextKit extends SessionsKit { pickHint(parent: HTMLElement): HTMLElement }`
  - `export interface Layout { sideBar?(parent: HTMLElement, kit: SideBarKit): SideBarPane;
    row?(parent: HTMLElement, input: SessionRowInput, kit: SessionsKit): SessionsPart;
    tabBar?(parent: HTMLElement, kit: TabBarKit): TabBarPane;
    tab?(parent: HTMLElement, input: SessionTabInput, kit: SessionsKit): SessionsPart;
    emptyText?(parent: HTMLElement, input: EmptyTextInput, kit: EmptyTextKit): SessionsPart }`
  - `export interface CompleteLayout extends Required<Layout> {}` (every part defined)
- `export function readSessionsLayout(module: unknown, name: string): Layout` in `read-sessions-layout.ts`
- `export const PREVIEW_STATE: SessionsState` and `export const PREVIEW_STATUSES: Readonly<Record<string, string | null>>`
  in `preview.ts`
- `SessionsView.setLayouts(shown: ShownLayouts<Layout>): void` and `SessionsView.showPreview(isShown: boolean): void`
  in `sessions-view.ts`
- manifest command `openPreview`, setting `layout`

Decisions:
- **The tab strip is the sessions plugin's.** The strip, its edge prompts and close prompt live in
  `src/plugins/sessions/page/session-tabs-view.ts`, not in `src/renderer/shell/`. The shell cannot see a plugin's
  session tabs. So this task owns `tabBar` and `tab`, and task 13 does not draw the strip.
  `docs/features/layouts/design.md` § Adopters gives the tab strip to `sessions`.
- **Parts, from the code:** `sideBar` (the "Sessions" header with the session edge prompt over the row list,
  `mountSidebarView`), `row` (one per `SessionRow`, `buildRow`), `tabBar` (the bar of `buildTabsBar`: previous edge,
  strip, next edge, close prompt), `tab` (one per tab, `buildTab`), `emptyText` (the text why no tab shows,
  `buildText`). The tab bodies, the sheet that holds them, and the tab elements other plugins add stay app-owned.
- **Panes are built once per layout set.** `sideBar` and `tabBar` draw once, and again on each `setLayouts`. The
  app fills the pane's `rows` and `strip` containers. A pane whose `rows` or `strip` is not inside its `element`
  falls back to `default` (check with `requireElementIn`).
- **Rows, tabs and the empty text redraw on each render**, as today (`replaceChildren`).
- **The app keeps:** `is-selected` and `aria-current="true"` on the selected row's element; `is-active` and
  `aria-current` on the active tab's element; the click handler on each row element (activate) and each tab element
  (select), added by the app to the returned element so a layout cannot drop it; the `title` tooltip on the row
  (`label` or `label · status`) and the tab (`title`); `is-no-target` on the elements `sessionEdge`, `prevTabEdge`,
  `nextTabEdge` and `closeHint` return; the empty text's show and hide.
- **Kit parts:** `sessionEdge` builds `⌥⇧I ▲ ▼ ⌥⇧O` as `buildSessionPair` does today; `prevTabEdge`, `nextTabEdge`
  and `closeHint` build the tab bar prompts as `buildTabsBar` does today (`closeHint` with label `close`);
  `pickHint` appends the one `span.sessions-pick-hint` of `NO_SELECTION_TEXT` and returns it. The view builds that
  element and its `nextSession` anchor once, as `session-tabs-view.ts` does today, so `pickHint` makes no anchor and
  each render of `emptyText` moves the same element. These anchors keep no scope, as today, so they show in every
  scope. A layout that leaves one out leaves that anchor unplaced; `default` places every one.
- **Disposing a part on a redraw:** the view keeps the `dispose` of each part's last draw: one for each pane, one per
  row, one per tab and one for the empty text. It calls that `dispose` before it draws the same part again (rows,
  tabs and the empty text on each render, the panes on `setLayouts`) and before it drops the part's element (a row
  that leaves, a session's tabs that drop). So the edge prompts and any `kit.keyHint` a user part calls hold one
  anchor however often the part draws. The `pickHint` anchor is the view's own and is not in any part's recorder.
- **BaseKit deps:** `scope` is `null`, since every sessions anchor today has no scope and shows in every scope
  (`keyHint` then anchors with no scope, and `keysFor` reads any scope); `commandNamed(short)` returns
  `qualify('sessions', short)` when `short` is a key of `sessionsManifest.commands`, else null; `markdown` is
  `api.services.markdown`; `keys` is the keys page export; `platform` is `api.platform`; `commands` is the
  `KitCommands` `{ exists: (id) => api.keys.command(id) !== undefined, run: (id) => api.commands.run(id) }`, as
  02's Kit commands decision writes it.
- **Pick chain:** `[shown.user, 'default']`. Sessions names no layout per row.
- **Fallback:** each part draws through `drawPart` with `owner` `sessions`, `logSource` `sessions` and `partName`
  the part's key. A part that throws, or returns an element not appended to `parent`, draws with `default`. Each
  part root carries `data-layout="<name>"` and `data-layout-owner="sessions"`.
- **No picker or prompt.** Sessions opens no list picker and no confirm prompt, so this task fills neither hook.
- **`default` layout** reproduces today's look with today's class names (`session-side`, `session-sidebar`,
  `session-row`, `session-row-status`, `session-edge`, `session-tabs-bar`, `session-tabs-edge`, `session-tabs-close`,
  `session-tabs`, `sessions-empty`), so `sessions.css` keeps working unchanged. It builds the row with
  `kit.row(parent, { density: 'list', label, detail, trailing })`, as `buildRow` calls the row primitive today, and
  the marked dot with `kit.statusDot(<trailing element>, 'attention')`. `SessionsKit` adds no row or status dot of its
  own: `BaseKit` holds both.
- **Main:** `start` imports `../layouts/layout.d.ts?raw`, calls `api.layouts.register({ layoutTypes })`, and
  disposes the result in the part's `dispose`.
- **Page:** `start` calls `api.layouts.show<Layout>({ defaultLayout, read: readSessionsLayout, userLayout: () =>
  api.settings().layout, setLayouts: (shown) => view.setLayouts(shown) })`. No `namesInUse`. The show refreshes
  on each change of sessions' settings by itself, so `start` calls no `refresh`.
- **Before the first set:** the view draws with `default` alone until `setLayouts` runs.
- **Reload keeps work:** `setLayouts` redraws the two panes, then the rows, tabs and empty text from the state the
  view holds. Tab bodies and the tab elements other plugins added are not touched, so no chat, form or box loses
  its state. The selected session, the selected tab and the key scope do not change.
- **Setting:** manifest `settings: { layout: 'default' }`; `settingInfo.layout`: label `Layout`, description
  `"The sessions layout Sessions mode's side bar and tab bar draw in: a folder name in sessions' layouts folder, or default."`

Preview (`Space z l s`):
- Manifest command `openPreview: { label: 'show the layout preview rows', group: 'debug', runsIn: 'page' }`.
- `keymap.ts`, in the Debug and testing block after `<Leader>zlo`:
  `{ keys: '<Leader>zls', scope: 'any', command: 'sessions.openPreview', where: 'page' }`.
- `docs/keymap.md` § Leader groups: the `zl` row's binds column gains `` `zls` sessions preview `` after the binds
  task 05 left there. Task 15 adds `zlc` after it.
- A press shows Sessions mode, opens its side bar when `mode.sideBarShown()` is false, and swaps the side bar's
  rows for `PREVIEW_STATE` with `PREVIEW_STATUSES`. The next press restores the real rows. Log
  `[sessions] preview shown` and `[sessions] preview closed`.
- The preview is page-only. It invokes nothing on the channel, emits no event, toasts nothing, and calls no
  `mark`, so main raises no notification or badge.
- While it shows: a click on a sample row moves the sample's selection only; `nextSession` and `prevSession` step
  the sample's selection (with `stepSession` over `PREVIEW_STATE`) and invoke nothing. Each `stateChanged` from main
  still runs `apply` in full (events, tabs, title bar context), but the side bar keeps the sample until the preview
  closes, then draws the latest real state. The tab area keeps the real selected session.
- `PREVIEW_STATE.rows`, in order (`sessionId` · `label` · `harness` · `marked`), with `selectedSessionId`
  `preview-1`, `projectDir` and `hostSessionId` null on each:
  1. `preview-1` · `wigley-ai-gui` · `claude` · false
  2. `preview-2` · `wigley-ai-marketplace` · `codex` · true
  3. `preview-3` · `new-games-prototypes` · `claude` · true
  4. `preview-4` · `scratch` · null · false
  5. `preview-5` · `a-session-label-long-enough-to-end-in-an-ellipsis-in-the-side-bar` · `claude` · false
- `PREVIEW_STATUSES`: `preview-1` `working`, `preview-2` `waiting for permission`, the rest null.

GIVEN a user sessions layout whose `row` throws WHEN the side bar renders THEN each row draws with `default`, carries
`data-layout="default"` and `data-layout-owner="sessions"`, and the throw is logged once for that layout revision
with source `sessions`.
GIVEN a user layout that draws a row as a bare `div` WHEN the user clicks it THEN its session activates, and the
selected one carries `is-selected`.
GIVEN Sessions mode with a Chat tab holding typed text WHEN the sessions layout file is saved THEN the side bar and
tab bar redraw and the Chat tab element is the same node with its text.
GIVEN no agent session WHEN the user presses `Space z l s` THEN the side bar shows the five sample rows, and the
channel receives no `activate` or `closeSession`.

Tests:
- `readSessionsLayout_BadShape_ThrowsNamingIt` — `it.each` rows: default export missing; default export not an
  object; key `rows` (no such part); `row: 1` (not a function). Each row asserts the message names the layout and the
  key. Catches a reader that lets a bad layout reach drawing.
- `readSessionsLayout_PartialLayout_ReturnsTheDefinedParts` — a layout with only `row` reads back. Catches a reader
  that demands every part.
- `sessionsParts_PartFails_DrawsWithDefault` — `it.each` rows: `row` throws; `tab` throws; `sideBar` returns `rows`
  outside its element; `tabBar` returns an element not in `parent`. Each asserts the part's root carries
  `data-layout="default"` and `data-layout-owner="sessions"`. Catches a missing fallback or containment check.
- `sessionsParts_RowDrawnByUserLayout_KeepsClickAndSelection` — a user `row` returns a bare element; a click calls
  `activate` with its id, and the selected row has `is-selected` and `aria-current`. Catches app-owned behaviour
  moved into the layout.
- `sessionsParts_Redraw_LeavesOneAnchorPerHint` — a recording `anchor` double. Render the empty text three times,
  and render rows twice with a user `row` that calls `kit.keyHint`; then `setLayouts` draws the panes again. Asserts
  one live `nextSession` anchor for the pick hint, one live anchor per row hint, and one per edge prompt. Catches a
  redraw that leaks an anchor on each render or reload.
- `preview_SampleRows_CoverEveryRowState` — `PREVIEW_STATE` holds a selected row, a marked row, an unmarked row,
  each harness and null, a row with a status and one without. Catches a sample edit that drops a state.
- `sessionsView_PreviewShown_SendsNothingAndRestoresRealRows` — with the fake DOM: show the preview, click a sample
  row, apply a new real state, close the preview. Asserts `activate` was never called, the click moved the sample
  selection, and the side bar then draws the new real rows. Catches a preview that reaches main or loses state.

Done when: `npm run lint` and the type check pass; the test gate runs the tests above. Runtime and visual checks are
task 17's (Final verification).

Commit: one commit for the group.

## Proof

Commit 4d9178a · proof: diff read: Produces present (SessionsView amended); typecheck and lint clean; full npm test 3860 pass · concerns: sessions-view-fakes.ts added outside Files; AGENTS.md sessions/ entry names no layouts/ or preview (task 16); a second preview press restores real rows but leaves the mode and side bar shown
