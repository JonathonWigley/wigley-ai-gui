import { describe, expect, it } from 'vitest';
import type { Paths } from '../../../contracts/paths';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import type { ChatProject, PoolProvider, ProjectSetting } from '../contract';
import {
  branchChoices,
  createPoolProviders,
  projectOf,
  readProjects,
} from './projects';

function read(raw: readonly ProjectSetting[]) {
  const logged: string[] = [];
  const projects = readProjects(raw, (line) => logged.push(line));
  return { projects, logged };
}

describe('readProjects', () => {
  it.each<{
    name: string;
    raw: ProjectSetting[];
    expected: ChatProject[];
    skipped: number[];
  }>([
    {
      name: 'a folder project keeps ~ and takes a null profile',
      raw: [{ name: 'Wigley AI Dev', folder: '~/Documents/ai-dev' }],
      expected: [
        {
          kind: 'folder',
          name: 'Wigley AI Dev',
          folder: '~/Documents/ai-dev',
          profile: null,
        },
      ],
      skipped: [],
    },
    {
      name: 'a hand-written null profile and pool count as absent',
      raw: [
        { name: 'A', folder: '/a', profile: null, pool: null },
      ] as unknown as ProjectSetting[],
      expected: [{ kind: 'folder', name: 'A', folder: '/a', profile: null }],
      skipped: [],
    },
    {
      name: 'a pool project keeps its profile and pinned order',
      raw: [
        {
          name: 'New Games',
          pool: 'ngp',
          profile: 'work',
          pinnedBranches: ['protos/b', 'main'],
        },
      ],
      expected: [
        {
          kind: 'pool',
          name: 'New Games',
          pool: 'ngp',
          profile: 'work',
          pinnedBranches: ['protos/b', 'main'],
        },
      ],
      skipped: [],
    },
    {
      name: 'a pool with no pinned branches takes none',
      raw: [{ name: 'New Games', pool: 'ngp' }],
      expected: [
        {
          kind: 'pool',
          name: 'New Games',
          pool: 'ngp',
          profile: null,
          pinnedBranches: [],
        },
      ],
      skipped: [],
    },
    {
      name: 'neither folder nor pool',
      raw: [{ name: 'A' }],
      expected: [],
      skipped: [0],
    },
    {
      name: 'both folder and pool',
      raw: [{ name: 'A', folder: '/a', pool: 'p' }],
      expected: [],
      skipped: [0],
    },
    {
      name: 'pinned branches on a folder project',
      raw: [{ name: 'A', folder: '/a', pinnedBranches: ['main'] }],
      expected: [],
      skipped: [0],
    },
    {
      name: 'a name an earlier entry took, the first kept',
      raw: [
        { name: 'A', folder: '/a' },
        { name: 'A', pool: 'p' },
      ],
      expected: [{ kind: 'folder', name: 'A', folder: '/a', profile: null }],
      skipped: [1],
    },
    {
      name: 'a name only a skipped entry held is free',
      raw: [{ name: 'A' }, { name: 'A', folder: '/a' }],
      expected: [{ kind: 'folder', name: 'A', folder: '/a', profile: null }],
      skipped: [0],
    },
    {
      name: 'a non-object entry',
      raw: ['New Games'] as unknown as ProjectSetting[],
      expected: [],
      skipped: [0],
    },
    {
      name: 'a missing or empty name',
      raw: [{ folder: '/a' }, { name: '', folder: '/b' }] as ProjectSetting[],
      expected: [],
      skipped: [0, 1],
    },
    {
      name: 'a folder, pool or profile of the wrong kind',
      raw: [
        { name: 'A', folder: 3 },
        { name: 'B', pool: '' },
        { name: 'C', folder: '/c', profile: true },
        { name: 'D', pool: 'p', profile: '' },
      ] as unknown as ProjectSetting[],
      expected: [],
      skipped: [0, 1, 2, 3],
    },
    {
      name: 'pinned branches that are not names',
      raw: [
        { name: 'A', pool: 'p', pinnedBranches: ['main', 4] },
        { name: 'B', pool: 'p', pinnedBranches: ['main', ''] },
      ] as unknown as ProjectSetting[],
      expected: [],
      skipped: [0, 1],
    },
    {
      name: 'a skipped entry leaves the rest in order',
      raw: [
        { name: 'A', folder: '/a' },
        { name: 'Bad' },
        { name: 'C', pool: 'p' },
      ],
      expected: [
        { kind: 'folder', name: 'A', folder: '/a', profile: null },
        {
          kind: 'pool',
          name: 'C',
          pool: 'p',
          profile: null,
          pinnedBranches: [],
        },
      ],
      skipped: [1],
    },
  ])(
    'readProjects_KeepsOrSkipsEachEntry: $name',
    ({ raw, expected, skipped }) => {
      const { projects, logged } = read(raw);

      expect(projects).toEqual(expected);
      expect(logged).toEqual(
        skipped.map((index) =>
          expect.stringMatching(new RegExp('^projects\\[' + index + '\\] ')),
        ),
      );
    },
  );

  it('readProjects_LogLine_NamesTheEntry', () => {
    const { logged } = read([
      { name: 'New Games', folder: '/a', pool: 'p' },
      { folder: '/b' } as ProjectSetting,
    ]);

    expect(logged).toEqual([
      expect.stringMatching(/^projects\[0\] "New Games" skipped: /),
      expect.stringMatching(/^projects\[1\] unnamed skipped: /),
    ]);
  });
});

