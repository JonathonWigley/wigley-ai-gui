import type { Area } from '../../../contracts/plugin';
import { textButton } from '../../../shared/page/ui/button';
import { createDialog } from '../../../shared/page/ui/dialog';
import type { HelpSection } from './help-sections';
import type { Drawn, KeysParts } from './layout/keys-parts';

// `setSections` replaces the listed sections, open or closed.
// `layoutsChanged` draws the body again at once while help shows, and at the
// next `show` while it is hidden.
export interface HelpView {
  show(): void;
  hide(): void;
  setSections(sections: HelpSection[]): void;
  layoutsChanged(): void;
}

// The help dialog, contributed to `overlay` and hidden while closed, its body
// drawn through the `help` part of `parts`. `close` runs on its Close button,
// which holds `closeHint`, the anchor that draws the close key.
export function mountHelpView(
  overlay: Area,
  sections: HelpSection[],
  close: () => void,
  closeHint: HTMLElement,
  parts: KeysParts,
): HelpView {
  const dialog = createDialog('Keys');
  dialog.element.classList.add('keys-help-scrim');
  dialog.panel.classList.add('keys-help-dialog');
  dialog.actions.append(
    textButton('Close', close, { variant: 'secondary', hint: closeHint }),
  );
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
    show() {
      if (isStale) {
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
        draw();
      } else {
        isStale = true;
      }
    },
  };
}
