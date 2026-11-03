import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { SessionsPageEvents } from '../../sessions/contract';
import type { AgentsChannel, AgentsPageExports } from '../contract';
import { agentsManifest } from '../manifest';
import { createPageRosters } from './rosters';

type AgentsApi = PageApi<
  typeof agentsManifest,
  AgentsChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// Keeps each session's roster and exports it; draws nothing. Hears main's
// `rosterChanged`, filled in by one `rosters` read, which a `rosterChanged`
// landing while it runs wins over for that session, and drops a removed
// session's roster. `openPreview` asks main for agents' sample session.
export const agentsPagePart: PagePart<typeof agentsManifest> = {
  manifest: agentsManifest,
  start(api: AgentsApi) {
    const { services } = api;
    const rosters = createPageRosters({ log: services.log });

    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      rosters.forget(sessionId);
    });
    api.channel.on('rosterChanged', ({ sessionId, roster }) => {
      rosters.set(sessionId, roster);
    });
    api.channel.invoke('rosters').then(
      (read) => {
        rosters.fill(read);
        rosters.settle();
      },
      (error: unknown) => {
        services.log(`rosters not read: ${errorText(error)}`);
        rosters.settle();
      },
    );

    return {
      commands: {
        openPreview: () =>
          void api.channel.invoke('openPreview').catch((error: unknown) => {
            services.log(`agents preview not opened: ${errorText(error)}`);
            services.toast(
              `Agents preview not opened: ${errorText(error)}`,
              'error',
            );
          }),
      },
      exports: (consumer) =>
        ({
          roster: rosters.roster,
          onRosterChanged: (listener) =>
            consumer.track(rosters.onRosterChanged(listener)),
        }) satisfies AgentsPageExports,
    };
  },
};
