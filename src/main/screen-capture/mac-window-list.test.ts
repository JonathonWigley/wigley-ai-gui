import { describe, expect, it } from 'vitest';
import { FakeProcesses } from '../../shared/fake-processes';
import {
  createMacWindowList,
  MAC_WINDOW_LIST_SCRIPT,
  parseMacWindowList,
} from './mac-window-list';

const OSASCRIPT = '/usr/bin/osascript';
const OSASCRIPT_ARGS = ['-l', 'JavaScript', '-e', MAC_WINDOW_LIST_SCRIPT];

// Captured with MAC_WINDOW_LIST_SCRIPT on an M2 Max, macOS 26, on 2026-11-10,
// cut to three windows and the Unity title shortened. The third is an
// untitled helper window.
const CAPTURED =
  '[{"number":15805,"processId":31735,"title":"Auri","x":1148,"y":30,"width":2292,"height":1329},' +
  '{"number":16059,"processId":76769,"title":"Main - Sample - Unity 6.3 LTS (6000.3.12f1) <Metal>","x":1148,"y":30,"width":2292,"height":1329},' +
  '{"number":16074,"processId":89012,"title":"","x":0,"y":1437,"width":3,"height":3}]';

const CAPTURED_WINDOWS = [
  {
    number: 15805,
    processId: 31735,
    title: 'Auri',
    bounds: { x: 1148, y: 30, width: 2292, height: 1329 },
  },
  {
    number: 16059,
    processId: 76769,
    title: 'Main - Sample - Unity 6.3 LTS (6000.3.12f1) <Metal>',
    bounds: { x: 1148, y: 30, width: 2292, height: 1329 },
  },
  {
    number: 16074,
    processId: 89012,
    title: '',
    bounds: { x: 0, y: 1437, width: 3, height: 3 },
  },
];

const FRACTIONAL_ROW = {
  number: 271,
  processId: 512,
  title: 'Notes',
  x: 40.5,
  y: -900,
  width: 812.5,
  height: 600,
};

describe('parseMacWindowList', () => {
  it.each<{ name: string; stdout: string; expected: object[] }>([
    {
      name: 'three captured windows',
      stdout: CAPTURED,
      expected: CAPTURED_WINDOWS,
    },
    {
      name: 'fractional bounds above the main display',
      stdout: JSON.stringify([FRACTIONAL_ROW]),
      expected: [
        {
          number: 271,
          processId: 512,
          title: 'Notes',
          bounds: { x: 40.5, y: -900, width: 812.5, height: 600 },
        },
      ],
    },
    {
      name: 'a row missing its pid',
      stdout: JSON.stringify([{ ...FRACTIONAL_ROW, processId: undefined }]),
      expected: [],
    },
    { name: 'no windows', stdout: '[]', expected: [] },
  ])('parseMacWindowList_ReadsEachWindow ($name)', ({ stdout, expected }) => {
    expect(parseMacWindowList(stdout)).toEqual(expected);
  });

  it.each<{ name: string; stdout: string }>([
    { name: 'not JSON', stdout: 'execution error: Error: ReferenceError' },
    { name: 'not an array', stdout: '{"number":1}' },
  ])('parseMacWindowList_NoArray ($name throws)', ({ stdout }) => {
    expect(() => parseMacWindowList(stdout)).toThrow(/osascript/);
  });
});

describe('createMacWindowList', () => {
  it('list_RunsTheScriptAndParsesItsWindows', async () => {
    const processes = new FakeProcesses();
    processes.script(OSASCRIPT, OSASCRIPT_ARGS, {
      code: 0,
      stdout: CAPTURED,
      stderr: '',
      timedOut: false,
    });

    const windows = await createMacWindowList(processes).list();

    expect(windows).toEqual(CAPTURED_WINDOWS);
    expect(processes.runs).toEqual([
      {
        command: OSASCRIPT,
        args: OSASCRIPT_ARGS,
        cwd: undefined,
        timeoutMs: 10000,
        unsetEnv: undefined,
      },
    ]);
  });
});
