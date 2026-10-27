import type { Platform } from '../../../contracts/platform';
import type { Area } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import {
  floatingPanel,
  openFloatingPanel,
} from '../../../shared/page/ui/floating-panel';
import { kbd } from '../../../shared/page/ui/kbd';
import { row } from '../../../shared/page/ui/row';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import type { WhichKeyView } from './which-key-controller';
import type { WhichKeyModel } from './which-key';

// The which-key panel in `overlay`, docked above the status bar while it
// shows and at the window's bottom edge otherwise: a row per next key, its
// keys printed for `platform` at the row's end. Display-only, and hidden
// while closed.
export function mountWhichKeyView(
  overlay: Area,
  platform: Platform,
): WhichKeyView {
  const panel = floatingPanel();
  panel.classList.add('which-key');
  panel.hidden = true;
  const list = element('div', 'which-key-list');
  overlay.contribute(panel);
  return {
    show(model: WhichKeyModel) {
      list.replaceChildren(
        ...model.entries.map((entry) => {
          const entryRow = row({
            density: 'list',
            label: entry.label,
            trailing: kbd(entry.keys, platform),
          });
          entryRow.classList.add('which-key-row', `is-${entry.kind}`);
          return entryRow;
        }),
      );
      panel.replaceChildren(sectionHeader(model.title), list);
      openFloatingPanel(panel);
    },
    hide() {
      panel.hidden = true;
    },
  };
}
