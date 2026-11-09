import './agent-strip.css';
import type {
  ChannelShape,
  PageApi,
  PageCommandContext,
  PagePart,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { createHScroller } from '../../../shared/page/ui/h-scroller';
import { agentsRostersSlot, EMPTY_ROSTER } from '../../agents/contract';
import { chatPageKey } from '../../chat/contract';
import {
  followRows,
  sessionsPageKey,
  sessionsRowsSlot,
} from '../../sessions/contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { agentStripToggleBoxAtCommand } from '../contract';
import { agentStripManifest } from '../manifest';
import { createAgentStrip } from './agent-strip';
import { readAgentStripLayout } from './layout/read-agent-strip-layout';
import { kitCommandsOf } from '../../../shared/page/layout-host/base-kit';

type AgentStripApi = PageApi<typeof agentStripManifest, ChannelShape>;

// Draws each Chat tab's agent strip above its composer box through chat's
// composer parts and the `agent-strip.layout` layout, reading `agents.rosters`,
// and runs the strip's keys while its stop holds the entry cursor. Names each
// session by its side-bar label for the page log.
export const agentStripPagePart: PagePart<typeof agentStripManifest> = {
  manifest: agentStripManifest,
  start(api: AgentStripApi) {
    const { services } = api;
    const chat = api.dependency(chatPageKey);
    const rows = api.state.read(sessionsRowsSlot);
    const rosters = api.state.read(agentsRostersSlot);
    const strip = createAgentStrip({
      kit: {
        markdown: services.markdown,
        keys: api.keys,
        commands: kitCommandsOf(api),
        platform: api.platform.os,
        state: api.state.forLayouts,
      },
      log: services.log,
      clock: services.clock,
      timers: services.timers,
      roster: (sessionId) => rosters.get(sessionId) ?? EMPTY_ROSTER,
      cutTitle: api.dependency(sessionsPageKey).cutToTitleLimit,
      setScope: () => api.keys.setScope('strip'),
      nameOf: (sessionId) => rows.get(sessionId)?.label ?? sessionId,
      createScroller: createHScroller,
      run: (arg) => void api.commands.run(agentStripToggleBoxAtCommand, arg),
    });
    chat.addComposerPart(strip.part);

    followRows(rows, { removed: (sessionId) => strip.forget(sessionId) });

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readAgentStripLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => strip.setLayouts(shown),
    });

    return {
      commands: {
        prevBox: () => strip.prevBox(),
        nextBox: () => strip.nextBox(),
        leave: () => strip.leave(),
        focusBox: () => strip.toBox('insert'),
        appendBox: () => strip.toBox('append'),
        toggleBox: () => strip.toggleBox(),
        lineDown: () => strip.scrollToolList('line', 1),
        lineUp: () => strip.scrollToolList('line', -1),
        halfPageDown: () => strip.scrollToolList('halfPage', 1),
        halfPageUp: () => strip.scrollToolList('halfPage', -1),
        toggleBoxAt: ({
          arg,
        }: PageCommandContext<{ sessionId: string; key: string }>) =>
          strip.toggleBoxAt(arg.sessionId, arg.key),
      },
      ready() {
        rosters.on((sessionId) => strip.rosterUpdated(sessionId));
        callEach([...rosters.all().keys()], (sessionId) =>
          strip.rosterUpdated(sessionId),
        );
      },
    };
  },
};
