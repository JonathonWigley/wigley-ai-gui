import type { Paths } from '../contracts/paths';
import { relativeSegments } from './scoped-files';

// The scheme that serves the page the files in each plugin's data folder.
export const DATA_SCHEME = 'wigley-data';

const REVISION_SEGMENT = /^~\d+$/;

// `wigley-data://<pluginId>/~<revision>/<path>`, each of `path`'s `/`-joined
// segments URI-encoded.
export function dataUrl(
  pluginId: string,
  revision: number,
  path: string,
): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `${DATA_SCHEME}://${pluginId}/~${revision}/${encoded}`;
}

// The file a `dataUrl` names, `<dataRoot>/<pluginId>/<decoded path>` joined
// by `paths` with the revision dropped; null when `url` is not a data URL with
// a plugin and a revision, or `relativeSegments` refuses its plugin id, finds
// no segment in it, or refuses its decoded path.
export function dataFilePath(
  url: string,
  dataRoot: string,
  paths: Paths,
): string | null {
  const parsed = URL.parse(url);
  if (parsed === null || parsed.protocol !== `${DATA_SCHEME}:`) {
    return null;
  }
  const pluginSegments = relativeSegments(parsed.hostname);
  if (pluginSegments === null || pluginSegments.length === 0) {
    return null;
  }
  const [revision, ...segments] = parsed.pathname.slice(1).split('/');
  if (!REVISION_SEGMENT.test(revision)) {
    return null;
  }
  const decoded = decodedPath(segments.join('/'));
  const fileSegments = decoded === null ? null : relativeSegments(decoded);
  return fileSegments === null
    ? null
    : paths.join(dataRoot, ...pluginSegments, ...fileSegments);
}

// Null for a malformed escape such as a lone `%`.
function decodedPath(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}
