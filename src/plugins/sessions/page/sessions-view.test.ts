import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import { NEEDS_YOU_ACTIVITY, type SessionRow } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import { fakeUiState } from './session-fakes';
import {
  drawnRows,
  rowNamed,
  sessionRow,
  sessionsViewSetup,
} from './sessions-view-fakes';

// A row `id`, in `project`, under host session id `hostSessionId`.
function rowIn(
  id: string,
  project: string,
  hostSessionId: string | null = null,
): SessionRow {
  return { ...sessionRow(id), project, hostSessionId };
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

const PREVIEW_IGNORED_LINE =
  '[sessions] projects ignored: the layout preview shows';

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
      case: 'needs you moves a row up',
      rows: [rowIn('a1', 'alpha'), rowIn('b1', 'beta')],
      favorites: [],
      act: ({ view }) => view.setActivity('a1', 'forms', NEEDS_YOU_ACTIVITY),
      order: ['a1', 'b1'],
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
        setup.view.setActivity('a1', 'forms', NEEDS_YOU_ACTIVITY);
        rowNamed(drawnRows(setup.sideBar), 'label b1').click();
        setup.view.panes.load(setup.view.panes.focusedPaneId(), 'b1');
      },
      order: ['a1', 'b1'],
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
      line: '[sessions] alpha is not a favorite',
    },
    {
      case: 'moving a favorite down saves the new order',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['alpha', 'gamma'],
      act: ({ view }) => view.moveFavorite('alpha', 1),
      order: ['g1', 'a1'],
      saved: ['gamma', 'alpha'],
      line: '[sessions] moved alpha down',
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
      line: '[sessions] favorited alpha',
    },
    {
      case: 'a star unfavorites its project',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['alpha'],
      act: (setup) => clickStar(setup, 'alpha'),
      order: ['g1', 'a1'],
      saved: [],
      line: '[sessions] unfavorited alpha',
    },
    {
      case: 'a drop in Favorites favorites at the drop point',
      rows: [rowIn('a1', 'alpha'), rowIn('b1', 'beta'), rowIn('g1', 'gamma')],
      favorites: ['beta'],
      act: (setup) => drag(setup, 'alpha', 0),
      order: ['a1', 'b1', 'g1'],
      saved: ['alpha', 'beta'],
      line: '[sessions] moved alpha to favorites 0',
    },
    {
      case: 'a drop below a favorite favorites after it',
      rows: [rowIn('a1', 'alpha'), rowIn('b1', 'beta'), rowIn('g1', 'gamma')],
      favorites: ['beta'],
      act: (setup) => drag(setup, 'alpha', 0, 1),
      order: ['b1', 'a1', 'g1'],
      saved: ['beta', 'alpha'],
      line: '[sessions] moved alpha to favorites 1',
    },
    {
      case: 'a drop of a favorite in Recent unfavorites it',
      rows: [rowIn('a1', 'alpha'), rowIn('g1', 'gamma')],
      favorites: ['alpha'],
      act: (setup) => drag(setup, 'alpha', 1),
      order: ['g1', 'a1'],
      saved: [],
      line: '[sessions] unfavorited alpha',
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
    stamps: Record<string, number>;
    needsYou?: string[];
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
      case: 'needs you re-sent after a page reload moves no row',
      stamps: { a1: 5, b1: 9 },
      needsYou: ['a1'],
      states: [[rowIn('a1', 'alpha'), rowIn('b1', 'beta')]],
      act: ({ view }) => view.setActivity('a1', 'forms', NEEDS_YOU_ACTIVITY),
      order: ['b1', 'a1'],
      stampsAfter: { a1: 5, b1: 9 },
    },
    {
      case: 'working re-sent ahead of needs you after a page reload moves no row',
      stamps: { a1: 5, b1: 9 },
      needsYou: ['a1'],
      states: [[rowIn('a1', 'alpha'), rowIn('b1', 'beta')]],
      act: ({ view }) => {
        view.setActivity('a1', 'chat', {
          word: 'working',
          tone: 'running',
          rank: 20,
        });
        view.setActivity('a1', 'forms', NEEDS_YOU_ACTIVITY);
      },
      order: ['b1', 'a1'],
      stampsAfter: { a1: 5, b1: 9 },
    },
    {
      case: 'needs you again after it ended moves the row',
      stamps: { a1: 5, b1: 9 },
      needsYou: ['a1'],
      states: [[rowIn('a1', 'alpha'), rowIn('b1', 'beta')]],
      act: ({ view }) => {
        view.setActivity('a1', 'forms', NEEDS_YOU_ACTIVITY);
        view.setActivity('a1', 'forms', null);
        view.setActivity('a1', 'forms', NEEDS_YOU_ACTIVITY);
      },
      order: ['a1', 'b1'],
      stampsAfter: { a1: 100, b1: 9 },
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
    ({ stamps, needsYou = [], states, act, order, stampsAfter }) => {
      const uiState = fakeUiState([['recency', { stamps, needsYou }]]);
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
      expect(uiState.get('recency')).toMatchObject({ stamps: stampsAfter });
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

  it('sessionsView_NeedsYouBeforeItsRow_StampsOnArrivalOnly', () => {
    const clock = { time: 1, now: () => clock.time };
    const uiState = fakeUiState();
    const { view } = sessionsViewSetup(undefined, undefined, undefined, {
      uiState,
      clock,
    });
    view.render(stateWith([]));

    view.setActivity('a1', 'forms', NEEDS_YOU_ACTIVITY);
    expect(uiState.get('recency')).toBeUndefined();

    clock.time = 2;
    view.render(stateWith([rowIn('a1', 'alpha')]));
    expect(uiState.get('recency')).toEqual({
      stamps: { a1: 2 },
      needsYou: [],
    });
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
});
