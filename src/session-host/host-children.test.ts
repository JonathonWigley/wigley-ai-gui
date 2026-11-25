import {
  type ChildProcessWithoutNullStreams,
  spawn as spawnChild,
} from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../contracts/ambient';
import {
  type HostChildrenRecord,
  hostChildrenFile,
  type RecordedHostChild,
  SESSION_HOST_PROTOCOL,
} from '../contracts/session-host-protocol';
import { osPlatform } from '../shared/os-platform';
import { createHostChildren } from './host-children';
import {
  createOsProcesses,
  type OsProcesses,
  type ProcessReport,
} from './os-processes';
import { type FakeChild, fakeChild } from './session-host-test-doubles';

const REPORT: ProcessReport = { startedAt: 'then', command: '/bin/agent' };
const OWN_PID = 4242;
const OWN_FILE = hostChildrenFile(SESSION_HOST_PROTOCOL, OWN_PID);
const LAST_HOST: HostChildrenRecord['writer'] = {
  pid: 99,
  startedAt: 'earlier',
};
const LAST_HOST_FILE = hostChildrenFile(SESSION_HOST_PROTOCOL, LAST_HOST.pid);
// The real `ps` gives this test's own process another start time, so its pid reads as reused.
const REUSED_WRITER: HostChildrenRecord['writer'] = {
  pid: process.pid,
  startedAt: 'long ago',
};
const SECONDS_PER_REAL_SECOND = 30;
const ENDS_ON_SIGTERM = 'echo ready; sleep 3';
const IGNORES_SIGTERM = 'trap "" TERM; echo ready; sleep 3';

// Real time run fast, so a grace passes in a tenth of a second.
const fastTimers: Timers = {
  set: (run, ms) =>
    setTimeout(run, ms / SECONDS_PER_REAL_SECOND)[Symbol.toPrimitive](),
  clear: (handle) => clearTimeout(handle),
};

const folders: string[] = [];
const madeChildren: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
  for (const child of madeChildren.splice(0)) {
    child.kill('SIGKILL');
  }
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function tempFolder() {
  const folder = mkdtempSync(path.join(tmpdir(), 'host-children-'));
  folders.push(folder);
  return folder;
}

function setUp(processes: OsProcesses) {
  const folder = tempFolder();
  const reports: string[] = [];
  const spawned: FakeChild[] = [];
  const children = createHostChildren({
    folder,
    pid: OWN_PID,
    spawn: () => {
      const fake = fakeChild();
      spawned.push(fake);
      return fake.child;
    },
    processes,
    timers: fastTimers,
    report: (message) => reports.push(message),
  });
  return {
    children,
    folder,
    ownFile: path.join(folder, OWN_FILE),
    reports,
    spawned,
  };
}

function writeRecord(
  folder: string,
  name: string,
  writer: HostChildrenRecord['writer'],
  children: RecordedHostChild[],
) {
  const file = path.join(folder, name);
  const record: HostChildrenRecord = { writer, children };
  writeFileSync(file, JSON.stringify(record));
  return file;
}

// Answers `answer` for every pid, and fails a test that signals anything.
function fakeProcesses(
  answer: () => Promise<ProcessReport | null>,
): OsProcesses {
  return {
    report: answer,
    signal(pid) {
      throw new Error(`a test signalled pid ${pid}`);
    },
  };
}

// The real OS, and a guard that nothing but this test's own children is signalled.
function realProcesses() {
  const real = createOsProcesses(osPlatform(process.platform));
  const signals: string[] = [];
  const processes: OsProcesses = {
    report: real.report,
    signal(pid, signal) {
      if (!madeChildren.some((child) => child.pid === pid)) {
        throw new Error(`a test signalled pid ${pid}`);
      }
      signals.push(signal);
      real.signal(pid, signal);
    },
  };
  return { processes, signals, real };
}

// A machine holding `running`, by pid, that takes each signal down in `signals` and then runs `afterSignal`.
function fakeMachine(
  running: Map<number, ProcessReport>,
  afterSignal: (pid: number, signal: string) => void = (pid) => {
    running.delete(pid);
  },
) {
  const signals: string[] = [];
  const processes: OsProcesses = {
    report: (pid) => Promise.resolve(running.get(pid) ?? null),
    signal(pid, signal) {
      signals.push(`${pid} ${signal}`);
      afterSignal(pid, signal);
    },
  };
  return { processes, signals };
}

