import { describe, expect, it } from 'vitest';
import type { ChatProfile, RecentFolder } from '../contract';
import {
  displayPath,
  folderItems,
  preselectedProfile,
  profileLabel,
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
  it('displayPath_HomeItself_Tilde', () => {
    expect(displayPath('/Users/u', home)).toBe('~');
  });

  it('displayPath_InsideHome_TildePrefix', () => {
    expect(displayPath('/Users/u/dev/app', home)).toBe('~/dev/app');
  });

  it('displayPath_SiblingPrefix_Unchanged', () => {
    expect(displayPath('/Users/uz/app', home)).toBe('/Users/uz/app');
  });

  it('displayPath_OutsideHome_Unchanged', () => {
    expect(displayPath('/opt/app', home)).toBe('/opt/app');
  });

  it('displayPath_HomeWithTrailingSlash', () => {
    expect(displayPath('/Users/u/dev', '/Users/u/')).toBe('~/dev');
  });

  it('folderItems_RecentThenChoose', () => {
    expect(folderItems(recent, home)).toEqual([
      { kind: 'recent', folder: app, label: '~/dev/app' },
      { kind: 'recent', folder: tool, label: '/opt/tool' },
      { kind: 'choose', label: 'Choose folder…' },
    ]);
  });

  it('folderItems_NoRecent_ChooseOnly', () => {
    expect(folderItems([], home)).toEqual([
      { kind: 'choose', label: 'Choose folder…' },
    ]);
  });

  it('preselectedProfile_LastUsedInFolder', () => {
    expect(preselectedProfile(profiles, recent, '/Users/u/dev/app')).toBe(1);
    expect(preselectedProfile(profiles, recent, '/opt/tool')).toBe(0);
  });

  it('preselectedProfile_UnknownFolder_First', () => {
    expect(preselectedProfile(profiles, recent, '/elsewhere')).toBe(0);
  });

  it('preselectedProfile_RemovedProfile_First', () => {
    const old: RecentFolder = {
      projectDir: '/srv/old',
      profile: 'old',
      lastUsed: 3,
    };

    expect(preselectedProfile(profiles, [old], '/srv/old')).toBe(0);
  });

  it('profileLabel_NameAndFolder', () => {
    expect(profileLabel({ name: 'work', configDir: '~/.claude' })).toBe(
      'work · ~/.claude',
    );
  });
});
