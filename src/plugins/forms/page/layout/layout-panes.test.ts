import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormsReviewColumn } from '../../contract';
import defaultLayout from '../../layouts/default/layout.js';
import type {
  Layout,
  RailInput,
  ReviewInput,
  ReviewKit,
} from '../../layouts/layout';
import {
  createFormsContributions,
  type FormsContributions,
} from '../contributions';
import type { FormsState } from '../form-state';
import type { RoundState } from '../round-model';
import { fakeKitCommandsOf } from '../../../../shared/page/layout-host/fake-kit-commands.test-support';
import { formsManifest } from '../../manifest';
import type { CardDeps } from '../kinds/item-format';
import {
  apply,
  formsWith,
  initialState,
  notice,
  presentedRound,
  question,
} from '../test-rounds';
import { poll, pollPageKind } from '../kinds/plugin-page-kind.test-support';
import {
  buildNoticesPane,
  buildRailPane,
  buildReviewPane,
  type PaneDeps,
} from './layout-panes';
import type { LayoutPick } from './layout-resolver';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import { NO_FENCES } from '../../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../../shared/page/layout-host/fake-layout-state.test-support';

// Round r1, two questions, open and active.
function openRound(): FormsState {
  const presented = presentedRound('r1');
  return apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  });
}

// Pane deps over `contributions` whose commands register every forms
// command, each run recorded.
function fakePaneDeps(contributions: FormsContributions) {
  const keysFor = vi.fn(() => null);
  const anchor = vi.fn(
    (_element: HTMLElement, _command: string, _options?: unknown) => ({
      dispose: () => undefined,
    }),
  );
  const log = vi.fn();
  const run = vi.fn();
  const deps: PaneDeps = {
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    platform: 'macos',
    state: noLayoutState,
    log,
    keys: { keysFor, anchor },
    run: vi.fn(),
    mountBox: vi.fn(),
    destroyBox: vi.fn(),
    commands: fakeKitCommandsOf(formsManifest, run),
    contributions,
    recordAnchor: () => {},
    recordMount: () => {},
  };
  return { deps, keysFor, anchor, log, run };
}

// Card deps over the pane deps' boxes, keys and log.
function fakeCardDeps(deps: PaneDeps): CardDeps {
  return {
    markdown: deps.markdown,
    mountBox: deps.mountBox,
    destroyBox: deps.destroyBox,
    keys: deps.keys,
    platform: deps.platform,
    log: deps.log,
    commands: deps.commands,
    contributions: createFormsContributions(),
    state: deps.state,
    recordAnchor: () => {},
    recordMount: () => {},
  };
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
  const { deps, log, run } = fakePaneDeps(contributions);
  const pane = buildReviewPane(
    { name: 'test', layout: oneRowReview() },
    asHtml(new FakeElement('div')),
    round,
    deps,
  );
  pane.update(round, true);
  const [row] = findAll(asFake(pane.element), 'review-row');
  return { row, log, run };
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

    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(findAll(row, 'review-pick')).toHaveLength(1);
    expect(
      findAll(row, 'review-cell').map((cell) => cell.dataset.column),
    ).toEqual(['c2']);
  });

  it('reviewPick_Click_RunsReviewJumpAt', () => {
    const { row, run } = drawRow(createFormsContributions());

    findAll(row, 'review-pick')[0].click();

    expect(run.mock.calls).toEqual([['forms.reviewJumpAt', 0]]);
  });

  it('reviewKit_KeysFor_ReadsTheReviewScope', () => {
    const state = openRound();
    const { deps, keysFor } = fakePaneDeps(createFormsContributions());
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
    expect(keysFor).toHaveBeenCalledWith(
      'demo.run',
      'forms.review',
      undefined,
      undefined,
    );
  });

  it('reviewKit_KeyHint_AnchorsInTheReviewScope', () => {
    const state = openRound();
    const { deps, anchor } = fakePaneDeps(createFormsContributions());

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
    const { deps, anchor } = fakePaneDeps(createFormsContributions());
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

// A layout's pane drawn into a fresh parent over `state`'s first round, with
// its deps.
function drawPane(
  build: typeof buildRailPane | typeof buildReviewPane,
  layout: Layout,
  state: FormsState = openRound(),
) {
  const { deps, log, run } = fakePaneDeps(createFormsContributions());
  const parent = new FakeElement('div');
  const pane = build(
    { name: 'test', layout },
    asHtml(parent),
    state.forms[0],
    deps,
  );
  return { pane, parent, deps, log, run };
}

const DEFAULT_PICK: LayoutPick = { name: 'default', layout: defaultLayout };

// Round r1, one question and two notices (N1 Decided, N2 Applied), open and
// active in the forms view.
function noticesState(): FormsState {
  const presented = presentedRound('r1', {
    questions: [question('Alpha')],
    notices: [{ ...notice('Heads up'), badge: 'Decided' }, notice('Also')],
  });
  return apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  });
}

