import type { ProcessRunner } from '../../contracts/processes';
import type { SystemSample, SystemStats } from '../../contracts/system-stats';
import { type CpuTimes, cpuTotals } from './cpu-totals';
import { requiredStdout } from './required-stdout';
import { parseWindowsReading } from './windows-parsers';

const RUN_TIMEOUT_MS = 10000;

const POWERSHELL = 'powershell.exe';

// One JSON document of every reading, from CIM classes, whose names are not
// localized as Get-Counter paths are. It holds no `"`: Node wraps the
// `-Command` argument in double quotes on Windows.
export const WINDOWS_SAMPLE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  '$procs = @(Get-CimInstance Win32_Process | ForEach-Object { @{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name; path = [string]$_.ExecutablePath; cpu100ns = [uint64]$_.KernelModeTime + [uint64]$_.UserModeTime; rss = [uint64]$_.WorkingSetSize } })',
  '$os = Get-CimInstance Win32_OperatingSystem',
  '$swapMb = [uint64](@(Get-CimInstance Win32_PageFileUsage) | Measure-Object -Property CurrentUsage -Sum).Sum',
  '$gpu = $null',
  "try { $engines = @(Get-CimInstance Win32_PerfRawData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like '*engtype_3D' } | ForEach-Object { @{ name = [string]$_.Name; runningTime = [uint64]$_.RunningTime } }); $utilization = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like '*engtype_3D' } | ForEach-Object { @{ name = [string]$_.Name; percent = [double]$_.UtilizationPercentage } }); $gpu = @{ utilization = $utilization; engines = $engines } } catch { $gpu = $null }",
  '$mem = Get-CimInstance Win32_PerfRawData_PerfOS_Memory',
  "$net = @(Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface | Where-Object { $_.Name -notmatch 'isatap|teredo|loopback|vethernet|hyper-v|virtual|vpn|pseudo|tap-windows|wan miniport|6to4' })",
  "$disk = @(Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk | Where-Object { $_.Name -eq '_Total' })[0]",
  '$doc = @{ processes = $procs; memory = @{ totalKb = [uint64]$os.TotalVisibleMemorySize; availableBytes = [uint64]$mem.AvailableBytes; swapUsedMb = $swapMb }; gpu = $gpu; network = @{ received = [uint64]($net | Measure-Object -Property BytesReceivedPersec -Sum).Sum; sent = [uint64]($net | Measure-Object -Property BytesSentPersec -Sum).Sum }; disk = @{ read = [uint64]$disk.DiskReadBytesPersec; written = [uint64]$disk.DiskWriteBytesPersec } }',
  'ConvertTo-Json -InputObject $doc -Depth 4 -Compress',
].join('; ');

const POWERSHELL_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  WINDOWS_SAMPLE_SCRIPT,
];

// The Windows SystemStats: every reading from one PowerShell run of
// `WINDOWS_SAMPLE_SCRIPT` through `processes`, and the CPU totals from `cpus`.
// A run that cannot run, times out, exits non-zero or prints no document
// rejects the sample naming `powershell.exe`, with the first stderr line of a
// non-zero exit; the GPU readings are null instead.
export function createWindowsSystemStats(
  processes: ProcessRunner,
  cpus: () => readonly CpuTimes[],
): SystemStats {
  return {
    async sample(): Promise<SystemSample> {
      const stdout = await requiredStdout(
        processes,
        POWERSHELL,
        POWERSHELL_ARGS,
        { timeoutMs: RUN_TIMEOUT_MS },
      );
      return { ...cpuTotals(cpus()), ...parseWindowsReading(stdout) };
    },
  };
}
