import type { Area } from '../../../contracts/plugin';
import { createDialog } from '../../../shared/page/ui/dialog';
import type { HelpSection } from './help-sections';
import type { Drawn, KeysParts } from './layout/keys-parts';

// `setSections` replaces the listed sections, open or closed.
// `layoutsChanged` draws the frame and body again at once while help shows,
// and at the next `show` while it is hidden. `scroller` is the dialog's
// current panel, the element that scrolls the body.
export interface HelpView {
  readonly scroller: HTMLElement;
  show(): void;
  hide(): void;
  setSections(sections: HelpSection[]): void;
  layoutsChanged(): void;
}

// The help dialog, contributed to `overlay` and hidden while closed, its body
// drawn through the `dialogFrame` and `help` parts of `parts`; the frame's
// actions row holds the Close button.
export function mountHelpView(
  overlay: Area,
  sections: HelpSection[],
  parts: KeysParts,
): HelpView {
  const dialog = createDialog('Keys', {
    drawFrame: (parent, input) => parts.dialogFrame(parent, input).built,
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
  draw();
  overlay.contribute(dialog.element);
  return {
    get scroller() {
      return dialog.panel;
    },
    show() {
      if (isStale) {
        dialog.redrawFrame();
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
        dialog.redrawFrame();
        draw();
      } else {
        isStale = true;
      }
    },
  };
}
