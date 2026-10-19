import path from 'node:path';
import type { MainApi, MainPart } from '../../../contracts/plugin';
import type { SessionsMainExports } from '../../sessions/contract';
import type { FormsChannel, FormsService } from '../contract';
import { formsManifest } from '../manifest';
import { createChannelPresenter } from './channel-presenter';
import { createFormsService } from './forms-service';
import { createRoundStore } from './round-store';
import { formsSelfTestScript } from './selftest-script';
import { FORMS_TOOLS } from './tool-definitions';
import { createFormsToolSession } from './tool-session';

type FormsApi = MainApi<typeof formsManifest, FormsChannel>;

function createForms(
  api: FormsApi,
  sessions: SessionsMainExports,
): FormsService {
  const { services } = api;
  const store = createRoundStore({
    roundsDir: path.join(services.homeDir, '.agents', 'wigley-forms', 'rounds'),
    clock: services.clock,
    randomHex: services.randomHex,
    log: services.log,
  });
  store.prune();
  return createFormsService({
    presenter: createChannelPresenter(
      api.channel,
      services.alerts,
      services.window,
      services.log,
      sessions,
    ),
    store,
    defaultDeadlineSeconds: api.settings.deadlineSeconds,
  });
}

// Serves its two tools to every agent session and shows each session's rounds
// on the page; in the self-test it hands the driver its script.
export const formsMainPart: MainPart<typeof formsManifest> = {
  manifest: formsManifest,
  start(api: FormsApi) {
    const sessions = api.dependency<SessionsMainExports>('sessions');
    const forms = createForms(api, sessions);
    sessions.contributeTools(FORMS_TOOLS, (session) =>
      createFormsToolSession(forms.startSession(session)),
    );
    api.services.selfTest?.run(formsSelfTestScript(sessions));
    return { commands: {} };
  },
};
