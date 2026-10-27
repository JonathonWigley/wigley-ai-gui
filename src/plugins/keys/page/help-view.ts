import type { Platform } from '../../../contracts/platform';
import type { Area } from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';
import { textButton } from '../../../shared/page/ui/button';
import { createDialog } from '../../../shared/page/ui/dialog';
import { kbd } from '../../../shared/page/ui/kbd';
import { row } from '../../../shared/page/ui/row';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import type { HelpSection } from './help-sections';

// `setSections` replaces the listed sections, open or closed.
export interface HelpView {
  show(): void;
  hide(): void;
  setSections(sections: HelpSection[]): void;
}

// The help dialog, contributed to `overlay` and hidden while closed, its keys
// printed for `platform`. `close` runs on its Close button, which holds
// `closeHint`, the anchor that draws the close key.
export function mountHelpView(
  overlay: Area,
  sections: HelpSection[],
  close: () => void,
  platform: Platform,
  closeHint: HTMLElement,
): HelpView {
  const dialog = createDialog('Keys');
  const grid = element('div', 'keys-help-sections');
  dialog.body.append(grid);
  dialog.actions.append(
    textButton('Close', close, { variant: 'secondary', hint: closeHint }),
  );
  const setSections = (next: HelpSection[]) => {
    grid.replaceChildren(
      ...next.map((section) => renderSection(section, platform)),
    );
  };
  setSections(sections);
  overlay.contribute(dialog.element);
  return {
    show: dialog.show,
    hide: dialog.hide,
    setSections,
  };
}

function renderSection(section: HelpSection, platform: Platform): HTMLElement {
  const block = element('section', 'keys-help-section');
  const list = element('ul', 'keys-help-list');
  list.append(
    ...section.hints.map((hint) =>
      row({
        density: 'list',
        label: hint.label,
        trailing: kbd(hint.keys, platform),
        tag: 'li',
      }),
    ),
  );
  block.append(sectionHeader(section.title), list);
  return block;
}
