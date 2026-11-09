# 02 — Windows adapter

Status: done
Type: Task
Wave: 2 · Depends on: 01
Plan: [plan.md](plan.md)

Read first: `docs/features/system-stats/design.md` § Reading the machine; task 01's document (the macOS adapter is
the pattern this task follows); `src/session-host/os-processes.ts` (the PowerShell invocation this task copies).

Files:
- create `src/main/system-stats/windows-parsers.ts` · test `src/main/system-stats/windows-parsers.test.ts`
- create `src/main/system-stats/windows-system-stats.ts` · test `src/main/system-stats/windows-system-stats.test.ts`
- modify `src/main/main.ts` · `scripts/check-layers.mts` · `src/main/processes/node-processes.ts`

Consumes:
- `SystemSample`, `ProcessSample`, `SystemStats` in `src/contracts/system-stats.ts` ← 01
- `CpuTimes`, `cpuTotals(cpus: readonly CpuTimes[])` in `src/main/system-stats/cpu-totals.ts` ← 01
- `systemStatsFor(osName: OsName, runner: ProcessRunner): SystemStats` in `src/main/main.ts` ← 01
- `ProcessRunner` in `src/contracts/processes.ts`, `FakeProcesses` in `src/shared/fake-processes.ts` (in the tree)

Produces:
- `src/main/system-stats/windows-parsers.ts`:
  `export function parseWindowsReading(stdout: string): Omit<SystemSample, 'cores' | 'cpuBusyMs' | 'cpuTotalMs'>`
- `src/main/system-stats/windows-system-stats.ts`:
  - `export const WINDOWS_SAMPLE_SCRIPT: string`
  - `export function createWindowsSystemStats(processes: ProcessRunner, cpus: () => readonly CpuTimes[]): SystemStats`

Decisions:
- `node-processes.ts`'s `spawn` gains `windowsHide: true` (no effect off Windows). The packaged app has no console,
  so each `powershell.exe` run would otherwise flash a console window, every refresh. No test: the flag is
  Node's own behaviour, and the Windows live check in 08 covers it.
- RAM used is Task Manager's "In use": total minus `Win32_PerfRawData_PerfOS_Memory.AvailableBytes`. Total minus
  `FreePhysicalMemory` would count the standby cache as used and read near full on a healthy machine.
- Network leaves out virtual and tunnel interfaces by name, as the macOS adapter keeps only `en*`: a VPN or Hyper-V
  adapter carries bytes the physical one already counts. The pattern is the script's `-notmatch` below.
- One PowerShell run per `sample()`, emitting one JSON document. The adapter runs `processes.run('powershell.exe',
  ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SAMPLE_SCRIPT], { timeoutMs: 10000 })`, the flags
  `os-processes.ts` uses. It then calls `cpus()` once and merges `cpuTotals(cpus())` into the parsed reading.
- Every reading comes from CIM classes, not `Get-Counter`: CIM class and property names are not localized, and
  `Get-Counter` paths are. `Win32_Process` alone gives pid, parent pid, name, path, CPU time and working set.
