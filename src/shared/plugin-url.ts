import { encodedPath } from './file-url';

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
