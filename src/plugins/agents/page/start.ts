import './agents.css';
import type {
  PageApi,
  PagePart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import type { KeysPageExports } from '../../keys/contract';
import type {
  SessionsPageEvents,
  SessionsPageExports,
} from '../../sessions/contract';
import type { AgentsChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { agentsManifest } from '../manifest';
import { readAgentsLayout } from './layout/read-agents-layout';
import { createSubagentLines } from './subagent-lines';

type AgentsApi = PageApi<
  typeof agentsManifest,
  AgentsChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsPageEvents>
>;

// Draws each session's running subagents under its row, one line each,
// through sessions' row parts and the `agents.layout` layout. Hears main's
// `rosterChanged`, filled in by one `rosters` read, and names each session by
// its project folder for the page log. `openPreview` asks main for the layout
// preview's sample session.
export const agentsPagePart: PagePart<typeof agentsManifest> = {
  manifest: agentsManifest,
  start(api: AgentsApi) {
    const { services } = api;
    const log = (line: string) => services.log('agents', line);
    const sessions = api.dependency<SessionsPageExports>('sessions');
    const keys = api.dependency<KeysPageExports>('keys');
    // Each session's name, its project folder's or its id.
    const names = new Map<string, string>();
    const lines = createSubagentLines({
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
    });
    sessions.addRowPart(lines.part);

    api.events.on('sessions.sessionAdded', ({ sessionId, projectDir }) => {
      names.set(
        sessionId,
        projectDir === null ? sessionId : services.paths.base(projectDir),
      );
    });
    api.events.on('sessions.sessionRemoved', ({ sessionId }) => {
      names.delete(sessionId);
      lines.forget(sessionId);
    });

    // A rosters read is stale for each session a rosterChanged touched since
    // the read began.
    const changedSinceRead = new Set<string>();
    api.channel.on('rosterChanged', ({ sessionId, running }) => {
      changedSinceRead.add(sessionId);
      lines.setRunning(sessionId, running);
    });
    api.channel.invoke('rosters').then(
      (rosters) => {
        for (const [sessionId, running] of Object.entries(rosters)) {
          if (!changedSinceRead.has(sessionId)) {
            lines.setRunning(sessionId, running);
          }
        }
      },
      (error: unknown) => log(`rosters not read: ${errorText(error)}`),
    );

    api.layouts.show<Layout>({
      defaultLayout,
      read: readAgentsLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => lines.setLayouts(shown),
    });

    return {
      commands: {
        openPreview: () =>
          void api.channel.invoke('openPreview').catch((error: unknown) => {
            log(`agents preview not opened: ${errorText(error)}`);
            services.toast(
              `Agents preview not opened: ${errorText(error)}`,
              'error',
            );
          }),
      },
    };
  },
};
