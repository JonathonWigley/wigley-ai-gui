import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DefectFinding,
  FindingChoice,
  FormsCardPart,
  ItemKind,
} from '../../contract';
import {
  createFormsContributions,
  type FormsContributions,
} from '../contributions';
import { apply, initialState, type RoundState } from '../form-state';
import { findingFormat } from '../kinds/finding/finding-card';
import type { CardDeps } from '../kinds/item-format';
import { finding, presentedRound } from '../test-rounds';
import type { LayoutAction } from '../../layouts/layout';
import { choiceGroupsOf, createCardKit } from './card-kit';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';

function choice(text: string, action: FindingChoice['action']): FindingChoice {
  return { text, reason: `${text} reason`, action };
}

// The card input of a caused finding, which offers every action.
function cardOf(overrides: Partial<DefectFinding>) {
  const { round } = presentedRound('r1', {
    findings: [finding('Delta', overrides)],
  });
  return findingFormat.cardInput(round, 1);
}

describe('choiceGroupsOf', () => {
  it('choiceGroupsOf_ActionWithoutChoices_HeaderTakesNumber', () => {
    const input = cardOf({
      choices: [choice('A', 'fix_now'), choice('B', 'fix_now')],
    });

    const groups = choiceGroupsOf(input);

    expect(
      groups.map(({ action, number, choices }) => ({
        action,
        number,
        numbers: choices.map((each) => each.number),
      })),
    ).toEqual([
      { action: 'fix_now', number: null, numbers: [1, 2] },
      { action: 'follow_up', number: 3, numbers: [] },
      { action: 'leave_it', number: 4, numbers: [] },
    ]);
  });

  it('choiceGroupsOf_ChoicesOutOfWireOrder_NumberDownTheCard', () => {
    const input = cardOf({
      choices: [choice('A', 'follow_up'), choice('B', 'fix_now')],
    });

    const groups = choiceGroupsOf(input);

    const fixNow = groups.find((group) => group.action === 'fix_now');
    const followUp = groups.find((group) => group.action === 'follow_up');
    expect(fixNow?.choices).toMatchObject([
      { text: 'B', number: 1, choice: 2 },
    ]);
    expect(followUp?.choices).toMatchObject([
      { text: 'A', number: 2, choice: 1 },
    ]);
  });

  it('choiceGroupsOf_ActionReasons_OnTheirGroup', () => {
    const withReason = choiceGroupsOf(
      cardOf({ actionReasons: { leave_it: 'Out of scope' } }),
    );
    const withBlank = choiceGroupsOf(
      cardOf({ actionReasons: { follow_up: '  ' } }),
    );

    expect(withReason.map(({ action, reason }) => [action, reason])).toEqual([
      ['fix_now', null],
      ['follow_up', null],
      ['leave_it', 'Out of scope'],
    ]);
    expect(
      withBlank.find((group) => group.action === 'follow_up')?.reason,
    ).toBeNull();
  });

  it('choiceGroupsOf_RecommendNull_TagsTheHeader', () => {
    const input = cardOf({
      choices: [choice('A', 'fix_now'), choice('B', 'fix_now')],
      recommend: null,
      recommend_action: 'leave_it',
    });

    const groups = choiceGroupsOf(input);

    expect(
      groups.filter((group) => group.isRecommended).map((g) => g.action),
    ).toEqual(['leave_it']);
    expect(
      groups.flatMap((group) => group.choices).some((c) => c.isRecommended),
    ).toBe(false);
  });

  it('choiceGroupsOf_Recommend_TagsOnlyThatChoice', () => {
    const input = cardOf({
      choices: [choice('A', 'fix_now'), choice('B', 'fix_now')],
      recommend: 2,
      recommend_action: 'fix_now',
    });

    const fixNow = choiceGroupsOf(input)[0];

    expect(
      fixNow.choices.map(({ choice: n, isRecommended }) => [n, isRecommended]),
    ).toEqual([
      [1, false],
      [2, true],
    ]);
  });
});

// A round of one finding, `overrides` over its defaults, open and active.
function findingRound(overrides: Partial<DefectFinding> = {}): RoundState {
  const presented = presentedRound('r1', {
    questions: [],
    findings: [finding('Delta', overrides)],
  });
  return apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  }).forms[0];
}

// Card deps over `contributions`, whose keys lookup binds only `demo.run`
// (to `g d`) and whose commands register only `demo.run`.
function fakeCardDeps(contributions: FormsContributions) {
  const keysFor = vi.fn((command: string) =>
    command === 'demo.run' ? 'g d' : null,
  );
  const run = vi.fn();
  const log = vi.fn();
  const deps: CardDeps = {
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
    },
    mountBox: vi.fn(),
    destroyBox: vi.fn(),
    dispatch: vi.fn(),
    toggleDontAsk: vi.fn(),
    keys: { keysFor },
    platform: 'macos',
    log,
    commands: { exists: (id) => id === 'demo.run', run },
    contributions,
  };
  return { deps, keysFor, run, log };
}

function findingKit(deps: CardDeps, overrides: Partial<DefectFinding> = {}) {
  const round = findingRound(overrides);
  const input = findingFormat.cardInput(round.round, 1);
  return createCardKit('finding', 1, input, round, 0, deps);
}

// A part that records what each build received.
function recordingPart(id: string, kinds: ItemKind[], built: unknown[]) {
  const part: FormsCardPart = {
    id,
    kinds,
    build(_parent, item) {
      built.push({ id, item });
      return {};
    },
  };
  return part;
}

