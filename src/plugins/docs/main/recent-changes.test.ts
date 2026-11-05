import { describe, expect, it, vi } from 'vitest';
import type { Git, GitCommit } from '../../../contracts/git';
import type { PluginLog } from '../../../contracts/log';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { readRecentChanges } from './recent-changes';

const AT = '2026-11-05T12:00:00Z';

function answer<T>(value: T | Error): Promise<T> {
  return value instanceof Error
    ? Promise.reject(value)
    : Promise.resolve(value);
}

function commit(
  sha: string,
  paths: string[] = ['x.md'],
  at: string = AT,
): GitCommit {
  return { sha, subject: `subject of ${sha}`, at, paths };
}

interface Setup {
  // Asked path → its real path or failure; an unlisted path is its own.
  realPaths?: Record<string, string | Error>;
  // Folder → its clone root or failure; an unlisted folder is in no clone.
  roots?: Record<string, string | null | Error>;
  // Root → its commits or failure; an unlisted root has no commits.
  logs?: Record<string, GitCommit[] | Error>;
}

function setUp({ realPaths = {}, roots = {}, logs = {} }: Setup) {
  const git = {
    topLevel: vi.fn<Git['topLevel']>((folder) => answer(roots[folder] ?? null)),
    log: vi.fn<Git['log']>((root) => answer(logs[root] ?? [])),
  };
  const files = {
    realPath: vi.fn((path: string) => answer(realPaths[path] ?? path)),
  };
  const log = vi.fn<PluginLog>();
  return { git, files, log, paths: posixPaths };
}

const TWO_CLONES = { '/r/a': '/r/a', '/r/b': '/r/b' };

describe('readRecentChanges', () => {
  it('readRecentChanges_TwoClones_MergedNewestFirstAndCut', async () => {
    const deps = setUp({
      roots: TWO_CLONES,
      logs: {
        '/r/a': [commit('a1', ['x.md'], '2026-11-05T10:00:00-06:00')],
        '/r/b': [
          commit('b1', ['y.md'], '2026-11-05T15:30:00Z'),
          commit('b2', ['y.md'], '2026-11-05T09:00:00Z'),
        ],
      },
    });

    const changes = await readRecentChanges(
      ['/r/a/x.md', '/r/b/y.md'],
      2,
      deps,
    );

    expect(changes.map((change) => change.sha)).toEqual(['a1', 'b1']);
    expect(deps.git.log.mock.calls).toEqual([
      ['/r/a', ['x.md'], 2],
      ['/r/b', ['y.md'], 2],
    ]);
  });

  it.each([
    {
      given: 'a file at the clone top',
      linked: '/h/wa/AGENTS.md',
      real: '/d/wa/AGENTS.md',
      folder: '/d/wa',
      relative: 'AGENTS.md',
    },
    {
      given: 'a nested file',
      linked: '/h/wa/wiki/Main.md',
      real: '/d/wa/wiki/Main.md',
      folder: '/d/wa/wiki',
      relative: 'wiki/Main.md',
    },
  ])(
    'readRecentChanges_LinkedPath_AsksRelativeAndReturnsReal ($given)',
    async ({ linked, real, folder, relative }) => {
      const deps = setUp({
        realPaths: { [linked]: real },
        roots: { [folder]: '/d/wa' },
        logs: { '/d/wa': [commit('c1', [relative])] },
      });

      const changes = await readRecentChanges([linked], 5, deps);

      expect(deps.git.log.mock.calls).toEqual([['/d/wa', [relative], 5]]);
      expect(changes.map((change) => change.paths)).toEqual([[real]]);
    },
  );

  it.each([
    {
      given: 'missing file',
      failure: {
        realPaths: {
          '/r/b/y.md': Object.assign(new Error('gone'), { code: 'ENOENT' }),
        },
      },
      logLines: 0,
    },
    {
      given: 'file that cannot be read',
      failure: { realPaths: { '/r/b/y.md': new Error('denied') } },
      logLines: 1,
    },
    {
      given: 'outside any repo',
      failure: { roots: { '/r/a': '/r/a', '/r/b': null } },
      logLines: 0,
    },
    {
      given: 'git cannot start',
      failure: { roots: { '/r/a': '/r/a', '/r/b': new Error('spawn') } },
      logLines: 1,
    },
    {
      given: 'clone with no commit',
      failure: {
        logs: {
          '/r/a': [commit('a1')],
          '/r/b': new Error('git log exited 128'),
        },
      },
      logLines: 1,
    },
  ])(
    'readRecentChanges_Unreadable_OtherClonesStillShow ($given)',
    async ({ failure, logLines }) => {
      const deps = setUp({
        roots: TWO_CLONES,
        logs: { '/r/a': [commit('a1')] },
        ...failure,
      });

      const changes = await readRecentChanges(
        ['/r/a/x.md', '/r/b/y.md'],
        5,
        deps,
      );

      expect(changes.map((change) => change.sha)).toEqual(['a1']);
      expect(deps.log).toHaveBeenCalledTimes(logLines);
    },
  );

  it.each([
    {
      given: 'different paths',
      inA: ['x.md'],
      inB: ['y.md'],
      paths: ['/r/a/x.md', '/r/b/y.md'],
    },
    {
      given: 'the same path in both clones',
      inA: ['x.md'],
      inB: ['x.md'],
      paths: ['/r/a/x.md', '/r/b/x.md'],
    },
    {
      given: 'one root lists a path twice',
      inA: ['x.md', 'x.md'],
      inB: null,
      paths: ['/r/a/x.md'],
    },
  ])(
    'readRecentChanges_SameShaInTwoClones_OneRowAllPaths ($given)',
    async ({ inA, inB, paths }) => {
      const deps = setUp({
        roots: TWO_CLONES,
        logs: {
          '/r/a': [commit('s1', inA)],
          '/r/b': inB === null ? [] : [commit('s1', inB)],
        },
      });

      const changes = await readRecentChanges(
        ['/r/a/x.md', '/r/b/y.md'],
        5,
        deps,
      );

      expect(changes.map((change) => change.paths)).toEqual([paths]);
    },
  );

  it('readRecentChanges_NoPaths_RunsNoGit', async () => {
    const deps = setUp({});

    expect(await readRecentChanges([], 5, deps)).toEqual([]);
    expect(deps.git.topLevel).not.toHaveBeenCalled();
    expect(deps.git.log).not.toHaveBeenCalled();
  });
});
