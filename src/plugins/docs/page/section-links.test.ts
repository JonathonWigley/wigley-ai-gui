import { describe, expect, it } from 'vitest';
import type { IndexLink } from '../contract';
import { findRaw, linksByBlock, matchText } from './section-links';

function link(line: number, form: IndexLink['form'] = 'section'): IndexLink {
  return { form, raw: `§ At ${line}`, target: '/t.md', line, targetLine: null };
}

describe('matchText', () => {
  it.each([
    ['`AGENTS.md` § Intent', 'AGENTS.md § Intent'],
    ['`wigley:make` § Run log › Groups', 'wigley:make § Run log › Groups'],
    ['§ The  \n key', '§ The key'],
    ['§ The **bold** part', '§ The bold part'],
    ['`a.md`\n> § B', 'a.md § B'],
  ])('%s reads as %s', (raw, expected) => {
    expect(matchText(raw)).toBe(expected);
  });
});

describe('findRaw', () => {
  it.each([
    {
      name: 'one run',
      runs: ['see § Intent for more'],
      raw: '§ Intent',
      from: 0,
      expected: {
        start: { run: 0, offset: 4 },
        end: { run: 0, offset: 12 },
        nextIndex: 12,
      },
    },
    {
      name: 'a match that ends on a run boundary',
      runs: ['see ', 'AGENTS.md', ' tail'],
      raw: '`AGENTS.md`',
      from: 0,
      expected: {
        start: { run: 1, offset: 0 },
        end: { run: 1, offset: 9 },
        nextIndex: 13,
      },
    },
    {
      name: 'a raw across runs',
      runs: ['see ', 'AGENTS.md', ' § Intent for more'],
      raw: '`AGENTS.md` § Intent',
      from: 0,
      expected: {
        start: { run: 1, offset: 0 },
        end: { run: 2, offset: 9 },
        nextIndex: 22,
      },
    },
    {
      name: 'a wrap',
      runs: ['a.md\n§ B'],
      raw: '`a.md` § B',
      from: 0,
      expected: {
        start: { run: 0, offset: 0 },
        end: { run: 0, offset: 8 },
        nextIndex: 8,
      },
    },
    {
      name: 'marks and doubled whitespace in the runs, offsets in the runs',
      runs: ['x  *§*  The\n  key'],
      raw: '§ The key',
      from: 0,
      expected: {
        start: { run: 0, offset: 4 },
        end: { run: 0, offset: 17 },
        nextIndex: 11,
      },
    },
    {
      name: 'the second of two equal references, from the first’s nextIndex',
      runs: ['§ A and § A'],
      raw: '§ A',
      from: 3,
      expected: {
        start: { run: 0, offset: 8 },
        end: { run: 0, offset: 11 },
        nextIndex: 11,
      },
    },
    {
      name: 'no match',
      runs: ['see § Other'],
      raw: '§ Intent',
      from: 0,
      expected: null,
    },
    {
      name: 'a mark that renders otherwise',
      runs: ['§ a_b'],
      raw: '§ a\\_b',
      from: 0,
      expected: null,
    },
  ])('$name', ({ runs, raw, from, expected }) => {
    expect(findRaw(runs, raw, from)).toEqual(expected);
  });
});

describe('linksByBlock', () => {
  it('places each link in the last block at or before its body line', () => {
    const inBlock = link(7);
    const inLastBlock = link(12);

    const byBlock = linksByBlock(
      [inBlock, inLastBlock, link(2), link(7, 'markdown')],
      [1, 3, 8],
      4,
    );

    expect([...byBlock]).toEqual([
      [1, [inBlock]],
      [2, [inLastBlock]],
    ]);
  });

  it('keeps the index order within a block', () => {
    const first = link(5);
    const second = link(4);

    expect(linksByBlock([first, second], [1], 1).get(0)).toEqual([
      first,
      second,
    ]);
  });

  it('takes the last block in document order of those on one line', () => {
    const inner = link(3);

    expect(linksByBlock([inner], [1, 3, 3], 1).get(2)).toEqual([inner]);
  });

  it('leaves out a link above the first block', () => {
    expect(linksByBlock([link(2)], [5], 1).size).toBe(0);
  });
});