describe('card kit', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('contributedParts_DrawsOnePartPerPartOfTheKind', () => {
    const contributions = createFormsContributions();
    const built: unknown[] = [];
    contributions.addCardPart(recordingPart('p1', ['finding'], built));
    contributions.addCardPart(recordingPart('q1', ['question'], built));
    contributions.addCardPart(recordingPart('p2', ['finding'], built));
    const { kit } = findingKit(fakeCardDeps(contributions).deps);
    const card = new FakeElement('div');

    const holder = asFake(kit.contributedParts(asHtml(card)));

    expect(holder.className).toBe('card-parts');
    const drawn = findAll(holder, 'card-part');
    expect(drawn.map((wrapper) => wrapper.dataset.part)).toEqual(['p1', 'p2']);
    expect(built).toEqual([
      { id: 'p1', item: { roundId: 'r1', kind: 'finding', index: 1 } },
      { id: 'p2', item: { roundId: 'r1', kind: 'finding', index: 1 } },
    ]);
  });

  it('contributedParts_DisposedPart_NotDrawn', () => {
    const contributions = createFormsContributions();
    const added = contributions.addCardPart(
      recordingPart('p1', ['finding'], []),
    );
    added.dispose();
    const { kit } = findingKit(fakeCardDeps(contributions).deps);

    const holder = asFake(kit.contributedParts(asHtml(new FakeElement('div'))));

    expect(findAll(holder, 'card-part')).toEqual([]);
  });

  it('contributedParts_PartThrows_LogsAndDrawsTheRest', () => {
    const contributions = createFormsContributions();
    contributions.addCardPart({
      id: 'p1',
      kinds: ['finding'],
      build: () => {
        throw new Error('boom');
      },
    });
    contributions.addCardPart(recordingPart('p2', ['finding'], []));
    const { deps, log } = fakeCardDeps(contributions);
    const { kit } = findingKit(deps);

    const holder = asFake(kit.contributedParts(asHtml(new FakeElement('div'))));

    expect(log).toHaveBeenCalledWith('forms', 'card part p1 failed: boom');
    expect(
      findAll(holder, 'card-part').map((wrapper) => wrapper.dataset.part),
    ).toEqual(['p2']);
  });

  it('kitCommand_KnownId_RunsOnlyWhenCalled', () => {
    const { deps, run } = fakeCardDeps(createFormsContributions());
    const { kit } = findingKit(deps);

    const runner = kit.command('demo.run');
    expect(run).not.toHaveBeenCalled();
    runner();

    expect(run.mock.calls).toEqual([['demo.run']]);
  });

  it('kitCommand_UnknownId_Throws', () => {
    const { kit } = findingKit(fakeCardDeps(createFormsContributions()).deps);

    expect(() => kit.command('docs.noSuch')).toThrow('no command docs.noSuch');
  });

  it('choiceGroups_ActionWithoutChoices_DrawsItsNumberAsAChoiceRowDoes', () => {
    const overrides = {
      choices: [choice('A', 'fix_now'), choice('B', 'fix_now')],
    };
    const { deps } = fakeCardDeps(createFormsContributions());
    const { kit } = findingKit(deps, overrides);
    const labels = choiceGroupsOf(cardOf(overrides)).map((g) => g.label);

    const answer = asFake(
      kit.choiceGroups(asHtml(new FakeElement('div')), 'none'),
    );

    const picks = findAll(answer, 'choice-group-pick');
    expect(
      picks.map((pick) =>
        pick.children.map((part) => [part.className, part.textContent]),
      ),
    ).toEqual([
      [
        ['choice-number', '3'],
        ['choice-text', labels[1]],
      ],
      [
        ['choice-number', '4'],
        ['choice-text', labels[2]],
      ],
    ]);
  });

  it('choiceGroups_ActionWithoutChoices_SitsInAChoiceRowWithItsReason', () => {
    const overrides = {
      choices: [choice('A', 'fix_now'), choice('B', 'fix_now')],
      actionReasons: { leave_it: 'Out of scope' },
    };
    const { deps } = fakeCardDeps(createFormsContributions());
    const { kit } = findingKit(deps, overrides);

    const answer = asFake(
      kit.choiceGroups(asHtml(new FakeElement('div')), 'none'),
    );

    const rows = findAll(answer, 'choice-group-head');
    expect(
      rows.map((row) => [
        row.classList.contains('choice'),
        row.children.map((part) => part.className),
      ]),
    ).toEqual([
      [true, ['choice-pick choice-group-pick']],
      [true, ['choice-pick choice-group-pick', 'choice-group-reason md']],
    ]);
  });

  it('kitRun_UnknownActionType_LogsAndDispatchesNothing', () => {
    const { deps, log } = fakeCardDeps(createFormsContributions());
    const { kit } = findingKit(deps);

    kit.run({ type: 'chooseAction' } as unknown as LayoutAction);

    expect(log).toHaveBeenCalledWith(
      'forms',
      'layout action chooseAction is not known',
    );
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.toggleDontAsk).not.toHaveBeenCalled();
  });

  it('kitKeysFor_ReadsTheCardScope', () => {
    const { deps, keysFor } = fakeCardDeps(createFormsContributions());
    const { kit } = findingKit(deps);

    const bound = kit.keysFor('demo.run');
    const unbound = kit.keysFor('docs.openDoc');

    expect(bound).toBe('g d');
    expect(unbound).toBeNull();
    expect(keysFor).toHaveBeenCalledWith('demo.run', 'forms.forms');
  });
});
