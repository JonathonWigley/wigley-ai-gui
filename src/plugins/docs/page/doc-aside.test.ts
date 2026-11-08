import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withUser } from '../../../shared/page/layout-host/test-layouts';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  asFake,
  type FakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { AsideLinkInput, Layout } from '../layouts/layout';
import type { LinkedFromRow } from '../linked-from';
import type { DocSection } from '../sections';
import { createDocAside } from './doc-aside';
import { fakeDocsParts } from './docs-page-fakes';

const HEADING = 'test-aside-heading';
const LINK = 'test-aside-link';

const section = (title: string, level: number, startLine = 1): DocSection => ({
  title,
  level,
  startLine,
  endLine: startLine,
});

const linkRow = (title: string, path: string, line = 5): LinkedFromRow => ({
  entryId: path,
  title,
  path,
  line,
});

// The column over a layout drawing headings and rows as plain lines that hold
// their titles, each row's input in `links`. `extra` adds parts to that layout.
function setUp(extra: Layout = {}) {
  const links: AsideLinkInput[] = [];
  const { parts } = fakeDocsParts(() =>
    withUser<Layout>(defaultLayout, {
      asideHeading(parent, input, kit) {
        return { element: kit.el(parent, 'div', HEADING, input.title) };
      },
      asideLink(parent, input, kit) {
        links.push(input);
        return { element: kit.el(parent, 'div', LINK, input.title) };
      },
      ...extra,
    }),
  );
  const log = vi.fn();
  const moveToLine = vi.fn();
  const followLink = vi.fn();
  const sightLost = vi.fn();
  const aside = createDocAside({
    parts,
    paths: posixPaths,
    homeDir: '/home',
    log,
    moveToLine,
    followLink,
    sightLost,
  });
  const root = asFake(aside.element);
  const rows = () => findAll(root, LINK);
  const headings = () => findAll(root, HEADING).map((node) => node.textContent);
  return {
    parts,
    aside,
    root,
    links,
    log,
    moveToLine,
    followLink,
    sightLost,
    rows,
    headings,
  };
}

