import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveConnected } from './dom';
import { installMarkdownDom } from './markdown-mount.test-support';
import { asFake } from './test-dom';

describe('moveConnected', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'both are connected', parent: true, node: true, isMoved: true },
    { case: 'the parent is not connected', parent: false, node: true },
    { case: 'the node is not connected', parent: true, node: false },
  ])(
    'appends the node, through moveBefore only when $case',
    ({ parent: isParentConnected, node: isNodeConnected, isMoved = false }) => {
      const { moves } = installMarkdownDom((name, value) =>
        vi.stubGlobal(name, value),
      );
      const from = document.createElement('div');
      const to = document.createElement('div');
      const kept = document.createElement('div');
      const node = document.createElement('div');
      asFake(from).isPageRoot = isNodeConnected;
      asFake(to).isPageRoot = isParentConnected;
      to.append(kept);
      from.append(node);

      moveConnected(to, node);

      expect(asFake(to).childNodes).toEqual([asFake(kept), asFake(node)]);
      expect(moves).toEqual(
        isMoved ? [{ element: asFake(node), to: asFake(to) }] : [],
      );
    },
  );
});
