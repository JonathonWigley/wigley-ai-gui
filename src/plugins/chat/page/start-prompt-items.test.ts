import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import type { HarnessProfile } from '../../../contracts/agent';
import type { ChatProject, RecentFolder, ResumeSectionRow } from '../contract';
import {
  displayPath,
  FOLDERS_HEADING,
  type FolderItem,
  folderItems,
  folderName,
  folderSection,
  OTHER_FOLDER_LABEL,
  PROJECTS_HEADING,
  type ProjectItem,
  preselectedProfile,
  projectItems,
  projectLabel,
  projectSection,
} from './start-prompt-items';

const home = '/Users/u';

const app: RecentFolder = {
  projectDir: '/Users/u/dev/app',
  profile: 'personal',
  lastUsed: 2,
};
const tool: RecentFolder = {
  projectDir: '/opt/tool',
  profile: 'work',
  lastUsed: 1,
};
const recent = [app, tool];

function closedRow(hostSessionId: string, title: string): ResumeSectionRow {
  return {
    hostSessionId,
    projectDir: '/Users/u/dev/ai-dev',
    profile: 'work',
    title,
    at: new Date(2026, 0, 2, 10, 0).getTime(),
  };
}

const newGames: ChatProject = {
  kind: 'pool',
  name: 'New Games',
  pool: 'new-games-prototypes',
  profile: 'work',
};
const aiDev: ChatProject = {
  kind: 'folder',
  name: 'Wigley AI Dev',
  folder: '~/Documents/ai-dev',
  profile: null,
};

const profiles: HarnessProfile[] = [
  { name: 'work', configDir: '~/.claude' },
  { name: 'personal', configDir: '~/.claude-personal' },
];

