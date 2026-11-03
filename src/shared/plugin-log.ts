import type { Log, PluginLog } from '../contracts/log';

// One plugin's view of the core `log`: one argument logs under `pluginId`, and
// two log under the given source.
export function pluginLog(log: Log, pluginId: string): PluginLog {
  return (first: string, second?: string) => {
    if (second === undefined) {
      log(pluginId, first);
    } else {
      log(first, second);
    }
  };
}
