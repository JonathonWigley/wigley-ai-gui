import { describe, expect, it } from 'vitest';
import type { Layout, LayoutCard, LayoutPane } from '../../layouts/layout';
import type { RoundState } from '../form-state';
import {
  apply,
  finding,
  initialState,
  notice,
  presentedRound,
  question,
  type RoundParts,
} from '../test-rounds';
import {
  itemLayout,
  layoutChain,
  pickLayout,
  pickRoundLayouts,
  picksEqual,
  roundLayoutNames,
} from './layout-resolver';

const card = (): LayoutCard => ({ element: {} as HTMLElement });
const pane = (): LayoutPane => ({ element: {} as HTMLElement });

function allCards(): Layout {
  return { cards: { question: card, finding: card, notice: card } };
}

// The shown round of `parts`, with no questions unless they name some, and
// the round's own layout.
function round(
  parts: RoundParts & { layout?: string | null } = {},
): RoundState {
  const presented = presentedRound('r', { questions: [], ...parts });
  presented.round = { ...presented.round, layout: parts.layout ?? null };
  return apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  }).forms[0];
}

describe('layoutChain', () => {
  it('layoutChain_DropsNullsAndRepeats_EndsAtDefault', () => {
    expect(layoutChain('a', null, 'a')).toEqual(['a', 'default']);
    expect(layoutChain(null, null, 'default')).toEqual(['default']);
    expect(layoutChain('i', 'r', 'u')).toEqual(['i', 'r', 'u', 'default']);
  });
});

describe('pickLayout', () => {
  it('pickLayout_PartialLayout_FallsToNextInChain', () => {
    const theirs: Layout = { cards: { question: card } };
    const loaded = new Map<string, Layout>([
      ['mine', { cards: { finding: card } }],
      ['theirs', theirs],
      ['default', allCards()],
    ]);

    const pick = pickLayout(
      { card: 'question' },
      ['mine', 'theirs', 'default'],
      loaded,
    );

    expect(pick.name).toBe('theirs');
    expect(pick.layout).toBe(theirs);
  });

  it('pickLayout_Pane_SkipsALayoutWithOnlyCards', () => {
    const rail: Layout = { rail: pane };
    const loaded = new Map<string, Layout>([
      ['mine', allCards()],
      ['theirs', rail],
      ['default', allCards()],
    ]);

    const pick = pickLayout(
      { pane: 'rail' },
      ['mine', 'theirs', 'default'],
      loaded,
    );

    expect(pick).toEqual({ name: 'theirs', layout: rail });
  });

  it('pickCard_PluginKind_KindsBuilderBeatsAnEarlierOther', () => {
    const byKind: Layout = { cards: { kinds: { poll: card } } };
    const loaded = new Map<string, Layout>([
      ['mine', { cards: { other: card, kinds: { vote: card } } }],
      ['theirs', byKind],
      ['default', allCards()],
    ]);

    const pick = pickLayout(
      { card: 'poll' },
      ['mine', 'theirs', 'default'],
      loaded,
    );

    expect(pick).toEqual({ name: 'theirs', layout: byKind });
  });

  it.each<{ case: string; mine: Layout; theirs: Layout; picked: string }>([
    {
      case: 'the first layout defining other',
      mine: { cards: { kinds: { vote: card } } },
      theirs: { cards: { other: card } },
      picked: 'theirs',
    },
    {
      case: 'default when no layout defines other',
      mine: { cards: { question: card } },
      theirs: { rail: pane },
      picked: 'default',
    },
  ])(
    'pickCard_PluginKind_NoKindsBuilder_TakesFirstOther: $case',
    ({ mine, theirs, picked }) => {
      const loaded = new Map<string, Layout>([
        ['mine', mine],
        ['theirs', theirs],
        ['default', allCards()],
      ]);

      const pick = pickLayout(
        { card: 'poll' },
        ['mine', 'theirs', 'default'],
        loaded,
      );

      expect(pick.name).toBe(picked);
    },
  );
});

describe('itemLayout', () => {
  it('itemLayout_ReadsEachKindsItem', () => {
    const named = round({
      findings: [finding('F1'), finding('F2', { layout: 'f' })],
      notices: [{ ...notice('N1'), layout: 'n' }],
      questions: [question('Q1')],
    });

    expect(itemLayout(named, { kind: 'finding', index: 2 })).toBe('f');
    expect(itemLayout(named, { kind: 'notice', index: 1 })).toBe('n');
    expect(itemLayout(named, { kind: 'question', index: 1 })).toBeNull();
  });
});

