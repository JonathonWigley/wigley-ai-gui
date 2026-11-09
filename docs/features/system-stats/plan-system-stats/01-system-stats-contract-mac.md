# 01 — SystemStats contract and macOS adapter

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Read first: `docs/features/system-stats/design.md` § Reading the machine; `AGENTS.md` § Architecture (the
`src/main/system-stats/` layer line, the ambient service bullet, the `npm run lint` bullet).

Files:
- create `src/contracts/system-stats.ts`
- create `src/main/system-stats/mac-parsers.ts` · test `src/main/system-stats/mac-parsers.test.ts`
- create `src/main/system-stats/cpu-totals.ts` · test `src/main/system-stats/cpu-totals.test.ts`
- create `src/main/system-stats/mac-system-stats.ts` · test `src/main/system-stats/mac-system-stats.test.ts`
- create `src/main/system-stats/unavailable-system-stats.ts`
- create `src/shared/fake-system-stats.ts` · test `src/shared/fake-system-stats.test.ts`
- modify `src/contracts/plugin.ts` · `src/main/main.ts` · `scripts/check-layers.mts` ·
  `src/shared/plugin-part-harness.test-support.ts`

Consumes:
- `ProcessRunner`, `ProcessResult` in `src/contracts/processes.ts` (in the tree)
- `FakeProcesses` in `src/shared/fake-processes.ts` (in the tree; tests only)
- `OsName` in `src/contracts/platform.ts` (in the tree)

Produces:
- `src/contracts/system-stats.ts`: `ProcessSample`, `MemoryPressure`, `SystemSample`, `SystemStats`, word for word as
  plan.md § File Structure gives them, comments included.
- `src/main/system-stats/cpu-totals.ts`:
  - `export interface CpuTimes { times: { user: number; nice: number; sys: number; idle: number; irq: number } }`
  - `export function cpuTotals(cpus: readonly CpuTimes[]): Pick<SystemSample, 'cores' | 'cpuBusyMs' | 'cpuTotalMs'>`
- `src/main/system-stats/mac-parsers.ts`:
  - `export type ProcessRow = Omit<ProcessSample, 'gpuTimeNs'>`
  - `export function parsePs(stdout: string): ProcessRow[]`
  - `export function parseVmStatUsedBytes(stdout: string): number`
  - `export function parseSysctl(stdout: string): { totalBytes: number; swapUsedBytes: number; pressure: MemoryPressure | null }`
  - `export function parseDeviceUtilisation(stdout: string): number | null`
  - `export function parseGpuTimes(stdout: string): Map<number, number>` (pid → summed `accumulatedGPUTime` ns)
  - `export function parseNetstat(stdout: string): SystemSample['network']`
  - `export function parseBlockStorage(stdout: string): SystemSample['disk']`
- `src/main/system-stats/mac-system-stats.ts`:
  `export function createMacSystemStats(processes: ProcessRunner, cpus: () => readonly CpuTimes[]): SystemStats`
- `src/main/system-stats/unavailable-system-stats.ts`:
  `export function createUnavailableSystemStats(os: OsName): SystemStats`
- `src/shared/fake-system-stats.ts`:
  - `export const FAKE_SESSION_PID = 4242`
  - `export function fakeSystemSample(step: number): SystemSample`
  - `export function createFakeSystemStats(): SystemStats`
- `src/contracts/plugin.ts`: `systemStats: SystemStats;` in `MainServices`, after `images`.

