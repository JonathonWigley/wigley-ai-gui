import { describe, expect, it } from 'vitest';
import {
  sectionAt,
  sectionsOf,
  sectionText,
  spliceSection,
  type DocSection,
} from './sections';

const FENCE = '```';

function ranges(
  sections: readonly DocSection[],
): [string, number, number, number][] {
  return sections.map((section) => [
    section.title,
    section.level,
    section.startLine,
    section.endLine,
  ]);
}

function sectionTitled(text: string, title: string): DocSection {
  const section = sectionsOf(text).find((each) => each.title === title);
  if (section === undefined) {
    throw new Error(`no section titled ${title}`);
  }
  return section;
}

describe('sectionsOf', () => {
  it.each([
    {
      given: 'lead, nesting, frontmatter and a fence',
      text: [
        '---',
        'name: x',
        '---',
        '# T',
        'intro',
        '## A',
        'a',
        '### A1',
        'a1',
        '## B',
        FENCE,
        '## not',
        FENCE,
        'end',
      ].join('\n'),
      expected: [
        ['T', 1, 4, 5],
        ['A', 2, 6, 9],
        ['A1', 3, 8, 9],
        ['B', 2, 10, 14],
      ],
    },
    {
      given: 'last line ending does not add a line',
      text: ['# T', '## A', 'a', ''].join('\n'),
      expected: [
        ['T', 1, 1, 1],
        ['A', 2, 2, 3],
      ],
    },
    {
      given: 'first heading is not level 1',
      text: ['intro', '## A', '# B', 'b'].join('\n'),
      expected: [
        ['A', 2, 2, 2],
        ['B', 1, 3, 4],
      ],
    },
    {
      given: 'second # is no lead',
      text: ['# T', 'x', '# U', 'y', '## V', 'z'].join('\n'),
      expected: [
        ['T', 1, 1, 2],
        ['U', 1, 3, 6],
        ['V', 2, 5, 6],
      ],
    },
    {
      given: 'lead alone',
      text: ['# T', 'x'].join('\n'),
      expected: [['T', 1, 1, 2]],
    },
    {
      given: 'all six levels',
      text: ['# a', '## b', '### c', '#### d', '##### e', '###### f'].join(
        '\n',
      ),
      expected: [
        ['a', 1, 1, 1],
        ['b', 2, 2, 6],
        ['c', 3, 3, 6],
        ['d', 4, 4, 6],
        ['e', 5, 5, 6],
        ['f', 6, 6, 6],
      ],
    },
    {
      given: 'CRLF file',
      text: '# T\r\n## A\r\na\r\n',
      expected: [
        ['T', 1, 1, 1],
        ['A', 2, 2, 3],
      ],
    },
    {
      given: 'closing hashes',
      text: '## A ##',
      expected: [['A', 2, 1, 1]],
    },
    {
      given: 'a # with no space before it stays in the title',
      text: ['## C#', '## D #', '## E# ##'].join('\n'),
      expected: [
        ['C#', 2, 1, 1],
        ['D', 2, 2, 2],
        ['E#', 2, 3, 3],
      ],
    },
    {
      given: 'frontmatter fences with trailing spaces and a \\r',
      text: ['---  ', 'name: x', '--- \r', '# T'].join('\n'),
      expected: [['T', 1, 4, 4]],
    },
    {
      given: '--- with a trailing tab is no frontmatter',
      text: ['---\t', '# x', '---', '# y'].join('\n'),
      expected: [
        ['x', 1, 2, 3],
        ['y', 1, 4, 4],
      ],
    },
    {
      given: '--- with a leading space is no frontmatter',
      text: [' ---', '# x', '---', '# y'].join('\n'),
      expected: [
        ['x', 1, 2, 3],
        ['y', 1, 4, 4],
      ],
    },
    {
      given: 'a lone \\r is text',
      text: ['# T\ra', '## A'].join('\n'),
      expected: [
        ['T\ra', 1, 1, 1],
        ['A', 2, 2, 2],
      ],
    },
    {
      given: 'not headings',
      text: ['#', '#word', '####### x', '  # x', '    # x'].join('\n'),
      expected: [],
    },
    {
      given: 'tilde fence closed by a longer run',
      text: ['~~~', '# x', '~~~~', '# y'].join('\n'),
      expected: [['y', 1, 4, 4]],
    },
    {
      given: 'backtick run with a backtick after it is no fence',
      text: [`${FENCE} \` ${FENCE}`, '# y'].join('\n'),
      expected: [['y', 1, 2, 2]],
    },
    {
      given: 'unclosed fence',
      text: [FENCE, '# x'].join('\n'),
      expected: [],
    },
  ])('sectionsOf_Ranges: $given', ({ text, expected }) => {
    expect(ranges(sectionsOf(text))).toEqual(expected);
  });
});

describe('sectionAt', () => {
  const sections = sectionsOf(
    ['intro', '## A', 'a', '### A1', 'a1', '## B'].join('\n'),
  );

  it.each([
    { line: 1, expected: null },
    { line: 2, expected: 'A' },
    { line: 3, expected: 'A' },
    { line: 5, expected: 'A1' },
    { line: 6, expected: 'B' },
  ])('sectionAt_Line: $line → $expected', ({ line, expected }) => {
    expect(sectionAt(sections, line)?.title ?? null).toBe(expected);
  });
});

describe('spliceSection', () => {
  it.each([
    {
      given: 'LF',
      text: '# T\n\n## A\na\n\n## B\nb\n',
      next: '## A\nz',
      expected: '# T\n\n## A\nz\n## B\nb\n',
    },
    {
      given: 'CRLF, next in LF',
      text: '# T\r\n## A\r\na\r\n## B\r\n',
      next: '## A\nz\ny',
      expected: '# T\r\n## A\r\nz\r\ny\r\n## B\r\n',
    },
    {
      given: 'CRLF, next in CRLF',
      text: '## A\r\na\r\n',
      next: '## A\r\nz',
      expected: '## A\r\nz\r\n',
    },
    {
      given: 'no last line ending',
      text: '## A\na',
      next: '## A\nz',
      expected: '## A\nz',
    },
    {
      given: 'last line ending stays',
      text: '## A\na\n',
      next: '## A\nz',
      expected: '## A\nz\n',
    },
    {
      given: 'mixed endings stay',
      text: 'x\r\n## A\na\n# B\ny\n',
      next: '## A\nz',
      expected: 'x\r\n## A\r\nz\n# B\ny\n',
    },
    {
      given: 'empty next',
      text: '## A\na\n',
      next: '',
      expected: '\n',
    },
  ])(
    'spliceSection_KeepsEveryOtherByte: $given',
    ({ text, next, expected }) => {
      expect(spliceSection(text, sectionTitled(text, 'A'), next)).toBe(
        expected,
      );
    },
  );

  it.each([
    {
      given: 'LF',
      text: '---\nname: x\n---\n# T\nintro\n\n## A\na\n### A1\n\n## B\nb',
    },
    {
      given: 'CRLF',
      text: '# T\r\nintro\r\n\r\n## A\r\na\r\n### A1\r\n\r\n## B\r\nb\r\n\r\n',
    },
  ])('spliceSection_SectionText_RoundTrips: $given', ({ text }) => {
    const sections = sectionsOf(text);

    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(spliceSection(text, section, sectionText(text, section))).toBe(
        text,
      );
    }
  });
});
