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
  // It left sight after being in sight, or was cleared while shown.
  sightLost(): void;
}

// What a row of the column leads to: a section of this doc (On this page), or a
// doc linking here (Linked from).
export type AsideRowKind = 'section' | 'linkedFrom';

// One row of the column: its part's input, its root's tooltip, its kind and
// what a click or `openCursor` on it does.
interface AsideRow {
  input: AsideLinkInput;
  tooltip: string;
  kind: AsideRowKind;
  action(): void;
}

// A drawn row, in the cursor's walk.
interface CursorRow {
  row: AsideRow;
  element: HTMLElement;
}

// The doc pane's right column, drawn by the layout's `pageAside`: On this page
// and Linked from. It hides while it holds nothing, and logs each time the
// narrow rule, which is CSS alone, takes it out of sight or brings it back.
// Its cursor walks the rows of both lists in drawn order, stopping at either
// end, and logs the row each press reaches; the cursor row carries
// `is-selected` and `is-cursor` only while the column holds the DOM focus,
// however that focus landed.
export interface DocAside {
  element: HTMLElement;
  // Draws `sections` and `links` at the scroll it had, the cursor at its index
  // clamped to the last row; with neither, as `clear`.
  show(sections: readonly DocSection[], links: readonly LinkedFromRow[]): void;
  // Removes what it drew, hides, and puts the cursor on the first row.
  clear(): void;
  // True while it holds a section or a link.
  isShown(): boolean;
  // True while it holds a row and has a laid-out width, read now.
  isInSight(): boolean;
  // Takes the DOM focus, drawing the ring on the cursor row in sight.
  focus(): void;
  move(by: 1 | -1): void;
  top(): void;
  bottom(): void;
  // Runs the cursor row's action and returns its kind; null with no row.
  openCursor(): AsideRowKind | null;
  // Scrolls to the top and puts the cursor on the first row.
  reset(): void;
  dispose(): void;
}

export function createDocAside(deps: DocAsideDeps): DocAside {
  const { parts } = deps;
  const root = element('div', 'docs-aside');
  root.hidden = true;
  root.tabIndex = -1;
  const onThisPageSection = element('div', 'docs-aside-section');
  const linkedFromSection = element('div', 'docs-aside-section');
  let drawnAside: DrawnPart | null = null;
  // The headings and rows drawn in the two sections.
  let drawnRows: DrawnPart[] = [];
  // The link rows of both sections, in drawn order.
  let cursorRows: CursorRow[] = [];
  let cursor = 0;
  // Whether the cursor row draws the focus ring.
  let hasRing = false;
  let isInSight = false;
  const observer = new ResizeObserver(() => {
    if (root.hidden) {
      return;
    }
    const isInSightNow = root.offsetWidth > 0;
    if (isInSightNow !== isInSight) {
      isInSight = isInSightNow;
      deps.log(`right column ${isInSightNow ? 'in' : 'out of'} sight`);
      if (!isInSightNow) {
        deps.sightLost();
      }
    }
  });
  observer.observe(root);

  const markCursor = () => {
    cursorRows.forEach(({ element: rowElement }, index) => {
      const isCursor = hasRing && index === cursor;
      rowElement.classList.toggle('is-selected', isCursor);
      rowElement.classList.toggle('is-cursor', isCursor);
    });
  };

  // Puts the cursor on the row at `index`, clamped to the rows, and logs it;
  // nothing with no row.
  const moveCursorTo = (index: number) => {
    if (cursorRows.length === 0) {
      return;
    }
    cursor = Math.max(0, Math.min(index, cursorRows.length - 1));
    markCursor();
    const { row, element: rowElement } = cursorRows[cursor];
    rowElement.scrollIntoView({ block: 'nearest' });
    deps.log(`right column cursor: ${row.input.title}`);
  };

  root.addEventListener('focusin', () => {
    hasRing = true;
    markCursor();
  });

  root.addEventListener('focusout', (event) => {
    const next = (event as FocusEvent).relatedTarget;
    const isLeavingColumn = !(
      next instanceof HTMLElement && root.contains(next)
    );
    if (isLeavingColumn) {
      hasRing = false;
      markCursor();
    }
  });

  const disposeDrawn = () => {
    const drawn = [...drawnRows, drawnAside];
    drawnRows = [];
    cursorRows = [];
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
      const index = cursorRows.length;
      rowAction(drawn.element, () => {
        cursor = index;
        markCursor();
        row.action();
      });
      drawnRows.push(drawn);
      cursorRows.push({ row, element: drawn.element });
    }
  };

  const clear = () => {
    const wasShown = !root.hidden;
    disposeDrawn();
    root.hidden = true;
    isInSight = false;
    cursor = 0;
    if (wasShown) {
      deps.sightLost();
    }
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
          kind: 'section',
          action: () => deps.moveToLine(section.startLine),
        })),
      );
      drawSection(
        linkedFromSection,
        { title: LINKED_FROM_TEXT, kind: 'linkedFrom' },
        links.map((link) => ({
          input: { title: link.title, depth: 0 },
          tooltip: deps.paths.tilde(link.path, deps.homeDir),
          kind: 'linkedFrom',
          action: () => deps.followLink(link.path, link.line),
        })),
      );
      cursor = Math.min(cursor, cursorRows.length - 1);
      hasRing = root.contains(document.activeElement);
      markCursor();
      root.scrollTop = scrollTop;
    },
    clear,
    isShown: () => !root.hidden,
    isInSight: () => !root.hidden && root.offsetWidth > 0,
    focus() {
      root.focus();
      hasRing = true;
      markCursor();
      cursorRows[cursor]?.element.scrollIntoView({ block: 'nearest' });
    },
    move: (by) => moveCursorTo(cursor + by),
    top: () => moveCursorTo(0),
    bottom: () => moveCursorTo(cursorRows.length - 1),
    openCursor() {
      const held = cursorRows[cursor];
      if (held === undefined) {
        return null;
      }
      held.row.action();
      return held.row.kind;
    },
    reset() {
      root.scrollTop = 0;
      cursor = 0;
      markCursor();
    },
    dispose() {
      callEach<() => void>(
        [() => observer.disconnect(), disposeDrawn],
        (step) => step(),
      );
    },
  };
}