Decisions:
- Commands. The adapter runs these exact programs and arguments through `processes.run`, all at once
  (`Promise.all`), each with `timeoutMs: 5000`:

  | Reading | Program | Arguments | Required |
  |---|---|---|---|
  | processes | `/bin/ps` | `-axww -o pid=,ppid=,time=,rss=,comm=` (as separate args: `-axww`, `-o`, `pid=,ppid=,time=,rss=,comm=`) | yes |
  | memory used | `/usr/bin/vm_stat` | none | yes |
  | total, swap, pressure | `/usr/sbin/sysctl` | `hw.memsize`, `vm.swapusage`, `kern.memorystatus_vm_pressure_level` | yes |
  | GPU total | `/usr/sbin/ioreg` | `-r`, `-d`, `1`, `-w`, `0`, `-c`, `IOAccelerator` | no |
  | GPU per process | `/usr/sbin/ioreg` | `-r`, `-d`, `1`, `-w`, `0`, `-c`, `AGXDeviceUserClient` | no |
  | network | `/usr/sbin/netstat` | `-ibn` | yes |
  | disk | `/usr/sbin/ioreg` | `-r`, `-d`, `1`, `-w`, `0`, `-c`, `IOBlockStorageDriver` | yes |

  `-d 1` on the disk read is deliberate: design.md's table names `-l`, which also prints the nested APFS
  containers' `Statistics` with the same `Bytes (Read)` keys and counts the same bytes twice. Measured on this Mac.
