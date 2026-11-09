import type { Log } from '../contracts/log';
import type { PagePart } from '../contracts/plugin';
import type {
  CatalogProblem,
  PluginOrigin,
  ServedPlugin,
} from '../contracts/plugin-catalog';
import type { UserPageModule } from '../contracts/user-plugin';
import { errorText } from '../shared/error-text';
import { handlerProblems } from '../shared/plugin-catalog/validate-manifest';
import type { PluginHost } from '../shared/plugin-host';
import { dependencyOrder } from '../shared/plugin-manifests';

export interface PagePartLoaderDeps {
  builtIns: readonly PagePart[]; // the static `pageParts`
  importModule(url: string): Promise<unknown>;
}

// The page part `plugin` runs: the built-in part of that id for origin
// `built-in` (null when the built-in has no page part); for `user` and
// `replaces-built-in`, null when `pageUrl` is null, else the module at
// `pageUrl` paired with `plugin.manifest`. Rejects with
// `page.js of <id> exports no start function` when the module has no
// function `start`, and with the import's own error when it fails.
export async function loadPagePart(
  plugin: ServedPlugin,
  deps: PagePartLoaderDeps,
): Promise<PagePart | null> {
  if (plugin.origin === 'built-in') {
    return builtInPart(plugin.id, deps.builtIns) ?? null;
  }
  if (plugin.pageUrl === null) {
    return null;
  }
  const module = (await deps.importModule(plugin.pageUrl)) as
    | Partial<Record<keyof UserPageModule, unknown>>
    | null
    | undefined;
  const start = module?.start;
  if (typeof start !== 'function') {
    throw new Error(`page.js of ${plugin.id} exports no start function`);
  }
  return {
    manifest: plugin.manifest,
    start: start as UserPageModule['start'],
  };
}

export interface PagePartAddDeps {
  host: Pick<PluginHost<unknown, PagePart>, 'holds' | 'add'>;
  // The page part a served plugin runs, null for one with none; rejects when
  // its `page.js` does not load.
  loadPart(plugin: ServedPlugin): Promise<PagePart | null>;
}

// Loads the page part of each of `plugins` the host does not hold, one at a
// time in list order, and adds it to the host. Returns one problem per plugin
// whose `page.js` did not load (`loadFailureText`) or whose add threw
// (`Page part did not start: <error>`), in that order; a plugin with no page
// part adds nothing.
export async function loadPageParts(
  plugins: readonly ServedPlugin[],
  deps: PagePartAddDeps,
): Promise<CatalogProblem[]> {
  const problems: CatalogProblem[] = [];
  for (const plugin of plugins) {
    if (deps.host.holds(plugin.id)) {
      continue;
    }
    let part: PagePart | null;
    try {
      part = await deps.loadPart(plugin);
    } catch (error) {
      problems.push({
        id: plugin.id,
        message: loadFailureText(plugin.id, error),
      });
      continue;
    }
    if (part === null) {
      continue;
    }
    try {
      deps.host.add(part);
    } catch (error) {
      problems.push({
        id: plugin.id,
        message: `Page part did not start: ${errorText(error)}`,
      });
    }
  }
  return problems;
}

// The problem text of a `page.js` of `id` that did not load.
export function loadFailureText(id: string, error: unknown): string {
  return `page.js of ${id} failed to load: ${errorText(error)}`;
}

// The ids of `plugins` that have a page part: a `built-in` whose id
// `builtIns` holds, or a non-built-in whose `pageUrl` is not null (a page.js
// that failed to load included). In `dependencyOrder` over the served
// manifests. A main-only plugin is never in the list.
export function pagePartIds(
  plugins: readonly ServedPlugin[],
  builtIns: readonly PagePart[],
): string[] {
  const withPart = new Set(
    plugins
      .filter((plugin) =>
        plugin.origin === 'built-in'
          ? builtInPart(plugin.id, builtIns) !== undefined
          : plugin.pageUrl !== null,
      )
      .map((plugin) => plugin.id),
  );
  return orderedIds(plugins).filter((id) => withPart.has(id));
}

// The ids the page starts after load, one at a time: every id whose origin
// is not `built-in`, and every id that depends on one of those through
// `dependsOn.page`, repeated until the set stops growing. In
// `dependencyOrder` over the served manifests, so a dependency comes before
// its dependent.
export function deferredPageIds(plugins: readonly ServedPlugin[]): string[] {
  const deferred = new Set(
    plugins
      .filter((plugin) => plugin.origin !== 'built-in')
      .map((plugin) => plugin.id),
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const { id, manifest } of plugins) {
      const dependsOnDeferred = manifest.dependsOn.page.some((each) =>
        deferred.has(each),
      );
      if (!deferred.has(id) && dependsOnDeferred) {
        deferred.add(id);
        grew = true;
      }
    }
  }
  return orderedIds(plugins).filter((id) => deferred.has(id));
}

// Runs `start(part)`. For an origin that is not `built-in`, it then calls
// `handlerProblems(part.manifest, 'page', started.commands)`, and when the
// list is not empty calls the started part's `dispose` and throws
// `Error('<id>: ' + problems.join(', '))` before it returns, so the caller
// registers no handler of the part. A `dispose` that throws or rejects is
// logged under `plugin-switch` as `disposing "<id>" after its failed handler
// check failed: <error>`, and the check's error is still thrown. A built-in
// skips the check: `definePlugin` already makes it at compile time.
export function startCheckedPart<
  S extends { commands: object; dispose?(): void | Promise<void> },
>(
  part: PagePart,
  origin: PluginOrigin,
  start: (part: PagePart) => S,
  log: Log,
): S {
  const started = start(part);
  if (origin !== 'built-in') {
    const problems = handlerProblems(part.manifest, 'page', started.commands);
    if (problems.length > 0) {
      disposeLogged(started, part.manifest.id, log);
      throw new Error(`${part.manifest.id}: ${problems.join(', ')}`);
    }
  }
  return started;
}

function disposeLogged(
  started: { dispose?(): void | Promise<void> },
  id: string,
  log: Log,
) {
  const logFailure = (error: unknown) =>
    log(
      'plugin-switch',
      `disposing "${id}" after its failed handler check failed: ${errorText(error)}`,
    );
  try {
    Promise.resolve(started.dispose?.()).catch(logFailure);
  } catch (error) {
    logFailure(error);
  }
}

function builtInPart(
  pluginId: string,
  builtIns: readonly PagePart[],
): PagePart | undefined {
  return builtIns.find((part) => part.manifest.id === pluginId);
}

function orderedIds(plugins: readonly ServedPlugin[]): string[] {
  return dependencyOrder(plugins.map((plugin) => plugin.manifest)).map(
    (manifest) => manifest.id,
  );
}
