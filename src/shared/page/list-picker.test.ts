import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorEvents, EditorHost } from '../../contracts/editor';
import type { ListPickerRequest } from '../../contracts/list-picker';
import { fakeFuzzyMatcher } from '../fake-fuzzy-matcher.test-support';
import { createListPicker } from './list-picker';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from './test-dom';

const ITEMS = ['one', 'two', 'three'];

function pickerSetup() {
  const picker = createListPicker({
    pushScope: () => ({
      pop: () => undefined,
      dispose: () => undefined,
      onBaseChanged: () => ({ dispose: () => undefined }),
    }),
    log: vi.fn(),
    matcher: fakeFuzzyMatcher,
  });
  return { picker, layer: asFake(picker.element) };
}

// A picker over a filter editor whose `type` sets the filter text as typing
// it would.
function filteredPickerSetup() {
  let events: EditorEvents | null = null;
  const filterEditor = {
    create: (_parent: HTMLElement, _doc: string, heard: EditorEvents) => {
      events = heard;
      return {
        text: () => '',
        setText: () => undefined,
        focus: () => undefined,
        blur: () => undefined,
        destroy: () => undefined,
      };
    },
  } as unknown as EditorHost;
  const picker = createListPicker({
    pushScope: () => ({
      pop: () => undefined,
      dispose: () => undefined,
      onBaseChanged: () => ({ dispose: () => undefined }),
    }),
    log: vi.fn(),
    matcher: fakeFuzzyMatcher,
    filterEditor,
  });
  return {
    picker,
    layer: asFake(picker.element),
    type: (text: string) => events?.changed(text),
  };
}

// A `drawRow` drawing each item as `li.owned-row` holding its label, and its
// trailing unless `leavesTrailingOut`. Each draw is named `<item>#<n>` for the
// n-th draw made; `made` lists every draw and `disposed` each dispose. The
// dispose removes the row when `disposeRemoves`, as a layout host draw's does.
function owningRows(
  options: { leavesTrailingOut?: boolean; disposeRemoves?: boolean } = {},
) {
  const made: string[] = [];
  const disposed: string[] = [];
  const drawRow: ListPickerRequest<string>['drawRow'] = (
    parent,
    item,
    input,
  ) => {
    const owned = new FakeElement('li');
    owned.className = 'owned-row';
    owned.append(input.label);
    if (input.trailing !== null && options.leavesTrailingOut !== true) {
      owned.append(asFake(input.trailing));
    }
    parent.append(asHtml(owned));
    const name = `${item}#${made.length + 1}`;
    made.push(name);
    const dispose = () => {
      disposed.push(name);
      if (options.disposeRemoves === true) {
        owned.remove();
      }
    };
    return { element: asHtml(owned), dispose };
  };
  return { drawRow, made, disposed };
}

function request(
  extra: Partial<ListPickerRequest<string>> = {},
): ListPickerRequest<string> {
  return {
    title: 'Pick',
    items: ITEMS,
    label: (item) => item,
    chosen: vi.fn(),
    ...extra,
  };
}

function head(layer: FakeElement): FakeElement {
  return findAll(layer, 'ui-picker-head')[0];
}

function rows(layer: FakeElement): FakeElement[] {
  return findAll(layer, 'ui-row');
}

// A request with one item, named `item<n>`, per entry of `sections`.
function sectionedRequest(
  sections: readonly (string | null)[],
  extra: Partial<ListPickerRequest<string>> = {},
): ListPickerRequest<string> {
  const items = sections.map((_section, index) => `item${index}`);
  return request({
    items,
    section: (item) => sections[items.indexOf(item)],
    ...extra,
  });
}

// A list child's text, a heading as `# <title>`.
function drawnName(child: FakeElement): string {
  return child.classList.contains('ui-picker-heading')
    ? `# ${child.textContent}`
    : child.textContent;
}

// The list's children top to bottom.
function drawnOrder(layer: FakeElement): string[] {
  return findAll(layer, 'ui-picker-list')[0].children.map(drawnName);
}

