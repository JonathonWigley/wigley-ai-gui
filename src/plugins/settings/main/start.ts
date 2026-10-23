import type { MainApi, MainPart } from '../../../contracts/plugin';
import type { SettingsChannel } from '../contract';
import { settingsManifest } from '../manifest';

type SettingsApi = MainApi<typeof settingsManifest, SettingsChannel>;

// Serves the page the user config through `services.userConfig`, tells it
// each time the config changes, and on `settings.show` brings the window
// forward and tells the page to show Settings mode.
export const settingsMainPart: MainPart<typeof settingsManifest> = {
  manifest: settingsManifest,
  start(api: SettingsApi) {
    const { services, channel } = api;
    const { userConfig } = services;
    channel.handle('schema', () => userConfig.schema());
    channel.handle('read', () => userConfig.read());
    channel.handle('writeSettings', (layer, expectedText) =>
      userConfig.writeSettings(layer, expectedText),
    );
    channel.handle('writeKeymap', (layer, expectedText) =>
      userConfig.writeKeymap(layer, expectedText),
    );
    const changed = userConfig.onChanged(() => channel.send('changed', null));
    return {
      commands: {
        show: () => {
          services.window.show();
          channel.send('show', null);
        },
      },
      dispose: () => changed.dispose(),
    };
  },
};
