import type { PluginPartsReply, PluginPartsRequest } from '../contracts/bridge';
import type { Log } from '../contracts/log';
import { errorText } from '../shared/error-text';
import type { PluginHost } from '../shared/plugin-host';

export interface PluginPartsAnswerDeps {
  // Applies the last pushed config again, so the binds of the parts a start brought up join.
  reapplyPush(): void;
  log: Log;
}

// The page's answer to one of main's plugin parts requests, through the page's host. It never rejects: a
// throw is logged under `plugin-switch`, and the reply holds what was done before it.
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
    case 'mayStop':
      try {
        return { reason: host.mayStop(request.ids) };
      } catch (error) {
        fail(error);
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
      try {
        for (const id of request.ids) {
          addStopped(await host.stop(id));
        }
      } catch (error) {
        fail(error);
        // A stop that threw still stopped its parts.
        addStopped(startedBefore.filter((id) => !host.started.has(id)));
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
