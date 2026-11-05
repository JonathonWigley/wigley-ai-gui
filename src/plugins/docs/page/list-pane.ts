import { callEach } from '../../../shared/call-each';
import { element } from '../../../shared/page/dom';
import type { AppSlot } from '../../../shared/page/layout-host/app-slot';
import { rowAction } from '../../../shared/page/ui/row';
import type { ListPageContent } from './list-page';
import type { DocsParts, DrawnPart } from './layout/docs-parts';

export interface ListPaneDeps {
  // Where the `listPage` part draws.
  slot: HTMLElement;
  parts: DocsParts;
  openEntry(entryId: string): void;
}

// A generated list page and its row cursor, which is an entry id kept per place
// for the pane's life, so a move back shows the row the user opened.
export interface ListPane {
  // Draws `content`, at its place's cursor when `content` still holds that
  // entry, else at the first row, and scrolls the cursor into sight.
  show(content: ListPageContent): void;
  // Removes what it drew, and keeps the cursors.
  clear(): void;
  // True between `show` and `clear`.
  isShown(): boolean;
  // Steps the cursor through every row in group order, stopping at both ends.
  move(by: 1 | -1): void;
  openCursor(): void;
  // Whether the page holds focus: the cursor's row shows `is-cursor` while so.
  setFocused(isFocused: boolean): void;
  // Draws the shown content again.
  redraw(): void;
  dispose(): void;
}

interface DrawnRow {
  entryId: string;
  part: DrawnPart;
}

export function createListPane(deps: ListPaneDeps): ListPane {
  const { parts } = deps;
  const cursors = new Map<string, string>();
  let shown: ListPageContent | null = null;
  let drawnPage: DrawnPart | null = null;
  let rows: DrawnRow[] = [];
  let hasFocus = false;

  const disposeDrawn = () => {
    const drawn = [...rows.map((row) => row.part), drawnPage];
    rows = [];
    drawnPage = null;
    shown = null;
    callEach(drawn, (part) => part?.dispose());
  };

  const cursorOf = (content: ListPageContent | null) =>
    content === null ? null : (cursors.get(content.place) ?? null);

  const markCursor = () => {
    const cursor = cursorOf(shown);
    for (const { entryId, part } of rows) {
      const isCursor = entryId === cursor;
      part.element.classList.toggle('is-selected', isCursor);
      part.element.classList.toggle('is-cursor', isCursor && hasFocus);
    }
  };

  const scrollToCursor = () => {
    const cursor = cursorOf(shown);
    rows
      .find((row) => row.entryId === cursor)
      ?.part.element.scrollIntoView({ block: 'nearest' });
  };

  const setCursor = (content: ListPageContent, entryId: string | null) => {
    if (entryId === null) {
      cursors.delete(content.place);
    } else {
      cursors.set(content.place, entryId);
    }
  };

  const drawRows = (content: ListPageContent, lists: HTMLElement[]) => {
    content.input.groups.forEach((group, groupIndex) => {
      group.rows.forEach((row, rowIndex) => {
        const entryId = content.entryIds[groupIndex][rowIndex];
        const part = parts.draw(
          'listRow',
          lists[groupIndex],
          row,
          (kit) => kit,
        );
        rowAction(part.element, () => {
          setCursor(content, entryId);
          markCursor();
          deps.openEntry(entryId);
        });
        rows.push({ entryId, part });
      });
    });
  };

  const pane: ListPane = {
    show(content) {
      disposeDrawn();
      shown = content;
      const lists = content.input.groups.map(() =>
        element('ol', 'docs-list-rows'),
      );
      let placing: AppSlot[] = [];
      drawnPage = parts.draw(
        'listPage',
        deps.slot,
        content.input,
        (kit, slotFor) => {
          const slots = lists.map((list, index) =>
            slotFor(list, `rows ${index}`),
          );
          placing = slots;
          return {
            ...kit,
            rows: (parent, groupIndex) => slots[groupIndex].place(parent),
          };
        },
      );
      for (const slot of placing) {
        slot.placeIfLeftOut(drawnPage.element);
      }
      drawRows(content, lists);
      const remembered = cursorOf(content);
      const isHeld = rows.some((row) => row.entryId === remembered);
      setCursor(content, isHeld ? remembered : (rows.at(0)?.entryId ?? null));
      markCursor();
      scrollToCursor();
    },
    clear: disposeDrawn,
    isShown: () => shown !== null,
    move(by) {
      if (shown === null) {
        return;
      }
      const cursor = cursorOf(shown);
      const index = rows.findIndex((row) => row.entryId === cursor);
      const next = rows.at(Math.max(0, Math.min(rows.length - 1, index + by)));
      if (next !== undefined) {
        setCursor(shown, next.entryId);
        markCursor();
        scrollToCursor();
      }
    },
    openCursor() {
      const cursor = cursorOf(shown);
      if (cursor !== null) {
        deps.openEntry(cursor);
      }
    },
    setFocused(isFocused) {
      hasFocus = isFocused;
      markCursor();
    },
    redraw() {
      if (shown !== null) {
        pane.show(shown);
      }
    },
    dispose: disposeDrawn,
  };
  return pane;
}
