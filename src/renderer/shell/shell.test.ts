import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asHtml,
  FakeElement,
  installFakeDom,
  installFocusFakeDom,
  ScrollerFakeElement,
} from '../../shared/page/test-dom';
import {
  comparePlacements,
  insertionIndex,
  mountShell,
  nextInTrack,
  type Placement,
  placementOf,
} from './shell';
import { defaultShellLayout } from './shell-layout';

function sequencesSorted(placements: Placement[]): number[] {
  return [...placements]
    .sort(comparePlacements)
    .map((placement) => placement.sequence);
}

describe('placements', () => {
  it('placementOf fills align start and order 0', () => {
    expect(placementOf(undefined, 3)).toEqual({
      align: 'start',
      order: 0,
      sequence: 3,
    });
    expect(placementOf({ align: 'end' }, 1)).toEqual({
      align: 'end',
      order: 0,
      sequence: 1,
    });
  });

  it('comparePlacements puts start before center before end, whatever their order', () => {
    expect(
      sequencesSorted([
        { align: 'end', order: -5, sequence: 0 },
        { align: 'center', order: 0, sequence: 1 },
        { align: 'start', order: 9, sequence: 2 },
      ]),
    ).toEqual([2, 1, 0]);
  });

  it('comparePlacements orders one group by order, then by sequence', () => {
    expect(
      sequencesSorted([
        { align: 'start', order: 2, sequence: 0 },
        { align: 'start', order: -1, sequence: 1 },
        { align: 'start', order: 0, sequence: 2 },
        { align: 'start', order: 0, sequence: 3 },
      ]),
    ).toEqual([1, 2, 3, 0]);
  });
});

describe('insertionIndex', () => {
  const sorted = [
    { placement: { align: 'start', order: 0, sequence: 0 } },
    { placement: { align: 'start', order: 5, sequence: 1 } },
    { placement: { align: 'end', order: 0, sequence: 2 } },
  ] satisfies { placement: Placement }[];

  it('puts a placement before the first entry that sorts after it', () => {
    expect(
      insertionIndex(sorted, { align: 'start', order: 1, sequence: 3 }),
    ).toBe(1);
    expect(
      insertionIndex(sorted, { align: 'center', order: 9, sequence: 3 }),
    ).toBe(2);
  });

  it('puts a placement after equal ones made before it', () => {
    expect(
      insertionIndex(sorted, { align: 'start', order: 5, sequence: 3 }),
    ).toBe(2);
  });

  it('puts a placement nothing sorts after at the end', () => {
    expect(
      insertionIndex(sorted, { align: 'end', order: 0, sequence: 3 }),
    ).toBe(3);
    expect(insertionIndex([], { align: 'start', order: 0, sequence: 0 })).toBe(
      0,
    );
  });
});

describe('nextInTrack', () => {
  const sorted = [
    { placement: { align: 'start', order: 0, sequence: 0 } },
    { placement: { align: 'center', order: 0, sequence: 1 } },
    { placement: { align: 'end', order: 0, sequence: 2 } },
  ] satisfies { placement: Placement }[];
  const startOrEnd = (align: string) => align === 'start' || align === 'end';

  it('skips entries in other tracks to the next one in this track', () => {
    expect(nextInTrack(sorted, 1, startOrEnd)).toBe(sorted[2]);
  });

  it('returns the entry at index when it is in this track', () => {
    expect(nextInTrack(sorted, 0, startOrEnd)).toBe(sorted[0]);
  });

  it('returns undefined when no later entry is in this track', () => {
    expect(nextInTrack(sorted, 1, (align) => align === 'start')).toBe(
      undefined,
    );
    expect(nextInTrack(sorted, 3, startOrEnd)).toBe(undefined);
  });
});

describe('mountShell', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The `data-layout` and `data-layout-owner` of the four chrome areas
  // mounted in `root`.
  function chromeLayouts(root: FakeElement): string[][] {
    const classes = [
      'shell-title-bar',
      'shell-activity-bar',
      'shell-side-bar',
      'shell-status-bar',
    ];
    return classes.map((className) => {
      const area = root.querySelector(`.${className}`);
      return [area?.dataset.layout ?? '', area?.dataset.layoutOwner ?? ''];
    });
  }

  it('mountShell_SetLayoutThenDispose_KeepsChromeLayoutName', () => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeElement(tag),
      documentElement: { style: { setProperty: () => undefined } },
    });
    const root = new FakeElement('div');
    const shell = mountShell(asHtml(root), defaultShellLayout);
    shell.setChromeLayout('mine');
    const mine = Array(4).fill(['mine', 'shell']);

    const swap = shell.setLayout(defaultShellLayout);
    const swapped = chromeLayouts(root);
    swap.dispose();

    expect(swapped).toEqual(mine);
    expect(chromeLayouts(root)).toEqual(mine);
  });

  // Gives `area` a client height of 300 and a scroll range of `range`
  // pixels, clamping its scrollTop to the range as a browser does.
  function withScrollRange(area: HTMLElement, range: number): void {
    let top = 0;
    Object.defineProperties(area, {
      clientHeight: { value: 300 },
      scrollHeight: { value: 300 + range },
      scrollTop: {
        get: () => top,
        set: (next: number) => {
          top = Math.min(Math.max(next, 0), range);
        },
      },
    });
  }

  // The default layout with the side bar and main scrolling over the given
  // ranges.
  function rangedLayout(ranges: { sideBar: number; main: number }) {
    return {
      mount(root: HTMLElement) {
        const areas = defaultShellLayout.mount(root);
        withScrollRange(areas.sideBar as HTMLElement, ranges.sideBar);
        withScrollRange(areas.main as HTMLElement, ranges.main);
        return areas;
      },
    };
  }

  it.each([
    {
      row: 'offsets inside both ranges',
      scrolled: { sideBar: 120, main: 45 },
      swapped: [120, 45],
      restored: [120, 45],
    },
    {
      row: 'the side bar at its end',
      scrolled: { sideBar: 248, main: 45 },
      swapped: [240, 45],
      restored: [248, 45],
    },
  ])(
    'mountShell_SetLayoutThenDispose_KeepsEachAreaScroll: $row',
    ({ scrolled, swapped, restored }) => {
      const doc = installFocusFakeDom(
        (name, value) => vi.stubGlobal(name, value),
        ScrollerFakeElement,
      );
      Object.assign(doc, {
        documentElement: { style: { setProperty: () => undefined } },
      });
      const root = new ScrollerFakeElement('div');
      const shell = mountShell(
        asHtml(root),
        rangedLayout({ sideBar: 248, main: 400 }),
      );
      const scrollTops = () =>
        ['shell-side-bar', 'shell-main'].map(
          (className) => root.querySelector(`.${className}`)?.scrollTop,
        );
      root.querySelector('.shell-side-bar')!.scrollTop = scrolled.sideBar;
      root.querySelector('.shell-main')!.scrollTop = scrolled.main;

      const swap = shell.setLayout(rangedLayout({ sideBar: 240, main: 400 }));
      const swappedTops = scrollTops();
      swap.dispose();

      expect(swappedTops).toEqual(swapped);
      expect(scrollTops()).toEqual(restored);
    },
  );
});