async function runningShell(script: string) {
  const child = spawnChild('/bin/sh', ['-c', script]);
  madeChildren.push(child);
  await once(child.stdout, 'data');
  return { child, pid: child.pid as number };
}

describe.skipIf(process.platform === 'win32')('a real leftover', () => {
  it.each([
    {
      label: 'it ends on SIGTERM',
      script: ENDS_ON_SIGTERM,
      recordedCommand: null,
      signals: ['SIGTERM'],
    },
    {
      label: 'it ignores SIGTERM',
      script: IGNORES_SIGTERM,
      recordedCommand: null,
      signals: ['SIGTERM', 'SIGKILL'],
    },
    {
      label: 'its command changed since the record',
      script: ENDS_ON_SIGTERM,
      recordedCommand: '/usr/bin/env',
      signals: ['SIGTERM'],
    },
  ])(
    'endLeftovers_SameStartTime_EndsIt: $label',
    async ({ script, recordedCommand, signals: expected }) => {
      const { processes, signals, real } = realProcesses();
      const { children, folder } = setUp(processes);
      const { child, pid } = await runningShell(script);
      const exited = once(child, 'exit');
      const report = (await real.report(pid)) as ProcessReport;
      const file = writeRecord(folder, LAST_HOST_FILE, REUSED_WRITER, [
        { pid, ...report, command: recordedCommand ?? report.command },
      ]);

      await children.endLeftovers();

      const [, signal] = await exited;
      expect(signal).toBe(expected.at(-1));
      expect(signals).toEqual(expected);
      expect(existsSync(file)).toBe(false);
    },
  );

  it('endLeftovers_AnotherStartTime_LeavesItAloneAndReports', async () => {
    const { processes, signals, real } = realProcesses();
    const { children, folder, reports } = setUp(processes);
    const { child, pid } = await runningShell(ENDS_ON_SIGTERM);
    const report = (await real.report(pid)) as ProcessReport;
    const file = writeRecord(folder, LAST_HOST_FILE, REUSED_WRITER, [
      { pid, startedAt: 'long ago', command: report.command },
    ]);

    await children.endLeftovers();

    expect(signals).toEqual([]);
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain(`pid ${pid} left alone`);
    expect(existsSync(file)).toBe(false);
  });

  it('endLeftovers_PidGone_SignalsNothing', async () => {
    const { processes, signals, real } = realProcesses();
    const { children, folder, reports } = setUp(processes);
    const { child, pid } = await runningShell(ENDS_ON_SIGTERM);
    const report = (await real.report(pid)) as ProcessReport;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const file = writeRecord(folder, LAST_HOST_FILE, REUSED_WRITER, [
      { pid, ...report },
    ]);

    await children.endLeftovers();

    expect(signals).toEqual([]);
    expect(reports).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('killAll_RunningChildren_SendsEachSIGTERMAndKeepsTheRecord', async () => {
    const { processes, signals } = realProcesses();
    const folder = tempFolder();
    const file = path.join(
      folder,
      hostChildrenFile(SESSION_HOST_PROTOCOL, process.pid),
    );
    const children = createHostChildren({
      folder,
      pid: process.pid,
      spawn: (command, args) => {
        const child = spawnChild(command, args);
        madeChildren.push(child);
        return child;
      },
      processes,
      timers: fastTimers,
      report: () => {},
    });
    const first = children.spawn('/bin/sh', ['-c', ENDS_ON_SIGTERM], {
      cwd: tmpdir(),
      env: {},
    });
    const second = children.spawn('/bin/sh', ['-c', ENDS_ON_SIGTERM], {
      cwd: tmpdir(),
      env: {},
    });
    // A shell's pty, which the host starts outside `spawn`.
    const shell = await runningShell(ENDS_ON_SIGTERM);
    children.recordPid(shell.pid);
    const exits = [
      once(first, 'exit'),
      once(second, 'exit'),
      once(shell.child, 'exit'),
    ];
    await vi.waitFor(() => {
      const record = JSON.parse(
        readFileSync(file, 'utf8'),
      ) as HostChildrenRecord;
      const pids = record.children.map(({ pid }) => pid);
      expect(new Set(pids)).toEqual(
        new Set([first.pid, second.pid, shell.pid]),
      );
    });

    children.killAll();

    const ended = await Promise.all(exits);
    expect(ended.map(([, signal]) => signal as string)).toEqual([
      'SIGTERM',
      'SIGTERM',
      'SIGTERM',
    ]);
    // The children's handles sent theirs; only the shell, which has none, goes through the OS.
    expect(signals).toEqual(['SIGTERM']);
    expect(existsSync(file)).toBe(true);
  });
});

describe('the children record', () => {
  it('spawn_ToClose_RecordHoldsTheChildOnlyWhileItRuns', async () => {
    const own = { startedAt: 'own start', command: '/bin/host' };
    const { processes } = fakeMachine(
      new Map([
        [OWN_PID, own],
        [4321, REPORT],
      ]),
    );
    const { children, ownFile, spawned } = setUp(processes);

    children.spawn('/bin/agent', [], { cwd: '/work', env: {} });
    await vi.waitFor(() => expect(existsSync(ownFile)).toBe(true));
    expect(JSON.parse(readFileSync(ownFile, 'utf8'))).toEqual({
      writer: { pid: OWN_PID, startedAt: own.startedAt },
      children: [{ pid: 4321, ...REPORT }],
    });

    spawned[0].close();

    expect(existsSync(ownFile)).toBe(false);
  });

  it('spawn_ToClose_LeavesAnotherHostsRecord', async () => {
    const { processes } = fakeMachine(
      new Map([
        [OWN_PID, REPORT],
        [4321, REPORT],
      ]),
    );
    const { children, folder, ownFile, spawned } = setUp(processes);
    const other = writeRecord(folder, LAST_HOST_FILE, LAST_HOST, [
      { pid: 7, ...REPORT },
    ]);
    const otherText = readFileSync(other, 'utf8');

    children.spawn('/bin/agent', [], { cwd: '/work', env: {} });
    await vi.waitFor(() => expect(existsSync(ownFile)).toBe(true));
    spawned[0].close();

    expect(readFileSync(other, 'utf8')).toBe(otherText);
  });

  it('recordPid_ToDispose_RecordHoldsThePidOnlyUntilDisposed', async () => {
    const own = { startedAt: 'own start', command: '/bin/host' };
    const { processes } = fakeMachine(
      new Map([
        [OWN_PID, own],
        [77, REPORT],
      ]),
    );
    const { children, ownFile } = setUp(processes);

    const recorded = children.recordPid(77);
    await vi.waitFor(() => expect(existsSync(ownFile)).toBe(true));
    expect(JSON.parse(readFileSync(ownFile, 'utf8'))).toEqual({
      writer: { pid: OWN_PID, startedAt: own.startedAt },
      children: [{ pid: 77, ...REPORT }],
    });

    recorded.dispose();

    expect(existsSync(ownFile)).toBe(false);
  });

  it('recordPid_Kill_SendsSIGKILLUntilDisposed', () => {
    const { processes, signals } = fakeMachine(
      new Map([
        [OWN_PID, REPORT],
        [77, REPORT],
      ]),
      () => {},
    );
    const { children } = setUp(processes);
    const recorded = children.recordPid(77);

    recorded.kill();
    expect(signals).toEqual(['77 SIGKILL']);

    recorded.dispose();
    recorded.kill();
    expect(signals).toEqual(['77 SIGKILL']);
  });

  it('spawn_ClosesBeforeTheOSReports_RecordsNothing', async () => {
    let answer = (_report: ProcessReport) => {};
    const reported = new Promise<ProcessReport>((resolve) => {
      answer = resolve;
    });
    const { children, ownFile, spawned } = setUp(fakeProcesses(() => reported));

    children.spawn('/bin/agent', [], { cwd: '/work', env: {} });
    spawned[0].close();
    answer(REPORT);
    await reported;
    await new Promise((resolve) => setImmediate(resolve));

    expect(existsSync(ownFile)).toBe(false);
  });

  it('spawn_NeverRan_RecordsNothing', () => {
    const failing = fakeChild(false);
    const report = vi.fn(() => Promise.resolve(REPORT));
    const children = createHostChildren({
      folder: tempFolder(),
      pid: OWN_PID,
      spawn: () => failing.child,
      processes: fakeProcesses(report),
      timers: fastTimers,
      report: () => {},
    });

    children.spawn('/bin/agent', [], { cwd: '/work', env: {} });

    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'no record', leftChildren: null },
    { label: 'no children', leftChildren: [] },
  ])(
    'endLeftovers_EmptyRecord_EndsNothing: $label',
    async ({ leftChildren }) => {
      const { processes, signals } = fakeMachine(new Map());
      const { children, folder, reports } = setUp(processes);
      if (leftChildren !== null) {
        writeRecord(folder, LAST_HOST_FILE, LAST_HOST, leftChildren);
      }

      await children.endLeftovers();

      expect(signals).toEqual([]);
      expect(reports).toEqual([]);
      expect(existsSync(path.join(folder, LAST_HOST_FILE))).toBe(false);
    },
  );

  it.each([
    { label: 'not JSON', text: '[{"pid":1' },
    { label: 'no writer or children', text: '{}' },
    { label: 'a bare list', text: '[{"pid":7,"startedAt":"a","command":"b"}]' },
    {
      label: 'a writer with no start time',
      text: '{"writer":{"pid":9},"children":[]}',
    },
    {
      label: 'a writer with pid zero',
      text: '{"writer":{"pid":0,"startedAt":"a"},"children":[]}',
    },
    ...[
      {
        label: 'a negative pid',
        child: '{"pid":-1,"startedAt":"a","command":"b"}',
      },
      { label: 'pid zero', child: '{"pid":0,"startedAt":"a","command":"b"}' },
      { label: 'no identity', child: '{"pid":7}' },
      { label: 'a null entry', child: 'null' },
    ].map(({ label, child }) => ({
      label,
      text: `{"writer":{"pid":9,"startedAt":"a"},"children":[${child}]}`,
    })),
  ])(
    'endLeftovers_UnreadableRecord_EndsNothingAndReports: $label',
    async ({ text }) => {
      const report = vi.fn(() => Promise.resolve(REPORT));
      const { children, folder, reports } = setUp(fakeProcesses(report));
      const file = path.join(folder, LAST_HOST_FILE);
      writeFileSync(file, text);

      await children.endLeftovers();

      expect(report).not.toHaveBeenCalled();
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain('children record unreadable');
      expect(readFileSync(file, 'utf8')).toBe(text);
    },
  );

  const LEFT: RecordedHostChild[] = [
    { pid: 7, startedAt: 'seven', command: '/bin/agent' },
    { pid: 8, startedAt: 'eight', command: '/bin/agent' },
  ];
  const leftRunning = () =>
    new Map<number, ProcessReport>(
      LEFT.map(({ pid, startedAt, command }) => [pid, { startedAt, command }]),
    );

  it.each([
    {
      label: 'its pid is gone',
      writerNow: null,
      leavesIt: false,
    },
    {
      label: 'its pid is another process now',
      writerNow: { startedAt: 'later', command: '/bin/host' },
      leavesIt: false,
    },
    {
      label: 'it still runs',
      writerNow: { startedAt: LAST_HOST.startedAt, command: '/bin/host' },
      leavesIt: true,
    },
  ])(
    'endLeftovers_RecordWriter_ReapsOnlyOnceItIsGone: $label',
    async ({ writerNow, leavesIt }) => {
      const running = leftRunning();
      if (writerNow !== null) {
        running.set(LAST_HOST.pid, writerNow);
      }
      const { processes, signals } = fakeMachine(running);
      const { children, folder, reports } = setUp(processes);
      const file = writeRecord(folder, LAST_HOST_FILE, LAST_HOST, LEFT);

      await children.endLeftovers();

      expect(new Set(signals)).toEqual(
        new Set(leavesIt ? [] : ['7 SIGTERM', '8 SIGTERM']),
      );
      expect(existsSync(file)).toBe(leavesIt);
      if (leavesIt) {
        expect(reports).toEqual([
          expect.stringContaining(`pid ${LAST_HOST.pid}, still runs`),
        ]);
      }
    },
  );

  it('endLeftovers_OSCannotBeAsked_LeavesTheRecordAndReports', async () => {
    const { children, folder, reports } = setUp(
      fakeProcesses(() => Promise.reject(new Error('no ps'))),
    );
    const file = writeRecord(folder, LAST_HOST_FILE, LAST_HOST, LEFT);

    await children.endLeftovers();

    expect(reports).toEqual([expect.stringContaining('left alone: no ps')]);
    expect(existsSync(file)).toBe(true);
  });

  it('endLeftovers_OSFailsOnAChild_LeavesThatChildAndReports', async () => {
    const processes: OsProcesses = {
      report: (pid) =>
        pid === 7 ? Promise.reject(new Error('no ps')) : Promise.resolve(null),
      signal(pid) {
        throw new Error(`a test signalled pid ${pid}`);
      },
    };
    const { children, folder, reports } = setUp(processes);
    writeRecord(folder, LAST_HOST_FILE, LAST_HOST, [LEFT[0]]);

    await children.endLeftovers();

    expect(reports).toEqual(['pid 7 left alone: no ps']);
  });

  it('endLeftovers_EveryProtocolsRecord_EachByItsOwnWriter', async () => {
    const draining = { pid: 98, startedAt: 'older' };
    const running = leftRunning();
    running.set(draining.pid, { startedAt: 'older', command: '/bin/host' });
    running.set(9, { startedAt: 'nine', command: '/bin/agent' });
    const { processes, signals } = fakeMachine(running);
    const { children, folder } = setUp(processes);
    const oldGone = writeRecord(folder, hostChildrenFile(0, 99), LAST_HOST, [
      LEFT[0],
    ]);
    const oldDraining = writeRecord(folder, hostChildrenFile(0, 98), draining, [
      LEFT[1],
    ]);
    const newerGone = writeRecord(
      folder,
      hostChildrenFile(SESSION_HOST_PROTOCOL + 1, 97),
      { pid: 97, startedAt: 'newer' },
      [{ pid: 9, startedAt: 'nine', command: '/bin/agent' }],
    );

    await children.endLeftovers();

    expect(new Set(signals)).toEqual(new Set(['7 SIGTERM', '9 SIGTERM']));
    expect(existsSync(oldGone)).toBe(false);
    expect(existsSync(newerGone)).toBe(false);
    expect(existsSync(oldDraining)).toBe(true);
  });

  it.each([
    {
      label: 'its start time changes after SIGTERM',
      afterSignal: (running: Map<number, ProcessReport>) => {
        running.set(7, { startedAt: 'a new process', command: '/bin/other' });
      },
      signalled: ['7 SIGTERM'],
      reported: 'pid 7 left alone',
    },
    {
      label: 'it outlives SIGKILL',
      afterSignal: () => {},
      signalled: ['7 SIGTERM', '7 SIGKILL'],
      reported: 'pid 7 still runs after SIGKILL',
    },
    {
      label: 'the signal throws',
      afterSignal: () => {
        throw new Error('EPERM');
      },
      signalled: ['7 SIGTERM'],
      reported: 'pid 7 SIGTERM: EPERM',
    },
  ])(
    'endLeftovers_AfterASignal_StopsOrReports: $label',
    async ({ afterSignal, signalled, reported }) => {
      const running = new Map<number, ProcessReport>([
        [7, { startedAt: LEFT[0].startedAt, command: LEFT[0].command }],
      ]);
      const { processes, signals } = fakeMachine(running, () =>
        afterSignal(running),
      );
      const { children, folder, reports } = setUp(processes);
      const file = writeRecord(folder, LAST_HOST_FILE, LAST_HOST, [LEFT[0]]);

      await children.endLeftovers();

      expect(signals).toEqual(signalled);
      expect(reports).toContainEqual(expect.stringContaining(reported));
      expect(existsSync(file)).toBe(false);
    },
  );
});
