import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../contracts/ambient';
import { PANE_RESIZE_COMMANDS } from '../../contracts/panes';
import type { ShellLayout } from '../../contracts/plugin';
import type { UiState } from '../../contracts/ui-state';
import { recordingAnchors } from '../../shared/page/layout-host/test-layouts';
import {
  asHtml,
  FakeElement,
  installFakeDom,
  installFocusFakeDom,
  ScrollerFakeElement,
} from '../../shared/page/test-dom';
import type { SideBarLayout } from './modes';
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

// A ResizeObserver the shell made: its callback, run by hand, and the
// elements it observes.
interface FakeObserver {
  callback: () => void;
  observed: unknown[];
}

// Stubs what mountShell reads beyond the fake DOM: the computed
// `--wg-sidebar-width` token, `token`, and ResizeObservers that report only
// when a test runs their callback; returns every observer made.
function stubShellGlobals(token = '256px'): FakeObserver[] {
  const observers: FakeObserver[] = [];
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) =>
      name === '--wg-sidebar-width' ? token : '',
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observed: unknown[] = [];
      constructor(readonly callback: () => void) {
        observers.push(this);
      }
      observe(target: unknown) {
        this.observed.push(target);
      }
      disconnect() {
        this.observed = [];
      }
    },
  );
  return observers;
}

// The side bar's left edge and main's right edge, in client pixels.
interface Edges {
  sideBarLeft: number;
  mainRight: number;
}

// `layout` with its side bar and main reporting `edges`, read at each call,
// as their client rects.
function measuredLayout(
  edges: Edges,
  layout: ShellLayout = defaultShellLayout,
): ShellLayout {
  return {
    mount(root) {
      const areas = layout.mount(root);
      Object.assign(areas.sideBar, {
        getBoundingClientRect: () => ({ left: edges.sideBarLeft }),
      });
      Object.assign(areas.main, {
        getBoundingClientRect: () => ({ right: edges.mainRight }),
      });
      return areas;
    },
  };
}

const NO_TIMERS: Timers = { set: () => 0, clear: () => undefined };

function stateOver(values: Map<string, unknown>): UiState {
  return {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  };
}

