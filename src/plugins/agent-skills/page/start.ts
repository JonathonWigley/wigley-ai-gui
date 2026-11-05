import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { agentsPageKey } from '../../agents/contract';
import { chatPageKey } from '../../chat/contract';
import { followRows, sessionsRowsSlot } from '../../sessions/contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { agentSkillsManifest } from '../manifest';
import { readAgentSkillsLayout } from './layout/read-agent-skills-layout';
import { createSkillList } from './skill-list';

type AgentSkillsApi = PageApi<
  typeof agentSkillsManifest,
  ChannelShape,
  Record<never, never>
>;

// Draws the session hub's Skills section through chat's side parts and the
// `agent-skills.layout` layout. Reads the rosters from agents' page exports,
// redrawing a session's list each time its roster changes, and names each
// session by its side-bar label for the page log.
export const agentSkillsPagePart: PagePart<typeof agentSkillsManifest> = {
  manifest: agentSkillsManifest,
  start(api: AgentSkillsApi) {
    const { services } = api;
    const agents = api.dependency(agentsPageKey);
    const chat = api.dependency(chatPageKey);
    const rows = api.state.read(sessionsRowsSlot);
    const list = createSkillList({
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: {
          exists: (id) => api.keys.command(id) !== undefined,
          run: (id) => api.commands.run(id),
        },
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      log: services.log,
      nameOf: (sessionId) => rows.get(sessionId)?.label ?? sessionId,
      roster: (sessionId) => agents.roster(sessionId),
    });
    chat.addSidePart(list.part);

    followRows(rows, { removed: (sessionId) => list.forget(sessionId) });
    agents.onRosterChanged((sessionId) => list.rosterChanged(sessionId));

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readAgentSkillsLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => list.setLayouts(shown),
    });

    return { commands: {} };
  },
};
