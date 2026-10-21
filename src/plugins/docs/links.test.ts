import { describe, expect, it } from 'vitest';
import { resolveLink } from './links';

const HOME = '/Users/u';
const FROM = '/r/docs/a.md';

function resolve(href: string) {
  return resolveLink(href, FROM, HOME);
}

describe('resolveLink', () => {
  it('resolve_Http_External', () => {
    expect(resolve('https://x.dev/a')).toEqual({
      type: 'external',
      url: 'https://x.dev/a',
    });
    expect(resolve('MAILTO:a@b.c')).toEqual({
      type: 'external',
      url: 'MAILTO:a@b.c',
    });
  });

  it('resolve_OtherScheme_Unsupported', () => {
    expect(resolve('vscode://x')).toEqual({
      type: 'unsupported',
      href: 'vscode://x',
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
