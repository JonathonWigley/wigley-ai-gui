import { describe, expect, it } from 'vitest';
import type { WatchOptions } from '../../../contracts/files';
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
      reportPlan: async (rowId, planDir) => {
        reported.push([rowId, planDir]);
        return null;
      },
    });

    await files.write(`${FOLDER}/${file}`, text);
    await settled();

    expect(reported).toEqual(reports);
    expect(logs).toHaveLength(logged);
  });

  it('createPlanReports_WatchThrows_LogsAndStarts', () => {
    const logs: string[] = [];
    const files = {
      ...createMemoryFiles(),
      watch: () => {
        throw new Error('watcher refused');
      },
    };

    const reports = createPlanReports({
      files,
      paths: posixPaths,
      log: (line) => logs.push(line),
      folder: FOLDER,
      reportPlan: async () => null,
    });

    expect(logs).toEqual([
      expect.stringContaining('watcher refused') as string,
    ]);
    expect(() => reports.dispose()).not.toThrow();
  });

  // Breaks if a missed burst applies a report from before the watch opened,
  // applies one again with no new write, or skips one written since.
  it('createPlanReports_OnMissed_AppliesNewReportsOnce', async () => {
    let time = 900;
    const memory = createMemoryFiles({ now: () => time });
    await memory.write(`${FOLDER}/a.json`, '{"planDir": "/w/p/plan-a"}\n');
    let watchOptions: WatchOptions | undefined;
    const files = {
      ...memory,
      watch: (
        _folder: string,
        _onChange: (path: string) => void,
        options?: WatchOptions,
      ) => {
        watchOptions = options;
        return { dispose: () => undefined };
      },
    };
    const reported: string[] = [];
    createPlanReports({
      files,
      paths: posixPaths,
      log: () => undefined,
      folder: FOLDER,
      reportPlan: async (rowId) => {
        reported.push(rowId);
        return null;
      },
      now: () => 1000,
    });
    time = 1500;
    await memory.write(`${FOLDER}/b.json`, '{"planDir": "/w/p/plan-b"}\n');

    watchOptions?.onMissed?.();
    await settled();
    watchOptions?.onMissed?.();
    await settled();

    expect(reported).toEqual(['b']);
  });

  it('createPlanReports_DisposedMidRead_ReportsNothing', async () => {
    const memory = createMemoryFiles();
    const held = Promise.withResolvers<void>();
    const files = {
      ...memory,
      read: async (path: string) => {
        await held.promise;
        return memory.read(path);
      },
    };
    const reported: string[] = [];
    const reports = createPlanReports({
      files,
      paths: posixPaths,
      log: () => undefined,
      folder: FOLDER,
      reportPlan: async (rowId) => {
        reported.push(rowId);
        return null;
      },
    });
    await memory.write(`${FOLDER}/s1.json`, '{"planDir": "/w/p/plan-a"}\n');
    await settled();

    reports.dispose();
    held.resolve();
    await settled();

    expect(reported).toEqual([]);
  });
});
