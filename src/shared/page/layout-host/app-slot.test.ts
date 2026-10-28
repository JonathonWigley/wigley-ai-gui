import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asHtml, FakeElement, installFakeDom } from '../test-dom';
import { appSlot } from './app-slot';

// A slot for an app `box` whose recorded destroys land in `destroys`.
function slotSetup() {
  const box = new FakeElement('div');
  const destroys: (() => void)[] = [];
  const slot = appSlot(asHtml(box), 'docPane: editor', {
    recordBox: (destroy) => destroys.push(destroy),
  });
  return { box, slot, destroys };
}

describe('appSlot', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('place_Twice_Throws', () => {
    const { slot } = slotSetup();
    slot.place(asHtml(new FakeElement('div')));

    expect(() => slot.place(asHtml(new FakeElement('div')))).toThrow(
      'docPane: editor placed twice',
    );
  });

  it.each([
    { row: 'placed by the part', placed: true, at: 'end', index: 0 },
    { row: 'left out, at the end', placed: false, at: 'end', index: 1 },
    { row: 'left out, at the start', placed: false, at: 'start', index: 0 },
  ] as const)('placeIfLeftOut: $row', ({ placed, at, index }) => {
    const { box, slot, destroys } = slotSetup();
    const root = new FakeElement('section');
    const inner = new FakeElement('div');
    root.append(inner);
    if (placed) {
      slot.place(asHtml(inner));
    }

    slot.placeIfLeftOut(asHtml(root), at);

    const holder = placed ? inner : root;
    expect(holder.children.indexOf(box)).toBe(index);
    expect(destroys).toHaveLength(1);
    destroys[0]();
    expect(box.parentNode).toBe(null);
  });
});
