import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PartStore } from '../../../../shared/page/contributed-parts';
import { withUser } from '../../../../shared/page/layout-host/test-layouts';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import type { SessionPart, SessionTabView } from '../../contract';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  GroupInput,
  GroupKit,
  GroupPane,
  Layout,
  SectionInput,
} from '../../layouts/layout';
import {
  drawnRows,
  rowNamed,
  sessionsPartsSetup,
  sessionsViewSetup,
  stateOf,
} from '../sessions-view-fakes';
import type { SessionsParts } from './sessions-parts';

type Setup = ReturnType<typeof sessionsViewSetup>;

const FAVORITE: GroupInput = { project: 'gamma', count: 2, isFavorite: true };
const NON_FAVORITE: GroupInput = {
  project: 'delta',
  count: 3,
  isFavorite: false,
};
const RECENT: SectionInput = {
  kind: 'recent',
  label: 'Recent',
  dropHint: 'Drop here',
  isEmpty: false,
};

// What a drawn section or group shows: the layout that drew it, what its
// element (a section) or header (a group) holds in order, each child by its
// text or else its Codicon, whether its boxes sit inside its element, and a
// group's star or a section's `is-empty`.
interface DrawnShape {
  drawnBy: string;
  holds: string[];
  boxesInside: boolean;
  star?: { icon: string; label: string; isActive: boolean } | null;
  isMarkedEmpty?: boolean;
}

function codiconOf(node: FakeElement): string {
  return findAll(node, 'codicon')[0].className.replace('codicon codicon-', '');
}

function shownBy(children: FakeElement[]): string[] {
  return children.map((child) => child.textContent || codiconOf(child));
}

function sectionShape(parts: SessionsParts, input: SectionInput): DrawnShape {
  const drawn = parts.section(document.createElement('div'), input);
  const element = asFake(drawn.built.element);
  return {
    drawnBy: drawn.layoutName,
    holds: element.children.slice(0, -1).map((child) => child.textContent),
    boxesInside: element.lastElementChild === asFake(drawn.built.groups),
    isMarkedEmpty: element.classList.contains('is-empty'),
  };
}

function groupShape(parts: SessionsParts, input: GroupInput): DrawnShape {
  const drawn = parts.group(document.createElement('div'), input);
  const { element, header, rows, favoriteToggle } = drawn.built;
  const star = favoriteToggle === null ? null : asFake(favoriteToggle);
  return {
    drawnBy: drawn.layoutName,
    holds: shownBy(asFake(header).children),
    boxesInside:
      asFake(element).contains(asFake(header)) &&
      asFake(element).contains(asFake(rows)),
    star:
      star === null
        ? null
        : {
            icon: codiconOf(star),
            label: star.attributes.get('aria-label') ?? '',
            isActive: star.classList.contains('is-active'),
          },
  };
}

// A user layout's `group`: `placeInHeader` places the kit's parts in its
// header, and `boxes` replaces its header or rows box.
function userGroup(
  placeInHeader: (kit: GroupKit, header: HTMLElement) => void,
  boxes: () => Partial<Omit<GroupPane, 'element'>> = () => ({}),
): Layout {
  return {
    group(parent, input, kit) {
      const element = kit.el(parent, 'div', 'mine-group');
      const header = kit.el(element, 'div', 'mine-header');
      placeInHeader(kit, header);
      kit.el(header, 'span', 'mine-name', input.project);
      const rows = kit.el(element, 'div', 'mine-rows');
      return { element, header, rows, ...boxes() };
    },
  };
}

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

// A session part recording `build:<id>:<sessionId>` and
// `dispose:<id>:<sessionId>` into `record`.
function recordingPart(id: string, record: string[]): SessionPart {
  return {
    id,
    build(_parent, sessionId) {
      record.push(`build:${id}:${sessionId}`);
      return { dispose: () => record.push(`dispose:${id}:${sessionId}`) };
    },
  };
}

