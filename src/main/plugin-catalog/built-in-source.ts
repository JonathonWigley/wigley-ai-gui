import type { MainPart, PluginManifest } from '../../contracts/plugin';
import type { PluginSource, SourceLoad } from '../../contracts/plugin-catalog';
import { requireListed } from '../../shared/plugin-manifests';

// The plugins compiled into the app: one `loaded` per manifest, in list order,
// at revision 0. They never change while the app runs, so the watch sends
// nothing. Throws when a main part's manifest is not in `manifests`.
export function createBuiltInSource(deps: {
  manifests: readonly PluginManifest[];
  mainParts: readonly MainPart[];
}): PluginSource {
  const { manifests, mainParts } = deps;
  requireListed(mainParts, manifests);

  const loadOf = (manifest: PluginManifest): SourceLoad => ({
    kind: 'loaded',
    entry: {
      manifest,
      revision: 0,
      main: mainParts.find((part) => part.manifest === manifest) ?? null,
      pageUrl: null,
      folder: null,
    },
  });

  return {
    loadAll: async () => manifests.map(loadOf),
    watch: () => ({ dispose() {} }),
    reload: async (id) => {
      const manifest = manifests.find((listed) => listed.id === id);
      return manifest === undefined ? { kind: 'gone', id } : loadOf(manifest);
    },
  };
}