describe('createDocAside', () => {
  beforeEach(() =>
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      name: 'both',
      sections: [section('A', 2)],
      links: [linkRow('S', '/home/s.md')],
      headings: ['On this page', 'Linked from'],
      isHidden: false,
    },
    {
      name: 'only sections',
      sections: [section('A', 2)],
      links: [],
      headings: ['On this page'],
      isHidden: false,
    },
    {
      name: 'only links',
      sections: [],
      links: [linkRow('S', '/home/s.md')],
      headings: ['Linked from'],
      isHidden: false,
    },
    { name: 'neither', sections: [], links: [], headings: [], isHidden: true },
  ])(
    'show_DrawsTheSectionsItHolds $name',
    ({ sections, links, headings, isHidden }) => {
      const shown = setUp();

      shown.aside.show([section('Old', 1)], []);
      shown.aside.show(sections, links);

      expect({
        headings: shown.headings(),
        isHidden: shown.root.hidden,
        isShown: shown.aside.isShown(),
        openSections: findAll(shown.root, 'docs-aside-section').filter(
          (held) => !held.hidden,
        ).length,
      }).toEqual({
        headings,
        isHidden,
        isShown: !isHidden,
        openSections: headings.length,
      });
    },
  );

  it('show_NestedHeadings_IndentsFromTheLeastLevel', () => {
    const { aside, links } = setUp();

    aside.show([section('A', 2), section('B', 3)], []);

    expect(links.map(({ depth }) => depth)).toEqual([0, 1]);
  });

  it('show_RowTooltips_SectionTitleAndTildePath', () => {
    const { aside, rows } = setUp();

    aside.show([section('A', 2)], [linkRow('S', '/home/s.md')]);

    expect(rows().map((row) => row.title)).toEqual(['A', '~/s.md']);
  });

  it('click_SectionRowMovesAndLinkRowFollows', () => {
    const { aside, rows, moveToLine, followLink } = setUp();
    aside.show([section('A', 2, 7)], [linkRow('S', '/home/s.md', 9)]);

    rows().forEach((row) => row.click());

    expect({
      moved: moveToLine.mock.calls,
      followed: followLink.mock.calls,
    }).toEqual({ moved: [[7]], followed: [['/home/s.md', 9]] });
  });

  it('pageAside_LeavesOutItsSections_PlacesThemAtTheEnds', () => {
    const { aside, root } = setUp({
      pageAside(parent, _input, kit) {
        const body = kit.el(parent, 'div', 'test-body');
        kit.el(body, 'div', 'test-own');
        return { element: body };
      },
    });

    aside.show([section('A', 2)], [linkRow('S', '/home/s.md')]);

    const children: FakeElement[] = findAll(root, 'test-body')[0].children;
    expect(
      children.map((child) => [
        child.className,
        findAll(child, HEADING).map((node) => node.textContent),
      ]),
    ).toEqual([
      ['docs-aside-section', ['On this page']],
      ['test-own', []],
      ['docs-aside-section', ['Linked from']],
    ]);
  });

  describe('sight', () => {
    // An observer the test reports through, and its disconnects.
    function stubObserver() {
      const stub = { report: () => undefined as void, disconnect: vi.fn() };
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            stub.report = callback;
          }
          observe() {}
          disconnect = stub.disconnect;
        },
      );
      return stub;
    }

    // The column over that observer, at width `width` at each report.
    function observed() {
      const observer = stubObserver();
      const shown = setUp();
      const reportWidth = (width: number) => {
        Object.assign(shown.root, { offsetWidth: width });
        observer.report();
      };
      return { ...shown, reportWidth };
    }

    it.each([
      {
        name: 'a change each way logs once each',
        widths: [240, 240, 0, 0, 240],
        logged: [
          'right column in sight',
          'right column out of sight',
          'right column in sight',
        ],
      },
      { name: 'never in sight logs nothing', widths: [0, 0], logged: [] },
    ])('resize_ShownColumn $name', ({ widths, logged }) => {
      const { aside, reportWidth, log } = observed();
      aside.show([section('A', 2)], []);

      widths.forEach(reportWidth);

      expect(log.mock.calls.map(([line]) => line)).toEqual(logged);
    });

    it('resize_HiddenColumn_LogsNothing', () => {
      const { reportWidth, log } = observed();

      reportWidth(240);

      expect(log.mock.calls).toEqual([]);
    });

    it.each([
      { name: 'leaving sight calls once', widths: [240, 0, 0], calls: 1 },
      { name: 'never in sight calls none', widths: [0, 0], calls: 0 },
    ])(
      'resize_FocusedColumnLeavesSight_CallsSightLostOnce $name',
      ({ widths, calls }) => {
        const { aside, reportWidth, sightLost } = observed();
        aside.show([section('A', 2)], []);
        aside.focus();

        widths.forEach(reportWidth);

        expect(sightLost.mock.calls.length).toBe(calls);
      },
    );

    it.each([
      { name: 'hidden root', isShown: false, width: 240, isInSight: false },
      { name: 'width 0', isShown: true, width: 0, isInSight: false },
      { name: 'laid out', isShown: true, width: 240, isInSight: true },
    ])('isInSight_ReadsRowsAndWidth $name', ({ isShown, width, isInSight }) => {
      const { aside, root } = observed();
      if (isShown) {
        aside.show([section('A', 2)], []);
      }
      Object.assign(root, { offsetWidth: width });

      expect(aside.isInSight()).toBe(isInSight);
    });

    it('dispose_ARowThrows_StillDisposesTheRestAndTheObserver', () => {
      const { parts } = fakeDocsParts(() =>
        withUser<Layout>(defaultLayout, {}),
      );
      const disposed: string[] = [];
      const draw = parts.draw.bind(parts);
      let throwsNext = true;
      vi.spyOn(parts, 'draw').mockImplementation((part, ...rest) => {
        const drawn = draw(part, ...rest);
        return {
          ...drawn,
          dispose() {
            drawn.dispose();
            if (throwsNext) {
              throwsNext = false;
              throw new Error('row gone');
            }
            disposed.push(part);
          },
        };
      });
      const { disconnect } = stubObserver();
      const aside = createDocAside({
        parts,
        paths: posixPaths,
        homeDir: '/home',
        log: vi.fn(),
        moveToLine: vi.fn(),
        followLink: vi.fn(),
        sightLost: vi.fn(),
      });
      aside.show([section('A', 2), section('B', 2)], []);

      expect(() => aside.dispose()).toThrow('row gone');

      expect({
        disposed,
        disconnects: disconnect.mock.calls.length,
      }).toEqual({
        disposed: ['asideLink', 'asideLink', 'pageAside'],
        disconnects: 1,
      });
    });
  });

  describe('cursor', () => {
    const SECTIONS = [section('A', 2, 3), section('B', 3, 7)];
    const LINKS = [linkRow('S', '/home/s.md', 5)];

    // The column over the fixture, focused, its lines and cursor rows read.
    function focusedColumn() {
      const shown = setUp();
      shown.aside.show(SECTIONS, LINKS);
      shown.aside.focus();
      const cursorRows = () =>
        shown
          .rows()
          .filter((row) => row.classList.contains('is-cursor'))
          .map((row) => row.textContent);
      const lastLine = () => shown.log.mock.calls.at(-1)?.[0];
      return { ...shown, cursorRows, lastLine };
    }

    it.each([
      { keys: ['j'], cursor: 'B' },
      { keys: ['j', 'j'], cursor: 'S' },
      { keys: ['j', 'j', 'j'], cursor: 'S' },
      { keys: ['k'], cursor: 'A' },
      { keys: ['G'], cursor: 'S' },
      { keys: ['G', 'gg'], cursor: 'A' },
    ])(
      'move_AcrossBothLists_SkipsHeadingsAndStopsAtEnds $keys',
      ({ keys, cursor }) => {
        const { aside, cursorRows, lastLine } = focusedColumn();
        const press: Record<string, () => void> = {
          j: () => aside.move(1),
          k: () => aside.move(-1),
          gg: () => aside.top(),
          G: () => aside.bottom(),
        };

        keys.forEach((key) => press[key]());

        expect({ line: lastLine(), cursorRows: cursorRows() }).toEqual({
          line: `right column cursor: ${cursor}`,
          cursorRows: [cursor],
        });
      },
    );

    it.each([
      {
        name: 'section',
        moves: 0,
        kind: 'section',
        moved: [[3]],
        followed: [],
      },
      {
        name: 'linkedFrom',
        moves: 2,
        kind: 'linkedFrom',
        moved: [],
        followed: [['/home/s.md', 5]],
      },
    ])(
      'openCursor_ByRowKind_RunsItsAction $name',
      ({ moves, kind, moved, followed }) => {
        const { aside, moveToLine, followLink } = focusedColumn();
        for (let step = 0; step < moves; step++) {
          aside.move(1);
        }

        expect({
          kind: aside.openCursor(),
          moved: moveToLine.mock.calls,
          followed: followLink.mock.calls,
        }).toEqual({ kind, moved, followed });
      },
    );

    it('openCursor_NoRows_ReturnsNullAndRunsNothing', () => {
      const { aside, moveToLine, followLink } = setUp();
      aside.show([], []);

      expect({
        kind: aside.openCursor(),
        calls: [...moveToLine.mock.calls, ...followLink.mock.calls],
      }).toEqual({ kind: null, calls: [] });
    });

    it('cursorClasses_FocusLeavesColumn_RemovesRing', () => {
      const { root, rows } = focusedColumn();
      const ringed = () =>
        rows()
          .filter(
            (row) =>
              row.classList.contains('is-selected') ||
              row.classList.contains('is-cursor'),
          )
          .map((row) => [
            row.textContent,
            row.classList.contains('is-selected'),
            row.classList.contains('is-cursor'),
          ]);
      const focusedRing = ringed();
      const outside = document.createElement('div');

      outside.focus();
      root.fire('focusout', { relatedTarget: outside });

      expect({ focusedRing, afterRing: ringed() }).toEqual({
        focusedRing: [['A', true, true]],
        afterRing: [],
      });
    });

    it('show_FewerRows_ClampsCursor', () => {
      const { aside, cursorRows } = focusedColumn();
      aside.bottom();

      aside.show([section('A', 2)], []);

      expect(cursorRows()).toEqual(['A']);
    });

    it('reset_AfterMoves_CursorOnFirstRow', () => {
      const { aside, root, cursorRows } = focusedColumn();
      aside.bottom();
      root.scrollTop = 40;

      aside.reset();

      expect({ cursorRows: cursorRows(), scrollTop: root.scrollTop }).toEqual({
        cursorRows: ['A'],
        scrollTop: 0,
      });
    });

    it.each([
      { name: 'shown', isShown: true, calls: 1 },
      { name: 'hidden', isShown: false, calls: 0 },
    ])('clear_WhileShown_CallsSightLost $name', ({ isShown, calls }) => {
      const { aside, sightLost } = setUp();
      if (isShown) {
        aside.show(SECTIONS, LINKS);
      }

      aside.clear();

      expect(sightLost.mock.calls.length).toBe(calls);
    });
  });
});
