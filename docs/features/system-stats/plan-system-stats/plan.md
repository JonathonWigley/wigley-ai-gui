# System stats panel — plan

Feature: system-stats · Implements: none · Ticket: none
Target: main (built on branch `system-stats`, worktree `../.worktrees/wigley-ai-gui-system-stats`) · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

A right-bar panel in wigley-ai-gui showing CPU, GPU, RAM, network and disk use, each with a 60 s
sparkline, over one process list grouped by app and by Chat session, sortable by CPU, RAM or GPU.
The panel is read-only, shown by default, and toggled with `Space v y`.

## Architecture

- **Core** — a new `SystemStats` contract (`src/contracts/system-stats.ts`), with macOS and Windows
  adapters in `src/main/system-stats/`, picked in `src/main/main.ts` and handed to main plugins as
  `services.systemStats`. A fake adapter serves the self-test and tests.
- **Session host → harness → chat** — the session host reports each hosted process's OS pid. The
  protocol goes to 3, `HostedProcess` exposes the pid, the Claude adapter passes it up, and chat
  publishes `pid` on `ChatSessionInfo`.
- **Shared UI** — a new Sparkline primitive in `src/shared/page/ui/`, `kit.sparkline` in BaseKit,
  and a gallery entry.
- **Plugin `system-stats`** — main samples while the panel shows, folds two samples into a snapshot
  (pure module) and publishes the `system-stats.snapshot` slot. Page contributes the right-bar
  panel, drawn through its layout contract and `default` layout.

## Preconditions

