import type { DocsBinding } from '../contract';

// The file, in the docs plugin's data folder, that hands the docs index the
// binding: `docs_index.py --contributions <file>`. The index's README
// (`agent-plugin/scripts/docs-index/README.md` § Contributions file) holds its
// schema.
export const CONTRIBUTIONS_JSON = 'contributions.json';

const CONTRIBUTIONS_FILE_VERSION = 1;

// The file's text: two-space JSON with a trailing newline, every path as the
// contribution wrote it. `wikiMain` is left out: only the app reads it.
export function contributionsFileText(binding: DocsBinding): string {
  const file = {
    version: CONTRIBUTIONS_FILE_VERSION,
    globalFolders: binding.globalFolders,
    linkPrefixes: binding.linkPrefixes,
    features: binding.features,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}
