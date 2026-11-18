import type { Disposable } from '../../../contracts/disposable';
import type {
  ChannelShape,
  PageApi,
  PagePart,
} from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type {
  DrawnPart,
  RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import { sessionsPageKey } from '../../sessions/contract';
import { type AutoRetroState, autoRetroStateSlot } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import defaultStylesheet from '../layouts/default/layout.css?url';
import type { AutoRetroPart, CompleteLayout, Layout } from '../layouts/layout';
import { autoRetroManifest } from '../manifest';
import { registerDemoSteps } from './demo-steps';
import { readAutoRetroLayout } from './layout/read-auto-retro-layout';

type AutoRetroApi = PageApi<typeof autoRetroManifest, ChannelShape>;

// Last: after every other section.
const RETRO_SECTION_ORDER = 1000;

const NO_STATE: AutoRetroState = { rows: [], queued: 0 };

function isSameRows(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((rowId, index) => rowId === b[index]);
}

// Registers the Retro section through sessions' `addSection`, claiming the rows `auto-retro.state` lists, with the
// queued count at its header's end drawn through the `auto-retro.layout` layout while retros wait. Sessions knows no
// change of `claims`, so each change of the rows adds the section again, which redraws the side bar; a change of the
// count alone, and each layouts set, redraws every header the side bar holds. Registers the demo step, which shows the
// Retro section alone for its length.
export const autoRetroPagePart: PagePart<typeof autoRetroManifest> = {
  manifest: autoRetroManifest,
  start(api: AutoRetroApi) {
    const { services } = api;
    const sessions = api.dependency(sessionsPageKey);
    const kitServices: OwnerKitServices = {
      markdown: services.markdown,
      keys: api.keys,
      commands: {
        exists: (id) => api.keys.command(id) !== undefined,
        argShape: (id) => api.keys.command(id)?.arg,
        run: (id) => api.commands.run(id),
      },
      platform: api.platform.os,
      state: api.state.forLayouts,
    };
    const kitFor = (rollback: RollbackDeps) =>
      createBaseKit(
        ownerBaseKitDeps(autoRetroManifest, kitServices, null, rollback),
      );
    const layoutParts = createLayoutParts<Layout, CompleteLayout>({
      owner: autoRetroManifest.id,
      defaultLayout,
      log: services.log,
    });

    const retroState = api.state.read(autoRetroStateSlot);
    const current = () => retroState.get() ?? NO_STATE;
    // Each header wrapper the side bar holds, and the part drawn in it last.
    const headers = new Map<HTMLElement, DrawnPart<AutoRetroPart> | null>();

    const drawHeader = (parent: HTMLElement) => {
      const last = headers.get(parent) ?? null;
      headers.set(parent, null);
      try {
        last?.dispose();
      } finally {
        parent.replaceChildren();
      }
      const { queued } = current();
      if (queued === 0) {
        return;
      }
      headers.set(
        parent,
        layoutParts.draw('queued', parent, (part, slot, rollback) =>
          part(slot, { queued }, kitFor(rollback)),
        ),
      );
    };

    const redrawHeaders = () => callEach([...headers.keys()], drawHeader);

    const addSection = (): Disposable =>
      sessions.addSection({
        id: 'auto-retro',
        label: 'Retro',
        order: RETRO_SECTION_ORDER,
        claims: (row) => current().rows.includes(row.sessionId),
        header: {
          build(parent) {
            headers.set(parent, null);
            drawHeader(parent);
            return {
              dispose() {
                const drawn = headers.get(parent) ?? null;
                headers.delete(parent);
                drawn?.dispose();
              },
            };
          },
        },
      });

    let shown = current();
    let section = addSection();
    retroState.on((value) => {
      const next = value ?? NO_STATE;
      const last = shown;
      shown = next;
      if (!isSameRows(last.rows, next.rows)) {
        section.dispose();
        section = addSection();
      } else if (last.queued !== next.queued) {
        redrawHeaders();
      }
    });

    api.layouts.show<Layout>({
      defaultLayout,
      defaultStylesheet,
      read: readAutoRetroLayout,
      userLayout: () => api.settings().layout,
      setLayouts(layouts) {
        layoutParts.setLayouts(layouts);
        redrawHeaders();
      },
    });
    registerDemoSteps(services, {
      showOnly: (sectionId) => sessions.showOnly(sectionId),
      activate: (sessionId) => sessions.activate(sessionId),
    });

    return {
      commands: {},
      dispose() {
        callEach([...headers.values()], (drawn) => drawn?.dispose());
        headers.clear();
      },
    };
  },
};
