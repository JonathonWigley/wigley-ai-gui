import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormsReviewColumn } from '../../contract';
import type { Layout, ReviewKit } from '../../layouts/layout';
import {
  createFormsContributions,
  type FormsContributions,
} from '../contributions';
import { apply, type FormsState, initialState } from '../form-state';
import { presentedRound } from '../test-rounds';
import { buildRailPane, buildReviewPane, type PaneDeps } from './layout-panes';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';

// Round r1, two questions, open and active.
function openRound(): FormsState {
  const presented = presentedRound('r1');
  return apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  });
}

function fakePaneDeps(contributions: FormsContributions, state: FormsState) {
  const keysFor = vi.fn(() => null);
  const anchor = vi.fn(
    (_element: HTMLElement, _command: string, _options?: unknown) => ({
      dispose: () => undefined,
    }),
  );
  const log = vi.fn();
  const deps: PaneDeps = {
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
    },
    platform: 'macos',
    log,
    keys: { keysFor, anchor },
    dispatch: vi.fn(),
    getState: () => state,
    run: vi.fn(),
    mountBox: vi.fn(),
    destroyBox: vi.fn(),
    shownView: () => 'review',
    commands: { exists: () => false, run: vi.fn() },
    contributions,
  };
  return { deps, keysFor, anchor, log };
}

// A review drawing only row 0 into its `ul`; `onKit` sees the kit as it
// builds.
function oneRowReview(onKit: (kit: ReviewKit) => void = () => {}): Layout {
  return {
    review(parent, _input, kit) {
      onKit(kit);
      const pane = kit.el(parent, 'div', 'review');
      const rows = kit.el(pane, 'ul', 'review-rows');
      kit.row(rows, 0);
      return { element: pane };
    },
  };
}

function column(id: string, cell: FormsReviewColumn['cell']) {
  return { id, title: `${id} title`, cell };
}

// The review pane built and updated once, and its row 0.
function drawRow(contributions: FormsContributions) {
  const state = openRound();
  const round = state.forms[0];
  const { deps, log } = fakePaneDeps(contributions, state);
  const pane = buildReviewPane(
    { name: 'test', layout: oneRowReview() },
    asHtml(new FakeElement('div')),
    round,
    deps,
  );
  pane.update(round, true);
  const [row] = findAll(asFake(pane.element), 'review-row');
  return { row, log };
}

describe('review pane', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reviewRow_DrawsOneCellPerColumnWithItsTitle', () => {
    const contributions = createFormsContributions();
    contributions.addReviewColumn(
      column('c1', (roundId, item) => `${roundId} ${item.kind} ${item.index}`),
    );
    contributions.addReviewColumn(column('c2', () => 'second'));

    const { row } = drawRow(contributions);

    const cells = row.children.slice(-2);
    expect(
      cells.map((cell) => [
        cell.className,
        cell.dataset.column,
        cell.textContent,
        cell.title,
      ]),
    ).toEqual([
      ['review-cell', 'c1', 'r1 question 1', 'c1 title'],
      ['review-cell', 'c2', 'second', 'c2 title'],
    ]);
  });

  it('reviewRow_ColumnThrows_LogsAndDrawsTheRow', () => {
    const contributions = createFormsContributions();
    contributions.addReviewColumn(
      column('c1', () => {
        throw new Error('boom');
      }),
    );
    contributions.addReviewColumn(column('c2', () => 'second'));

    const { row, log } = drawRow(contributions);

    expect(log).toHaveBeenCalledWith('forms', expect.stringContaining('boom'));
    expect(findAll(row, 'review-pick')).toHaveLength(1);
    expect(
      findAll(row, 'review-cell').map((cell) => cell.dataset.column),
    ).toEqual(['c2']);
  });

  it('reviewKit_KeysFor_ReadsTheReviewScope', () => {
    const state = openRound();
    const { deps, keysFor } = fakePaneDeps(createFormsContributions(), state);
    let read: string | null | undefined;

    buildReviewPane(
      {
        name: 'test',
        layout: oneRowReview((kit) => {
          read = kit.keysFor('demo.run');
        }),
      },
      asHtml(new FakeElement('div')),
      state.forms[0],
      deps,
    );

    expect(read).toBeNull();
    expect(keysFor).toHaveBeenCalledWith('demo.run', 'forms.review');
  });

  it('reviewKit_KeyHint_AnchorsInTheReviewScope', () => {
    const state = openRound();
    const { deps, anchor } = fakePaneDeps(createFormsContributions(), state);

    buildReviewPane(
      {
        name: 'test',
        layout: oneRowReview((kit) => {
          kit.keyHint(asHtml(new FakeElement('div')), 'askCancel');
        }),
      },
      asHtml(new FakeElement('div')),
      state.forms[0],
      deps,
    );

    expect(anchor).toHaveBeenCalledWith(expect.anything(), 'forms.askCancel', {
      scope: 'forms.review',
    });
    expect(anchor).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ scope: 'forms.forms' }),
    );
  });

  it('reviewRow_CursorRow_HoldsTheJumpPrompt', () => {
    const opened = openRound();
    const round = { ...opened.forms[0], reviewRow: 1 };
    const { deps, anchor } = fakePaneDeps(createFormsContributions(), opened);
    const pane = buildReviewPane(
      {
        name: 'test',
        layout: {
          review(parent, input, kit) {
            const rows = kit.el(parent, 'ul', 'review-rows');
            for (const row of input.rows) {
              kit.row(rows, row.row);
            }
            return { element: rows };
          },
        },
      },
      asHtml(new FakeElement('div')),
      round,
      deps,
    );

    pane.update(round, true);

    const rows = findAll(asFake(pane.element), 'review-row');
    expect(
      rows.map((row) => findAll(row, 'review-jump-prompt').length),
    ).toEqual([0, 1]);
    const jumpAnchors = anchor.mock.calls.filter(
      ([, command]) => command === 'forms.reviewJump',
    );
    expect(jumpAnchors).toEqual([
      [
        expect.anything(),
        'forms.reviewJump',
        { scope: 'forms.review', label: true },
      ],
    ]);
  });
});

