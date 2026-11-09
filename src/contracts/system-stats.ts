// One process in a `SystemSample`.
export interface ProcessSample {
  pid: number;
  ppid: number;
  name: string; // the executable's name, as shown in a row
  path: string; // full executable path ('' when the OS gives none)
  cpuTimeMs: number; // cumulative CPU time
  rssBytes: number;
  gpuTimeNs: number | null; // cumulative GPU time; null where the OS has no per-process GPU
}

export type MemoryPressure = 'normal' | 'warning' | 'critical';

// One reading of the machine: cumulative counters taken at one instant.
export interface SystemSample {
  cores: number;
  cpuBusyMs: number; // cumulative, all cores (os.cpus() user+nice+sys+irq)
  cpuTotalMs: number; // cumulative, all cores, idle included
  memory: {
    totalBytes: number;
    usedBytes: number;
    swapUsedBytes: number;
    pressure: MemoryPressure | null;
  };
  gpuPercent: number | null; // instantaneous device utilisation; null when unreadable
  network: { receivedBytes: number; sentBytes: number }; // cumulative, physical interfaces
  disk: { readBytes: number; writtenBytes: number }; // cumulative
  processes: ProcessSample[];
}

export interface SystemStats {
  // One reading of the machine. Rejects when a required command fails; a reading the OS
  // lacks is null in its field instead.
  sample(): Promise<SystemSample>;
}
