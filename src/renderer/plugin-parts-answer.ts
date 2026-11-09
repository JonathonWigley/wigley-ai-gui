import type { PluginPartsReply, PluginPartsRequest } from '../contracts/bridge';
import type { Log } from '../contracts/log';
import type { PagePart } from '../contracts/plugin';
import type { CatalogProblem, ServedPlugin } from '../contracts/plugin-catalog';
import type { AppConfig } from '../contracts/settings';
import { errorText } from '../shared/error-text';
import type { PluginHost } from '../shared/plugin-host';
import {
  loadFailureText,
  loadPageParts,
  type PagePartAddDeps,
} from './page-part-loader';
import type { PageRestoresHost } from './page-restores';

export interface PluginPartsAnswerDeps extends Pick<
  PagePartAddDeps,
  'loadPart'
> {
  // A start opens a restore window before its parts start, and readies it
  // once each started part ran `ready()`, a start that threw included.
  restores: Pick<PageRestoresHost, 'reopen' | 'partsReady'>;
  // Applies the last pushed config again, so the binds of the parts a start
  // brought up join.
  reapplyPush(): void;
  log: Log;
  // The last config main pushed.
  served(): AppConfig;
}

type PageHost = Pick<
  PluginHost<unknown, PagePart>,
  'started' | 'startEach' | 'holds' | 'stop' | 'mayStop' | 'add' | 'remove'
>;

// The page's answer to one of main's plugin parts requests, through the page's
// host. It never rejects: a throw is logged under `plugin-switch`. A `mayStop`
// that throws gives the reason `<id>: mayStop failed: <error>`; a stop that
// throws goes on to the next id. A start first loads and adds each requested
// id the host does not hold (`loadPageParts`), then opens a restore window
// (`reopen`), starts each id on its own (`startEach`), and calls `partsReady`
// once the host is done, then applies the push again; a part whose start
// throws keeps no other part from starting. Its reply's `problems` holds one
// problem per id that did not start: a page.js that did not load, or the
// start or dependency check that threw for that id. A `reload` swaps the held
// part for the served one and starts nothing; a failed import keeps the old
// part. A `remove` stops and forgets the part. A stop, `mayStop`, `reload` and
// `remove` touch no window. The reply holds every id that stopped, started or
// was swapped.
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
      const entries = request.ids
        .map((id) => servedEntry(id, deps))
        .filter((entry) => entry !== undefined);
      const problems: CatalogProblem[] = await loadPageParts(entries, {
        host,
        loadPart: deps.loadPart,
      });
      for (const problem of problems) {
        deps.log('plugin-switch', `page start failed: ${problem.message}`);
      }
      const before = new Set(host.started.keys());
      deps.restores.reopen();
      try {
        for (const { id, error } of host.startEach(request.ids)) {
          fail(error);
          problems.push({
            id,
            message: `Page part did not start: ${errorText(error)}`,
          });
        }
      } catch (error) {
        fail(error);
      } finally {
        deps.restores.partsReady();
      }
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
          const problem = loadFailureText(id, error);
          deps.log('plugin-switch', problem);
          return { reloaded: [], problem };
        }
      }
      try {
        await host.remove(id);
        if (part === null) {
          return { reloaded: [], problem: null };
        }
        host.add(part);
        return { reloaded: [id], problem: null };
      } catch (error) {
        fail(error);
        return { reloaded: [], problem: errorText(error) };
      }
    }
    case 'remove': {
      const startedBefore = [...host.started.keys()];
      try {
        return { stopped: await host.remove(request.id) };
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
