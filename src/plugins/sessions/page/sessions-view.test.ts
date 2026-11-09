import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeElement,
  findAll,
  installFakeDom,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import {
  NEEDS_YOU_ACTIVITY,
  type SessionRow,
  type SidebarSection,
} from '../contract';
import { sessionRow } from '../contract.test-support';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { fakeUiState } from './session-fakes';
import { drawnRows, rowNamed, sessionsViewSetup } from './sessions-view-fakes';

// A row `id`, in `project`, under host session id `hostSessionId`.
function rowIn(
  id: string,
  project: string,
  hostSessionId: string | null = null,
): SessionRow {
  return sessionRow(id, { project, hostSessionId });
}

function stateWith(rows: SessionRow[]) {
  return { rows, selectedSessionId: null };
}

type Setup = ReturnType<typeof sessionsViewSetup>;

// The drawn group whose header names `project`.
function groupNamed({ sideBar }: Setup, project: string): FakeElement {
  const found = findAll(sideBar, 'session-group').find(
    (group) => findAll(group, 'session-group-name')[0]?.textContent === project,
  );
  if (found === undefined) {
    throw new Error(`no group ${project}`);
  }
  return found;
}

function clickStar(setup: Setup, project: string) {
  findAll(groupNamed(setup, project), 'session-group-star')[0].click();
}

function sectionGroups({ sideBar }: Setup, index: 0 | 1): FakeElement {
  return findAll(sideBar, 'session-section-groups')[index];
}

function headerOf(setup: Setup, project: string): FakeElement {
  return findAll(groupNamed(setup, project), 'session-group-header')[0];
}

// A `DataTransfer` for one drag: the primitive checks its own type on it.
function fakeTransfer() {
  const types: string[] = [];
  return {
    types,
    setData: (type: string) => types.push(type),
    effectAllowed: '',
    dropEffect: '',
  };
}

// Drags `project`'s header onto section `index`'s groups box at `clientY`: the
// fake rects' midpoint is 0, so the default lands above every item and 1 below.
function drag(setup: Setup, project: string, index: 0 | 1, clientY = -1) {
  const dataTransfer = fakeTransfer();
  const header = headerOf(setup, project);
  header.fire('dragstart', { dataTransfer });
  sectionGroups(setup, index).fire('drop', { dataTransfer, clientY });
  header.fire('dragend', { dataTransfer });
}

