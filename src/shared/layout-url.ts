import type { LayoutOwner } from '../contracts/layouts';
import type { Paths } from '../contracts/paths';
import {
  decodedPathSegments,
  decodedSegment,
  encodedPath,
  isRevisionSegment,
  parsedSchemeUrl,
  plainSegment,
} from './file-url';

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

// The name served from the owner's default folder rather than `layoutsRoot`.
const DEFAULT_NAME = 'default';

// The file a `layoutUrl` names, joined by `paths` with the revision dropped:
// `<defaultFolderOf(owner)>/<path>` for the name `default`, else
// `<layoutsRoot>/<owner>/<name>/<path>`. Null when `url` is not a layout URL
// with an owner, a name and a revision, when the owner or the name is not one
// plain segment, when `decodedPathSegments` refuses the path, or when the name
// is `default` and `defaultFolderOf` returns null.
export function layoutFilePath(
  url: string,
  layoutsRoot: string,
  paths: Paths,
  defaultFolderOf: (owner: LayoutOwner) => string | null,
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
  if (name === DEFAULT_NAME) {
    const defaultFolder = defaultFolderOf(owner);
    return defaultFolder === null
      ? null
      : paths.join(defaultFolder, ...pathSegments);
  }
  return paths.join(layoutsRoot, owner, name, ...pathSegments);
}
