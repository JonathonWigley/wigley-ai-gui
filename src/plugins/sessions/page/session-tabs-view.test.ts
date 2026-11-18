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
import { createSlotStore } from '../../../shared/state/slot-store';
import {
  type SessionPopupHandle,
  type SessionPopupView,
  type SessionsPlace,
  sessionsPlaceSlot,
  type SessionTabView,
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

// A view over session `s`'s place `saved`, as the last page left it.
function viewOverSavedPlace(saved: SessionsPlace) {
  const places = createSlotStore(() => undefined).publish(sessionsPlaceSlot);
  places.set('s', saved);
  const { view } = sessionsViewSetup(undefined, undefined, undefined, {
    places,
  });
  const selected = () => view.tabs.selectedTabOf('s')?.id;
  const savedSelectedTabId = () => places.get('s')?.selectedTabId;
  const savedHiddenPopupIds = () => places.get('s')?.hiddenPopupIds;
  return { view, selected, savedSelectedTabId, savedHiddenPopupIds };
}

let moves: { element: unknown; to: unknown }[];

beforeEach(() => {
  ({ moves } = installMarkdownDom(vi.stubGlobal));
});

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
// carrying `is-open`, of each carrying `is-entering`, of each root that is
// `inert`, and each hidden bar entry's text.
function popupsShown(area: FakeElement) {
  const roots = findAll(area, 'session-popup');
  const titles = (shown: FakeElement[]) =>
    shown.map((root) => root.attributes.get('aria-label'));
  return {
    open: titles(roots.filter((root) => root.classList.contains('is-open'))),
    entering: titles(
      roots.filter((root) => root.classList.contains('is-entering')),
    ),
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

  it('tab_Click_RunsSelectTab', () => {
    const { view, area, runs } = sessionsViewSetup();
    view.tabs.add('s', tabView('chat'));
    view.tabs.add('s', tabView('docs'));
    view.render(stateOf(['s'], 's'));
    view.panes.restore(
      { root: { kind: 'leaf', id: 'pane-1' }, focusedId: 'pane-1' },
      new Map([['pane-1', 's']]),
    );

    findAll(area, 'ui-tab')
      .find((tab) => tab.title === 'title docs')
      ?.click();

    expect(runs).toEqual([
      ['sessions.selectTab', { sessionId: 's', tab: 'docs' }],
    ]);
    expect(view.tabs.selectedTabOf('s')?.id).toBe('docs');
  });

  // Breaks: a draw that empties the strip and draws every tab again.
  it('a draw keeps each unchanged tab element, so a release that moves pane focus leaves the click its target', () => {
    const { view, area, runs } = sessionsViewSetup();
    view.tabs.add('s', tabView('a'));
    view.tabs.add('s', tabView('b'));
    view.render(stateOf(['r', 's'], 'r'));
    view.panes.restore(
      TWO_PANES,
      new Map([
        ['pane-1', 'r'],
        ['pane-2', 's'],
      ]),
    );
    const tabB = () =>
      findAll(area, 'ui-tab').find((tab) => tab.title === 'title b');
    const pressed = tabB();

    view.panes.focus('pane-2');
    const afterFocus = tabB();
    const runsBeforeClick = runs.length;
    pressed!.click();

    expect(afterFocus).toBe(pressed);
    expect(runs.slice(runsBeforeClick)).toEqual([
      ['sessions.selectTab', { sessionId: 's', tab: 'b' }],
    ]);
  });

  // Breaks: a removal that draws the kept tabs again or leaves the removed
  // one in the strip.
  it('a removed tab leaves the strip while the others keep their elements', () => {
    const { view, area } = sessionsViewSetup();
    const [, b] = ['a', 'b', 'c'].map((id) => view.tabs.add('s', tabView(id)));
    view.render(stateOf(['s'], 's'));
    view.panes.restore(
      { root: { kind: 'leaf', id: 'pane-1' }, focusedId: 'pane-1' },
      new Map([['pane-1', 's']]),
    );
    const [tabA, , tabC] = findAll(area, 'ui-tab');

    b.dispose();

    const strip = findAll(area, 'ui-tab');
    expect(strip).toHaveLength(2);
    expect(strip[0]).toBe(tabA);
    expect(strip[1]).toBe(tabC);
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

  it("a dropped session whose tab's dispose throws still disposes the rest, leaves the page and redraws", () => {
    const { view, area, anchors } = sessionsViewSetup();
    area.isPageRoot = true;
    view.setLayouts(
      withUser<Layout>(defaultLayout, {
        tab: (parent, _input, kit) => {
          const element = kit.el(parent, 'button', 'ui-tab');
          kit.keyHint(element, 'selectTab');
          return { element };
        },
      }),
    );
    const a = tabView('a');
    view.tabs.add('s', a);
    view.tabs.add('s', tabView('b'));
    view.render(stateOf(['s'], 's'));
    view.panes.restore(TWO_PANES, new Map([['pane-2', 's']]));
    const frame = frameOf(a);
    const frameAnchors = anchors.filter(
      (anchor) => !anchor.isDisposed && frame.contains(asFake(anchor.element)),
    );
    const tabAnchors = frameAnchors.filter((anchor) =>
      anchor.command.endsWith('selectTab'),
    );
    expect(tabAnchors).toHaveLength(2);
    tabAnchors[0]!.disposeError = new Error('tab refused');
    const pickHint = findAll(area, 'sessions-pick-hint')[0]!;

    expect(() => view.tabs.drop('s')).toThrow('tab refused');

    expect(frameAnchors.filter((anchor) => !anchor.isDisposed)).toEqual([]);
    expect(frame.isConnected).toBe(false);
    expect(view.tabs.tabsOf('s')).toEqual([]);
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

  it('late_tab_takes_back_its_saved_selection_and_the_place_keeps_it_until_then', () => {
    const { view, selected, savedSelectedTabId } = viewOverSavedPlace({
      selectedTabId: 'form',
      selections: 0,
      hiddenPopupIds: [],
    });
    view.tabs.add('s', tabView('chat'));
    view.tabs.add('s', tabView('docs'));
    expect(savedSelectedTabId()).toBe('form');

    view.tabs.add('s', tabView('form'));

    expect(selected()).toBe('form');
    expect(savedSelectedTabId()).toBe('form');
  });

  // Breaks if removing the selected tab forgets it: a plugin's restart
  // removes its tab and adds it again, and the session would stay on the
  // neighbour the removal selected.
  it.each([
    {
      case: 'no pick between: the tab takes the selection back',
      steps: ['remove chat', 'add chat'],
      saved: 'chat',
      selected: 'chat',
    },
    {
      case: 'a pick between keeps the pick',
      steps: ['remove chat', 'pick form', 'add chat'],
      saved: 'form',
      selected: 'form',
    },
    {
      case: 'the neighbour removed too: the first removed stays named',
      steps: ['remove chat', 'remove docs', 'add docs', 'add chat'],
      saved: 'chat',
      selected: 'chat',
    },
  ])(
    'selectedTab_RemovedThenAddedAgain_TakesTheSelectionBack ($case)',
    ({ steps, saved, selected }) => {
      const places = createSlotStore(() => undefined).publish(
        sessionsPlaceSlot,
      );
      const { view } = sessionsViewSetup(undefined, undefined, undefined, {
        places,
      });
      const handles = new Map(
        ['chat', 'docs', 'form'].map((id) => [
          id,
          view.tabs.add('s', tabView(id)),
        ]),
      );
      const savedBeforeAdds: (string | null | undefined)[] = [];

      for (const step of steps) {
        const [action, id] = step.split(' ');
        if (action === 'remove') {
          handles.get(id)!.dispose();
        } else if (action === 'pick') {
          handles.get(id)!.select();
        } else {
          savedBeforeAdds.push(places.get('s')?.selectedTabId);
          handles.set(id, view.tabs.add('s', tabView(id)));
        }
      }

      expect(savedBeforeAdds[0]).toBe(saved);
      expect(view.tabs.selectedTabOf('s')?.id).toBe(selected);
    },
  );

  it.each([
    {
      case: 'a restored popup the place had hidden comes back hidden',
      id: 'a',
      restored: true,
      open: null,
      saved: ['a'],
    },
    {
      case: 'a new popup with that id opens',
      id: 'a',
      restored: false,
      open: 'title a',
      saved: [],
    },
    {
      case: 'a restored popup the place had open opens',
      id: 'b',
      restored: true,
      open: 'title b',
      saved: ['a'],
    },
  ])(
    'savedPlace_PopupAdded_RestoresItsHiddenState ($case)',
    ({ id, restored, open, saved }) => {
      const { view, savedHiddenPopupIds } = viewOverSavedPlace({
        selectedTabId: 'chat',
        selections: 0,
        hiddenPopupIds: ['a'],
      });
      view.tabs.add('s', tabView('chat'));
      expect(savedHiddenPopupIds()).toEqual(['a']);

      view.tabs.addPopup('s', popupView(id), { restored });

      expect(view.tabs.openPopupOf('s')?.title ?? null).toBe(open);
      expect(savedHiddenPopupIds()).toEqual(saved);
    },
  );

  it('savedPlace_PopupHiddenAndOpened_WritesWhichAreHidden', () => {
    const { view, savedHiddenPopupIds } = viewOverSavedPlace({
      selectedTabId: null,
      selections: 0,
      hiddenPopupIds: [],
    });
    const popup = view.tabs.addPopup('s', popupView('a'));

    popup.hide();
    const whileHidden = savedHiddenPopupIds();
    popup.open();

    expect(whileHidden).toEqual(['a']);
    expect(savedHiddenPopupIds()).toEqual([]);
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

  it.each([
    {
      case: 'its own transition ends',
      settle: (root: FakeElement) => root.fire('transitionend'),
      entering: [],
      bar: [],
    },
    {
      case: 'its own transition is cancelled',
      settle: (root: FakeElement) => root.fire('transitioncancel'),
      entering: [],
      bar: [],
    },
    {
      case: "a child's transition ends",
      settle: (root: FakeElement) =>
        root.fire('transitionend', { target: new FakeElement('div') }),
      entering: ['title a'],
      bar: [],
    },
    {
      case: 'it hides first',
      settle: (_root: FakeElement, handle: SessionPopupHandle) => handle.hide(),
      entering: [],
      bar: ['title a'],
    },
  ])(
    'sessionPopups_Added_OpensAtOnceEnteringUntil ($case)',
    ({ settle, entering, bar }) => {
      const { view, area } = popupSetup();

      const handle = view.tabs.addPopup('s', popupView('a'));
      const onAdd = popupsShown(area);
      settle(findAll(area, 'session-popup')[0]!, handle);

      expect(onAdd).toEqual({
        open: ['title a'],
        entering: ['title a'],
        inert: [],
        bar: [],
      });
      expect({
        entering: popupsShown(area).entering,
        bar: popupsShown(area).bar,
      }).toEqual({ entering, bar });
    },
  );

  it('sessionPopups_OpenPopup_HidesTheTabFromIsVisible', () => {
    const { view } = popupSetup();
    const tab = view.tabs.add('s', tabView('chat'));

    const popup = view.tabs.addPopup('s', popupView('a'));
    const whilePopupOpen = [tab.isVisible(), popup.isVisible()];
    popup.hide();

    expect(whilePopupOpen).toEqual([false, true]);
    expect([tab.isVisible(), popup.isVisible()]).toEqual([true, false]);
  });

  it('sessionPopups_Status_NamesItsBarEntry', () => {
    const { view, area } = popupSetup();
    const popup = view.tabs.addPopup('s', popupView('a'));

    popup.setStatus('R1');
    popup.hide();

    expect(popupsShown(area).bar).toEqual(['R1']);
  });

  // Breaks: a draw that disposes the popup bar and draws it again.
  it("a draw keeps an unchanged popup bar, so the first click on an unfocused pane's bar entry reaches it", () => {
    const { view, area } = sessionsViewSetup();
    view.render(stateOf(['r', 's'], 'r'));
    view.panes.restore(
      TWO_PANES,
      new Map([
        ['pane-1', 'r'],
        ['pane-2', 's'],
      ]),
    );
    view.tabs.addPopup('s', popupView('p')).hide();
    const entry = () => findAll(area, 'session-popup-bar-entry')[0];
    const pressed = entry();

    view.panes.focus('pane-2');
    const afterFocus = entry();
    pressed!.click();

    expect(afterFocus).toBe(pressed);
    expect(popupsShown(area).open).toEqual(['title p']);
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
    moves.length = 0;

    setup.view.setLayouts(withUser<Layout>(defaultLayout, {}));

    const element = asFake(popup.element);
    expect(element.isConnected).toBe(true);
    expect(moves).toContainEqual({ element, to: element.parentNode });
    expect(findAll(setup.area, 'session-popup')).toHaveLength(1);
    expect(popupsShown(setup.area).open).toEqual(['title a']);
  });
});
