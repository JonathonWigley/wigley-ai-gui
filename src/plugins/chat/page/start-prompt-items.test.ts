import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import type { ChatProfile, RecentFolder } from '../contract';
import {
  displayPath,
  folderItems,
  preselectedProfile,
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

const profiles: ChatProfile[] = [
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
    expect(folderItems(recent, home, posixPaths)).toEqual([
      { kind: 'recent', folder: app, label: '~/dev/app' },
      { kind: 'recent', folder: tool, label: '/opt/tool' },
      { kind: 'choose', label: expect.any(String) },
    ]);
  });

  it('folderItems_NoRecent_ChooseOnly', () => {
    expect(folderItems([], home, posixPaths)).toEqual([
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
});
