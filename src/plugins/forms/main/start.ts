import path from 'node:path';
import type { MainApi, MainPart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  type LayoutRegistry,
  startLayoutRegistry,
} from '../../../shared/layouts/layout-registry';
import type { SessionsMainExports } from '../../sessions/contract';
import type { FormsChannel, FormsService } from '../contract';
import defaultLayout from '../layouts/default/layout.js?raw';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { formsManifest } from '../manifest';
import { createChannelPresenter } from './channel-presenter';
import { createFormsService } from './forms-service';
import { createLayoutPreview } from './preview/layout-preview';
import { createMemoryRoundStore } from './preview/memory-round-store';
import { createRoundStore } from './round-store';
import { formsSelfTestScript, SELFTEST_LAYOUT } from './selftest-script';
import { FORMS_TOOLS } from './tool-definitions';
import { createFormsToolSession } from './tool-session';

type FormsApi = MainApi<typeof formsManifest, FormsChannel>;

// How many saved rounds the preview cycles through.
const PREVIEW_SAVED_ROUNDS = 20;

// The agents' FormsService over the saved-round folder, and the layout
// preview over a FormsService of its own whose store is in memory. Both share
// one presenter, which owns the channel's `finish` and `draft` handlers; the
// preview's rounds go through its quiet view.
function createForms(
  api: FormsApi,
  sessions: SessionsMainExports,
): { forms: FormsService; preview: { open(): void } } {
  const { services } = api;
  const store = createRoundStore({
    roundsDir: path.join(services.homeDir, '.agents', 'wigley-forms', 'rounds'),
    clock: services.clock,
    randomHex: services.randomHex,
    log: services.log,
  });
  store.prune();
  const presenter = createChannelPresenter(
    api.channel,
    services.alerts,
    services.window,
    services.log,
    sessions,
  );
  const defaultDeadlineSeconds = api.settings.deadlineSeconds;
  const forms = createFormsService({
    presenter,
    store,
    defaultDeadlineSeconds,
  });
  const preview = createLayoutPreview({
    sessions,
    forms: createFormsService({
      presenter: presenter.quiet,
      store: createMemoryRoundStore(services.clock, services.randomHex),
      defaultDeadlineSeconds,
    }),
    savedArgs: () => store.recentArgs(PREVIEW_SAVED_ROUNDS),
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
      send: (choice) => api.channel.send('layoutChanged', choice),
      log,
      logSource: 'forms',
      layoutTypes,
      defaultLayout,
    }),
  );
  layouts.catch((error: unknown) =>
    log('forms', `layouts not started: ${errorText(error)}`),
  );
  api.channel.handle('layout', async () => (await layouts).current());
  api.channel.handle('cycleLayout', async (step) =>
    (await layouts).cycle(step),
  );
  api.channel.handle('copyLayout', async () => (await layouts).copy());
  return layouts;
}

// Serves its two tools to every agent session, shows each session's rounds on
// the page, serves the page its layouts and opens the layout preview on the
// page's ask; in the self-test it writes the fixture layout and hands the
// driver its script.
export const formsMainPart: MainPart<typeof formsManifest> = {
  manifest: formsManifest,
  start(api: FormsApi) {
    const sessions = api.dependency<SessionsMainExports>('sessions');
    const { forms, preview } = createForms(api, sessions);
    api.channel.handle('openPreview', () => preview.open());
    sessions.contributeTools(FORMS_TOOLS, (session) =>
      createFormsToolSession(forms.startSession(session)),
    );
    const { selfTest } = api.services;
    // Written before the registry starts, so the registry lists selftest. A
    // late watch report of this write changes nothing: a save in an inactive
    // layout's folder leaves the revision alone.
    const fixtureWritten = selfTest
      ? api.data.write(SELFTEST_LAYOUT.path, SELFTEST_LAYOUT.text)
      : Promise.resolve();
    const layouts = serveLayouts(api, fixtureWritten);
    selfTest?.run(formsSelfTestScript(sessions));
    return {
      commands: {},
      dispose: () =>
        layouts.then(
          (registry) => registry.dispose(),
          () => undefined,
        ),
    };
  },
};
