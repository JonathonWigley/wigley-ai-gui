import { element } from '../../../shared/page/dom';
import { row } from '../../../shared/page/ui/row';

export interface SectionItem {
  id: string;
  title: string;
}

export interface SectionsViewDeps {
  // A section's row was clicked, by its index.
  clicked(index: number): void;
  // The `⌥L rows ›` edge prompt, placed at the pane's end edge.
  edge: HTMLElement;
}

// Settings mode's side bar: one row per section, then `edge`. `draw` marks
// the open section selected and draws the cursor row's focus ring while
// `hasFocus`.
export interface SectionsView {
  element: HTMLElement;
  draw(
    sections: readonly SectionItem[],
    cursor: number,
    openId: string,
    hasFocus: boolean,
  ): void;
}

export function createSectionsView(deps: SectionsViewDeps): SectionsView {
  const pane = element('div', 'settings-sections');
  pane.tabIndex = -1;
  const list = element('ol', 'settings-section-rows');
  pane.append(list, deps.edge);
  return {
    element: pane,
    draw(sections, cursor, openId, hasFocus) {
      list.replaceChildren(
        ...sections.map((section, index) => {
          const item = row({
            density: 'list',
            tag: 'li',
            label: section.title,
            onClick: () => deps.clicked(index),
          });
          item.classList.toggle('is-selected', section.id === openId);
          item.classList.toggle('is-cursor', hasFocus && index === cursor);
          return item;
        }),
      );
    },
  };
}
