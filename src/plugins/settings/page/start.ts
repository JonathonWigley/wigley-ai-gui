import './settings.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { qualify } from '../../../shared/plugin-manifests';
import type { SettingsChannel } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { SettingsLayout } from '../layouts/layout';
import { settingsManifest } from '../manifest';
import { readSettingsLayout } from './layout/read-layout';
import { createSettingsView } from './settings-view';

type SettingsApi = PageApi<typeof settingsManifest, SettingsChannel>;

const TITLE = 'Settings';

// Settings mode: the sections in the side bar, the open section's rows in the
// sheet, drawn through the `settings.layout` layout. `showMode` shows the
// mode, or toggles its side bar while it shows; main's `show` message
// (`Cmd+,`) only shows it. Each `changed` message reads the user config again
// and redraws; each new layout set redraws in the new layouts.
export const settingsPagePart: PagePart<typeof settingsManifest> = {
  manifest: settingsManifest,
  start(api: SettingsApi) {
    const { services } = api;
    const { log } = services;
    const view = createSettingsView({
      channel: api.channel,
      editor: services.editor,
      matcher: services.fuzzy,
      platform: api.platform.os,
      state: api.state.forLayouts,
      markdown: services.markdown,
      keys: api.keys,
      commands: {
        exists: (id) => api.keys.command(id) !== undefined,
        run: (id) => api.commands.run(id),
      },
      log,
      toast: services.toast,
      setScope: (scope) => api.keys.setScope(scope),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      isSideBarShown: () => mode.sideBarShown(),
      pushScope: (scope) => api.keys.pushScope(scope),
      picker: services.picker,
      anchor: (element, command, scope, label) =>
        api.keys.anchor(element, qualify(settingsManifest.id, command), {
          scope: qualify(settingsManifest.id, scope),
          label,
        }),
      sectionShown: (title) => mode.setContext({ title: TITLE, detail: title }),
      // A section opened from the side bar closes its overlay.
      sectionPicked: () => mode.picked(),
    });

    // `isSideBarShown`, `sectionShown` and `sectionPicked` read `mode` only
    // once the mode shows, after `add`: Settings mode is never the first mode
    // added. Focus leaves the side bar as it hides and moves to it as it opens
    // over the rows.
    const mode = api.modes.add({
      id: 'main',
      title: TITLE,
      icon: 'settings-gear',
      element: view.sheet,
      sideBar: view.sideBar,
      shown() {
        view.shown();
        log('shown');
      },
      hidden: () => undefined,
      sideBarHidden: () => view.sideBarHidden(),
      sideBarOpenedOver: () => view.sideBarOpenedOver(),
    });

    api.layouts.show<SettingsLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readSettingsLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });
    api.channel.on('changed', () => view.reread());
    api.channel.on('show', () => mode.show());
    view.load().catch((error) => {
      log(`not loaded: ${errorText(error)}`);
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
