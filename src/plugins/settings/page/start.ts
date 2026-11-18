import './settings.css';
import { corePluginsSlot } from '../../../contracts/core-state';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import {
  keyRunner,
  kitCommandsOf,
} from '../../../shared/page/layout-host/base-kit';
import { placeWrites } from '../../../shared/page/place-slot';
import {
  type SettingsChannel,
  type SettingsPageExports,
  type SettingsPlace,
  settingsPlaceSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { SettingsLayout } from '../layouts/layout';
import { settingsManifest } from '../manifest';
import { BUILT_IN_CONTROL_KINDS } from './built-in-control-kinds';
import { createControlKinds } from './control-kinds';
import { readSettingsLayout } from './layout/read-layout';
import { createSettingsView } from './settings-view';

type SettingsApi = PageApi<typeof settingsManifest, SettingsChannel>;

const TITLE = 'Settings';

// Settings mode: the sections in the side bar, the open section's rows in the
// sheet, drawn through the `settings.layout` layout. `showMode` shows the
// mode, or toggles its side bar while it shows; main's `show` message
// (`Cmd+,`) only shows it. Each `changed` message reads the user config again
// and redraws; each new layout set redraws in the new layouts; each change of
// `core.plugins` redraws the Plugins section. Hiding the mode cancels a key
// recording, so a capture never outlives the mode on screen. The cursors,
// the Leader menu's two among them, the open section and the filter go to
// `settings.place` on each change, and a page load puts the last page's back.
// Setting rows draw and edit through the control kinds the part registers: the
// built-ins, then each one a dependent adds through `addControlKind`, which
// redraws the open section on each change; the registry goes with the part.
export const settingsPagePart: PagePart<typeof settingsManifest> = {
  manifest: settingsManifest,
  start(api: SettingsApi) {
    const { services } = api;
    const { log } = services;
    const placeWriter = api.state.publish(settingsPlaceSlot);
    const place = placeWrites<SettingsPlace>((value) => placeWriter.set(value));
    const plugins = api.state.read(corePluginsSlot);
    const controlKinds = createControlKinds();
    for (const kind of BUILT_IN_CONTROL_KINDS) {
      controlKinds.add(kind);
    }
    const view = createSettingsView({
      channel: api.channel,
      editor: services.editor,
      matcher: services.fuzzy,
      platform: api.platform.os,
      state: api.state.forLayouts,
      markdown: services.markdown,
      keys: api.keys,
      commands: kitCommandsOf(api),
      log,
      toast: services.toast,
      setScope: (scope) => api.keys.setScope(scope),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      pushScope: (scope) => api.keys.pushScope(scope),
      captureKey: (onKey, onCancel) => api.keys.captureKey(onKey, onCancel),
      picker: services.picker,
      sectionShown: (title) => mode.setContext({ title: TITLE, detail: title }),
      // A section picked from the side bar, or main taking the keys, closes
      // its overlay.
      sectionPicked: () => mode.picked(),
      runKey: keyRunner(api.commands, log),
      placeChanged: (value) => place.write(value),
      plugins: () => plugins.get() ?? [],
      controlKind: (id) => controlKinds.get(id),
    });
    const kindsChange = controlKinds.onChanged(() =>
      view.controlKindsChanged(),
    );
    const savedPlace = placeWriter.get();
    if (savedPlace !== undefined) {
      view.restorePlace(savedPlace);
    }

    // `sectionShown` and `sectionPicked` read `mode` only
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
      hidden: () => view.hidden(),
      sideBarHidden: () => view.sideBarHidden(),
      sideBarOpenedOver: () => view.sideBarOpenedOver(),
      focusSideBar: () => view.focusSideBar(),
      focusMain: () => view.focusMain(),
    });

    api.layouts.show<SettingsLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readSettingsLayout,
      userLayout: () => api.settings().layout,
      setLayouts: (shown) => view.setLayouts(shown),
    });
    api.channel.on('changed', () => view.reread());
    plugins.on(() => view.pluginsChanged());
    api.channel.on('show', () => mode.show());
    let isStopped = false;
    view.load().catch((error) => {
      if (isStopped) {
        return;
      }
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
      commands: {
        showMode,
        ...view.commands,
        moveToRow: ({ arg }) => view.moveToRow(arg),
        openSectionAt: ({ arg }) => view.openSectionAt(arg),
      },
      exports: (consumer): SettingsPageExports => ({
        addControlKind: (kind) => consumer.track(controlKinds.add(kind)),
      }),
      dispose() {
        isStopped = true;
        callEach<{ dispose(): void }>([view, kindsChange], (each) =>
          each.dispose(),
        );
      },
    };
  },
};
