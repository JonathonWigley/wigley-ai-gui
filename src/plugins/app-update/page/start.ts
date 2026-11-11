import type { Disposable } from '../../../contracts/disposable';
import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import { element } from '../../../shared/page/dom';
import {
  createBaseKit,
  kitCommandsOf,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type {
  DrawnPart,
  RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { type AppUpdateStatus, appUpdateStatusSlot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type {
  AppUpdatePart,
  ButtonInput,
  CompleteLayout,
  Layout,
} from '../layouts/layout';
import { appUpdateManifest } from '../manifest';
import { readAppUpdateLayout } from './layout/read-app-update-layout';

// The app-update main part talks to the page through its slot alone.
type AppUpdateApi = PageApi<typeof appUpdateManifest, ChannelShape>;

// Before the Keys button, which takes the default order.
const BUTTON_ORDER = -10;

// Draws the title bar's update button through the `app-update.layout` layout while the `app-update.status` slot holds
// an update that waits, runs or failed, and takes the button out of the title bar while it holds none. Redraws on each
// status change, settings change and layouts set, and logs each state the button shows (a failure with its log's last
// line) and its hiding. `pressButton` clicks the drawn button, so a key runs what a click runs.
export const appUpdatePagePart: PagePart<typeof appUpdateManifest> = {
  manifest: appUpdateManifest,
  start(api: AppUpdateApi) {
    const { services } = api;
    const log = services.log;
    const kitServices: OwnerKitServices = {
      markdown: services.markdown,
      keys: api.keys,
      commands: kitCommandsOf(api),
      platform: api.platform.os,
      state: api.state.forLayouts,
    };
    const kitFor = (rollback: RollbackDeps) =>
      createBaseKit(
        ownerBaseKitDeps(appUpdateManifest, kitServices, null, rollback),
      );
    const layoutParts = createLayoutParts<Layout, CompleteLayout>({
      owner: appUpdateManifest.id,
      defaultLayout,
      log,
    });
    const statusSlot = api.state.read(appUpdateStatusSlot);
    const buttonSlot = element('span', 'app-update-title-bar-slot');
    let contribution: Disposable | null = null;
    let button: DrawnPart<AppUpdatePart> | null = null;
    let loggedState: string | null = null;
    let isDisposed = false;

    const hide = () => {
      const last = button;
      const lastContribution = contribution;
      button = null;
      contribution = null;
      callEach<() => void>(
        [
          () => last?.dispose(),
          () => buttonSlot.replaceChildren(),
          () => lastContribution?.dispose(),
        ],
        (step) => step(),
      );
      if (loggedState !== null) {
        loggedState = null;
        log('button hidden');
      }
    };

    const draw = () => {
      if (isDisposed) {
        return;
      }
      const status = statusSlot.get() ?? { kind: 'none' };
      const input = buttonInputOf(status);
      if (input === null) {
        hide();
        return;
      }
      const last = button;
      button = null;
      callEach<() => void>(
        [
          () => last?.dispose(),
          () => {
            buttonSlot.replaceChildren();
            button = layoutParts.draw(
              'button',
              buttonSlot,
              (part, slot, rollback) => part(slot, input, kitFor(rollback)),
            );
          },
        ],
        (step) => step(),
      );
      contribution ??= api.areas.titleBar.contribute(buttonSlot, {
        align: 'end',
        order: BUTTON_ORDER,
      });
      const state = stateText(input);
      if (state !== loggedState) {
        loggedState = state;
        log(`button: ${state}`);
      }
    };

    api.onSettingsChanged(() => draw());
    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readAppUpdateLayout,
      userLayout: () => api.settings().layout,
      setLayouts(shown) {
        layoutParts.setLayouts(shown);
        draw();
      },
    });
    statusSlot.on(() => draw());
    draw();

    // The drawn part's root, or the first button inside it for a layout that wraps one.
    const pressButton = () => {
      const root = button?.built.element ?? null;
      log(`button pressed: ${loggedState ?? 'none'}`);
      const target =
        root instanceof HTMLButtonElement
          ? root
          : root?.querySelector('button');
      target?.click();
    };

    return {
      commands: { pressButton },
      dispose() {
        isDisposed = true;
        button?.dispose();
      },
    };
  },
};

// The button's input for `status`; null when there is nothing to show.
function buttonInputOf(status: AppUpdateStatus): ButtonInput | null {
  switch (status.kind) {
    case 'available':
      return { state: 'available', sha: status.sha, error: null };
    case 'installing':
      return { state: 'installing', sha: null, error: null };
    case 'failed':
      return { state: 'failed', sha: null, error: status.error };
    default:
      return null;
  }
}

// The button's state as the log names it: the commit while available, the
// error's last line once failed.
function stateText(input: ButtonInput): string {
  if (input.state === 'available') {
    return `available ${input.sha ?? ''}`;
  }
  if (input.state === 'failed') {
    return `failed: ${(input.error ?? '').split('\n').at(-1) ?? ''}`;
  }
  return input.state;
}
