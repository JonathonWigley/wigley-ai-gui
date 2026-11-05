import './agent-strip.css';
import type {
  ChannelShape,
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { createHScroller } from '../../../shared/page/ui/h-scroller';
import { agentsPageKey } from '../../agents/contract';
import { chatPageKey } from '../../chat/contract';
import {
  type SessionsPageEvents,
  sessionsPageKey,
} from '../../sessions/contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { Layout } from '../layouts/layout';
import { agentStripManifest } from '../manifest';
import { createAgentStrip } from './agent-strip';
import { readAgentStripLayout } from './layout/read-agent-strip-layout';

type AgentStripApi = PageApi<
  typeof agentStripManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// Draws each Chat tab's agent strip above its composer box through chat's
// composer parts and the `agent-strip.layout` layout, reading the rosters from
// agents' page exports, and runs the strip's keys while its stop holds the
// entry cursor. Names each session by its side-bar label for the page log.
export const agentStripPagePart: PagePart<typeof agentStripManifest> = {
  manifest: agentStripManifest,
  start(api: AgentStripApi) {
    const { services } = api;
    const chat = api.dependency(chatPageKey);
    // Each session's name in the log, its side-bar label (`gamma 2`).
    const names = new Map<string, string>();
    const strip = createAgentStrip({
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
      clock: services.clock,
      timers: services.timers,
      agents: api.dependency(agentsPageKey),
      cutTitle: api.dependency(sessionsPageKey).cutToTitleLimit,
      setScope: () => api.keys.setScope('strip'),
      nameOf: (sessionId) => names.get(sessionId) ?? sessionId,
      createScroller: createHScroller,
    });
    chat.addComposerPart(strip.part);

    api.events.on('sessions.sessionAdded', ({ sessionId, label }) => {
      names.set(sessionId, label);
    });
    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      names.delete(sessionId);
      strip.forget(sessionId);
    });

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
      },
    };
  },
};
