import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANE_FOCUS_COMMANDS } from '../../../contracts/panes';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import { installMarkdownDom } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  FocusFakeElement,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type {
  SessionPopupHandle,
  SessionPopupView,
  SessionTabView,
} from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { sessionsViewSetup, stateOf } from './sessions-view-fakes';

type Setup = ReturnType<typeof sessionsViewSetup>;

function tabView(id: string, order?: number): SessionTabView {
  return {
    id,
    title: `title ${id}`,
    icon: 'comment',
    element: asHtml(new FakeElement('div')),
    order,
    beforeClose: () => true,
    shown: () => undefined,
  };
}

function popupView(id: string): SessionPopupView {
  return {
    id,
    title: `title ${id}`,
    icon: 'bell',
    element: asHtml(new FakeElement('div')),
    beforeClose: () => true,
    shown: () => undefined,
  };
}

// The frame holding `tab`: tab, body, sheet, frame.
function frameOf(tab: SessionTabView): FakeElement {
  return asFake(tab.element).parentNode!.parentNode!.parentNode!;
}

const TWO_PANES = {
  root: {
    kind: 'split' as const,
    axis: 'row' as const,
    ratio: 0.5,
    first: { kind: 'leaf' as const, id: 'pane-1' },
    second: { kind: 'leaf' as const, id: 'pane-2' },
  },
  focusedId: 'pane-1',
};

// A view with session `a` in pane-2 and the focused pane-1 empty, showing its
// focus edge and its text, which holds the pick hint.
function viewWithFramedAndEmptyPane() {
  const { view, area, anchors } = sessionsViewSetup();
  view.tabs.add('a', tabView('a'));
  view.render(stateOf(['a'], 'a'));
  view.panes.restore(TWO_PANES, new Map([['pane-2', 'a']]));
  const pickHint = findAll(area, 'sessions-pick-hint')[0]!;
  expect(pickHint.parentNode).not.toBeNull();
  const liveFocusEdges = () =>
    anchors.filter(
      (anchor) =>
        anchor.command.endsWith(PANE_FOCUS_COMMANDS.right) &&
        !anchor.isDisposed,
    );
  expect(liveFocusEdges()).toHaveLength(1);
  return { view, area, pickHint, liveFocusEdges };
}

let moves: { element: unknown; to: unknown }[];
// The animation frames requested and not yet run.
let pendingFrames: (() => void)[];

