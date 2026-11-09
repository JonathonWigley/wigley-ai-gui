import type { PluginPartsReply, PluginPartsRequest } from '../contracts/bridge';
import type { Log } from '../contracts/log';
import type { PagePart } from '../contracts/plugin';
import type { CatalogProblem, ServedPlugin } from '../contracts/plugin-catalog';
import type { AppConfig } from '../contracts/settings';
import { errorText } from '../shared/error-text';
import type { PluginHost } from '../shared/plugin-host';
import { dependencyOrder } from '../shared/plugin-manifests';
import type { PageRestoresHost } from './page-restores';

export interface PluginPartsAnswerDeps {
  // A start opens a restore window before its parts start, and readies it
  // once each started part ran `ready()`.
  restores: Pick<PageRestoresHost, 'reopen' | 'partsReady'>;
  // Applies the last pushed config again, so the binds of the parts a start
  // brought up join.
  reapplyPush(): void;
  log: Log;
  // The last config main pushed.
  served(): AppConfig;
  // The page part a served plugin runs, null for one with none; rejects when
  // its `page.js` does not load.
  loadPart(plugin: ServedPlugin): Promise<PagePart | null>;
  // The ids of the parts the host holds, in its held order: the composition
  // root seeds it with the parts it handed the host, and the answer adds and
  // deletes the ids it adds and removes.
  held: Set<string>;
}

type PageHost = Pick<
  PluginHost<unknown, PagePart>,
  'started' | 'start' | 'stop' | 'mayStop' | 'add' | 'remove'
>;

// The page's answer to one of main's plugin parts requests, through the page's
// host. It never rejects: a throw is logged under `plugin-switch`. A `mayStop`
// that throws gives the reason `<id>: mayStop failed: <error>`; a stop that
// throws goes on to the next id, and a start that throws starts no more. A
// start first loads and adds each requested id the host does not hold, then
// opens a restore window (`reopen`), starts, and calls `partsReady` after the
// host started its parts, a throw included, then applies the push again; its
// reply's `problems` names a page.js that did not load and the part whose
// start threw. A `reload` swaps the held part for the served one and starts
// nothing; a failed import keeps the old part. A `remove` stops and forgets
// the part. A stop, `mayStop`, `reload` and `remove` touch no window. The
// reply holds every id that stopped, started or was swapped.
export async function answerPluginParts(
  host: PageHost,
  request: PluginPartsRequest,
  deps: PluginPartsAnswerDeps,
): Promise<PluginPartsReply> {
  const fail = (error: unknown) =>
    deps.log(
      'plugin-switch',
      `page ${request.kind} failed: ${errorText(error)}`,
    );
  switch (request.kind) {
    case 'mayStop': {
      // One id per ask, in start order as the host asks, so a throw names its
      // part.
      const named = [...host.started.keys()].filter((id) =>
        request.ids.includes(id),
      );
      for (const id of named) {
        try {
          const reason = host.mayStop([id]);
          if (reason !== null) {
            return { reason };
          }
        } catch (error) {
          fail(error);
          return { reason: `${id}: mayStop failed: ${errorText(error)}` };
        }
      }
      return { reason: null };
    }
    case 'stop': {
      const startedBefore = [...host.started.keys()];
      const stopped: string[] = [];
      const addStopped = (ids: readonly string[]) => {
        for (const id of ids) {
          if (!stopped.includes(id)) {
            stopped.push(id);
          }
        }
      };
      for (const id of request.ids) {
        try {
          addStopped(await host.stop(id));
        } catch (error) {
          fail(error);
          // A stop that threw still stopped its parts, dependents first.
          addStopped(stoppedSince(startedBefore, host));
        }
      }
      return { stopped };
    }
    case 'start': {
      const problems: CatalogProblem[] = [];
      for (const id of request.ids) {
        const problem = await addUnheld(host, id, deps);
        if (problem !== null) {
          deps.log('plugin-switch', `page start failed: ${problem.message}`);
          problems.push(problem);
        }
      }
      const before = new Set(host.started.keys());
      deps.restores.reopen();
      try {
        host.start(request.ids);
      } catch (error) {
        fail(error);
        const threw = firstNotStarted(request.ids, host, deps);
        if (threw !== undefined) {
          problems.push({
            id: threw,
            message: `Page part did not start: ${errorText(error)}`,
          });
        }
      }
      deps.restores.partsReady();
      try {
        deps.reapplyPush();
      } catch (error) {
        fail(error);
      }
      return {
        started: [...host.started.keys()].filter((id) => !before.has(id)),
        problems,
      };
    }
    case 'reload': {
      const { id } = request;
      const entry = servedEntry(id, deps);
      let part: PagePart | null = null;
      if (entry !== undefined) {
        try {
          part = await deps.loadPart(entry);
        } catch (error) {
          // The old part stays held, so the next `start` brings it back.
          const problem = loadFailure(id, error);
          deps.log('plugin-switch', problem);
          return { reloaded: [], problem };
        }
      }
      try {
        await removeHeld(host, id, deps);
        if (part === null) {
          return { reloaded: [], problem: null };
        }
        host.add(part);
        deps.held.add(id);
        return { reloaded: [id], problem: null };
      } catch (error) {
        fail(error);
        return { reloaded: [], problem: errorText(error) };
      }
    }
    case 'remove': {
      const startedBefore = [...host.started.keys()];
      try {
        return { stopped: await removeHeld(host, request.id, deps) };
      } catch (error) {
        fail(error);
        return { stopped: stoppedSince(startedBefore, host) };
      }
    }
  }
}

