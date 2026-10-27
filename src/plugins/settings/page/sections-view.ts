import { element } from '../../../shared/page/dom';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';

export interface SectionItem {
  id: string;
  title: string;
}

export interface SectionsViewDeps {
  // A section's row was clicked, by its index.
  clicked(index: number): void;
  // Draws the side bar's pane into `container`; returns its section rows slot.
  drawPane(container: HTMLElement): DrawnPart<{
    element: HTMLElement;
    sectionRows: HTMLElement;
  }>;
  // Draws `section`'s row into `parent`.
  drawRow(
    parent: HTMLElement,
    section: SectionItem,
  ): DrawnPart<{ element: HTMLElement }>;
}

// Settings mode's side bar: the layout's pane, holding one row per section.
// `draw` draws the rows again, marking the open section selected and drawing
// the cursor row's focus ring while `hasFocus`; `redrawPane` draws the pane
// again, as after a new layout, with no rows until the next `draw`.
export interface SectionsView {
  element: HTMLElement;
  draw(
    sections: readonly SectionItem[],
    cursor: number,
    openId: string,
    hasFocus: boolean,
  ): void;
  redrawPane(): void;
  dispose(): void;
}

export function createSectionsView(deps: SectionsViewDeps): SectionsView {
  const container = element('div', 'settings-sections');
  container.tabIndex = -1;
  let pane = deps.drawPane(container);
  let rowDisposes: (() => void)[] = [];

  const disposeRows = () => {
    const disposes = rowDisposes;
    rowDisposes = [];
    for (const dispose of disposes) {
      dispose();
    }
  };

  const disposePane = () => {
    disposeRows();
    pane.dispose();
    pane.built.element.remove();
  };

  return {
    element: container,
    draw(sections, cursor, openId, hasFocus) {
      disposeRows();
      const list = pane.built.sectionRows;
      list.replaceChildren();
      sections.forEach((section, index) => {
        const drawn = deps.drawRow(list, section);
        rowDisposes.push(drawn.dispose);
        const item = drawn.built.element;
        item.classList.add('ui-row--action');
        item.addEventListener('mousedown', (event) => event.preventDefault());
        item.addEventListener('click', () => deps.clicked(index));
        item.classList.toggle('is-selected', section.id === openId);
        item.classList.toggle('is-cursor', hasFocus && index === cursor);
      });
    },
    redrawPane() {
      disposePane();
      pane = deps.drawPane(container);
    },
    dispose: disposePane,
  };
}
