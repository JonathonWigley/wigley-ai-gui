import type { Log, PluginLog } from '../contracts/log';

// One plugin's view of the core `log`: every line logs under `pluginId`.
export function pluginLog(log: Log, pluginId: string): PluginLog {
  return (message) => log(pluginId, message);
}
