import { describe, expect, it } from 'vitest';
import { fenceAfterLine } from './markdown-fence';

const PATTERN = /^(`{3,}|~{3,})(.*)$/;

describe('fenceAfterLine', () => {
  it.each([
    { name: 'prose, none open', line: 'text', fence: null, expected: null },
    { name: 'prose, one open', line: 'text', fence: '```', expected: '```' },
    { name: 'an opener', line: '```ts', fence: null, expected: '```' },
    { name: 'an indented opener', line: '  ~~~', fence: null, expected: '~~~' },
    { name: 'a code span', line: '``` a ` b', fence: null, expected: null },
    {
      name: 'a backtick in a tilde info',
      line: '~~~ a ` b',
      fence: null,
      expected: '~~~',
    },
    { name: 'its closer', line: '```', fence: '```', expected: null },
    { name: 'a longer closer', line: '~~~~  ', fence: '~~~', expected: null },
    { name: 'a shorter run', line: '```', fence: '````', expected: '````' },
    { name: 'the other character', line: '~~~', fence: '```', expected: '```' },
    {
      name: 'text after the run',
      line: '``` x',
      fence: '```',
      expected: '```',
    },
  ])('$name → $expected', ({ line, fence, expected }) => {
    expect(fenceAfterLine(line, fence, PATTERN)).toBe(expected);
  });
});
