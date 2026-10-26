import path from 'node:path';
import type {
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { createAgentFormChannelPresenter } from '../../../shared/agent-forms/channel-presenter';
import { createAgentFormService } from '../../../shared/agent-forms/form-service';
import { createFolderFormStore } from '../../../shared/agent-forms/form-store';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import type {
  SessionsMainEvents,
  SessionsMainExports,
} from '../../sessions/contract';
import { PRIMER_ERROR_NAME, type PrimerChannel } from '../contract';
import { primerManifest } from '../manifest';
import { primerType } from './primer-type';
import { PRIMER_TOOLS } from './tool-definitions';

type PrimerApi = MainApi<
  typeof primerManifest,
  PrimerChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Serves open_primer and collect_last_primer to every agent session, saves
// each primer in the primer folder and shows it on the page.
export const primerMainPart: MainPart<typeof primerManifest> = {
  manifest: primerManifest,
  start(api: PrimerApi) {
    const { services } = api;
    const sessions = api.dependency<SessionsMainExports>('sessions');
    const store = createFolderFormStore({
      dir: path.join(services.homeDir, '.agents', 'wigley-primer', 'primers'),
      clock: services.clock,
      randomHex: services.randomHex,
      paths: services.paths,
      log: services.log,
      logSource: 'primer',
    });
    store.prune();
    const presenter = createAgentFormChannelPresenter({
      channel: api.channel,
      alerts: services.alerts,
      source: 'primer',
      announceTitle: 'Feature primer ready',
      window: services.window,
      log: services.log,
      sessions,
    });
    const primer = createAgentFormService({
      type: primerType,
      presenter,
      store,
      defaultDeadlineSeconds: () => api.settings().deadlineSeconds,
    });
    sessions.contributeTools(PRIMER_TOOLS, (session) =>
      createAgentFormToolSession(
        primer.startSession(session),
        { open: 'open_primer', collect: 'collect_last_primer' },
        PRIMER_ERROR_NAME,
      ),
    );
    return { commands: {}, dispose: () => {} };
  },
};
