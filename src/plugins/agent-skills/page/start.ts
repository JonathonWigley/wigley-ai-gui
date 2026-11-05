import type { CoreEvents } from '../../../contracts/core-state';
import type {
  ChannelShape,
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { agentsRostersSlot, EMPTY_ROSTER } from '../../agents/contract';
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
  Record<never, never>,
  QualifiedEvents<'core', CoreEvents>
>;

// Draws the session hub's Skills section through chat's side parts and the
// `agent-skills.layout` layout. Reads `agents.rosters`, redrawing a session's
// list each time its roster changes, and names each session by its side-bar
// label for the page log.
export const agentSkillsPagePart: PagePart<typeof agentSkillsManifest> = {
  manifest: agentSkillsManifest,
  start(api: AgentSkillsApi) {
    const { services } = api;
    const rosters = api.state.read(agentsRostersSlot);
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
      roster: (sessionId) => rosters.get(sessionId) ?? EMPTY_ROSTER,
    });
    chat.addSidePart(list.part);

    followRows(rows, { removed: (sessionId) => list.forget(sessionId) });
    api.events.on('core.pageReady', () => {
      rosters.on((sessionId) => list.rosterUpdated(sessionId));
      callEach([...rosters.all().keys()], (sessionId) =>
        list.rosterUpdated(sessionId),
      );
    });

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
