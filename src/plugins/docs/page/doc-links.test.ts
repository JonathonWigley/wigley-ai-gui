import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import { docLinkOf, docLinksText, pastedImagePath } from './doc-links';

const DOC = '/n/docs/guide.md';

describe('docLinkOf', () => {
  it.each([
    {
      filePath: '/n/docs/images/a.png',
      docPath: DOC,
      mediaType: 'image/png',
      link: '![a.png](images/a.png)',
    },
    {
      filePath: '/n/notes/b.md',
      docPath: DOC,
      mediaType: 'text/markdown',
      link: '[b.md](../notes/b.md)',
    },
    {
      filePath: '/n/docs/My File (1).pdf',
      docPath: DOC,
      mediaType: 'application/pdf',
      link: '[My File (1).pdf](<My File (1).pdf>)',
    },
    {
      filePath: '/n/docs/a<b>.txt',
      docPath: DOC,
      mediaType: 'text/plain',
      link: '[a<b>.txt](<a\\<b\\>.txt>)',
    },
    {
      filePath: '/n/docs/[x].svg',
      docPath: DOC,
      mediaType: 'image/svg+xml',
      link: '![\\[x\\].svg]([x].svg)',
    },
    {
      filePath: '/n/docs/clips',
      docPath: DOC,
      mediaType: '',
      link: '[clips](clips)',
    },
    {
      filePath: '/n/docs',
      docPath: DOC,
      mediaType: '',
      link: '[docs](../docs)',
    },
    {
      filePath: '/n/docs/C# notes.md',
      docPath: DOC,
      mediaType: 'text/markdown',
      link: '[C# notes.md](<C%23 notes.md>)',
    },
    {
      filePath: '/n/docs/100%.md',
      docPath: DOC,
      mediaType: 'text/markdown',
      link: '[100%.md](100%25.md)',
    },
    {
      filePath: '/n/docs/what?.md',
      docPath: DOC,
      mediaType: 'text/markdown',
      link: '[what?.md](what%3F.md)',
    },
    {
      filePath: '/n/docs/a\\b.md',
      docPath: DOC,
      mediaType: 'text/markdown',
      link: '[a\\\\b.md](a\\b.md)',
    },
    {
      filePath: 'C:\\n\\docs\\img\\a.png',
      docPath: 'C:\\n\\docs\\g.md',
      mediaType: 'image/png',
      link: '![a.png](img/a.png)',
      windows: true,
    },
    {
      filePath: 'D:\\x\\a.pdf',
      docPath: 'C:\\n\\g.md',
      mediaType: 'application/pdf',
      link: '[a.pdf](D:\\x\\a.pdf)',
      windows: true,
    },
  ])(
    'docLinkOf_RelativeMarkdownLink $filePath',
    ({ filePath, docPath, mediaType, link, windows }) => {
      const paths = windows === true ? windowsPaths : posixPaths;

      expect(docLinkOf(filePath, docPath, mediaType, paths)).toBe(link);
    },
  );
});

describe('docLinksText', () => {
  it.each([
    { links: ['[a](a)', '[b](b)'], charBefore: '', text: '[a](a) [b](b)' },
    { links: ['[a](a)'], charBefore: 'x', text: ' [a](a)' },
    { links: ['[a](a)'], charBefore: ' ', text: '[a](a)' },
    { links: ['[a](a)'], charBefore: '\n', text: '[a](a)' },
  ])(
    'docLinksText_SpacesBetweenAndBefore $charBefore',
    ({ links, charBefore, text }) => {
      expect(docLinksText(links, charBefore)).toBe(text);
    },
  );
});

describe('pastedImagePath', () => {
  const at = new Date(2026, 10, 2, 9, 5, 7).getTime();

  it.each([
    {
      docPath: DOC,
      mediaType: 'image/png',
      index: 0,
      path: '/n/docs/images/guide-20261102-090507.png',
    },
    {
      docPath: DOC,
      mediaType: 'image/jpeg',
      index: 0,
      path: '/n/docs/images/guide-20261102-090507.jpg',
    },
    {
      docPath: DOC,
      mediaType: 'image/png',
      index: 1,
      path: '/n/docs/images/guide-20261102-090507-2.png',
    },
    {
      docPath: '/n/docs/notes.v2.md',
      mediaType: 'image/webp',
      index: 0,
      path: '/n/docs/images/notes.v2-20261102-090507.webp',
    },
    {
      docPath: DOC,
      mediaType: '',
      index: 0,
      path: '/n/docs/images/guide-20261102-090507.bin',
    },
  ])(
    'pastedImagePath_BesideTheDoc $path',
    ({ docPath, mediaType, index, path }) => {
      expect(pastedImagePath(docPath, mediaType, at, index, posixPaths)).toBe(
        path,
      );
    },
  );
});
