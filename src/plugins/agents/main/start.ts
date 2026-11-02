import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import type { ChatMainEvents, ChatMainExports } from '../../chat/contract';
import type {
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import type { AgentsChannel, RunningAgent } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { agentsManifest } from '../manifest';
import { foldAgentEvent } from '../roster';
import { createAgentLog } from './agent-log';
import { createAgentsPreview } from './preview';
import { agentsSelfTestScript } from './selftest-script';

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
// roster is dropped when its row closes or ends. Registers the agents layouts,
// and holds the layout preview, whose roster `rosters` lists beside the live
// ones, and hands the self-test its script.
export const agentsMainPart: MainPart<typeof agentsManifest> = {
  manifest: agentsManifest,
  start(api: AgentsApi) {
    const layouts = api.layouts.register({ layoutTypes });
    const sessions = api.dependency<SessionsMainExports>('sessions');
    const preview = createAgentsPreview({
      sessions,
      clock: api.services.clock,
      send: (message, data) => api.channel.send(message, data),
      log: api.services.log,
    });
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
    api.events.on('sessions.closed', (closed) => {
      dropRoster(closed);
      preview.closed(closed.sessionId);
    });
    api.events.on('sessions.ended', dropRoster);

    api.channel.handle('rosters', () => ({
      ...Object.fromEntries(
        [...rosters].map(([sessionId, running]) => [sessionId, [...running]]),
      ),
      ...preview.rosters(),
    }));
    api.channel.handle('openPreview', () => preview.toggle());

    api.services.selfTest?.run(
      agentsSelfTestScript({
        homeDir: api.services.homeDir,
        files: api.services.files,
        paths: api.services.paths,
        chat: api.dependency<ChatMainExports>('chat'),
        sessions,
      }),
    );

    return { commands: {}, dispose: () => layouts.dispose() };
  },
};
