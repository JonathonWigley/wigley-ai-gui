import { describe, expect, it } from 'vitest';
import { parsePsReport, parseWindowsReport } from './os-processes';

describe('process reports', () => {
  it.each([
    {
      label: 'a padded day and a path with a space',
      line: 'Tue Nov  3 23:42:42 2026     /Applications/My App/agent\n',
      report: {
        startedAt: 'Tue Nov  3 23:42:42 2026',
        command: '/Applications/My App/agent',
      },
    },
    { label: 'no process', line: '', report: null },
    {
      label: 'no command, as a dying process may report',
      line: 'Tue Nov  3 23:42:42 2026',
      report: null,
    },
  ])('parsePsReport_Cases: $label', ({ line, report }) => {
    expect(parsePsReport(line)).toEqual(report);
  });

  it.each([
    {
      label: 'a path with a space',
      line: '2026-11-03T23:42:42.1234567Z\tC:\\Program Files\\agent.exe\r\n',
      report: {
        startedAt: '2026-11-03T23:42:42.1234567Z',
        command: 'C:\\Program Files\\agent.exe',
      },
    },
    { label: 'no process', line: '', report: null },
    {
      label: 'a process whose path Windows will not tell',
      line: '2026-11-03T23:42:42.1234567Z\t\r\n',
      report: null,
    },
  ])('parseWindowsReport_Cases: $label', ({ line, report }) => {
    expect(parseWindowsReport(line)).toEqual(report);
  });
});
