import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../paths/posix-paths';
import { windowsPaths } from '../../paths/windows-paths';
import { fileChipsIn, insertionText } from './file-chips';

type Chip = [from: number, to: number, path: string, name: string];

describe('fileChipsIn', () => {
  it.each([
    {
      text: 'see /Users/me/a.png now',
      paths: posixPaths,
      chips: [[4, 19, '/Users/me/a.png', 'a.png']],
    },
    {
      text: '"/Users/me/My File.md"',
      paths: posixPaths,
      chips: [[0, 22, '/Users/me/My File.md', 'My File.md']],
    },
    {
      text: '/a/b /c/d',
      paths: posixPaths,
      chips: [
        [0, 4, '/a/b', 'b'],
        [5, 9, '/c/d', 'd'],
      ],
    },
    {
      text: 'end /tmp/x/y.md.',
      paths: posixPaths,
      chips: [[4, 15, '/tmp/x/y.md', 'y.md']],
    },
    { text: '/compact now', paths: posixPaths, chips: [] },
    { text: '/', paths: posixPaths, chips: [] },
    { text: 'and/or a/b', paths: posixPaths, chips: [] },
    { text: 'https://x.com/a/b', paths: posixPaths, chips: [] },
    // The first quote closes on no quote before the line break; `/c"` holds a
    // quote.
    { text: '"/a/b\n/c"', paths: posixPaths, chips: [[1, 5, '/a/b', 'b']] },
    // `it"s` holds a quote and is no chip, so the next quote opens the path.
    {
      text: 'it"s "/a/b/c.md"',
      paths: posixPaths,
      chips: [[5, 16, '/a/b/c.md', 'c.md']],
    },
    { text: '/a/b"c/d.md', paths: posixPaths, chips: [] },
    { text: 'x /a/"b"/c/d', paths: posixPaths, chips: [] },
    // A quote stuck to the text before it still opens a quoted chip.
    {
      text: '("/a/b c.md")',
      paths: posixPaths,
      chips: [[1, 12, '/a/b c.md', 'b c.md']],
    },
    {
      text: 'see:"/a/b/c.md"',
      paths: posixPaths,
      chips: [[4, 15, '/a/b/c.md', 'c.md']],
    },
    { text: 'x"/a/b"', paths: posixPaths, chips: [[1, 7, '/a/b', 'b']] },
    { text: 'C:\\a\\b"c\\d', paths: windowsPaths, chips: [] },
    {
      text: 'C:\\Users\\me\\a.png',
      paths: windowsPaths,
      chips: [[0, 17, 'C:\\Users\\me\\a.png', 'a.png']],
    },
    {
      text: 'C:/Users/me/a.png',
      paths: windowsPaths,
      chips: [[0, 17, 'C:/Users/me/a.png', 'a.png']],
    },
  ] satisfies { text: string; paths: typeof posixPaths; chips: Chip[] }[])(
    'finds each absolute path in $text',
    ({ text, paths, chips }) => {
      const found = fileChipsIn(text, paths).map(({ from, to, path, name }) => [
        from,
        to,
        path,
        name,
      ]);
      expect(found).toEqual(chips);
    },
  );
});

describe('insertionText', () => {
  it.each([
    { filePaths: ['/a/b.png'], charBefore: '', text: '/a/b.png' },
    { filePaths: ['/a/b.png'], charBefore: 'x', text: ' /a/b.png' },
    { filePaths: ['/a/b.png'], charBefore: ' ', text: '/a/b.png' },
    { filePaths: ['/a/b.png'], charBefore: '\n', text: '/a/b.png' },
    {
      filePaths: ['/a/My File.md', '/a/c'],
      charBefore: 'x',
      text: ' "/a/My File.md" /a/c',
    },
    {
      filePaths: ['C:\\My Docs\\a.txt'],
      charBefore: '',
      text: '"C:\\My Docs\\a.txt"',
    },
    { filePaths: ['/a/b/foo(1)'], charBefore: '', text: '"/a/b/foo(1)"' },
    { filePaths: ['/a/b/file.'], charBefore: '', text: '"/a/b/file."' },
    { filePaths: ['/a/b"c.'], charBefore: '', text: '/a/b"c.' },
  ])(
    'spaces and quotes the paths: $filePaths after $charBefore → $text',
    ({ filePaths, charBefore, text }) => {
      expect(insertionText(filePaths, charBefore)).toBe(text);
    },
  );
});
