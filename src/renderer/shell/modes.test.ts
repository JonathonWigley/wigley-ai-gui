import { describe, expect, it } from 'vitest';
import {
  createModes,
  SIDE_BAR_START,
  sideBarAfterPick,
  sideBarAfterResize,
  sideBarLayout,
  toggledSideBar,
} from './modes';

// The test environment has no DOM, so each mode's element and side bar are
// plain objects holding `hidden`; `calls` records the deps the registry drives,
// each mode's `shown` and `hidden`, and each change heard; `told` records each
// mode's `sideBarHidden` and `sideBarOpenedOver`.
function setup(isNarrow = false) {
  const logs: string[] = [];
  const calls: string[] = [];
  const told: string[] = [];
  const modes = createModes({
    place: (mode) => calls.push(`place ${mode.id}`),
    marked: (modeId) => calls.push(`marked ${modeId}`),
    layOutSideBar: (layout) => calls.push(`side bar ${layout}`),
    showContext: (context) => calls.push(`context ${context?.title ?? null}`),
    isNarrow,
    log: (source, message) => logs.push(`[${source}] ${message}`),
  });
  modes.onChanged((modeId) => calls.push(`changed ${modeId}`));
  const add = (id: string, title: string, hasSideBar = false) => {
    const element = { hidden: false } as HTMLElement;
    const sideBar = hasSideBar ? ({ hidden: false } as HTMLElement) : undefined;
    const handle = modes.add({
      id,
      title,
      icon: 'x',
      element,
      sideBar,
      shown: () => calls.push(`shown ${id}`),
      hidden: () => calls.push(`hidden ${id}`),
      sideBarHidden: () => told.push(`side bar hidden ${id}`),
      sideBarOpenedOver: () => told.push(`opened over ${id}`),
    });
    return { element, sideBar, handle };
  };
  return { modes, logs, calls, told, add };
}

