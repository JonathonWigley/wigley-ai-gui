import { resolveInside } from './scoped-files';

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

// The file a `dataUrl` names, `<dataRoot>/<pluginId>/<decoded path>` with the
// revision dropped; null when `url` is not a data URL with a plugin and a
// revision, or its decoded path resolves outside the plugin's folder.
export function dataFilePath(url: string, dataRoot: string): string | null {
  const parsed = URL.parse(url);
  if (parsed === null || parsed.protocol !== `${DATA_SCHEME}:`) {
    return null;
  }
  const pluginRoot = resolveInside(dataRoot, parsed.hostname);
  if (pluginRoot === null || pluginRoot === dataRoot) {
    return null;
  }
  const [revision, ...segments] = parsed.pathname.slice(1).split('/');
  if (!REVISION_SEGMENT.test(revision)) {
    return null;
  }
  const decoded = decodedPath(segments.join('/'));
  return decoded === null ? null : resolveInside(pluginRoot, decoded);
}

// Null for a malformed escape such as a lone `%`.
function decodedPath(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}
