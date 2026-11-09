# 06 — system-stats page, layout, keys, self-test

Status: in progress
Type: Task
Wave: 3 · Depends on: 04, 05
Plan: [plan.md](plan.md)

Read first: `docs/features/system-stats/design.md`; `DESIGN.md` § Keys and focus (the four placement kinds),
§ Primitives (Meter, Sparkline, Row, EmptyState), the Right bar, Usage and System stats bullets; `docs/keymap.md`
§ Adding a bind; AGENTS.md § Architecture (The shell, A focus target, A key, A key scope, Key hints, A layout) and
§ Running and testing (the self-test bullet); the template `src/plugins/unity-pool/page/start.ts`,
`page/layout/read-unity-pool-layout.ts`, `layouts/layout.d.ts`, `layouts/default/layout.js` and
`main/selftest-script.ts`; `src/plugins/usage/page/start.ts` (the `uiState` toggle).

Files:
- create `src/plugins/system-stats/page/start.ts` · test `src/plugins/system-stats/page/start.test.ts`
- create `src/plugins/system-stats/page/stats-view-model.ts` · test `src/plugins/system-stats/page/stats-view-model.test.ts`
- create `src/plugins/system-stats/page/layout/read-system-stats-layout.ts`
- modify `src/plugins/system-stats/layouts/layout.d.ts` (05's stub; this task writes the contract)
- create `src/plugins/system-stats/layouts/default/layout.js`
- create `src/plugins/system-stats/layouts/default/layout.css`
- create `src/plugins/system-stats/main/selftest-script.ts`
- modify `src/plugins/system-stats/main/start.ts` — hand the self-test script
- modify `src/plugins/page.ts` — import `systemStatsPagePart`, list it after `unityPoolPagePart`
- modify `src/plugins/keymap.ts` — the binds below

Consumes:
- `BaseKit.sparkline(parent: HTMLElement, values: readonly number[], tone: MeterTone): HTMLElement` in
  `src/shared/page/layout-host/kit.d.ts` ← 04
- `systemStatsManifest` (commands `togglePanel`, `cursorDown`, `cursorUp`, `cursorTop`, `cursorBottom`, `cycleSort`,
  `openGroup`, `closeGroup`; scope `panel`; settings `processRows`, `layout`) ← 05
- `systemStatsSnapshotSlot`, `StatsSnapshot`, `StatsProcessRow`, `StatsSortColumn`, `StatsFixtureVariant`,
  `SystemStatsChannel` (invoke `setShown`, message `seeded`) in `src/plugins/system-stats/contract.ts` ← 05
- the `seed` closure and the slot writer in `src/plugins/system-stats/main/start.ts` ← 05
- the `busy` fixture's rows and values (05 Decisions, Fixture `busy`) ← 05 — the self-test lines below are built
  from them
- `createBaseKit`, `ownerBaseKitDeps`, `kitCommandsOf`, `createLayoutParts`, `readLayoutParts`, `element`,
  `callEach`, `errorText` — already in the tree, used as unity-pool's page uses them

Produces:

`src/plugins/system-stats/layouts/layout.d.ts`:

```ts
import type { BaseKit, MeterTone } from '../../../shared/page/layout-host/kit';
export interface StatsMeterInput {
  label: 'CPU' | 'GPU' | 'RAM' | 'Network' | 'Disk';
  percent: number | null;      // 0–100; null when unreadable: draw the meter at 0
  tone: MeterTone;
  history: readonly number[];  // 0–100, oldest first; for kit.sparkline
  value: string;               // the value text: `38%`, `21.4 / 32 GB`, `1.2 MB/s ↓ 80 KB/s ↑`, `—`
  note: string | null;         // the line under the row: RAM's memory note; null on every other meter
}
export interface StatsRowInput {
  id: string;
  name: string;
  kind: 'app' | 'session' | 'process';
  depth: 0 | 1;                // 1: a process inside an open group
  isOpen: boolean;             // true on an open group; false on a closed group and on every process
  cpu: string;                 // `22.5%`
  ram: string;                 // `700 MB`, `1.8 GB`
  gpu: string;                 // `6.0%`, or `—` with no GPU reading
  isCursor: boolean;
}
export interface PanelInput {
  reading: boolean;            // true until the first snapshot; meters and rows are empty then
  error: string | null;
  meters: StatsMeterInput[];   // CPU, GPU, RAM, Network, Disk, in that order
  sort: 'cpu' | 'ram' | 'gpu';
  rows: StatsRowInput[];
  moreRows: number;            // top-level rows cut by the processRows setting
}
export interface SystemStatsKit extends BaseKit {}
export interface SystemStatsPart { element: HTMLElement }
export interface Layout {
  panel?(parent: HTMLElement, input: PanelInput, kit: SystemStatsKit): SystemStatsPart;
}
export interface CompleteLayout extends Required<Layout> {}
```

with a header comment in unity-pool's form: what the app keeps (the right-bar slot while shown, the keys and focus,
the cursor, the sort, open groups, every redraw on each snapshot, settings change and layouts set), and that the
layout adds `is-cursor` to the row whose `isCursor` is true.

