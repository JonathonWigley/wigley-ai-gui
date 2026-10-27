import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorEvents, EditorHost } from '../../contracts/editor';
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
    pushScope: () => ({ pop: () => undefined, onBaseChanged: () => undefined }),
    log: vi.fn(),
    logSource: 'test',
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
    pushScope: () => ({ pop: () => undefined, onBaseChanged: () => undefined }),
    log: vi.fn(),
    logSource: 'test',
    filterEditor,
  });
  return {
    picker,
    layer: asFake(picker.element),
    type: (text: string) => events?.changed(text),
  };
}

// A `drawRow` drawing each item as `li.owned-row` holding its label and
// trailing, recording one anchor per row, named `<item>#<n>` for the n-th
// anchor made; `made` lists every anchor made and `disposed` each dispose.
function owningRows() {
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
    if (input.trailing !== null) {
      owned.append(asFake(input.trailing));
    }
    parent.append(asHtml(owned));
    const name = `${item}#${made.length + 1}`;
    made.push(name);
    input.recordAnchor({ dispose: () => disposed.push(name) });
    return asHtml(owned);
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
    drawn[2].click();
    expect(chosen).toHaveBeenCalledWith('three');
  });

  it('drawRow_AnchorsRecordedInARowDraw_DisposedOnNextDrawAndOnClose', () => {
    const { picker, type } = filteredPickerSetup();
    const { drawRow, made, disposed } = owningRows();
    picker.open(request({ drawRow }));
    expect(disposed).toEqual([]);

    type('t');
    expect(disposed).toEqual(['one#1', 'two#2', 'three#3']);
    expect(made.slice(3)).toEqual(['two#4', 'three#5']);

    picker.redraw();
    expect(disposed.slice(3)).toEqual(['two#4', 'three#5']);

    picker.close();
    picker.redraw();
    expect(disposed.slice(5)).toEqual(['two#6', 'three#7']);
    expect(made).toHaveLength(7);
  });
});
