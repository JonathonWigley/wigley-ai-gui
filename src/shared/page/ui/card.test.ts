import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../test-dom';
import { createCollapsibleCard } from './card';

describe('createCollapsibleCard', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function bodies(root: HTMLElement): FakeElement[] {
    return findAll(asFake(root), 'ui-collapsible-body');
  }

  function head(root: HTMLElement): FakeElement {
    return findAll(asFake(root), 'ui-collapsible-head')[0];
  }

  it.each([
    { case: 'rebuilt on each open', keepBody: false, open: false, built: 2 },
    { case: 'kept with keepBody', keepBody: true, open: false, built: 1 },
    { case: 'kept, created open', keepBody: true, open: true, built: 1 },
  ])('body lifetime: $case', ({ keepBody, open, built }) => {
    const body = vi.fn(() => asHtml(new FakeElement('div')));
    const collapsible = createCollapsibleCard({
      summary: 's',
      keepBody,
      open,
      body,
    });
    const kept = keepBody ? bodies(collapsible.element) : [];
    if (keepBody) {
      expect(body).toHaveBeenCalledTimes(1);
      expect(kept).toHaveLength(1);
      expect(kept[0].hidden).toBe(!open);
    }

    if (!open) {
      collapsible.setOpen(true);
    }
    collapsible.setOpen(false);
    expect(bodies(collapsible.element)).toEqual(kept);
    if (keepBody) {
      expect(kept[0].hidden).toBe(true);
    }
    collapsible.setOpen(true);

    expect(body).toHaveBeenCalledTimes(built);
    if (keepBody) {
      expect(bodies(collapsible.element)).toEqual(kept);
      expect(kept[0].hidden).toBe(false);
    }
  });

  it.each([
    { case: 'toggles itself', onToggle: undefined, openAfterClick: true },
    { case: 'defers to onToggle', onToggle: vi.fn(), openAfterClick: false },
  ])('head click: $case', ({ onToggle, openAfterClick }) => {
    const collapsible = createCollapsibleCard({
      summary: 's',
      onToggle,
      body: () => asHtml(new FakeElement('div')),
    });

    head(collapsible.element).click();

    expect(collapsible.isOpen()).toBe(openAfterClick);
    if (onToggle) {
      expect(onToggle).toHaveBeenCalledTimes(1);
      collapsible.setOpen(true);
      expect(collapsible.isOpen()).toBe(true);
    }
  });
});
