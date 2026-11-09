# System stats

**Contents**

- **What it is** — the right-bar panel and what it shows.
- **Reading the machine** — the `SystemStats` service, its per-OS adapters, and what each reads.
- **From readings to a snapshot** — rates, the CPU scale, grouping, history.
- **Session processes** — how a Chat session's process tree is found and titled.
- **The panel** — layout, keys, refresh, hidden state.
- **Rejected** — approaches tried in the interview and turned down.

## What it is

The `system-stats` plugin adds a panel to the right bar that shows how busy the machine is and
what is using it: CPU, GPU, RAM, network and disk meters, each with a sparkline of the last 60
seconds, over one process list. The panel only reads. It never signals or ends a process: the user
chose a read-only panel over quit keys.

## Reading the machine

A core `SystemStats` service (`src/contracts/system-stats.ts`) reads the OS through one adapter per
OS in `src/main/system-stats/`, picked in main's composition root and handed to plugins as
`services.systemStats`, as alerts and paths are. A `sample()` call returns raw cumulative counters
taken at one instant. It computes no rates and keeps no state, so the adapters only run commands
and parse them. Each parser is a pure function over the command's text, tested on captured output.

The adapters use the OS's own commands, with no npm dependency and no `sudo`. Windows reads everything through one PowerShell script over CIM classes, whose names are not localized as counter paths are. An OS with no adapter (Linux) gets one whose `sample()` rejects, and the panel shows that message:

| Reading | macOS | Windows |
|---|---|---|
| Per-process CPU time, RSS, parent pid, path | `ps -axo pid,ppid,time,rss,comm` | `Win32_Process` |
| Total CPU time, core count | Node's `os.cpus()` times | Node's `os.cpus()` times |
| Memory used, pressure, swap | `vm_stat`, `sysctl hw.memsize vm.swapusage kern.memorystatus_vm_pressure_level` (1 normal, 2 warning, 4 critical) | `Win32_OperatingSystem`, `Win32_PerfRawData_PerfOS_Memory` (`AvailableBytes`), `Win32_PageFileUsage` |
| GPU total | `ioreg -r -d 1 -w 0 -c IOAccelerator` → `Device Utilization %` | `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine`, 3D engines |
| GPU per process | `ioreg -r -d 1 -w 0 -c AGXDeviceUserClient` → `accumulatedGPUTime` (ns) per `IOUserClientCreator` pid | `Win32_PerfRawData_GPUPerformanceCounters_GPUEngine` `RunningTime`, 3D engines, per `pid_N` |
| Network bytes | `netstat -ibn`, `en*` interfaces only (loopback, `utun` and `bridge` would count bytes twice) | `Win32_PerfRawData_Tcpip_NetworkInterface` |
| Disk bytes read and written | `ioreg -r -d 1 -w 0 -c IOBlockStorageDriver` → `Bytes (Read)`, `Bytes (Write)` (`-l` adds nested APFS statistics that count bytes twice) | `Win32_PerfRawData_PerfDisk_PhysicalDisk` |

Per-process GPU time exists only on Apple Silicon (`AGXDeviceUserClient`) and on Windows. Elsewhere,
the per-process GPU field is null and the panel shows a dash, while the GPU meter still shows the
total. The exact command per reading is the adapter's choice. This table is what was measured on an
M2 Max at design time (each command finished in under 0.1 s), and what to re-check when an adapter
reads nothing.

## From readings to a snapshot

The plugin's main part keeps the last sample and turns two samples into a snapshot through a pure
module, which takes the two samples and the time between them:

- **Rates** come from counter differences over the elapsed time, read from the injected clock. A
  process's CPU share is its CPU-time difference over the elapsed time times the core count, so a
  process is shown as a **share of the whole machine**. `ps`'s smoothed `%cpu` is not used. A pid
  absent from the earlier sample, or whose CPU time went down (the pid reused), counts from zero; a
  process that renames itself keeps its pid and counts only its growth.
