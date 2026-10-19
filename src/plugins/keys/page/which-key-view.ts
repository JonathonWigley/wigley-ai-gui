import type { Area } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import type { WhichKeyView } from './which-key-controller';
import type { WhichKeyModel } from './which-key';

// The which-key panel, docked full width above the status bar in `overlay`;
// display-only, and hidden while closed.
export function mountWhichKeyView(overlay: Area): WhichKeyView {
  const panel = element('div', 'which-key');
  panel.hidden = true;
  const title = element('div', 'which-key-title');
  const list = element('div', 'which-key-list');
  panel.append(title, list);
  overlay.contribute(panel);
  return {
    show(model: WhichKeyModel) {
      title.textContent = model.title;
      list.replaceChildren(
        ...model.entries.map((entry) => {
          const row = element('div', 'which-key-entry');
          row.append(
            element('kbd', '', entry.keys),
            element('span', 'which-key-arrow', '→'),
            element('span', `which-key-label is-${entry.kind}`, entry.label),
          );
          return row;
        }),
      );
      panel.hidden = false;
    },
    hide() {
      panel.hidden = true;
    },
  };
}
