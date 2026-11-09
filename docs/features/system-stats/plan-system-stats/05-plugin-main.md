# 05 — system-stats main: sampling, snapshot, slot

Status: in progress
Type: Task
Wave: 2 · Depends on: 01, 03
Plan: [plan.md](plan.md)

Read first: `docs/features/system-stats/design.md`; AGENTS.md § Architecture (A plugin, A slot, A plugin talks,
An ambient service, A setting, A layout, `npm run lint`); the template `src/plugins/unity-pool/` (manifest,
contract, `main/start.ts`) and `src/plugins/usage/main/{plan-poller.ts, start.ts, drive-actions.ts}` (the seed and
the poller this task copies the shape of).

Files:
- create `src/plugins/system-stats/manifest.ts`
- create `src/plugins/system-stats/contract.ts`
- create `src/plugins/system-stats/main/start.ts`
- create `src/plugins/system-stats/main/snapshot.ts` · test `src/plugins/system-stats/main/snapshot.test.ts`
- create `src/plugins/system-stats/main/grouping.ts` · test `src/plugins/system-stats/main/grouping.test.ts`
- create `src/plugins/system-stats/main/poller.ts` · test `src/plugins/system-stats/main/poller.test.ts`
- create `src/plugins/system-stats/main/stats-fixture.ts` (the fixed snapshot the drive seed and 06's self-test seed)
- create `src/plugins/system-stats/main/drive-actions.ts`
- test `src/plugins/system-stats/main/start.test.ts`
- create `src/plugins/system-stats/layouts/layout.d.ts` as a stub that 06 fills (main's `?raw` import needs the
  file): the header comment, `import type { BaseKit } …`, `export interface Layout {}` and
  `export interface CompleteLayout extends Required<Layout> {}`
- modify `src/plugins/manifests.ts` — import `systemStatsManifest`, list it after `unityPoolManifest`
- modify `src/plugins/main.ts` — import `systemStatsMainPart`, list it after `unityPoolMainPart`
- modify `src/shared/fake-system-stats.ts` — delete `FAKE_SESSION_PID` and import `FAKE_AGENT_PID` from
  `src/shared/fake-agent-harness.ts` (← 03) in its place, so a drive run's fake Chat session (fake harness, fake
  stats) forms its own `claude · <title>` group; `fake-system-stats.test.ts` follows the rename

Consumes:
- `ProcessSample`, `SystemSample`, `SystemStats`, `MemoryPressure` in `src/contracts/system-stats.ts` ← 01
- `MainServices.systemStats: SystemStats` in `src/contracts/plugin.ts` ← 01
- `ChatSessionInfo.pid: number | null` in `src/plugins/chat/contract.ts` ← 03
- `FAKE_AGENT_PID` in `src/shared/fake-agent-harness.ts` ← 03; `FAKE_SESSION_PID` in `src/shared/fake-system-stats.ts` ← 01
- `chatSessionSlot` (`src/plugins/chat/contract.ts`), `sessionsRowsSlot`, `SessionRow`, `editableTitle`
  (`src/plugins/sessions/contract.ts`) — already in the tree
- `Timers`, `Clock` (`src/contracts/ambient.ts`), `DriveHost` (`src/contracts/plugin.ts`), `argsObject`,
  `optionalOneOf` (`src/shared/drive-args.ts`) — already in the tree

Produces:

`src/plugins/system-stats/contract.ts` — the File Structure's names word for word, with these settled changes
(each reported to plan.md):

```ts
// The kit's MeterTone values. A plugin contract may import only src/contracts and the contracts it reads, so it
// cannot name MeterTone (src/shared/page/layout-host/kit.d.ts); the layout contract passes this to kit.meter.
export type StatsTone = 'normal' | 'warning' | 'critical';
export type StatsSortColumn = 'cpu' | 'ram' | 'gpu';
export interface StatsMeter { percent: number | null; tone: StatsTone; history: number[]; label: string }
export interface StatsProcessRow {
  id: string; name: string; kind: 'app' | 'session' | 'process';
  cpuPercent: number; rssBytes: number; gpuPercent: number | null; children: StatsProcessRow[];
}
export interface StatsSnapshot {
  takenAt: number;
  cpu: StatsMeter; gpu: StatsMeter; ram: StatsMeter; network: StatsMeter; disk: StatsMeter;
  memoryNote: string;
  rows: StatsProcessRow[];
  error: string | null;      // the last sample's rejection text; null after a good sample
}
export const systemStatsSnapshotSlot: SlotKey<StatsSnapshot | null, 'main', 'system-stats'>
  = { id: 'system-stats.snapshot', process: 'main', kind: 'value' };
export type StatsFixtureVariant = 'busy' | 'error';
export interface SystemStatsChannel extends ChannelShape {
  invoke: { setShown(shown: boolean): void };
  messages: { seeded: StatsFixtureVariant };  // sent after a seed writes the slot
}
```