describe('createModes', () => {
  it('shows the first mode added and hides later ones', () => {
    const { modes, logs, calls, add } = setup();

    const one = add('a.one', 'One');
    const two = add('b.two', 'Two');

    expect(one.element.hidden).toBe(false);
    expect(two.element.hidden).toBe(true);
    expect(modes.shown()).toBe('a.one');
    expect(logs).toEqual(['[page] showed One mode']);
    expect(calls).toEqual([
      'place a.one',
      'marked a.one',
      'side bar hidden',
      'context null',
      'shown a.one',
      'place b.two',
    ]);
  });

  it('hides the shown mode and shows another, telling each mode, then listeners', () => {
    const { modes, logs, calls, add } = setup();
    const one = add('a.one', 'One');
    const two = add('b.two', 'Two');

    two.handle.show();

    expect(one.element.hidden).toBe(true);
    expect(two.element.hidden).toBe(false);
    expect(modes.shown()).toBe('b.two');
    expect(calls).toEqual([
      'place a.one',
      'marked a.one',
      'side bar hidden',
      'context null',
      'shown a.one',
      'place b.two',
      'hidden a.one',
      'marked b.two',
      'side bar hidden',
      'context null',
      'shown b.two',
      'changed b.two',
    ]);
    expect(logs.at(-1)).toBe('[page] showed Two mode');
    expect(two.handle.isShown()).toBe(true);
    expect(one.handle.isShown()).toBe(false);
  });

  it('does nothing when the shown mode shows again', () => {
    const { logs, calls, add } = setup();
    const one = add('a.one', 'One');
    add('b.two', 'Two');
    const before = [...calls];

    one.handle.show();

    expect(calls).toEqual(before);
    expect(logs).toEqual(['[page] showed One mode']);
  });

  it('rejects a mode id added twice', () => {
    const { add } = setup();
    add('a.one', 'One');

    expect(() => add('a.one', 'One')).toThrow('Mode "a.one" is added twice');
  });

  it('has no shown mode before the first is added', () => {
    const { modes } = setup();

    expect(() => modes.shown()).toThrow('No mode is added yet');
  });

  it("hides other modes' side bars and lays out the shown one's", () => {
    const { calls, add } = setup();
    const one = add('a.one', 'One', true);
    const two = add('b.two', 'Two', true);

    expect(one.sideBar?.hidden).toBe(false);
    expect(two.sideBar?.hidden).toBe(true);
    expect(calls).toContain('side bar beside');

    calls.length = 0;
    two.handle.show();

    expect(one.sideBar?.hidden).toBe(true);
    expect(two.sideBar?.hidden).toBe(false);
    expect(calls).toContain('side bar beside');
  });

  it('toggleSideBar hides and shows the side bar while wide, logging each', () => {
    const { logs, calls, add } = setup();
    const one = add('a.one', 'One', true);

    calls.length = 0;
    one.handle.toggleSideBar();

    expect(calls).toEqual(['side bar hidden']);
    expect(logs.at(-1)).toBe('[page] side bar hidden');
    expect(one.handle.sideBarShown()).toBe(false);

    calls.length = 0;
    one.handle.toggleSideBar();

    expect(calls).toEqual(['side bar beside']);
    expect(logs.at(-1)).toBe('[page] side bar shown');
    expect(one.handle.sideBarShown()).toBe(true);
  });

  it('toggleSideBar opens the side bar over the content while narrow', () => {
    const { logs, calls, add } = setup(true);
    const one = add('a.one', 'One', true);

    expect(calls).toContain('side bar hidden');

    calls.length = 0;
    one.handle.toggleSideBar();

    expect(calls).toEqual(['side bar over']);
    expect(logs.at(-1)).toBe('[page] side bar shown over the content');
    expect(one.handle.sideBarShown()).toBe(true);
  });

  it('narrowChanged closes the overlay on widening and keeps the hidden choice', () => {
    const { modes, calls, add } = setup(true);
    const one = add('a.one', 'One', true);
    one.handle.toggleSideBar();

    calls.length = 0;
    modes.narrowChanged(false);
    one.handle.toggleSideBar();
    modes.narrowChanged(true);
    modes.narrowChanged(false);

    expect(calls).toEqual([
      'side bar beside',
      'side bar hidden',
      'side bar hidden',
      'side bar hidden',
    ]);
  });

  it("keeps each mode's side bar choice across shows", () => {
    const { calls, add } = setup();
    const one = add('a.one', 'One', true);
    const two = add('b.two', 'Two', true);
    one.handle.toggleSideBar();

    calls.length = 0;
    two.handle.show();
    expect(calls).toContain('side bar beside');

    calls.length = 0;
    one.handle.show();
    expect(calls).toContain('side bar hidden');
  });

  it('toggleSideBar on a hidden mode changes its choice only', () => {
    const { logs, calls, add } = setup();
    add('a.one', 'One', true);
    const two = add('b.two', 'Two', true);
    const logged = logs.length;

    calls.length = 0;
    two.handle.toggleSideBar();

    expect(calls).toEqual([]);
    expect(logs).toHaveLength(logged);

    two.handle.show();
    expect(calls).toContain('side bar hidden');
  });

  it('toggleSideBar throws on a mode with no side bar', () => {
    const { add } = setup();
    const one = add('a.one', 'One');

    expect(() => one.handle.toggleSideBar()).toThrow(
      'Mode "a.one" has no side bar',
    );
  });

  it('picked closes the overlay while narrow, logging it', () => {
    const { logs, calls, add } = setup(true);
    const one = add('a.one', 'One', true);
    one.handle.toggleSideBar();

    calls.length = 0;
    one.handle.picked();

    expect(calls).toEqual(['side bar hidden']);
    expect(logs.at(-1)).toBe('[page] side bar hidden');
    expect(one.handle.sideBarShown()).toBe(false);
  });

  it('picked does nothing while wide', () => {
    const { logs, calls, add } = setup();
    const one = add('a.one', 'One', true);
    calls.length = 0;
    const logged = logs.length;

    one.handle.picked();

    expect(calls).toEqual([]);
    expect(logs).toHaveLength(logged);
    expect(one.handle.sideBarShown()).toBe(true);
  });

  it("picked on a hidden mode while narrow leaves the shown mode's overlay open", () => {
    const { modes, logs, calls, add } = setup(true);
    const one = add('a.one', 'One', true);
    const two = add('b.two', 'Two', true);
    one.handle.toggleSideBar();
    two.handle.toggleSideBar();
    const logged = logs.length;

    calls.length = 0;
    two.handle.picked();

    expect(calls).toEqual([]);
    expect(logs).toHaveLength(logged);
    expect(modes.shown()).toBe('a.one');
    expect(one.handle.sideBarShown()).toBe(true);
  });

  it('picked on a hidden mode while narrow closes its overlay for its next show', () => {
    const { calls, add } = setup(true);
    add('a.one', 'One', true);
    const two = add('b.two', 'Two', true);
    two.handle.toggleSideBar();
    two.handle.picked();

    calls.length = 0;
    two.handle.show();

    expect(calls).toContain('side bar hidden');
    expect(calls).not.toContain('side bar over');
    expect(two.handle.sideBarShown()).toBe(false);
  });

  it('picked on a mode with no side bar does nothing', () => {
    const { calls, add } = setup(true);
    const one = add('a.one', 'One');
    calls.length = 0;

    expect(() => one.handle.picked()).not.toThrow();
    expect(calls).toEqual([]);
  });

  it("shows the shown mode's context and keeps a hidden mode's for its show", () => {
    const { calls, add } = setup();
    const one = add('a.one', 'One');
    const two = add('b.two', 'Two');

    calls.length = 0;
    one.handle.setContext({ title: 's1', detail: '/p' });
    expect(calls).toEqual(['context s1']);

    calls.length = 0;
    two.handle.setContext({ title: 'd', detail: null });
    expect(calls).toEqual([]);

    two.handle.show();
    expect(calls).toContain('context d');

    calls.length = 0;
    one.handle.show();
    expect(calls).toContain('context s1');

    calls.length = 0;
    one.handle.setContext(null);
    expect(calls).toEqual(['context null']);
  });
});

