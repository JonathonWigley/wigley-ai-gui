import { relativeSegments } from './scoped-files';

// The `~<revision>` segment the file schemes put in a URL's path.
const REVISION_SEGMENT = /^~\d+$/;

// `path`'s `/`-joined segments, each URI-encoded.
export function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

// `url` parsed, or null when it does not parse or its scheme is not `scheme`.
export function parsedSchemeUrl(url: string, scheme: string): URL | null {
  const parsed = URL.parse(url);
  return parsed === null || parsed.protocol !== `${scheme}:` ? null : parsed;
}

export function isRevisionSegment(
  segment: string | undefined,
): segment is string {
  return segment !== undefined && REVISION_SEGMENT.test(segment);
}

// The path's segments decoded one by one, its `.` and `..` folded; null when
// a decoded segment holds a `/` (an encoded one), when `relativeSegments`
// refuses the decoded path, or when it is empty. The URL parser folds `..`
// and `%2E%2E` segments before decoding, so the climb `relativeSegments`
// refuses is not reachable through a parsed URL.
export function decodedPathSegments(
  encoded: readonly string[],
): string[] | null {
  const decoded: string[] = [];
  for (const segment of encoded) {
    const one = decodedSegment(segment);
    if (one === null || one.includes('/')) {
      return null;
    }
    decoded.push(one);
  }
  const segments = relativeSegments(decoded.join('/'));
  return segments === null || segments.length === 0 ? null : segments;
}

// Null for a malformed escape such as a lone `%`.
export function decodedSegment(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

// `segment` when it names one entry: not empty, `.` or `..`, and holding no
// `/`, `\` or drive prefix; else null. The URL parser folds a `.` or `..`
// name, `%2E` forms included, before it reaches here.
export function plainSegment(segment: string | null): string | null {
  if (segment === null) {
    return null;
  }
  const segments = relativeSegments(segment);
  return segments !== null && segments.length === 1 && segments[0] === segment
    ? segment
    : null;
}
