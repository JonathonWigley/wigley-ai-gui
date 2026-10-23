import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../shared/paths/posix-paths';
import { windowsPaths } from '../../shared/paths/windows-paths';
import { resolveLink } from './links';

const HOME = '/Users/u';
const FROM = '/r/docs/a.md';

function resolve(href: string) {
  return resolveLink(href, FROM, HOME, posixPaths);
}

describe('resolveLink', () => {
  it('resolve_Http_External', () => {
    expect(resolve('https://x.dev/a')).toEqual({
      type: 'external',
      url: 'https://x.dev/a',
    });
    expect(resolve('HTTP://x.dev')).toEqual({
      type: 'external',
      url: 'HTTP://x.dev',
    });
  });

  it('resolve_OtherScheme_Unsupported', () => {
    expect(resolve('vscode://x')).toEqual({
      type: 'unsupported',
      href: 'vscode://x',
    });
    expect(resolve('mailto:a@b.c')).toEqual({
      type: 'unsupported',
      href: 'mailto:a@b.c',
    });
  });

  it('resolve_Hash_Heading', () => {
    expect(resolve('#core-services')).toEqual({
      type: 'heading',
      fragment: 'core-services',
    });
    expect(resolve('#a%20b')).toEqual({ type: 'heading', fragment: 'a b' });
  });

  it('resolve_HashLine_SameFileLine', () => {
    expect(resolve('#L7')).toEqual({
      type: 'file',
      path: '/r/docs/a.md',
      line: 7,
      fragment: null,
    });
  });

  it('resolve_RelativeWithLine_Resolved', () => {
    expect(resolve('../b.md#L4')).toEqual({
      type: 'file',
      path: '/r/b.md',
      line: 4,
      fragment: null,
    });
  });

  it('resolve_ColonLine_Resolved', () => {
    expect(resolve('b.md:12')).toEqual({
      type: 'file',
      path: '/r/docs/b.md',
      line: 12,
      fragment: null,
    });
  });

  it('resolve_FileFragment_Kept', () => {
    expect(resolve('b.md#setup')).toEqual({
      type: 'file',
      path: '/r/docs/b.md',
      line: null,
      fragment: 'setup',
    });
  });

  it('resolve_TildeAndEncoded_Expanded', () => {
    expect(resolve('~/x/my%20doc.md')).toEqual({
      type: 'file',
      path: '/Users/u/x/my doc.md',
      line: null,
      fragment: null,
    });
  });

  it('resolve_FileUrl_AsAbsolute', () => {
    expect(resolve('file:///r/c.md')).toEqual({
      type: 'file',
      path: '/r/c.md',
      line: null,
      fragment: null,
    });
  });

  it('resolve_HostPortAndTel_Unsupported', () => {
    expect(resolve('localhost:3000')).toEqual({
      type: 'unsupported',
      href: 'localhost:3000',
    });
    expect(resolve('tel:555')).toEqual({
      type: 'unsupported',
      href: 'tel:555',
    });
  });

  it('resolve_DotSlashColonLine_Resolved', () => {
    expect(resolve('./a/b:3')).toEqual({
      type: 'file',
      path: '/r/docs/a/b',
      line: 3,
      fragment: null,
    });
  });

  it('resolve_Empty_Unsupported', () => {
    expect(resolve('')).toEqual({ type: 'unsupported', href: '' });
    expect(resolve('file://')).toEqual({
      type: 'unsupported',
      href: 'file://',
    });
  });

  it('resolve_HashAlone_DocTop', () => {
    expect(resolve('#')).toEqual({
      type: 'file',
      path: '/r/docs/a.md',
      line: 1,
      fragment: null,
    });
  });

  it('resolve_QueryOnly_SameDoc', () => {
    expect(resolve('?')).toEqual({
      type: 'file',
      path: '/r/docs/a.md',
      line: null,
      fragment: null,
    });
    expect(resolve('?v=2#setup')).toEqual({
      type: 'file',
      path: '/r/docs/a.md',
      line: null,
      fragment: 'setup',
    });
  });
});

describe('resolveLink on Windows', () => {
  const WINDOWS_HOME = 'C:\\Users\\u';
  const WINDOWS_FROM = 'C:\\r\\docs\\a.md';

  function resolveOnWindows(href: string) {
    return resolveLink(href, WINDOWS_FROM, WINDOWS_HOME, windowsPaths);
  }

  it('resolve_WindowsRelativeParent_Resolved', () => {
    expect(resolveOnWindows('../x.md')).toEqual({
      type: 'file',
      path: 'C:\\r\\x.md',
      line: null,
      fragment: null,
    });
  });

  it('resolve_WindowsTildeWithLine_Expanded', () => {
    expect(resolveOnWindows('~/notes/b.md:4')).toEqual({
      type: 'file',
      path: 'C:\\Users\\u\\notes\\b.md',
      line: 4,
      fragment: null,
    });
  });

  it('resolve_WindowsDrivePath_File', () => {
    expect(resolveOnWindows('C:/r/y.md')).toEqual({
      type: 'file',
      path: 'C:\\r\\y.md',
      line: null,
      fragment: null,
    });
    expect(resolve('C:/r/y.md')).toEqual({
      type: 'unsupported',
      href: 'C:/r/y.md',
    });
  });

  it('resolve_WindowsFileUrl_DropsSlashBeforeDrive', () => {
    expect(resolveOnWindows('file:///C:/r/y.md')).toEqual({
      type: 'file',
      path: 'C:\\r\\y.md',
      line: null,
      fragment: null,
    });
  });
});
