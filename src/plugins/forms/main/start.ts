import path from 'node:path';
import type { Disposable } from '../../../contracts/disposable';
import type {
  DriveHost,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import { createAgentFormChannelPresenter } from '../../../shared/agent-forms/channel-presenter';
import { addAgentFormDriveActions } from '../../../shared/agent-forms/drive-actions';
import { createAgentFormService } from '../../../shared/agent-forms/form-service';
import { createFolderFormStore } from '../../../shared/agent-forms/form-store';
import { createMemoryFormStore } from '../../../shared/agent-forms/memory-form-store';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import { errorText } from '../../../shared/error-text';
import {
  type LayoutRegistry,
  startLayoutRegistry,
} from '../../../shared/layouts/layout-registry';
import {
  DRIVE_SESSION_DEFAULTS,
  type Harness,
  type SessionsMainEvents,
  type SessionsMainExports,
} from '../../sessions/contract';
import type { FormsChannel, FormsService } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { formsManifest } from '../manifest';
import { createLayoutPreview } from './preview/layout-preview';
import { PREVIEW_ROUND_ARGS } from './preview/preview-round';
import { roundType, withKnownLayouts } from './round-type';
import { formsSelfTestScript, SELFTEST_LAYOUTS } from './selftest-script';
import { FORMS_TOOLS } from './tool-definitions';

type FormsApi = MainApi<
  typeof formsManifest,
  FormsChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// How many saved rounds the preview cycles through.
const PREVIEW_SAVED_ROUNDS = 20;

// The agents' FormsService over the saved-round folder, and the layout
// preview over a FormsService of its own whose store is in memory. Both share
// one presenter, which owns the channel's `finish` and `draft` handlers; the
// preview's rounds go through its quiet view. Both services and the preview
// read `layoutNames` for the layouts a round may name.
function createForms(
  api: FormsApi,
  sessions: SessionsMainExports,
  layoutNames: () => readonly string[],
): { forms: FormsService; preview: { open(): void } } {
  const { services } = api;
  const store = createFolderFormStore({
    dir: path.join(services.homeDir, '.agents', 'wigley-forms', 'rounds'),
    clock: services.clock,
    randomHex: services.randomHex,
    paths: services.paths,
    log: services.log,
    logSource: 'forms',
  });
  store.prune();
  const presenter = createAgentFormChannelPresenter({
    channel: api.channel,
    alerts: services.alerts,
    source: 'forms',
    announceTitle: 'New review round',
    window: services.window,
    log: services.log,
    sessions,
  });
  const defaultDeadlineSeconds = () => api.settings().deadlineSeconds;
  const forms = withKnownLayouts(
    createAgentFormService({
      type: roundType,
      presenter,
      store,
      defaultDeadlineSeconds,
    }),
    layoutNames,
  );
  const preview = createLayoutPreview({
    sessions,
    forms: withKnownLayouts(
      createAgentFormService({
        type: roundType,
        presenter: presenter.quiet,
        store: createMemoryFormStore(
          services.clock,
          services.randomHex,
          services.paths,
        ),
        defaultDeadlineSeconds,
      }),
      layoutNames,
    ),
    savedArgs: () => store.recentArgs(PREVIEW_SAVED_ROUNDS),
    layoutNames,
    log: services.log,
  });
  return { forms, preview };
}

// Starts the layout registry once `written` settles and serves it to the
// page; a handler called before the registry is ready answers once it is, and
// every handler rejects with the start's error when it failed.
function serveLayouts(
  api: FormsApi,
  written: Promise<void>,
): Promise<LayoutRegistry> {
  const { log } = api.services;
  const layouts = written.then(() =>
    startLayoutRegistry({
      data: api.data,
      send: (set) => api.channel.send('layoutChanged', set),
      log,
      logSource: 'forms',
      layoutTypes,
    }),
  );
  layouts.catch((error: unknown) =>
    log('forms', `layouts not started: ${errorText(error)}`),
  );
  api.channel.handle('layout', async () => (await layouts).current());
  return layouts;
}

// Opens rounds in a drive run's sessions and reads their answers:
// `forms.openRound` and `forms.answers`, as `addAgentFormDriveActions` runs
// them.
export function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect'>,
  onSessionEnded: (listener: (rowId: string) => void) => void,
): Disposable {
  return addAgentFormDriveActions<Harness>({
    host,
    sessions,
    sessionDefaults: DRIVE_SESSION_DEFAULTS,
    onSessionEnded,
    words: {
      pluginId: 'forms',
      openAction: 'openRound',
      formArg: 'round',
      defaultForm: PREVIEW_ROUND_ARGS,
      openTool: roundType.openTool,
      openDescription:
        'Asks a round in the session sessionId names without waiting for its answers: the live one forms opened before under that id, else the owned session holding it (one sessions.open opened), else a new one; the default round shows every card kind.',
      answersDescription:
        "The latest round's tool result once submit or cancel resolved it, else { pending: true }.",
    },
  });
}

// Serves its two tools to every agent session, shows each session's rounds on
// the page, serves the page its layouts and opens the layout preview on the
// page's ask; in the self-test it writes the fixture layouts and hands the
// driver its script, and in a drive run it adds the drive actions.
export const formsMainPart: MainPart<typeof formsManifest> = {
  manifest: formsManifest,
  start(api: FormsApi) {
    const sessions = api.dependency<SessionsMainExports>('sessions');
    // Set once the registry starts; until then, or when it failed to start,
    // only `default` is known, which is all the page can draw then.
    let registry: LayoutRegistry | null = null;
    const layoutNames = () => registry?.names() ?? ['default'];
    const { forms, preview } = createForms(api, sessions, layoutNames);
    api.channel.handle('openPreview', () => preview.open());
    sessions.contributeTools(FORMS_TOOLS, (session) =>
      createAgentFormToolSession(forms.startSession(session), roundType),
    );
    const { selfTest } = api.services;
    // Written before the registry starts, so the registry lists every
    // self-test layout.
    const fixtureWritten =
      api.services.runMode === 'selfTest'
        ? Promise.all(
            SELFTEST_LAYOUTS.map((layout) =>
              api.data.write(layout.path, layout.text),
            ),
          ).then(() => undefined)
        : Promise.resolve();
    const layouts = serveLayouts(api, fixtureWritten);
    layouts.then(
      (started) => {
        registry = started;
      },
      () => undefined,
    );
    selfTest?.run(formsSelfTestScript(sessions, api.services.userConfig));
    const driveActions =
      api.drive !== null
        ? addDriveActions(api.drive, sessions, (listener) =>
            api.events.on('sessions.ended', ({ sessionId }) =>
              listener(sessionId),
            ),
          )
        : null;
    return {
      commands: {},
      dispose: () => {
        driveActions?.dispose();
        return layouts.then(
          (registry) => registry.dispose(),
          () => undefined,
        );
      },
    };
  },
};
