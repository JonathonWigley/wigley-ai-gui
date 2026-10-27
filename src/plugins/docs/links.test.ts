import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import { resolveLink } from './links';

const HOME = '/Users/u';
const FROM = '/r/docs/a.md';

function file(path: string, line: number | null, fragment: string | null) {
  return { type: 'file', path, line, fragment };
}

function unsupported(href: string) {
  return { type: 'unsupported', href };
}

describe('resolveLink', () => {
  it.each([
    {
      href: 'https://x.dev/a',
      expected: { type: 'external', url: 'https://x.dev/a' },
    },
    {
      href: 'HTTP://x.dev',
      expected: { type: 'external', url: 'HTTP://x.dev' },
    },
    { href: 'vscode://x', expected: unsupported('vscode://x') },
    { href: 'mailto:a@b.c', expected: unsupported('mailto:a@b.c') },
    {
      href: '#core-services',
      expected: { type: 'heading', fragment: 'core-services' },
    },
    { href: '#a%20b', expected: { type: 'heading', fragment: 'a b' } },
    { href: '#L7', expected: file('/r/docs/a.md', 7, null) },
    { href: '../b.md#L4', expected: file('/r/b.md', 4, null) },
    { href: 'b.md:12', expected: file('/r/docs/b.md', 12, null) },
    { href: 'b.md#setup', expected: file('/r/docs/b.md', null, 'setup') },
    {
      href: '~/x/my%20doc.md',
      expected: file('/Users/u/x/my doc.md', null, null),
    },
    { href: 'file:///r/c.md', expected: file('/r/c.md', null, null) },
    { href: 'file://localhost/r/c.md', expected: file('/r/c.md', null, null) },
    {
      href: 'file://server/share/c.md',
      expected: unsupported('file://server/share/c.md'),
    },
    { href: 'localhost:3000', expected: unsupported('localhost:3000') },
    { href: 'tel:555', expected: unsupported('tel:555') },
    { href: './a/b:3', expected: file('/r/docs/a/b', 3, null) },
    { href: '', expected: unsupported('') },
    { href: 'file://', expected: unsupported('file://') },
    { href: '#', expected: file('/r/docs/a.md', 1, null) },
    { href: '?', expected: file('/r/docs/a.md', null, null) },
    { href: '?v=2#setup', expected: file('/r/docs/a.md', null, 'setup') },
    { href: '/x.md', expected: file('/x.md', null, null) },
    { href: 'C:/r/y.md', expected: unsupported('C:/r/y.md') },
    { href: 'file://C:/r/y.md', expected: unsupported('file://C:/r/y.md') },
  ])('"$href" → $expected.type', ({ href, expected }) => {
    expect(resolveLink(href, FROM, HOME, posixPaths)).toEqual(expected);
  });
});

describe('resolveLink on Windows', () => {
  const WINDOWS_HOME = 'C:\\Users\\u';
  const WINDOWS_FROM = 'C:\\r\\docs\\a.md';

  it.each([
    {
      href: '../x.md',
      from: WINDOWS_FROM,
      expected: file('C:\\r\\x.md', null, null),
    },
    {
      href: '/x.md',
      from: WINDOWS_FROM,
      expected: file('C:\\x.md', null, null),
    },
    {
      href: '\\x.md',
      from: WINDOWS_FROM,
      expected: file('C:\\x.md', null, null),
    },
    {
      href: '/sub/../x.md#L3',
      from: WINDOWS_FROM,
      expected: file('C:\\x.md', 3, null),
    },
    {
      href: '\\x.md',
      from: 'D:\\r\\a.md',
      expected: file('D:\\x.md', null, null),
    },
    {
      href: '/x.md',
      from: '\\\\srv\\share\\r\\a.md',
      expected: file('\\\\srv\\share\\x.md', null, null),
    },
    {
      href: '~/notes/b.md:4',
      from: WINDOWS_FROM,
      expected: file('C:\\Users\\u\\notes\\b.md', 4, null),
    },
    {
      href: 'C:/r/y.md',
      from: WINDOWS_FROM,
      expected: file('C:\\r\\y.md', null, null),
    },
    {
      href: 'file:///C:/r/y.md',
      from: WINDOWS_FROM,
      expected: file('C:\\r\\y.md', null, null),
    },
    {
      href: 'file://localhost/C:/r/y.md',
      from: WINDOWS_FROM,
      expected: file('C:\\r\\y.md', null, null),
    },
    {
      href: 'file://C:/r/y.md',
      from: WINDOWS_FROM,
      expected: file('C:\\r\\y.md', null, null),
    },
    {
      href: 'file://server/share/x.md#L2',
      from: WINDOWS_FROM,
      expected: file('\\\\server\\share\\x.md', 2, null),
    },
    {
      href: 'file:///r/y.md',
      from: WINDOWS_FROM,
      expected: unsupported('file:///r/y.md'),
    },
    {
      href: 'file://server',
      from: WINDOWS_FROM,
      expected: unsupported('file://server'),
    },
  ])('"$href" from $from → $expected.type', ({ href, from, expected }) => {
    expect(resolveLink(href, from, WINDOWS_HOME, windowsPaths)).toEqual(
      expected,
    );
  });
});
