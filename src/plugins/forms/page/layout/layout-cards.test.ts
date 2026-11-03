import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormsCardPart } from '../../contract';
import type { Layout } from '../../layouts/layout';
import {
  createFormsContributions,
  type FormsContributions,
} from '../contributions';
import {
  apply,
  initialState,
  type RoundState,
  type TextTarget,
} from '../form-state';
import type { CardDeps } from '../kinds/item-format';
import { finding, presentedRound } from '../test-rounds';
import { recordingAnchors } from '../../../../shared/page/layout-host/test-layouts';
import { buildLayoutCard } from './layout-cards';
import {
  asFake,
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import { NO_FENCES } from '../../../../shared/page/markdown-mount.test-support';

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
      ...NO_FENCES,
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
    recordMount: () => {},
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

describe('buildLayoutCard', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('buildLayoutCard_CardThrowsAfterMountingABox_DestroysItAndDrawsDefault', () => {
    // Boxes mounted and not yet destroyed; a second mount of one throws, as
    // the editor boxes do.
    const mounted = new Set<string>();
    const mounts: string[] = [];
    const { anchors, keys } = recordingAnchors();
    let anchorsAtThrow = 0;
    const deps: CardDeps = {
      ...fakeCardDeps(createFormsContributions()),
      mountBox(_parent, target: TextTarget) {
        const key = JSON.stringify(target);
        if (mounted.has(key)) {
          throw new Error(`${key} mounted twice`);
        }
        mounted.add(key);
        mounts.push(key);
      },
      destroyBox: (target) => mounted.delete(JSON.stringify(target)),
      keys,
    };
    const fancy: Layout = {
      cards: {
        finding(parent, _input, kit) {
          kit.textBox(kit.card(parent), 'notes');
          anchorsAtThrow = anchors.length;
          throw new Error('fancy failed');
        },
      },
    };
    const parent = new FakeElement('div');

    const card = buildLayoutCard(
      { name: 'fancy', layout: fancy },
      asHtml(parent),
      findingRound(),
      { kind: 'finding', index: 1 },
      0,
      deps,
    );

    const notesMounts = mounts.filter((key) => key.includes('"notes"'));
    expect(notesMounts).toHaveLength(2);
    expect(mounted.has(notesMounts[0])).toBe(true);
    expect(anchorsAtThrow).toBeGreaterThan(0);
    expect(
      anchors.slice(0, anchorsAtThrow).every((anchor) => anchor.isDisposed),
    ).toBe(true);
    expect(deps.log).toHaveBeenCalledWith(
      'forms',
      'layout fancy finding card failed: fancy failed',
    );
    expect(parent.children).toEqual([asFake(card.element)]);
    expect(card.element.dataset.layout).toBe('default');
  });
});