// The ids of `startedBefore` that left `started`, newest first.
function stoppedSince(startedBefore: readonly string[], host: PageHost) {
  return startedBefore.filter((each) => !host.started.has(each)).reverse();
}

function servedEntry(
  id: string,
  deps: Pick<PluginPartsAnswerDeps, 'served'>,
): ServedPlugin | undefined {
  return deps.served().plugins.find((plugin) => plugin.id === id);
}

function loadFailure(id: string, error: unknown): string {
  return `page.js of ${id} failed to load: ${errorText(error)}`;
}

// `host.remove(id)`, forgetting `id` in `held` also when it rejects; `[]`
// for an id `held` lacks.
async function removeHeld(
  host: PageHost,
  id: string,
  deps: Pick<PluginPartsAnswerDeps, 'held'>,
): Promise<string[]> {
  if (!deps.held.has(id)) {
    return [];
  }
  try {
    return await host.remove(id);
  } finally {
    deps.held.delete(id);
  }
}

// Loads and adds the served part of `id` when the host does not hold it. Null
// when the host holds it, when nothing is served for it or it has no page
// part, or when it was added; else the problem of a load or an add that
// failed.
async function addUnheld(
  host: PageHost,
  id: string,
  deps: PluginPartsAnswerDeps,
): Promise<CatalogProblem | null> {
  const entry = servedEntry(id, deps);
  if (deps.held.has(id) || entry === undefined) {
    return null;
  }
  let part: PagePart | null;
  try {
    part = await deps.loadPart(entry);
  } catch (error) {
    return { id, message: loadFailure(id, error) };
  }
  if (part === null) {
    return null;
  }
  try {
    host.add(part);
  } catch (error) {
    return { id, message: `Page part did not start: ${errorText(error)}` };
  }
  deps.held.add(id);
  return null;
}

// The first of `ids` the host holds and has not started, in the host's start
// order: held order, each part after its dependencies. After a start that
// threw, that is the part that threw, since the host stops at it.
function firstNotStarted(
  ids: readonly string[],
  host: PageHost,
  deps: Pick<PluginPartsAnswerDeps, 'held' | 'served'>,
): string | undefined {
  const manifests = deps.served().plugins.map((plugin) => plugin.manifest);
  const heldManifests = [...deps.held].flatMap((id) =>
    manifests.filter((manifest) => manifest.id === id),
  );
  return dependencyOrder(heldManifests)
    .map((manifest) => manifest.id)
    .find((id) => ids.includes(id) && !host.started.has(id));
}
