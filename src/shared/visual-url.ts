import { parsedSchemeUrl } from './file-url';

// The scheme that serves the page each visual's document, by its source's hash.
export const VISUAL_SCHEME = 'wigley-visual';

// A visual URL's path: `/` and a lowercase hex SHA-256.
const HASH_PATH = /^\/([0-9a-f]{64})$/;

// `wigley-visual://visual/<hash>`: the host is always `visual`, and the hash
// sits in the path, since 64 characters pass the 63-character DNS label limit.
export function visualUrl(hash: string): string {
  return `${VISUAL_SCHEME}://visual/${hash}`;
}

// The hash a `visualUrl` names, its search and fragment ignored; null when
// `url` is not a visual URL on the `visual` host with one 64-character
// lowercase hex segment.
export function visualHashOf(url: string): string | null {
  const parsed = parsedSchemeUrl(url, VISUAL_SCHEME);
  if (parsed === null || parsed.hostname !== 'visual') {
    return null;
  }
  return HASH_PATH.exec(parsed.pathname)?.[1] ?? null;
}

// Whether main refuses a frame's navigation: a subframe stays on the
// `wigley-visual:` scheme, since CSP does not cover navigation.
export function refusesFrameNavigation(details: {
  url: string;
  isMainFrame: boolean;
}): boolean {
  return !details.isMainFrame && visualHashOf(details.url) === null;
}
