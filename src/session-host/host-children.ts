import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Timers } from '../contracts/ambient';
import {
  HOST_END_GRACE_MS,
  type HostChildrenRecord,
  hostChildrenFile,
  isHostChildrenFile,
  type RecordedHostChild,
  SESSION_HOST_PROTOCOL,
} from '../contracts/session-host-protocol';
import type { OsProcesses, ProcessReport } from './os-processes';
import type { HostSpawn } from './process-table';
import { replaceFile } from './replace-file';

const LEFTOVER_POLL_MS = 200;

// A host's children, and what a host that died left of its own. A host that dies does not take its children with it,
// so each child stays on its host's own record file from spawn to close, for a later host to end.
export interface HostChildren {
  // Starts a child as the `spawn` dep does, and records it. The record gains it once the OS has reported it.
  spawn: HostSpawn;
  // Reads every protocol's record. One whose writer may still run stays as it is, its children untouched, and is
  // reported, as is one it cannot read. Of each other, ends each process that is still the one recorded: SIGTERM, then
  // SIGKILL after `HOST_END_GRACE_MS`. A process it cannot confirm is left alone and reported. Resolves once each is
  // gone or its steps have run, with that record removed. Never rejects. Call it once, while owning the channel, before
  // the first `spawn`.
  endLeftovers(): Promise<void>;
  // For a host on its way down: sends each running child SIGTERM, leaving the record for the next host.
  killAll(): void;
}

export interface HostChildrenDeps {
  folder: string;
  // This host's own, naming its record and proving it the writer.
  pid: number;
  spawn: HostSpawn;
  processes: OsProcesses;
  timers: Timers;
  report(message: string): void;
}

type RecordWriter = HostChildrenRecord['writer'];

function isOnePid(pid: unknown): boolean {
  // Zero and negative pids signal whole process groups.
  return Number.isSafeInteger(pid) && (pid as number) > 0;
}

function isRecordedChild(value: unknown): value is RecordedHostChild {
  const { pid, startedAt, command } = (value ??
    {}) as Partial<RecordedHostChild>;
  return (
    isOnePid(pid) &&
    typeof startedAt === 'string' &&
    typeof command === 'string'
  );
}

function isChildrenRecord(value: unknown): value is HostChildrenRecord {
  const { writer, children } = (value ?? {}) as Partial<HostChildrenRecord>;
  return (
    isOnePid(writer?.pid) &&
    typeof writer?.startedAt === 'string' &&
    Array.isArray(children) &&
    children.every(isRecordedChild)
  );
}

export function createHostChildren(deps: HostChildrenDeps): HostChildren {
  const { folder, processes, timers, report } = deps;
  const ownFile = path.join(
    folder,
    hostChildrenFile(SESSION_HOST_PROTOCOL, deps.pid),
  );
  const running = new Set<ChildProcessWithoutNullStreams>();
  const recorded = new Map<number, RecordedHostChild>();
  let ownWriter: RecordWriter | null = null;

  function saveRecord(writer: RecordWriter) {
    try {
      if (recorded.size === 0) {
        rmSync(ownFile, { force: true });
      } else {
        const record: HostChildrenRecord = {
          writer,
          children: [...recorded.values()],
        };
        replaceFile(ownFile, JSON.stringify(record));
      }
    } catch (error) {
      report(`children record: ${(error as Error).message}`);
    }
  }

  async function askOwnWriter(): Promise<RecordWriter> {
    if (ownWriter === null) {
      const own = await processes.report(deps.pid);
      if (own === null) {
        throw new Error(`the OS reports no pid ${deps.pid}`);
      }
      ownWriter = { pid: deps.pid, startedAt: own.startedAt };
    }
    return ownWriter;
  }

  async function recordChild(
    child: ChildProcessWithoutNullStreams,
    pid: number,
  ) {
    try {
      const [writer, reported] = await Promise.all([
        askOwnWriter(),
        processes.report(pid),
      ]);
      if (reported !== null && running.has(child)) {
        recorded.set(pid, { pid, ...reported });
        saveRecord(writer);
      }
    } catch (error) {
      report(`child ${pid} not recorded: ${(error as Error).message}`);
    }
  }

  function readLeftRecord(file: string): HostChildrenRecord | null {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        report(`children record: ${(error as Error).message}`);
      }
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (isChildrenRecord(parsed)) {
        return parsed;
      }
    } catch {
      // Reported below, as a record of the wrong shape is.
    }
    report(`children record unreadable, nothing ended: ${file}: ${text}`);
    return null;
  }

  // A process with the writer's pid and start time is the writer, whatever the channel says.
  async function isWriterGone(
    file: string,
    writer: RecordWriter,
  ): Promise<boolean> {
    let now: ProcessReport | null;
    try {
      now = await processes.report(writer.pid);
    } catch (error) {
      report(`${file} left alone: ${(error as Error).message}`);
      return false;
    }
    if (now?.startedAt === writer.startedAt) {
      report(`${file} left alone: its host, pid ${writer.pid}, still runs`);
      return false;
    }
    return true;
  }

  // Whether `leftover`'s pid is still the process recorded: an exec or a retitle changes a process's command, never its
  // start time. Every signal to a leftover follows a true from this.
  async function isStillRecorded(
    leftover: RecordedHostChild,
  ): Promise<boolean> {
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
    if (now.startedAt === startedAt) {
      return true;
    }
    report(
      `pid ${pid} left alone: it is ${now.command} from ${now.startedAt}, the record has ${command} from ${startedAt}`,
    );
    return false;
  }

  async function endsWithinGrace(
    leftover: RecordedHostChild,
  ): Promise<boolean> {
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

  async function endLeftover(leftover: RecordedHostChild) {
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

  async function endWhatRecordLeft(file: string) {
    const record = readLeftRecord(file);
    if (record === null || !(await isWriterGone(file, record.writer))) {
      return;
    }
    await Promise.all(record.children.map(endLeftover));
    try {
      rmSync(file, { force: true });
    } catch (error) {
      report(`children record: ${(error as Error).message}`);
    }
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
        if (ownWriter !== null && recorded.delete(pid)) {
          saveRecord(ownWriter);
        }
      });
      void recordChild(child, pid);
      return child;
    },
    async endLeftovers() {
      try {
        const files = readdirSync(folder)
          .filter(isHostChildrenFile)
          .map((name) => path.join(folder, name));
        await Promise.all(files.map(endWhatRecordLeft));
      } catch (error) {
        report(`children records: ${(error as Error).message}`);
      }
    },
    killAll() {
      for (const child of running) {
        child.kill('SIGTERM');
      }
    },
  };
}