beforeEach(() => {
  ({ moves } = installMarkdownDom(vi.stubGlobal));
  pendingFrames = [];
  vi.stubGlobal('requestAnimationFrame', (run: () => void) =>
    pendingFrames.push(run),
  );
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

function runFrames() {
  for (const run of pendingFrames.splice(0)) {
    run();
  }
}

// A view showing session `s` in its one pane, counting each `tabsChanged`.
function popupSetup() {
  let changes = 0;
  const setup = sessionsViewSetup(undefined, undefined, undefined, {
    tabsChanged: () => {
      changes++;
    },
  });
  setup.view.render(stateOf(['s'], 's'));
  setup.view.panes.load(setup.view.panes.focusedPaneId(), 's');
  return { ...setup, changes: () => changes };
}

// What the frames in `area` show of their popups: the title of each root
// carrying `is-open`, of each root that is `inert`, and each hidden bar
// entry's text.
function popupsShown(area: FakeElement) {
  const roots = findAll(area, 'session-popup');
  const titles = (shown: FakeElement[]) =>
    shown.map((root) => root.attributes.get('aria-label'));
  return {
    open: titles(roots.filter((root) => root.classList.contains('is-open'))),
    inert: titles(roots.filter((root) => root.inert)),
    bar: findAll(area, 'session-popup-bar-entry').map(
      (entry) => entry.textContent,
    ),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session tabs view', () => {
  it.each<{ case: string; act(setup: Setup): void; moved: string[] }>([
    {
      case: 'a session switch',
      act: ({ view }) => view.panes.load('pane-1', 'b'),
      moved: ['a', 'b'],
    },
    {
      case: 'a focus change',
      act: ({ view }) => view.panes.focus('pane-2'),
      moved: [],
    },
    {
      case: 'a layout redraw',
      act: ({ view }) => view.setLayouts(withUser<Layout>(defaultLayout, {})),
      moved: ['a', 'c'],
    },
    {
      case: 'a pane close',
      act: ({ view }) => view.panes.close('pane-2'),
      moved: ['c'],
    },
    {
      case: 'a restore dropping a pane',
      act: ({ view }) =>
        view.panes.restore(
          { root: { kind: 'leaf', id: 'pane-1' }, focusedId: 'pane-1' },
          new Map([['pane-1', 'a']]),
        ),
      moved: ['c'],
    },
  ])('sessionsView_FramesMoved_MoveConnected ($case)', ({ act, moved }) => {
    const setup = sessionsViewSetup();
    setup.area.isPageRoot = true;
    const tabs = { a: tabView('a'), b: tabView('b'), c: tabView('c') };
    for (const [sessionId, tab] of Object.entries(tabs)) {
      setup.view.tabs.add(sessionId, tab);
    }
    setup.view.render(stateOf(['a', 'b', 'c'], 'a'));
    setup.view.panes.restore(
      TWO_PANES,
      new Map([
        ['pane-1', 'a'],
        ['pane-2', 'c'],
      ]),
    );
    const before = new Map(
      Object.entries(tabs).map(([id, tab]) => [id, frameOf(tab).parentNode]),
    );
    moves.length = 0;

    act(setup);

    const changed = Object.entries(tabs).filter(
      ([id, tab]) => frameOf(tab).parentNode !== before.get(id),
    );
    expect(changed.map(([id]) => id)).toEqual(moved);
    for (const [, tab] of changed) {
      const frame = frameOf(tab);
      expect(frame.isConnected).toBe(true);
      expect(moves).toContainEqual({ element: frame, to: frame.parentNode });
    }
  });

  it('sessionTabs_TabsWithAnOrder_DrawInTheOrdersStripOrder', () => {
    const { view, area } = sessionsViewSetup();
    view.tabs.add('s', tabView('form'));
    view.tabs.add('s', tabView('chat', 2));
    view.tabs.add('s', tabView('primer'));
    view.tabs.add('s', tabView('docs', 1));
    view.render(stateOf(['s'], 's'));
    view.panes.restore(
      { root: { kind: 'leaf', id: 'pane-1' }, focusedId: 'pane-1' },
      new Map([['pane-1', 's']]),
    );
    const strip = ['docs', 'chat', 'form', 'primer'];

    expect(view.tabs.tabsOf('s').map((tab) => tab.id)).toEqual(strip);
    expect(findAll(area, 'ui-tab').map((tab) => tab.title)).toEqual(
      strip.map((id) => `title ${id}`),
    );
  });

  it('sessionTabs_SelectedTabRemoved_SelectsItsStripNeighbour', () => {
    const { view } = sessionsViewSetup();
    const chat = view.tabs.add('s', tabView('chat', 2));
    view.tabs.add('s', tabView('docs', 1));
    view.tabs.add('s', tabView('form'));

    chat.dispose();

    expect(view.tabs.selectedTabOf('s')?.id).toBe('form');
  });

  it('a disposed view leaves no pane part or empty text live', () => {
    const { view, pickHint, liveFocusEdges } = viewWithFramedAndEmptyPane();

    view.dispose();

    expect(liveFocusEdges()).toEqual([]);
    expect(pickHint.parentNode).toBeNull();
  });

  it.each([
    { case: "a frame's throw still drops the panes", throwing: 'session-area' },
    {
      case: "a pane text's throw still disposes that pane's part",
      throwing: 'sessions-empty',
    },
  ])('a disposed view drops what follows a throw ($case)', ({ throwing }) => {
    const { view, area, pickHint, liveFocusEdges } =
      viewWithFramedAndEmptyPane();
    vi.spyOn(findAll(area, throwing)[0]!, 'remove').mockImplementation(() => {
      throw new Error(`${throwing} refused`);
    });

    expect(() => view.dispose()).toThrow(`${throwing} refused`);

    expect(liveFocusEdges()).toEqual([]);
    expect(pickHint.parentNode).toBeNull();
  });

  it.each<{ case: string; pane: Layout['pane']; keepsPart: boolean }>([
    { case: 'an update', pane: undefined, keepsPart: true },
    {
      case: 'no update',
      pane: (parent, _input, kit) => {
        const element = kit.el(parent, 'div', 'session-pane');
        return { element, body: kit.el(element, 'div') };
      },
      keepsPart: false,
    },
    {
      case: 'an update that throws',
      pane: (parent, _input, kit) => {
        const element = kit.el(parent, 'div', 'session-pane');
        return {
          element,
          body: kit.el(element, 'div'),
          update: () => {
            throw new Error('broken');
          },
        };
      },
      keepsPart: false,
    },
  ])(
    'sessionsView_FocusChange_KeepsPartWithUpdate ($case)',
    ({ pane, keepsPart }) => {
      const setup = sessionsViewSetup();
      setup.area.isPageRoot = true;
      setup.view.setLayouts(withUser<Layout>(defaultLayout, { pane }));
      const a = tabView('a');
      const c = tabView('c');
      setup.view.tabs.add('a', a);
      setup.view.tabs.add('c', c);
      setup.view.render(stateOf(['a', 'c'], 'a'));
      setup.view.panes.restore(
        TWO_PANES,
        new Map([
          ['pane-1', 'a'],
          ['pane-2', 'c'],
        ]),
      );
      const [, pressed] = findAll(setup.area, 'session-pane');

      setup.view.panes.focus('pane-2');

      expect(findAll(setup.area, 'session-pane')[1] === pressed).toBe(
        keepsPart,
      );
      expect(frameOf(c).isConnected).toBe(true);
    },
  );

  it('sessionsView_FocusChange_UpdatesPaneInPlace', () => {
    const setup = sessionsViewSetup();
    setup.area.isPageRoot = true;
    setup.view.tabs.add('a', tabView('a'));
    setup.view.tabs.add('c', tabView('c'));
    setup.view.render(stateOf(['a', 'c'], 'a'));
    setup.view.panes.restore(
      TWO_PANES,
      new Map([
        ['pane-1', 'a'],
        ['pane-2', 'c'],
      ]),
    );
    const [first, second] = findAll(setup.area, 'session-pane');
    const edgeClasses = (pane: FakeElement) =>
      findAll(pane, 'session-pane-edge').map((edge) => edge.className);
    const expectFocused = (focused: FakeElement, other: FakeElement) => {
      expect(focused.classList.contains('is-focused')).toBe(true);
      expect(other.classList.contains('is-focused')).toBe(false);
      expect(edgeClasses(other)).toEqual([]);
    };
    expectFocused(first, second);
    const firstEdges = edgeClasses(first);

    setup.view.panes.focus('pane-2');

    expectFocused(second, first);
    expect(edgeClasses(second)).toHaveLength(1);
    expect(edgeClasses(second)[0]).toContain('is-left');

    setup.view.panes.focus('pane-1');

    expectFocused(first, second);
    expect(edgeClasses(first)).toEqual(firstEdges);
  });
});

describe('session popups', () => {
  it.each<{ case: string; steps: string[]; open: string[]; bar: string[] }>([
    {
      case: 'the last added shows',
      steps: ['add a', 'add b'],
      open: ['title b'],
      bar: [],
    },
    {
      case: 'the top one hidden shows the one under it',
      steps: ['add a', 'add b', 'hide b'],
      open: ['title a'],
      bar: ['title b'],
    },
    {
      case: 'the top one disposed shows the one under it, no bar',
      steps: ['add a', 'add b', 'dispose b'],
      open: ['title a'],
      bar: [],
    },
    {
      case: 'both hidden list newest hidden first',
      steps: ['add a', 'add b', 'hide b', 'hide a'],
      open: [],
      bar: ['title a', 'title b'],
    },
    {
      case: 'a bar entry clicked opens its popup',
      steps: ['add a', 'add b', 'hide b', 'hide a', 'click b'],
      open: ['title b'],
      bar: ['title a'],
    },
    {
      case: 'open lifts a covered popup over the top one',
      steps: ['add a', 'add b', 'open a'],
      open: ['title a'],
      bar: [],
    },
    {
      case: 'a popup added over a hidden one shows',
      steps: ['add a', 'hide a', 'add b'],
      open: ['title b'],
      bar: ['title a'],
    },
    {
      case: 'the toggle hides the top open popup',
      steps: ['add a', 'add b', 'toggle'],
      open: ['title a'],
      bar: ['title b'],
    },
    {
      case: 'the toggle opens the popup hidden last',
      steps: ['add a', 'add b', 'hide b', 'hide a', 'toggle'],
      open: ['title a'],
      bar: ['title b'],
    },
  ])('sessionPopups_Steps_ShowTheTopOpenAndBarTheHidden ($case)', (test) => {
    const { view, area } = popupSetup();
    const handles = new Map<string, SessionPopupHandle>();

    for (const step of test.steps) {
      const [verb, id = ''] = step.split(' ');
      if (verb === 'add') {
        handles.set(id, view.tabs.addPopup('s', popupView(id)));
      } else if (verb === 'hide') {
        handles.get(id)!.hide();
      } else if (verb === 'open') {
        handles.get(id)!.open();
      } else if (verb === 'dispose') {
        handles.get(id)!.dispose();
      } else if (verb === 'toggle') {
        view.tabs.togglePopup('s');
      } else {
        const entries = findAll(area, 'session-popup-bar-entry');
        entries.find((entry) => entry.textContent === `title ${id}`)!.click();
      }
      runFrames();
    }

    const shown = popupsShown(area);
    expect({ open: shown.open, bar: shown.bar }).toEqual({
      open: test.open,
      bar: test.bar,
    });
    expect(view.tabs.openPopupOf('s')?.title ?? null).toBe(
      test.open[0] ?? null,
    );
  });

  it('sessionPopups_Added_OpensOnTheNextFrameAndInertWhileNotOpen', () => {
    const { view, area } = popupSetup();

    const handle = view.tabs.addPopup('s', popupView('a'));

    expect(popupsShown(area)).toEqual({
      open: [],
      inert: ['title a'],
      bar: [],
    });
    runFrames();
    expect(popupsShown(area)).toEqual({
      open: ['title a'],
      inert: [],
      bar: [],
    });
    handle.hide();
    expect(popupsShown(area)).toEqual({
      open: [],
      inert: ['title a'],
      bar: ['title a'],
    });
  });

  it('sessionPopups_OpenPopup_HidesTheTabFromIsVisible', () => {
    const { view } = popupSetup();
    const tab = view.tabs.add('s', tabView('chat'));

    const popup = view.tabs.addPopup('s', popupView('a'));
    const whilePopupOpen = [tab.isVisible(), popup.isVisible()];
    popup.hide();

    expect(whilePopupOpen).toEqual([false, true]);
    expect([tab.isVisible(), popup.isVisible()]).toEqual([true, false]);
  });

  it('sessionPopups_Statuses_FollowTheTabs', () => {
    const { view } = popupSetup();
    view.tabs.add('s', tabView('chat')).setStatus('T1');
    view.tabs.addPopup('s', popupView('a')).setStatus('R1');

    expect(view.tabs.statusesOf('s')).toEqual(['T1', 'R1']);
  });

  it('sessionPopups_SecondPopupWithOneId_Throws', () => {
    const { view } = popupSetup();
    view.tabs.addPopup('s', popupView('a'));

    expect(() => view.tabs.addPopup('s', popupView('a'))).toThrow(
      'already has a popup "a"',
    );
  });

  it('sessionPopups_OpenOnTheTopPopup_ChangesNothing', () => {
    const { view, changes } = popupSetup();
    const handle = view.tabs.addPopup('s', popupView('a'));
    const before = changes();

    handle.open();

    expect(changes()).toBe(before);
  });

  it('sessionPopups_DroppedPopup_HandleDoesNothing', () => {
    const { view, area, changes } = popupSetup();
    const handle = view.tabs.addPopup('s', popupView('a'));
    view.tabs.drop('s');
    const before = changes();

    handle.hide();
    handle.open();
    handle.setStatus('R1');
    handle.dispose();

    expect(changes()).toBe(before);
    expect(handle.isVisible()).toBe(false);
    expect(popupsShown(area).open).toEqual([]);
  });

  it.each([
    {
      case: 'a box in the tabs loses focus',
      isInTabs: true,
      keepsFocus: false,
    },
    { case: 'a box elsewhere keeps it', isInTabs: false, keepsFocus: true },
  ])('sessionPopups_PopupOpens_TakesFocusFromTheTabs ($case)', (test) => {
    const doc = installFocusFakeDom((name, value) =>
      vi.stubGlobal(name, value),
    );
    const { view } = popupSetup();
    const chat = tabView('chat');
    view.tabs.add('s', chat);
    const box = new FocusFakeElement('textarea');
    if (test.isInTabs) {
      asFake(chat.element).append(box);
    }
    box.focus();

    view.tabs.addPopup('s', popupView('a'));

    expect(doc.activeElement === box).toBe(test.keepsFocus);
  });

  it('sessionPopups_LayoutRedraw_MovesTheElementConnectedAndKeepsItOpen', () => {
    const setup = popupSetup();
    setup.area.isPageRoot = true;
    const popup = popupView('a');
    setup.view.tabs.addPopup('s', popup);
    runFrames();
    moves.length = 0;

    setup.view.setLayouts(withUser<Layout>(defaultLayout, {}));

    const element = asFake(popup.element);
    expect(element.isConnected).toBe(true);
    expect(moves).toContainEqual({ element, to: element.parentNode });
    expect(findAll(setup.area, 'session-popup')).toHaveLength(1);
    expect(popupsShown(setup.area).open).toEqual(['title a']);
  });
});
