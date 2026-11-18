import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type {
  ChannelShape,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { type ChatMainEvents, chatMainKey } from '../../chat/contract';
import {
  type SessionsMainEvents,
  sessionsMainKey,
} from '../../sessions/contract';
import { contextBreakdownsSlot } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { contextSourcesManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { contextSourcesSelfTestScript } from './selftest-script';

type ContextSourcesApi = MainApi<
  typeof contextSourcesManifest,
  ChannelShape,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents> &
    QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Registers context-sources' layouts, writes each session's last main-agent `contextBreakdown` from `chat.agentEvent`
// to `context-sources.breakdowns`, deletes it on `sessions.ended`, registers the Context demo step's main half, and
// hands the self-test its script.
export const contextSourcesMainPart: MainPart<typeof contextSourcesManifest> = {
  manifest: contextSourcesManifest,
  start(api: ContextSourcesApi) {
    api.layouts.register({ layoutTypes });
    const breakdowns = api.state.publish(contextBreakdownsSlot);
    api.events.on('chat.agentEvent', ({ sessionId, event }) => {
      const isMainBreakdown =
        event.type === 'contextBreakdown' && event.agentId === MAIN_AGENT_ID;
      if (isMainBreakdown) {
        breakdowns.set(sessionId, event);
      }
    });
    api.events.on('sessions.ended', ({ sessionId }) =>
      breakdowns.delete(sessionId),
    );
    const { services } = api;
    registerDemoSteps(services);
    services.selfTest?.run(
      contextSourcesSelfTestScript({
        homeDir: services.homeDir,
        files: services.files,
        paths: services.paths,
        chat: api.dependency(chatMainKey),
        sessions: api.dependency(sessionsMainKey),
      }),
    );
    return { commands: {} };
  },
};
