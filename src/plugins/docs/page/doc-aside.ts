import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { callEach } from '../../../shared/call-each';
import { element } from '../../../shared/page/dom';
import type { AppSlot } from '../../../shared/page/layout-host/app-slot';
import { rowAction } from '../../../shared/page/ui/row';
import type { AsideHeadingInput, AsideLinkInput } from '../layouts/layout';
import type { LinkedFromRow } from '../linked-from';
import type { DocSection } from '../sections';
import {
  type DocsParts,
  type DrawnPart,
  placeAtEnds,
} from './layout/docs-parts';

const ON_THIS_PAGE_TEXT = 'On this page';
const LINKED_FROM_TEXT = 'Linked from';

export interface DocAsideDeps {
  parts: DocsParts;
  paths: Paths;
  homeDir: string;
  log: PluginLog;
  // Moves the doc to a section's whole-file `line`.
  moveToLine(line: number): void;
  // Opens the doc at `path`, which links here, at the `line` of its link.
  followLink(path: string, line: number): void;
}

// One row of the column: its part's input, its root's tooltip and what a click
// on it does.
interface AsideRow {
  input: AsideLinkInput;
  tooltip: string;
  action(): void;
}

// The doc pane's right column, drawn by the layout's `pageAside`: On this page
// and Linked from. It hides while it holds nothing, and logs each time the
// narrow rule, which is CSS alone, takes it out of sight or brings it back.
export interface DocAside {
  element: HTMLElement;
  // Draws `sections` and `links` at the scroll it had; with neither, as `clear`.
  show(sections: readonly DocSection[], links: readonly LinkedFromRow[]): void;
  // Removes what it drew and hides.
  clear(): void;
  // True while it holds a section or a link.
  isShown(): boolean;
  scrollToTop(): void;
  dispose(): void;
}

export function createDocAside(deps: DocAsideDeps): DocAside {
  const { parts } = deps;
  const root = element('div', 'docs-aside');
  root.hidden = true;
  const onThisPageSection = element('div', 'docs-aside-section');
  const linkedFromSection = element('div', 'docs-aside-section');
  let drawnAside: DrawnPart | null = null;
  // The headings and rows drawn in the two sections.
  let drawnRows: DrawnPart[] = [];
  let isInSight = false;
  const observer = new ResizeObserver(() => {
    if (root.hidden) {
      return;
    }
    const isInSightNow = root.offsetWidth > 0;
    if (isInSightNow !== isInSight) {
      isInSight = isInSightNow;
      deps.log(`right column ${isInSightNow ? 'in' : 'out of'} sight`);
    }
  });
  observer.observe(root);

  const disposeDrawn = () => {
    const drawn = [...drawnRows, drawnAside];
    drawnRows = [];
    drawnAside = null;
    callEach(drawn, (part) => part?.dispose());
  };

  // Draws one section; hidden and undrawn with no row.
  const drawSection = (
    section: HTMLElement,
    heading: AsideHeadingInput,
    rows: AsideRow[],
  ) => {
    section.hidden = rows.length === 0;
    if (rows.length === 0) {
      return;
    }
    drawnRows.push(parts.draw('asideHeading', section, heading, (kit) => kit));
    for (const row of rows) {
      const drawn = parts.draw('asideLink', section, row.input, (kit) => kit);
      drawn.element.title = row.tooltip;
      rowAction(drawn.element, row.action);
      drawnRows.push(drawn);
    }
  };

  const clear = () => {
    disposeDrawn();
    root.hidden = true;
  };

  return {
    element: root,
    show(sections, links) {
      if (sections.length === 0 && links.length === 0) {
        clear();
        return;
      }
      const { scrollTop } = root;
      disposeDrawn();
      root.hidden = false;
      let placing: AppSlot[] = [];
      drawnAside = parts.draw('pageAside', root, {}, (kit, slotFor) => {
        const onThisPage = slotFor(onThisPageSection, 'onThisPage');
        const linked = slotFor(linkedFromSection, 'linkedFrom');
        placing = [onThisPage, linked];
        return {
          ...kit,
          onThisPage: onThisPage.place,
          linkedFrom: linked.place,
        };
      });
      placeAtEnds(placing, drawnAside.element);
      const least = Math.min(...sections.map((section) => section.level));
      drawSection(
        onThisPageSection,
        { title: ON_THIS_PAGE_TEXT, kind: 'sections' },
        sections.map((section) => ({
          input: { title: section.title, depth: section.level - least },
          tooltip: section.title,
          action: () => deps.moveToLine(section.startLine),
        })),
      );
      drawSection(
        linkedFromSection,
        { title: LINKED_FROM_TEXT, kind: 'linkedFrom' },
        links.map((link) => ({
          input: { title: link.title, depth: 0 },
          tooltip: deps.paths.tilde(link.path, deps.homeDir),
          action: () => deps.followLink(link.path, link.line),
        })),
      );
      root.scrollTop = scrollTop;
    },
    clear,
    isShown: () => !root.hidden,
    scrollToTop() {
      root.scrollTop = 0;
    },
    dispose() {
      callEach<() => void>(
        [() => observer.disconnect(), disposeDrawn],
        (step) => step(),
      );
    },
  };
}