- GPU reads only the `engtype_3D` engines, per process and in total: the 3D engine is the one Task Manager's GPU
  column shows. The total is per adapter (the `luid_0x…_0x…_phys_N` part of an engine's name): the sum of its 3D
  engines' utilization, and `gpuPercent` is the busiest adapter's sum, capped at 100, so an iGPU plus a dGPU never
  add up past one device. Whether a one-shot read of the formatted class gives a real rate (rather than 0) is
  unproven: the Windows check in 08 covers it. The GPU queries sit in a
  `try`/`catch` inside the script: a machine without the GPU performance classes (no WDDM 2 driver, most VMs) gives
  `"gpu": null`, never a failed sample.
- `WINDOWS_SAMPLE_SCRIPT` is these lines joined with `'; '`, verbatim. It holds no `"` character, since Node quotes
  the `-Command` argument in double quotes on Windows:
  ```powershell
  $ErrorActionPreference = 'Stop'
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  $procs = @(Get-CimInstance Win32_Process | ForEach-Object { @{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name; path = [string]$_.ExecutablePath; cpu100ns = [uint64]$_.KernelModeTime + [uint64]$_.UserModeTime; rss = [uint64]$_.WorkingSetSize } })
  $os = Get-CimInstance Win32_OperatingSystem
  $swapMb = [uint64](@(Get-CimInstance Win32_PageFileUsage) | Measure-Object -Property CurrentUsage -Sum).Sum
  $gpu = $null
  try { $engines = @(Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like '*engtype_3D' } | ForEach-Object { @{ name = [string]$_.Name; runningTime = [uint64]$_.RunningTime } }); $utilization = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like '*engtype_3D' } | ForEach-Object { @{ name = [string]$_.Name; percent = [double]$_.UtilizationPercentage } }); $gpu = @{ utilization = $utilization; engines = $engines } } catch { $gpu = $null }
  $mem = Get-CimInstance Win32_PerfRawData_PerfOS_Memory
  $net = @(Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface | Where-Object { $_.Name -notmatch 'isatap|teredo|loopback|vethernet|hyper-v|virtual|vpn|pseudo|tap-windows|wan miniport|6to4' })
  $disk = @(Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk | Where-Object { $_.Name -eq '_Total' })[0]
  $doc = @{ processes = $procs; memory = @{ totalKb = [uint64]$os.TotalVisibleMemorySize; availableBytes = [uint64]$mem.AvailableBytes; swapUsedMb = $swapMb }; gpu = $gpu; network = @{ received = [uint64]($net | Measure-Object -Property BytesReceivedPersec -Sum).Sum; sent = [uint64]($net | Measure-Object -Property BytesSentPersec -Sum).Sum }; disk = @{ read = [uint64]$disk.DiskReadBytesPersec; written = [uint64]$disk.DiskWriteBytesPersec } }
  ConvertTo-Json -InputObject $doc -Depth 4 -Compress
  ```
  The document's shape:
  `{ processes: [{ pid, ppid, name, path, cpu100ns, rss }], memory: { totalKb, availableBytes, swapUsedMb },
  gpu: null | { utilization: [{ name, percent }], engines: [{ name, runningTime }] }, network: { received, sent }, disk: { read, written } }`.
  The `PerfRaw` counters are cumulative byte counts; `RunningTime` and the CPU times are in 100 ns units.
- `parseWindowsReading` maps the document:
  - each process → `{ pid, ppid, name, path, cpuTimeMs: Math.round(cpu100ns / 10000), rssBytes: rss, gpuTimeNs }`;
    `path` `null` or missing → `''`.
  - pid 0 (`System Idle Process`) is dropped: its CPU time is the machine's idle time, not a process's work.
  - `gpuTimeNs`: `gpu` null → `null` for every process. Otherwise each engine name's pid is read with
    `^pid_(\d+)_`; a process's value is the sum of its engines' `runningTime × 100`, and `0` when it has none.
  - `gpuPercent`: `gpu` null → `null`; otherwise each `utilization` entry's adapter is read with
    `_(luid_0x[0-9a-f]+_0x[0-9a-f]+_phys_\d+)_` (case-insensitive), the percents are summed per adapter, and the
    result is `Math.min(100, the highest adapter sum)`, or `0` with no entries.
  - `memory`: `totalBytes = totalKb × 1024`, `usedBytes = totalKb × 1024 − availableBytes`,
    `swapUsedBytes = swapUsedMb × 1048576`, `pressure: null` (Windows has no pressure level).
  - `network: { receivedBytes: received, sentBytes: sent }`, `disk: { readBytes: read, writtenBytes: written }`.
  - Windows PowerShell 5.1 writes a one-item array as a bare object; `processes` , `gpu.engines` and `gpu.utilization` given as an object
    are read as a one-item array.
  - Text that is not JSON, or a document missing `processes`, `memory`, `network` or `disk`, throws an `Error` whose
    message names `powershell.exe`.
- `sample()` rejects with an `Error` naming `powershell.exe` when the run rejects, times out
  (`powershell.exe timed out`) or exits non-zero (`powershell.exe exited with code <code>`), and when
  `parseWindowsReading` throws.
- main.ts: `systemStatsFor` gains `'windows'` → `createWindowsSystemStats(runner, os.cpus)`. Linux keeps
  `createUnavailableSystemStats`.
- `scripts/check-layers.mts` `CORE_LAYERS` gains
  `'src/main/system-stats/windows-system-stats.test.ts': { layers: ['src/contracts', 'src/shared', 'src/main/system-stats'], packages: [] }`.
  The folder's own entry (from 01) already covers the new source files.

GIVEN the script's JSON document WHEN `sample()` runs THEN it resolves one `SystemSample` with per-process GPU time
from the 3D engines, and with `System Idle Process` left out.
GIVEN a machine without GPU performance classes WHEN `sample()` runs THEN `gpuPercent` and every `gpuTimeNs` are null.
GIVEN PowerShell exits non-zero WHEN `sample()` runs THEN it rejects naming `powershell.exe`.

Tests: PowerShell cannot run on the Mac this plan was written on, so the fixtures are representative documents in
the script's shape, built in the test.

`src/main/system-stats/windows-parsers.test.ts`:
- `parseWindowsReading_ReadsTheScriptDocument` — this stdout (one line in the test):
  ```json
  {"processes":[
    {"pid":0,"ppid":0,"name":"System Idle Process","path":"","cpu100ns":9876543210000,"rss":8192},
    {"pid":4,"ppid":0,"name":"System","path":null,"cpu100ns":123456789,"rss":143360},
    {"pid":5120,"ppid":4880,"name":"chrome.exe","path":"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","cpu100ns":4567890000,"rss":312475648},
    {"pid":6200,"ppid":5120,"name":"chrome.exe","path":"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","cpu100ns":1200000,"rss":98304000}],
   "memory":{"totalKb":33435224,"availableBytes":12884901888,"swapUsedMb":2048},
   "gpu":{"utilization":[
    {"name":"pid_5120_luid_0x00000000_0x0000D1A6_phys_0_eng_0_engtype_3D","percent":30},
    {"name":"pid_6200_luid_0x00000000_0x0000D1A6_phys_0_eng_0_engtype_3D","percent":7.5},
    {"name":"pid_7000_luid_0x00000000_0x0000E2B7_phys_0_eng_0_engtype_3D","percent":12}],
   "engines":[
    {"name":"pid_5120_luid_0x00000000_0x0000D1A6_phys_0_eng_0_engtype_3D","runningTime":250000000},
    {"name":"pid_5120_luid_0x00000000_0x0000D1A6_phys_0_eng_1_engtype_3D","runningTime":50000000},
    {"name":"pid_6200_luid_0x00000000_0x0000D1A6_phys_0_eng_0_engtype_3D","runningTime":1000}]},
   "network":{"received":987654321,"sent":123456789},
   "disk":{"read":55555555555,"written":4444444444}}
  ```
  Asserts the whole result:
  | pid | ppid | name | path | cpuTimeMs | rssBytes | gpuTimeNs |
  |---|---|---|---|---|---|---|
  | 4 | 0 | `System` | `''` | 12346 | 143360 | 0 |
  | 5120 | 4880 | `chrome.exe` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | 456789 | 312475648 | 30000000000 |
  | 6200 | 5120 | `chrome.exe` | `C:\Program Files\Google\Chrome\Application\chrome.exe` | 120 | 98304000 | 100000 |

  and `memory: { totalBytes: 34237669376, usedBytes: 21352767488, swapUsedBytes: 2147483648, pressure: null }`,
  `gpuPercent: 37.5`, `network: { receivedBytes: 987654321, sentBytes: 123456789 }`,
  `disk: { readBytes: 55555555555, writtenBytes: 4444444444 }`.
- `parseWindowsReading_DocumentVariants` — each row changes the document above:
  | change | expected |
  |---|---|
  | `"gpu":null` | `gpuPercent: null`; every `gpuTimeNs: null` |
  | `"gpu":{"utilization":[]` with `"engines":[]}` | `gpuPercent: 0`; every `gpuTimeNs: 0` |
  | `utilization` of two `…0x0000D1A6_phys_0…` entries at 90 and 50 | `gpuPercent: 100` |
  | `utilization` with the `0x0000E2B7` entry at 60 | `gpuPercent: 60` (the busier adapter, not 97.5) |
  | `"processes"` is the bare object of pid 5120 | one process, pid 5120 |
  | `"engines"` is the bare object of pid 6200's engine | pid 6200 `gpuTimeNs: 100000`; pid 5120 `gpuTimeNs: 0` |
  | stdout `Get-CimInstance : Access denied` | throws, message matches `/powershell\.exe/` |
  | the document without `"memory"` | throws, message matches `/powershell\.exe/` |

`src/main/system-stats/windows-system-stats.test.ts` (over `FakeProcesses`):
- `sample_RunsTheScriptAndAddsCpuTotals` — `powershell.exe` with `['-NoProfile', '-NonInteractive', '-Command',
  WINDOWS_SAMPLE_SCRIPT]` scripted with code 0 and the parser test's document trimmed to pid 4; `cpus` returns two cores
  `{ user: 1000, nice: 0, sys: 300, idle: 5000, irq: 7 }` and `{ user: 2000, nice: 0, sys: 400, idle: 4000, irq: 3 }`.
  Asserts `cores: 2`, `cpuBusyMs: 3710`, `cpuTotalMs: 12710`, `processes` holding pid 4 alone (the parser test owns
  the mapping), and one run with exactly those args and `timeoutMs: 10000`.
- `sample_PowerShellFailure` — rows:
  | result | expected |
  |---|---|
  | code 1, stderr `Get-CimInstance : Invalid class` | rejects, message matches `/powershell\.exe/` |
  | `timedOut: true` | rejects, message matches `/powershell\.exe/` |
  | run rejects with `Error('Could not run powershell.exe: ENOENT')` | rejects, message matches `/powershell\.exe/` |
- `windowsSampleScript_HoldsNoDoubleQuote` — `WINDOWS_SAMPLE_SCRIPT` contains no `"`. The break it catches: a
  `-Filter "…"` added to the script, which Node's Windows argument quoting splits apart.

Done when: `npm run typecheck` passes; `npm run lint` passes, layer check included; the Vitest tests named above
pass on macOS (they run no PowerShell). The script's run on a real Windows machine is a check in
"08 — Final verification".

Commit: one commit for the group.

## Proof

Commit 73e506bd · proof: diff read: createWindowsSystemStats in main.ts systemStatsFor, windowsHide in node-processes; worker's 43 system-stats tests pass, typecheck clean; PowerShell never run (task 08 / user's Windows check) · concerns: rejection names powershell.exe through the runner's own error when the spawn fails; a key present as null throws a TypeError naming no program
