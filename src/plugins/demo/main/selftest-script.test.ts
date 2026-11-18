import { describe, expect, it } from 'vitest';
import type { DemoRunReport } from '../contract';
import { demoSelfTestScript, reportProblems } from './selftest-script';

describe('demoSelfTestScript', () => {
  it.each<{ report: DemoRunReport; expected: string[] }>([
    { report: { missing: [], failed: [] }, expected: [] },
    {
      report: { missing: ['c', 'e'], failed: ['p.one', 'q.two'] },
      expected: [
        'c has no demo step and no demoSkip',
        'e has no demo step and no demoSkip',
        'step p.one failed',
        'step q.two failed',
      ],
    },
  ])(
    'reportProblems_Report_NamesEachMissingThenFailed: $expected',
    ({ report, expected }) => {
      expect(reportProblems(report)).toEqual(expected);
    },
  );

  it('open_Run_SendsTheOpenAndWaitsForTheNextReport', async () => {
    const opened: number[] = [];
    const report: DemoRunReport = { missing: ['c'], failed: ['p.one'] };
    const script = demoSelfTestScript({
      open: (run) => void opened.push(run),
      nextReport: async () => report,
    });

    const { shownLine, result } = script.open(3);

    expect({ opened, shownLine, result: await result }).toEqual({
      opened: [3],
      shownLine: '[demo] self-test run 3',
      result: report,
    });
  });
});
