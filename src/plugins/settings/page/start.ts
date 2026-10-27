import './settings.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { qualify } from '../../../shared/plugin-manifests';
import type { KeysPageExports } from '../../keys/contract';
import type { SettingsChannel } from '../contract';
import { settingsManifest } from '../manifest';
import { createSettingsView } from './settings-view';

type SettingsApi = PageApi<typeof settingsManifest, SettingsChannel>;

const TITLE = 'Settings';

// Settings mode: the sections in the side bar, the open section's rows in the
// sheet. `showMode` shows the mode, or toggles its side bar while it shows;
// main's `show` message (`Cmd+,`) only shows it. Each `changed` message reads
// the user config again and redraws.
export const settingsPagePart: PagePart<typeof settingsManifest> = {
  manifest: settingsManifest,
  start(api: SettingsApi) {
    const { services } = api;
    const { log } = services;
    const keys = api.dependency<KeysPageExports>('keys');
    const view = createSettingsView({
      channel: api.channel,
      editor: services.editor,
      platform: api.platform,
      log,
      toast: services.toast,
      setScope: (scope) => api.keys.setScope(scope),
      pushScope: (scope) => api.keys.pushScope(scope),
      addOverlay: (element) => api.areas.overlay.contribute(element),
      anchor: (element, command, scope, label) =>
        keys.anchor(element, qualify(settingsManifest.id, command), {
          scope: qualify(settingsManifest.id, scope),
          label,
        }),
      sectionShown: (title) => mode.setContext({ title: TITLE, detail: title }),
      // A section opened from the side bar closes its overlay.
      sectionPicked: () => mode.picked(),
    });

    // `sectionShown` and `sectionPicked` read `mode` only once the mode
    // shows, after `add`: Settings mode is never the first mode added. Focus
    // leaves the side bar as it hides and moves to it as it opens over the
    // rows.
    const mode = api.modes.add({
      id: 'main',
      title: TITLE,
      icon: 'settings-gear',
      element: view.sheet,
      sideBar: view.sideBar,
      shown() {
        view.shown();
        log('settings', 'shown');
      },
      hidden: () => undefined,
      sideBarHidden: () => view.sideBarHidden(),
      sideBarOpenedOver: () => view.sideBarOpenedOver(),
    });

    api.channel.on('changed', () => view.reread());
    api.channel.on('show', () => mode.show());
    view.load().catch((error) => {
      log('settings', `not loaded: ${errorText(error)}`);
      services.toast(errorText(error), 'error');
    });

    // The core logs the side bar's hiding and showing.
    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
        return;
      }
      mode.toggleSideBar();
    };

    return {
      commands: { showMode, ...view.commands },
    };
  },
};
