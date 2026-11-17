import path from 'node:path';
import type {
  DriveHost,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { createAgentFormChannelPresenter } from '../../../shared/agent-forms/channel-presenter';
import {
  createChatFormWake,
  NO_FORM_WAKE,
} from '../../../shared/agent-forms/chat-wake';
import { addAgentFormDriveActions } from '../../../shared/agent-forms/drive-actions';
import { createAgentFormService } from '../../../shared/agent-forms/form-service';
import { createFolderFormStore } from '../../../shared/agent-forms/form-store';
import { createMemoryFormStore } from '../../../shared/agent-forms/memory-form-store';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import { chatMainKey } from '../../chat/contract';
import {
  DRIVE_SESSION_DEFAULTS,
  type SessionsMainEvents,
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import type { PrimerChannel } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { primerManifest } from '../manifest';
import { SAMPLE_PRIMER_ARGS } from './fixtures';
import { createPrimerPreview } from './preview/primer-preview';
import { primerType } from './primer-type';
import { primerSelfTestScript } from './selftest-script';
import { PRIMER_TOOLS } from './tool-definitions';

type PrimerApi = MainApi<
  typeof primerManifest,
  PrimerChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// Opens primers in a drive run's sessions and reads their answers:
// `primer.openPrimer` and `primer.answers`, as `addAgentFormDriveActions` runs
// them.
export function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect'>,
  onSessionEnded: (listener: (rowId: string) => void) => void,
): void {
  addAgentFormDriveActions({
    host,
    sessions,
    sessionDefaults: DRIVE_SESSION_DEFAULTS,
    onSessionEnded,
    words: {
      pluginId: 'primer',
      openAction: 'openPrimer',
      formArg: 'primer',
      defaultForm: SAMPLE_PRIMER_ARGS,
      openTool: primerType.openTool,
      openDescription:
        'Opens a primer in the session sessionId names without waiting for its answers: the live one primer opened before under that id, else the owned session holding it (one sessions.open opened), else a new one; the default primer is the four-entry sample.',
      answersDescription:
        "The latest primer's tool result once submit or cancel resolved it, else { pending: true }.",
    },
  });
}

// Serves open_primer and collect_last_primer to every agent session, saves
// each primer in the primer folder and shows it on the page, wakes a primer's
// chat session when the primer finishes with no call waiting, registers the
// primer layouts, and opens the layout preview on the page's ask over a
// service of its own whose store is in memory and whose primers go through the
// presenter's quiet view; refuses a switch-off while an agent's primer is
// open; in the self-test it hands the driver its script, and
// in a drive run it adds the drive actions.
export const primerMainPart: MainPart<typeof primerManifest> = {
  manifest: primerManifest,
  start(api: PrimerApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsMainKey);
    const chat = api.dependency(chatMainKey);
    const store = createFolderFormStore({
      dir: path.join(services.homeDir, '.agents', 'wigley-primer', 'primers'),
      clock: services.clock,
      randomHex: services.randomHex,
      paths: services.paths,
      log: services.log,
    });
    store.prune();
    const presenter = createAgentFormChannelPresenter({
      channel: api.channel,
      alerts: services.alerts,
      source: 'primer',
      noun: primerType.noun,
      markText: (label) => `Primer from ${label}`,
      markAction: 'answer',
      log: services.log,
      sessions,
    });
    const defaultDeadlineSeconds = () => api.settings().deadlineSeconds;
    const primer = createAgentFormService({
      type: primerType,
      presenter,
      store,
      wake: createChatFormWake(chat, services.log),
      defaultDeadlineSeconds,
      timers: services.timers,
    });
    const previewService = createAgentFormService({
      type: primerType,
      presenter: presenter.quiet,
      store: createMemoryFormStore(
        services.clock,
        services.randomHex,
        services.paths,
      ),
      wake: NO_FORM_WAKE,
      defaultDeadlineSeconds,
      timers: services.timers,
    });
    const preview = createPrimerPreview({
      sessions,
      primer: previewService,
      log: services.log,
    });
    api.channel.handle('openPreview', () => preview.open());
    api.layouts.register({ layoutTypes });
    sessions.contributeTools(PRIMER_TOOLS, (session) =>
      createAgentFormToolSession(primer.startSession(session), primerType),
    );
    services.selfTest?.run(primerSelfTestScript(sessions));
    if (api.drive !== null) {
      addDriveActions(api.drive, sessions, (listener) =>
        api.events.on('sessions.ended', ({ sessionId }) => listener(sessionId)),
      );
    }
    return {
      commands: {},
      mayStop: () => presenter.mayStop(),
      dispose: (stop) => {
        if (stop === 'quit') {
          primer.detach();
        }
        preview.dispose();
      },
    };
  },
};
