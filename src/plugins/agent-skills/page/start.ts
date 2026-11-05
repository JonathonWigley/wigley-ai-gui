import type {
  ChannelShape,
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { agentsPageKey } from '../../agents/contract';
import { chatPageKey } from '../../chat/contract';
import { keysPageKey } from '../../keys/contract';
import type { SessionsPageEvents } from '../../sessions/contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { agentSkillsManifest } from '../manifest';
import { readAgentSkillsLayout } from './layout/read-agent-skills-layout';
import { createSkillList } from './skill-list';

type AgentSkillsApi = PageApi<
  typeof agentSkillsManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
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
    const keys = api.dependency(keysPageKey);
    // Each session's name in the log, its side-bar label (`gamma 2`).
    const names = new Map<string, string>();
    const list = createSkillList({
      kit: {
        markdown: services.markdown,
        keys: { anchor: keys.anchor, keysFor: keys.keysFor },
        commands: {
          exists: (id) => api.keys.command(id) !== undefined,
          run: (id) => api.commands.run(id),
        },
        platform: api.platform.os,
      },
      log: services.log,
      nameOf: (sessionId) => names.get(sessionId) ?? sessionId,
      roster: (sessionId) => agents.roster(sessionId),
    });
    chat.addSidePart(list.part);

    api.events.on('sessions.sessionAdded', ({ sessionId, label }) => {
      names.set(sessionId, label);
    });
    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      names.delete(sessionId);
      list.forget(sessionId);
    });
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
