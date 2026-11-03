import { describe, expect, it } from 'vitest';
import { refusesFrameNavigation, visualHashOf, visualUrl } from './visual-url';

const H = 'ab'.repeat(32);

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