// A layout's pane drawn into a fresh parent, with its deps.
function drawPane(
  build: typeof buildRailPane | typeof buildReviewPane,
  layout: Layout,
) {
  const state = openRound();
  const { deps, log } = fakePaneDeps(createFormsContributions(), state);
  const parent = new FakeElement('div');
  const pane = build(
    { name: 'test', layout },
    asHtml(parent),
    state.forms[0],
    deps,
  );
  return { pane, parent, deps, log };
}

// A review that appends a stray node and mounts the round note, then throws.
function throwingReview(): Layout {
  return {
    review(parent, _input, kit) {
      const pane = kit.el(parent, 'div', 'stray');
      kit.roundNote(pane);
      throw new Error('boom');
    },
  };
}

describe('panes', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reviewPane_Throws_DestroysTheBoxesItMounted', () => {
    const { deps } = drawPane(buildReviewPane, throwingReview());

    expect(deps.destroyBox).toHaveBeenCalledTimes(1);
    expect(deps.destroyBox).toHaveBeenCalledWith({ field: 'note' });
  });

  it('railPane_PickedDraws_MarksItWithItsLayout', () => {
    const { pane, log } = drawPane(buildRailPane, {
      rail: (parent, _input, kit) => ({
        element: kit.el(parent, 'nav', 'rail'),
      }),
    });

    expect(log).not.toHaveBeenCalled();
    expect(pane.element.dataset.layout).toBe('test');
    expect(pane.element.dataset.layoutOwner).toBe('forms');
  });

  it('reviewPane_NoteLeftOut_AppendsItToThePane', () => {
    const { deps } = drawPane(buildReviewPane, oneRowReview());

    expect(deps.mountBox).toHaveBeenCalledWith(
      expect.anything(),
      { field: 'note' },
      expect.any(String),
    );
  });

  it.each([-1, 0.5, 99])(
    'railKit_EntryAt_%s_FallsBackToDefault',
    (position) => {
      const { pane, log } = drawPane(buildRailPane, {
        rail(parent, _input, kit) {
          const nav = kit.el(parent, 'nav', 'rail');
          kit.entry(nav, position);
          return { element: nav };
        },
      });

      expect(log).toHaveBeenCalledWith(
        'forms',
        expect.stringContaining(String(position)),
      );
      expect(pane.element.dataset.layout).toBe('default');
    },
  );

  it.each([-1, 0.5, 2])('reviewKit_RowAt_%s_FallsBackToDefault', (row) => {
    const { pane, log } = drawPane(buildReviewPane, {
      review(parent, _input, kit) {
        const rows = kit.el(parent, 'ul', 'review-rows');
        kit.row(rows, row);
        return { element: rows };
      },
    });

    expect(log).toHaveBeenCalledWith(
      'forms',
      expect.stringContaining(String(row)),
    );
    expect(pane.element.dataset.layout).toBe('default');
  });
});
