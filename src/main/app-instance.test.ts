import { describe, expect, it } from 'vitest';
import { appBuildOf } from './app-instance';

describe('appBuildOf', () => {
  it.each([
    {
      case: 'a commit and a clone',
      commit: 'abc',
      cloneDir: '/r',
      isBuild: true,
    },
    { case: 'no commit', commit: '', cloneDir: '/r', isBuild: false },
    { case: 'no clone', commit: 'abc', cloneDir: null, isBuild: false },
  ])('appBuildOf_$case', ({ commit, cloneDir, isBuild }) => {
    expect(appBuildOf(commit, cloneDir)).toEqual(
      isBuild ? { commit, cloneDir } : null,
    );
  });
});
