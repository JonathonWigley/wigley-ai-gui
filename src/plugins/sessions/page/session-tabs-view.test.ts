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

function tabView(id: string): SessionTabView {
  return {
    id,
    title: `title ${id}`,
    icon: 'comment',
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
      moved: ['a', 'c'],
    },
    {
      case: 'a layout redraw',
      act: ({ view }) => view.setLayouts(withUser<Layout>(defaultLayout, {})),
      moved: ['a', 'c'],
    },
    {
      case: 'a pane close',
      act: ({ view }) => view.panes.close('pane-2'),
      moved: ['a', 'c'],
    },
    {
      case: 'a restore dropping a pane',
      act: ({ view }) =>
        view.panes.restore(
          { root: { kind: 'leaf', id: 'pane-1' }, focusedId: 'pane-1' },
          new Map([['pane-1', 'a']]),
        ),
      moved: ['a', 'c'],
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

  it('a disposed view leaves no pane part or empty text live', () => {
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

    view.dispose();

    expect(liveFocusEdges()).toEqual([]);
    expect(pickHint.parentNode).toBeNull();
  });
});