- `git -C /Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui rev-parse main` equals `origin/main` after `git fetch` (checked 2026-11-09: `system-stats` rebased onto `origin/main` at `2c2f6bb5`; that range added `limitRuns` in `src/main/processes/limited-processes.ts` and git's capped runner in main.ts, which no task conflicts with).
- `ioreg -r -d 1 -w 0 -c AGXDeviceUserClient | grep -c accumulatedGPUTime` > 0 on this Mac (checked: per-client `AppUsage` with `accumulatedGPUTime`, `IOUserClientCreator = "pid N, name"`).
- `ioreg -r -d 1 -c IOAccelerator | grep -c '"Device Utilization %"'` > 0 (checked: 23).
- `ioreg -r -d 1 -w 0 -c IOBlockStorageDriver | grep -c 'Bytes (Read)'` > 0 (checked).
- `netstat -ibn | grep -cE '^en[0-9]+ .*<Link#'` > 0 (checked).
- `sysctl -n kern.memorystatus_vm_pressure_level` prints a number (checked: 2).
- `grep -n "SESSION_HOST_PROTOCOL = 2" src/contracts/session-host-protocol.ts` matches (checked).
- `grep -n "systeminformation\|pidusage" package.json` matches nothing (checked: no stats package; none is added).

## Docs written ahead

Committed on `system-stats` in one commit (sha in the docs-ahead commit, `git log --oneline -- docs/features/system-stats/design.md`):

- `docs/features/system-stats/design.md` — the whole design; every task reads it.
- `AGENTS.md` — plugin entry, `src/main/system-stats/` layer line, `systemStats` ambient service, self-test script list.
- `DESIGN.md` — the Sparkline primitive and the System stats panel section.
- `docs/keymap.md`, `docs/features/session-host/design.md`, `docs/features/layouts/design.md` — the binds, the pid in the protocol, the layout owner.
- `.agents/skills/drive/SKILL.md` — `start --system-stats live` (`368e02c0`, with the RAM tone lines in design.md and DESIGN.md and AGENTS.md's kit list; `ea65e439` holds the measured commands in design.md).

## Mandatory Reads

- `AGENTS.md` (repo root) through its last line, or the sections each task names.
- `DESIGN.md` for every page and layout task.
- `docs/keymap.md` for task 06.
- `docs/features/system-stats/design.md` for every task.
- `docs/features/session-host/design.md` for task 03.

## Design Overview

```
                ┌──────────── main process ─────────────────────────────────────┐
 OS commands ─▶ │ SystemStats adapter (mac | windows)  ── sample() ─▶ SystemSample │
 (ps, ioreg,    │                                                     │          │
  vm_stat,…)    │ session host ── spawned/subscribe pid ─▶ HostedProcess.pid      │
                │      └─▶ Claude adapter ─▶ chat main ─▶ chat.session[id].pid    │
                │                                                     │          │
                │ system-stats main: poll every refreshSeconds while  ▼          │
                │   a page shows the panel; buildSnapshot(prev, next, elapsedMs, │
                │   sessions, history) ─▶ system-stats.snapshot slot             │
                └──────────────────────────────────────────────────┬────────────┘
                                                                   ▼
                ┌──────────── page ─────────────────────────────────────────────┐
                │ system-stats page: rightBar.contribute(panel, {order, focus,   │
                │   left}); channel setShown(bool); uiState 'hidden'; cursor,    │
                │   sort, open groups ─▶ layout `default`: meters + kit.sparkline│
                │   + process rows                                               │
                └───────────────────────────────────────────────────────────────┘
```

Decisions (all settled in the interview or as Decided notices):

- OS's own commands, no npm package. Per-process GPU from `AGXDeviceUserClient` on Apple Silicon, from GPU Engine counters on Windows; null (a dash) elsewhere.
- Stats: CPU, GPU, RAM (with memory pressure and swap on a line under it), network and disk throughput (machine totals only).
- One process list with CPU, RAM and GPU columns, sort cycled by `s`. CPU per process is a share of the whole machine, from CPU-time differences, never `ps %cpu`.
- Processes grouped by `.app` bundle (macOS) or executable name (Windows), and Chat sessions' process trees grouped under `claude · <title>`. A group opens to show its processes.
- Read-only: no quit or kill.
- Settings `system-stats.refreshSeconds` (default 2) and `system-stats.processRows` (default 10).
- Sparkline of the last 60 s per meter, kept in main and published in the slot.
- Shown by default. The `hidden` flag is kept in page `uiState`, and `Space v y` toggles it. Main samples only while a page reports the panel shown.
- Meter tones: `warning` from 70%, `critical` from 90%.
- Keys: `<Leader>vy` toggles (scope `any`). In scope `system-stats.panel`: `j`, `k`, `gg`, `G` move the cursor, `s` sorts, `<CR>` and `l` open a group, `h` closes it.
- The session host reports pids (protocol 3). Chat publishes `pid`. Sessions outside the app stay ordinary rows.

Out of scope: per-process network and disk, temperatures and fans, quitting processes, Linux adapters, history across app restarts.

## File Structure

Shared names every part uses (task documents consume these word for word):

```ts
// src/contracts/system-stats.ts  (task 01)
export interface ProcessSample {
  pid: number;
  ppid: number;
  name: string;            // the executable's name, as shown in a row
  path: string;            // full executable path ('' when the OS gives none)
  cpuTimeMs: number;       // cumulative CPU time
  rssBytes: number;
  gpuTimeNs: number | null; // cumulative GPU time; null where the OS has no per-process GPU
}
export type MemoryPressure = 'normal' | 'warning' | 'critical';
export interface SystemSample {
  cores: number;
  cpuBusyMs: number;       // cumulative, all cores (os.cpus() user+nice+sys+irq)
  cpuTotalMs: number;      // cumulative, all cores, idle included
  memory: { totalBytes: number; usedBytes: number; swapUsedBytes: number; pressure: MemoryPressure | null };
  gpuPercent: number | null; // instantaneous device utilisation; null when unreadable
  network: { receivedBytes: number; sentBytes: number }; // cumulative, physical interfaces
  disk: { readBytes: number; writtenBytes: number };     // cumulative
  processes: ProcessSample[];
}
export interface SystemStats {
  // One reading of the machine. Rejects when a required command fails; a reading the OS
  // lacks is null in its field instead.
  sample(): Promise<SystemSample>;
}

// src/contracts/session-host.ts  (task 03): HostedProcess gains
//   readonly pid: number | null;   // the OS pid once the host reports it; null before and after the process runs
// src/contracts/agent.ts (task 03): AgentProcessEvents gains
//   pid(pid: number): void;        // the harness reports the agent process's OS pid once known
// src/shared/fake-agent-harness.ts (task 03): export const FAKE_AGENT_PID = 4242;
//   the fake harness reports this pid. The fake SystemStats (01) holds a `claude` process at
//   FAKE_SESSION_PID (4242) with a child, so a fake Chat session forms its own group in self-test
//   and drive. 01 and 03 share wave 1, so each declares its own; task 05 (after both) deletes
//   FAKE_SESSION_PID and points fake-system-stats.ts at FAKE_AGENT_PID, leaving one constant.
// src/plugins/chat/contract.ts (task 03): ChatSessionInfo gains
//   pid: number | null;            // the session's agent process pid while `running`; null otherwise

// src/shared/page/layout-host/kit.d.ts (task 04): BaseKit gains
//   sparkline(parent: HTMLElement, values: readonly number[], tone: MeterTone): HTMLElement;
//   // values 0–100, oldest first; redraw by calling again in a fresh parent part

// src/plugins/system-stats/contract.ts (task 05)
export type StatsSortColumn = 'cpu' | 'ram' | 'gpu';
export type StatsTone = 'normal' | 'warning' | 'critical'; // MeterTone's values: a plugin contract cannot import kit.d.ts
export interface StatsMeter {
  percent: number | null;    // 0–100; null when unreadable
  tone: StatsTone;
  history: number[];         // last 60 s of percent, oldest first
  label: string;             // the value text, e.g. '38%', '21.4 / 32 GB', '1.2 MB/s ↓ 80 KB/s ↑'
}
export interface StatsProcessRow {
  id: string;                // stable across samples: 'app:<bundle or exe>', 'session:<sessionId>', 'pid:<pid>'
  name: string;              // app name, 'claude · <session title>', or process name
  kind: 'app' | 'session' | 'process';
  cpuPercent: number;        // share of the whole machine
  rssBytes: number;
  gpuPercent: number | null;
  children: StatsProcessRow[]; // the group's processes, [] for a lone process
}
export interface StatsSnapshot {
  takenAt: number;           // epoch ms
  cpu: StatsMeter; gpu: StatsMeter; ram: StatsMeter; network: StatsMeter; disk: StatsMeter;
  memoryNote: string;        // the line under RAM: pressure and swap used
  rows: StatsProcessRow[];   // every group and lone process, unsorted; the page sorts and cuts
  error: string | null;      // the last sample()'s rejection message; null after a good sample
}
export type StatsFixtureVariant = 'busy' | 'error'; // the drive and self-test seed
// slot `system-stats.snapshot` (`systemStatsSnapshotSlot`): SlotKey<StatsSnapshot | null, 'main', 'system-stats'>
// channel `SystemStatsChannel`: invoke page → main `setShown(shown: boolean)` (the last report wins: a
//   handler gets no page identity); message main → page `seeded: StatsFixtureVariant`, after a seed
```

`network` and `disk` meters scale against the highest rate seen in the 60 s window, with a 1 MB/s floor, so a sparkline shows shape. Their `percent` is that scaled value, and their `label` gives the real rates.

**Existing files modified**

- `src/contracts/plugin.ts` — `MainServices.systemStats` (01)
- `src/main/main.ts` — picks the SystemStats adapter by OS (01 mac + fallback, 02 windows)
- `src/main/main.ts` `ModeServices.forWindow` — `systemStats` built lazily per mode: the OS adapter live and under `drive start --system-stats live`, the fake under self-test and other drive runs (01)
- `src/main/run-mode.ts`, `scripts/drive-args.mts`, `scripts/drive.mts` — the drive's `--system-stats fake|live` flag, kept by `restart` (01)
- `src/session-host/host-children.test.ts` — follows `fakeChild`'s new pid (03)
- `src/shared/fake-system-stats.ts` — `FAKE_SESSION_PID` replaced by an import of `FAKE_AGENT_PID` (05)
- `src/main/processes/node-processes.ts` — `windowsHide: true`, so a PowerShell sample flashes no console (02)
- `src/shared/plugin-part-harness.test-support.ts` — `systemStats: notFaked(...)` (01)
- `src/shared/page/test-dom.ts` — the fake `document` gains `createElementNS` (04)
- `scripts/check-layers.mts` — `CORE_LAYERS` entry for `src/main/system-stats` (01)
- `src/contracts/session-host-protocol.ts`, `src/contracts/session-host.ts`, `src/session-host/*`, `src/main/session-host/*` — pid over the wire (03)
- `src/contracts/agent.ts`, `src/main/claude-code/claude-code-harness.ts`, `src/shared/fake-agent-harness*` — process pid passed up (03)
- `src/plugins/chat/contract.ts`, `src/plugins/chat/main/*` (`preview/chat-preview.ts` included), the chat page and layout tests, `src/plugins/auto-retro/main/{retro-done,start}.test.ts` — `ChatSessionInfo.pid` and the literals that build one (03)
- `src/shared/page/layout-host/kit.d.ts`, `base-kit.ts`, gallery plugin page — `sparkline` (04)
- `src/plugins/manifests.ts`, `src/plugins/main.ts`, `src/plugins/page.ts` — list the new plugin (05 manifests + main, 06 page)
- `src/plugins/keymap.ts` — the binds (06)

**New files**

- `src/contracts/system-stats.ts` — the seam (01)
- `src/main/system-stats/{mac-system-stats.ts, mac-parsers.ts, windows-system-stats.ts, windows-parsers.ts}` with tests over captured output (01, 02); `cpu-totals.ts` — `os.cpus()` times to totals, shared by both adapters (01); `unavailable-system-stats.ts` — the adapter for an OS with none, whose `sample()` rejects (01); `src/shared/fake-system-stats.ts` — the fake for drive runs and plugin tests (the self-test seeds a fixed snapshot instead), holding a `claude` process at `FAKE_SESSION_PID` (4242) with a child (01)
- `src/shared/page/ui/sparkline.ts` + `sparkline.css` (04)
- `src/plugins/system-stats/{manifest.ts, contract.ts}`, `main/{start.ts, snapshot.ts, grouping.ts, poller.ts, stats-fixture.ts, drive-actions.ts}`, tests beside them, and a stub `layouts/layout.d.ts` main's `?raw` import needs (05). The manifest also holds the setting `layout: 'default'` and the theme token `column-width` (check-styles rejects raw lengths)
- `src/plugins/system-stats/main/selftest-script.ts` (06: its steps need the page part), `page/{start.ts, stats-view-model.ts, layout/read-system-stats-layout.ts}`, `layouts/{layout.d.ts filled, default/layout.js, default/layout.css}` (06)

**Boundary rules**

- Only `src/main/system-stats/` runs OS commands for stats, through `ProcessRunner`, and imports `node:os`. The plugin never names an OS.
- The plugin reads `chat.session` and `sessions.rows` as `reads`, never `dependsOn`.
- Rates, grouping and history are pure functions in the plugin's `main/`, tested without timers or processes.
- A rate from a counter that went down (a GPU client closed, a process restarted under the same pid) counts as 0, never negative.
- A `sample()` rejection (an unavailable OS, a failed command) shows its message in the panel; the next tick tries again.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [SystemStats contract and macOS adapter](01-system-stats-contract-mac.md)
- [x] [Session process pid reaches chat](03-session-pid.md)
- [x] [Sparkline primitive](04-sparkline-primitive.md)

### Wave 2
- [x] [Windows adapter](02-windows-adapter.md) — after 01
- [x] [system-stats main: sampling, snapshot, slot](05-plugin-main.md) — after 01, 03

### Wave 3
- [x] [system-stats page, layout, keys, self-test](06-plugin-page.md) — after 04, 05

### Wave 4
- [x] [Doc re-read](07-doc-re-read.md) — after 01–06
- [x] [Final verification](08-final-verification.md) — after 07

## Run log

Review base: a2d6ccd32ff1520af587d0cacd1a70306f41e8f7

### Groups
- 04 · 615c8b4d · diff read: kit.sparkline in kit.d.ts and base-kit.ts present; worker's sparkline, base-kit, layout-contracts, gallery tests pass (64); typecheck clean for 04's files (other errors are 03 in flight) · concerns: docs/keymap.md fails oxfmt --check (pre-existing on the branch, from the docs-ahead commit)
- 03 · 620b1b34 · diff read: HostedProcess.pid, AgentProcessEvents.pid, FAKE_AGENT_PID, ChatSessionInfo.pid present; worker's 17 test files pass (1284); typecheck clean for 03's files · concerns: session-part.test.ts and layout.test.ts hold ComposerInput, not ChatSessionInfo literals, left alone; a controls test now finds its event by name since pid leads; childHost double returns pid null
- 01 · 00b45eeb · diff read: SystemStats contract word for word, MainServices.systemStats, systemStatsFor in main.ts, check-layers entries, notFaked; full typecheck exit 0 with wave 1 landed; worker's 7 test files pass (89) · concerns: adapter not run live (task 08); docs/keymap.md oxfmt failure pre-existing; scripts/drive-runs.mts and its test edited beyond the list, since StartOptions lives there
- 02 · 73e506bd · diff read: createWindowsSystemStats in main.ts systemStatsFor, windowsHide in node-processes; worker's 43 system-stats tests pass, typecheck clean; PowerShell never run (task 08 / user's Windows check) · concerns: rejection names powershell.exe through the runner's own error when the spawn fails; a key present as null throws a TypeError naming no program
- 05 · 01d1e39b · diff read: contract.ts word for word, slot and channel present, manifests/main list the plugin, FAKE_SESSION_PID gone; worker's typecheck and lint clean, 140 plugin tests pass · concerns: gallery-parts.test.ts fails: its fake document lacks createElementNS under task 04's sparkline (fix dispatched); harness pushSettings added beyond the list
- 06 · 375dd5f7 · diff read: layout.d.ts filled, page part listed, <Leader>vy and panel binds in keymap, selftest script handed; worker's typecheck and lint clean, 150 tests pass, selftest --plugin system-stats passes; screenshots read · concerns: 56px column-width token leaves names ~60px at the default bar: names and session titles truncate (screenshot); narrow form proved only by the fit check; s hint placement unproven until a placement check
- 07 · 9dc539c0 · Diff read: DESIGN.md Sparkline and System stats bullets, design.md § The panel match the code (sort hint, heading row, 260px narrow form, system-stats.layout setting); oxfmt --check passes on both. AGENTS.md, docs/keymap.md, session-host and layouts design docs, drive SKILL.md checked and unchanged. · concerns: design.md adapter table's Windows memory row omits Win32_PerfRawData_PerfOS_Memory, which windows-system-stats.ts reads for AvailableBytes; rides to the review.
- 08 · ce349957 4a420502 · Tests: filtered npm test (31 files, 1436 tests), typecheck, lint pass. Self-test: npm run selftest -- --plugin system-stats --plugin chat passes (gallery has no script; whole run not asked, so not run, placement check unproven). Drive 1 (/tmp/claude-system-stats/reports/08-drive-1.md, .drive/ssa, .drive/ssb): panel on launch, gallery Sparkline strokes = status-success/warning/error in dark, run-home Latte light and reduced transparency, error seed text and log, Space v y hide/reload/show, Alt+l j k gg G s Enter h, sampling stopped while hidden, GPU numbers on Apple Silicon, session title after restart all PASS; B1 rows-vs-meter and B2 session row unreachable FAIL. Fixes ce349957 (sessions always shown, narrow form at 360px) and 4a420502 (new-process CPU, time-based fake, tone on shown percent, one seeded line). Drive 2 (/tmp/claude-system-stats/reports/08-drive-2.md, .drive/ssa2, .drive/ssb2): narrow form name cell 235px, sparkline 213px, names legible; one seeded line; claude · Greeting row reachable and opens to claude, Python. B1 still short: meter vs row sum 37.9/23.6, 74.4/25.2, 76.9/52.0 (processes that start and exit between samples). Live runs spent two short real Claude turns (about $0.33 each). · concerns: B1 rows undercount the CPU meter from process churn ps cannot see (design.md:52 claims they add up); fake Network/Disk meters sit at 85%/100% flat; an opened group's children stay below the visible area until the cursor moves; light theme proved only on a run-home Latte theme (no built-in light theme); stale docs: design.md:52, design.md Windows memory row, plan 05/06 cut rule and seeded log line. All ride to the review.
### Contract changes
- kit.sparkline in kit.d.ts: one line → oxfmt wraps it over several lines, type unchanged · why: the repo formatter · consumers: 06 · group 04
- FakeHostedProcessRecord: gains pid as planned → also a public spawnEvents (null for addRunning) · why: the record is the fake's only per-process state · consumers: none beyond tests · group 03
- Drive start options: DriveInvocation start and StartOptions gain systemStats 'fake'|'live' (DriveSystemStats in scripts/drive-args.mts); RunEnvironment drive gains systemStats (DriveSystemStatsName in src/main/run-mode.ts) · why: the flag end to end · consumers: 08 · group 01
- snapshot.ts also exports DEFAULT_REFRESH_SECONDS and refreshSecondsOf; StatsPollerDeps gains log; StatsDriveDeps drops clock; contract.ts word for word with doc comments · why: one home for the refresh rule, the poller logs handler throws, seed reads its own time · consumers: 06 · group 05
- Layout: the s sort hint sits at the end of the System stats header, not the column heading row; layout.css adds a narrow form under a 260px container query; <Leader>vy after <Leader>vu (no vf bind exists); view model also exports isGroup · why: room at 300px and the 184px fit check · consumers: 07, 08 · group 06
### Rulings
- Client sets entry.pid from the subscribe reply once the attach succeeds, not on reply receipt — an abandoned attach leaves no pid — a pid a few awaits late if wrong · group 03 · group 03
- A spawned push after the spawner detached is dropped like a line; a later attach takes the pid from its reply — a detached spawner reads pid null · group 03 · group 03
- A sysctl timeout still rejects sample(); only its exit code is ignored — a slow sysctl fails the sample if wrong · group 01 · group 01
- offscreenRunServices takes a systemStats builder like harness; task 02 adds Windows only inside systemStatsFor · group 01 · group 01
- A restart of a drive run whose start.json predates the flag falls back to the fake — costs nothing · group 01 · group 01
- docs/keymap.md's v row was one column too wide from the docs-ahead commit; oxfmt reformatted it (editor tooling, lead) so npm run lint passes — costs nothing · lead
- Windows parser's missing-key check is key-in-document; a null-valued key throws an unnamed TypeError — only a wording loss, since the script always writes the four keys · group 02 · group 02
- Poller waits FIRST_GAP_MS until a show has 2 good samples, then the interval — a rejection right after the first good sample waits 1 s · group 05 · group 05
- The main part harness gains pushSettings (MainRecord holds settings and listeners) — a shared test-support file changed beyond the list · group 05 · group 05
- Open groups prune and the cursor falls back only on a non-null snapshot, since main nulls the slot at each show · group 06 · group 06
- Every row gets a chevron-width spacer so names line up · group 06 · group 06
- 08 (lead): the plan's self-test command named --plugin gallery, which has no self-test script; ran --plugin system-stats --plugin chat.
- 08 (lead): drive run B2 found the Chat session group cut by processRows; every session: group now always shows in the list in its sort position, processRows caps the other rows.
- 08 (lead): drive FAILs B1 (row CPU undercounts the meter), the narrow form not applying at the default width, Network/Disk scale reset on config apply, the 90% tone/label mismatch and the double seeded log are fixed inside 08 by two fix dispatches (main side, page side).
### Review rounds
### Test gate
- Filtered npm test over every test file 01-08 touched (31 files, 1436 tests) + typecheck + lint pass at 4a420502; filtered self-test (system-stats, chat) passes; whole self-test not run: not asked in this turn.
