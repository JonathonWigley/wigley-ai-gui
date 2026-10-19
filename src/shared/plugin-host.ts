import type { PluginManifest } from '../contracts/plugin';

function requireUniqueIds(manifests: readonly PluginManifest[]) {
  const seen = new Set<string>();
  for (const manifest of manifests) {
    if (seen.has(manifest.id)) {
      throw new Error(`Two plugins have the id "${manifest.id}"`);
    }
    seen.add(manifest.id);
  }
}

function requireDependenciesListed(manifests: readonly PluginManifest[]) {
  const ids = new Set(manifests.map((manifest) => manifest.id));
  for (const manifest of manifests) {
    const missing = manifest.dependsOn.filter((id) => !ids.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Plugin "${manifest.id}" depends on plugins not in the list: ${missing.join(', ')}`,
      );
    }
  }
}

// `dependency` for a part: the exports of a plugin its manifest lists in
// `dependsOn`, which started before it.
function dependencyFor(
  manifest: PluginManifest,
  started: ReadonlyMap<string, { exports?: unknown }>,
): <E>(pluginId: string) => E {
  return <E>(pluginId: string): E => {
    if (!manifest.dependsOn.includes(pluginId)) {
      throw new Error(
        `Plugin "${manifest.id}" asked for plugin "${pluginId}", which its manifest does not list in dependsOn`,
      );
    }
    return started.get(pluginId)?.exports as E;
  };
}

// Starts every part, each after the parts its manifest depends on and otherwise
// in list order, handing it the exports of those dependencies. Returns what
// each start returned, by plugin id, in start order. Throws on a duplicate id,
// a dependency not in the list, or a dependency cycle.
export function startPlugins<
  Part extends { manifest: PluginManifest },
  Started extends { exports?: unknown },
>(
  parts: readonly Part[],
  start: (part: Part, dependency: <E>(pluginId: string) => E) => Started,
): Map<string, Started> {
  const manifests = parts.map((part) => part.manifest);
  requireUniqueIds(manifests);
  requireDependenciesListed(manifests);
  const started = new Map<string, Started>();
  let pending = [...parts];
  while (pending.length > 0) {
    const ready = pending.find((part) =>
      part.manifest.dependsOn.every((id) => started.has(id)),
    );
    if (!ready) {
      const waiting = pending.map((part) => part.manifest.id).join(', ');
      throw new Error(`Plugins depend on each other in a cycle: ${waiting}`);
    }
    started.set(
      ready.manifest.id,
      start(ready, dependencyFor(ready.manifest, started)),
    );
    pending = pending.filter((part) => part !== ready);
  }
  return started;
}
