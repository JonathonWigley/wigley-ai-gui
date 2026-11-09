import type { MainApi, MainPart } from '../../../contracts/plugin';
import type { SettingsChannel } from '../contract';
import layoutTypes from '../layouts/layout.d.ts?raw';
import { settingsManifest } from '../manifest';
import { settingsSelfTestScript } from './selftest-script';

type SettingsApi = MainApi<typeof settingsManifest, SettingsChannel>;

// Serves the page the user config through `services.userConfig` and the
// switch-off ask through `services.pluginSwitch`, tells it each time the
// config changes, and on `settings.show` brings the window
// forward and tells the page to show Settings mode. Registers the settings
// layout contract. Hands the self-test its script, which shows the mode the
// same way.
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
    channel.handle('mayDisable', (pluginId) =>
      services.pluginSwitch.mayDisable(pluginId),
    );
    api.layouts.register({ layoutTypes });
    userConfig.onChanged(() => channel.send('changed', null));
    const show = () => {
      services.window.show();
      channel.send('show', null);
    };
    services.selfTest?.run(settingsSelfTestScript({ userConfig, show }));
    return { commands: { show } };
  },
};