const PREVIEW_IGNORED_LINE = 'projects ignored: the layout preview shows';

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessions view side bar', () => {
  it.each<{
    case: string;
    rows: SessionRow[];
    favorites: string[];
    act?: (setup: Setup) => void;
    order: string[];
    saved: string[];
    line?: string;
  }>([
    {
      case: 'a favorite project draws first',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['gamma'],
      order: ['g1', 'a1'],
      saved: ['gamma'],
    },
    {
      case: 'a new session enters on top of its group, which holds its place',
      rows: [rowIn('a1', 'alpha'), rowIn('b1', 'beta'), rowIn('a2', 'alpha')],
      favorites: [],
      order: ['b1', 'a2', 'a1'],
      saved: [],
    },
    {
      case: 'a session in a new project enters on top',
      rows: [rowIn('a1', 'alpha'), rowIn('b1', 'beta'), rowIn('g1', 'gamma')],
      favorites: [],
      order: ['g1', 'b1', 'a1'],
      saved: [],
    },
    {
      case: 'needs you moves no row',
      rows: [rowIn('a1', 'alpha'), rowIn('b1', 'beta')],
      favorites: [],
      act: ({ view }) => view.setActivity('a1', 'forms', NEEDS_YOU_ACTIVITY),
      order: ['b1', 'a1'],
      saved: [],
    },
    {
      case: 'another activity moves no row',
      rows: [rowIn('a1', 'alpha'), rowIn('b1', 'beta')],
      favorites: [],
      act: ({ view }) =>
        view.setActivity('a1', 'chat', {
          word: 'working',
          tone: 'running',
          rank: 20,
        }),
      order: ['b1', 'a1'],
      saved: [],
    },
    {
      case: 'picking a row moves no row',
      rows: [rowIn('a1', 'alpha'), rowIn('b1', 'beta')],
      favorites: [],
      act: (setup) => {
        rowNamed(drawnRows(setup.sideBar), 'label a1').click();
        setup.view.panes.load(setup.view.panes.focusedPaneId(), 'a1');
      },
      order: ['b1', 'a1'],
      saved: [],
    },
    {
      case: 'the preview star saves nothing',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['gamma'],
      act: (setup) => {
        setup.view.showPreview(true);
        clickStar(setup, 'new-games-prototypes');
        clickStar(setup, 'wigley-ai-gui');
        setup.view.showPreview(false);
        expect(setup.logged).not.toContain(PREVIEW_IGNORED_LINE);
      },
      order: ['g1', 'a1'],
      saved: ['gamma'],
    },
    {
      case: 'the project keys under the preview save nothing',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['gamma', 'alpha'],
      act: (setup) => {
        setup.view.showPreview(true);
        setup.view.toggleFavorite('gamma');
        setup.view.moveFavorite('gamma', 1);
        setup.view.showPreview(false);
      },
      order: ['g1', 'a1'],
      saved: ['gamma', 'alpha'],
      line: PREVIEW_IGNORED_LINE,
    },
    {
      case: 'moving a project that is no favorite saves nothing',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['gamma'],
      act: ({ view }) => view.moveFavorite('alpha', 1),
      order: ['g1', 'a1'],
      saved: ['gamma'],
      line: 'alpha is not a favorite',
    },
    {
      case: 'moving a favorite down saves the new order',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['alpha', 'gamma'],
      act: ({ view }) => view.moveFavorite('alpha', 1),
      order: ['g1', 'a1'],
      saved: ['gamma', 'alpha'],
      line: 'moved alpha down',
    },
    {
      case: 'a preview drop saves nothing',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['gamma'],
      act: (setup) => {
        setup.view.showPreview(true);
        drag(setup, 'wigley-agents', 0);
        drag(setup, 'wigley-ai-gui', 1);
        setup.view.showPreview(false);
      },
      order: ['g1', 'a1'],
      saved: ['gamma'],
    },
    {
      case: 'a star favorites its project',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: [],
      act: (setup) => clickStar(setup, 'alpha'),
      order: ['a1', 'g1'],
      saved: ['alpha'],
      line: 'favorited alpha',
    },
    {
      case: 'a star unfavorites its project',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['alpha'],
      act: (setup) => clickStar(setup, 'alpha'),
      order: ['g1', 'a1'],
      saved: [],
      line: 'unfavorited alpha',
    },
    {
      case: 'a drop in Favorites favorites at the drop point',
      rows: [rowIn('a1', 'alpha'), rowIn('b1', 'beta'), rowIn('g1', 'gamma')],
      favorites: ['beta'],
      act: (setup) => drag(setup, 'alpha', 0),
      order: ['a1', 'b1', 'g1'],
      saved: ['alpha', 'beta'],
      line: 'moved alpha to favorites 0',
    },
    {
      case: 'a drop below a favorite favorites after it',
      rows: [rowIn('a1', 'alpha'), rowIn('b1', 'beta'), rowIn('g1', 'gamma')],
      favorites: ['beta'],
      act: (setup) => drag(setup, 'alpha', 0, 1),
      order: ['b1', 'a1', 'g1'],
      saved: ['beta', 'alpha'],
      line: 'moved alpha to favorites 1',
    },
    {
      case: 'a drop of a favorite in Recent unfavorites it',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['alpha'],
      act: (setup) => drag(setup, 'alpha', 1),
      order: ['g1', 'a1'],
      saved: [],
      line: 'unfavorited alpha',
    },
    {
      case: 'a drop of a recent group in Recent changes nothing',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: [],
      act: (setup) => drag(setup, 'alpha', 1),
      order: ['g1', 'a1'],
      saved: [],
    },
  ])(
    'sidebarOrderFollowsFavoritesAndNeedsYou ($case)',
    ({ rows, favorites, act, order, saved, line }) => {
      const clock = { time: 1, now: () => clock.time };
      const uiState = fakeUiState([['favorites', favorites]]);
      const setup = sessionsViewSetup(undefined, undefined, undefined, {
        uiState,
        clock,
      });
      // Each row arrives in its own state, a tick after the one before.
      for (let count = 1; count <= rows.length; count++) {
        clock.time = count;
        setup.view.render(stateWith(rows.slice(0, count)));
      }
      clock.time = rows.length + 1;

      act?.(setup);

      const ids = setup.view.orderedRows().map((row) => row.sessionId);
      expect(ids).toEqual(order);
      expect(uiState.get('favorites')).toEqual(saved);
      expect(drawnRows(setup.sideBar)).toHaveLength(rows.length);
      for (const [position, id] of order.entries()) {
        expect(drawnRows(setup.sideBar)[position].title).toContain(
          `label ${id}`,
        );
      }
      if (line !== undefined) {
        expect(setup.logged).toContain(line);
      }
    },
  );

  it.each<{
    case: string;
    click: (setup: Setup) => void;
    runs: [string, unknown][];
  }>([
    {
      case: 'sidebarRow_Click_RunsSelectRow',
      click: (setup) => rowNamed(drawnRows(setup.sideBar), 'label g1').click(),
      runs: [['sessions.selectRow', 'g1']],
    },
    {
      case: 'favoriteToggle_Click_RunsFavoriteProjectAt',
      click: (setup) => clickStar(setup, 'gamma'),
      runs: [['sessions.favoriteProjectAt', 'gamma']],
    },
  ])('sidebarClick_RunsItsCommand ($case)', ({ click, runs }) => {
    const setup = sessionsViewSetup();
    setup.view.render(stateWith([rowIn('a1', 'alpha'), rowIn('g1', 'gamma')]));

    click(setup);

    expect(setup.runs).toEqual(runs);
  });

  // The preview's sample selects `preview-1` and holds project `wigley-agents`.
  it.each<{ case: string; click: (setup: Setup) => void; selected: string }>([
    {
      case: 'a row click',
      click: (setup) =>
        rowNamed(drawnRows(setup.sideBar), 'new-games-prototypes').click(),
      selected: 'new-games-prototypes',
    },
    {
      case: 'a star click',
      click: (setup) => clickStar(setup, 'wigley-agents'),
      selected: 'wigley-ai-gui',
    },
  ])(
    'sidebarClick_PreviewShown_RunsNoCommand ($case)',
    ({ click, selected }) => {
      const uiState = fakeUiState([['favorites', []]]);
      const setup = sessionsViewSetup(undefined, undefined, undefined, {
        uiState,
      });
      setup.view.render(stateWith([rowIn('a1', 'alpha')]));
      setup.view.showPreview(true);

      click(setup);

      expect(setup.runs).toEqual([]);
      expect(setup.activated).toEqual([]);
      expect(uiState.get('favorites')).toEqual([]);
      const marked = drawnRows(setup.sideBar).filter((row) =>
        row.classList.contains('is-selected'),
      );
      expect(marked.map((row) => row.title.includes(selected))).toEqual([true]);
    },
  );

  it.each<{
    case: string;
    stamps: Record<string, number>;
    // Each state main sends the fresh view, in turn.
    states: SessionRow[][];
    act?: (setup: Setup) => void;
    order: string[];
    stampsAfter: Record<string, number>;
  }>([
    {
      case: 'a page reload keeps the order',
      stamps: { a1: 9, b1: 5 },
      states: [[rowIn('b1', 'beta'), rowIn('a1', 'alpha')]],
      order: ['a1', 'b1'],
      stampsAfter: { a1: 9, b1: 5 },
    },
    {
      case: 'a preview over a page reload saves nothing',
      stamps: { a1: 9, b1: 5 },
      states: [[rowIn('b1', 'beta'), rowIn('a1', 'alpha')]],
      act: ({ view }) => {
        view.showPreview(true);
        view.showPreview(false);
      },
      order: ['a1', 'b1'],
      stampsAfter: { a1: 9, b1: 5 },
    },
    {
      case: 'a relaunch keeps stamps under the rows host ids',
      stamps: { h1: 5, h2: 9 },
      states: [[rowIn('new1', 'alpha', 'h1'), rowIn('new2', 'beta', 'h2')]],
      order: ['new2', 'new1'],
      stampsAfter: { h1: 5, h2: 9 },
    },
    {
      case: 'a first state missing a row keeps its stamp',
      stamps: { h1: 5, h2: 9 },
      states: [
        [rowIn('new1', 'alpha', 'h1')],
        [rowIn('new1', 'alpha', 'h1'), rowIn('new2', 'beta', 'h2')],
      ],
      order: ['new2', 'new1'],
      stampsAfter: { h1: 5, h2: 9 },
    },
    {
      case: 'a row that leaves drops its stamp',
      stamps: { a1: 9, h2: 5 },
      states: [
        [rowIn('a1', 'alpha'), rowIn('b1', 'beta', 'h2')],
        [rowIn('a1', 'alpha')],
      ],
      order: ['a1'],
      stampsAfter: { a1: 9 },
    },
    {
      case: 'a new host id takes the stamp along',
      stamps: { a1: 9, h2: 5 },
      states: [
        [rowIn('a1', 'alpha'), rowIn('b1', 'beta', 'h2')],
        [rowIn('a1', 'alpha', 'h1'), rowIn('b1', 'beta', 'h3')],
      ],
      order: ['a1', 'b1'],
      stampsAfter: { h1: 9, h3: 5 },
    },
  ])(
    'sessionsView_RecencyAcrossReloadAndRelaunch ($case)',
    ({ stamps, states, act, order, stampsAfter }) => {
      const uiState = fakeUiState([['recency', { stamps }]]);
      const setup = sessionsViewSetup(undefined, undefined, undefined, {
        uiState,
        clock: { now: () => 100 },
      });

      for (const rows of states) {
        setup.view.render(stateWith(rows));
      }
      act?.(setup);

      expect(setup.view.orderedRows().map((row) => row.sessionId)).toEqual(
        order,
      );
      expect(uiState.get('recency')).toEqual({ stamps: stampsAfter });
    },
  );

  it('sessionsView_RowsOfOneState_KeepMainsOrderAcrossAClockTick', () => {
    const clock = { time: 0, now: () => ++clock.time };
    const { view } = sessionsViewSetup(undefined, undefined, undefined, {
      clock,
    });

    view.render(
      stateWith([
        rowIn('a1', 'alpha'),
        rowIn('b1', 'beta'),
        rowIn('g1', 'gamma'),
      ]),
    );

    expect(view.orderedRows().map((row) => row.sessionId)).toEqual([
      'a1',
      'b1',
      'g1',
    ]);
  });

  it('sidebarGroup_HeaderTooltipIsItsProject', () => {
    const setup = sessionsViewSetup();

    setup.view.render(stateWith([rowIn('a1', 'alpha'), rowIn('b1', 'beta')]));

    expect(headerOf(setup, 'alpha').title).toBe('alpha');
    expect(headerOf(setup, 'beta').title).toBe('beta');
  });

  it('sidebarDrag_HoldsRedrawsAndMarksReorderingOnTheNextTick', () => {
    let tick: (() => void) | null = null;
    const setup = sessionsViewSetup(undefined, undefined, undefined, {
      timers: {
        set(run) {
          tick = run;
          return 1;
        },
        clear() {
          tick = null;
        },
      },
    });
    const { view, sideBar } = setup;
    view.render(stateWith([rowIn('a1', 'alpha')]));
    const [list] = findAll(sideBar, 'session-sidebar');
    const header = headerOf(setup, 'alpha');
    const dataTransfer = fakeTransfer();

    header.fire('dragstart', { dataTransfer });
    expect(list.classList.contains('is-reordering')).toBe(false);
    tick!();
    expect(list.classList.contains('is-reordering')).toBe(true);

    view.render(stateWith([rowIn('b1', 'beta')]));
    expect(headerOf(setup, 'alpha')).toBe(header);

    header.fire('dragend', { dataTransfer });
    expect(list.classList.contains('is-reordering')).toBe(false);
    expect(drawnRows(sideBar)).toHaveLength(1);
    expect(drawnRows(sideBar)[0].title).toContain('label b1');
  });

  it('sidebarDrag_RedrawnBeforeTheTick_ClearsTheTimerAndTheMark', () => {
    let tick: (() => void) | null = null;
    const setup = sessionsViewSetup(undefined, undefined, undefined, {
      timers: {
        set(run) {
          tick = run;
          return 1;
        },
        clear() {
          tick = null;
        },
      },
    });
    setup.view.render(stateWith([rowIn('a1', 'alpha')]));
    const dataTransfer = fakeTransfer();

    headerOf(setup, 'alpha').fire('dragstart', { dataTransfer });
    expect(tick).not.toBeNull();
    setup.view.setLayouts(withUser<Layout>(defaultLayout, {}));

    expect(tick).toBeNull();
    const [list] = findAll(setup.sideBar, 'session-sidebar');
    expect(list.classList.contains('is-reordering')).toBe(false);
    expect(drawnRows(setup.sideBar)).toHaveLength(1);
  });

  it('dispose_DuringADrag_EndsTheDragAndRunsNoHeldDraw', () => {
    let tick: (() => void) | null = null;
    const setup = sessionsViewSetup(undefined, undefined, undefined, {
      timers: {
        set(run) {
          tick = run;
          return 1;
        },
        clear() {
          tick = null;
        },
      },
    });
    setup.view.render(stateWith([rowIn('a1', 'alpha')]));
    const header = headerOf(setup, 'alpha');
    header.fire('dragstart', { dataTransfer: fakeTransfer() });
    setup.view.render(stateWith([rowIn('b1', 'beta')]));

    setup.view.dispose();

    expect(tick).toBeNull();
    expect(header.classList.contains('is-dragging')).toBe(false);
    expect(drawnRows(setup.sideBar)[0].title).toContain('label a1');
  });

  it('sidebarDrag_EndedBeforeTheTick_NeverMarksReordering', () => {
    let tick: (() => void) | null = null;
    const setup = sessionsViewSetup(undefined, undefined, undefined, {
      timers: {
        set(run) {
          tick = run;
          return 1;
        },
        clear() {
          tick = null;
        },
      },
    });
    setup.view.render(stateWith([rowIn('a1', 'alpha')]));
    const header = headerOf(setup, 'alpha');
    const dataTransfer = fakeTransfer();

    header.fire('dragstart', { dataTransfer });
    header.fire('dragend', { dataTransfer });

    expect(tick).toBeNull();
  });

  it.each([
    { favorites: ['alpha'], hasFavorites: true },
    { favorites: ['absent'], hasFavorites: false },
    { favorites: [], hasFavorites: false },
  ])(
    'sidebarSections_HasFavoritesOnlyWhileOneShows ($favorites)',
    ({ favorites, hasFavorites }) => {
      const { view, sideBar } = sessionsViewSetup(
        undefined,
        undefined,
        undefined,
        { uiState: fakeUiState([['favorites', favorites]]) },
      );

      view.render(stateWith([rowIn('a1', 'alpha')]));

      const [list] = findAll(sideBar, 'session-sidebar');
      expect(list.classList.contains('has-favorites')).toBe(hasFavorites);
      expect(findAll(sideBar, 'session-section')).toHaveLength(2);
    },
  );

  it('sessionsView_SectionAddedThenDisposed_RedrawsTheSideBar', () => {
    const setup = sessionsViewSetup();
    const { view, sideBar, sections } = setup;
    let headerDisposes = 0;
    const retro: SidebarSection = {
      id: 'retro',
      label: 'Retro',
      order: 0,
      claims: (row) => row.sessionId === 'r1',
      header: {
        build(parent) {
          const span = document.createElement('span');
          span.textContent = '2 queued';
          parent.append(span);
          return {
            dispose: () => {
              headerDisposes++;
            },
          };
        },
      },
    };
    const state = stateWith([rowIn('r1', 'alpha'), rowIn('a1', 'alpha')]);
    view.render(state);
    const orderedIds = () => view.orderedRows().map((row) => row.sessionId);

    const added = sections.add(retro);

    const [section] = findAll(sideBar, 'session-section--plugin');
    expect(findAll(section, 'session-section-label')[0].textContent).toContain(
      'Retro',
    );
    expect(findAll(section, 'session-section-part')[0].textContent).toBe(
      '2 queued',
    );
    const claimed = drawnRows(sideBar).filter((row) =>
      row.classList.contains('session-row--claimed'),
    );
    expect(claimed).toEqual([rowNamed(drawnRows(sideBar), 'label r1')]);
    expect(findAll(section, 'session-row--claimed')).toEqual(claimed);
    expect(orderedIds()).toEqual(['a1', 'r1']);
    view.render(state);
    expect(headerDisposes).toBe(1);

    added.dispose();

    expect(findAll(sideBar, 'session-section--plugin')).toEqual([]);
    expect(orderedIds()).toEqual(['r1', 'a1']);
    expect(
      rowNamed(
        findAll(groupNamed(setup, 'alpha'), 'ui-row'),
        'label r1',
      ).classList.contains('session-row--claimed'),
    ).toBe(false);
    expect(headerDisposes).toBe(2);
  });

  it('sessionsView_ClaimsThrows_RowStaysInItsGroupAndLogs', () => {
    const setup = sessionsViewSetup();
    setup.sections.add({
      id: 'retro',
      label: 'Retro',
      order: 0,
      claims(row) {
        if (row.sessionId === 'r1') {
          throw new Error('boom');
        }
        return false;
      },
    });

    setup.view.render(stateWith([rowIn('a1', 'alpha'), rowIn('r1', 'alpha')]));

    expect(
      setup.logged.filter(
        (line) => line === 'section retro claims failed: boom',
      ),
    ).toHaveLength(1);
    const r1 = rowNamed(
      findAll(groupNamed(setup, 'alpha'), 'ui-row'),
      'label r1',
    );
    expect(r1.classList.contains('session-row--claimed')).toBe(false);
    expect(findAll(setup.sideBar, 'session-section--plugin')).toEqual([]);
  });
});

