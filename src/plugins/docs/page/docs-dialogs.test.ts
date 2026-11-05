import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import type { ShownLayouts } from '../../../contracts/plugin';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  USER_LAYOUT,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  type FocusFakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { createDocsDialogs, type DocsDialogsDeps } from './docs-dialogs';
import { fakeDocsParts, fakePushedScope } from './docs-page-fakes';

// A layout whose picker rows and box body are marked `marker`.
function markedLayout(marker: string): Layout {
  return {
    pickerRow(parent, input, kit) {
      const row = kit.row(parent, {
        density: 'list',
        tag: 'li',
        label: input.label,
      });
      row.classList.add(marker);
      return { element: row };
    },
    boxDialog(parent, _input, kit) {
      const body = kit.el(parent, 'div', marker);
      kit.textBox(body);
      kit.completions(body);
      return { element: body };
    },
  };
}

// The docs dialogs over a channel listing no folder, drawing with the
// layouts `layouts` returns.
function dialogsOver(layouts: () => ShownLayouts<Layout>) {
  const { parts } = fakeDocsParts(layouts);
  const deps = {
    channel: { invoke: async () => [] },
    homeDir: '/home',
    paths: posixPaths,
    toast: () => undefined,
    log: () => undefined,
    matcher: fakeFuzzyMatcher,
    parts,
    pushScope: fakePushedScope,
    entries: () => [],
    changed: () => undefined,
    openInEditor: async () => undefined,
    dialogClosed: () => undefined,
  } as unknown as DocsDialogsDeps;
  return createDocsDialogs(deps);
}

describe('createDocsDialogs', () => {
  beforeEach(() =>
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createByKind_PickerRows_DrawThroughPickerRowAndRedrawOnAReload', () => {
    let shown = withUser(defaultLayout, markedLayout('row-1'));
    const dialogs = dialogsOver(() => shown);
    dialogs.createByKind();
    const list = asFake(dialogs.picker.element);
    const before = findAll(list, 'ui-row').map((row) => ({
      layout: row.dataset.layout,
      isMarked: row.classList.contains('row-1'),
    }));

    shown = withUser(defaultLayout, markedLayout('row-2'));
    dialogs.redraw();

    expect(before.length).toBeGreaterThan(0);
    expect(before).toEqual(
      before.map(() => ({ layout: USER_LAYOUT, isMarked: true })),
    );
    expect(findAll(list, 'row-1')).toEqual([]);
    expect(findAll(list, 'row-2')).toHaveLength(before.length);
    expect(dialogs.picker.isOpen()).toBe(true);
  });

  it('redraw_BoxOpenWithText_KeepsTheInputItsTextAndFocus', () => {
    let shown = withUser(defaultLayout, markedLayout('box-1'));
    const dialogs = dialogsOver(() => shown);
    dialogs.createByPath(null);
    const box = asFake(dialogs.elements[1]);
    const input = findAll(box, 'docs-box')[0] as FocusFakeElement;
    input.value = 'notes';

    shown = withUser(defaultLayout, markedLayout('box-2'));
    dialogs.redraw();

    expect(findAll(box, 'box-2')).toHaveLength(1);
    expect(findAll(box, 'box-1')).toEqual([]);
    expect(findAll(box, 'docs-box')[0]).toBe(input);
    expect(input.value).toBe('notes');
    expect(document.activeElement).toBe(input);
  });
});
