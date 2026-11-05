import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorEvents, EditorHost } from '../../contracts/editor';
import { fakeFuzzyMatcher } from '../fake-fuzzy-matcher.test-support';
import { createListPicker, type ListPickerRequest } from './list-picker';
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
    picker.open({
      title: 'Target',
      items: ['b/a', 'a/b'],
      label: (item) => item,
      name: (item) => item.split('/')[0],
      chosen: () => undefined,
    });

    type('a');

    expect(picker.cursorIndex()).toBe(1);
  });
});
