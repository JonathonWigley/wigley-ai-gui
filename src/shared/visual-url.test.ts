import { describe, expect, it } from 'vitest';
import {
  localImagePathOf,
  localImageUrl,
  refusesFrameNavigation,
  visualHashOf,
  visualUrl,
} from './visual-url';

const H = 'ab'.repeat(32);

describe('localImageUrl', () => {
  it.each([
    [
      'a POSIX path',
      '/Users/me/a.png',
      'wigley-visual://visual/Users/me/a.png',
    ],
    ['a drive path', 'C:/me/a.webp', 'wigley-visual://visual/C:/me/a.webp'],
    [
      'a backslashed drive path',
      'C:\\me\\a.gif',
      'wigley-visual://visual/C:/me/a.gif',
    ],
  ])('localImageUrl serves %s on the visual host', (_case, path, url) => {
    expect(localImageUrl(path)).toBe(url);
  });

  it.each([
    ['a relative path', 'me/a.png'],
    ['no image type', '/Users/me/a.html'],
    ['no extension', '/Users/me/a'],
    ['a web URL', 'https://example.com/a.png'],
    ['an empty segment', '/Users//a.png'],
  ])('localImageUrl refuses %s', (_case, path) => {
    expect(localImageUrl(path)).toBe(null);
  });
});

describe('localImagePathOf', () => {
  it.each([
    ['its own URL', 'wigley-visual://visual/Users/me/a.png', '/Users/me/a.png'],
    [
      'an encoded space',
      'wigley-visual://visual/Users/My%20Pics/a.JPG',
      '/Users/My Pics/a.JPG',
    ],
    ['a fragment', 'wigley-visual://visual/a/b.svg#x', '/a/b.svg'],
    ['a folded climb', 'wigley-visual://visual/a/../b.jpeg', '/b.jpeg'],
    ['a drive', 'wigley-visual://visual/C:/me/a.png', 'C:/me/a.png'],
  ])('localImagePathOf reads back the path of %s', (_case, url, path) => {
    expect(localImagePathOf(url)).toBe(path);
  });

  it.each([
    ['a visual hash', visualUrl(H)],
    ['other host', 'wigley-visual://other/Users/me/a.png'],
    ['other scheme', 'wigley-layout://visual/Users/me/a.png'],
    ['an encoded slash', 'wigley-visual://visual/a%2Fb/c.png'],
    ['an encoded backslash', 'wigley-visual://visual/a%5Cb/c.png'],
    ['no image type', 'wigley-visual://visual/etc/hosts'],
  ])('localImagePathOf refuses %s', (_case, url) => {
    expect(localImagePathOf(url)).toBe(null);
  });
});

describe('visualUrl', () => {
  it('visualUrl puts the hash in the path of the visual host', () => {
    expect(visualUrl(H)).toBe('wigley-visual://visual/' + H);
  });
});

describe('visualHashOf', () => {
  it.each([
    ['its own URL', visualUrl(H)],
    ['a fragment', visualUrl(H) + '#top'],
    ['a query', visualUrl(H) + '?x=1'],
  ])("visualHashOf reads back a visual URL's hash: %s", (_case, url) => {
    expect(visualHashOf(url)).toBe(H);
  });

  it.each([
    ['other scheme', 'wigley-layout://visual/' + H],
    ['other host', 'wigley-visual://other/' + H],
    ['short hash', 'wigley-visual://visual/' + H.slice(1)],
    ['uppercase hex', 'wigley-visual://visual/' + H.toUpperCase()],
    ['extra segment', 'wigley-visual://visual/' + H + '/x'],
    ['no hash', 'wigley-visual://visual/'],
    ['not a URL', 'not a url'],
  ])(
    'visualHashOf refuses a URL that is not a visual URL: %s',
    (_case, url) => {
      expect(visualHashOf(url)).toBe(null);
    },
  );
});

describe('refusesFrameNavigation', () => {
  it.each([
    {
      case: 'subframe to a visual',
      url: visualUrl(H),
      isMainFrame: false,
      refused: false,
    },
    {
      case: 'subframe to the network',
      url: 'https://example.com/',
      isMainFrame: false,
      refused: true,
    },
    {
      case: 'subframe to a blank page',
      url: 'about:blank',
      isMainFrame: false,
      refused: true,
    },
    {
      case: 'subframe to another app scheme',
      url: 'wigley-layout://forms/x/~1/layout.js',
      isMainFrame: false,
      refused: true,
    },
    {
      case: 'main frame to the network',
      url: 'https://example.com/',
      isMainFrame: true,
      refused: false,
    },
    {
      case: 'main frame to a visual',
      url: visualUrl(H),
      isMainFrame: true,
      refused: false,
    },
  ])(
    'refusesFrameNavigation decides by frame and scheme: $case',
    ({ url, isMainFrame, refused }) => {
      expect(refusesFrameNavigation({ url, isMainFrame })).toBe(refused);
    },
  );
});