`src/plugins/system-stats/manifest.ts`:
`export const systemStatsManifest = definePlugin({ id: 'system-stats', … })` with:
- `label: 'System stats'`, `description: 'Shows CPU, GPU, RAM, network and disk use, and what uses them, in the right bar.'`
- `dependsOn: { main: [], page: [] }`, `reads: { main: ['chat', 'sessions'], page: [] }`
- commands, each `runsIn: 'page'`:

  | name | label | group |
  |---|---|---|
  | `togglePanel` | `hide or show system stats` | `view` |
  | `cursorDown` | `next process` | `panel` |
  | `cursorUp` | `previous process` | `panel` |
  | `cursorTop` | `first process` | `panel` |
  | `cursorBottom` | `last process` | `panel` |
  | `cycleSort` | `sort by the next column` | `panel` |
  | `openGroup` | `open the group` | `panel` |
  | `closeGroup` | `close the group` | `panel` |

- `scopes: { panel: 'In the system stats panel' }`
- `settings: { refreshSeconds: 2, processRows: 10, layout: 'default' }`
- `settingInfo`:
  - `refreshSeconds`: label `System stats refresh`, description `How often the panel reads the machine while it shows, in seconds; at least 1. A change moves the next read.`
  - `processRows`: label `Process rows`, description `How many rows the process list shows with its groups closed.`
  - `layout`: label `System stats layout`, description `The layout that draws the system stats panel: a folder in the layouts/system-stats folder, or default.`
- `themeTokens: { 'column-width': { kind: 'length', default: '56px' } }` — the width of each number column in
  the process list, read by 06's `layout.css` as `var(--wg-system-stats-column-width)` (raw lengths fail
  `check-styles`; docs' `aside-width` is the precedent)

`src/plugins/system-stats/main/snapshot.ts`:

```ts
export const MIN_REFRESH_SECONDS = 1;
export const HISTORY_SECONDS = 60;
export const RATE_FLOOR_BYTES = 1_000_000;          // 1 MB/s: the least full scale of the network and disk meters
export const RATE_CEILING_BYTES = 10_000_000_000;   // 10 GB/s: a tick above it is a device appearing, read as 0
export interface SessionProcess { sessionId: string; pid: number; title: string }
export interface ProcessRate { pid: number; ppid: number; name: string; path: string;
  cpuPercent: number; rssBytes: number; gpuPercent: number | null }
// Raw history, oldest first; `networkRate` and `diskRate` in bytes per second.
export interface StatsHistory { capacity: number; cpu: number[]; gpu: number[]; ram: number[];
  networkRate: number[]; diskRate: number[] }
export function historyCapacity(refreshSeconds: number): number;
export function emptyHistory(capacity: number): StatsHistory;
export function toneOf(percent: number | null): StatsTone;
export function ramToneOf(percent: number | null, pressure: MemoryPressure | null): StatsTone;
export function formatRate(bytesPerSecond: number): string;
export function processRates(prev: readonly ProcessSample[], next: readonly ProcessSample[],
  elapsedMs: number, cores: number): ProcessRate[];
export function buildSnapshot(prev: SystemSample, next: SystemSample, elapsedMs: number,
  sessions: readonly SessionProcess[], history: StatsHistory, takenAt: number):
  { snapshot: StatsSnapshot; history: StatsHistory };
export function errorSnapshot(last: StatsSnapshot | null, takenAt: number, error: string): StatsSnapshot;
```

`src/plugins/system-stats/main/grouping.ts`:

