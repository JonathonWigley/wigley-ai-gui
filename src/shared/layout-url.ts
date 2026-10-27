import type { LayoutOwner } from '../contracts/layouts';
import type { Paths } from '../contracts/paths';
import { relativeSegments } from './scoped-files';

// The scheme that serves the page the files of each owner's layouts.
export const LAYOUT_SCHEME = 'wigley-layout';

const REVISION_SEGMENT = /^~\d+$/;

// `wigley-layout://<owner>/<name>/~<revision>/<path>`, each segment of `name`
// and `path` URI-encoded.
export function layoutUrl(
  owner: LayoutOwner,
  name: string,
  revision: number,
  path: string,
): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${LAYOUT_SCHEME}://${owner}/${encodeURIComponent(name)}/~${revision}/${encoded}`;
}

// The file a `layoutUrl` names, `<layoutsRoot>/<owner>/<name>/<path>` joined
// by `paths` with the revision dropped; null when `url` is not a layout URL
// with an owner, a name and a revision, when the owner or the name is not one
// plain segment, or when the decoded path holds a `/` or `\` inside a
// segment or climbs out of the layout's folder.
export function layoutFilePath(
  url: string,
  layoutsRoot: string,
  paths: Paths,
): string | null {
  const parsed = URL.parse(url);
  if (parsed === null || parsed.protocol !== `${LAYOUT_SCHEME}:`) {
    return null;
  }
  const [encodedName, revision, ...encodedPath] = parsed.pathname
    .slice(1)
    .split('/');
  if (revision === undefined || !REVISION_SEGMENT.test(revision)) {
    return null;
  }
  const owner = plainSegment(parsed.hostname);
  const name = plainSegment(decodedSegment(encodedName));
  const pathSegments = decodedPathSegments(encodedPath);
  if (owner === null || name === null || pathSegments === null) {
    return null;
  }
  return paths.join(layoutsRoot, owner, name, ...pathSegments);
}

// `segment` when it names one entry: not empty, `.` or `..`, and holding no
// `/`, `\` or drive prefix; else null.
function plainSegment(segment: string | null): string | null {
  if (segment === null) {
    return null;
  }
  const segments = relativeSegments(segment);
  return segments !== null && segments.length === 1 && segments[0] === segment
    ? segment
    : null;
}

// The path's segments decoded one by one, its `.` and `..` folded; null when
// a decoded segment holds a `/` (an encoded one), when `relativeSegments`
// refuses the decoded path, or when it is empty.
function decodedPathSegments(encoded: readonly string[]): string[] | null {
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
function decodedSegment(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}
