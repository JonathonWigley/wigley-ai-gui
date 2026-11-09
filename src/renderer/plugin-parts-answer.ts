import type { PluginPartsReply, PluginPartsRequest } from '../contracts/bridge';
import type { Log } from '../contracts/log';
import { errorText } from '../shared/error-text';
import type { PluginHost } from '../shared/plugin-host';

export interface PluginPartsAnswerDeps {
  // Applies the last pushed config again, so the binds of the parts a start
  // brought up join.
  reapplyPush(): void;
  log: Log;
}

// The page's answer to one of main's plugin parts requests, through the page's
// host. It never rejects: a throw is logged under `plugin-switch`. A `mayStop`
// that throws gives the reason `<id>: mayStop failed: <error>`; a stop that
// throws goes on to the next id, and a start that throws starts no more. The
// reply holds every id that stopped or started.
export async function answerPluginParts(
  host: Pick<PluginHost<unknown>, 'started' | 'start' | 'stop' | 'mayStop'>,
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
          addStopped(
            startedBefore.filter((each) => !host.started.has(each)).reverse(),
          );
        }
      }
      return { stopped };
    }
    case 'start': {
      const before = new Set(host.started.keys());
      try {
        host.start(request.ids);
      } catch (error) {
        fail(error);
      }
      try {
        deps.reapplyPush();
      } catch (error) {
        fail(error);
      }
      return {
        started: [...host.started.keys()].filter((id) => !before.has(id)),
      };
    }
  }
}
