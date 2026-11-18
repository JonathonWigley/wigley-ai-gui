import { describe, expect, it } from 'vitest';
import type {
  AgentHarness,
  HarnessProfile,
  ProjectFolder,
} from '../../../contracts/agent';
import {
  createFakeAgentHarness,
  FAKE_MICROTASK_TIMERS,
} from '../../../shared/fake-agent-harness';
import { harnessRegistryOf } from '../../../shared/agent-harness-registry.test-support';
import { createMemoryFiles } from '../../../shared/memory-files';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { RecentFolder } from '../contract';
import {
  createFolderChoices,
  MAX_FOLDER_CHOICES,
  mergeFolderChoices,
} from './folder-choices';
import { chatHarnessesOfRegistry } from './lookups.test-support';

const PROFILES: HarnessProfile[] = [
  { name: 'work', configDir: '~/.claude' },
  { name: 'personal', configDir: '~/.claude-personal' },
];

// A fake harness `id` declaring `profiles`, whose `listProjects` answers from
// `listed` by config folder, rejecting for a folder `listed` holds an Error
// for.
function harnessListing(
  id: string,
  profiles: HarnessProfile[],
  listed: Record<string, ProjectFolder[] | Error>,
): AgentHarness {
  const fake = createFakeAgentHarness(
    { now: () => 1000 },
    createMemoryFiles(),
    FAKE_MICROTASK_TIMERS,
  );
  return {
    ...fake,
    id,
    info: () => ({ ...fake.info(), profiles }),
    async listProjects(profileDir) {
      const answer = listed[profileDir ?? ''] ?? [];
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  };
}

function setUp(options: {
  recent: RecentFolder[];
  listed: Record<string, ProjectFolder[] | Error>;
  folders: string[];
  fileAt?: string[];
  tempFolders?: string[];
  // Paths whose `stat` rejects, as for a folder the app may not read.
  statRejects?: string[];
  // The registered harnesses; one `claude` declaring PROFILES and listing
  // from `listed` when left out.
  harnesses?: AgentHarness[];
}) {
  const memory = createMemoryFiles();
  const files = {
    ...memory,
    async stat(path: string) {
      if (options.statRejects?.includes(path)) {
        throw new Error(`EACCES: permission denied, stat '${path}'`);
      }
      return memory.stat(path);
    },
  };
  const logged: string[] = [];
  const choices = createFolderChoices({
    recent: {
      list: async () => options.recent,
      record: async () => undefined,
    },
    harnesses: chatHarnessesOfRegistry(
      harnessRegistryOf(
        options.harnesses ?? [
          harnessListing('claude', PROFILES, options.listed),
        ],
      ),
    ),
    files,
    paths: posixPaths,
    tempFolders: options.tempFolders ?? [],
    log: (message) => logged.push(message),
  });
  return {
    choices,
    logged,
    madeFolders: Promise.all([
      ...options.folders.map((folder) => memory.makeFolder(folder)),
      ...(options.fileAt ?? []).map((path) => memory.write(path, 'text')),
    ]),
  };
}

describe('mergeFolderChoices', () => {
  it('mergeFolderChoices_SameFolderTwice_KeepsNewestUse', () => {
    const merged = mergeFolderChoices(
      [
        {
          projectDir: '/a',
          harness: 'claude',
          profile: 'personal',
          lastUsed: 5,
        },
      ],
      [
        {
          harness: 'fake',
          profile: 'work',
          folder: { projectDir: '/a', modified: 9 },
        },
      ],
      posixPaths,
    );

    expect(merged).toEqual([
      { projectDir: '/a', harness: 'fake', profile: 'work', lastUsed: 9 },
    ]);
  });

  it('mergeFolderChoices_NewestFirst', () => {
    const merged = mergeFolderChoices(
      [
        { projectDir: '/old', harness: 'claude', profile: 'work', lastUsed: 1 },
        {
          projectDir: '/new',
          harness: 'claude',
          profile: 'work',
          lastUsed: 30,
        },
      ],
      [
        {
          harness: 'claude',
          profile: 'personal',
          folder: { projectDir: '/mid', modified: 20 },
        },
      ],
      posixPaths,
    );

    expect(merged.map((folder) => folder.projectDir)).toEqual([
      '/new',
      '/mid',
      '/old',
    ]);
  });
});

describe('createFolderChoices', () => {
  it('list_TempAndMissingFolders_LeftOut', async () => {
    const test = setUp({
      recent: [
        { projectDir: '/p', harness: 'claude', profile: 'work', lastUsed: 3 },
      ],
      listed: {
        '~/.claude': [
          { projectDir: '/p', modified: 2 },
          { projectDir: '/gone', modified: 4 },
          { projectDir: '/tmp/x', modified: 5 },
        ],
      },
      folders: ['/p', '/tmp/x'],
      tempFolders: ['/tmp'],
    });
    await test.madeFolders;

    expect(await test.choices.list()).toEqual([
      { projectDir: '/p', harness: 'claude', profile: 'work', lastUsed: 3 },
    ]);
  });

  it('list_PathHoldsAFile_LeftOut', async () => {
    const test = setUp({
      recent: [
        { projectDir: '/p', harness: 'claude', profile: 'work', lastUsed: 1 },
        {
          projectDir: '/now-a-file',
          harness: 'claude',
          profile: 'work',
          lastUsed: 2,
        },
      ],
      listed: {},
      folders: ['/p'],
      fileAt: ['/now-a-file'],
    });
    await test.madeFolders;

    expect(await test.choices.list()).toEqual([
      { projectDir: '/p', harness: 'claude', profile: 'work', lastUsed: 1 },
    ]);
  });

  it('list_StatRejects_LeftOutAndLogged', async () => {
    const test = setUp({
      recent: [
        { projectDir: '/p', harness: 'claude', profile: 'work', lastUsed: 1 },
        {
          projectDir: '/locked',
          harness: 'claude',
          profile: 'work',
          lastUsed: 2,
        },
      ],
      listed: {},
      folders: ['/p', '/locked'],
      statRejects: ['/locked'],
    });
    await test.madeFolders;

    expect(await test.choices.list()).toEqual([
      { projectDir: '/p', harness: 'claude', profile: 'work', lastUsed: 1 },
    ]);
    expect(test.logged).toEqual([expect.stringContaining('/locked')]);
  });

  it('list_NewerFoldersLeftOut_OlderFoldersFillTheList', async () => {
    const newerLeftOut: RecentFolder[] = Array.from(
      { length: MAX_FOLDER_CHOICES },
      (_, index) => ({
        projectDir: index % 2 === 0 ? `/tmp/t${index}` : `/gone${index}`,
        harness: 'claude',
        profile: 'work',
        lastUsed: 1000 + index,
      }),
    );
    const olderKept: RecentFolder[] = [
      {
        projectDir: '/kept-a',
        harness: 'claude',
        profile: 'work',
        lastUsed: 2,
      },
      {
        projectDir: '/kept-b',
        harness: 'claude',
        profile: 'work',
        lastUsed: 1,
      },
    ];
    const test = setUp({
      recent: [...newerLeftOut, ...olderKept],
      listed: {},
      folders: ['/kept-a', '/kept-b'],
      tempFolders: ['/tmp'],
    });
    await test.madeFolders;

    expect(await test.choices.list()).toEqual(olderKept);
  });

  it('list_MoreFoldersThanTheCap_KeepsTheNewest', async () => {
    const recent: RecentFolder[] = Array.from(
      { length: MAX_FOLDER_CHOICES + 5 },
      (_, index) => ({
        projectDir: `/f${index}`,
        harness: 'claude',
        profile: 'work',
        lastUsed: index,
      }),
    );
    const test = setUp({
      recent,
      listed: {},
      folders: recent.map((folder) => folder.projectDir),
    });
    await test.madeFolders;

    const listed = await test.choices.list();

    expect(listed).toHaveLength(MAX_FOLDER_CHOICES);
    expect(listed[0]?.projectDir).toBe(`/f${MAX_FOLDER_CHOICES + 4}`);
    expect(listed.at(-1)?.projectDir).toBe('/f5');
  });

  it('list_ProfileListingRejects_OthersStillListed', async () => {
    const test = setUp({
      recent: [],
      listed: {
        '~/.claude': new Error('projects folder unreadable'),
        '~/.claude-personal': [{ projectDir: '/home-app', modified: 7 }],
      },
      folders: ['/home-app'],
    });
    await test.madeFolders;

    expect(await test.choices.list()).toEqual([
      {
        projectDir: '/home-app',
        harness: 'claude',
        profile: 'personal',
        lastUsed: 7,
      },
    ]);
    expect(test.logged).toEqual([
      expect.stringMatching(/work.*projects folder unreadable/),
    ]);
  });

  it('list_TwoHarnesses_ListsEachProfilesFoldersWithItsHarness', async () => {
    const test = setUp({
      recent: [],
      listed: {},
      folders: ['/claude-app', '/fake-app'],
      harnesses: [
        harnessListing('claude', [PROFILES[0]], {
          '~/.claude': [{ projectDir: '/claude-app', modified: 2 }],
        }),
        harnessListing('fake', [{ name: 'spare', configDir: '~/.fake' }], {
          '~/.fake': [{ projectDir: '/fake-app', modified: 3 }],
        }),
      ],
    });
    await test.madeFolders;

    expect(await test.choices.list()).toEqual([
      {
        projectDir: '/fake-app',
        harness: 'fake',
        profile: 'spare',
        lastUsed: 3,
      },
      {
        projectDir: '/claude-app',
        harness: 'claude',
        profile: 'work',
        lastUsed: 2,
      },
    ]);
  });
});