// One sessions surface that draws session parts: the store its parts are
// added to, how the view draws it for `sessionIds` (the first one's tab bar
// in the pane) and draws it again, the elements each holding one session's
// parts holder, the holder's and each wrapper's class, and a user layout of
// that part which never calls `contributedParts`.
interface Surface {
  surface: string;
  store(setup: Setup): PartStore<SessionPart>;
  draw(setup: Setup, sessionIds: string[]): void;
  drawAgain(setup: Setup): void;
  roots(setup: Setup): FakeElement[];
  holderClass: string;
  wrapperClass: string;
  noun: string;
  withoutSlot: Layout;
}

const ROW_SURFACE: Surface = {
  surface: 'row',
  store: (setup) => setup.rowParts,
  draw: ({ view }, sessionIds) =>
    view.render(stateOf(sessionIds, sessionIds[0])),
  drawAgain: ({ view }) => view.render(stateOf(['a'], 'a')),
  roots: ({ sideBar }) => drawnRows(sideBar),
  holderClass: 'session-row-parts',
  wrapperClass: 'session-row-part',
  noun: 'row part',
  withoutSlot: {
    row: (parent, input, kit) => {
      const element = kit.el(parent, 'div', 'bare');
      kit.el(element, 'span', 'bare-label', input.label);
      return { element };
    },
  },
};

const BAR_SURFACE: Surface = {
  surface: 'tab bar',
  store: (setup) => setup.barParts,
  draw({ view }, [shown, ...rest]) {
    view.panes.load(view.panes.focusedPaneId(), shown);
    for (const sessionId of rest) {
      view.tabs.add(sessionId, tabView(`tab ${sessionId}`));
    }
  },
  drawAgain: ({ view }) => view.tabs.redrawBars(),
  // The shown pane's frame sits before the holder of the rest.
  roots: ({ area }) =>
    findAll(area, 'session-tabs-host').map((host) => host.children[0]),
  holderClass: 'session-bar-parts',
  wrapperClass: 'session-bar-part',
  noun: 'bar part',
  withoutSlot: {
    tabBar: (parent, kit) => {
      const element = kit.el(parent, 'div', 'bare');
      return { element, strip: kit.el(element, 'nav', 'bare-strip') };
    },
  },
};

const SURFACES = [ROW_SURFACE, BAR_SURFACE];

