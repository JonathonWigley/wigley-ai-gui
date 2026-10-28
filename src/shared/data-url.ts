import type { Paths } from '../contracts/paths';
import {
  decodedPathSegments,
  encodedPath,
  isRevisionSegment,
  parsedSchemeUrl,
} from './file-url';
import { relativeSegments } from './scoped-files';

// The scheme that serves the page the files in each plugin's data folder.
export const DATA_SCHEME = 'wigley-data';

// `wigley-data://<pluginId>/~<revision>/<path>`, each of `path`'s `/`-joined
// segments URI-encoded.
export function dataUrl(
  pluginId: string,
  revision: number,
  path: string,
): string {
  return `${DATA_SCHEME}://${pluginId}/~${revision}/${encodedPath(path)}`;
}

// The file a `dataUrl` names, `<dataRoot>/<pluginId>/<path>` joined by
// `paths` with the revision dropped; null when `url` is not a data URL with a
// plugin and a revision, when `relativeSegments` refuses its plugin id or
// finds no segment in it, or when `decodedPathSegments` refuses the path.
export function dataFilePath(
  url: string,
  dataRoot: string,
  paths: Paths,
): string | null {
  const parsed = parsedSchemeUrl(url, DATA_SCHEME);
  if (parsed === null) {
    return null;
  }
  const pluginSegments = relativeSegments(parsed.hostname);
  if (pluginSegments === null || pluginSegments.length === 0) {
    return null;
  }
  const [revision, ...encodedSegments] = parsed.pathname.slice(1).split('/');
  if (!isRevisionSegment(revision)) {
    return null;
  }
  const fileSegments = decodedPathSegments(encodedSegments);
  return fileSegments === null
    ? null
    : paths.join(dataRoot, ...pluginSegments, ...fileSegments);
}
