import type { PluginManifest } from '../contracts/plugin';
import { disabledDependencyProblem } from './plugin-manifests';

function requireUniqueIds(manifests: readonly PluginManifest[]) {
  const seen = new Set<string>();
  for (const manifest of manifests) {
    if (seen.has(manifest.id)) {
      throw new Error(`Two plugins have the id "${manifest.id}"`);
    }
    seen.add(manifest.id);
  }
}

function requireDependenciesListed(
  manifests: readonly PluginManifest[],
  known: readonly PluginManifest[],
) {
  const ids = new Set(known.map((manifest) => manifest.id));
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
// `dependsOn`, which started before it; undefined for one with no part here.
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

// The pending part to start next: the first in `pending` once none of its
// dependencies is pending, else the first such part down the chain of each
// one's first pending dependency in list order. Throws on a chain that comes
// back to a part it passed, naming the parts of that cycle.
function nextToStart<Part extends { manifest: PluginManifest }>(
  pending: readonly Part[],
): Part {
  const firstPendingDependency = (part: Part) =>
    pending.find((each) => part.manifest.dependsOn.includes(each.manifest.id));
  const chain = [pending[0]];
  let dependency = firstPendingDependency(chain[0]);
  while (dependency !== undefined) {
    if (chain.includes(dependency)) {
      const cycle = chain.slice(chain.indexOf(dependency));
      const ids = cycle.map((part) => part.manifest.id).join(', ');
      throw new Error(`Plugins depend on each other in a cycle: ${ids}`);
    }
    chain.push(dependency);
    dependency = firstPendingDependency(dependency);
  }
  return chain[chain.length - 1];
}

// Starts every part whose id `disabled` does not name, in list order, each
// part's dependencies started just before it when the list holds them later,
// so a part listed earlier than another starts before it unless it depends on
// it; hands each part the exports of its dependencies. Plugins that add parts
// to one surface (chat's composer parts) add them in this order. `known` is
// every plugin's manifest, those with no part in this process included; a
// dependency in `known` with no part here, such as a page-only plugin in
// main, starts nowhere in this process. Returns
// what each start returned, by plugin id, in start order. Throws on a
// duplicate id, a dependency not in `known`, a kept part depending on a
// disabled plugin, or a dependency cycle.
export function startPlugins<
  Part extends { manifest: PluginManifest },
  Started extends { exports?: unknown },
>(
  parts: readonly Part[],
  start: (part: Part, dependency: <E>(pluginId: string) => E) => Started,
  known: readonly PluginManifest[] = parts.map((part) => part.manifest),
  disabled: readonly string[] = [],
): Map<string, Started> {
  const kept = parts.filter((part) => !disabled.includes(part.manifest.id));
  const manifests = kept.map((part) => part.manifest);
  requireUniqueIds(manifests);
  requireDependenciesListed(manifests, known);
  const problem = disabledDependencyProblem(disabled, manifests);
  if (problem !== null) {
    throw new Error(problem);
  }
  const started = new Map<string, Started>();
  let pending = [...kept];
  while (pending.length > 0) {
    const ready = nextToStart(pending);
    started.set(
      ready.manifest.id,
      start(ready, dependencyFor(ready.manifest, started)),
    );
    pending = pending.filter((part) => part !== ready);
  }
  return started;
}
