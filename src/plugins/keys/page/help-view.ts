import type { Area } from '../../../contracts/plugin';
import { button, element } from '../../../shared/page/dom';
import type { HelpSection } from './help-sections';

// `setSections` replaces the listed sections, open or closed.
export interface HelpView {
  show(): void;
  hide(): void;
  setSections(sections: HelpSection[]): void;
}

// The help dialog over a backdrop that blocks clicks under it, contributed to
// `overlay` and hidden while closed. `close` runs on its Close button.
export function mountHelpView(
  overlay: Area,
  sections: HelpSection[],
  close: () => void,
): HelpView {
  const backdrop = element('div', 'overlay');
  backdrop.hidden = true;
  const dialog = element('div', 'dialog dialog-help');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Keys');
  const grid = element('div', 'keys-help-sections');
  grid.append(...sections.map(renderSection));
  dialog.append(
    element('h2', 'dialog-title', 'Keys'),
    grid,
    button('button', 'Close', close),
  );
  backdrop.append(dialog);
  overlay.contribute(backdrop);
  return {
    show() {
      backdrop.hidden = false;
    },
    hide() {
      backdrop.hidden = true;
    },
    setSections(next) {
      grid.replaceChildren(...next.map(renderSection));
    },
  };
}

function renderSection(section: HelpSection): HTMLElement {
  const block = element('section', 'keys-help-section');
  const list = element('dl', 'keys-help-list');
  for (const hint of section.hints) {
    const term = element('dt');
    term.append(element('kbd', '', hint.keys));
    list.append(term, element('dd', '', hint.label));
  }
  block.append(element('h3', 'keys-help-title', section.title), list);
  return block;
}
