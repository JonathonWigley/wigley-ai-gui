import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeysPageExports } from '../../../keys/contract';
import type { FormsCardPart } from '../../contract';
import type { Layout } from '../../layouts/layout';
import {
  createFormsContributions,
  type FormsContributions,
} from '../contributions';
import { apply, initialState, type RoundState } from '../form-state';
import type { CardDeps } from '../kinds/item-format';
import { finding, presentedRound } from '../test-rounds';
import { buildLayoutCard, drawRollingBack } from './layout-cards';
import {
  asFake,
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../../shared/page/test-dom';

// A round of one finding, open and active.
function findingRound(): RoundState {
  const presented = presentedRound('r1', {
    questions: [],
    findings: [finding('Delta')],
  });
  return apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  }).forms[0];
}

function fakeCardDeps(contributions: FormsContributions): CardDeps {
  return {
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
    },
    mountBox: vi.fn(),
    destroyBox: vi.fn(),
    dispatch: vi.fn(),
    toggleDontAsk: vi.fn(),
    keys: {
      keysFor: () => null,
      anchor: () => ({ dispose: () => undefined }),
    },
    platform: 'macos',
    log: vi.fn(),
    commands: { exists: () => false, run: vi.fn() },
    contributions,
  };
}

// A layout whose finding card is a bare `div.ui-card` that never places the
// contributed parts, its `update` recorded in `calls`.
function bareFindingLayout(calls: string[]): Layout {
  return {
    cards: {
      finding: (parent, _input, kit) => ({
        element: kit.card(parent, 'bare'),
        update: () => calls.push('card'),
      }),
    },
  };
}

// A finding part whose `update` is recorded in `calls`.
function updatingPart(id: string, calls: string[]): FormsCardPart {
  return {
    id,
    kinds: ['finding'],
    build: () => ({ update: () => calls.push(id) }),
  };
}

function buildFindingCard(layout: Layout, contributions: FormsContributions) {
  const round = findingRound();
  const parent = new FakeElement('div');
  const card = buildLayoutCard(
    { name: 'bare', layout },
    asHtml(parent),
    round,
    { kind: 'finding', index: 1 },
    0,
    fakeCardDeps(contributions),
  );
  return { card, round };
}

describe('hostCard', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hostCard_ContributedPartsUncalled_AppendsThemAtTheEnd', () => {
    const contributions = createFormsContributions();
    contributions.addCardPart(updatingPart('p1', []));

    const { card } = buildFindingCard(bareFindingLayout([]), contributions);

    const last = asFake(card.element).children.at(-1);
    expect(last?.className).toBe('card-parts');
    expect(last?.children.map((wrapper) => wrapper.dataset.part)).toEqual([
      'p1',
    ]);
  });

  it('hostCard_Update_RunsEachPartUpdateAfterTheCard', () => {
    const calls: string[] = [];
    const contributions = createFormsContributions();
    contributions.addCardPart(updatingPart('p1', calls));
    contributions.addCardPart(updatingPart('p2', calls));
    const { card, round } = buildFindingCard(
      bareFindingLayout(calls),
      contributions,
    );

    card.update(round);

    expect(calls).toEqual(['card', 'p1', 'p2']);
  });
});

describe('drawRollingBack', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Deps whose every anchor's dispose is the one `dispose` spy.
  function rollbackDeps(dispose: () => void) {
    const anchor: KeysPageExports['anchor'] = () => ({ dispose });
    return { mountBox: vi.fn(), destroyBox: vi.fn(), keys: { anchor } };
  }

  it('drawRollingBack_DrawThrows_DisposesTheAnchorsItNamed', () => {
    const dispose = vi.fn();
    const parent = asHtml(new FakeElement('div'));

    expect(() =>
      drawRollingBack(parent, rollbackDeps(dispose), (deps) => {
        deps.keys.anchor(parent, 'forms.nextItem');
        throw new Error('card failed');
      }),
    ).toThrow('card failed');

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('drawRollingBack_DrawReturns_KeepsTheAnchorsItNamed', () => {
    const dispose = vi.fn();
    const parent = asHtml(new FakeElement('div'));

    drawRollingBack(parent, rollbackDeps(dispose), (deps) =>
      deps.keys.anchor(parent, 'forms.nextItem'),
    );

    expect(dispose).not.toHaveBeenCalled();
  });
});