```ts
export function appKeyOf(process: Pick<ProcessSample, 'name' | 'path'>): { id: string; name: string };
export function groupProcesses(processes: readonly ProcessRate[],
  sessions: readonly SessionProcess[]): StatsProcessRow[];
export function sessionProcesses(chat: Iterable<ChatSessionInfo>,
  rows: ReadonlyMap<string, SessionRow>): SessionProcess[];
```

`src/plugins/system-stats/main/poller.ts`:

```ts
export const FIRST_GAP_MS = 1000;
export interface StatsPollerDeps {
  timers: Timers; clock: Clock;
  sample(): Promise<SystemSample>;
  refreshSeconds(): number;
  sampled(sample: SystemSample, at: number): void;
  failed(error: unknown): void;
}
export interface StatsPoller { setShown(shown: boolean): void; reschedule(): void; dispose(): void }
export function createStatsPoller(deps: StatsPollerDeps): StatsPoller;
```

`src/plugins/system-stats/main/stats-fixture.ts`:
`export const STATS_FIXTURE_VARIANTS: readonly StatsFixtureVariant[] = ['busy', 'error'];`
`export function statsFixture(variant: StatsFixtureVariant, now: number): StatsSnapshot;`

`src/plugins/system-stats/main/drive-actions.ts`:
`export interface StatsDriveDeps { clock: Clock; snapshot(): StatsSnapshot | null; seed(variant: StatsFixtureVariant): StatsSnapshot }`
`export function addDriveActions(drive: DriveHost, deps: StatsDriveDeps): void;` — adds `seed` and `snapshot`.