`src/plugins/system-stats/page/stats-view-model.ts`:

```ts
export type CursorMove = 'down' | 'up' | 'top' | 'bottom';
export interface VisibleRow { row: StatsProcessRow; depth: 0 | 1; parentId: string | null }
export function nextSort(sort: StatsSortColumn): StatsSortColumn;
export function visibleRows(rows: readonly StatsProcessRow[], sort: StatsSortColumn,
  openIds: ReadonlySet<string>, processRows: number): { rows: VisibleRow[]; moreRows: number };
export function movedCursor(index: number, count: number, move: CursorMove): number;
export function closeTarget(visible: readonly VisibleRow[], cursorId: string): string | null;
export function formatPercent(percent: number): string;
export function formatBytes(bytes: number): string;
export function formatGpu(percent: number | null): string;
export function panelInput(snapshot: StatsSnapshot | null, visible: { rows: VisibleRow[]; moreRows: number },
  sort: StatsSortColumn, cursorId: string | null): PanelInput;
```

`src/plugins/system-stats/page/layout/read-system-stats-layout.ts`:
`export function readSystemStatsLayout(module: unknown, name: string): Layout` (`LAYOUT_PARTS = { panel: true }`).

`src/plugins/system-stats/page/start.ts`:
`export const systemStatsPagePart: PagePart<typeof systemStatsManifest>` with handlers for all eight commands.

`src/plugins/system-stats/main/selftest-script.ts`:

```ts
export interface SystemStatsSelfTestDeps {
  seed(variant: StatsFixtureVariant): StatsSnapshot;
  snapshot(): StatsSnapshot | null;
}
export function systemStatsSelfTestScript(deps: SystemStatsSelfTestDeps): SelfTestScript;
```

`main/start.ts` calls `services.selfTest?.run(systemStatsSelfTestScript({ seed, snapshot }))` in `start`.

Binds in `src/plugins/keymap.ts`:
- after `{ keys: '<Leader>vf', … }`: `{ keys: '<Leader>vy', scope: 'any', command: 'system-stats.togglePanel' }`
- a new block `// ── System stats ──` after the Unity pool block, every bind in scope `system-stats.panel`:
  `j` `cursorDown`, `k` `cursorUp`, `gg` `cursorTop`, `G` `cursorBottom`, `s` `cycleSort`, `<CR>` `openGroup`,
  `l` `openGroup`, `h` `closeGroup` (each command qualified `system-stats.<name>`).

Decisions:
- **Right-bar order:** `PANEL_ORDER = 20`, after usage's details (0) and the unity-pool panel (10). The stats panel
  is always shown, so it sits last and the panels that come and go stay at the top.
- **Contribution:** a `div.system-stats-panel-slot`, `tabIndex = -1`, `style.outline = 'none'` (the cursor row draws
  the ring), contributed with `{ order: PANEL_ORDER, focus: focusPanel, left: leavePanel }` while shown, and
  disposed on hide, as unity-pool's `hidePanel`. A hide while the panel holds the keys hands them back to main
  through that dispose.
- **Hidden flag:** `services.uiState` key `hidden`: `true` while hidden, `false` or `undefined` while shown. Absent
  means shown, except under `services.runMode === 'selfTest'`, where absent means hidden: a default-shown,
  focusable right-bar panel would change every other plugin's self-test (docs' `<A-l>` step at
  `src/plugins/docs/main/selftest-script.ts:345-348` expects `[page] no pane right`, and the screenshots and
  `checksFit` runs lose the right bar's width). So under self-test a show stores `false`, a hide `true`; live and
  drive runs store `undefined` on show, as written above.
- **setShown:** at start the page invokes `setShown(!hidden)`, and each toggle invokes it with the new state. A
  rejection logs `setShown failed: <errorText>`. `dispose` invokes nothing: an old page's `false` could land after a
  new page's `true`. The accepted cost: a page part stopped with no new page starting (a plugin stop, a renderer
  crash) leaves main sampling until the next report. The slot read before main's first write is `undefined`; the
  page reads `snapshot ?? null`.
