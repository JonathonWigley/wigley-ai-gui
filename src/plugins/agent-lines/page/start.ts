import './agent-lines.css';
import type {
  ChannelShape,
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import type { AgentsPageExports } from '../../agents/contract';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { agentLinesManifest } from '../manifest';
import { readAgentLinesLayout } from './layout/read-agent-lines-layout';
import { createWorkingLines } from './working-lines';

type AgentLinesApi = PageApi<
  typeof agentLinesManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// Draws a working line under each session's row while it runs any subagent
// or task, through sessions' row parts and the `agent-lines.layout` layout.
// Reads the rosters from agents' page exports, redrawing a session's line each
// time its roster changes, and names each session by its side-bar label for
// the page log.
export const agentLinesPagePart: PagePart<typeof agentLinesManifest> = {
  manifest: agentLinesManifest,
  start(api: AgentLinesApi) {
    const { services } = api;
    const agents = api.dependency<AgentsPageExports>('agents');
    const sessions = api.dependency<SessionsPageExports>('sessions');
    const keys = api.dependency<KeysPageExports>('keys');
    // Each session's name in the log, its side-bar label (`gamma 2`).
    const names = new Map<string, string>();
    const lines = createWorkingLines({
      kit: {
        markdown: services.markdown,
        keys: { anchor: keys.anchor, keysFor: keys.keysFor },
        commands: {
          exists: (id) => api.keys.command(id) !== undefined,
          run: (id) => api.commands.run(id),
        },
        platform: api.platform,
      },
      log: services.log,
      clock: services.clock,
      timers: services.timers,
      nameOf: (sessionId) => names.get(sessionId) ?? sessionId,
      roster: (sessionId) => agents.roster(sessionId),
    });
    sessions.addRowPart(lines.part);

    api.events.on('sessions.sessionAdded', ({ sessionId, label }) => {
      names.set(sessionId, label);
    });
    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      names.delete(sessionId);
      lines.forget(sessionId);
    });
    agents.onRosterChanged((sessionId) =>
      lines.setRoster(sessionId, agents.roster(sessionId)),
    );

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readAgentLinesLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => lines.setLayouts(shown),
    });

    return { commands: {} };
  },
};