describe('list picker', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('open_HeaderEnd_DrawsAtTheTitleLineEnd', () => {
    const { picker, layer } = pickerSetup();
    const end = new FakeElement('span');

    picker.open(request({ headerEnd: asHtml(end) }));

    const [, last] = head(layer).children;
    expect(head(layer).children).toHaveLength(2);
    expect(last).toBe(end);
  });

  it('open_NextRequestWithoutHeaderEnd_RemovesTheEarlierOne', () => {
    const { picker, layer } = pickerSetup();
    picker.open(request({ headerEnd: asHtml(new FakeElement('span')) }));

    picker.open(request());

    const children = head(layer).children;
    expect(children).toHaveLength(1);
  });

  it('draw_CursorEnd_SitsInTheCursorRowOnly', () => {
    const { picker, layer } = pickerSetup();
    const end = new FakeElement('span');

    picker.open(request({ cursorEnd: () => asHtml(end) }));
    expect(findAll(rows(layer)[0], 'ui-row-trailing')[0].children).toEqual([
      end,
    ]);

    picker.down();
    const [first, second] = rows(layer);
    expect(findAll(second, 'ui-row-trailing')[0].children).toEqual([end]);
    expect(findAll(first, 'ui-row-trailing')).toHaveLength(0);
  });

  it('draw_CursorEndNull_DrawsNoTrailing', () => {
    const { picker, layer } = pickerSetup();

    picker.open(request({ cursorEnd: () => null }));

    expect(findAll(rows(layer)[0], 'ui-row-trailing')).toHaveLength(0);
  });

  it('drawRow_DrawsEachVisibleItemAndKeepsCursorAndClick', () => {
    const { picker, layer } = pickerSetup();
    const end = new FakeElement('span');
    const chosen = vi.fn();
    const { drawRow } = owningRows();

    picker.open(
      request({ drawRow, cursorEnd: () => asHtml(end), selected: 1, chosen }),
    );

    const drawn = findAll(layer, 'owned-row');
    expect(rows(layer)).toEqual([]);
    expect(drawn.map((row) => row.textContent)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(drawn.map((row) => row.classList.contains('is-cursor'))).toEqual([
      false,
      true,
      false,
    ]);
    expect(drawn[1].childNodes.at(-1)).toBe(end);
    expect(
      drawn.map((row) => row.classList.contains('ui-row--action')),
    ).toEqual([true, true, true]);
    expect(drawn[0].fire('mousedown').defaultPrevented).toBe(true);
    drawn[0].classList.add('is-disabled');
    drawn[0].click();
    expect(chosen).not.toHaveBeenCalled();
    drawn[2].click();
    expect(chosen).toHaveBeenCalledWith('three');
  });

  it('drawRow_TrailingLeftOut_AppendedToTheRow', () => {
    const { picker, layer } = pickerSetup();
    const end = new FakeElement('span');
    const { drawRow } = owningRows({ leavesTrailingOut: true });

    picker.open(request({ drawRow, cursorEnd: () => asHtml(end) }));

    const [first, second] = findAll(layer, 'owned-row');
    expect(first.childNodes.at(-1)).toBe(end);
    expect(second.children).toEqual([]);
  });

  it('drawRow_CursorReachesTheLastRow_RowRemovedOnDisposeStaysLast', () => {
    const { picker, layer } = pickerSetup();
    const { drawRow } = owningRows({ disposeRemoves: true });
    picker.open(request({ drawRow, selected: 1 }));

    picker.down();

    const drawn = findAll(layer, 'owned-row');
    expect(drawn.map((row) => row.textContent)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(drawn[2].classList.contains('is-cursor')).toBe(true);
  });

  it.each([{ disposeRemoves: false }, { disposeRemoves: true }])(
    'drawRow_RowDraws_DisposedBeforeTheyDrawAgainInPlaceAndOnClose: disposeRemoves $disposeRemoves',
    ({ disposeRemoves }) => {
      const { picker, layer, type } = filteredPickerSetup();
      const { drawRow, made, disposed } = owningRows({ disposeRemoves });
      picker.open(request({ drawRow }));
      expect(disposed).toEqual([]);

      picker.down();
      expect(disposed).toEqual(['one#1', 'two#2']);
      expect(made.slice(3)).toEqual(['one#4', 'two#5']);
      const drawn = findAll(layer, 'owned-row');
      expect(drawn.map((row) => row.textContent)).toEqual([
        'one',
        'two',
        'three',
      ]);
      expect(drawn.map((row) => row.classList.contains('is-cursor'))).toEqual([
        false,
        true,
        false,
      ]);

      type('t');
      expect(disposed.slice(2).sort()).toEqual(['one#4', 'three#3', 'two#5']);
      expect(made.slice(5)).toEqual(['two#6', 'three#7']);

      picker.redraw();
      expect(disposed.slice(5)).toEqual(['two#6', 'three#7']);

      picker.close();
      picker.redraw();
      expect(disposed.slice(7)).toEqual(['two#8', 'three#9']);
      expect(made).toHaveLength(9);
    },
  );

  it('open_Name_FilterRanksItAheadOfLabels', () => {
    const { picker, type } = filteredPickerSetup();
    const chosen = vi.fn();
    picker.open({
      title: 'Target',
      items: ['b/a', 'a/b'],
      label: (item) => item,
      name: (item) => item.split('/')[0],
      chosen,
    });

    type('a');

    expect(picker.cursorIndex()).toBe(1);
    picker.choose();
    expect(chosen).toHaveBeenCalledWith('a/b');
  });

  it('open_Sections_DrawsHeadingsAtEachEdge', () => {
    const { picker, layer } = pickerSetup();
    const chosen = vi.fn();

    picker.open(sectionedRequest(['A', 'A', 'B'], { chosen }));

    expect(drawnOrder(layer)).toEqual([
      '# A',
      'item0',
      'item1',
      '# B',
      'item2',
    ]);
    const [heading] = findAll(layer, 'ui-picker-heading');
    expect(heading.tagName.toLowerCase()).toBe('li');
    expect(heading.fire('mousedown').defaultPrevented).toBe(true);
    heading.click();
    expect(chosen).not.toHaveBeenCalled();
    expect(picker.isOpen()).toBe(true);
  });

  it('down_OverAHeading_MovesToNextItem', () => {
    const { picker, layer } = pickerSetup();
    picker.open(sectionedRequest(['A', 'A', 'B'], { selected: 1 }));

    picker.down();

    expect(picker.cursorIndex()).toBe(2);
    expect(drawnOrder(layer)).toEqual([
      '# A',
      'item0',
      'item1',
      '# B',
      'item2',
    ]);
    expect(findAll(layer, 'is-cursor').map((row) => row.textContent)).toEqual([
      'item2',
    ]);

    picker.up();

    expect(picker.cursorIndex()).toBe(1);
    expect(drawnOrder(layer)).toEqual([
      '# A',
      'item0',
      'item1',
      '# B',
      'item2',
    ]);
  });

  it.each([
    {
      name: "up to a section's first row",
      sections: ['A', 'A', 'B'],
      selected: 1,
      move: 'up',
      scrolled: ['# A', 'item0'],
    },
    {
      name: "down to a later section's first row",
      sections: ['A', 'A', 'B'],
      selected: 1,
      move: 'down',
      scrolled: ['# B', 'item2'],
    },
    {
      name: 'within a section',
      sections: ['A', 'A', 'B'],
      selected: 0,
      move: 'down',
      scrolled: ['item1'],
    },
    {
      name: 'no headings',
      sections: [null, null, null],
      selected: 0,
      move: 'down',
      scrolled: ['item1'],
    },
  ] as const)(
    'move_ScrollsTheCursorRowLast: $name',
    ({ sections, selected, move, scrolled }) => {
      const { picker } = pickerSetup();
      picker.open(sectionedRequest(sections, { selected }));
      const scrolling = vi.spyOn(FakeElement.prototype, 'scrollIntoView');

      picker[move]();

      expect(
        scrolling.mock.contexts.map((child) => drawnName(child as FakeElement)),
      ).toEqual(scrolled);
      scrolling.mockRestore();
    },
  );

  it('filter_Typed_HidesHeadings', () => {
    const { picker, layer, type } = filteredPickerSetup();
    const whole = ['# A', 'item0', '# B', 'item1'];
    picker.open(sectionedRequest(['A', 'B']));

    type('item');
    expect(findAll(layer, 'ui-picker-heading')).toEqual([]);
    expect(rows(layer)).toHaveLength(2);

    type(' ');
    expect(drawnOrder(layer)).toEqual(whole);

    type('item');
    type('');
    expect(drawnOrder(layer)).toEqual(whole);
  });

  it.each([
    {
      sections: [null, null],
      expected: ['item0', 'item1'],
    },
    {
      sections: ['A', null, 'A'],
      expected: ['# A', 'item0', 'item1', '# A', 'item2'],
    },
  ])(
    'open_NullSections_DrawsNoHeadings: $sections',
    ({ sections, expected }) => {
      const { picker, layer } = pickerSetup();

      picker.open(sectionedRequest(sections));

      expect(drawnOrder(layer)).toEqual(expected);
    },
  );

  it('redraw_DrawnHeading_DisposesItsDraw', () => {
    const { picker, layer } = pickerSetup();
    const made: string[] = [];
    const disposed: string[] = [];
    const drawHeading: ListPickerRequest<string>['drawHeading'] = (
      parent,
      title,
    ) => {
      const owned = new FakeElement('span');
      owned.append(title);
      parent.append(asHtml(owned));
      const name = `${title}#${made.length + 1}`;
      made.push(name);
      return { element: asHtml(owned), dispose: () => disposed.push(name) };
    };
    picker.open(sectionedRequest(['A', 'B'], { drawHeading }));
    expect(drawnOrder(layer)).toEqual(['# A', 'item0', '# B', 'item1']);

    picker.down();
    expect(made).toEqual(['A#1', 'B#2']);
    expect(disposed).toEqual([]);

    picker.redraw();
    expect(disposed).toEqual(['A#1', 'B#2']);
    expect(made.slice(2)).toEqual(['A#3', 'B#4']);

    picker.close();
    expect(disposed.slice(2)).toEqual(['A#3', 'B#4']);
    expect(made).toHaveLength(4);
  });
});