// The notices pane drawn with `pick` into a fresh parent over `round` (by
// default the first round of noticesState), each body with `bodyPicks`.
function drawNoticesPane(
  pick: LayoutPick,
  options: {
    round?: RoundState;
    bodyPicks?: LayoutPick[];
  } = {},
) {
  const state = noticesState();
  const round = options.round ?? state.forms[0];
  const { deps, log, run } = fakePaneDeps(createFormsContributions());
  const parent = new FakeElement('div');
  const pane = buildNoticesPane(
    pick,
    options.bodyPicks ?? [DEFAULT_PICK, DEFAULT_PICK],
    asHtml(parent),
    round,
    1,
    deps,
    fakeCardDeps(deps),
  );
  return { pane, parent, deps, log, run, round };
}

// The notices pane's lines, in order.
function noticeLines(pane: { element: HTMLElement }) {
  return findAll(asFake(pane.element), 'notice-line');
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

  it.each([
    {
      pane: 'rail',
      draw: () =>
        drawPane(buildRailPane, {
          rail: (parent, _input, kit) => ({
            element: kit.el(parent, 'nav', 'rail'),
          }),
        }),
    },
    {
      pane: 'notices',
      draw: () =>
        drawNoticesPane({
          name: 'test',
          layout: {
            notices: (parent, _input, kit) => ({
              element: kit.el(parent, 'section', 'notices'),
            }),
          },
        }),
    },
  ])('pane_PickedDraws_MarksItWithItsLayout_$pane', ({ draw }) => {
    const { pane, log } = draw();

    expect(log).not.toHaveBeenCalled();
    expect(pane.element.dataset.layout).toBe('test');
    expect(pane.element.dataset.layoutOwner).toBe('forms');
  });

  it('railPane_NoticesStop_EntryIsLastWithItsLabelAndTitle', () => {
    const inputs: RailInput[] = [];
    const presented = presentedRound('r1', {
      questions: [question('Alpha')],
      notices: [notice('Heads up'), notice('Also')],
    });
    const state = initialState([presented], presented.sessionId);

    drawPane(
      buildRailPane,
      {
        rail: (parent, input, kit) => {
          inputs.push(input);
          return { element: kit.el(parent, 'nav', 'rail') };
        },
      },
      state,
    );

    expect(inputs[0].items.at(-1)).toEqual({
      position: 1,
      kind: 'notices',
      label: 'N',
      title: 'Notices · 2',
    });
  });

  it('reviewPane_NoteLeftOut_AppendsItToThePane', () => {
    const { deps } = drawPane(buildReviewPane, oneRowReview());

    expect(deps.mountBox).toHaveBeenCalledWith(
      expect.anything(),
      { field: 'note' },
      expect.any(String),
    );
  });

  it('railEntry_KindWithNoAnswer_CarriesItsKindAndStatusNone', () => {
    const inputs: RailInput[] = [];
    const forms = formsWith([pollPageKind('poll', { answerable: false })]);
    const presented = presentedRound('r1', {
      questions: [question('Alpha')],
      items: { poll: [poll('Lunch')] },
      bodyKeys: { poll: 'poll_answers' },
    });
    const state = forms.initialState([presented], presented.sessionId);

    const { pane } = drawPane(
      buildRailPane,
      {
        rail(parent, input, kit) {
          inputs.push(input);
          const nav = kit.el(parent, 'nav', 'rail');
          kit.entry(nav, 0);
          return { element: nav };
        },
      },
      state,
    );
    (pane as ReturnType<typeof buildRailPane>).update(state.forms[0], 'review');

    expect(inputs[0].items[0]).toEqual({
      position: 0,
      kind: 'poll',
      label: 'P1',
      title: 'Lunch',
    });
    const [entry] = findAll(asFake(pane.element), 'rail-entry');
    expect(entry.dataset.status).toBe('none');
    expect(entry.classList.contains('is-flagged')).toBe(false);
  });

  it('reviewRow_AnswerableKind_CarriesItsKind', () => {
    const inputs: ReviewInput[] = [];
    const forms = formsWith([pollPageKind('poll')]);
    const presented = presentedRound('r1', {
      questions: [question('Alpha')],
      items: { poll: [poll('Lunch')] },
      bodyKeys: { poll: 'poll_answers' },
    });
    const state = forms.initialState([presented], presented.sessionId);

    drawPane(
      buildReviewPane,
      {
        review(parent, input, kit) {
          inputs.push(input);
          return { element: kit.el(parent, 'div', 'review') };
        },
      },
      state,
    );

    expect(inputs[0].rows).toEqual([
      { row: 0, kind: 'poll', label: 'P1', title: 'Lunch' },
      { row: 1, kind: 'question', label: '1', title: expect.any(String) },
    ]);
  });

  it('railEntry_Click_RunsPickRailItem', () => {
    const { pane, run } = drawPane(buildRailPane, {
      rail(parent, _input, kit) {
        const nav = kit.el(parent, 'nav', 'rail');
        kit.entry(nav, 1);
        return { element: nav };
      },
    });

    findAll(asFake(pane.element), 'rail-entry')[0].click();

    expect(run.mock.calls).toEqual([['forms.pickRailItem', 1]]);
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

    expect(log).toHaveBeenCalledWith(expect.stringContaining(String(row)));
    expect(pane.element.dataset.layout).toBe('default');
  });
});