- **The Other row**: the process rows count only processes alive at both samples, so they fall short
  of the CPU meter. An `Other (exited processes, system)` row holds the rest, the meter less the
  top-level rows (never below 0): kernel and system time, which belong to no process `ps` lists, and
  processes that started and exited between the samples. It sorts with the other rows and counts
  toward `system-stats.processRows`; it never opens, and its RAM and GPU show dashes.
- **Network and disk scale**: each meter reads its rate on a fixed logarithmic scale, 1 KB/s at 0%
  and 1 GB/s at 100% (1 MB/s reads 50%), so a steady rate does not read full and one spike does not
  flatten the rest of the minute.
- **RAM used** counts memory as Activity Monitor does: app memory, wired and compressed, out of total
  RAM. Memory pressure and swap used are shown on a line under the meter.
- **Grouping**: a process joins its app's group (its outermost `.app` bundle on macOS, else its
  executable name, on any OS), which shows the summed numbers. A Chat session's process tree forms a group
  of its own (below). A group opens to show its processes.
- **History** is a ring of the last 60 seconds per meter, kept in main and published with the
  snapshot, so a page reload keeps it and an app restart starts it again. Each show of the panel
  starts it empty, so a sparkline never joins readings from before a hide.
- **Tones**: the CPU and GPU meters take `warning` from 70% and `critical` from 90% of the percent rounded to a
  whole number, so the label and its tone agree; the context bar uses the same helper (`src/shared/percent-tone.ts`).
  RAM takes the memory pressure's tone where the OS reports one (macOS), since a healthy Mac counts compressed
  and wired memory as used and reads 75–90%; elsewhere it takes the same percent thresholds.

The snapshot goes to the `system-stats.snapshot` slot. Main samples only while a page shows the
panel: the page tells main over the plugin's channel when the panel shows or hides, so a hidden
panel runs no commands.

## Session processes

Each Chat session's `claude` process is spawned by the session host. The host reports each hosted
process's OS pid over its protocol, the `AgentHarness` adapter passes it up, and chat publishes it
as `pid` on the session's `chat.session` entry (null while no process runs). The panel joins those
pids with the `sessions.rows` titles and finds each session's whole process tree from the parent
pids in the sample. The tree becomes one group, titled `claude · <session title>`, summing the
`claude` process and everything it started (shells, MCP servers, test runs). Sessions started
outside the app stay ordinary processes.

## The panel

The panel is shown by default. `Space v y` hides or shows it, and the choice is kept in the page's
`uiState`. Its layout draws a section header with the sort key's hint at its end, five meters (CPU, GPU, RAM,
Network, Disk), each with its value and a sparkline (a shared UI primitive, redrawn on each
snapshot), then the process list under a heading row: one row per group or process, with CPU, RAM and
GPU columns, sorted by one of them. Every Chat session group shows, however low it sorts, so a session can
always be found and opened. Under a 360px container query, each meter takes two lines and a
row's cells drop under its name.

With the panel focused (Alt+l, as in the unity-pool panel), `j`/`k`/`gg`/`G` move the cursor, `s`
cycles the sort column through CPU, RAM and GPU, Enter or `l` opens a group, and `h` closes it.

Three settings: `system-stats.refreshSeconds` (default 2), `system-stats.processRows` (default
10), the number of rows other than Chat session groups shown with groups closed, and `system-stats.layout`
(default `default`), the layout that draws the panel.

## Rejected

- **The `systeminformation` npm package**: it adds a dependency and has no per-process GPU.
- **Matching session processes by their command line**: it depends on the Claude CLI's flags. The
  host knows the pid exactly.
- **Quit and force-quit keys**: the user chose a read-only panel.
- **Per-process network and disk**: network and disk are machine totals only. A per-process split
  (`nettop`) costs a long-running sampler for little gain.
- **Temperatures and fans**: these need `sudo` or private APIs on Apple Silicon.
