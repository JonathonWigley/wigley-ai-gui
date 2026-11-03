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
import { createHostChildren } from './host-children';
import {
  createOsProcesses,
  type OsProcesses,
  type ProcessReport,
} from './os-processes';
import { type FakeChild, fakeChild } from './session-host-test-doubles';

const REPORT: ProcessReport = { startedAt: 'then', command: '/bin/agent' };
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

function setUp(processes: OsProcesses) {
  const folder = mkdtempSync(path.join(tmpdir(), 'host-children-'));
  folders.push(folder);
  const file = path.join(folder, 'children.json');
  const reports: string[] = [];
  const spawned: FakeChild[] = [];
  const children = createHostChildren({
    file,
    spawn: () => {
      const fake = fakeChild();
      spawned.push(fake);
      return fake.child;
    },
    processes,
    timers: fastTimers,
    report: (message) => reports.push(message),
  });
  return { children, file, reports, spawned };
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
  const real = createOsProcesses(process.platform);
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
      const { children, file } = setUp(processes);
      const { child, pid } = await runningShell(script);
      const exited = once(child, 'exit');
      const report = (await real.report(pid)) as ProcessReport;
      writeFileSync(
        file,
        JSON.stringify([
          { pid, ...report, command: recordedCommand ?? report.command },
        ]),
      );

      await children.endLeftovers();

      const [, signal] = await exited;
      expect(signal).toBe(expected.at(-1));
      expect(signals).toEqual(expected);
      expect(existsSync(file)).toBe(false);
    },
  );

  it('endLeftovers_AnotherStartTime_LeavesItAloneAndReports', async () => {
    const { processes, signals, real } = realProcesses();
    const { children, file, reports } = setUp(processes);
    const { child, pid } = await runningShell(ENDS_ON_SIGTERM);
    const report = (await real.report(pid)) as ProcessReport;
    writeFileSync(
      file,
      JSON.stringify([{ pid, startedAt: 'long ago', command: report.command }]),
    );

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
    const { children, file, reports } = setUp(processes);
    const { child, pid } = await runningShell(ENDS_ON_SIGTERM);
    const report = await real.report(pid);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    writeFileSync(file, JSON.stringify([{ pid, ...report }]));

    await children.endLeftovers();

    expect(signals).toEqual([]);
    expect(reports).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it('killAll_RunningChildren_SendsEachSIGTERMAndKeepsTheRecord', async () => {
    const { processes, signals } = realProcesses();
    const folder = mkdtempSync(path.join(tmpdir(), 'host-children-'));
    folders.push(folder);
    const file = path.join(folder, 'children.json');
    const children = createHostChildren({
      file,
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
    const exits = [once(first, 'exit'), once(second, 'exit')];
    await vi.waitFor(() => {
      const pids = (
        JSON.parse(readFileSync(file, 'utf8')) as { pid: number }[]
      ).map(({ pid }) => pid);
      expect(new Set(pids)).toEqual(new Set([first.pid, second.pid]));
    });

    children.killAll();

    const ended = await Promise.all(exits);
    expect(ended.map(([, signal]) => signal as string)).toEqual([
      'SIGTERM',
      'SIGTERM',
    ]);
    // The handles did this, so the guarded route stays for the next host.
    expect(signals).toEqual([]);
    expect(existsSync(file)).toBe(true);
  });
});

describe('the children record', () => {
  it('spawn_ToClose_RecordHoldsTheChildOnlyWhileItRuns', async () => {
    const { children, file, spawned } = setUp(
      fakeProcesses(() => Promise.resolve(REPORT)),
    );

    children.spawn('/bin/agent', [], { cwd: '/work', env: {} });
    await vi.waitFor(() => expect(existsSync(file)).toBe(true));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([
      { pid: 1, ...REPORT },
    ]);

    spawned[0].close();

    expect(existsSync(file)).toBe(false);
  });

  it('spawn_ClosesBeforeTheOSReports_RecordsNothing', async () => {
    let answer = (_report: ProcessReport) => {};
    const reported = new Promise<ProcessReport>((resolve) => {
      answer = resolve;
    });
    const { children, file, spawned } = setUp(fakeProcesses(() => reported));

    children.spawn('/bin/agent', [], { cwd: '/work', env: {} });
    spawned[0].close();
    answer(REPORT);
    await reported;
    await new Promise((resolve) => setImmediate(resolve));

    expect(existsSync(file)).toBe(false);
  });

  it('spawn_NeverRan_RecordsNothing', () => {
    const failing = fakeChild(false);
    const report = vi.fn(() => Promise.resolve(REPORT));
    const folder = mkdtempSync(path.join(tmpdir(), 'host-children-'));
    folders.push(folder);
    const children = createHostChildren({
      file: path.join(folder, 'children.json'),
      spawn: () => failing.child,
      processes: fakeProcesses(report),
      timers: fastTimers,
      report: () => {},
    });

    children.spawn('/bin/agent', [], { cwd: '/work', env: {} });

    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'no file', text: null },
    { label: 'an empty list', text: '[]' },
  ])('endLeftovers_EmptyRecord_EndsNothing: $label', async ({ text }) => {
    const report = vi.fn(() => Promise.resolve(REPORT));
    const { children, file, reports } = setUp(fakeProcesses(report));
    if (text !== null) {
      writeFileSync(file, text);
    }

    await children.endLeftovers();

    expect(report).not.toHaveBeenCalled();
    expect(reports).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it.each([
    { label: 'not JSON', text: '[{"pid":1' },
    { label: 'not a list', text: '{}' },
    {
      label: 'a negative pid',
      text: '[{"pid":-1,"startedAt":"a","command":"b"}]',
    },
    { label: 'pid zero', text: '[{"pid":0,"startedAt":"a","command":"b"}]' },
    { label: 'no identity', text: '[{"pid":7}]' },
    { label: 'a null entry', text: '[null]' },
  ])(
    'endLeftovers_UnreadableRecord_EndsNothingAndReports: $label',
    async ({ text }) => {
      const report = vi.fn(() => Promise.resolve(REPORT));
      const { children, file, reports } = setUp(fakeProcesses(report));
      writeFileSync(file, text);

      await children.endLeftovers();

      expect(report).not.toHaveBeenCalled();
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain('children record unreadable');
      expect(existsSync(file)).toBe(false);
    },
  );

  it('endLeftovers_OSCannotBeAsked_LeavesItAloneAndReports', async () => {
    const { children, file, reports } = setUp(
      fakeProcesses(() => Promise.reject(new Error('no ps'))),
    );
    writeFileSync(file, JSON.stringify([{ pid: 7, ...REPORT }]));

    await children.endLeftovers();

    expect(reports).toEqual(['pid 7 left alone: no ps']);
  });
});
