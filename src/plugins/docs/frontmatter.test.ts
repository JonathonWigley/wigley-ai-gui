import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from './frontmatter';

describe('splitFrontmatter', () => {
  it('split_NoOpeningFence_WholeTextIsBody', () => {
    expect(splitFrontmatter('# Hi\n')).toEqual({
      fields: [],
      body: '# Hi\n',
      bodyStartLine: 1,
    });
  });

  it('split_UnclosedFence_WholeTextIsBody', () => {
    expect(splitFrontmatter('---\na: b\n# Hi\n')).toEqual({
      fields: [],
      body: '---\na: b\n# Hi\n',
      bodyStartLine: 1,
    });
  });

  it('split_Fields_InOrderQuotesStripped', () => {
    const text = '---\nname: x\ndescription: "Use it"\n---\n# Body\n';

    expect(splitFrontmatter(text)).toEqual({
      fields: [
        ['name', 'x'],
        ['description', 'Use it'],
      ],
      body: '# Body\n',
      bodyStartLine: 5,
    });
  });

  it('split_FoldedValue_JoinedWithSpaces', () => {
    const text = '---\ndescription: >-\n  one\n  two\nname: x\n---\n';

    expect(splitFrontmatter(text).fields).toEqual([
      ['description', 'one two'],
      ['name', 'x'],
    ]);
  });

  it('split_LiteralValue_JoinedWithNewlines', () => {
    const text = '---\nbody: |\n  one\n  two\n---\n';

    expect(splitFrontmatter(text).fields).toEqual([['body', 'one\ntwo']]);
  });

  it('split_ListUnderEmptyValue_KeptAsWritten', () => {
    const text = '---\npaths:\n  - a\n  - b\n---\n';

    expect(splitFrontmatter(text).fields).toEqual([['paths', '- a - b']]);
  });

  it('split_CrlfFences_Recognized', () => {
    expect(splitFrontmatter('---\r\na: b\r\n---\r\nx')).toEqual({
      fields: [['a', 'b']],
      body: 'x',
      bodyStartLine: 4,
    });
  });
});
