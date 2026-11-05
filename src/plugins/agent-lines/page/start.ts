import './agent-lines.css';
import type { CoreEvents } from '../../../contracts/core-state';
import type {
  ChannelShape,
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { agentsRostersSlot, EMPTY_ROSTER } from '../../agents/contract';
import {
  followRows,
  sessionsPageKey,
  sessionsRowsSlot,
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
  QualifiedEvents<'core', CoreEvents>
>;

// Draws a working line under each session's row while it runs any subagent
// or task, through sessions' row parts and the `agent-lines.layout` layout.
// Reads `agents.rosters`, redrawing a session's line each time its roster
// changes, and names each session by its side-bar label for the page log.
export const agentLinesPagePart: PagePart<typeof agentLinesManifest> = {
  manifest: agentLinesManifest,
  start(api: AgentLinesApi) {
    const { services } = api;
    const rosters = api.state.read(agentsRostersSlot);
    const sessions = api.dependency(sessionsPageKey);
    const rows = api.state.read(sessionsRowsSlot);
    const lines = createWorkingLines({
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: {
          exists: (id) => api.keys.command(id) !== undefined,
          argShape: (id) => api.keys.command(id)?.arg,
          run: (id) => api.commands.run(id),
        },
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      log: services.log,
      clock: services.clock,
      timers: services.timers,
      nameOf: (sessionId) => rows.get(sessionId)?.label ?? sessionId,
      roster: (sessionId) => rosters.get(sessionId) ?? EMPTY_ROSTER,
    });
    sessions.addRowPart(lines.part);

    followRows(rows, { removed: (sessionId) => lines.forget(sessionId) });
    api.events.on('core.pageReady', () => {
      rosters.on((sessionId, roster) =>
        lines.setRoster(sessionId, roster ?? EMPTY_ROSTER),
      );
      callEach([...rosters.all()], ([sessionId, roster]) =>
        lines.setRoster(sessionId, roster),
      );
    });

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
