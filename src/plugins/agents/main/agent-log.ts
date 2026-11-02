import type { AgentEvent } from '../../../contracts/agent';
import type { Files } from '../../../contracts/files';
import type { Log } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';

// Each host session's agent events, one JSON line per event in
// `logs/<hostSessionId>.jsonl`. Appends to one file run in call order, each
// after the last settles; the returned promise never rejects, a failed append
// logged and the next one still run.
export interface AgentLog {
  append(hostSessionId: string, event: AgentEvent): Promise<void>;
}

export function createAgentLog(deps: {
  files: Pick<Files, 'append'>;
  log: Log;
}): AgentLog {
  const tails = new Map<string, Promise<void>>();
  return {
    append(hostSessionId, event) {
      const path = `logs/${hostSessionId}.jsonl`;
      const line = JSON.stringify(event) + '\n';
      const tail = (tails.get(path) ?? Promise.resolve())
        .then(() => deps.files.append(path, line))
        .catch((error: unknown) => {
          deps.log(
            'agents',
            `event not logged to ${path}: ${errorText(error)}`,
          );
        });
      tails.set(path, tail);
      return tail;
    },
  };
}
