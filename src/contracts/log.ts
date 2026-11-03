// `source` names the feature or process that logged the line, shown as `[source]`.
export type Log = (source: string, message: string) => void;

// A plugin's log, scoped to its id: one argument logs under the plugin's id.
export interface PluginLog {
  (message: string): void;
  /** @deprecated removed by plan task 11 */
  (source: string, message: string): void;
}