// A shell mounted on the default layout over a fake DOM, its side bar at
// `edges.sideBarLeft` 0 and main ending at 1200 unless given, `stored` under
// `side-bar-width` when given. `resizeRoot` runs the observers watching the
// root, as a window resize does.
function mountMeasuredShell(
  options: { token?: string; stored?: number; edges?: Partial<Edges> } = {},
) {
  installFakeDom((name, value) => vi.stubGlobal(name, value));
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
    documentElement: { style: { setProperty: () => undefined } },
  });
  const observers = stubShellGlobals(options.token);
  const values = new Map<string, unknown>();
  if (options.stored !== undefined) {
    values.set('side-bar-width', options.stored);
  }
  const edges = { sideBarLeft: 0, mainRight: 1200, ...options.edges };
  const root = new FakeElement('div');
  const shell = mountShell(
    asHtml(root),
    measuredLayout(edges),
    stateOver(values),
    NO_TIMERS,
  );
  return {
    shell,
    root,
    values,
    edges,
    handle: () => root.querySelector('.shell-side-bar-handle'),
    drawnWidth: () => root.style['--shell-side-bar-width'],
    resizeRoot() {
      for (const observer of observers) {
        if (observer.observed.includes(root)) {
          observer.callback();
        }
      }
    },
  };
}

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
    stubShellGlobals();
    const root = new FakeElement('div');
    const shell = mountShell(
      asHtml(root),
      measuredLayout({ sideBarLeft: 0, mainRight: 1200 }),
      stateOver(new Map()),
      NO_TIMERS,
    );
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
      sideBarRanges: { first: 248, swapped: 240 },
      scrolled: { sideBar: 120, main: 45 },
      swapped: [120, 45],
      restored: [120, 45],
    },
    {
      row: 'the side bar at its end',
      sideBarRanges: { first: 248, swapped: 240 },
      scrolled: { sideBar: 248, main: 45 },
      swapped: [240, 45],
      restored: [248, 45],
    },
    {
      row: 'a side bar with no range at the top',
      sideBarRanges: { first: 0, swapped: 240 },
      scrolled: { sideBar: 0, main: 45 },
      swapped: [0, 45],
      restored: [0, 45],
    },
  ])(
    'mountShell_SetLayoutThenDispose_KeepsEachAreaScroll: $row',
    ({ sideBarRanges, scrolled, swapped, restored }) => {
      const doc = installFocusFakeDom(
        (name, value) => vi.stubGlobal(name, value),
        ScrollerFakeElement,
      );
      Object.assign(doc, {
        documentElement: { style: { setProperty: () => undefined } },
      });
      stubShellGlobals();
      const root = new ScrollerFakeElement('div');
      const shell = mountShell(
        asHtml(root),
        measuredLayout(
          { sideBarLeft: 0, mainRight: 1200 },
          rangedLayout({ sideBar: sideBarRanges.first, main: 400 }),
        ),
        stateOver(new Map()),
        NO_TIMERS,
      );
      const scrollTops = () =>
        ['shell-side-bar', 'shell-main'].map(
          (className) => root.querySelector(`.${className}`)?.scrollTop,
        );
      root.querySelector('.shell-side-bar')!.scrollTop = scrolled.sideBar;
      root.querySelector('.shell-main')!.scrollTop = scrolled.main;

      const swap = shell.setLayout(
        rangedLayout({ sideBar: sideBarRanges.swapped, main: 400 }),
      );
      const swappedTops = scrollTops();
      swap.dispose();

      expect(swappedTops).toEqual(swapped);
      expect(scrollTops()).toEqual(restored);
    },
  );

  it.each([
    { token: '256px', stored: undefined, drawn: '256' },
    { token: '300px', stored: undefined, drawn: '300' },
    { token: '', stored: undefined, drawn: '256' },
    { token: 'auto', stored: undefined, drawn: '256' },
    { token: '20rem', stored: undefined, drawn: '256' },
    { token: ' 300px ', stored: undefined, drawn: '300' },
    { token: '256px', stored: 320, drawn: '320' },
  ])(
    'opens the side bar at the token or the stored width: token $token, stored $stored',
    ({ token, stored, drawn }) => {
      const { drawnWidth } = mountMeasuredShell({ token, stored });

      expect(drawnWidth()).toBe(drawn);
    },
  );

  it.each([
    { layout: 'beside', hidden: false },
    { layout: 'over', hidden: true },
    { layout: 'hidden', hidden: true },
  ] satisfies { layout: SideBarLayout; hidden: boolean }[])(
    'shows the side bar handle only beside: $layout',
    ({ layout, hidden }) => {
      const { shell, handle } = mountMeasuredShell();

      shell.layOutSideBar(layout);

      expect(handle()?.hidden).toBe(hidden);
    },
  );

  it('keeps the side bar handle in the root across a layout swap', () => {
    const { shell, root, handle } = mountMeasuredShell();

    const swap = shell.setLayout(defaultShellLayout);
    const swapped = handle()?.parentNode;
    swap.dispose();

    expect(swapped).toBe(root);
    expect(handle()?.parentNode).toBe(root);
  });

  it('stores and draws the width a side bar nudge sets', () => {
    const { shell, values, handle, drawnWidth } = mountMeasuredShell({
      edges: { sideBarLeft: 48 },
    });
    shell.layOutSideBar('beside');
    Object.assign(handle()!, { getClientRects: () => [{}] });

    shell.sideBarDivider.nudge('right');

    expect(values.get('side-bar-width')).toBe(280);
    expect(drawnWidth()).toBe('280');
  });

  // Steps over a shell whose stored side bar width is 400 and whose side bar
  // starts at the client's left edge; the stored width stays 400 unless a row
  // names the width a nudge writes.
  type NarrowingShell = ReturnType<typeof mountMeasuredShell>;
  const resizeTo = (shell: NarrowingShell, mainRight: number) => {
    shell.edges.mainRight = mainRight;
    shell.resizeRoot();
  };
  const nudge = (shell: NarrowingShell, direction: 'left' | 'right') => {
    Object.assign(shell.handle()!, { getClientRects: () => [{}] });
    shell.shell.sideBarDivider.nudge(direction);
  };
  it.each([
    {
      row: 'beside, main ending at 1200',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        resizeTo(shell, 1200);
      },
      drawn: '400',
    },
    {
      row: 'beside, main ending at 600',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        resizeTo(shell, 600);
      },
      drawn: '280',
    },
    {
      row: 'beside, main ending at 600 then 1200',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        resizeTo(shell, 600);
        resizeTo(shell, 1200);
      },
      drawn: '400',
    },
    {
      row: 'over, main ending at 600',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('over');
        resizeTo(shell, 600);
      },
      drawn: '400',
    },
    {
      row: 'hidden, then beside at main ending at 600 with no resize seen',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('hidden');
        shell.edges.mainRight = 600;
        shell.shell.layOutSideBar('beside');
      },
      drawn: '280',
    },
    {
      row: 'beside, main ending at 600, nudged right at the drawn limit',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        resizeTo(shell, 600);
        nudge(shell, 'right');
      },
      drawn: '280',
    },
    {
      row: 'beside, main ending at 600, nudged left from the drawn width',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        resizeTo(shell, 600);
        nudge(shell, 'left');
      },
      drawn: '256',
      stored: 256,
    },
  ] satisfies {
    row: string;
    steps: (shell: NarrowingShell) => void;
    drawn: string;
    stored?: number;
  }[])(
    'clamps only the drawn side bar width as the window narrows: $row',
    ({ steps, drawn, stored = 400 }) => {
      const shell = mountMeasuredShell({ stored: 400 });

      steps(shell);

      expect(shell.drawnWidth()).toBe(drawn);
      expect(shell.values.get('side-bar-width')).toBe(stored);
    },
  );

  // The commands of `keys`' anchors, each with whether it was disposed.
  const anchored = (keys: ReturnType<typeof recordingAnchors>) =>
    keys.anchors.map((anchor) => [anchor.command, anchor.isDisposed]);

  it("anchors the side bar handle's prompt again on each setKeys", () => {
    const { shell } = mountMeasuredShell();
    const first = recordingAnchors();
    const second = recordingAnchors();

    shell.setKeys(first.keys);
    const afterFirst = anchored(first);
    shell.setKeys(second.keys);

    expect(afterFirst).toEqual([
      [PANE_RESIZE_COMMANDS.left, false],
      [PANE_RESIZE_COMMANDS.right, false],
    ]);
    expect(anchored(first)).toEqual([
      [PANE_RESIZE_COMMANDS.left, true],
      [PANE_RESIZE_COMMANDS.right, true],
    ]);
    expect(anchored(second)).toEqual([
      [PANE_RESIZE_COMMANDS.left, false],
      [PANE_RESIZE_COMMANDS.right, false],
    ]);
  });

  it('disposes the side bar divider and removes its handle', () => {
    const { shell, handle } = mountMeasuredShell();
    const first = recordingAnchors();
    shell.setKeys(first.keys);

    shell.dispose();

    expect(anchored(first)).toEqual([
      [PANE_RESIZE_COMMANDS.left, true],
      [PANE_RESIZE_COMMANDS.right, true],
    ]);
    expect(handle()).toBe(null);
  });
});
