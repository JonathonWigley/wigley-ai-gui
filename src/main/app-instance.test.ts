import { describe, expect, it } from 'vitest';
import { appBuildOf } from './app-instance';

describe('appBuildOf', () => {
  it.each([
    {
      case: 'a commit and a clone',
      commit: 'abc',
      cloneDir: '/r',
      isLive: true,
      isBuild: true,
    },
    {
      case: 'no commit',
      commit: '',
      cloneDir: '/r',
      isLive: true,
      isBuild: false,
    },
    {
      case: 'no clone',
      commit: 'abc',
      cloneDir: null,
      isLive: true,
      isBuild: false,
    },
    {
      case: 'a self-test or drive run',
      commit: 'abc',
      cloneDir: '/r',
      isLive: false,
      isBuild: false,
    },
  ])('appBuildOf_$case', ({ commit, cloneDir, isLive, isBuild }) => {
    expect(appBuildOf(commit, cloneDir, isLive)).toEqual(
      isBuild ? { commit, cloneDir } : null,
    );
  });
});
