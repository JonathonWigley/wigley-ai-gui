import type { ConfirmBodyParts } from '../../../../shared/page/confirm-prompt';
import {
  type DrawnPart,
  drawPart,
  requireDialogFrame,
  requireElementIn,
  type RollbackDeps,
} from '../../../../shared/page/layout-host/draw-part';
import type {
  DialogFrameInput,
  DialogFramePart,
} from '../../../../shared/page/ui/dialog';
import { formsScope } from '../../ids';
import defaultLayout from '../../layouts/default/layout.js';
import type { FormsBaseKit } from '../../layouts/layout';
import { baseKitDepsFor, createFormsBaseKit } from './card-kit';
import type { PaneDeps } from './layout-panes';
import type { LayoutPick } from './layout-resolver';

// What the cancel prompt's parts reach outside themselves: as a pane's, less
// the round's boxes, commands run and review columns, which a dialog part has
// no round for.
export type FormsDialogDeps = Pick<
  PaneDeps,
  'markdown' | 'platform' | 'log' | 'keys' | 'commands' | 'state'
>;

// The cancel prompt's frame, drawn into `parent` (the dialog's scrim) by
// drawPart with the picked layout's `dialogFrame`, or with `default`'s when
// the pick lacks it, throws or returns a frame requireDialogFrame refuses. The
// anchors and markdown mounts its kit makes go to the draw's dispose.
export function drawFormsDialogFrame(
  parent: HTMLElement,
  input: DialogFrameInput,
  pick: LayoutPick,
  deps: FormsDialogDeps,
): DrawnPart<DialogFramePart> {
  return drawPart({
    owner: 'forms',
    parent,
    pick,
    defaultLayout,
    part: (layout) => layout.dialogFrame,
    build: (dialogFrame, into, rollback) =>
      requireDialogFrame(
        dialogFrame(into, input, confirmKit(deps, rollback)),
        input,
        'dialogFrame',
      ),
    log: deps.log,
    partName: 'dialogFrame',
  });
}

// The cancel prompt's body, drawn into `parent` (the frame's body) as
// drawFormsDialogFrame draws the frame, with the layout's `confirmBody`; its
// kit places the prompt's own buttons through `parts`.
export function drawFormsConfirmBody(
  parent: HTMLElement,
  parts: ConfirmBodyParts,
  pick: LayoutPick,
  deps: FormsDialogDeps,
): DrawnPart<{ element: HTMLElement }> {
  return drawPart({
    owner: 'forms',
    parent,
    pick,
    defaultLayout,
    part: (layout) => layout.confirmBody,
    build: (confirmBody, into, rollback) => ({
      element: requireElementIn(
        into,
        confirmBody(
          into,
          { body: parts.body },
          {
            ...confirmKit(deps, rollback),
            keepButton: parts.keepButton,
            confirmButton: parts.confirmButton,
          },
        ),
        'confirmBody',
      ),
    }),
    log: deps.log,
    partName: 'confirmBody',
  });
}

// The base kit a dialog part draws with, its keys in `forms.confirm`; every
// anchor and markdown mount it makes is recorded for the part's rollback.
function confirmKit(
  deps: FormsDialogDeps,
  rollback: RollbackDeps,
): FormsBaseKit {
  return createFormsBaseKit(
    baseKitDepsFor(
      {
        ...deps,
        recordAnchor: (anchor) => rollback.recordAnchor(anchor),
        recordMount: (mount) => rollback.recordAnchor(mount),
      },
      formsScope('confirm'),
    ),
  );
}
