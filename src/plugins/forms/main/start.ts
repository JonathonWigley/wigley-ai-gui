import os from 'node:os';
import path from 'node:path';
import type { MainApi, MainPart } from '../../../contracts/plugin';
import {
  type FormsChannel,
  type FormsService,
  RELAY_PROTOCOL,
} from '../contract';
import { formsManifest } from '../manifest';
import { createChannelPresenter } from './channel-presenter';
import { createFormsService } from './forms-service';
import { serveMcp } from './mcp/mcp-server';
import {
  channelPath,
  launchCommand,
  writeEndpointFiles,
} from './relay/endpoint';
import { startRelayServer } from './relay/relay-server';
import { createRoundStore } from './round-store';
import { formsSelfTestScript } from './selftest-script';
import { FORMS_TOOLS } from './tool-definitions';

type FormsApi = MainApi<typeof formsManifest, FormsChannel>;

function createForms(api: FormsApi, agentsDir: string): FormsService {
  const { services } = api;
  const store = createRoundStore({
    roundsDir: path.join(agentsDir, 'wigley-forms', 'rounds'),
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
    ),
    store,
    defaultDeadlineSeconds: api.settings.deadlineSeconds,
  });
}

// Opens the channel relay.py connects to, and tells relays where it is and
// how to start the app.
function openRelayChannel(
  forms: FormsService,
  api: FormsApi,
  agentsDir: string,
) {
  const channel = channelPath(
    process.platform,
    api.services.homeDir,
    os.userInfo().username,
  );
  const relay = startRelayServer({
    channel,
    forms,
    serve: (streams, session) => serveMcp(streams, session, FORMS_TOOLS),
    log: api.services.log,
  });
  writeEndpointFiles(
    path.join(agentsDir, 'wigley-ai-gui'),
    {
      protocol: RELAY_PROTOCOL,
      channel,
      launch: launchCommand(process.env, process.execPath, process.cwd()),
    },
    FORMS_TOOLS,
  );
  return relay;
}

// Receives agents' rounds over the relay and shows them on the page; in the
// self-test it opens no relay and hands the driver its script instead.
export const formsMainPart: MainPart<typeof formsManifest> = {
  manifest: formsManifest,
  start(api: FormsApi) {
    const agentsDir = path.join(api.services.homeDir, '.agents');
    const forms = createForms(api, agentsDir);
    if (api.services.selfTest) {
      api.services.selfTest.run(formsSelfTestScript(forms));
      return { commands: {} };
    }
    const relay = openRelayChannel(forms, api, agentsDir);
    return { commands: {}, dispose: () => relay.close() };
  },
};
