import { describe, expect, it } from 'vitest';
import type { Round } from '../../contract';
import type { Layout, LayoutCard, LayoutPane } from '../../layouts/layout';
import { finding, notice, question } from '../test-rounds';
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

function round(parts: Partial<Round>): Round {
  return {
    heading: 'h',
    overview: '',
    layout: null,
    questions: [],
    notices: [],
    findings: [],
    ...parts,
  };
}

describe('layoutChain', () => {
  it('layoutChain_DropsNullsAndRepeats_EndsAtDefault', () => {
    expect(layoutChain('a', null, 'a')).toEqual(['a', 'default']);
    expect(layoutChain(null, null, 'default')).toEqual(['default']);
    expect(layoutChain('i', 'r', 'u')).toEqual(['i', 'r', 'u', 'default']);
  });
});

describe('pickLayout', () => {
  it('pickLayout_ItemLayoutDefinesKind_PicksIt', () => {
    const mine: Layout = { cards: { finding: card } };
    const loaded = new Map([
      ['mine', mine],
      ['default', allCards()],
    ]);

    expect(pickLayout('finding', ['mine', 'default'], loaded)).toEqual({
      name: 'mine',
      layout: mine,
    });
  });

  it('pickLayout_PartialLayout_FallsToNextInChain', () => {
    const theirs: Layout = { cards: { question: card } };
    const loaded = new Map<string, Layout>([
      ['mine', { cards: { finding: card } }],
      ['theirs', theirs],
      ['default', allCards()],
    ]);

    const pick = pickLayout('question', ['mine', 'theirs', 'default'], loaded);

    expect(pick.name).toBe('theirs');
    expect(pick.layout).toBe(theirs);
  });

  it('pickLayout_NameNotLoaded_Skipped', () => {
    const fallback = allCards();
    const loaded = new Map([['default', fallback]]);

    expect(pickLayout('notice', ['missing', 'default'], loaded)).toEqual({
      name: 'default',
      layout: fallback,
    });
  });

  it('pickLayout_NoLayoutDefinesHead_PicksDefault', () => {
    const loaded = new Map([
      ['mine', allCards()],
      ['default', allCards()],
    ]);

    expect(pickLayout('head', ['mine', 'default'], loaded).name).toBe(
      'default',
    );
  });

  it('pickLayout_Rail_PicksFirstDefiningIt', () => {
    const theirs: Layout = { rail: pane };
    const loaded = new Map([
      ['mine', allCards()],
      ['theirs', theirs],
      ['default', allCards()],
    ]);

    expect(pickLayout('rail', ['mine', 'theirs', 'default'], loaded)).toEqual({
      name: 'theirs',
      layout: theirs,
    });
    expect(
      pickLayout('review', ['mine', 'theirs', 'default'], loaded).name,
    ).toBe('default');
  });

  it('pickLayout_DefaultNotLoaded_Throws', () => {
    const loaded = new Map([['mine', allCards()]]);

    expect(() => pickLayout('question', ['mine', 'default'], loaded)).toThrow(
      'layout default is not loaded',
    );
  });
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
    });

    expect(roundLayoutNames(named)).toEqual(['r', 'q']);
  });
});

describe('pickRoundLayouts', () => {
  it('pickRoundLayouts_CardsInRailOrder_PanesWithoutItem', () => {
    const f = allCards();
    const u: Layout = { ...allCards(), head: () => undefined };
    const loaded = new Map([
      ['f', f],
      ['u', u],
      ['default', allCards()],
    ]);
    const named = round({
      notices: [notice('N1')],
      findings: [finding('F1', { layout: 'f' })],
      questions: [question('Q1')],
    });

    const picks = pickRoundLayouts(named, 'u', loaded);

    expect(picks.cards.map((pick) => pick.name)).toEqual(['u', 'f', 'u']);
    expect(picks.cards[1].layout).toBe(f);
    expect(picks.panes.head).toEqual({ name: 'u', layout: u });
  });

  it('pickRoundLayouts_PanesSkipTheItemLayout', () => {
    const loaded = new Map<string, Layout>([
      ['f', { ...allCards(), review: pane }],
      ['default', allCards()],
    ]);
    const named = round({ findings: [finding('F1', { layout: 'f' })] });

    const picks = pickRoundLayouts(named, 'default', loaded);

    expect(picks.cards[0].name).toBe('f');
    expect(picks.panes.review.name).toBe('default');
  });
});

describe('picksEqual', () => {
  it('picksEqual_SameNamesSameObjects_True_NewObject_False', () => {
    const named = round({
      findings: [finding('F1', { layout: 'f' })],
      questions: [question('Q1')],
    });
    const fallback = allCards();
    const loaded = new Map([
      ['f', allCards()],
      ['default', fallback],
    ]);
    const reloaded = new Map([
      ['f', allCards()],
      ['default', fallback],
    ]);

    const first = pickRoundLayouts(named, 'default', loaded);

    expect(picksEqual(first, pickRoundLayouts(named, 'default', loaded))).toBe(
      true,
    );
    expect(
      picksEqual(first, pickRoundLayouts(named, 'default', reloaded)),
    ).toBe(false);
  });
});
