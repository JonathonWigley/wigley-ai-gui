import type { AgentFormPresenter } from '../../../contracts/agent-forms';
import type { Disposable } from '../../../contracts/disposable';
import type {
  DriveHost,
  MainApi,
  MainPart,
  QualifiedEvents,
} from '../../../contracts/plugin';
import {
  type AgentFormChannelPresenter,
  createAgentFormChannelPresenter,
} from '../../../shared/agent-forms/channel-presenter';
import {
  createChatFormWake,
  NO_FORM_WAKE,
} from '../../../shared/agent-forms/chat-wake';
import { addAgentFormDriveActions } from '../../../shared/agent-forms/drive-actions';
import {
  afterLoad,
  createAgentFormService,
} from '../../../shared/agent-forms/form-service';
import { createFolderFormStore } from '../../../shared/agent-forms/form-store';
import { createMemoryFormStore } from '../../../shared/agent-forms/memory-form-store';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import { errorText } from '../../../shared/error-text';
import { chatMainKey, type ChatMainExports } from '../../chat/contract';
import {
  DRIVE_SESSION_DEFAULTS,
  type Harness,
  type SessionsMainEvents,
  type SessionsMainExports,
  sessionsMainKey,
} from '../../sessions/contract';
import {
  type FormBody,
  type FormsChannel,
  type FormsService,
  type Round,
  SAVED_ROUNDS_FOLDER,
} from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { formsManifest } from '../manifest';
import { createLayoutPreview } from './preview/layout-preview';
import { PREVIEW_ROUND_ARGS } from './preview/preview-round';
import { autoAnsweredPayload, recommendedBody } from './round';
import { roundType, withKnownLayouts } from './round-type';
import {
  FORMS_LAYOUTS_FOLDER,
  formsSelfTestScript,
  SELFTEST_LAYOUTS,
} from './selftest-script';
import { ASK_ROUND_OFFLINE, FORMS_TOOLS } from './tool-definitions';

type FormsApi = MainApi<
  typeof formsManifest,
  FormsChannel,
  Record<never, never>,
  QualifiedEvents<'sessions', SessionsMainEvents>
>;

// How many saved rounds the preview cycles through.
const PREVIEW_SAVED_ROUNDS = 20;

