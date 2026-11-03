import { describe, expect, it } from 'vitest';
import { resolveCloneDir } from './resolve-clone-dir';

const FOLDER = '/clone';

describe('resolveCloneDir', () => {
  it.each([
    { baked: FOLDER, expected: FOLDER },
    { baked: '/missing', expected: null },
    { baked: '', expected: null },
    { baked: 'clone', expected: null },
  ])(
    'resolveCloneDir_KeepsOnlyAnAbsoluteFolder: $baked',
    async ({ baked, expected }) => {
      const isFolder = async (path: string) =>
        path === FOLDER || path === 'clone';

      expect(await resolveCloneDir(baked, isFolder)).toBe(expected);
    },
  );
});