describe('projectOf', () => {
  const WIGLEY: ChatProject = {
    kind: 'folder',
    name: 'Wigley AI Dev',
    folder: '~/Documents/ai-dev',
    profile: null,
  };
  const NEW_GAMES: ChatProject = {
    kind: 'pool',
    name: 'New Games',
    pool: 'ngp',
    profile: 'work',
    pinnedBranches: [],
  };
  const DEV: ChatProject = {
    kind: 'folder',
    name: 'Dev',
    folder: '~/dev',
    profile: null,
  };
  const poolFolders = (pool: string) =>
    pool === 'ngp' ? ['/Users/u/dev/ngp', '/Users/u/dev/ngp-2'] : [];

  it.each<{
    name: string;
    folder: string;
    projects?: ChatProject[];
    paths?: Paths;
    homeDir?: string;
    expected: string | null;
  }>([
    {
      name: "the folder project's folder",
      folder: '/Users/u/Documents/ai-dev',
      expected: 'Wigley AI Dev',
    },
    {
      name: "below the folder project's folder",
      folder: '/Users/u/Documents/ai-dev/wigley-ai-gui/.worktrees/x',
      expected: 'Wigley AI Dev',
    },
    {
      name: "a sibling sharing the folder's prefix",
      folder: '/Users/u/Documents/ai-development',
      expected: null,
    },
    {
      name: 'a pool clone other than the first',
      folder: '/Users/u/dev/ngp-2',
      expected: 'New Games',
    },
    {
      name: 'below a pool clone',
      folder: '/Users/u/dev/ngp/Assets',
      expected: 'New Games',
    },
    {
      name: "the clones' parent folder",
      folder: '/Users/u/dev',
      expected: null,
    },
    {
      name: 'a pool the provider does not know',
      folder: '/Users/u/dev/ngp',
      projects: [
        {
          kind: 'pool',
          name: 'Other',
          pool: 'other',
          profile: null,
          pinnedBranches: [],
        },
      ],
      expected: null,
    },
    {
      name: 'the first of two covering projects wins',
      folder: '/Users/u/dev/ngp',
      projects: [DEV, NEW_GAMES],
      expected: 'Dev',
    },
    {
      name: 'settings order decides, not depth',
      folder: '/Users/u/dev/ngp',
      projects: [NEW_GAMES, DEV],
      expected: 'New Games',
    },
    {
      name: "compared as the OS's paths compare",
      folder: 'c:\\users\\u\\documents\\ai-dev\\x',
      paths: windowsPaths,
      homeDir: 'C:\\Users\\u',
      expected: 'Wigley AI Dev',
    },
  ])(
    'projectOf_FindsTheCoveringProject: $name',
    ({ folder, projects, paths, homeDir, expected }) => {
      const found = projectOf(
        folder,
        projects ?? [WIGLEY, NEW_GAMES],
        poolFolders,
        homeDir ?? '/Users/u',
        paths ?? posixPaths,
      );

      expect(found?.name ?? null).toBe(expected);
    },
  );
});

describe('branchChoices', () => {
  it.each<{
    name: string;
    pinned: string[];
    origin: string[];
    expected: string[];
  }>([
    {
      name: "pinned in their order, then origin's rest in its order",
      pinned: ['main', 'protos/b'],
      origin: ['protos/a', 'main', 'protos/c', 'protos/b'],
      expected: ['main', 'protos/b', 'protos/a', 'protos/c'],
    },
    {
      name: 'a pinned branch missing from origin stays',
      pinned: ['release/x'],
      origin: ['main'],
      expected: ['release/x', 'main'],
    },
    {
      name: "no pinned branches leaves origin's order",
      pinned: [],
      origin: ['b', 'a'],
      expected: ['b', 'a'],
    },
    {
      name: 'a repeated name shows once',
      pinned: ['main', 'main'],
      origin: ['dev', 'main'],
      expected: ['main', 'dev'],
    },
    {
      name: 'names differing only in case are two',
      pinned: ['Main'],
      origin: ['main'],
      expected: ['Main', 'main'],
    },
  ])(
    'branchChoices_PinnedFirstThenOrigin: $name',
    ({ pinned, origin, expected }) => {
      expect(branchChoices(pinned, origin)).toEqual(expected);
    },
  );
});

describe('createPoolProviders', () => {
  type Step = 'add A' | 'add B' | 'dispose A' | 'dispose B';

  it.each<{ name: string; steps: Step[]; current: 'A' | 'B' | null }>([
    { name: 'none registered', steps: [], current: null },
    { name: 'the newer of two', steps: ['add A', 'add B'], current: 'B' },
    {
      name: 'the older after the newer disposes',
      steps: ['add A', 'add B', 'dispose B'],
      current: 'A',
    },
    {
      name: 'the newer after the older disposes',
      steps: ['add A', 'add B', 'dispose A'],
      current: 'B',
    },
    {
      name: 'none after every one disposes',
      steps: ['add A', 'dispose A'],
      current: null,
    },
    {
      name: 'a second dispose removes nothing',
      steps: ['add A', 'dispose A', 'add B', 'dispose A'],
      current: 'B',
    },
  ])(
    'poolProviders_NewestStillRegisteredAnswers: $name',
    ({ steps, current }) => {
      const providers = { A: {} as PoolProvider, B: {} as PoolProvider };
      const registry = createPoolProviders();
      const handles: Partial<Record<'A' | 'B', { dispose(): void }>> = {};
      for (const step of steps) {
        const [verb, which] = step.split(' ') as ['add' | 'dispose', 'A' | 'B'];
        if (verb === 'add') {
          handles[which] = registry.add(providers[which]);
        } else {
          handles[which]?.dispose();
        }
      }

      expect(registry.current()).toBe(
        current === null ? null : providers[current],
      );
    },
  );
});