- **View state** is private to the page and resets on each page load: `sort` starts at `cpu`; `openIds` empty;
  `cursorId` null; `lastIndex` 0 (the cursor's index at the last draw that showed it); `hasKeys` false. A hide sets
  `hasKeys` false and keeps `sort`, `openIds`, `cursorId` and `lastIndex` for the page's life.
- **Sort** (`visibleRows`): descending by the column (`cpuPercent`, `rssBytes`, `gpuPercent`); a null GPU sorts after
  every number; ties by `name` ascending (code-unit order), then by `id`. `nextSort`: `cpu` → `ram` → `gpu` → `cpu`.
- **Cut:** the first `max(1, processRows)` top-level rows after the sort; each open group among them is followed by its
  children, sorted by the same column, at `depth` 1. `moreRows` = top-level count − shown top-level count. An id in
  `openIds` that the snapshot no longer holds is dropped at the next draw.
- **Cursor:** kept as a row id across redraws; `panelInput` gets `cursorId` only while `hasKeys` (else null), as
  unity-pool passes `hasKeys ? cursor : null`, so the ring shows only while the panel holds the keys. When the id
  is not visible after a draw: a child row whose group is still visible moves the cursor to that group; otherwise
  the cursor takes the row at `lastIndex`, clamped to the list; with no rows it is null. While `hasKeys`, a draw with
  `cursorId` null and rows present puts the cursor on the first row and logs `cursor on <name>`. `focusPanel` keeps
  a visible cursor id, else takes the first row. `movedCursor` treats an index of -1 as 0 and clamps at both ends.
- **Open and close:** `openGroup` on a closed group adds its id to `openIds`; on an open group it logs
  `already open: <name>`; on a process row it logs `no group: <name>`. `closeGroup` goes through `closeTarget`: the
  cursor's own open group, else the group of the child row the cursor is on (the cursor then moves to that group);
  null logs `no open group: <name>`.
- **Redraws:** on each `system-stats.snapshot` change, each settings change (`api.onSettingsChanged`), each layouts
  set, each key command, focus and leave. While hidden, a snapshot change draws nothing. A redraw while the panel
  holds the keys scrolls `.is-cursor` into view only when the cursor moved, as unity-pool's `scrolledCursor`.
- **Kit scope:** the panel draws with `ownerBaseKitDeps(systemStatsManifest, kitServices, 'panel', rollback)`, so its
  anchor fires in `system-stats.panel`.
- **Key anchors** (AGENTS.md § Key hints; `src/shared/vim-keys.ts`): `j`, `k`, `h`, `l`, `gg`, `G` and `<CR>` are vim's
  own keys and need none; `<Leader>vy` is a leader sequence and needs none. `s` (`cycleSort`) is the one bind that
  needs an anchor: a box hint at the end of the column heading row, `kit.keyHint(header, 'cycleSort', { label: 'sort' })`.
  It shows only while `system-stats.panel` holds the keys, keeping its space.
- **Formats** (`stats-view-model.ts`): `formatPercent` one decimal then `%` (`22.5%`, `0.0%`); `formatBytes` below
  1 GiB (2^30) `Math.round(bytes / 2^20)` MiB then ` MB` (so 1023.96 MiB prints `1024 MB`), else GiB with one decimal then ` GB` (`700 MB`,
  `1.8 GB`); `formatGpu` null → `—` (U+2014), else `formatPercent`. Meter `value` is the snapshot's `label`;
  RAM's `note` is the snapshot's `memoryNote`, null when that is empty.
- **Copy (pinned):**
  - section header: `System stats`
  - meter labels: `CPU`, `GPU`, `RAM`, `Network`, `Disk`
  - column headings: `Process`, `CPU`, `RAM`, `GPU`; the sorted one adds ` ▾` and the class `is-sorted`
  - reading line (no snapshot yet): `Reading the machine…` through `kit.emptyState`
  - empty list (a snapshot with no rows and no error): `No processes` through `kit.emptyState`
  - error line: `Could not read the machine: <error>`, in `status-error`, above the process list
  - cut note: `<k> more` in `text-12` `fg-tertiary`, under the last row, only while `moreRows` > 0
- **Look** (`layout.css`, tokens only, DESIGN.md § System stats): a meter row is a grid of the label (`text-12`
  `fg-secondary`), the Meter, the value (tabular numerals, never narrower than `100%`'s width, as usage's meters) and
  the Sparkline; RAM's note sits under its row in `text-12` `fg-tertiary`. Process rows are `kit.row` with
  `density: 'tree'`, `depth` from the input, a `chevron-right` or `chevron-down` icon as `leading` on a group, and the
  three number cells as `trailing`, each `var(--wg-system-stats-column-width)` wide, right-aligned, tabular. Names
  ellipsize on one line. The column heading row is the layout's own element: a leading spacer the chevron's width,
  the `Process` heading taking the rest, then a trailing box of three cells each
  `var(--wg-system-stats-column-width)` wide, so its columns line up with the rows'.
- **Page log lines** (the self-test reads them; each prefixed `[system-stats] ` by `services.log`):
  - `panel shown: <names>` at start while shown and at each show; `<names>` is the top-level visible names joined by
    `, `, or `reading` with no snapshot, or `no processes`
  - `panel hidden` at each hide
  - `seeded <variant>` on the `seeded` message
  - `panel focused` at `focusPanel`
  - `cursor on <name>` after a move, at `focusPanel`, and on a redraw that changes the cursor row's name while the
    panel holds the keys; `no rows` on a move with no rows
  - `sorted by <column>: <names>` after `cycleSort`, the top-level visible names
  - `opened <name>: <child names>` after an open, the children in shown order; `closed <name>` after a close
  - `error: <text>` when the snapshot's error text changes to a new non-null text; `error cleared` when it goes null
- **Self-test** (`main/selftest-script.ts`): `pageBinds: []`, `settings: {}`, `scrollsItself: []`. `open` calls
  `deps.seed('busy')` and returns `shownLine: '[system-stats] seeded busy'` and `result: Promise.resolve(deps.snapshot())`.
  `problems(result)` returns `['the busy seed did not reach the slot']` when `result`'s top-level row ids differ
  from `statsFixture('busy', 0)`'s, else `[]`. The script runs after unity-pool's (05 lists the main part after
  `unityPoolMainPart`), so two `<A-l>` reach the right bar from a Chat tab with its hub, as unity-pool's do; on a
  filtered run with no session the second press logs `no pane right` and the panel keeps the keys.

Self-test groups (lines from the `busy` fixture; each `expect` is prefixed `[system-stats] ` unless shown whole):

| group (why) | keys | expect | also / screenshot |
|---|---|---|---|
| `toggle` (the self-test starts hidden; Space v y shows the panel with the seeded rows by CPU, fitting the window, hides it, and shows it again) | `' ', 'v', 'y'` | `panel shown: Google Chrome, WindowServer, claude · fix login, Finder` | screenshot `panel`, `checksFit: true` |
| | `' ', 'v', 'y'` | `panel hidden` | screenshot `hidden` |
| | `' ', 'v', 'y'` | `panel shown: Google Chrome, WindowServer, claude · fix login, Finder` | |
| `cursor` (Alt+l gives the panel the keys with the cursor on the first row; j, G, gg and k move it and stop at the ends) | `'<A-l>', '<A-l>'` | `panel focused` | alsoExpect `/^\[system-stats\] cursor on Google Chrome$/`, screenshot `panel-cursor` |
| | `'j'` | `cursor on WindowServer` | |
| | `'G'` | `cursor on Finder` | |
| | `'g', 'g'` | `cursor on Google Chrome` | |
| | `'k'` | `cursor on Google Chrome` | |
| `sort` (s cycles the sort through RAM, GPU and back to CPU, a missing GPU reading sorting last) | `'s'` | `sorted by ram: Finder, Google Chrome, claude · fix login, WindowServer` | screenshot `sorted-ram` |
| | `'s'` | `sorted by gpu: WindowServer, Google Chrome, Finder, claude · fix login` | |
| | `'s'` | `sorted by cpu: Google Chrome, WindowServer, claude · fix login, Finder` | |
| `groups` (Enter and l open the cursor's group with its processes sorted under it, h closes it from a child or from the group, a lone process has no group, and Alt+h gives the keys back) | `'Enter'` | `opened Google Chrome: Google Chrome Helper (Renderer), Google Chrome` | screenshot `group-open` |
| | `'j'` | `cursor on Google Chrome Helper (Renderer)` | |
| | `'h'` | `closed Google Chrome` | alsoExpect `/^\[system-stats\] cursor on Google Chrome$/` |
| | `'l'` | `opened Google Chrome: Google Chrome Helper (Renderer), Google Chrome` | |
| | `'h'` | `closed Google Chrome` | |
| | `'G'` | `cursor on Finder` | |
| | `'l'` | `no group: Finder` | |
| | `'<A-h>'` | `[page] focus back in main` (whole) | |
| `hide-last` (the panel ends hidden, so later scripts see the right bar as they did) | `' ', 'v', 'y'` | `panel hidden` | |

GIVEN no `hidden` key in uiState in a live or drive run WHEN the page starts THEN it invokes `setShown(true)` and
  logs `panel shown: …`; in a self-test run it invokes `setShown(false)`
GIVEN the panel shown WHEN `togglePanel` runs THEN uiState `hidden` is `true`, it invokes `setShown(false)`, and the
  contribution is disposed
GIVEN the cursor on a child row WHEN `closeGroup` runs THEN the group closes and the cursor sits on the group
GIVEN the rows sorted by GPU WHEN a row's GPU is null THEN it sits after every row with a number

Tests:
- `stats-view-model.test.ts` (built rows, general values: no two equal numbers in a column unless the row is about
  a tie)
  - `visibleRows_SortCutAndOpen` — rows: CPU sort, `processRows` 3 of 5 (names in order, `moreRows` 2); RAM sort;
    GPU sort with one null last; a CPU tie ordered by name; an open group in the cut (its children at depth 1, sorted
    by the column); an open group cut off (no children shown); `processRows` 0 (shows 1).
  - `panelInput_MapsSnapshotToRows` — rows: null snapshot → `reading` true with the five meters empty; an error
    snapshot with no rows → `error` set, no rows; empty `memoryNote` → RAM `note` null; a cut list → `moreRows`;
    an open group with the cursor on its child → `isOpen`, the child at `depth` 1 with `isCursor`; meters in the
    order CPU, GPU, RAM, Network, Disk with each `label` as `value`.
  - `movedCursor_ClampsAtEnds` — (2, 5, down) → 3; (4, 5, down) → 4; (0, 5, up) → 0; (3, 5, top) → 0;
    (1, 5, bottom) → 4.
  - `closeTarget_OwnGroupOrParent` — cursor on an open group → that group; on its child → the parent; on a closed
    group → null; on a lone process → null.
  - `formats_Cells` — `formatPercent` 22.5 → `22.5%`, 0.04 → `0.0%`; `formatBytes` 1_072_693_248 (1023 MiB) →
    `1023 MB`, 1_073_700_000 → `1024 MB`, 1_073_741_824 → `1.0 GB`, 2_726_297_600 → `2.5 GB`; `formatGpu` null → `—`, 31 → `31.0%`.
- `start.test.ts` (`startPagePart` with an `invoke` recorder and a replaced `uiState`)
  - `start_ReportsShownState` — rows: live, uiState empty → `setShown(true)` and `panel shown: reading`; live,
    `hidden: true` → `setShown(false)` and no `panel shown` line; selfTest, uiState empty → `setShown(false)`;
    selfTest, `hidden: false` → `setShown(true)`.
  - `snapshotChange_LogsErrorOnce` — error text set, the same text again, then null: `error: <text>` once, then
    `error cleared`.
  - `hiddenPanel_DrawsNothingOnSnapshot` — hidden, the slot changes: the layout's draw is not called and no line
    is logged; on show, `panel shown: <names>` from the current slot.
  - `cursorFallback_RowsChangeUnderTheCursor` — with the capture-layout pattern of unity-pool's page test: rows
    (a) cursor on a child, its group closes from a new snapshot → cursor on the group; (b) cursor row gone, others
    remain → the row at `lastIndex`, clamped; (c) focused on an empty panel, then a snapshot with rows → cursor on
    the first row and `cursor on <name>` logged.
  - `togglePanel_FlipsHiddenAndReports` — two runs: uiState `hidden` goes `true` then `undefined`; invokes
    `setShown(false)` then `setShown(true)`.
  - `stop_LeavesNoLiveRegistration`, as unity-pool's page test.

Done when: `npm run typecheck` passes; `npm run lint` passes (the plugin lists, layer rules and `check-styles` over
`layout.css`); the Vitest files above pass, with `src/shared/layouts/layout-contracts.test.ts` (it type-checks the
new `layout.d.ts` against the kit); `npm run selftest -- --plugin system-stats` passes every group above and its
screenshots are read against DESIGN.md § System stats. The placement check runs only on a whole self-test run, so
the `s` anchor and the drive and visual checks are deferred to "08 — Final verification".

Commit: one commit for the group: `system-stats page: the right-bar panel, its layout, keys and self-test`.

## Proof
