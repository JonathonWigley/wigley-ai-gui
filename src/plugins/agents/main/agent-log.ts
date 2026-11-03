import type { AgentEvent } from '../../../contracts/agent';
import type { Files } from '../../../contracts/files';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';

// Each host session's agent events, one JSON line per event in
// `logs/<hostSessionId>.jsonl`. Appends to one file run in call order, each
// after the last settles; the returned promise never rejects, a failed append
// logged and the next one still run. A file's tail is dropped once its last
// append settles.
export interface AgentLog {
  append(hostSessionId: string, event: AgentEvent): Promise<void>;
}

export function createAgentLog(deps: {
  files: Pick<Files, 'append'>;
  log: PluginLog;
}): AgentLog {
  const tails = new Map<string, Promise<void>>();
  return {
    append(hostSessionId, event) {
      const path = `logs/${hostSessionId}.jsonl`;
      const line = JSON.stringify(event) + '\n';
      const tail: Promise<void> = (tails.get(path) ?? Promise.resolve())
        .then(() => deps.files.append(path, line))
        .catch((error: unknown) => {
          deps.log(`event not logged to ${path}: ${errorText(error)}`);
        })
        .then(() => {
          if (tails.get(path) === tail) {
            tails.delete(path);
          }
        });
      tails.set(path, tail);
      return tail;
    },
  };
}
