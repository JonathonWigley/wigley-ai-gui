import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANE_FOCUS_COMMANDS } from '../../../contracts/panes';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import { installMarkdownDom } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
} from '../../../shared/page/test-dom';
import type { SessionTabView } from '../contract';
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

beforeEach(() => {
  ({ moves } = installMarkdownDom(vi.stubGlobal));
});

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

  it('sessionTabs_SelectedTabRemoved_SelectsItsStripNeighbour', () => {
    const { view } = sessionsViewSetup();
    const chat = view.tabs.add('s', tabView('chat', 2));
    view.tabs.add('s', tabView('docs', 1));
    view.tabs.add('s', tabView('form'));

    chat.dispose();

    expect(view.tabs.selectedTabOf('s')?.id).toBe('form');
  });

  it('releases a live takeover when the tab handle is disposed', () => {
    const { view } = sessionsViewSetup();
    const a = tabView('a');
    view.tabs.add('s', a);
    const handleOfB = view.tabs.add('s', tabView('b'));
    view.tabs.select('s', 'a');
    const takeOver = handleOfB.takeOver();
    expect(view.tabs.selectedTabOf('s')?.id).toBe('b');

    handleOfB.dispose();

    expect(view.tabs.selectedTabOf('s')).toBe(a);
    expect(view.tabs.tabsOf('s')).toEqual([a]);

    takeOver.release();

    expect(view.tabs.selectedTabOf('s')).toBe(a);
    expect(view.tabs.tabsOf('s')).toEqual([a]);
  });

  it('frame take overs follow take over release and tab removal', () => {
    const { view } = sessionsViewSetup();
    const selected = () => view.tabs.selectedTabOf('s')?.id;
    view.tabs.add('s', tabView('chat'));
    const form = view.tabs.add('s', tabView('form'));
    const docs = view.tabs.add('s', tabView('docs'));
    view.tabs.select('s', 'chat');

    const formTake = form.takeOver();
    docs.takeOver();
    formTake.release();
    expect(selected()).toBe('docs');
    docs.takeOver().release();
    expect(selected()).toBe('chat');

    const again = form.takeOver();
    form.takeOver();
    expect(selected()).toBe('form');
    again.release();
    expect(selected()).toBe('chat');

    form.takeOver();
    docs.takeOver();
    form.dispose();
    docs.dispose();
    expect(selected()).toBe('chat');
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
