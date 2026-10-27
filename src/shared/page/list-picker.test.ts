import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
});
