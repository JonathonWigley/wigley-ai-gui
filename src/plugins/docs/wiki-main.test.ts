import { describe, expect, it } from 'vitest';
import { parseWikiMain, type WikiItem, type WikiTarget } from './wiki-main';

const FENCE = '```';
// Two skill link prefixes, one inside the other, so the longest must win.
const PREFIXES = { 'wigley:': 'wigley@m', 'wigley:dev:': 'wigley-dev@m' };

function pathPage(title: string, path: string): WikiItem {
  return { type: 'page', title, target: { type: 'path', path } };
}

describe('parseWikiMain', () => {
  it('parseWikiMain_Structure', () => {
    const text = [
      '# Top',
      'A paragraph with [Before](x.md).',
      '### Early',
      '## Shelf A',
      '- [One](a.md)',
      'see [Two](b.md) and [Three](c.md)',
      '### Label',
      '- [Four](d.md)',
      FENCE,
      '## Not',
      '[No](n.md)',
      FENCE,
      'a span `[No](n.md)` here',
      '![No](n.png)',
      '#### Deep',
      '- [Five](e.md)',
      '## Empty',
      '## Shelf B',
      '- [Six](f.md)',
    ].join('\n');

    expect(parseWikiMain(text, PREFIXES)).toEqual([
      {
        title: 'Shelf A',
        items: [
          pathPage('One', 'a.md'),
          pathPage('Two', 'b.md'),
          pathPage('Three', 'c.md'),
          { type: 'label', title: 'Label' },
          pathPage('Four', 'd.md'),
          pathPage('Five', 'e.md'),
        ],
      },
      { title: 'Empty', items: [] },
      { title: 'Shelf B', items: [pathPage('Six', 'f.md')] },
    ]);
  });

  it('parseWikiMain_LinkText', () => {
    const text = [
      '## Shelf',
      '[`code`](a.md)',
      '`[No](n.md)`',
      'see `x` [Two](b.md)',
    ].join('\n');

    expect(parseWikiMain(text, PREFIXES)[0].items).toEqual([
      pathPage('`code`', 'a.md'),
      pathPage('Two', 'b.md'),
    ]);
  });

  const pageTo = (target: WikiTarget): WikiItem[] => [
    { type: 'page', title: 'P', target },
  ];

  it.each<{ target: string; expected: WikiItem[] }>([
    { target: '~/a.md', expected: pageTo({ type: 'path', path: '~/a.md' }) },
    { target: '../a.md', expected: pageTo({ type: 'path', path: '../a.md' }) },
    { target: '<a b.md>', expected: pageTo({ type: 'path', path: 'a b.md' }) },
    {
      target: 'https://x.test',
      expected: pageTo({ type: 'path', path: 'https://x.test' }),
    },
    {
      target: 'wigley:make',
      expected: pageTo({ type: 'skill', prefix: 'wigley:', name: 'make' }),
    },
    {
      target: 'wigley:dev:make',
      expected: pageTo({ type: 'skill', prefix: 'wigley:dev:', name: 'make' }),
    },
    {
      target: 'other:make',
      expected: pageTo({ type: 'path', path: 'other:make' }),
    },
    {
      target: 'wigley:a/b',
      expected: pageTo({ type: 'path', path: 'wigley:a/b' }),
    },
    { target: 'wigley:', expected: pageTo({ type: 'path', path: 'wigley:' }) },
    {
      target: 'wiki:kind/skill',
      expected: pageTo({ type: 'kind', kind: 'skill' }),
    },
    {
      target: 'wiki:kind/made-up',
      expected: pageTo({ type: 'kind', kind: 'made-up' }),
    },
    {
      target: 'wiki:owner/third-party',
      expected: pageTo({ type: 'owner', owner: 'third-party' }),
    },
    { target: 'wiki:all', expected: pageTo({ type: 'all' }) },
    { target: 'wiki:', expected: [] },
    { target: 'wiki:other', expected: [] },
    { target: 'wiki:kind/', expected: [] },
    { target: 'wiki:kind/a/b', expected: [] },
    { target: 'wiki:owner/mine', expected: [] },
    { target: 'wiki:all/x', expected: [] },
  ])('parseWikiMain_Target: $target', ({ target, expected }) => {
    const text = `## Shelf\n[P](${target})`;

    expect(parseWikiMain(text, PREFIXES)).toEqual([{ title: 'Shelf', items: expected }]);
  });
});