describe('start prompt items', () => {
  it.each([
    { path: '/Users/u', homeDir: home, paths: posixPaths, shown: '~' },
    {
      path: '/Users/u/dev/app',
      homeDir: home,
      paths: posixPaths,
      shown: '~/dev/app',
    },
    {
      path: '/Users/uz/app',
      homeDir: home,
      paths: posixPaths,
      shown: '/Users/uz/app',
    },
    { path: '/opt/app', homeDir: home, paths: posixPaths, shown: '/opt/app' },
    {
      path: '/Users/u/dev',
      homeDir: '/Users/u/',
      paths: posixPaths,
      shown: '~/dev',
    },
    {
      path: 'C:\\Users\\jo\\dev\\app',
      homeDir: 'C:\\Users\\jo',
      paths: windowsPaths,
      shown: '~\\dev\\app',
    },
    {
      path: 'C:\\_root\\dev',
      homeDir: 'C:\\Users\\jo',
      paths: windowsPaths,
      shown: 'C:\\_root\\dev',
    },
  ])(
    'displayPath $path under $homeDir → $shown',
    ({ path, homeDir, paths, shown }) => {
      expect(displayPath(path, homeDir, paths)).toBe(shown);
    },
  );

  it('folderItems_RecentThenChoose', () => {
    expect(folderItems(recent, [], home, posixPaths)).toEqual([
      { kind: 'recent', folder: app, label: '~/dev/app' },
      { kind: 'recent', folder: tool, label: '/opt/tool' },
      { kind: 'choose', label: expect.any(String) },
    ]);
  });

  it('folderItems_Sections_ComeFirstAndOnce', () => {
    const one = closedRow('one', 'Fix login');
    const two = closedRow('two', 'Add cache');

    const items = folderItems(
      [app],
      [
        { title: 'Recently closed', rows: [one, two] },
        { title: 'Pinned', rows: [closedRow('two', 'Add cache again')] },
      ],
      home,
      posixPaths,
    );

    expect(items).toEqual([
      {
        kind: 'section',
        section: 'Recently closed',
        row: one,
        label: 'Fix login · ai-dev · work · 2026-01-02 10:00',
      },
      {
        kind: 'section',
        section: 'Recently closed',
        row: two,
        label: 'Add cache · ai-dev · work · 2026-01-02 10:00',
      },
      { kind: 'recent', folder: app, label: '~/dev/app' },
      { kind: 'choose', label: expect.any(String) },
    ]);
  });

  it('folderItems_SectionRowNote_FollowsTitle', () => {
    const noted = { ...closedRow('one', 'Fix login'), note: 'after lunch' };

    const [item] = folderItems(
      [],
      [{ title: 'Stashed', rows: [noted] }],
      home,
      posixPaths,
    );

    expect(item.label).toBe(
      'Fix login · after lunch · ai-dev · work · 2026-01-02 10:00',
    );
  });

  it('folderName_SectionRow_IsEmpty', () => {
    const [section] = folderItems(
      [],
      [{ title: 'Recently closed', rows: [closedRow('one', 'Fix login')] }],
      home,
      posixPaths,
    );

    expect(folderName(section, posixPaths)).toBe('');
  });

  it.each<{
    given: string;
    item: FolderItem;
    showsSections: boolean;
    heading: string | null;
  }>([
    {
      given: 'a section row',
      item: {
        kind: 'section',
        section: 'Recently closed',
        row: closedRow('one', 'Fix login'),
        label: 'Fix login',
      },
      showsSections: true,
      heading: 'Recently closed',
    },
    {
      given: 'a folder beside section rows',
      item: { kind: 'recent', folder: app, label: '~/dev/app' },
      showsSections: true,
      heading: FOLDERS_HEADING,
    },
    {
      given: 'the choose line beside section rows',
      item: { kind: 'choose', label: 'Choose folder…' },
      showsSections: true,
      heading: FOLDERS_HEADING,
    },
    {
      given: 'a folder with no section rows',
      item: { kind: 'recent', folder: app, label: '~/dev/app' },
      showsSections: false,
      heading: null,
    },
  ])(
    'folderSection for $given → $heading',
    ({ item, showsSections, heading }) => {
      expect(folderSection(item, showsSections)).toBe(heading);
    },
  );

  it('folderName_Recent_IsBase', () => {
    const [recentItem] = folderItems(recent, [], home, posixPaths);

    expect(folderName(recentItem, posixPaths)).toBe('app');
  });

  it('folderName_Choose_IsLabel', () => {
    const [choose] = folderItems([], [], home, posixPaths);

    expect(folderName(choose, posixPaths)).toBe(choose.label);
  });

  it('folderItems_NoRecent_ChooseOnly', () => {
    expect(folderItems([], [], home, posixPaths)).toEqual([
      { kind: 'choose', label: expect.any(String) },
    ]);
  });

  it.each([
    {
      given: 'the folder last used with the second profile',
      recentFolders: recent,
      folder: '/Users/u/dev/app',
      paths: posixPaths,
      index: 1,
    },
    {
      given: 'a Windows folder in another case',
      recentFolders: [
        { projectDir: 'C:\\Dev\\App', profile: 'personal', lastUsed: 2 },
      ],
      folder: 'c:\\dev\\app\\',
      paths: windowsPaths,
      index: 1,
    },
    {
      given: 'an unknown folder',
      recentFolders: recent,
      folder: '/elsewhere',
      paths: posixPaths,
      index: 0,
    },
    {
      given: 'a folder last used with a removed profile',
      recentFolders: [{ projectDir: '/srv/old', profile: 'old', lastUsed: 3 }],
      folder: '/srv/old',
      paths: posixPaths,
      index: 0,
    },
  ])(
    'preselectedProfile for $given → $index',
    ({ recentFolders, folder, paths, index }) => {
      expect(preselectedProfile(profiles, recentFolders, folder, paths)).toBe(
        index,
      );
    },
  );
  it.each([
    {
      name: 'a pool',
      project: newGames,
      label: 'New Games · new-games-prototypes',
    },
    {
      name: 'a folder with ~',
      project: aiDev,
      label: 'Wigley AI Dev · ~/Documents/ai-dev',
    },
    {
      name: 'a folder in full',
      project: { ...aiDev, folder: '/Users/u/Documents/ai-dev' },
      label: 'Wigley AI Dev · ~/Documents/ai-dev',
    },
  ])('projectLabel: $name', ({ project, label }) => {
    expect(projectLabel(project, home, posixPaths)).toBe(label);
  });

  it('projectItems_SectionsThenProjectsThenOtherFolder', () => {
    const sections = [
      { title: 'Recently closed', rows: [closedRow('one', 'Fix login')] },
    ];
    const kindsAndNames = (items: ProjectItem[]) =>
      items.map((item) =>
        item.kind === 'project' ? item.project.name : item.kind,
      );

    const items = projectItems([aiDev, newGames], sections, home, posixPaths);

    expect(kindsAndNames(items)).toEqual([
      'section',
      'Wigley AI Dev',
      'New Games',
      'other',
    ]);
    expect(items[items.length - 1].label).toBe(OTHER_FOLDER_LABEL);
    expect(
      kindsAndNames(projectItems([aiDev, newGames], [], home, posixPaths)),
    ).toEqual(['Wigley AI Dev', 'New Games', 'other']);
  });

  it.each<{
    name: string;
    item: ProjectItem;
    showsSections: boolean;
    heading: string | null;
  }>([
    {
      name: 'a section row',
      item: {
        kind: 'section',
        section: 'Recently closed',
        row: closedRow('one', 'Fix login'),
        label: 'Fix login',
      },
      showsSections: true,
      heading: 'Recently closed',
    },
    {
      name: 'a project beside section rows',
      item: { kind: 'project', project: newGames, label: 'New Games' },
      showsSections: true,
      heading: PROJECTS_HEADING,
    },
    {
      name: 'the other-folder line beside section rows',
      item: { kind: 'other', label: OTHER_FOLDER_LABEL },
      showsSections: true,
      heading: PROJECTS_HEADING,
    },
    {
      name: 'a project with no section rows',
      item: { kind: 'project', project: newGames, label: 'New Games' },
      showsSections: false,
      heading: null,
    },
  ])('projectSection: $name', ({ item, showsSections, heading }) => {
    expect(projectSection(item, showsSections)).toBe(heading);
  });
});