// The `data-part` of each of `surface`'s part wrappers under `root`.
function partIds(surface: Surface, root: FakeElement): string[] {
  return findAll(root, surface.wrapperClass).map(
    (wrapper) => wrapper.dataset.part,
  );
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
      case: 'row places contributed parts twice',
      layout: {
        row: (parent, input, kit) => {
          const element = kit.el(parent, 'div', 'bare', input.label);
          kit.contributedParts(element);
          kit.contributedParts(element);
          return { element };
        },
      },
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
    {
      case: 'tabBar places contributed parts twice',
      layout: {
        tabBar: (parent, kit) => {
          const element = kit.el(parent, 'div', 'bare');
          kit.contributedParts(element);
          kit.contributedParts(element);
          return { element, strip: kit.el(element, 'nav', 'bare-strip') };
        },
      },
      partName: 'tabBar',
      roots: ({ area }) => findAll(area, 'session-tabs-bar'),
    },
    {
      case: 'pane throws',
      layout: { pane: fail },
      partName: 'pane',
      roots: ({ area }) => findAll(area, 'session-pane'),
    },
    {
      case: 'pane returns a body outside its element',
      layout: {
        pane: (parent, _input, kit) => ({
          element: kit.el(parent, 'div', 'mine-pane'),
          body: document.createElement('div'),
        }),
      },
      partName: 'pane',
      roots: ({ area }) => findAll(area, 'session-pane'),
    },
  ])(
    'sessionsParts_PartFails_DrawsWithDefault ($case)',
    ({ layout, partName, roots }) => {
      const setup = sessionsViewSetup();
      setup.view.setLayouts(withUser<Layout>(defaultLayout, layout));
      setup.view.tabs.add('a', tabView('t1'));
      setup.view.tabs.add('a', tabView('t2'));
      setup.view.panes.load(setup.view.panes.focusedPaneId(), 'a');

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
          line.startsWith(`layout mine ${partName} failed`),
        ),
      ).toHaveLength(1);
    },
  );

  it.each<{ case: string; layout: Layout; drawnBy: string }>([
    {
      case: 'layout leaves the box out',
      layout: {
        renameDialog: (parent, input, kit) => {
          const element = kit.el(parent, 'div', 'mine-rename');
          kit.el(element, 'p', 'mine-hint', input.hint);
          return { element };
        },
      },
      drawnBy: 'mine',
    },
    {
      case: 'layout places the box twice',
      layout: {
        renameDialog: (parent, _input, kit) => {
          const element = kit.el(parent, 'div', 'mine-rename');
          kit.textBox(element);
          kit.textBox(element);
          return { element };
        },
      },
      drawnBy: 'default',
    },
  ])(
    'sessionsParts_RenameDialog_BodyStartsWithTheBox ($case)',
    ({ layout, drawnBy }) => {
      const { view } = sessionsViewSetup();
      view.setLayouts(withUser<Layout>(defaultLayout, layout));
      const parent = document.createElement('div');
      const box = document.createElement('div');

      const drawn = view.parts.renameDialog(
        parent,
        { problem: null, hint: 'the hint' },
        box,
      );

      const element = asFake(drawn.built.element);
      expect(drawn.layoutName).toBe(drawnBy);
      expect(element.children[0]).toBe(asFake(box));
      expect(element.textContent).toContain('the hint');
    },
  );

  const DEFAULT_GROUP_FAVORITE: DrawnShape = {
    drawnBy: 'default',
    holds: ['gamma', '2', 'star-full', 'gripper'],
    boxesInside: true,
    star: { icon: 'star-full', label: 'Unfavorite', isActive: true },
  };
  const DEFAULT_SECTION: DrawnShape = {
    drawnBy: 'default',
    holds: ['Recent', 'Drop here'],
    boxesInside: true,
    isMarkedEmpty: false,
  };

  it.each<{
    case: string;
    layout: Layout;
    draw: (parts: SessionsParts) => DrawnShape;
    expected: DrawnShape;
    failure: string | null;
  }>([
    {
      case: 'default group, a favorite',
      layout: {},
      draw: (parts) => groupShape(parts, FAVORITE),
      expected: DEFAULT_GROUP_FAVORITE,
      failure: null,
    },
    {
      case: 'default group, not a favorite',
      layout: {},
      draw: (parts) => groupShape(parts, NON_FAVORITE),
      expected: {
        drawnBy: 'default',
        holds: ['delta', '3', 'star-empty', 'gripper'],
        boxesInside: true,
        star: { icon: 'star-empty', label: 'Favorite', isActive: false },
      },
      failure: null,
    },
    {
      case: 'default section',
      layout: {},
      draw: (parts) => sectionShape(parts, RECENT),
      expected: DEFAULT_SECTION,
      failure: null,
    },
    {
      case: 'user group returns rows outside its element',
      layout: userGroup(
        () => undefined,
        () => ({ rows: document.createElement('div') }),
      ),
      draw: (parts) => groupShape(parts, FAVORITE),
      expected: DEFAULT_GROUP_FAVORITE,
      failure: 'group rows',
    },
    {
      case: 'user group returns a header outside its element',
      layout: userGroup(
        () => undefined,
        () => ({ header: document.createElement('div') }),
      ),
      draw: (parts) => groupShape(parts, FAVORITE),
      expected: DEFAULT_GROUP_FAVORITE,
      failure: 'group header',
    },
    {
      case: 'user group places the star twice',
      layout: userGroup((kit, header) => {
        kit.favoriteToggle(header);
        kit.favoriteToggle(header);
      }),
      draw: (parts) => groupShape(parts, FAVORITE),
      expected: DEFAULT_GROUP_FAVORITE,
      failure: 'favoriteToggle placed twice',
    },
    {
      case: 'user group places the grip twice',
      layout: userGroup((kit, header) => {
        kit.dragHandle(header);
        kit.dragHandle(header);
      }),
      draw: (parts) => groupShape(parts, FAVORITE),
      expected: DEFAULT_GROUP_FAVORITE,
      failure: 'dragHandle placed twice',
    },
    {
      case: 'user group leaves the star out',
      layout: userGroup((kit, header) => {
        kit.dragHandle(header);
      }),
      draw: (parts) => groupShape(parts, FAVORITE),
      expected: {
        drawnBy: 'mine',
        holds: ['gripper', 'gamma'],
        boxesInside: true,
        star: null,
      },
      failure: null,
    },
    {
      case: 'user section returns groups outside its element',
      layout: {
        section: (parent, _input, kit) => ({
          element: kit.el(parent, 'div', 'mine-section'),
          groups: document.createElement('div'),
        }),
      },
      draw: (parts) => sectionShape(parts, RECENT),
      expected: DEFAULT_SECTION,
      failure: 'section groups',
    },
    {
      case: 'user section with no groups carries is-empty',
      layout: {
        section: (parent, input, kit) => {
          const element = kit.el(parent, 'div', 'mine-section');
          kit.el(element, 'p', 'mine-label', input.label);
          return { element, groups: kit.el(element, 'div', 'mine-groups') };
        },
      },
      draw: (parts) => sectionShape(parts, { ...RECENT, isEmpty: true }),
      expected: {
        drawnBy: 'mine',
        holds: ['Recent'],
        boxesInside: true,
        isMarkedEmpty: true,
      },
      failure: null,
    },
  ])(
    'groupAndSectionParts_Draw_KeepsTheContract ($case)',
    ({ layout, draw, expected, failure }) => {
      const { parts, logged } = sessionsPartsSetup();
      parts.setLayouts(withUser<Layout>(defaultLayout, layout));

      expect(draw(parts)).toEqual(expected);

      expect(logged).toEqual(
        failure === null ? [] : [expect.stringContaining(failure)],
      );
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
    view.panes.load(view.panes.focusedPaneId(), 'second');
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

  it('sessionsParts_SectionAndGroupDrawnByUserLayout_KeepsRowsAndStar', () => {
    const { view, sideBar, activated } = sessionsViewSetup();
    view.setLayouts(
      withUser<Layout>(defaultLayout, {
        ...userGroup((kit, header) => {
          kit.favoriteToggle(header);
        }),
        section: (parent, _input, kit) => {
          const element = kit.el(parent, 'div', 'mine-section');
          return { element, groups: kit.el(element, 'div', 'mine-groups') };
        },
      }),
    );
    const projectsBySection = () =>
      findAll(sideBar, 'mine-groups').map((box) =>
        findAll(box, 'mine-name').map((name) => name.textContent),
      );

    view.render(stateOf(['first', 'second'], 'first'));
    const recentProjects = projectsBySection();
    rowNamed(findAll(sideBar, 'mine-rows')[0].children, 'second').click();
    findAll(sideBar, 'session-group-star')[0].click();

    expect(recentProjects).toEqual([[], ['project']]);
    expect(activated).toEqual(['second']);
    expect(projectsBySection()).toEqual([['project'], []]);
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

    // The pane shows `first`, so its tab bar draws with every prompt and pane
    // control.
    view.panes.load(view.panes.focusedPaneId(), 'first');
    for (let draw = 0; draw < 3; draw++) {
      view.render(stateOf(['first', 'second'], 'first'));
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
      'sessions.splitRight': 1,
      'sessions.splitDown': 1,
      'sessions.closePane': 1,
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

  it.each(SURFACES)(
    'sessionParts_DefaultLayout_BuildsEachPartInAddOrder ($surface)',
    (surface) => {
      const record: string[] = [];
      const setup = sessionsViewSetup();
      surface.store(setup).add(recordingPart('p1', record));
      surface.store(setup).add(recordingPart('p2', record));

      surface.draw(setup, ['a', 'b']);

      const roots = surface.roots(setup);
      expect(
        roots.map((root) => findAll(root, surface.holderClass).length),
      ).toEqual([1, 1]);
      expect(roots.map((root) => partIds(surface, root))).toEqual([
        ['p1', 'p2'],
        ['p1', 'p2'],
      ]);
      expect(record).toEqual([
        'build:p1:a',
        'build:p2:a',
        'build:p1:b',
        'build:p2:b',
      ]);
    },
  );

  it.each(SURFACES)(
    'sessionParts_DrawAgain_DisposesBeforeRebuilding ($surface)',
    (surface) => {
      const record: string[] = [];
      const setup = sessionsViewSetup();
      surface.store(setup).add(recordingPart('p1', record));

      surface.draw(setup, ['a']);
      surface.drawAgain(setup);

      expect(record).toEqual(['build:p1:a', 'dispose:p1:a', 'build:p1:a']);
    },
  );

  it.each(SURFACES)(
    'sessionParts_UserLayoutWithoutSlot_AppendsAtEnd ($surface)',
    (surface) => {
      const setup = sessionsViewSetup();
      surface.store(setup).add(recordingPart('p1', []));
      setup.view.setLayouts(
        withUser<Layout>(defaultLayout, surface.withoutSlot),
      );

      surface.draw(setup, ['a']);

      const [root] = surface.roots(setup);
      expect(root.dataset.layout).toBe('mine');
      expect(
        root.lastElementChild?.classList.contains(surface.holderClass),
      ).toBe(true);
    },
  );

  it.each(
    SURFACES.flatMap((surface) => [
      {
        surface,
        case: 'build throws',
        bad: { id: 'bad', build: fail } as SessionPart,
        logLine: `${surface.noun} bad failed: broken part`,
        drawnParts: ['good'],
      },
      {
        surface,
        case: 'dispose throws',
        bad: { id: 'bad', build: () => ({ dispose: fail }) } as SessionPart,
        logLine: `${surface.noun} bad dispose failed: broken part`,
        drawnParts: ['bad', 'good'],
      },
    ]),
  )(
    'sessionParts_PartThrows_LogsAndOthersRun ($surface.surface, $case)',
    ({ surface, bad, logLine, drawnParts }) => {
      const record: string[] = [];
      const setup = sessionsViewSetup();
      surface.store(setup).add(bad);
      surface.store(setup).add(recordingPart('good', record));

      surface.draw(setup, ['a']);
      surface.drawAgain(setup);

      expect(setup.logged).toContain(logLine);
      expect(record).toEqual([
        'build:good:a',
        'dispose:good:a',
        'build:good:a',
      ]);
      const roots = surface.roots(setup);
      expect(roots.map((root) => partIds(surface, root))).toEqual([drawnParts]);
      expect(roots[0].dataset.layout).toBe('default');
    },
  );

  it.each(SURFACES)(
    'sessionParts_AddAndDispose_Redraws ($surface)',
    (surface) => {
      const setup = sessionsViewSetup();
      const chat = tabView('chat');
      setup.view.tabs.add('a', chat);
      surface.draw(setup, ['a']);
      const [pane] = findAll(setup.area, 'session-pane');
      const body = (chat.element as unknown as FakeElement).parentNode;

      const drawnIds = () =>
        [setup.sideBar, setup.area].flatMap((root) => partIds(surface, root));

      const added = surface.store(setup).add(recordingPart('p1', []));
      const afterAdd = drawnIds();
      added.dispose();

      expect(afterAdd).toEqual(['p1']);
      expect(drawnIds()).toEqual([]);
      expect(findAll(setup.area, 'session-pane')[0]).toBe(pane);
      expect((chat.element as unknown as FakeElement).parentNode).toBe(body);
    },
  );
});
