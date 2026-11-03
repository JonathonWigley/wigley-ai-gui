import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import type { Timers } from '../contracts/ambient';
import { HOST_END_GRACE_MS } from '../contracts/session-host-protocol';
import type { OsProcesses, ProcessReport } from './os-processes';
import type { HostSpawn } from './process-table';
import { replaceFile } from './replace-file';

const LEFTOVER_POLL_MS = 200;

// A host's children, and what a host that died left of its own. A host that dies does not take its children with it,
// so each child stays on a record file from spawn to close, for the next host to end.
export interface HostChildren {
  // Starts a child as the `spawn` dep does, and records it. The record gains it once the OS has reported it.
  spawn: HostSpawn;
  // Ends each process the record names that is still the one recorded: SIGTERM, then SIGKILL after `HOST_END_GRACE_MS`.
  // A process it cannot confirm is left alone and reported. Resolves once each is gone or its steps have run, with the
  // record cleared. Never rejects. Call it once, while owning the channel, before the first `spawn`.
  endLeftovers(): Promise<void>;
  // For a host on its way down: sends each running child SIGTERM, leaving the record for the next host.
  killAll(): void;
}

export interface HostChildrenDeps {
  file: string;
  spawn: HostSpawn;
  processes: OsProcesses;
  timers: Timers;
  report(message: string): void;
}

interface RecordedChild extends ProcessReport {
  pid: number;
}

function isRecordedChild(value: unknown): value is RecordedChild {
  const { pid, startedAt, command } = (value ?? {}) as Partial<RecordedChild>;
  // Zero and negative pids signal whole process groups.
  const isOnePid = Number.isSafeInteger(pid) && (pid as number) > 0;
  return (
    isOnePid && typeof startedAt === 'string' && typeof command === 'string'
  );
}

export function createHostChildren(deps: HostChildrenDeps): HostChildren {
  const { file, processes, timers, report } = deps;
  const running = new Set<ChildProcessWithoutNullStreams>();
  const recorded = new Map<number, RecordedChild>();

  function saveRecord() {
    try {
      if (recorded.size === 0) {
        rmSync(file, { force: true });
      } else {
        replaceFile(file, JSON.stringify([...recorded.values()]));
      }
    } catch (error) {
      report(`children record: ${(error as Error).message}`);
    }
  }

  async function recordChild(
    child: ChildProcessWithoutNullStreams,
    pid: number,
  ) {
    try {
      const reported = await processes.report(pid);
      if (reported !== null && running.has(child)) {
        recorded.set(pid, { pid, ...reported });
        saveRecord();
      }
    } catch (error) {
      report(`child ${pid} not recorded: ${(error as Error).message}`);
    }
  }

  function readLeftovers(): RecordedChild[] {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        report(`children record: ${(error as Error).message}`);
      }
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.every(isRecordedChild)) {
        return parsed;
      }
    } catch {
      // Reported below, as a record of the wrong shape is.
    }
    report(`children record unreadable, nothing ended: ${text}`);
    return [];
  }

  // Whether `leftover`'s pid is still the process recorded. Every signal to a leftover follows a true from this.
  async function isStillRecorded(leftover: RecordedChild): Promise<boolean> {
    const { pid, startedAt, command } = leftover;
    let now: ProcessReport | null;
    try {
      now = await processes.report(pid);
    } catch (error) {
      report(`pid ${pid} left alone: ${(error as Error).message}`);
      return false;
    }
    if (now === null) {
      return false;
    }
    if (now.startedAt === startedAt && now.command === command) {
      return true;
    }
    report(
      `pid ${pid} left alone: it is ${now.command} from ${now.startedAt}, the record has ${command} from ${startedAt}`,
    );
    return false;
  }

  async function endsWithinGrace(leftover: RecordedChild): Promise<boolean> {
    let isGraceOver = false as boolean;
    const grace = timers.set(() => {
      isGraceOver = true;
    }, HOST_END_GRACE_MS);
    while (!isGraceOver) {
      await new Promise((resolve) => {
        timers.set(() => resolve(null), LEFTOVER_POLL_MS);
      });
      if (!(await isStillRecorded(leftover))) {
        timers.clear(grace);
        return true;
      }
    }
    return false;
  }

  async function endLeftover(leftover: RecordedChild) {
    if (!(await isStillRecorded(leftover))) {
      return;
    }
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
      try {
        processes.signal(leftover.pid, signal);
      } catch (error) {
        report(`pid ${leftover.pid} ${signal}: ${(error as Error).message}`);
        return;
      }
      report(`pid ${leftover.pid}, left by the last host: sent ${signal}`);
      if (await endsWithinGrace(leftover)) {
        return;
      }
    }
    report(`pid ${leftover.pid} still runs after SIGKILL`);
  }

  return {
    spawn(command, args, options) {
      const child = deps.spawn(command, args, options);
      const { pid } = child;
      if (pid === undefined) {
        return child;
      }
      running.add(child);
      child.once('close', () => {
        running.delete(child);
        if (recorded.delete(pid)) {
          saveRecord();
        }
      });
      void recordChild(child, pid);
      return child;
    },
    async endLeftovers() {
      await Promise.all(readLeftovers().map(endLeftover));
      saveRecord();
    },
    killAll() {
      for (const child of running) {
        child.kill('SIGTERM');
      }
    },
  };
}
