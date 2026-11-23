import './builds.css';
import type { PageApi, PagePart } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
import {
  keyRunner,
  kitCommandsOf,
  type OwnerKitServices,
} from '../../../shared/page/layout-host/base-kit';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { chatPageKey } from '../../chat/contract';
import { sessionsPageKey, sessionsRowsSlot } from '../../sessions/contract';
import {
  type BuildsChannel,
  type BuildsSnapshot,
  buildsSessionsSlot,
  buildsSnapshotSlot,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { BuildsLayout, CompleteBuildsLayout } from '../layouts/layout';
import { buildsManifest } from '../manifest';
import { createBuildsView } from './builds-view';
import type { BuildsDemoSample } from './demo-sample';
import { registerDemoSteps } from './demo-steps';
import { readBuildsLayout } from './layout/read-builds-layout';
import { startSessionParts } from './session-parts';

type BuildsApi = PageApi<typeof buildsManifest, BuildsChannel>;

const TITLE = 'Builds';
const NO_SNAPSHOT: BuildsSnapshot = { backends: [], polledAt: null };

// Builds mode: All and each backend's tracked games in the side bar, and in the sheet the shown game's builds, or
// every game's in the All feed, drawn with the layout the `layout` setting names; `showMode` shows the mode, or
// toggles its side bar while it shows. Reads `builds.snapshot`, `builds.sessions` and `sessions.rows`, and redraws on
// each change of them. Invokes `setShown(true)` as the mode shows and `setShown(false)` as it hides and as the part
// is disposed; a failed invoke logs `setShown failed: <error>`. Draws the session parts (the row line and `building`
// activity, the hub's Builds section and the offer card) from the same slots. Holds the one demo sample both draw
// while a demo step shows, and registers the Builds and Session builds demo steps' page halves.
export const buildsPagePart: PagePart<typeof buildsManifest> = {
  manifest: buildsManifest,
  start(api: BuildsApi) {
    const { services } = api;
    const { log } = services;
    const sessions = api.dependency(sessionsPageKey);
    const chat = api.dependency(chatPageKey);
    const snapshotSlot = api.state.read(buildsSnapshotSlot);
    const sessionsSlot = api.state.read(buildsSessionsSlot);
    const rows = api.state.read(sessionsRowsSlot);
    const kitServices: OwnerKitServices = {
      markdown: services.markdown,
      keys: api.keys,
      commands: kitCommandsOf(api),
      platform: api.platform.os,
      state: api.state.forLayouts,
      log,
    };
    const parts = createLayoutParts<BuildsLayout, CompleteBuildsLayout>({
      owner: buildsManifest.id,
      defaultLayout,
      log,
    });
    let isShown = false;
    let isDisposed = false;
    let sample: BuildsDemoSample | null = null;

    const reportShown = (shown: boolean) => {
      api.channel
        .invoke('setShown', shown)
        .catch((error: unknown) => log(`setShown failed: ${errorText(error)}`));
    };

    const view = createBuildsView({
      channel: api.channel,
      log,
      toast: (text, tone) => services.toast(text, tone),
      openExternal: (url) => services.openExternal(url),
      now: () => services.clock.now(),
      kitServices,
      parts,
      picker: services.picker.create({ filter: true }),
      snapshot: () => snapshotSlot.get() ?? NO_SNAPSHOT,
      sessions: () => sessionsSlot.all(),
      sessionLabels: () =>
        new Map(
          [...rows.all()].map(([sessionId, row]) => [sessionId, row.label]),
        ),
      setScope: (scope) => api.keys.setScope(scope),
      setResizeTarget: (target) => api.panes.setResizeTarget(target),
      setFocusTarget: (target) => api.panes.setFocusTarget(target),
      isShown: () => isShown,
      picked: () => mode.picked(),
      runKey: keyRunner(api.commands, log),
    });

    // The view reads `mode` only once a key or a click runs, after `add`.
    const mode = api.modes.add({
      id: 'main',
      title: TITLE,
      icon: 'package',
      element: view.sheet,
      sideBar: view.sideBar,
      shown() {
        isShown = true;
        view.shown();
        reportShown(true);
      },
      hidden() {
        isShown = false;
        view.hidden();
        reportShown(false);
      },
      sideBarHidden: () => view.sideBarHidden(),
      sideBarOpenedOver: () => view.sideBarOpenedOver(),
      focusSideBar: () => view.focusSideBar(),
      focusMain: () => view.focusMain(),
    });

    const sessionParts = startSessionParts({
      sessionsPage: sessions,
      chat,
      channel: api.channel,
      log,
      toast: (text, tone) => services.toast(text, tone),
      kitServices,
      parts,
      rows,
      snapshot: () => snapshotSlot.get() ?? NO_SNAPSHOT,
      sessions: () => sessionsSlot.all(),
      sample: () => sample,
      setScope: () => api.keys.setScope('offer'),
    });

    const changed = () => {
      if (!isDisposed) {
        view.changed();
        sessionParts.changed();
      }
    };

    const showSample = (next: BuildsDemoSample | null) => {
      sample = next;
      view.showSample(next?.snapshot ?? null);
      sessionParts.changed();
    };

    const listeners = [
      snapshotSlot.on(changed),
      sessionsSlot.on(changed),
      rows.on(changed),
    ];

    api.layouts.show<BuildsLayout>({
      defaultLayout,
      defaultStylesheet,
      read: readBuildsLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        parts.setLayouts(shown);
        view.redraw();
        sessionParts.changed();
      },
    });

    // The core logs the side bar's hiding and showing.
    const showMode = () => {
      if (!mode.isShown()) {
        mode.show();
        return;
      }
      mode.toggleSideBar();
    };

    registerDemoSteps(services, {
      commands: api.commands,
      showSample,
      selectEntry: (key) => view.selectEntry(key),
      activate: (sessionId) => sessions.activate(sessionId),
      showHubForNow: (sectionId) => chat.showHubForNow(sectionId),
    });

    return {
      commands: {
        showMode,
        ...view.commands,
        selectEntry: ({ arg }) => view.selectEntry(arg),
        selectBuild: ({ arg }) => view.selectBuild(arg),
        queueButton: ({ arg }) => view.queueButton(arg),
        withAgent: ({ arg }) => view.withAgent(arg),
        setFilter: ({ arg }) => view.setFilter(arg),
        openLink: ({ arg }) => view.openLink(arg),
        queueOffer: () => sessionParts.queueOffer(),
        dismissOffer: () => sessionParts.dismissOffer(),
        queueSessionOffer: ({ arg }) => sessionParts.queueSessionOffer(arg),
        dismissSessionOffer: ({ arg }) => sessionParts.dismissSessionOffer(arg),
        leaveOffer: () => sessionParts.leaveOffer(),
        offerFocusBox: () => sessionParts.offerToBox('insert'),
        offerAppendBox: () => sessionParts.offerToBox('append'),
      },
      ready() {
        sessionParts.changed();
      },
      dispose() {
        isDisposed = true;
        isShown = false;
        callEach<() => void>(
          [
            ...listeners.map((listener) => () => listener.dispose()),
            () => sessionParts.dispose(),
            () => view.dispose(),
            () => reportShown(false),
          ],
          (step) => step(),
        );
      },
    };
  },
};
