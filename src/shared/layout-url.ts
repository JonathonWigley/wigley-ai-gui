import type { LayoutOwner } from '../contracts/layouts';
import type { Paths } from '../contracts/paths';
import {
  decodedPathSegments,
  decodedSegment,
  encodedPath,
  isRevisionSegment,
  parsedSchemeUrl,
} from './file-url';
import { relativeSegments } from './scoped-files';

// The scheme that serves the page the files of each owner's layouts.
export const LAYOUT_SCHEME = 'wigley-layout';

// `wigley-layout://<owner>/<name>/~<revision>/<path>`, each segment of `name`
// and `path` URI-encoded.
export function layoutUrl(
  owner: LayoutOwner,
  name: string,
  revision: number,
  path: string,
): string {
  return `${LAYOUT_SCHEME}://${owner}/${encodeURIComponent(name)}/~${revision}/${encodedPath(path)}`;
}

// The file a `layoutUrl` names, `<layoutsRoot>/<owner>/<name>/<path>` joined
// by `paths` with the revision dropped; null when `url` is not a layout URL
// with an owner, a name and a revision, when the owner or the name is not one
// plain segment, or when `decodedPathSegments` refuses the path.
export function layoutFilePath(
  url: string,
  layoutsRoot: string,
  paths: Paths,
): string | null {
  const parsed = parsedSchemeUrl(url, LAYOUT_SCHEME);
  if (parsed === null) {
    return null;
  }
  const [encodedName, revision, ...encodedPath] = parsed.pathname
    .slice(1)
    .split('/');
  if (!isRevisionSegment(revision)) {
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
// `/`, `\` or drive prefix; else null. The URL parser folds a `.` or `..`
// name, `%2E` forms included, before it reaches here.
function plainSegment(segment: string | null): string | null {
  if (segment === null) {
    return null;
  }
  const segments = relativeSegments(segment);
  return segments !== null && segments.length === 1 && segments[0] === segment
    ? segment
    : null;
}