describe('notices pane', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { open: [false, false], hidden: [true, true] },
    { open: [false, true], hidden: [true, false] },
  ])(
    'noticesPane_Default_DrawsBadgeAndTitlePerLineWithHiddenBodies_$open',
    ({ open, hidden }) => {
      const round = { ...noticesState().forms[0], openNotices: open };

      const { pane } = drawNoticesPane(DEFAULT_PICK, { round });

      const lines = noticeLines(pane);
      expect(
        lines.map((line) => [
          findAll(line, 'ui-tag')[0]?.textContent,
          findAll(line, 'notice-line-title')[0]?.textContent,
          findAll(line, 'notice-line-title')[0]?.title,
        ]),
      ).toEqual([
        ['Decided', 'Heads up', 'Heads up'],
        ['Applied', 'Also', 'Also'],
      ]);
      expect(
        findAll(asFake(pane.element), 'ui-collapsible-body').map(
          (body) => body.hidden,
        ),
      ).toEqual(hidden);
    },
  );

  it.each([
    { case: 'index 0', index: 0, twice: false },
    { case: 'index 1.5', index: 1.5, twice: false },
    { case: 'index 3', index: 3, twice: false },
    { case: 'line 1 twice', index: 1, twice: true },
  ])('noticesKit_BadLine_FallsBackToDefault ($case)', ({ index, twice }) => {
    const { pane, log } = drawNoticesPane({
      name: 'test',
      layout: {
        notices(parent, _input, kit) {
          const section = kit.el(parent, 'section', 'notices');
          kit.line(section, index);
          if (twice) {
            kit.line(section, index);
          }
          return { element: section };
        },
      },
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining(String(index)));
    expect(pane.element.dataset.layout).toBe('default');
  });

  it('noticesPane_Throws_DestroysEachBodysBoxOnce', () => {
    const { pane, deps, log } = drawNoticesPane({
      name: 'test',
      layout: {
        notices(parent, _input, kit) {
          kit.line(kit.el(parent, 'section', 'notices'), 1);
          throw new Error('boom');
        },
      },
    });

    expect(deps.destroyBox).toHaveBeenCalledTimes(1);
    expect(deps.destroyBox).toHaveBeenCalledWith({
      field: 'comment',
      item: { kind: 'notice', index: 1 },
    });
    expect(log).toHaveBeenCalledWith('layout test notices failed: boom');
    expect(pane.element.dataset.layout).toBe('default');
    expect(noticeLines(pane)).toHaveLength(2);
    for (const target of [1, 2]) {
      expect(deps.mountBox).toHaveBeenCalledWith(
        expect.anything(),
        { field: 'comment', item: { kind: 'notice', index: target } },
        expect.any(String),
      );
    }
  });

  it('noticesPane_LineLeftOut_AppendsItAtTheEnd', () => {
    const { pane, deps } = drawNoticesPane({
      name: 'test',
      layout: {
        notices(parent, _input, kit) {
          const section = kit.el(parent, 'section', 'notices');
          kit.line(kit.el(section, 'div', 'mine'), 1);
          return { element: section };
        },
      },
    });

    const lines = noticeLines(pane);
    expect(lines).toHaveLength(2);
    expect(asFake(pane.element).children.at(-1)).toBe(lines[1]);
    const title = findAll(lines[1], 'notice-line-title')[0];
    expect([title?.textContent, title?.title]).toEqual(['Also', 'Also']);
    expect(deps.mountBox).toHaveBeenCalledWith(
      expect.anything(),
      { field: 'comment', item: { kind: 'notice', index: 2 } },
      expect.any(String),
    );
  });

  it('noticesPane_BodyPicks_DrawEachBodyWithItsOwnPick', () => {
    const mine: Layout = {
      cards: {
        notice: (parent, _input, kit) => ({
          element: kit.el(parent, 'div', 'mine-notice'),
        }),
      },
    };

    const { pane } = drawNoticesPane(DEFAULT_PICK, {
      bodyPicks: [DEFAULT_PICK, { name: 'mine', layout: mine }],
    });

    expect(
      findAll(asFake(pane.element), 'notice-line-body').map(
        (body) => body.children[0]?.dataset.layout,
      ),
    ).toEqual(['default', 'mine']);
  });

  it.each([
    {
      case: 'line 1 open, cursor moves to line 2',
      updates: [{ openNotices: [true, false], noticeLine: 2 }],
      open: [true, false],
      cursor: [false, true],
      scrolled: [2],
    },
    {
      case: 'line 2 open, cursor stays on line 1',
      updates: [{ openNotices: [false, true], noticeLine: 1 }],
      open: [false, true],
      cursor: [true, false],
      scrolled: [],
    },
    {
      case: 'cursor unchanged on a second update',
      updates: [{ noticeLine: 2 }, { noticeLine: 2 }],
      open: [false, false],
      cursor: [false, true],
      scrolled: [2],
    },
  ])('noticesPane_Update_$case', ({ updates, open, cursor, scrolled }) => {
    const built = { ...noticesState().forms[0], noticeLine: 1 };
    const { pane } = drawNoticesPane(DEFAULT_PICK, { round: built });
    const lines = noticeLines(pane);
    const scrolls: number[] = [];
    lines.forEach((line, i) => {
      vi.spyOn(line, 'scrollIntoView').mockImplementation(() => {
        scrolls.push(i + 1);
      });
    });

    for (const update of updates) {
      pane.update({ ...built, ...update });
    }

    expect(lines.map((line) => line.classList.contains('is-open'))).toEqual(
      open,
    );
    expect(lines.map((line) => line.classList.contains('is-cursor'))).toEqual(
      cursor,
    );
    expect(scrolls).toEqual(scrolled);
  });

  it('noticesPane_Update_CursorLineHoldsTheTogglePrompt', () => {
    const built = { ...noticesState().forms[0], noticeLine: 1 };
    const { pane, deps } = drawNoticesPane(DEFAULT_PICK, { round: built });

    pane.update({ ...built, noticeLine: 2 });

    const lines = noticeLines(pane);
    expect(
      lines.map((line) => findAll(line, 'notice-line-prompt').length),
    ).toEqual([0, 1]);
    expect(deps.keys.anchor).toHaveBeenCalledWith(
      findAll(lines[1], 'notice-line-prompt')[0],
      'forms.toggleNotice',
      { scope: 'forms.forms', label: 'toggle' },
    );
  });

  it('noticesLine_HeadClick_RunsToggleNoticeAt', () => {
    const { pane, run } = drawNoticesPane(DEFAULT_PICK);

    findAll(noticeLines(pane)[1], 'ui-collapsible-head')[0].click();

    expect(run.mock.calls).toEqual([['forms.toggleNoticeAt', 2]]);
  });
});