- A required reading fails when its run rejects, times out (`timedOut: true`) or exits non-zero; then `sample()`
  rejects with an `Error` whose message names the program (`/bin/ps exited with code 1`,
  `/bin/ps timed out`, or the runner's own `Could not run /bin/ps: …`). `sysctl` is the one exception: it exits 1
  when one of its names is unknown but still prints the others, so its exit code is ignored and only its stdout is
  parsed. A parser that throws also rejects `sample()`.
- An optional (GPU) reading that fails in any of those ways is null: `gpuPercent: null` when the `IOAccelerator`
  read fails; every `gpuTimeNs: null` when the `AGXDeviceUserClient` read fails.
- `gpuTimeNs` per process: when `parseGpuTimes` returns at least one pid, a process whose pid it has takes that
  value and every other process takes `0` (a process with no GPU client used no GPU). When it returns an empty map
  (an Intel Mac lists no AGX clients), every process takes `null`.
- `cpus()` is called once per `sample()`, after the `ps` run resolves, so the CPU totals and the process times are
  read close together. main.ts passes `os.cpus`. The adapter folder imports no `node:` module.
- `cpuTotals`: `cores` = the array's length; `cpuBusyMs` = sum over cores of `user + nice + sys + irq`;
  `cpuTotalMs` = `cpuBusyMs` + sum of `idle`.
- `parsePs`: one row per line matching `^\s*(\d+)\s+(\d+)\s+(\d+):(\d+)[.,](\d+)\s+(\d+)\s+(.+)$`; any other line is
  skipped. `cpuTimeMs` = minutes × 60000 + seconds × 1000 + hundredths × 10, in whole numbers (macOS prints
  `time` as `<minutes>:<seconds>.<hundredths>`, minutes past 60 included: `178:05.54`). `rssBytes` = the `rss`
  column × 1024. `comm` is the rest of the line, trimmed. When `comm` starts with `/`, `path` = `comm` and
  `name` = its last `/`-separated part; otherwise `path` = `''` and `name` = `comm`.
- `parseVmStatUsedBytes`: memory used as Activity Monitor counts it, app memory + wired + compressed:
  (`Anonymous pages` − `Pages purgeable` + `Pages wired down` + `Pages occupied by compressor`) × the page size from
  the header `(page size of N bytes)`. A missing header or any of the four lines throws an `Error` naming `vm_stat`.
- `parseSysctl`: `hw.memsize: N` → `totalBytes`. `vm.swapusage: … used = X<unit> …` → `swapUsedBytes` =
  `Math.round(X × 1024^k)` for unit `K` (k = 1), `M` (2), `G` (3); no `vm.swapusage` line → `0`.
  `kern.memorystatus_vm_pressure_level: N` → `1` `'normal'`, `2` `'warning'`, `4` `'critical'`, any other value or no
  line → `null`. No `hw.memsize` line throws an `Error` naming `sysctl`.
- `parseDeviceUtilisation`: the highest `"Device Utilization %"=N` in the output; none → `null`.
- `parseGpuTimes`: the output is split into blocks at each `+-o ` line. In each block, every
  `"accumulatedGPUTime"=N` is summed, and the block's pid is read from `"IOUserClientCreator" = "pid N, …"`. A block
  with no creator line is skipped. Blocks with the same pid add up. A block whose `AppUsage` is `()` still adds the pid,
  with 0.
- `parseNetstat`: only rows whose third column starts with `<Link#` and whose name, less a trailing `*`, matches
  `^en\d+$` (Ethernet and Wi-Fi: `lo0`, `utun*` (VPN tunnels, which carry the same bytes as `en*` again),
  `bridge*`, `awdl*`, `llw*`, `anpi*`, `ap*` are left out). Columns are read from the line's end, since the Address
  column is empty on some rows: `Ibytes` is the 5th token from the end, `Obytes` the 2nd. The sums are
  `receivedBytes` and `sentBytes`; no matching row → `0` and `0`.
- `parseBlockStorage`: the sums of every `"Bytes (Read)"=N` and every `"Bytes (Write)"=N` in the output. Output with
  no `"Statistics"` throws an `Error` naming `ioreg`.
- Linux (an OS with no adapter yet): main.ts hands `createUnavailableSystemStats(platform.os)`, whose `sample()`
  rejects with `new Error('System stats are not available on <os>')` (`System stats are not available on linux`).
  The plugin (05) shows a rejection's message in its panel; this task adds nothing for that.
- Wiring in main.ts. `ModeServices.forWindow`'s `Pick<MainServices, …>` gains `'systemStats'`, built lazily there
  because `modeServicesOf` runs before `platform` and `processes` are defined:
  - `liveServices().forWindow` returns `systemStats: systemStatsFor(platform.os, processes)`;
  - `offscreenRunServices(...).forWindow` returns `systemStats: createFakeSystemStats()`, so the self-test and every
    drive run (fake or Claude harness) read the fake.
  - A new function `systemStatsFor(osName: OsName, runner: ProcessRunner): SystemStats` sits beside `alertsFor`:
    `'macos'` → `createMacSystemStats(runner, os.cpus)`; any other OS → `createUnavailableSystemStats(osName)`. Task 02
    adds the `'windows'` branch.
  - `systemStats` reaches the plugins through `...windowServices` in the `startMainParts` services object, as
    `alerts` does. `main-api.ts` passes it through unchanged (no per-plugin tracking: it holds nothing open).
- Part harness: `src/shared/plugin-part-harness.test-support.ts` adds `systemStats: notFaked<SystemStats>('systemStats')`
  beside `images`, so a plugin test passes its own through `options.services` (05 passes `createFakeSystemStats()`).
- `scripts/check-layers.mts` `CORE_LAYERS`:
  - `'src/main/system-stats': { layers: ['src/contracts'], packages: [] }`
  - `'src/main/system-stats/mac-system-stats.test.ts': { layers: ['src/contracts', 'src/shared', 'src/main/system-stats'], packages: [] }`
    (it uses `FakeProcesses`)
  - `'src/main/system-stats'` added to the `'src/main/main.ts'` entry's `layers`.
  `src/shared/fake-system-stats.ts` imports only `src/contracts`, which the `src/shared` layer already allows.
- Fake (`fakeSystemSample(step)`): every cumulative counter grows by a fixed amount per step, so two samples one
  step apart give non-zero rates. Values (step `s`, whole numbers):
  - `cores: 8`, `cpuTotalMs: 1_000_000 + 16_000·s`, `cpuBusyMs: 400_000 + 6_000·s`
  - `memory: { totalBytes: 34_359_738_368, usedBytes: 21_474_836_480, swapUsedBytes: 1_073_741_824, pressure: 'normal' }`
  - `gpuPercent: 20 + 10·(s % 5)`
  - `network: { receivedBytes: 5_000_000 + 1_500_000·s, sentBytes: 1_000_000 + 200_000·s }`
  - `disk: { readBytes: 9_000_000 + 3_000_000·s, writtenBytes: 2_000_000 + 800_000·s }`
  - `processes` (pid, ppid, name, path, cpuTimeMs, rssBytes, gpuTimeNs):

    | pid | ppid | name | path | cpuTimeMs | rssBytes | gpuTimeNs |
    |---|---|---|---|---|---|---|
    | 1 | 0 | `launchd` | `/sbin/launchd` | 50_000 + 100·s | 10_485_760 | 0 |
    | 101 | 1 | `Fake Browser` | `/Applications/Fake Browser.app/Contents/MacOS/Fake Browser` | 200_000 + 2_400·s | 629_145_600 | 5_000_000_000 + 400_000_000·s |
    | 102 | 101 | `Fake Browser Helper` | `/Applications/Fake Browser.app/Contents/Frameworks/Fake Browser Helper.app/Contents/MacOS/Fake Browser Helper` | 80_000 + 1_200·s | 314_572_800 | 0 |
    | 201 | 1 | `node` | `/usr/local/bin/node` | 30_000 + 800·s | 157_286_400 | 0 |
    | `FAKE_SESSION_PID` (4242) | 1 | `claude` | `/Users/fake/.local/bin/claude` | 10_000 + 1_000·s | 268_435_456 | 0 |
    | 4243 | 4242 | `node` | `/usr/local/bin/node` | 2_000 + 400·s | 104_857_600 | 0 |

  `createFakeSystemStats()` keeps a step counter from 0 and returns `fakeSystemSample(step++)` on each `sample()`.
  `FAKE_SESSION_PID` is the pid a session's process tree hangs from; task 03 adds
  `FAKE_AGENT_PID` (4242) to the fake agent harness in the same wave, and task 05 then makes this file import that
  constant in place of `FAKE_SESSION_PID`, so the fake session's process tree hangs from the pid chat publishes.

GIVEN this Mac's command output WHEN `sample()` runs THEN it resolves one `SystemSample` of cumulative counters, with
per-process GPU time where the AGX clients report it.
GIVEN a required command exits non-zero WHEN `sample()` runs THEN it rejects naming that program.
GIVEN the GPU commands fail WHEN `sample()` runs THEN it resolves with `gpuPercent: null` and every `gpuTimeNs: null`.
GIVEN Linux WHEN main starts THEN `services.systemStats.sample()` rejects with `System stats are not available on linux`.
GIVEN the self-test or a drive run WHEN a plugin samples twice THEN every counter has grown.

Tests: fixtures are text in the test file, taken from this Mac (M2 Max, macOS 26) on 2026-11-09.

`src/main/system-stats/mac-parsers.test.ts`:
- `parsePs_ReadsEachProcessLine` — one stdout holding the lines below (with their leading spaces), and the whole
  `ProcessRow[]` asserted:
  ```
      1     0 178:05.54  10064 /sbin/launchd
    521     1   2:12.49  12992 /Applications/Splashtop Streamer.app/Contents/MacOS/SRStreamerDaemon
    526     1   3:16.72   6320 Core Audio Driver (BlackHole2ch.driver)
   7154 19058   0:00.03  22608 (Python)
  not a process line
  ```
  | pid | ppid | name | path | cpuTimeMs | rssBytes |
  |---|---|---|---|---|---|
  | 1 | 0 | `launchd` | `/sbin/launchd` | 10685540 | 10305536 |
  | 521 | 1 | `SRStreamerDaemon` | `/Applications/Splashtop Streamer.app/Contents/MacOS/SRStreamerDaemon` | 132490 | 13303808 |
  | 526 | 1 | `Core Audio Driver (BlackHole2ch.driver)` | `''` | 196720 | 6471680 |
  | 7154 | 19058 | `(Python)` | `''` | 30 | 23150592 |
- `parseVmStatUsedBytes_CountsAppWiredAndCompressed` — rows:
  | stdout | expected |
  |---|---|
  | header `Mach Virtual Memory Statistics: (page size of 16384 bytes)`, `Pages free: 169736.`, `Pages wired down: 254080.`, `Pages purgeable: 2786.`, `Anonymous pages: 328136.`, `Pages occupied by compressor: 994944.` (each its own line, padded as `vm_stat` pads them) | `25794543616` |
  | header `(page size of 4096 bytes)`, `Pages wired down: 500.`, `Pages purgeable: 100.`, `Anonymous pages: 1000.`, `Pages occupied by compressor: 200.` | `6553600` |
  | the 16384 header with no `Anonymous pages` line | throws, message matches `/vm_stat/` |
- `parseSysctl_ReadsTotalSwapAndPressure` — rows:
  | stdout | totalBytes | swapUsedBytes | pressure |
  |---|---|---|---|
  | `hw.memsize: 34359738368` / `vm.swapusage: total = 20480.00M  used = 19225.31M  free = 1254.69M  (encrypted)` / `kern.memorystatus_vm_pressure_level: 2` | 34359738368 | 20159198659 | `'warning'` |
  | `hw.memsize: 17179869184` / `vm.swapusage: total = 2048.00M  used = 0.00M  free = 2048.00M  (encrypted)` / `kern.memorystatus_vm_pressure_level: 4` | 17179869184 | 0 | `'critical'` |
  | `hw.memsize: 8589934592` / `vm.swapusage: total = 3.00G  used = 1.50G  free = 1.50G  (encrypted)` / `kern.memorystatus_vm_pressure_level: 1` | 8589934592 | 1610612736 | `'normal'` |
  | `hw.memsize: 8589934592` / `vm.swapusage: total = 3.00G  used = 1.50G  free = 1.50G  (encrypted)` (no pressure line) | 8589934592 | 1610612736 | `null` |
  | `hw.memsize: 8589934592` / `kern.memorystatus_vm_pressure_level: 0` | 8589934592 | 0 | `null` |
  | `vm.swapusage: total = 3.00G  used = 1.50G  free = 1.50G` (no `hw.memsize`) | throws, message matches `/sysctl/` | | |
- `parseDeviceUtilisation_TakesTheHighestAccelerator` — rows:
  | stdout | expected |
  |---|---|
  | one `+-o AGXAcceleratorG14X …` block whose line is `"PerformanceStatistics" = {"Tiler Utilization %"=22,"Renderer Utilization %"=22,"Device Utilization %"=22,"SplitSceneCount"=0}` | 22 |
  | two blocks, `"Device Utilization %"=22` and `"Device Utilization %"=41` | 41 |
  | a block with no `PerformanceStatistics` line | `null` |
- `parseGpuTimes_SumsEachPidsClients` — one stdout of four blocks, each opening `+-o AGXDeviceUserClient  <class AGXDeviceUserClient, id 0x…, !registered, !matched, active, busy 0, retain 5>`:
  1. `"AppUsage" = ({"API"="Metal","lastSubmittedTime"=1023476042612375,"accumulatedGPUTime"=19573540866708},{"API"="Metal","lastSubmittedTime"=1016434221431375,"accumulatedGPUTime"=192926375})` and `"IOUserClientCreator" = "pid 404, WindowServer"`
  2. `"AppUsage" = ()` and `"IOUserClientCreator" = "pid 404, WindowServer"`
  3. `"AppUsage" = ({"API"="Metal","lastSubmittedTime"=981394498800291,"accumulatedGPUTime"=16928291})` and `"IOUserClientCreator" = "pid 15342, Notion Calendar "`
  4. `"AppUsage" = ()` and `"IOUserClientCreator" = "pid 407, runningboardd"`

  Expected map entries: `[[404, 19573733793083], [15342, 16928291], [407, 0]]`. A second row: empty stdout → empty map.
- `parseNetstat_SumsPhysicalLinkRows` — one stdout:
  ```
  Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
  lo0        16384 <Link#1>                      12269687     0 14475283033 12269687     0 14475283033     0
  lo0        16384 127           127.0.0.1       12269687     - 14475283033 12269687     - 14475283033     -
  en0        1500  <Link#14>   fa:2f:f9:2b:4d:f6 57002800     0 44908680502 37582319     0 16569714501     0
  en0        1500  192.168.1     192.168.1.20    57002800     - 44908680502 37582319     - 16569714501     -
  utun0      1380  <Link#18>                            0     0          0     2395     0     162781     0
  bridge0    1500  <Link#15>   36:e9:70:32:96:c0        0     0      70000        0     0      90000     0
  en7        1500  <Link#23>   6c:6e:07:12:b6:5c 22756893     0 17956098904 14704677     0 5235511512     0
  ```
  rows: that stdout → `{ receivedBytes: 62864779406, sentBytes: 21805226013 }`; the header line alone →
  `{ receivedBytes: 0, sentBytes: 0 }`.
- `parseBlockStorage_SumsEveryDriver` — rows:
  | stdout | expected |
  |---|---|
  | two `+-o IOBlockStorageDriver …` blocks with `"Statistics" = {"Operations (Write)"=138447617,"Bytes (Read)"=109060200710144,"Bytes (Write)"=7874327449600,"Operations (Read)"=23440236787}` and `"Statistics" = {"Bytes (Read)"=371620864,"Bytes (Write)"=0}` | `{ readBytes: 109060572331008, writtenBytes: 7874327449600 }` |
  | `+-o IOBlockStorageDriver …` with no `Statistics` line | throws, message matches `/ioreg/` |

`src/main/system-stats/cpu-totals.test.ts`:
- `cpuTotals_SumsBusyAndIdleOverCores` — two cores `{ user: 1000, nice: 20, sys: 300, idle: 5000, irq: 7 }` and
  `{ user: 2000, nice: 0, sys: 400, idle: 4000, irq: 3 }` → `{ cores: 2, cpuBusyMs: 3730, cpuTotalMs: 12730 }`.

`src/main/system-stats/mac-system-stats.test.ts` (over `FakeProcesses`, scripted per program and args above with
short outputs built in the test):
- `sample_AssemblesOneReadingFromEveryCommand` — every command scripted with code 0, the AGX output naming one of
  the two `ps` pids; `cpus` returns two cores. Asserts the whole `SystemSample`: the CPU totals, memory from
  `vm_stat` and `sysctl`, `gpuPercent`, network, disk, and the AGX pid's `gpuTimeNs` with `0` on the other process.
- `sample_ReadingFailure` — one row per failure, the rest scripted as in the test above:
  | failure | expected |
  |---|---|
  | `/bin/ps` exits 1 | rejects, message matches `/\/bin\/ps/` |
  | `/usr/sbin/netstat` result `timedOut: true` | rejects, message matches `/netstat/` |
  | `/usr/bin/vm_stat` run rejects with `Error('Could not run /usr/bin/vm_stat: ENOENT')` | rejects, message matches `/vm_stat/` |
  | `/usr/sbin/sysctl` exits 1 with the full stdout | resolves; `memory.totalBytes` read from that stdout |
  | `IOAccelerator` ioreg exits 1 | resolves; `gpuPercent: null`, `gpuTimeNs` unchanged |
  | `AGXDeviceUserClient` ioreg exits 1 | resolves; every `gpuTimeNs: null` |
  | `AGXDeviceUserClient` ioreg prints nothing (code 0) | resolves; every `gpuTimeNs: null` |

`src/shared/fake-system-stats.test.ts`:
- `fakeSystemStats_EachSampleAdvancesEveryCounter` — two `sample()` calls; `cpuBusyMs`, `cpuTotalMs`,
  `network.receivedBytes`, `network.sentBytes`, `disk.readBytes`, `disk.writtenBytes` and pid 101's `cpuTimeMs` and
  `gpuTimeNs` are each greater in the second.

No test for `createUnavailableSystemStats` (one line, its message is copy) or for main.ts's wiring (the self-test
in 06 proves it).

Done when: `npm run typecheck` passes; `npm run lint` passes, layer check
included; the Vitest tests named above pass. The real adapter's run on this Mac (the panel shows live numbers in the
dev app) is a check in "08 — Final verification".

Commit: one commit for the group.

## Proof