describe('side bar callbacks', () => {
  it('toggleSideBar tells the shown mode its side bar hid while wide', () => {
    const { told, add } = setup();
    const one = add('a.one', 'One', true);

    one.handle.toggleSideBar();
    expect(told).toEqual(['side bar hidden a.one']);

    one.handle.toggleSideBar();
    expect(told).toEqual(['side bar hidden a.one']);
  });

  it('toggleSideBar tells the shown mode its overlay opened and closed while narrow', () => {
    const { told, add } = setup(true);
    const one = add('a.one', 'One', true);
    told.length = 0;

    one.handle.toggleSideBar();
    one.handle.toggleSideBar();

    expect(told).toEqual(['opened over a.one', 'side bar hidden a.one']);
  });

  it('picked tells the shown mode its overlay closed, and nothing once closed', () => {
    const { told, add } = setup(true);
    const one = add('a.one', 'One', true);
    one.handle.toggleSideBar();
    told.length = 0;

    one.handle.picked();
    one.handle.picked();

    expect(told).toEqual(['side bar hidden a.one']);
  });

  it('narrowChanged tells nothing across a narrow-and-widen round trip', () => {
    const { modes, told, add } = setup();
    add('a.one', 'One', true);
    add('b.two', 'Two', true);

    modes.narrowChanged(true);
    modes.narrowChanged(false);

    expect(told).toEqual([]);
  });

  it('narrowChanged tells the shown mode its overlay closed as widening hides its side bar', () => {
    const { modes, told, add } = setup();
    const one = add('a.one', 'One', true);
    one.handle.toggleSideBar();
    modes.narrowChanged(true);
    one.handle.toggleSideBar();
    told.length = 0;

    modes.narrowChanged(false);

    expect(told).toEqual(['side bar hidden a.one']);
  });

  it('narrowChanged tells nothing of a side bar the user already hid', () => {
    const { modes, told, add } = setup();
    const one = add('a.one', 'One', true);
    one.handle.toggleSideBar();
    told.length = 0;

    modes.narrowChanged(true);
    modes.narrowChanged(false);
    one.handle.picked();

    expect(told).toEqual([]);
  });

  it('tells a hidden mode nothing', () => {
    const { modes, told, add } = setup(true);
    add('a.one', 'One', true);
    const two = add('b.two', 'Two', true);
    told.length = 0;

    two.handle.toggleSideBar();
    two.handle.picked();
    modes.narrowChanged(false);
    modes.narrowChanged(true);

    expect(told).toEqual([]);
  });

  it('tells each mode as it shows whether its side bar starts hidden or over', () => {
    const { told, add } = setup(true);
    const one = add('a.one', 'One', true);
    const two = add('b.two', 'Two', true);
    two.handle.toggleSideBar();

    two.handle.show();
    one.handle.show();

    expect(told).toEqual([
      'side bar hidden a.one',
      'opened over b.two',
      'side bar hidden a.one',
    ]);
  });

  it('calls sideBarHidden after shown, and tells a mode with no side bar nothing', () => {
    const events: string[] = [];
    const modes = createModes({
      place: () => undefined,
      marked: () => undefined,
      layOutSideBar: () => undefined,
      showContext: () => undefined,
      isNarrow: true,
      log: () => undefined,
    });
    const addMode = (id: string, sideBar?: HTMLElement) =>
      modes.add({
        id,
        title: id,
        icon: 'x',
        element: { hidden: false } as HTMLElement,
        sideBar,
        shown: () => events.push(`shown ${id}`),
        hidden: () => undefined,
        sideBarHidden: () => events.push(`side bar hidden ${id}`),
      });
    addMode('a.one', { hidden: false } as HTMLElement);
    const two = addMode('b.two');

    two.show();

    expect(events).toEqual([
      'shown a.one',
      'side bar hidden a.one',
      'shown b.two',
    ]);
  });
});

