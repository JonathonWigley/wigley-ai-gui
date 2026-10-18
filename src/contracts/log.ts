// `source` names the feature or process that logged the line, shown as `[source]`.
export type Log = (source: string, message: string) => void;
