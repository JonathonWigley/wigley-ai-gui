import type { Paths } from '../contracts/paths';
import {
  decodedPathSegments,
  encodedPath,
  isRevisionSegment,
  parsedSchemeUrl,
  plainSegment,
} from './file-url';

// The scheme that serves the page the files of each user plugin.
export const PLUGIN_SCHEME = 'wigley-plugin';

// `wigley-plugin://<id>/~<revision>/<path>`, each segment of `path`
// URI-encoded.
export function pluginUrl(
  pluginId: string,
  revision: number,
  path: string,
): string {
  return `${PLUGIN_SCHEME}://${pluginId}/~${revision}/${encodedPath(path)}`;
}

// `<codeRoot>/<pluginId>/<revision>/<path>` joined by `paths`, the revision
// kept as a folder (the per-revision copy); null when `url` is not a plugin URL
// with an id and a `~<n>` revision, when the id is not one plain segment, or
// when `decodedPathSegments` refuses the path.
export function pluginFilePath(
  url: string,
  codeRoot: string,
  paths: Paths,
): string | null {
  const parsed = parsedSchemeUrl(url, PLUGIN_SCHEME);
  if (parsed === null) {
    return null;
  }
  const [revision, ...encodedSegments] = parsed.pathname.slice(1).split('/');
  if (!isRevisionSegment(revision)) {
    return null;
  }
  const pluginId = plainSegment(parsed.hostname);
  const fileSegments = decodedPathSegments(encodedSegments);
  if (pluginId === null || fileSegments === null) {
    return null;
  }
  return paths.join(codeRoot, pluginId, revision.slice(1), ...fileSegments);
}
