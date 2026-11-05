import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import type { IndexEntry, IndexLink } from './contract';
import { linkedFrom } from './linked-from';

function entry(overrides: Partial<IndexEntry> & { path: string }): IndexEntry {
  return {
    id: overrides.path,
    kind: 'skill-file',
    source: 'repo',
    owner: 'mine',
    repo: null,
    root: null,
    plugin: null,
    line: null,
    title: posixPaths.base(overrides.path),
    meta: {},
    walked: [],
    headings: [],
    links: [],
    lastLoaded: null,
    ...overrides,
  };
}

function link(target: string, line: number): IndexLink {
  return { form: 'markdown', raw: target, target, line, targetLine: null };
}

describe('linkedFrom', () => {
  it.each([
    {
      given: 'link to the real path',
      entries: [
        entry({ path: '/g/t.md' }),
        entry({ path: '/g/s.md', links: [link('/g/t.md', 5)] }),
      ],
      targetPath: '/g/t.md',
      expected: ['/g/s.md'],
    },
    {
      given: 'caller passes a walked path',
      entries: [
        entry({ path: '/g/t.md', walked: ['/l/t.md'] }),
        entry({ path: '/g/s.md', links: [link('/g/t.md', 5)] }),
      ],
      targetPath: '/l/t.md',
      expected: ['/g/s.md'],
    },
    {
      given: 'target no entry lists',
      entries: [entry({ path: '/g/s.md', links: [link('/g/gone.md', 5)] })],
      targetPath: '/g/gone.md',
      expected: ['/g/s.md'],
    },
    {
      given: "link to another clone's copy",
      entries: [
        entry({ path: '/c/a/t.md', repo: 'r', root: '/c/a' }),
        entry({ path: '/c/b/t.md', repo: 'r', root: '/c/b' }),
        entry({
          path: '/c/b/s.md',
          repo: 'r',
          root: '/c/b',
          links: [link('/c/b/t.md', 5)],
        }),
      ],
      targetPath: '/c/a/t.md',
      expected: [],
    },
    {
      given: 'link to another file',
      entries: [
        entry({ path: '/g/t.md' }),
        entry({ path: '/g/s.md', links: [link('/g/u.md', 5)] }),
      ],
      targetPath: '/g/t.md',
      expected: [],
    },
  ])('linkedFrom_Match: $given', ({ entries, targetPath, expected }) => {
    const rows = linkedFrom(entries, targetPath);

    expect(rows.map((row) => row.path)).toEqual(expected);
  });

  it.each([
    {
      given: 'third-party',
      entries: [
        entry({ path: '/g/t.md' }),
        entry({
          path: '/g/s.md',
          owner: 'third-party',
          links: [link('/g/t.md', 5)],
        }),
      ],
    },
    {
      given: 'follow-up item',
      entries: [
        entry({ path: '/g/t.md' }),
        entry({
          id: '/g/f.md#L3',
          path: '/g/f.md',
          line: 3,
          links: [link('/g/t.md', 5)],
        }),
      ],
    },
    {
      given: 'links to itself',
      entries: [entry({ path: '/g/t.md', links: [link('/g/t.md', 5)] })],
    },
    {
      given: 'links to itself through a walked path',
      entries: [
        entry({
          path: '/g/t.md',
          walked: ['/l/t.md'],
          links: [link('/l/t.md', 5)],
        }),
      ],
    },
  ])('linkedFrom_NotASource: $given', ({ entries }) => {
    expect(linkedFrom(entries, '/g/t.md')).toEqual([]);
  });

  it('linkedFrom_SameDocInAnotherClone_NotASource', () => {
    const entries = [
      entry({ path: '/c/a/t.md', repo: 'r', root: '/c/a' }),
      entry({
        path: '/c/b/t.md',
        repo: 'r',
        root: '/c/b',
        links: [link('/c/a/t.md', 5)],
      }),
    ];

    expect(linkedFrom(entries, '/c/a/t.md')).toEqual([]);
  });

  it('linkedFrom_OneRowPerDoc_FirstLinkLineSortedByTitleThenPath', () => {
    const entries = [
      entry({ path: '/g/t.md' }),
      entry({
        path: '/g/b.md',
        title: 'beta',
        links: [link('/g/t.md', 9), link('/g/t.md', 4)],
      }),
      entry({ path: '/g/z.md', title: 'Alpha', links: [link('/g/t.md', 2)] }),
      entry({ path: '/g/a.md', title: 'Alpha', links: [link('/g/t.md', 2)] }),
    ];

    expect(linkedFrom(entries, '/g/t.md')).toEqual([
      { entryId: '/g/a.md', title: 'Alpha', path: '/g/a.md', line: 2 },
      { entryId: '/g/z.md', title: 'Alpha', path: '/g/z.md', line: 2 },
      { entryId: '/g/b.md', title: 'beta', path: '/g/b.md', line: 4 },
    ]);
  });

  it.each([
    {
      given: 'neither root holds the target',
      target: entry({ path: '/g/t.md' }),
      owner: { repo: 'r', plugin: null },
      kept: '/c/a/s.md',
    },
    {
      given: 'one root holds the target',
      target: entry({ path: '/c/z/t.md', repo: 'r', root: '/c/z' }),
      owner: { repo: 'r', plugin: null },
      kept: '/c/z/s.md',
    },
    {
      given: 'plugin key, no repo',
      target: entry({ path: '/g/t.md' }),
      owner: { repo: null, plugin: 'p@m' },
      kept: '/c/a/s.md',
    },
  ])('linkedFrom_Clones_OneRowStays: $given', ({ target, owner, kept }) => {
    const links = [link(target.path, 5)];
    const entries = [
      target,
      entry({ path: '/c/z/s.md', root: '/c/z', links, ...owner }),
      entry({ path: '/c/a/s.md', root: '/c/a', links, ...owner }),
    ];

    const rows = linkedFrom(entries, target.path);

    expect(rows.map((row) => row.path)).toEqual([kept]);
  });
});
