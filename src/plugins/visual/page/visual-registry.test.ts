import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { createVisualRegistry } from './visual-registry';

type Host = 'A' | 'B' | 'C';

// An `ol` with two `li` slots: hosts A then B in slot 1, beside an
// unregistered host (an open card), and C in slot 2.
function transcript() {
  const host = () => {
    const node = new FakeElement('div');
    node.className = 'visual-host';
    return node;
  };
  const hosts: Record<Host, FakeElement> = { A: host(), B: host(), C: host() };
  const slot1 = new FakeElement('li');
  slot1.append(hosts.A, host(), hosts.B);
  const slot2 = new FakeElement('li');
  slot2.append(hosts.C);
  const list = new FakeElement('ol');
  list.append(slot1, slot2);
  return { hosts, roots: { 'slot 1': slot1, 'slot 2': slot2, ol: list } };
}

describe('createVisualRegistry', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'document order inside one slot',
      registered: ['B', 'A'],
      disposed: [],
      root: 'slot 1',
      expected: ['a', 'b'],
      held: ['A', 'B'],
    },
    {
      name: 'another slot left out',
      registered: ['A', 'B', 'C'],
      disposed: [],
      root: 'slot 2',
      expected: ['c'],
      held: ['A', 'B', 'C'],
    },
    {
      name: 'disposed left out',
      registered: ['A', 'B'],
      disposed: ['A'],
      root: 'slot 1',
      expected: ['b'],
      held: ['B'],
    },
    {
      name: 'whole list',
      registered: ['A', 'B', 'C'],
      disposed: [],
      root: 'ol',
      expected: ['a', 'b', 'c'],
      held: ['A', 'B', 'C'],
    },
  ] as const)(
    'sourcesIn_Roots_ListsClosedVisualsInDocumentOrder $name',
    ({ registered, disposed, root, expected, held }) => {
      const { hosts, roots } = transcript();
      const registry = createVisualRegistry();
      const added = new Map(
        registered.map((name) => [
          name,
          registry.add(asHtml(hosts[name]), name.toLowerCase()),
        ]),
      );
      for (const name of disposed) {
        added.get(name)?.dispose();
      }

      expect(registry.sourcesIn(asHtml(roots[root]))).toEqual(expected);
      const names = Object.keys(hosts) as Host[];
      const heldNames = registry
        .hosts()
        .map((host) => names.find((name) => asHtml(hosts[name]) === host));
      expect(heldNames.sort()).toEqual(held);
    },
  );
});
