import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import type { NoteHome } from './contract';
import { defaultTarget, launchFolder } from './note-targets';

const GUI_CLONE = '/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui';
const AGENTS_CLONE = '/Users/jonathonwigley/Documents/ai-dev/wigley-agents';
const OTHER = '/Users/jonathonwigley/Documents/dev/other';

const A: NoteHome = {
  repo: 'wigley-ai-gui',
  root: `${GUI_CLONE}/docs/features`,
  folder: GUI_CLONE,
  followups: [],
};
const B: NoteHome = {
  repo: 'wigley-agents',
  root: '/Users/jonathonwigley/wigley-features/wigley-agents',
  folder: null,
  followups: [],
};
const HOMES = [A, B];

function target(projectDir: string | null) {
  return defaultTarget(HOMES, projectDir, posixPaths);
}

describe('defaultTarget', () => {
  it('defaultTarget_CloneFolder_ItsHome', () => {
    expect(target(GUI_CLONE)).toBe(A);
  });

  it('defaultTarget_InsideClone_ItsHome', () => {
    expect(target(`${GUI_CLONE}/src/plugins`)).toBe(A);
  });

  it('defaultTarget_FolderNamedForRepo_ThatHome', () => {
    expect(target(AGENTS_CLONE)).toBe(B);
  });

  it('defaultTarget_ParentNamedForRepo_ThatHome', () => {
    expect(target(`${AGENTS_CLONE}/skills`)).toBe(B);
  });

  it('defaultTarget_NoMatch_Null', () => {
    expect(target(OTHER)).toBeNull();
  });

  it('defaultTarget_NoProjectDir_Null', () => {
    expect(target(null)).toBeNull();
  });

  it('defaultTarget_NestedClones_DeepestWins', () => {
    const nested: NoteHome = {
      ...A,
      repo: 'inner',
      folder: `${GUI_CLONE}/vendor/inner`,
    };
    expect(
      defaultTarget([A, nested], `${GUI_CLONE}/vendor/inner/x`, posixPaths),
    ).toBe(nested);
  });
});

describe('launchFolder', () => {
  it('launchFolder_HomeWithClone_TheClone', () => {
    expect(launchFolder(A, [], posixPaths)).toBe(GUI_CLONE);
  });

  it('launchFolder_HomeWithoutClone_FirstSessionFolderMatching', () => {
    expect(launchFolder(B, [OTHER, AGENTS_CLONE], posixPaths)).toBe(
      AGENTS_CLONE,
    );
  });

  it('launchFolder_HomeWithoutCloneNoSessions_Null', () => {
    expect(launchFolder(B, [], posixPaths)).toBeNull();
  });
});
