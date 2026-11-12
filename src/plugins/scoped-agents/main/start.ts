import type { Registrations } from '../../../contracts/disposable';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { type ChatMainEvents, chatMainKey } from '../../chat/contract';
import type { ScopedAgentsChannel, ScopedAgentsMainExports } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { scopedAgentsManifest } from '../manifest';
import { createScopedAgentService } from './scoped-agent-service';

type ScopedAgentsApi = MainApi<
  typeof scopedAgentsManifest,
  ScopedAgentsChannel,
  Record<never, never>,
  QualifiedEvents<'chat', ChatMainEvents>
>;

// Runs one scoped agent service for every registration, hearing chat's
// session events once for all of them, and serves the page's `ask` and
// `sessionOf` by owner and agent id. Each dependent's `addScopedAgent` files
// the registration with that dependent's registrations. Registers the
// scoped-agents layout contract.
export const scopedAgentsMainPart: MainPart<typeof scopedAgentsManifest> = {
  manifest: scopedAgentsManifest,
  start(api: ScopedAgentsApi) {
    const { services, channel } = api;
    api.layouts.register({ layoutTypes });
    const service = createScopedAgentService({
      chat: api.dependency(chatMainKey),
      paths: services.paths,
      timers: services.timers,
      log: services.log,
    });
    api.events.on('chat.sessionOpened', (event) => service.opened(event));
    api.events.on('chat.sessionClosed', (event) => service.closed(event));
    api.events.on('chat.sessionCleared', (event) => service.cleared(event));
    channel.handle('ask', (owner, agentId, scope, text) =>
      service.ask(owner, agentId, scope, text),
    );
    channel.handle('sessionOf', (owner, agentId, scope) =>
      service.sessionOf(owner, agentId, scope),
    );
    const exports = (consumer: Registrations): ScopedAgentsMainExports => ({
      addScopedAgent: (spec) => consumer.track(service.add(spec)),
    });
    return { commands: {}, exports };
  },
};
