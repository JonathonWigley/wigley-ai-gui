import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  asHtml,
  type FakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { fakeDocsParts } from './docs-page-fakes';
import type { ListPageContent } from './list-page';
import { createListPane } from './list-pane';

const ROW = 'test-list-row';

const plainRows: Layout = {
  listRow(parent, input, kit) {
    return { element: kit.el(parent, 'li', ROW, input.title) };
  },
};

// `groups`' strings are both each row's title and its entry id.
function content(place: string, groups: string[][]): ListPageContent {
  return {
    place,
    input: {
      title: 'List',
      count: groups.flat().length,
      groups: groups.map((rows, index) => ({
        title: `Group ${index}`,
        rows: rows.map((title) => ({ title, path: `~/${title}`, time: null })),
      })),
    },
    entryIds: groups,
  };
}

const THREE_ROWS = content('wiki:kind/skill', [['a', 'b'], ['c']]);

function setUp() {
  const slot = asHtml(document.createElement('div') as unknown as FakeElement);
  const { parts } = fakeDocsParts(() => withUser(defaultLayout, plainRows));
  const openEntry = vi.fn();
  const pane = createListPane({ slot, parts, openEntry });
  const rows = () => findAll(asFake(slot), ROW);
  const cursor = () =>
    rows()
      .filter((row) => row.classList.contains('is-selected'))
      .map((row) => row.textContent);
  return { slot, pane, openEntry, rows, cursor };
}

describe('createListPane', () => {
  beforeEach(() =>
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('show_TwoGroups_DrawsEachGroupsRowsInItsList', () => {
    const { slot, pane, cursor } = setUp();

    pane.show(THREE_ROWS);

    const lists = findAll(asFake(slot), 'docs-list-rows');
    expect({
      lists: lists.map((list) => list.children.map((row) => row.textContent)),
      tags: lists.map((list) => list.tagName),
      cursor: cursor(),
    }).toEqual({
      lists: [['a', 'b'], ['c']],
      tags: ['OL', 'OL'],
      cursor: ['a'],
    });
  });

  it('dispose_OneRowThrows_DisposesTheOtherParts', () => {
    const { parts } = fakeDocsParts(() => withUser(defaultLayout, plainRows));
    const disposed: string[] = [];
    const draw = parts.draw.bind(parts);
    let throwsNext = true;
    vi.spyOn(parts, 'draw').mockImplementation((part, ...rest) => {
      const drawn = draw(part, ...rest);
      return {
        ...drawn,
        dispose() {
          drawn.dispose();
          if (throwsNext) {
            throwsNext = false;
            throw new Error('row gone');
          }
          disposed.push(part);
        },
      };
    });
    const slot = asHtml(
      document.createElement('div') as unknown as FakeElement,
    );
    const pane = createListPane({ slot, parts, openEntry: vi.fn() });
    pane.show(THREE_ROWS);

    expect(() => pane.dispose()).toThrow('row gone');

    expect(disposed).toEqual(['listRow', 'listRow', 'listPage']);
  });

  it.each<{ name: string; moves: (1 | -1)[]; expected: string }>([
    { name: 'up at the first stays', moves: [-1], expected: 'a' },
    { name: 'down twice crosses the group', moves: [1, 1], expected: 'c' },
    { name: 'down at the last stays', moves: [1, 1, 1], expected: 'c' },
  ])('move_ClampsAtBothEnds $name', ({ moves, expected }) => {
    const { pane, cursor } = setUp();
    pane.show(THREE_ROWS);

    moves.forEach((by) => pane.move(by));

    expect(cursor()).toEqual([expected]);
  });

  it.each([
    { edge: 'top' as const, expected: 'a' },
    { edge: 'end' as const, expected: 'c' },
  ])('moveToEdge_$edge_PutsTheCursorOnThatRow', ({ edge, expected }) => {
    const { pane, cursor } = setUp();
    pane.show(THREE_ROWS);
    pane.move(1);

    pane.moveToEdge(edge);

    expect(cursor()).toEqual([expected]);
  });

  it.each([
    {
      name: 'same place, same rows',
      next: content('p', [['a', 'b']]),
      leaves: false,
      expected: 'b',
    },
    {
      name: "same place, the cursor's entry gone",
      next: content('p', [['a', 'c']]),
      leaves: false,
      expected: 'a',
    },
    {
      name: 'another place, then back after a clear',
      next: content('p', [['a', 'b']]),
      leaves: true,
      expected: 'b',
    },
  ])('show_Cursor $name', ({ next, leaves, expected }) => {
    const { pane, cursor } = setUp();
    pane.show(content('p', [['a', 'b']]));
    pane.move(1);

    if (leaves) {
      pane.clear();
      pane.show(content('other', [['x', 'y']]));
      pane.clear();
    }
    pane.show(next);

    expect(cursor()).toEqual([expected]);
  });

  it('openCursor_CallsOpenEntryWithTheCursor', () => {
    const { pane, openEntry } = setUp();
    pane.show(THREE_ROWS);
    pane.move(1);

    pane.openCursor();

    expect(openEntry.mock.calls).toEqual([['b']]);
  });

  it('click_SetsTheCursorAndOpens', () => {
    const { pane, openEntry, rows, cursor } = setUp();
    pane.show(THREE_ROWS);

    rows()[2].click();

    expect({ opened: openEntry.mock.calls, cursor: cursor() }).toEqual({
      opened: [['c']],
      cursor: ['c'],
    });
  });

  it('setFocused_TogglesIsCursorOnTheCursorRow', () => {
    const { pane, rows } = setUp();
    pane.show(THREE_ROWS);
    const cursorRows = () =>
      rows()
        .filter((row) => row.classList.contains('is-cursor'))
        .map((row) => row.textContent);

    const before = cursorRows();
    pane.setFocused(true);
    const focused = cursorRows();
    pane.setFocused(false);

    expect([before, focused, cursorRows()]).toEqual([[], ['a'], []]);
  });
});