`src/plugins/system-stats/main/start.ts`:
`export const systemStatsMainPart: MainPart<typeof systemStatsManifest>`, returning `{ commands: {}, dispose }`. It
registers the layouts (`api.layouts.register({ layoutTypes })`, `layoutTypes` from `../layouts/layout.d.ts?raw`),
publishes the slot, handles `setShown`, follows `onSettingsChanged` with `poller.reschedule()`, and adds the drive
actions when `api.drive` is not null. The seed is a closure in `start` (as usage's `seed`); 06 hands it to the
self-test script.

Decisions:
- The plugin never names an OS (plan.md Boundary rules). The `.app` rule reads the path only, so it holds on every OS.
- `StatsTone` replaces plan.md's `tone: MeterTone` in `StatsMeter`: AGENTS.md (`npm run lint`) makes each plugin
  `contract.ts` a layer of its own with `src/contracts` and the contracts it reads, and `MeterTone` lives in
  `src/shared/page/layout-host/kit.d.ts` and `src/shared/page/ui/meter.ts`. 06's layout contract types its input as
  `MeterTone`, and `StatsTone` is assignable to it.
- `StatsSnapshot.error` is added (decided here): a rejected sample must reach the panel. On a rejection main writes
  `errorSnapshot(last, now, errorText(error))`: the last snapshot's meters, note and rows, with `error` set. With no
  last snapshot it writes every meter as `{ percent: null, tone: 'normal', history: [], label: '—' }`,
  `memoryNote: ''`, `rows: []`. The next good snapshot has `error: null`.
- Main logs `sample failed: <text>` once per distinct text; a good sample clears the remembered text, so the same
  failure after a good sample logs again.
- `setShown`: main keeps one `shown` boolean, and the last report wins. A channel handler gets no page identity, so
  "any page" in plan.md is not trackable; the app has one page, and a reload reports again at its start.
- On `setShown(true)` from hidden, main logs `sampling started`; on `setShown(false)` from shown, `sampling stopped`.
  A repeated report of the same value does nothing and logs nothing.
- **Poller timing:** `setShown(true)` takes a sample at once, the second `FIRST_GAP_MS` (1000) after the first
  settles, and each later one `intervalMs` after the last settles, where `intervalMs = max(refreshSeconds(),
  MIN_REFRESH_SECONDS) * 1000` and a non-finite `refreshSeconds()` (a hand-edited setting) counts as the default 2.
  The next timer is armed only when the current sample settles, so two samples never overlap. It is armed before
  `sampled` or `failed` is called, and a throw from either is caught and logged as `sample handling failed: <text>`,
  so one bad snapshot never stops polling. `setShown(true)` while shown does nothing. `setShown(false)` clears the
  timer and drops the result of a sample in flight (a generation counter); a `setShown(true)` while that dropped
  sample still runs waits for it to settle, then samples at once, so the overlap rule holds there too. `dispose`
  clears the timer and drops the in-flight result, and a later `setShown` does nothing. `reschedule` (on
  `onSettingsChanged`) re-arms a waiting interval timer with the new interval from now; it does nothing while
  hidden, while a sample is in flight, or while the first-gap timer waits (that gap gets the panel its first
  numbers fast). After a rejection with no `prev` yet, the next wait is `FIRST_GAP_MS`.
- **First sample:** main keeps the last good sample as `prev`. A sample with no `prev` publishes nothing, except
  when the slot holds an error: then it writes the slot's snapshot again with `error: null`, so a good reading clears
  the error at once. On `setShown(true)` from hidden, main writes `null` to the slot (unless a seed stopped sampling: a
  seeded run keeps its fixture), so every show draws the page's reading line for about 1 s, never minutes-old
  numbers or a stale error. History stays in main and returns with the next snapshot. `setShown(false)` drops `prev`, so a later show starts from a fresh first
  sample; the history ring and the slot's last value stay.
- **Elapsed time** is `at` of this sample minus `at` of `prev`, where the poller reads `at` from
  `services.clock.now()` when it calls `sample()`, not when it settles: the counters are read at the start of the
  run, and the run's latency varies. `elapsedMs <= 0` (the wall clock set back) publishes nothing for that sample
  and keeps `prev`. A system sleep between two samples reads low CPU for one sample; that is accepted.
- **Start:** main writes `null` to the slot at start. On `seed`, it disposes the poller for the run (as usage's
  seed), writes `statsFixture(variant, clock.now())`, sends `seeded` with the variant and logs `seeded <variant>`;
  a later `setShown` then logs `sampling stopped by a seed` once and samples nothing.
- **CPU meter:** `percent = (next.cpuBusyMs − prev.cpuBusyMs) / (next.cpuTotalMs − prev.cpuTotalMs) × 100`; a total
  difference of 0 or less gives 0.
- **Process CPU** (share of the whole machine): `(next.cpuTimeMs − prev.cpuTimeMs) / (elapsedMs × cores) × 100`.
- **Process GPU:** `(next.gpuTimeNs − prev.gpuTimeNs) / (elapsedMs × 1_000_000) × 100`; null when the next
  `gpuTimeNs` is null; 0 when the next is a number and the `prev` one is null (one failed AGX read must not show a
  process's lifetime GPU time as a spike).
- **Matching across samples:** a process matches its `prev` entry by `pid` with the same `name`. A process with no
  match (new, or a pid reused under another name) or with a negative difference reads 0 for that sample (GPU 0 when
  its next `gpuTimeNs` is not null). This stops a new process from showing its whole lifetime as one spike.
- Every percent in a meter, a row and a history entry is clamped to 0–100, and a non-finite result (`NaN`, from a
  zero total or a bad reading) counts as 0.
- **GPU meter:** `percent = next.gpuPercent`; null stays null.
- **RAM meter:** `percent = usedBytes / totalBytes × 100`; label `<used> / <total> GB`: used in GiB (bytes / 2^30)
  with one decimal, total in GiB rounded to a whole number (`21.4 / 32 GB`).
- **Memory note:** `pressure <level> · swap <n> GB`, or `swap <n> GB` when `pressure` is null; swap in GiB with one
  decimal (`pressure warning · swap 1.2 GB`, `swap 0.0 GB`).
- **CPU and GPU labels:** the percent rounded to a whole number, then `%` (`38%`); `—` (U+2014) when null.
- **Network and disk:** rate = (sum of the two counters' differences) / elapsed seconds; a negative difference counts
  0, and a rate above `RATE_CEILING_BYTES` counts 0: the counters sum every interface and disk, so a device that
  appears (a dock's `en7`, an external disk) adds its lifetime bytes in one tick, and that spike would set the full
  scale for a minute. A device that leaves while another grows reads low for one tick; that is accepted. The ring keeps the raw rates. Full scale = max(highest rate in the ring, `RATE_FLOOR_BYTES`). `percent` = this
  rate / full scale × 100, and `history` is every ring rate / the same full scale × 100, rescaled at each snapshot,
  so the line keeps its shape when the scale moves. Labels: network `<received> ↓ <sent> ↑`, disk
  `<read> r <written> w`, each part through `formatRate`. The tone of both is always `normal`: the scale is relative,
  so a tone would mean nothing.
- **`formatRate`:** below 1000 B/s a whole number then ` B/s`; else divide by 1000 to `KB/s`, `MB/s` or `GB/s` (the
  largest unit with a value of at least 1); one decimal below 10, a whole number from 10 (`512 B/s`, `1.2 KB/s`,
  `80 KB/s`, `12 MB/s`).
- **Tones** (CPU, GPU): `critical` from 90, `warning` from 70, else `normal`; null is `normal`.
- **RAM tone** (`ramToneOf`): the memory pressure when the sample has one (`normal`, `warning`, `critical` map to
  the same tones), else `toneOf(percent)`. macOS counts compressed and wired memory as used, so a healthy Mac reads
  75–90 % used at normal pressure, and a percent tone would sit at warning or critical; Activity Monitor colours its
  memory graph by pressure for the same reason. Windows has no pressure, and its "In use" percent leaves the cache
  out, so the percent tone fits there.
- **History:** `historyCapacity(refreshSeconds) = max(2, round(HISTORY_SECONDS / max(refreshSeconds, MIN_REFRESH_SECONDS)))`
  (30 at the default 2). Each snapshot appends the reading and drops the oldest past `capacity`. A null reading
  (GPU) appends nothing. Main builds the next `history` with the capacity read from `refreshSeconds` now, so a
  setting change trims or grows at the next append.
- **Grouping**, in this order:
  1. Session trees. A process belongs to a session when its own pid or an ancestor's pid (walking `ppid`, stopping at a
     pid not in the sample or after as many steps as the sample has processes) is a session's `pid`; the nearest such
     ancestor wins. A pid held by two sessions (only the fake harness repeats one: every fake session reports
     `FAKE_AGENT_PID`) goes to the first in `sessionProcesses`' order; the later session gets no row. Each session
     with at least one process gives one row: `kind: 'session'`,
     `id: 'session:<sessionId>'`, `name: 'claude · <title>'`, its processes as children.
  2. Every other process goes by `appKeyOf`: the path's outermost segment ending in `.app` (segments split on `/` and
     `\`) gives `{ id: 'app:<segment>', name: <segment without .app> }`; with no such segment, `{ id: 'app:<name>',
     name: <name> }`. A key with two or more processes gives one row: `kind: 'app'`, its processes as children. A key
     with one process gives a lone row.
  3. A process row is `kind: 'process'`, `id: 'pid:<pid>'`, `name` the process's `name`, `children: []`.
  4. Order: session rows first, in `sessionProcesses` order; then app and lone process rows by their first
     process's position in the sample; each group's children in sample order. 06's sort is stable, so ties keep
     this order from one sample to the next.
  5. A group row sums its children's `cpuPercent` and `rssBytes`; its `gpuPercent` sums the children's non-null values
     and is null when every child's is null.
- **`sessionProcesses`:** one entry per `chat.session` value whose `pid` is not null and whose `sessionId` has a row
  in `sessions.rows`. `title` = `editableTitle(row.titles)`, or `row.label` when that is empty. Sessions without a pid
  or a row stay out, so their processes stay ordinary rows.
- `start.ts` reads `chatSessionSlot` and `sessionsRowsSlot` through `api.state.read`, at each sample (no follow).
- **Fixture `busy`** (`statsFixture`, used by 06's self-test steps; the values are the steps' expected lines):
  meters CPU 44 (`44%`, normal; the rows' CPU adds up to it), GPU 74 (`74%`, warning), RAM 67 (`21.4 / 32 GB`, normal), network 40
  (`1.2 MB/s ↓ 80 KB/s ↑`), disk 15 (`3.4 MB/s r 1.0 MB/s w`); each history 30 values rising evenly from 0 to the
  meter's percent; `memoryNote: 'pressure normal · swap 1.2 GB'`; `error: null`; rows (MiB = 1_048_576 bytes):

  | id | name | kind | CPU | RAM MiB | GPU | children |
  |---|---|---|---|---|---|---|
  | `app:Google Chrome.app` | `Google Chrome` | app | 22.5 | 1800 | 6 | `pid:501` `Google Chrome` 4.0 / 600 / 1; `pid:502` `Google Chrome Helper (Renderer)` 18.5 / 1200 / 5 |
  | `session:selftest-session` | `claude · fix login` | session | 9 | 700 | null | `pid:610` `claude` 6 / 500 / null; `pid:611` `zsh` 3 / 200 / null |
  | `pid:120` | `WindowServer` | process | 12 | 300 | 31 | none |
  | `pid:300` | `Finder` | process | 0.5 | 2600 | 0 | none |

  Fixture `error`: `busy` with `error: 'ps exited with code 1'`.
- **Drive actions:** `system-stats.seed` — description `Replaces the snapshot with a fixed one and stops sampling for the run: busy, or error (busy with a sample error).`, args `{ "variant"?: "busy" | "error" }`, default `busy`, returns the seeded snapshot. `system-stats.snapshot` — description `Returns the snapshot the page draws, null before the first.`, args `{}`.

GIVEN two samples 2000 ms apart on 8 cores WHEN a process's CPU time grew 4000 ms THEN its `cpuPercent` is 25
GIVEN a process absent from `prev` WHEN the snapshot builds THEN it reads 0 CPU, not its whole lifetime
GIVEN a session whose `claude` pid has a child shell and a grandchild test run WHEN grouping runs THEN all three sit
  in one `claude · <title>` row and none sits in an app group
GIVEN the panel hidden WHEN `setShown(false)` arrives THEN no timer is pending and a sample in flight writes nothing
GIVEN the adapter rejects twice with the same text WHEN both settle THEN the slot holds `error` set and the log holds
  one `sample failed: <text>`

Tests (named tables with literal rows, general values per `wigley:writing-tests` § One test per behaviour; every row
uses cores ≠ 1, elapsed ≠ 1000, and no two equal inputs unless the row is about that):
- `snapshot.test.ts`
  - `processRates_SharesTheMachine` — rows: matched pid (`cpuTimeMs` 10_000 → 14_000, elapsed 2000, cores 8 → 25);
    new pid (→ 0); same pid, other name (→ 0); CPU time went down (→ 0); GPU 2e9 → 2.5e9 ns over 2000 ms (→ 25);
    next `gpuTimeNs` null (→ null); `prev` `gpuTimeNs` null, next 2.5e9 (→ 0); share past 100 clamps to 100.
  - `buildSnapshot_Meters` — rows: CPU busy/total differences (3000 / 8000 → 37.5, label `38%`, normal); RAM
    (`usedBytes` 22_978_666_496 of 34_359_738_368 → label `21.4 / 32 GB`, tone normal at 66.9); GPU 92 → critical,
    label `92%`; GPU null → percent null, label `—`, history unchanged; total difference 0 → CPU 0; `totalBytes` 0 →
    RAM 0 (not `NaN`); RAM tone: 89 % at pressure `normal` → normal, 40 % at pressure `critical` → critical, 75 % at
    pressure null → warning. (The elapsed-0 skip is start.ts's, tested there.)
  - `toneOf_Thresholds` — 69.9 normal, 70 warning, 89.9 warning, 90 critical, null normal.
  - `formatRate_Units` — 0 → `0 B/s`, 512 → `512 B/s`, 1234 → `1.2 KB/s`, 80_400 → `80 KB/s`, 12_345_678 → `12 MB/s`,
    2_500_000_000 → `2.5 GB/s`.
  - `networkScale_HighestInWindowWithFloor` — ring rates [200_000, 400_000] → full scale 1_000_000, percent 40,
    history [20, 40]; ring [3_000_000, 1_500_000] → percent 50, history [100, 50]; a negative counter difference →
    rate 0; a counter jump of 1e12 bytes over 2000 ms → rate 0.
  - `history_RingAndCapacity` — `historyCapacity` 2 → 30, 1 → 60, 7 → 9, 0.5 → 60, 120 → 2; an append at capacity 3
    to [5, 6, 7] gives [6, 7, 8].
  - `memoryNote_PressureAndSwap` — pressure `warning`, swap 1_288_490_189 → `pressure warning · swap 1.2 GB`;
    pressure null, swap 0 → `swap 0.0 GB`.
  - `errorSnapshot_KeepsLastOrEmpties` — with a last snapshot: meters, note and rows equal the last's, `error` set;
    with none: each meter `percent` null and label `—`, `rows` [].
- `grouping.test.ts`
  - `appKeyOf_BundleOrName` — `/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)`
    → `app:Google Chrome.app` / `Google Chrome`; `/usr/bin/zsh` → `app:zsh` / `zsh`; `C:\Program Files\Code\Code.exe`
    with name `Code.exe` → `app:Code.exe` / `Code.exe`; empty path, name `kernel_task` → `app:kernel_task`.
  - `groupProcesses_Tree` — one whole `toEqual` over built processes: two Chrome processes (one group, sums), one
    lone `Finder`, a session `claude` (pid 610) with child `zsh` (611) and grandchild `node` (612, path inside
    `Visual Studio Code.app`), a second session nested under 612 (its processes go to the nearer session), and a
    group whose children's GPU is all null (group GPU null) beside one with one null (sum of the others), and a
    third session entry holding pid 610 again after the first (no row of its own). The expected array pins the
    row and child order.
  - `sessionProcesses_JoinsRowsAndTitles` — rows: pid and user title → that title; titles all null → `row.label`;
    pid null → left out; no row → left out.
- `poller.test.ts` (recording fake `Timers` and a settable clock, as `usage/main/plan-poller.test.ts`)
  - `setShown_SamplesAtOnceThenFirstGapThenInterval` — sample at 0, then 1000 ms after it settles, then
    `refreshSeconds × 1000` after each settle; `refreshSeconds` 0.2 uses 1000 ms; `NaN` uses 2000 ms.
  - `setShown_True_WhileShownDoesNothing` — a second `setShown(true)` calls `sample` no more and arms nothing.
  - `showDuringDroppedSample_WaitsThenSamples` — hide while a sample is pending, show again: no second `sample`
    until the first settles, then one at once.
  - `throwingHandler_KeepsPolling` — `sampled` throws: the next timer is still armed.
  - `setShown_False_ClearsTimerAndDropsInFlight` — hidden while a sample is pending: no timer left, and its late
    result calls neither `sampled` nor `failed`.
  - `rejectedSample_ReportsAndKeepsSampling` — `failed` gets the error and the next timer is armed.
  - `reschedule_MovesTheWaitingTimer` — rows: an interval wait re-arms with the new `refreshSeconds` from now; the
    first-gap wait stays at its due time.
- `start.test.ts` (`startMainPart` with `services.systemStats` replaced by a stub whose `sample` returns a queue of
  built samples; no `fakeDependency`, since the plugin only reads)
  - `stop_LeavesNoLiveRegistration`, as unity-pool's.
  - `setShown_PublishesFromTheSecondSample` — after `invoke('setShown', true)` the slot stays null after the first
    sample and holds a snapshot with the stub's rows after `advance(1000)`.
  - `rejectedSample_PublishesErrorAndLogsOnce` — two rejections with one text: slot `error` is that text, and
    `logs` holds `sample failed: <text>` once.
  - `goodSampleBetween_LogsTheSameFailureAgain` — reject, good, good, reject with one text: `logs` holds the line
    twice.
  - `rejectThenGood_ClearsTheError` — reject, then a good first sample: the slot's `error` is null at once.
  - `hideThenShow_StartsFromAFreshFirstSample` — after hide and show the slot is null at once, stays null after the
    first sample, and holds a snapshot after the second; after a seed, hide and show keep the fixture.
  - `elapsedZero_PublishesNothing` — two samples whose `at` is equal: the slot is unchanged and `prev` is kept.
  - `settingsChange_RearmsTheWaitingTimer` — a settings change during an interval wait moves the pending timer.
  - `setShownTwice_LogsStartedOnce`.
  - `seed_WritesFixtureAndStopsSampling` — through the drive action `seed` (`drive: true`): the slot equals
    `statsFixture('busy', now)`, `sent` holds `seeded` `busy`, and a later `setShown(true)` calls `sample` no more and logs `sampling stopped by a seed` once over two calls.

Done when: `npm run typecheck` passes; `npm run lint` passes (the three plugin lists,
the layer rules); the Vitest files above pass. The self-test and drive checks wait for 06 and for
"08 — Final verification": main has no page to draw for it yet.

Commit: one commit for the group: `system-stats main: sample while shown, fold samples into the snapshot slot`.

## Proof
