import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormsReviewColumn } from '../../contract';
import type { Layout, ReviewKit } from '../../layouts/layout';
import {
  createFormsContributions,
  type FormsContributions,
} from '../contributions';
import { apply, type FormsState, initialState } from '../form-state';
import { presentedRound } from '../test-rounds';
import { buildReviewPane, type PaneDeps } from './layout-panes';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from './test-dom';

// Round r1, two questions, open and active.
function openRound(): FormsState {
  const presented = presentedRound('r1');
  return apply(initialState([], presented.sessionId), {
    type: 'roundShown',
    round: presented,
  });
}

function fakePaneDeps(contributions: FormsContributions, state: FormsState) {
  const keysFor = vi.fn(() => null);
  const log = vi.fn();
  const deps: PaneDeps = {
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
    },
    platform: 'macos',
    log,
    keys: { keysFor },
    dispatch: vi.fn(),
    getState: () => state,
    run: vi.fn(),
    mountBox: vi.fn(),
    destroyBox: vi.fn(),
    shownView: () => 'review',
    commands: { exists: () => false, run: vi.fn() },
    contributions,
  };
  return { deps, keysFor, log };
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
  return { id, title: id, cell };
}

// The review pane built and updated once, and its row 0.
function drawRow(contributions: FormsContributions) {
  const state = openRound();
  const round = state.rounds[0];
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

  it('reviewRow_DrawsOneCellPerColumn', () => {
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
      ]),
    ).toEqual([
      ['review-cell', 'c1', 'r1 question 1'],
      ['review-cell', 'c2', 'second'],
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

    expect(log).toHaveBeenCalledWith('forms', 'review column c1 failed: boom');
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
      state.rounds[0],
      deps,
    );

    expect(read).toBeNull();
    expect(keysFor).toHaveBeenCalledWith('demo.run', 'forms.review');
  });
});