describe('side bar layout', () => {
  it('sideBarLayout draws beside or hidden while wide, over or hidden while narrow', () => {
    expect(sideBarLayout(SIDE_BAR_START, false)).toBe('beside');
    expect(
      sideBarLayout({ isHiddenWide: true, isOverlayOpen: false }, false),
    ).toBe('hidden');
    expect(sideBarLayout(SIDE_BAR_START, true)).toBe('hidden');
    expect(
      sideBarLayout({ isHiddenWide: false, isOverlayOpen: true }, true),
    ).toBe('over');
    expect(
      sideBarLayout({ isHiddenWide: true, isOverlayOpen: true }, true),
    ).toBe('over');
  });

  it('toggledSideBar flips the hidden flag while wide and the overlay while narrow', () => {
    expect(toggledSideBar(SIDE_BAR_START, false)).toEqual({
      isHiddenWide: true,
      isOverlayOpen: false,
    });
    expect(toggledSideBar(SIDE_BAR_START, true)).toEqual({
      isHiddenWide: false,
      isOverlayOpen: true,
    });
    expect(
      toggledSideBar({ isHiddenWide: true, isOverlayOpen: true }, true),
    ).toEqual({ isHiddenWide: true, isOverlayOpen: false });
  });

  it("sideBarAfterResize closes the overlay when the window widens and keeps the user's hidden choice", () => {
    expect(
      sideBarAfterResize({ isHiddenWide: true, isOverlayOpen: true }, false),
    ).toEqual({ isHiddenWide: true, isOverlayOpen: false });
    expect(
      sideBarAfterResize({ isHiddenWide: false, isOverlayOpen: true }, true),
    ).toEqual({ isHiddenWide: false, isOverlayOpen: true });
  });

  it("sideBarAfterPick closes the overlay and keeps the user's hidden choice", () => {
    expect(
      sideBarAfterPick({ isHiddenWide: true, isOverlayOpen: true }),
    ).toEqual({ isHiddenWide: true, isOverlayOpen: false });
    expect(
      sideBarAfterPick({ isHiddenWide: false, isOverlayOpen: false }),
    ).toEqual({ isHiddenWide: false, isOverlayOpen: false });
  });
});
