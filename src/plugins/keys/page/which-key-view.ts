import type { Area } from '../../../contracts/plugin';
import {
  floatingPanel,
  openFloatingPanel,
} from '../../../shared/page/ui/floating-panel';
import type { Drawn, KeysParts } from './layout/keys-parts';
import type { WhichKeyView } from './which-key-controller';
import type { WhichKeyModel } from './which-key';

// The which-key panel in `overlay`, docked above the status bar while it
// shows and at the window's bottom edge otherwise, its contents drawn through
// the `whichKey` part of `parts` on each show, with the layouts set then.
// Display-only, and hidden while closed.
export function mountWhichKeyView(
  overlay: Area,
  parts: KeysParts,
): WhichKeyView {
  const panel = floatingPanel();
  panel.classList.add('which-key');
  panel.hidden = true;
  overlay.contribute(panel);
  let contents: Drawn | null = null;
  return {
    show(model: WhichKeyModel) {
      contents?.dispose();
      contents = parts.whichKey(panel, model);
      openFloatingPanel(panel);
    },
    hide() {
      panel.hidden = true;
    },
  };
}
