import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Timers } from '../../contracts/ambient';
import type { Disposable } from '../../contracts/disposable';
import { PANE_RESIZE_COMMANDS } from '../../contracts/panes';
import type { KeyHints, ShellLayout } from '../../contracts/plugin';
import { uiStateOver } from '../../shared/fake-ui-state.test-support';
import { recordingAnchors } from '../../shared/page/layout-host/test-layouts';
import {
  asHtml,
  FakeElement,
  FocusFakeElement,
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
  type Shell,
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

// Stubs the computed `--wg-sidebar-width` token as `side` and
// `--wg-rightbar-width` as `right`.
function stubBarTokens({
  side = '256px',
  right = '300px',
}: {
  side?: string;
  right?: string;
} = {}): void {
  const tokens: Record<string, string> = {
    '--wg-sidebar-width': side,
    '--wg-rightbar-width': right,
  };
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => tokens[name] ?? '',
  }));
}

// Stubs what mountShell reads beyond the fake DOM: the computed bar width
// tokens, `tokens`, and ResizeObservers that report only when a test runs
// their callback; returns every observer made.
function stubShellGlobals(
  tokens: { side?: string; right?: string } = {},
): FakeObserver[] {
  const observers: FakeObserver[] = [];
  stubBarTokens(tokens);
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

// The side bar's left edge, main's left edge while the side bar is not
// beside, main's right edge while the right bar is hidden and the right bar's
// right edge, in client pixels.
interface Edges {
  sideBarLeft: number;
  mainLeft: number;
  mainRight: number;
  rightBarRight: number;
}

const DEFAULT_EDGES: Edges = {
  sideBarLeft: 0,
  mainLeft: 300,
  mainRight: 1200,
  rightBarRight: 1200,
};

// `layout` with its side bar, main and right bar reporting `edges`, read at
// each call, as their client rects. Main's edges follow the bars' columns as
// the grid draws them: beside the side bar main starts at the side bar's
// drawn end, and beside the right bar it ends at the right bar's drawn start;
// over main, the right bar's column collapses and main ends at its end.
function measuredLayout(
  edges: Edges,
  layout: ShellLayout = defaultShellLayout,
): ShellLayout {
  return {
    mount(root) {
      const areas = layout.mount(root);
      const { style } = root as unknown as FakeElement;
      const sideBar = areas.sideBar as HTMLElement;
      const rightBar = areas.rightBar as HTMLElement;
      const mainLeft = () =>
        sideBar.dataset.sideBar === 'beside'
          ? edges.sideBarLeft + Number(style['--shell-side-bar-width'])
          : edges.mainLeft;
      const mainRight = () =>
        rightBar.hidden
          ? edges.mainRight
          : rightBar.dataset.rightBar === 'over'
            ? edges.rightBarRight
            : edges.rightBarRight - Number(style['--shell-right-bar-width']);
      Object.assign(areas.sideBar, {
        getBoundingClientRect: () => ({ left: edges.sideBarLeft }),
      });
      Object.assign(areas.main, {
        getBoundingClientRect: () => ({ left: mainLeft(), right: mainRight() }),
      });
      Object.assign(areas.rightBar, {
        getBoundingClientRect: () => ({ right: edges.rightBarRight }),
      });
      return areas;
    },
  };
}

const NO_TIMERS: Timers = { set: () => 0, clear: () => undefined };

// A shell mounted on the default layout over a fake DOM, at `DEFAULT_EDGES`
// unless given, `stored` under `side-bar-width` and `rightStored` under
// `right-bar-width` when given. `resizeRoot` runs the observers watching the
// root, as a window resize does; `showRightBar` contributes to the right bar;
// `dragRightBar` drags its handle `by` pixels from where it is drawn.
function mountMeasuredShell(
  options: {
    token?: string;
    rightToken?: string;
    stored?: number;
    rightStored?: number;
    edges?: Partial<Edges>;
    keys?: KeyHints;
  } = {},
) {
  installFakeDom((name, value) => vi.stubGlobal(name, value));
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
    documentElement: { style: { setProperty: () => undefined } },
  });
  vi.stubGlobal('window', {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  const observers = stubShellGlobals({
    side: options.token,
    right: options.rightToken,
  });
  const values = new Map<string, unknown>();
  if (options.stored !== undefined) {
    values.set('side-bar-width', options.stored);
  }
  if (options.rightStored !== undefined) {
    values.set('right-bar-width', options.rightStored);
  }
  const edges = { ...DEFAULT_EDGES, ...options.edges };
  const root = new FakeElement('div');
  const shell = mountShell(
    asHtml(root),
    measuredLayout(edges),
    uiStateOver(values),
    NO_TIMERS,
    options.keys ?? recordingAnchors().keys,
  );
  const rightHandle = () => root.querySelector('.shell-right-bar-handle');
  const drawnRightWidth = () => root.style['--shell-right-bar-width'];
  return {
    shell,
    root,
    values,
    edges,
    handle: () => root.querySelector('.shell-side-bar-handle'),
    rightHandle,
    drawnWidth: () => root.style['--shell-side-bar-width'],
    drawnRightWidth,
    showRightBar: () =>
      shell.areas.rightBar.contribute(asHtml(new FakeElement('div'))),
    dragRightBar(by: number) {
      const handle = rightHandle()!;
      const captured = new Set<number>();
      Object.assign(handle, {
        setPointerCapture: (id: number) => captured.add(id),
        hasPointerCapture: (id: number) => captured.has(id),
      });
      const at = edges.rightBarRight - Number(drawnRightWidth());
      handle.fire('pointerdown', { button: 0, pointerId: 1, clientX: at });
      handle.fire('pointermove', { pointerId: 1, clientX: at + by });
      captured.delete(1);
      handle.fire('lostpointercapture', { pointerId: 1 });
    },
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

  // The `data-layout` and `data-layout-owner` of the five chrome areas
  // mounted in `root`.
  function chromeLayouts(root: FakeElement): string[][] {
    const classes = [
      'shell-title-bar',
      'shell-activity-bar',
      'shell-side-bar',
      'shell-right-bar',
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
      measuredLayout(DEFAULT_EDGES),
      uiStateOver(new Map()),
      NO_TIMERS,
      recordingAnchors().keys,
    );
    shell.setChromeLayout('mine');
    const mine = Array(5).fill(['mine', 'shell']);

    const swap = shell.setLayout(defaultShellLayout);
    const swapped = chromeLayouts(root);
    swap.dispose();

    expect(swapped).toEqual(mine);
    expect(chromeLayouts(root)).toEqual(mine);
  });

  // The measured default layout, marking its main element
  // `data-mounted-by="<name>"` and counting its mounts.
  function countedLayout(name: string): ShellLayout & { mounts: number } {
    const measured = measuredLayout(DEFAULT_EDGES);
    const layout: ShellLayout & { mounts: number } = {
      mounts: 0,
      mount(root: HTMLElement) {
        layout.mounts += 1;
        const areas = measured.mount(root);
        (areas.main as HTMLElement).dataset.mountedBy = name;
        return areas;
      },
    };
    return layout;
  }

  interface SwapLayouts {
    A: ShellLayout & { mounts: number };
    B: ShellLayout;
    throws: ShellLayout;
    missesStatusBar: ShellLayout;
  }

  function swapLayouts(): SwapLayouts {
    return {
      A: countedLayout('A'),
      B: countedLayout('B'),
      throws: {
        mount() {
          throw new Error('mount failed');
        },
      },
      missesStatusBar: {
        mount(root) {
          const areas: Partial<ReturnType<ShellLayout['mount']>> =
            measuredLayout(DEFAULT_EDGES).mount(root);
          delete areas.statusBar;
          return areas as ReturnType<ShellLayout['mount']>;
        },
      },
    };
  }

  // The message `swap` threw, or undefined when it threw nothing.
  function thrownBy(swap: () => unknown): string | undefined {
    try {
      swap();
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  }

  // Breaks when a failed swap leaves the shell empty or on the failed layout,
  // files a contribution in the wrong track, drops the handles or the chrome
  // marks, or counts as a swap so the earlier handle no longer restores; or
  // when a stale handle restores over a later swap.
  it.each([
    {
      row: 'mount throws',
      steps: (shell: Shell, layouts: SwapLayouts) => {
        const a = shell.setLayout(layouts.A);
        const thrown = thrownBy(() => shell.setLayout(layouts.throws));
        return { live: a, thrown };
      },
      thrown: 'mount failed',
      mountedBy: 'A',
      mountsOfA: 2,
    },
    {
      row: 'layout misses an area',
      steps: (shell: Shell, layouts: SwapLayouts) => {
        const a = shell.setLayout(layouts.A);
        const thrown = thrownBy(() => shell.setLayout(layouts.missesStatusBar));
        return { live: a, thrown };
      },
      thrown: 'Shell layout returned no element for statusBar',
      mountedBy: 'A',
      mountsOfA: 2,
    },
    {
      row: 'second swap before the first restore',
      steps: (shell: Shell, layouts: SwapLayouts) => {
        const a = shell.setLayout(layouts.A);
        const b = shell.setLayout(layouts.B);
        a.dispose();
        return { live: b, thrown: undefined };
      },
      thrown: undefined,
      mountedBy: 'B',
      mountsOfA: 1,
    },
  ] satisfies {
    row: string;
    steps: (
      shell: Shell,
      layouts: SwapLayouts,
    ) => { live: Disposable; thrown: string | undefined };
    thrown: string | undefined;
    mountedBy: string;
    mountsOfA: number;
  }[])(
    'mountShell_SwapFails_KeepsTheRightLayoutMounted ($row)',
    ({ steps, thrown, mountedBy, mountsOfA }) => {
      installFakeDom((name, value) => vi.stubGlobal(name, value));
      vi.stubGlobal('document', {
        createElement: (tag: string) => new FakeElement(tag),
        documentElement: { style: { setProperty: () => undefined } },
      });
      stubShellGlobals();
      const root = new FakeElement('div');
      const shell = mountShell(
        asHtml(root),
        countedLayout('initial'),
        uiStateOver(new Map()),
        NO_TIMERS,
        recordingAnchors().keys,
      );
      shell.setChromeLayout('mine');
      const mainContribution = new FakeElement('div');
      const statusContribution = new FakeElement('div');
      shell.areas.main.contribute(asHtml(mainContribution), { align: 'start' });
      shell.areas.statusBar.contribute(asHtml(statusContribution), {
        align: 'end',
      });
      const layouts = swapLayouts();
      const mountedByNow = () => mainContribution.parentNode?.dataset.mountedBy;

      const outcome = steps(shell, layouts);
      const state = {
        thrown: outcome.thrown,
        mountedBy: mountedByNow(),
        contributionsIn: [
          mainContribution.parentNode?.className,
          statusContribution.parentNode?.className,
        ],
        handles: [
          root.querySelector('.shell-side-bar-handle')?.parentNode === root,
          root.querySelector('.shell-right-bar-handle')?.parentNode === root,
        ],
        chrome: chromeLayouts(root),
        mountsOfA: layouts.A.mounts,
      };
      outcome.live.dispose();

      expect({ ...state, afterRestore: mountedByNow() }).toEqual({
        thrown,
        mountedBy,
        contributionsIn: ['shell-main', 'shell-track shell-track-end'],
        handles: [true, true],
        chrome: Array(5).fill(['mine', 'shell']),
        mountsOfA,
        afterRestore: 'initial',
      });
    },
  );

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
          DEFAULT_EDGES,
          rangedLayout({ sideBar: sideBarRanges.first, main: 400 }),
        ),
        uiStateOver(new Map()),
        NO_TIMERS,
        recordingAnchors().keys,
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
    { bar: 'side', token: '256px', stored: undefined, drawn: '256' },
    { bar: 'side', token: '300px', stored: undefined, drawn: '300' },
    { bar: 'side', token: '', stored: undefined, drawn: '256' },
    { bar: 'side', token: 'auto', stored: undefined, drawn: '256' },
    { bar: 'side', token: '20rem', stored: undefined, drawn: '256' },
    { bar: 'side', token: ' 300px ', stored: undefined, drawn: '300' },
    { bar: 'side', token: '256px', stored: 320, drawn: '320' },
    { bar: 'right', token: '300px', stored: undefined, drawn: '300' },
    { bar: 'right', token: '360px', stored: undefined, drawn: '360' },
    { bar: 'right', token: '', stored: undefined, drawn: '300' },
    { bar: 'right', token: '20rem', stored: undefined, drawn: '300' },
    { bar: 'right', token: '300px', stored: 320, drawn: '320' },
  ] as const)(
    'opens each bar at its token or the stored width: $bar, token $token, stored $stored',
    ({ bar, token, stored, drawn }) => {
      const shell =
        bar === 'side'
          ? mountMeasuredShell({ token, stored })
          : mountMeasuredShell({ rightToken: token, rightStored: stored });

      const drawnWidth =
        bar === 'side' ? shell.drawnWidth() : shell.drawnRightWidth();
      expect(drawnWidth).toBe(drawn);
    },
  );

  it('mountShell_RightBarStops_FollowDrawnOrder', () => {
    const { shell } = mountMeasuredShell();
    const focused: number[] = [];
    const later = new FakeElement('div');
    const inside = new FakeElement('span');
    const outside = new FakeElement('div');
    later.append(inside);

    shell.areas.rightBar.contribute(asHtml(later), {
      order: 10,
      focus: () => focused.push(10),
    });
    shell.areas.rightBar.contribute(asHtml(new FakeElement('div')), {
      order: 0,
    });
    shell.areas.rightBar.contribute(asHtml(new FakeElement('div')), {
      order: 5,
      focus: () => focused.push(5),
    });
    for (const stop of shell.rightBarStops()) {
      stop.focus();
    }

    expect(focused).toEqual([5, 10]);
    expect([
      shell.rightBarHolds(asHtml(inside)),
      shell.rightBarHolds(asHtml(outside)),
    ]).toEqual([true, false]);
  });

  // Breaks when a turn ended by a base change leaves the DOM focus, and its
  // caret, in the right bar, or when the blur reaches focus outside it.
  it.each([
    { row: 'focus inside the contribution', focusInside: true },
    { row: 'focus outside it', focusInside: false },
  ])(
    'mountShell_RightBarStopLeft_BlursOnlyWhatTheContributionHolds: $row',
    ({ focusInside }) => {
      const doc = installFocusFakeDom((name, value) =>
        vi.stubGlobal(name, value),
      );
      Object.assign(doc, {
        documentElement: { style: { setProperty: () => undefined } },
      });
      stubShellGlobals();
      const shell = mountShell(
        asHtml(new FakeElement('div')),
        measuredLayout(DEFAULT_EDGES),
        uiStateOver(new Map()),
        NO_TIMERS,
        recordingAnchors().keys,
      );
      const panel = new FocusFakeElement('div');
      const row = new FocusFakeElement('div');
      const outside = new FocusFakeElement('div');
      panel.append(row);
      const heldAtLeft: boolean[] = [];
      shell.areas.rightBar.contribute(asHtml(panel), {
        focus: () => row.focus(),
        left: () => heldAtLeft.push(doc.activeElement === row),
      });
      const [stop] = shell.rightBarStops();
      stop.focus();
      if (!focusInside) {
        outside.focus();
      }

      stop.left?.();

      expect(heldAtLeft).toEqual([focusInside]);
      expect(doc.activeElement).toBe(focusInside ? null : outside);
    },
  );

  it('mountShell_RightBarStopDisposed_TellsOnce', () => {
    const { shell } = mountMeasuredShell();
    const removed: unknown[] = [];
    shell.onRightBarStopRemoved((stop) => removed.push(stop));
    const plain = shell.areas.rightBar.contribute(
      asHtml(new FakeElement('div')),
    );
    const stopping = shell.areas.rightBar.contribute(
      asHtml(new FakeElement('div')),
      { focus: () => undefined },
    );
    const [stop] = shell.rightBarStops();

    plain.dispose();
    stopping.dispose();
    stopping.dispose();

    expect(removed).toEqual([stop]);
    expect(shell.rightBarStops()).toEqual([]);
  });

  it('mountShell_RightBarContributions_HideItWhileEmpty', () => {
    const { shell, root, rightHandle } = mountMeasuredShell();
    const hiddenStates = () => [
      root.querySelector('.shell-right-bar')?.hidden,
      rightHandle()?.hidden,
    ];
    const states = [hiddenStates()];

    const first = shell.areas.rightBar.contribute(
      asHtml(new FakeElement('div')),
    );
    const second = shell.areas.rightBar.contribute(
      asHtml(new FakeElement('div')),
    );
    states.push(hiddenStates());
    first.dispose();
    states.push(hiddenStates());
    second.dispose();
    states.push(hiddenStates());

    expect(states).toEqual([
      [true, true],
      [false, false],
      [false, false],
      [true, true],
    ]);
  });

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

  it('keeps both bar handles in the root across a layout swap', () => {
    const { shell, root, handle, rightHandle } = mountMeasuredShell();
    const parents = () => [handle()?.parentNode, rightHandle()?.parentNode];

    const swap = shell.setLayout(defaultShellLayout);
    const swapped = parents();
    swap.dispose();

    expect(swapped).toEqual([root, root]);
    expect(parents()).toEqual([root, root]);
  });

  // Resizes a bar one step in `direction`: the side bar by a keyboard nudge,
  // the right bar, which no key resizes, by a drag of one nudge's pixels.
  type MeasuredShell = ReturnType<typeof mountMeasuredShell>;
  const resizeBar = (
    shell: MeasuredShell,
    bar: 'side' | 'right',
    direction: 'left' | 'right',
  ) => {
    if (bar === 'right') {
      shell.dragRightBar(direction === 'left' ? -24 : 24);
      return;
    }
    Object.assign(shell.handle()!, { getClientRects: () => [{}] });
    shell.shell.sideBarDivider.nudge(direction);
  };

  it.each([
    {
      row: 'side bar beside, nudged right',
      bar: 'side',
      direction: 'right',
      key: 'side-bar-width',
      width: 280,
    },
    {
      row: 'right bar shown, dragged left',
      bar: 'right',
      direction: 'left',
      key: 'right-bar-width',
      width: 324,
    },
    {
      row: 'right bar shown, dragged right',
      bar: 'right',
      direction: 'right',
      key: 'right-bar-width',
      width: 276,
    },
  ] as const)(
    'stores and draws the width a bar resize sets: $row',
    ({ bar, direction, key, width }) => {
      const shell = mountMeasuredShell({ edges: { sideBarLeft: 48 } });
      if (bar === 'side') {
        shell.shell.layOutSideBar('beside');
      } else {
        shell.showRightBar();
      }

      resizeBar(shell, bar, direction);

      const drawn =
        bar === 'side' ? shell.drawnWidth() : shell.drawnRightWidth();
      expect(shell.values.get(key)).toBe(width);
      expect(drawn).toBe(String(width));
    },
  );

  // Steps over a shell whose stored side bar width is 400 and whose side bar
  // starts at the client's left edge; the stored width stays 400 unless a row
  // names the width a nudge writes.
  type NarrowingShell = MeasuredShell;
  const resizeTo = (shell: NarrowingShell, mainRight: number) => {
    shell.edges.mainRight = mainRight;
    shell.resizeRoot();
  };
  const nudge = (shell: NarrowingShell, direction: 'left' | 'right') =>
    resizeBar(shell, 'side', direction);
  const resizeRightTo = (shell: NarrowingShell, rightBarRight: number) => {
    shell.edges.rightBarRight = rightBarRight;
    shell.resizeRoot();
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
      row: 'over, main ending at 300',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('over');
        resizeTo(shell, 300);
      },
      drawn: '300',
    },
    {
      row: 'over, main ending at 300 then 1200',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('over');
        resizeTo(shell, 300);
        resizeTo(shell, 1200);
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
      row: 'beside, then the right bar shows at a right edge of 900 and no resize seen',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        shell.edges.rightBarRight = 900;
        shell.showRightBar();
      },
      drawn: '280',
    },
    {
      row: 'beside, the right bar shown at a right edge of 800, the side bar giving way first',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        shell.showRightBar();
        resizeRightTo(shell, 800);
      },
      drawn: '180',
    },
    {
      row: 'beside, the right bar over at a right edge of 600, then beside at 1000',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        shell.showRightBar();
        resizeRightTo(shell, 600);
        resizeRightTo(shell, 1000);
      },
      drawn: '380',
    },
    {
      row: 'beside, the right bar shown and dragged 300 wider',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        shell.showRightBar();
        shell.dragRightBar(-300);
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

  // Steps over a shell whose stored right bar width is 400 and whose main
  // starts at 300 while the side bar is hidden, so the bar goes over below a
  // right edge of 820; with the side bar beside from 0, below 680. The stored
  // width stays 400.
  it.each([
    {
      row: 'shown, right edge 1200',
      steps: (shell: NarrowingShell) => {
        shell.showRightBar();
        resizeRightTo(shell, 1200);
      },
      drawn: '400',
    },
    {
      row: 'shown, right edge 1000',
      steps: (shell: NarrowingShell) => {
        shell.showRightBar();
        resizeRightTo(shell, 1000);
      },
      drawn: '380',
    },
    {
      row: 'shown, right edge 1000 then 1200',
      steps: (shell: NarrowingShell) => {
        shell.showRightBar();
        resizeRightTo(shell, 1000);
        resizeRightTo(shell, 1200);
      },
      drawn: '400',
    },
    {
      row: 'shown, right edge 820, main at its least width',
      steps: (shell: NarrowingShell) => {
        shell.showRightBar();
        resizeRightTo(shell, 820);
      },
      drawn: '200',
    },
    {
      row: 'shown, right edge 700, over main at its least width',
      steps: (shell: NarrowingShell) => {
        shell.showRightBar();
        resizeRightTo(shell, 700);
      },
      drawn: '200',
      layout: 'over',
      handleHidden: true,
    },
    {
      row: 'shown, right edge 700 then 1000, beside again',
      steps: (shell: NarrowingShell) => {
        shell.showRightBar();
        resizeRightTo(shell, 700);
        resizeRightTo(shell, 1000);
      },
      drawn: '380',
    },
    {
      row: 'shown, right edge 450, over a span narrower than its least width',
      steps: (shell: NarrowingShell) => {
        shell.showRightBar();
        resizeRightTo(shell, 450);
      },
      drawn: '150',
      layout: 'over',
      handleHidden: true,
    },
    {
      row: 'shown, the side bar beside, right edge 1000, keeping its width',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        shell.showRightBar();
        resizeRightTo(shell, 1000);
      },
      drawn: '400',
    },
    {
      row: 'shown, the side bar beside, right edge 700, main at its least width',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        shell.showRightBar();
        resizeRightTo(shell, 700);
      },
      drawn: '220',
    },
    {
      row: 'shown, the side bar beside, right edge 660, over main',
      steps: (shell: NarrowingShell) => {
        shell.shell.layOutSideBar('beside');
        shell.showRightBar();
        resizeRightTo(shell, 660);
      },
      drawn: '200',
      layout: 'over',
      handleHidden: true,
    },
    {
      row: 'hidden, right edge 700',
      steps: (shell: NarrowingShell) => {
        resizeRightTo(shell, 700);
      },
      drawn: '400',
      handleHidden: true,
    },
    {
      row: 'hidden, then contributed at right edge 1000 with no resize seen',
      steps: (shell: NarrowingShell) => {
        shell.edges.rightBarRight = 1000;
        shell.showRightBar();
      },
      drawn: '380',
    },
  ] satisfies {
    row: string;
    steps: (shell: NarrowingShell) => void;
    drawn: string;
    layout?: 'beside' | 'over';
    handleHidden?: boolean;
  }[])(
    'clamps only the drawn right bar width as the window narrows: $row',
    ({ steps, drawn, layout = 'beside', handleHidden = false }) => {
      const shell = mountMeasuredShell({ rightStored: 400 });

      steps(shell);

      const rightBar = shell.root.querySelector('.shell-right-bar');
      expect([
        shell.drawnRightWidth(),
        rightBar?.dataset.rightBar,
        shell.rightHandle()?.hidden,
      ]).toEqual([drawn, layout, handleHidden]);
      expect(shell.values.get('right-bar-width')).toBe(400);
    },
  );

  it.each([
    { row: 'side, no stored width', bar: 'side', drawn: '300' },
    { row: 'side, a stored width', bar: 'side', stored: 320, drawn: '320' },
    {
      row: 'side, no stored width, resized right after',
      bar: 'side',
      resized: 'right',
      drawn: '324',
      storedAfter: 324,
    },
    { row: 'right, no stored width', bar: 'right', drawn: '360' },
    { row: 'right, a stored width', bar: 'right', stored: 320, drawn: '320' },
    {
      row: 'right, no stored width, resized left after',
      bar: 'right',
      resized: 'left',
      drawn: '384',
      storedAfter: 384,
    },
  ] satisfies {
    row: string;
    bar: 'side' | 'right';
    stored?: number;
    resized?: 'left' | 'right';
    drawn: string;
    storedAfter?: number;
  }[])(
    'redraws each bar at a reloaded token only with no stored width: $row',
    ({ bar, stored, resized, drawn, storedAfter = stored }) => {
      const isSide = bar === 'side';
      const shell = mountMeasuredShell({
        token: '256px',
        rightToken: '300px',
        stored: isSide ? stored : undefined,
        rightStored: isSide ? undefined : stored,
      });
      shell.shell.layOutSideBar('beside');
      shell.showRightBar();
      stubBarTokens({ side: '300px', right: '360px' });

      shell.shell.reloadBarOpenWidths();
      if (resized !== undefined) {
        resizeBar(shell, bar, resized);
      }

      const drawnWidth = isSide ? shell.drawnWidth() : shell.drawnRightWidth();
      expect(drawnWidth).toBe(drawn);
      const key = isSide ? 'side-bar-width' : 'right-bar-width';
      expect(shell.values.get(key)).toBe(storedAfter);
    },
  );

  // The commands of `keys`' anchors, each with whether it was disposed.
  const anchored = (keys: ReturnType<typeof recordingAnchors>) =>
    keys.anchors.map((anchor) => [anchor.command, anchor.isDisposed]);

  // The side bar's prompt anchors, each `isDisposed`; the right bar's handle
  // anchors none.
  const sidePrompts = (isDisposed: boolean) => [
    [PANE_RESIZE_COMMANDS.left, isDisposed],
    [PANE_RESIZE_COMMANDS.right, isDisposed],
  ];

  it("anchors only the side bar handle's prompt", () => {
    const recorded = recordingAnchors();

    mountMeasuredShell({ keys: recorded.keys });

    expect(anchored(recorded)).toEqual(sidePrompts(false));
  });

  it('disposes both bar dividers and removes their handles', () => {
    const recorded = recordingAnchors();
    const { shell, handle, rightHandle } = mountMeasuredShell({
      keys: recorded.keys,
    });

    shell.dispose();

    expect(anchored(recorded)).toEqual(sidePrompts(true));
    expect([handle(), rightHandle()]).toEqual([null, null]);
  });
});
