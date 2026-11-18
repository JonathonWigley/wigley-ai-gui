import type { Area } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import type { DialogFramePart } from '../../../shared/page/layout-host/kit';
import { createDialog } from '../../../shared/page/ui/dialog';
import type { HelpSection } from './help-sections';
import type { Drawn, KeysParts } from './layout/keys-parts';

// `setSections` replaces the listed sections, open or closed.
// `layoutsChanged` draws the frame and body again at once while help shows,
// and at the next `show` while it is hidden. `scroller` is the dialog's
// current panel, the element that scrolls the body. `dispose` disposes the
// frame and body drawn last.
export interface HelpView {
  readonly scroller: HTMLElement;
  show(): void;
  hide(): void;
  setSections(sections: HelpSection[]): void;
  layoutsChanged(): void;
  dispose(): void;
}

// The help dialog, contributed to `overlay` and hidden while closed, its body
// drawn through the `dialogFrame` and `help` parts of `parts`; the frame's
// actions row holds the Close button.
export function mountHelpView(
  overlay: Area,
  sections: HelpSection[],
  parts: KeysParts,
): HelpView {
  let frame: DrawnPart<DialogFramePart> | null = null;
  const dialog = createDialog('Keys', {
    drawFrame: (parent, input) => {
      frame = parts.dialogFrame(parent, input);
      return frame.built;
    },
  });
  dialog.element.classList.add('keys-help-scrim');
  let current = sections;
  let body: Drawn | null = null;
  let isStale = false;
  const draw = () => {
    body?.dispose();
    body = parts.help(dialog.body, { sections: current });
    isStale = false;
  };
  // The keys frame draws its whole actions row itself, so the old row's Close
  // is dropped before `redrawFrame` moves it into the new frame.
  const redrawFrame = () => {
    dialog.actions.replaceChildren();
    dialog.redrawFrame();
  };
  draw();
  overlay.contribute(dialog.element);
  return {
    get scroller() {
      return dialog.panel;
    },
    show() {
      if (isStale) {
        redrawFrame();
        draw();
      }
      dialog.show();
    },
    hide: dialog.hide,
    setSections(next) {
      current = next;
      draw();
    },
    layoutsChanged() {
      if (dialog.isShown()) {
        redrawFrame();
        draw();
      } else {
        isStale = true;
      }
    },
    dispose() {
      const drawn: (Drawn | DrawnPart<DialogFramePart> | null)[] = [
        body,
        frame,
      ];
      body = null;
      frame = null;
      callEach(drawn, (each) => each?.dispose());
    },
  };
}
