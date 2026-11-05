import { describe, expect, it } from 'vitest';
import type { HintWhere } from '../contracts/keymap';
import { createBoxFocus } from './box-focus';

const BOX_ONE = { name: 'box one' };
const BOX_TWO = { name: 'box two' };
const BUTTON = { name: 'button' };

// A document whose listeners run through `focusin` and `focusout`, each moving
// `activeElement` as the browser does; `heard` holds what `onChanged` told.
function focusSetup() {
  const listeners = new Map<string, (event: unknown) => void>();
  const page = {
    activeElement: null as object | null,
    isWindowFocused: true,
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, listener);
    },
    hasFocus: () => page.isWindowFocused,
  };
  const boxFocus = createBoxFocus(page as unknown as Document, {
    contains: (element) =>
      (element as object) === BOX_ONE || (element as object) === BOX_TWO,
  });
  const heard: HintWhere[] = [];
  boxFocus.onChanged((where) => heard.push(where));
  return {
    page,
    boxFocus,
    heard,
    focusIn(target: object) {
      page.activeElement = target;
      listeners.get('focusin')?.({ target });
    },
    focusOut(relatedTarget: object | null) {
      listeners.get('focusout')?.({ relatedTarget });
    },
  };
}

describe('createBoxFocus', () => {
  it('onChanged_PageToBoxAndBack_TellsOncePerChange', () => {
    const { focusIn, focusOut, heard } = focusSetup();

    focusIn(BUTTON);
    focusOut(BOX_ONE);
    focusIn(BOX_ONE);
    focusOut(BUTTON);
    focusIn(BUTTON);

    expect(heard).toEqual(['box', 'page']);
  });

  it('onChanged_BoxToBox_TellsNothing', () => {
    const { focusIn, focusOut, heard } = focusSetup();
    focusIn(BOX_ONE);
    heard.length = 0;

    focusOut(BOX_TWO);
    focusIn(BOX_TWO);

    expect(heard).toEqual([]);
  });

  it('where_FocusMovedWithNoEvent_ReadsTheActiveElement', () => {
    const { page, boxFocus, heard } = focusSetup();
    expect(boxFocus.where()).toBe('page');

    page.activeElement = BOX_ONE;

    expect(boxFocus.where()).toBe('box');
    expect(heard).toEqual([]);
  });

  it('onChanged_SilentMoveThenFocusoutThenFocusin_TellsBoxOnce', () => {
    const { page, focusIn, focusOut, heard } = focusSetup();

    page.activeElement = BOX_ONE;
    focusOut(BUTTON);
    focusIn(BOX_ONE);

    expect(heard).toEqual(['box']);
  });

  it('onChanged_WindowBlur_TellsNothing', () => {
    const { page, focusIn, focusOut, heard } = focusSetup();
    focusIn(BOX_ONE);
    heard.length = 0;

    page.isWindowFocused = false;
    focusOut(null);
    page.isWindowFocused = true;
    focusIn(BOX_ONE);

    expect(heard).toEqual([]);

    focusOut(null);

    expect(heard).toEqual(['page']);
  });
});
