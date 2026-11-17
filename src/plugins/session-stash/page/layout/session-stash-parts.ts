import type { PluginLog } from '../../../../contracts/log';
import type { ShownLayouts } from '../../../../contracts/plugin';
import { appSlot } from '../../../../shared/page/layout-host/app-slot';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  requireDialogFrame,
  requireElementIn,
} from '../../../../shared/page/layout-host/draw-part';
import type {
  DialogFrameInput,
  DialogFramePart,
} from '../../../../shared/page/layout-host/kit';
import { createLayoutParts } from '../../../../shared/page/layout-host/layout-parts';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  CompleteLayout,
  Layout,
  NoteDialogInput,
  NoteDialogKit,
  SessionStashPart,
} from '../../layouts/layout';
import { sessionStashManifest } from '../../manifest';

export interface SessionStashPartsDeps extends OwnerKitServices {
  log: PluginLog;
}

// The plugin's parts over its shown layouts. `noteDialog` draws the stash
// dialog's body around `noteBox`, the app's note box, placing it first when
// the layout leaves it out. `dialogFrame` draws the dialog's panel and title,
// again each time it draws; the earlier draw is disposed and removed.
export interface SessionStashParts {
  setLayouts(shown: ShownLayouts<Layout>): void;
  dialogFrame(
    parent: HTMLElement,
    input: DialogFrameInput,
  ): DrawnPart<DialogFramePart>;
  noteDialog(
    parent: HTMLElement,
    input: NoteDialogInput,
    noteBox: HTMLElement,
  ): DrawnPart<SessionStashPart>;
}

export function createSessionStashParts(
  deps: SessionStashPartsDeps,
): SessionStashParts {
  const parts = createLayoutParts<Layout, CompleteLayout>({
    owner: sessionStashManifest.id,
    defaultLayout,
    log: deps.log,
  });
  return {
    setLayouts: (shown) => parts.setLayouts(shown),
    dialogFrame: (parent, input) =>
      parts.redraw('dialogFrame', parent, (builder, into, rollback) =>
        requireDialogFrame(
          builder(
            into,
            input,
            createBaseKit(
              ownerBaseKitDeps(sessionStashManifest, deps, null, rollback),
            ),
          ),
          input,
          'dialogFrame',
        ),
      ),
    noteDialog: (parent, input, noteBox) =>
      parts.draw('noteDialog', parent, (builder, into, rollback) => {
        const slot = appSlot(noteBox, 'noteBox', rollback);
        const kit: NoteDialogKit = {
          ...createBaseKit(
            ownerBaseKitDeps(sessionStashManifest, deps, null, rollback),
          ),
          noteBox: (boxParent) => slot.place(boxParent),
        };
        const body = builder(into, input, kit);
        slot.placeIfLeftOut(
          requireElementIn(into, body.element, 'noteDialog'),
          'start',
        );
        return body;
      }),
  };
}
