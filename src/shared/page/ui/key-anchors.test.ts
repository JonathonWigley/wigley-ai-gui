import { describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../../contracts/disposable';
import { disposeAnchors, recordingAnchor } from './key-anchors';

const NODE = {} as HTMLElement;

describe('recordingAnchor', () => {
  it('recordingAnchor_NamesAnchor_PassesItOnAndKeepsIt', () => {
    const named: Disposable = { dispose: () => undefined };
    const anchor = vi.fn(() => named);
    const anchors: Disposable[] = [];

    const returned = recordingAnchor(anchor, anchors)(NODE, 'a.trash', {
      scope: 'a.s',
    });

    expect(anchor).toHaveBeenCalledWith(NODE, 'a.trash', { scope: 'a.s' });
    expect(returned).toBe(named);
    expect(anchors).toEqual([named]);
  });
});

describe('disposeAnchors', () => {
  it('disposeAnchors_DisposesEachAndEmptiesTheList', () => {
    const first = { dispose: vi.fn() };
    const second = { dispose: vi.fn() };
    const anchors: Disposable[] = [first, second];

    disposeAnchors(anchors);

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(anchors).toEqual([]);
  });
});