describe('the sessions list', () => {
  beforeEach(() => {
    installFocusFakeDom(vi.stubGlobal);
  });

  // Rows a and b in the favorite gamma, then c in alpha under Recent, with b
  // selected: the focused pane shows it.
  function listSetup() {
    const setup = sessionsViewSetup(undefined, undefined, undefined, {
      uiState: fakeUiState([['favorites', ['gamma']]]),
    });
    setup.view.render(
      stateWith([
        rowIn('a', 'gamma'),
        rowIn('b', 'gamma'),
        rowIn('c', 'alpha'),
      ]),
    );
    setup.view.panes.load(setup.view.panes.focusedPaneId(), 'b');
    return setup;
  }

  // What the side bar draws of the list: the rows ringed as the cursor, and
  // the prompted rows with how many keys each cursor prompt names.
  function drawnList({ sideBar }: Setup) {
    const rows = drawnRows(sideBar);
    const idOf = (row: FakeElement) => row.title.replace(/.*label /, '');
    const prompted = rows.filter(
      (row) => findAll(row, 'session-row-actions').length > 0,
    );
    return {
      ringed: rows
        .filter((row) => row.classList.contains('is-cursor'))
        .map(idOf),
      prompted: prompted.map((row) => ({
        row: idOf(row),
        keys: findAll(row, 'session-row-actions')[0].children.length,
      })),
    };
  }

  it.each<{
    case: string;
    act: (setup: Setup) => unknown;
    result: unknown;
    ringed: string[];
    prompted: { row: string; keys: number }[];
  }>([
    {
      case: 'enter puts the cursor on the selected row',
      act: ({ view }) => view.list.enter()?.sessionId,
      result: 'b',
      ringed: ['b'],
      prompted: [{ row: 'b', keys: 5 }],
    },
    {
      case: 'a move to the last row takes the ring and a Recent prompt',
      act: ({ view }) => {
        view.list.enter();
        return view.list.move('last')?.sessionId;
      },
      result: 'c',
      ringed: ['c'],
      prompted: [{ row: 'c', keys: 3 }],
    },
    {
      case: 'leave takes the ring and the prompt off',
      act: ({ view }) => {
        view.list.enter();
        view.list.move('last');
        return view.list.leave();
      },
      result: true,
      ringed: [],
      prompted: [],
    },
    {
      case: 'a second leave does nothing',
      act: ({ view }) => {
        view.list.enter();
        view.list.leave();
        return view.list.leave();
      },
      result: false,
      ringed: [],
      prompted: [],
    },
  ])(
    'sessionList_EntryMovesAndLeave: $case',
    ({ act, result, ringed, prompted }) => {
      const setup = listSetup();

      expect(act(setup)).toEqual(result);

      expect(drawnList(setup)).toEqual({ ringed, prompted });
    },
  );

  // Breaks: the scroll run on every draw, yanking a wheel scroll back, or
  // skipped on a move.
  it('sessionList_ScrollsTheCursorOnlyOnEntryOrAMove', () => {
    const setup = listSetup();
    const scrolled = vi.spyOn(FakeElement.prototype, 'scrollIntoView');
    const scrolls: number[] = [];

    setup.view.list.enter();
    scrolls.push(scrolled.mock.calls.length);
    setup.view.render(
      stateWith([
        rowIn('a', 'gamma'),
        rowIn('b', 'gamma'),
        rowIn('c', 'alpha'),
      ]),
    );
    scrolls.push(scrolled.mock.calls.length);
    setup.view.list.move('last');
    scrolls.push(scrolled.mock.calls.length);

    expect(scrolls).toEqual([1, 1, 2]);
  });

  it('sessionList_RowLeaving_MovesTheCursorAndReports', () => {
    const setup = listSetup();
    setup.view.list.enter();
    setup.view.list.move('last');

    setup.view.render(stateWith([rowIn('a', 'gamma'), rowIn('b', 'gamma')]));

    expect(setup.cursorMoves).toEqual(['b']);
    expect(setup.view.list.cursorSessionId()).toBe('b');
    expect(drawnList(setup).ringed).toEqual(['b']);
  });

  it('sessionList_RowClick_MovesTheCursorWhileTheListHoldsTheKeys', () => {
    const setup = listSetup();
    setup.view.list.enter();

    rowNamed(drawnRows(setup.sideBar), 'label a').click();

    expect(setup.cursorMoves).toEqual(['a']);
    expect(setup.activated).toEqual(['a']);
    expect(drawnList(setup).ringed).toEqual(['a']);
  });
});
