// `source` names the feature or process that logged the line, shown as `[source]`.
export type Log = (source: string, message: string) => void;

// A plugin's log, scoped to its id.
export type PluginLog = (message: string) => void;
