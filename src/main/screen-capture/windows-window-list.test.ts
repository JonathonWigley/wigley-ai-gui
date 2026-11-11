import { describe, expect, it } from 'vitest';
import { FakeProcesses } from '../../shared/fake-processes';
import {
  createWindowsWindowList,
  parseWindowsWindowList,
  WINDOWS_WINDOW_LIST_SCRIPT,
} from './windows-window-list';

const POWERSHELL = 'powershell.exe';
const POWERSHELL_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  Buffer.from(WINDOWS_WINDOW_LIST_SCRIPT, 'utf16le').toString('base64'),
];

// Rows in WINDOWS_WINDOW_LIST_SCRIPT's shape, built here: the script cannot
// run on the Mac these tests were written on. Frame bounds are physical
// pixels; the 192 dpi window sits on a monitor left of the primary.
const ROW_96 = {
  number: 197642,
  processId: 4120,
  title: 'Main - Sample - Unity 6000.3.12f1',
  left: 10,
  top: 20,
  right: 1930,
  bottom: 1100,
  dpi: 96,
};
const ROW_120 = {
  number: 65874,
  processId: 7716,
  title: 'Game',
  left: 301,
  top: 150,
  right: 1201,
  bottom: 900,
  dpi: 120,
};
const ROW_144 = {
  number: 3214560,
  processId: 9932,
  title: '',
  left: 300,
  top: 150,
  right: 1200,
  bottom: 900,
  dpi: 144,
};
const ROW_192 = {
  number: 1180212,
  processId: 4120,
  title: 'Console',
  left: -3000,
  top: 200,
  right: -1000,
  bottom: 1400,
  dpi: 192,
};

describe('parseWindowsWindowList', () => {
  it.each<{ name: string; rows: object[]; expected: object[] }>([
    {
      name: 'one window at each scale',
      rows: [ROW_96, ROW_120, ROW_144, ROW_192],
      expected: [
        {
          number: 197642,
          processId: 4120,
          title: 'Main - Sample - Unity 6000.3.12f1',
          bounds: { x: 10, y: 20, width: 1920, height: 1080 },
        },
        {
          number: 65874,
          processId: 7716,
          title: 'Game',
          bounds: { x: 240.8, y: 120, width: 720, height: 600 },
        },
        {
          number: 3214560,
          processId: 9932,
          title: '',
          bounds: { x: 200, y: 100, width: 600, height: 500 },
        },
        {
          number: 1180212,
          processId: 4120,
          title: 'Console',
          bounds: { x: -1500, y: 100, width: 1000, height: 600 },
        },
      ],
    },
    {
      name: 'a row missing its dpi',
      rows: [{ ...ROW_144, dpi: undefined }, ROW_120],
      expected: [{ number: 65874 }],
    },
    { name: 'no windows', rows: [], expected: [] },
  ])('parseWindowsWindowList_ReadsEachWindow ($name)', ({ rows, expected }) => {
    expect(parseWindowsWindowList(JSON.stringify(rows))).toMatchObject(
      expected,
    );
  });

  it.each<{ name: string; stdout: string }>([
    { name: 'not JSON', stdout: 'Add-Type : Cannot add type.' },
    { name: 'not an array', stdout: JSON.stringify(ROW_96) },
  ])('parseWindowsWindowList_NoArray ($name throws)', ({ stdout }) => {
    expect(() => parseWindowsWindowList(stdout)).toThrow(/powershell\.exe/);
  });
});

describe('createWindowsWindowList', () => {
  it('list_RunsTheEncodedScriptAndParsesItsWindows', async () => {
    const processes = new FakeProcesses();
    processes.script(POWERSHELL, POWERSHELL_ARGS, {
      code: 0,
      stdout: JSON.stringify([ROW_192]),
      stderr: '',
      timedOut: false,
    });

    const windows = await createWindowsWindowList(processes).list();

    expect(windows).toEqual([
      {
        number: 1180212,
        processId: 4120,
        title: 'Console',
        bounds: { x: -1500, y: 100, width: 1000, height: 600 },
      },
    ]);
    expect(processes.runs).toEqual([
      {
        command: POWERSHELL,
        args: POWERSHELL_ARGS,
        cwd: undefined,
        timeoutMs: 10000,
        unsetEnv: undefined,
      },
    ]);
    expect(
      Buffer.from(processes.runs[0].args[3], 'base64').toString('utf16le'),
    ).toBe(WINDOWS_WINDOW_LIST_SCRIPT);
  });
});