describe('roundLayoutNames', () => {
  it('roundLayoutNames_RoundAndItems_UniqueWithoutNulls', () => {
    const named = round({
      layout: 'r',
      findings: [finding('F1', { layout: 'r' })],
      questions: [question('Q1', { layout: 'q' }), question('Q2')],
      notices: [{ ...notice('N1'), layout: 'n' }],
    });

    expect(roundLayoutNames(named)).toEqual(['r', 'q', 'n']);
  });
});

describe('pickRoundLayouts', () => {
  it('pickRoundLayouts_CardsPerStop_NoticeCardsByNotice_PanesWithoutItem', () => {
    const f = allCards();
    const n: Layout = { cards: { notice: card } };
    const u: Layout = {
      ...allCards(),
      head: () => undefined,
      notices: pane,
    };
    const loaded = new Map([
      ['f', f],
      ['n', n],
      ['u', u],
      ['default', allCards()],
    ]);
    const named = round({
      notices: [notice('N1'), { ...notice('N2'), layout: 'n' }],
      findings: [finding('F1', { layout: 'f' })],
      questions: [question('Q1')],
    });

    const picks = pickRoundLayouts(named, 'u', loaded);

    expect(picks.cards.map((pick) => pick.name)).toEqual(['f', 'u']);
    expect(picks.cards[0].layout).toBe(f);
    expect(picks.noticeCards.map((pick) => pick.name)).toEqual(['u', 'n']);
    expect(picks.noticeCards[1].layout).toBe(n);
    expect(picks.panes.head).toEqual({ name: 'u', layout: u });
    expect(picks.panes.notices).toEqual({ name: 'u', layout: u });
  });

  it('pickRoundLayouts_PanesSkipTheItemLayout', () => {
    const loaded = new Map<string, Layout>([
      ['f', { ...allCards(), review: pane }],
      ['n', { ...allCards(), notices: pane }],
      ['default', allCards()],
    ]);
    const named = round({
      findings: [finding('F1', { layout: 'f' })],
      notices: [{ ...notice('N1'), layout: 'n' }],
    });

    const picks = pickRoundLayouts(named, 'default', loaded);

    expect(picks.cards[0].name).toBe('f');
    expect(picks.panes.review.name).toBe('default');
    expect(picks.panes.notices.name).toBe('default');
    expect(picks.noticeCards[0].name).toBe('n');
  });
});

describe('picksEqual', () => {
  it('picksEqual_SameNamesSameObjects_True_NewObject_False', () => {
    const named = round({
      findings: [finding('F1', { layout: 'f' })],
      questions: [question('Q1')],
      notices: [{ ...notice('N1'), layout: 'n' }],
    });
    const fallback = allCards();
    const f = allCards();
    const n = allCards();
    const loaded = new Map([
      ['f', f],
      ['n', n],
      ['default', fallback],
    ]);
    const reloadedCard = new Map([
      ['f', allCards()],
      ['n', n],
      ['default', fallback],
    ]);
    const reloadedNoticeCard = new Map([
      ['f', f],
      ['n', allCards()],
      ['default', fallback],
    ]);
    const withNotices: Layout = { notices: pane };
    const withNoticesAgain: Layout = { notices: pane };

    const first = pickRoundLayouts(named, 'default', loaded);

    expect(picksEqual(first, pickRoundLayouts(named, 'default', loaded))).toBe(
      true,
    );
    expect(
      picksEqual(first, pickRoundLayouts(named, 'default', reloadedCard)),
    ).toBe(false);
    expect(
      picksEqual(first, pickRoundLayouts(named, 'default', reloadedNoticeCard)),
    ).toBe(false);
    // Only the notices pane's layout object is new.
    const panesFirst = pickRoundLayouts(
      named,
      'u',
      new Map([...loaded, ['u', withNotices]]),
    );
    const panesReloaded = pickRoundLayouts(
      named,
      'u',
      new Map([...loaded, ['u', withNoticesAgain]]),
    );
    expect(panesReloaded.panes.notices.layout).toBe(withNoticesAgain);
    expect(picksEqual(panesFirst, panesReloaded)).toBe(false);
  });
});
