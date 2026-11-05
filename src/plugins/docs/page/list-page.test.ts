import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type { IndexEntry } from '../contract';
import { parseWikiTarget } from '../wiki-main';
import {
  listPageContent,
  listPlace,
  type ListTarget,
  listTargetOfPlace,
} from './list-page';

const HOME = '/h';
const NOW = Date.parse('2026-11-05T15:00:00Z');
const SKILLS: ListTarget = { type: 'kind', kind: 'skill' };
const THIRD_PARTY: ListTarget = { type: 'owner', owner: 'third-party' };

function entry(fields: Partial<IndexEntry> & { title: string }): IndexEntry {
  const path = fields.path ?? `/h/${fields.title}.md`;
  return {
    id: path,
    kind: 'skill',
    source: 'repo',
    owner: 'mine',
    repo: null,
    root: null,
    plugin: null,
    path,
    line: null,
    meta: {},
    walked: [],
    headings: [],
    links: [],
    lastLoaded: null,
    ...fields,
  };
}

function contentOf(target: ListTarget, entries: IndexEntry[]) {
  return listPageContent(target, 'List', entries, HOME, NOW, posixPaths);
}

// Each group's title with its rows' titles.
function groupsOf(content: ReturnType<typeof contentOf>) {
  return content.input.groups.map((group) => [
    group.title,
    group.rows.map((row) => row.title),
  ]);
}

describe('listPageContent', () => {
  it('listPageContent_KindList_GroupsAndSorts', () => {
    const content = contentOf(SKILLS, [
      entry({
        title: 'b',
        repo: 'r2',
        lastLoaded: '2026-11-05T10:00:00Z',
      }),
      entry({ title: 'a', repo: 'r2' }),
      entry({
        title: 'z',
        repo: 'r2',
        lastLoaded: '2026-11-05T12:00:00Z',
      }),
      entry({ title: 'c' }),
      entry({ title: 'd', repo: 'r1' }),
      entry({ title: 'vendor', owner: 'third-party' }),
      entry({ title: 'hook', kind: 'hook' }),
    ]);

    expect({
      count: content.input.count,
      groups: groupsOf(content),
      ids: content.entryIds,
    }).toEqual({
      count: 5,
      groups: [
        ['Global', ['c']],
        ['r1', ['d']],
        ['r2', ['z', 'b', 'a']],
      ],
      ids: [['/h/c.md'], ['/h/d.md'], ['/h/z.md', '/h/b.md', '/h/a.md']],
    });
  });

  it.each([
    {
      fields: { path: '/h/a.md', line: null, lastLoaded: null },
      path: '~/a.md',
      time: null,
    },
    {
      fields: {
        path: '/h/f.md',
        id: '/h/f.md#L12',
        line: 12,
        lastLoaded: null,
      },
      path: '~/f.md:12',
      time: null,
    },
    {
      fields: {
        path: '/h/a.md',
        line: null,
        lastLoaded: new Date(NOW - 3 * 3_600_000).toISOString(),
      },
      path: '~/a.md',
      time: { text: '3h', title: expect.stringMatching(/^Last loaded /) },
    },
  ])('listPageContent_Row $path', ({ fields, path, time }) => {
    const content = contentOf(SKILLS, [entry({ title: 'a', ...fields })]);

    expect(content.input.groups[0].rows[0]).toEqual({ title: 'a', path, time });
  });

  it('listPageContent_OwnerList_ListsThirdPartyOnly', () => {
    const content = contentOf(THIRD_PARTY, [
      entry({ title: 'one', owner: 'third-party' }),
      entry({ title: 'two', owner: 'third-party' }),
      entry({ title: 'mine' }),
    ]);

    expect({
      count: content.input.count,
      groups: groupsOf(content),
    }).toEqual({ count: 2, groups: [['Global', ['one', 'two']]] });
  });

  it('listPageContent_ThirdPartyList_GroupsByPlugin', () => {
    const content = contentOf(THIRD_PARTY, [
      entry({ title: 's', owner: 'third-party', repo: 'r9' }),
      entry({ title: 'p', owner: 'third-party', plugin: 'x@m' }),
      entry({ title: 'q', owner: 'third-party', plugin: 'a@m' }),
    ]);

    expect(groupsOf(content)).toEqual([
      ['Global', ['s']],
      ['a@m', ['q']],
      ['x@m', ['p']],
    ]);
  });
});

describe('list places', () => {
  it.each([
    { target: SKILLS, place: 'wiki:kind/skill' },
    { target: THIRD_PARTY, place: 'wiki:owner/third-party' },
  ])('listPlace_RoundTrips $place', ({ target, place }) => {
    expect({
      place: listPlace(target),
      target: listTargetOfPlace(place),
      isTheLinksOwnText: parseWikiTarget(place),
    }).toEqual({ place, target, isTheLinksOwnText: target });
  });

  it.each(['/a/b.md', 'wiki:all'])('listTargetOfPlace_NoList %s', (path) => {
    expect(listTargetOfPlace(path)).toBeNull();
  });
});
