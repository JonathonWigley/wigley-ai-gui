import { describe, expect, it } from 'vitest';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { createPlanReports } from './plan-reports';

const FOLDER = '/home/.agents/app/plan-runs';

const settled = () => new Promise((settle) => setImmediate(settle));

describe('createPlanReports', () => {
  it.each([
    {
      name: 'a report naming a plan folder',
      file: 's1.json',
      text: '{"planDir": "/w/p/plan-a/"}\n',
      reports: [['s1', '/w/p/plan-a']],
      logged: 0,
    },
    {
      name: 'a report whose planDir is not a path',
      file: 's1.json',
      text: '{"planDir": 3}\n',
      reports: [],
      logged: 1,
    },
    {
      name: 'a report that is not JSON',
      file: 's1.json',
      text: 'not json',
      reports: [],
      logged: 1,
    },
    {
      name: 'a name not ending in .json',
      file: 's1.json.tmp',
      text: '{"planDir": "/w/p/plan-a"}\n',
      reports: [],
      logged: 0,
    },
  ])('on $name', async ({ file, text, reports, logged }) => {
    const files = createMemoryFiles();
    const reported: [string, string][] = [];
    const logs: string[] = [];
    createPlanReports({
      files,
      paths: posixPaths,
      log: (line) => logs.push(line),
      folder: FOLDER,
      report: (rowId, planDir) => reported.push([rowId, planDir]),
    });

    await files.write(`${FOLDER}/${file}`, text);
    await settled();

    expect(reported).toEqual(reports);
    expect(logs).toHaveLength(logged);
  });
});