// The agents' FormsService over the saved-round folder, its calls waiting for
// the folder's first read, and the layout preview over a FormsService of its
// own whose store is in memory, with the presenter they share, which owns the
// channel's `finish` and `draft` handlers; the preview's rounds go through its
// quiet view. The agents' service wakes the round's chat session when a round
// finishes with no call waiting, and answers a headless chat session's rounds
// with their recommendations; the preview's wakes nothing and answers none.
// Both services and the preview read `layoutNames` for the layouts a round may
// name. `flushed` settles once every saved-round write queued before it has.
// `shown` settles once the agents' service shows a round of the session, by
// its app id, after the call, until `signal` aborts.
function createForms(
  api: FormsApi,
  sessions: SessionsMainExports,
  chat: ChatMainExports,
  layoutNames: () => readonly string[],
): {
  forms: FormsService;
  preview: { open(): void } & Disposable;
  presenter: AgentFormChannelPresenter<Round, FormBody>;
  flushed(): Promise<void>;
  shown(sessionId: string, signal: AbortSignal): Promise<void>;
} {
  const { services } = api;
  const store = createFolderFormStore({
    files: services.files,
    dir: services.paths.join(services.homeDir, SAVED_ROUNDS_FOLDER),
    clock: services.clock,
    randomHex: services.randomHex,
    paths: services.paths,
    log: services.log,
  });
  const loaded = store.load();
  const presenter = createAgentFormChannelPresenter({
    channel: api.channel,
    alerts: services.alerts,
    source: 'forms',
    alertNoun: { singular: 'open agent form', plural: 'open agent forms' },
    noun: roundType.noun,
    markText: (label) => `Round from ${label}`,
    markAction: 'answer',
    log: services.log,
    sessions,
  });
  const defaultDeadlineSeconds = () => api.settings().deadlineSeconds;
  const agentsShows = withShownWaits(presenter);
  const agentsService = createAgentFormService({
    type: roundType,
    presenter: agentsShows.presenter,
    store,
    wake: createChatFormWake(chat, services.log),
    defaultDeadlineSeconds,
    timers: services.timers,
    autoAnswer: {
      isOn: (sessionId) => chat.isHeadless(sessionId),
      body: recommendedBody,
      payload: autoAnsweredPayload,
    },
  });
  const previewService = createAgentFormService({
    type: roundType,
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
  const preview = createLayoutPreview({
    sessions,
    forms: withKnownLayouts(previewService, layoutNames),
    savedArgs: () => store.recentArgs(PREVIEW_SAVED_ROUNDS),
    layoutNames,
    log: services.log,
  });
  return {
    forms: withKnownLayouts(afterLoad(loaded, agentsService), layoutNames),
    preview,
    presenter,
    flushed: () => store.flushed(),
    shown: agentsShows.shown,
  };
}

// `presenter` with `shown`, which settles once `presenter` shows a form of the
// session, by its app id, after the call. Aborting `signal` drops the wait: it
// never settles and leaves nothing held.
export function withShownWaits<Form, Body>(
  presenter: AgentFormPresenter<Form, Body>,
): {
  presenter: AgentFormPresenter<Form, Body>;
  shown(sessionId: string, signal: AbortSignal): Promise<void>;
} {
  const waiters = new Map<string, (() => void)[]>();
  return {
    presenter: {
      show: (form, listener) => {
        presenter.show(form, listener);
        for (const resolve of waiters.get(form.sessionId) ?? []) {
          resolve();
        }
        waiters.delete(form.sessionId);
      },
      close: (formId) => presenter.close(formId),
    },
    shown: (sessionId, signal) =>
      new Promise((resolve) => {
        waiters.set(sessionId, [...(waiters.get(sessionId) ?? []), resolve]);
        signal.addEventListener(
          'abort',
          () => {
            const rest = (waiters.get(sessionId) ?? []).filter(
              (waiter) => waiter !== resolve,
            );
            if (rest.length === 0) {
              waiters.delete(sessionId);
            } else {
              waiters.set(sessionId, rest);
            }
          },
          { once: true },
        );
      }),
  };
}

// Registers the layouts through `register` once `written` settles, and
// logs a write or register that throws. Disposing before then registers
// nothing; `dispose` settles once a registration made is disposed.
export function registerLayoutsAfter(
  written: Promise<void>,
  register: () => Disposable,
  log: (message: string) => void,
): { dispose(): Promise<void> } {
  let isDisposed = false;
  const registration = written.then(() => (isDisposed ? null : register()));
  registration.catch((error: unknown) =>
    log(`layouts not registered: ${errorText(error)}`),
  );
  return {
    dispose() {
      isDisposed = true;
      return registration.then(
        (registered) => registered?.dispose(),
        () => undefined,
      );
    },
  };
}

// Writes the self-test layouts into forms' layouts folder under the home.
async function writeSelfTestLayouts(api: FormsApi): Promise<void> {
  const { files, paths, homeDir } = api.services;
  await Promise.all(
    SELFTEST_LAYOUTS.map((layout) =>
      files.write(
        paths.join(homeDir, FORMS_LAYOUTS_FOLDER, layout.path),
        layout.text,
      ),
    ),
  );
}

// Opens rounds in a drive run's sessions and reads their answers:
// `forms.openRound` and `forms.answers`, as `addAgentFormDriveActions` runs
// them.
export function addDriveActions(
  host: DriveHost,
  sessions: Pick<SessionsMainExports, 'connect'>,
  onSessionEnded: (listener: (rowId: string) => void) => void,
): void {
  addAgentFormDriveActions<Harness>({
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
// the page, wakes a round's chat session when the round finishes with no call
// waiting, registers its layouts and opens the layout preview on the page's
// ask, and refuses a switch-off while an agent's round is open; in the
// self-test it writes the fixture layouts and hands the driver its script, and
// in a drive run it adds the drive actions.
export const formsMainPart: MainPart<typeof formsManifest> = {
  manifest: formsManifest,
  start(api: FormsApi) {
    const sessions = api.dependency(sessionsMainKey);
    const chat = api.dependency(chatMainKey);
    const layoutNames = () => api.layouts.names();
    const { forms, preview, presenter, flushed, shown } = createForms(
      api,
      sessions,
      chat,
      layoutNames,
    );
    api.channel.handle('openPreview', () => preview.open());
    sessions.contributeTools(
      FORMS_TOOLS,
      (session) =>
        createAgentFormToolSession(forms.startSession(session), roundType),
      { offline: { ask_round: ASK_ROUND_OFFLINE } },
    );
    const { selfTest } = api.services;
    // Written before forms registers, so its first set lists every self-test
    // layout.
    const fixtureWritten =
      api.services.runMode === 'selfTest'
        ? writeSelfTestLayouts(api)
        : Promise.resolve();
    const layouts = registerLayoutsAfter(
      fixtureWritten,
      () => api.layouts.register({ layoutTypes }),
      api.services.log,
    );
    selfTest?.run(
      formsSelfTestScript(
        sessions,
        api.services.userConfig,
        api.services.platform.os,
        shown,
      ),
    );
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
          forms.detach();
        }
        preview.dispose();
        return Promise.all([layouts.dispose(), flushed()]).then(
          () => undefined,
        );
      },
    };
  },
};
