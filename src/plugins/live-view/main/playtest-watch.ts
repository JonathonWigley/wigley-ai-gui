import type { ChatEntry } from '../../../contracts/agent';
import type { PluginLog } from '../../../contracts/log';
import type { ListSlotReader } from '../../../contracts/state';
import { CHAT_PREVIEW_HOST_ID, type ChatAgentEvent } from '../../chat/contract';
import { parsePlaytestCommand } from '../playtest-command';
import type { LiveTools } from './live-tools';

type ToolEntry = Extract<ChatEntry, { kind: 'tool' }>;

export interface PlaytestWatchDeps {
  entries: ListSlotReader<ChatEntry>;
  liveTools: Pick<LiveTools, 'playtestStarted' | 'playtestStopped'>;
  log: PluginLog;
}

// Feeds chat's agent events in; the watch hears `chat.entries` itself.
export interface PlaytestWatch {
  agentEvent(event: ChatAgentEvent): void;
  sessionEnded(sessionId: string): void;
}

// A row's Bash calls by `toolUseId`: `live` had a live `toolStarted` and waits
// for its result; `done` acted or was dropped, and never acts again.
interface RowCalls {
  readonly live: Set<string>;
  readonly done: Set<string>;
}

// A Bash call input's `command`, when it holds a string.
function commandOf(input: unknown): string | null {
  const command =
    typeof input === 'object' && input !== null && 'command' in input
      ? input.command
      : null;
  return typeof command === 'string' ? command : null;
}

// Opens and closes a session's Live view on its live Bash calls that succeed:
// a playtest start (`unity command editor_play`, `capture.py start`) or stop
// (`unity command editor_stop`), on the command's `--project-path`. A call is
// live when chat's `toolStarted` for its `toolUseId` came with `replayed`
// false; a restored or replayed entry never acts, and each call acts once.
// Chat's preview row is left out; a subagent's call acts for its lead's row.
export function createPlaytestWatch(deps: PlaytestWatchDeps): PlaytestWatch {
  const { entries, liveTools, log } = deps;
  const rows = new Map<string, RowCalls>();

  const callsOf = (sessionId: string): RowCalls => {
    let calls = rows.get(sessionId);
    if (calls === undefined) {
      calls = { live: new Set(), done: new Set() };
      rows.set(sessionId, calls);
    }
    return calls;
  };

  const act = (sessionId: string, command: string) => {
    const signal = parsePlaytestCommand(command);
    if (signal === null) {
      return;
    }
    if (signal.kind === 'stop') {
      liveTools.playtestStopped(sessionId, signal.projectPath);
      return;
    }
    if (signal.projectPath === null) {
      log(
        `${sessionId} opened no Live view for a playtest: the command names no --project-path`,
      );
      return;
    }
    void liveTools.playtestStarted(sessionId, signal.projectPath);
  };

  const settle = (
    sessionId: string,
    { toolUseId, input, result }: ToolEntry,
  ) => {
    const calls = callsOf(sessionId);
    calls.live.delete(toolUseId);
    calls.done.add(toolUseId);
    const command = commandOf(input);
    const succeeded = result !== null && !result.isError;
    if (succeeded && command !== null) {
      act(sessionId, command);
    }
  };

  entries.on((sessionId, change) => {
    if (change.kind === 'delete') {
      rows.delete(sessionId);
      return;
    }
    if (change.kind !== 'put') {
      return;
    }
    const { item } = change;
    if (item.kind !== 'tool' || item.name !== 'Bash' || item.result === null) {
      return;
    }
    if (rows.get(sessionId)?.live.has(item.toolUseId) === true) {
      settle(sessionId, item);
    }
  });

  return {
    agentEvent({ sessionId, hostSessionId, event, replayed }) {
      if (replayed || hostSessionId === CHAT_PREVIEW_HOST_ID) {
        return;
      }
      if (event.type !== 'toolStarted' || event.tool !== 'Bash') {
        return;
      }
      const calls = callsOf(sessionId);
      if (calls.done.has(event.toolUseId)) {
        return;
      }
      const entry = entries
        .get(sessionId)
        .find(
          (item): item is ToolEntry =>
            item.kind === 'tool' && item.toolUseId === event.toolUseId,
        );
      if (entry !== undefined && entry.result !== null) {
        settle(sessionId, entry);
        return;
      }
      calls.live.add(event.toolUseId);
    },
    sessionEnded(sessionId) {
      rows.delete(sessionId);
    },
  };
}
