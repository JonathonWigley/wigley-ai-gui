import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withUser } from '../../../../shared/page/layout-host/test-layouts';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import type { SessionTabView } from '../../contract';
import defaultLayout from '../../layouts/default/layout.js';
import type { Layout } from '../../layouts/layout';
import {
  drawnRows,
  rowNamed,
  sessionsViewSetup,
  stateOf,
} from '../sessions-view-fakes';

type Setup = ReturnType<typeof sessionsViewSetup>;

function tabView(id: string): SessionTabView {
  return {
    id,
    title: `title ${id}`,
    element: asHtml(new FakeElement('div')),
    beforeClose: () => true,
    shown: () => undefined,
  };
}

function fail(): never {
  throw new Error('broken part');
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessions parts', () => {
  it.each<{
    case: string;
    layout: Layout;
    partName: string;
    roots: (setup: Setup) => FakeElement[];
  }>([
    {
      case: 'row throws',
      layout: { row: fail },
      partName: 'row',
      roots: ({ sideBar }) => drawnRows(sideBar),
    },
    {
      case: 'tab throws',
      layout: { tab: fail },
      partName: 'tab',
      roots: ({ area }) => findAll(area, 'ui-tab'),
    },
    {
      case: 'sideBar returns rows outside its element',
      layout: {
        sideBar: (parent, kit) => ({
          element: kit.el(parent, 'div', 'mine-side'),
          rows: document.createElement('nav'),
        }),
      },
      partName: 'sideBar',
      roots: ({ sideBar }) => findAll(sideBar, 'session-side'),
    },
    {
      case: 'tabBar returns an element not in parent',
      layout: {
        tabBar: (_parent, kit) => {
          const element = document.createElement('div');
          return { element, strip: kit.el(element, 'nav', 'mine-strip') };
        },
      },
      partName: 'tabBar',
      roots: ({ area }) => findAll(area, 'session-tabs-bar'),
    },
  ])(
    'sessionsParts_PartFails_DrawsWithDefault ($case)',
    ({ layout, partName, roots }) => {
      const setup = sessionsViewSetup();
      setup.view.setLayouts(withUser<Layout>(defaultLayout, layout));
      setup.view.tabs.add('a', tabView('t1'));
      setup.view.tabs.add('a', tabView('t2'));

      setup.view.render(stateOf(['a', 'b'], 'a'));
      setup.view.render(stateOf(['a', 'b'], 'a'));

      const drawn = roots(setup);
      expect(drawn.length).toBeGreaterThan(0);
      for (const root of drawn) {
        expect(root.dataset).toMatchObject({
          layout: 'default',
          layoutOwner: 'sessions',
        });
      }
      expect(
        setup.logged.filter((line) =>
          line.startsWith(`[sessions] layout mine ${partName} failed`),
        ),
      ).toHaveLength(1);
    },
  );

  it('sessionsParts_RowDrawnByUserLayout_KeepsClickAndSelection', () => {
    const { view, sideBar, activated } = sessionsViewSetup();
    view.setLayouts(
      withUser<Layout>(defaultLayout, {
        row: (parent, input, kit) => ({
          element: kit.el(parent, 'div', 'bare', input.label),
        }),
      }),
    );

    view.render(stateOf(['first', 'second'], 'second'));
    const rows = drawnRows(sideBar);
    rowNamed(rows, 'first').click();

    expect(activated).toEqual(['first']);
    const selected = rowNamed(rows, 'second');
    expect(selected.dataset.layout).toBe('mine');
    expect(selected.classList.contains('is-selected')).toBe(true);
    expect(selected.attributes.get('aria-current')).toBe('true');
    expect(rowNamed(rows, 'first').classList.contains('is-selected')).toBe(
      false,
    );
  });

  it('sessionsParts_Redraw_LeavesOneAnchorPerHint', () => {
    const { view, anchors } = sessionsViewSetup();
    const layout: Layout = {
      row: (parent, input, kit) => {
        const element = kit.el(parent, 'div', 'bare', input.label);
        kit.keyHint(element, 'showMode');
        return { element };
      },
    };
    view.setLayouts(withUser<Layout>(defaultLayout, layout));

    // No row selected: the empty text asks for a pick, with its hint.
    for (let draw = 0; draw < 3; draw++) {
      view.render(stateOf(['first', 'second'], null));
    }
    view.setLayouts(withUser<Layout>(defaultLayout, layout));

    const live: Record<string, number> = {};
    for (const anchor of anchors.filter((made) => !made.isDisposed)) {
      live[anchor.command] = (live[anchor.command] ?? 0) + 1;
    }
    expect(live).toEqual({
      'sessions.nextSession': 2,
      'sessions.prevSession': 1,
      'sessions.prevTab': 1,
      'sessions.nextTab': 1,
      'sessions.closeSession': 1,
      'sessions.showMode': 2,
    });
  });

  it('sessionsView_SetLayouts_KeepsTabElements', () => {
    const { view } = sessionsViewSetup();
    const chat = tabView('chat');
    view.tabs.add('a', chat);
    view.render(stateOf(['a'], 'a'));
    const body = (chat.element as unknown as FakeElement).parentNode;

    view.setLayouts(withUser<Layout>(defaultLayout, { tab: fail }));

    expect((chat.element as unknown as FakeElement).parentNode).toBe(body);
    expect(view.tabs.selectedTabOf('a')).toBe(chat);
  });
});
