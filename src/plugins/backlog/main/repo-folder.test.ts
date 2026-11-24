import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { RepoFolderSetting } from '../contract';
import { repoFolderOf } from './repo-folder';

const HOME_DIR = '/Users/me';
const DOCS_FEATURES = [['docs', 'features']];

describe('repoFolderOf', () => {
  it.each<{
    name: string;
    root: string;
    isInClone: boolean;
    settings: RepoFolderSetting[];
    folder: string | null;
  }>([
    {
      name: 'in-repo shape in a clone',
      root: '/dev/r/docs/features',
      isInClone: true,
      settings: [{ repo: 'r', folder: '~/elsewhere/r' }],
      folder: '/dev/r',
    },
    {
      name: "a project folder's in-repo home in a clone",
      root: '/dev/r/proj/docs/features',
      isInClone: true,
      settings: [],
      folder: '/dev/r/proj',
    },
    {
      name: 'in-repo shape not in a clone, with a setting entry',
      root: '/dev/r/docs/features',
      isInClone: false,
      settings: [{ repo: 'r', folder: '~/elsewhere/r' }],
      folder: `${HOME_DIR}/elsewhere/r`,
    },
    {
      name: 'a wigley-features home with its repo set',
      root: `${HOME_DIR}/wigley-features/r`,
      isInClone: true,
      settings: [
        { repo: 'other', folder: '~/dev/other' },
        { repo: 'r', folder: '~/dev/r' },
      ],
      folder: `${HOME_DIR}/dev/r`,
    },
    {
      name: 'no entry',
      root: `${HOME_DIR}/wigley-features/r`,
      isInClone: false,
      settings: [{ repo: 'other', folder: '~/dev/other' }],
      folder: null,
    },
    {
      name: 'a relative folder, a later entry not tried',
      root: `${HOME_DIR}/wigley-features/r`,
      isInClone: false,
      settings: [
        { repo: 'r', folder: 'dev/x' },
        { repo: 'r', folder: '~/dev/r' },
      ],
      folder: null,
    },
    {
      name: 'an empty folder',
      root: `${HOME_DIR}/wigley-features/r`,
      isInClone: false,
      settings: [{ repo: 'r', folder: '' }],
      folder: null,
    },
    {
      name: 'a trailing separator, normalized',
      root: `${HOME_DIR}/wigley-features/r`,
      isInClone: false,
      settings: [{ repo: 'r', folder: '~/dev/x/' }],
      folder: `${HOME_DIR}/dev/x`,
    },
    {
      name: 'a repo differing only in case',
      root: `${HOME_DIR}/wigley-features/r`,
      isInClone: false,
      settings: [{ repo: 'R', folder: '~/dev/r' }],
      folder: null,
    },
  ])(
    'repoFolderOf_Homes_InRepoThenSettingThenNull ($name)',
    ({ root, isInClone, settings, folder }) => {
      expect(
        repoFolderOf(
          { repo: 'r', root },
          isInClone,
          settings,
          posixPaths,
          HOME_DIR,
          DOCS_FEATURES,
        ),
      ).toBe(folder);
    },
  );

  it('repoFolderOf_CustomInRepoParts_ReadsTheCloneFolder', () => {
    expect(
      repoFolderOf(
        { repo: 'r', root: '/r/notes/todo' },
        true,
        [],
        posixPaths,
        HOME_DIR,
        [['notes', 'todo']],
      ),
    ).toBe('/r');
  });

  it('repoFolderOf_DocsFeaturesWithOtherParts_IsNotInRepo', () => {
    expect(
      repoFolderOf(
        { repo: 'r', root: '/r/docs/features' },
        true,
        [{ repo: 'r', folder: '~/dev/r' }],
        posixPaths,
        HOME_DIR,
        [['notes', 'todo']],
      ),
    ).toBe(`${HOME_DIR}/dev/r`);
  });

  it.each([
    { parts: ['features'], root: '/r/features' },
    { parts: ['a', 'b', 'c'], root: '/r/a/b/c' },
  ])(
    'repoFolderOf_OneAndThreePartLists_ClimbThatManyLevels ($root)',
    ({ parts, root }) => {
      expect(
        repoFolderOf({ repo: 'r', root }, true, [], posixPaths, HOME_DIR, [
          parts,
        ]),
      ).toBe('/r');
    },
  );
});
