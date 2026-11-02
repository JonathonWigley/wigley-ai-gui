import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import type { ChatMainEvents } from '../../chat/contract';
import type { SessionsMainEvents } from '../../sessions/contract';
import type { AgentsChannel, RunningAgent } from '../contract';
import { agentsManifest } from '../manifest';
import { foldAgentEvent } from '../roster';
import { createAgentLog } from './agent-log';

type AgentsApi = MainApi<
  typeof agentsManifest,
  AgentsChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

const NONE: readonly RunningAgent[] = [];

// Hears chat's agent events: logs each in plugin data and folds it into its
// session's roster, sending the page each roster that changed. A session's
// roster is dropped when its row closes or ends.
export const agentsMainPart: MainPart<typeof agentsManifest> = {
  manifest: agentsManifest,
  start(api: AgentsApi) {
    const agentLog = createAgentLog({
      files: api.data,
      log: api.services.log,
    });
    const rosters = new Map<string, readonly RunningAgent[]>();

    api.events.on('chat.agentEvent', ({ sessionId, hostSessionId, event }) => {
      void agentLog.append(hostSessionId, event);
      const before = rosters.get(sessionId) ?? NONE;
      const after = foldAgentEvent(before, event);
      if (after === before) {
        return;
      }
      if (after.length === 0) {
        rosters.delete(sessionId);
      } else {
        rosters.set(sessionId, after);
      }
      api.channel.send('rosterChanged', { sessionId, running: [...after] });
    });

    const dropRoster = ({ sessionId }: { sessionId: string }) => {
      if (rosters.delete(sessionId)) {
        api.channel.send('rosterChanged', { sessionId, running: [] });
      }
    };
    api.events.on('sessions.closed', dropRoster);
    api.events.on('sessions.ended', dropRoster);

    api.channel.handle('rosters', () =>
      Object.fromEntries(
        [...rosters].map(([sessionId, running]) => [sessionId, [...running]]),
      ),
    );

    return { commands: {} };
  },
};
