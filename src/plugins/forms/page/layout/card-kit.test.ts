import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnchorOptions } from '../../../../contracts/keymap';
import type {
  DefectFinding,
  FindingChoice,
  FormsCardPart,
  ItemKind,
  KindBox,
  PageKind,
} from '../../contract';
import {
  createFormsContributions,
  type FormsContributions,
} from '../contributions';
import type { RoundState } from '../form-state';
import { findingPageKind } from '../kinds/finding/finding-card';
import { questionPageKind } from '../kinds/question/question-card';
import type { CardDeps } from '../kinds/item-format';
import { fakeKitCommandsOf } from '../../../../shared/page/layout-host/fake-kit-commands.test-support';
import { formsManifest } from '../../manifest';
import {
  apply,
  cardInputOf,
  finding,
  formsWith,
  initialState,
  notice,
  presentedRound,
  question,
} from '../test-rounds';
import {
  baseKitDepsFor,
  choiceGroupsOf,
  createCardKit,
  createFormsBaseKit,
  createKindKit,
} from './card-kit';
import { poll, pollPageKind } from '../kinds/plugin-page-kind.test-support';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../../shared/page/test-dom';
import { NO_FENCES } from '../../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../../shared/page/layout-host/fake-layout-state.test-support';

function choice(text: string, action: FindingChoice['action']): FindingChoice {
  return { text, reason: `${text} reason`, action };
}

// The card input of a caused finding, which offers every action.
function cardOf(overrides: Partial<DefectFinding>) {
  const { round } = presentedRound('r1', {
    findings: [finding('Delta', overrides)],
  });
  return cardInputOf(findingPageKind, round, 1);
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

// A round of one finding after `notices`, `overrides` over its defaults,
// open and active.
function findingRound(
  overrides: Partial<DefectFinding> = {},
  notices: string[] = [],
): RoundState {
  const presented = presentedRound('r1', {
    questions: [],
    notices: notices.map((title) => notice(title)),
    findings: [finding('Delta', overrides)],
  });
  return apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  }).forms[0];
}

// Card deps over `contributions`, whose keys lookup binds only `demo.run`
// (to `g d`), whose anchors are recorded, and whose commands register every
// forms command and `demo.run`, each run recorded.
function fakeCardDeps(contributions: FormsContributions) {
  const keysFor = vi.fn((command: string) =>
    command === 'demo.run' ? 'g d' : null,
  );
  const anchor = vi.fn(
    (_element: HTMLElement, _command: string, _options?: AnchorOptions) => ({
      dispose: () => undefined,
    }),
  );
  const run = vi.fn();
  const log = vi.fn();
  const deps: CardDeps = {
    markdown: {
      block: (text) => text,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    mountBox: vi.fn(),
    destroyBox: vi.fn(),
    keys: { keysFor, anchor },
    platform: 'macos',
    state: noLayoutState,
    log,
    commands: fakeKitCommandsOf(formsManifest, run, ['demo.run']),
    contributions,
    recordAnchor: () => {},
    recordMount: () => {},
  };
  return { deps, keysFor, anchor, run, log };
}

function findingKit(deps: CardDeps, overrides: Partial<DefectFinding> = {}) {
  const round = findingRound(overrides);
  const input = cardInputOf(findingPageKind, round.round, 1);
  return createCardKit('finding', 1, input, round, 0, deps);
}

// The kit of a round's third finding, of two fix_now choices, at rail
// position 2; its entries are 1 and 2 (A, B), then 3 and 4 (the headers).
function laterFindingKit(deps: CardDeps) {
  const presented = presentedRound('r1', {
    questions: [],
    findings: [
      finding('Alpha'),
      finding('Beta'),
      finding('Delta', {
        choices: [choice('A', 'fix_now'), choice('B', 'fix_now')],
      }),
    ],
  });
  const round = apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  }).forms[0];
  const input = cardInputOf(findingPageKind, round.round, 3);
  return createCardKit('finding', 3, input, round, 2, deps);
}

// The kit of a round's second item, a question of two choices recommending
// choice `recommend`, after one finding, at rail position 1.
function questionKit(deps: CardDeps, recommend = 1) {
  const presented = presentedRound('r1', {
    questions: [question('Alpha', { choices: ['one', 'two'], recommend })],
    findings: [finding('Delta')],
  });
  const round = apply(initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  }).forms[0];
  const input = cardInputOf(questionPageKind, round.round, 1);
  return createCardKit('question', 1, input, round, 1, deps);
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

describe('baseKitDepsFor', () => {
  it('baseKitDepsFor_RecordsSubscriptionThroughDeps', () => {
    const handle = { dispose: () => undefined };
    const recorded: unknown[] = [];
    const kit = createFormsBaseKit(
      baseKitDepsFor(
        {
          ...fakeCardDeps(createFormsContributions()).deps,
          state: {
            read: () => ({ get: () => undefined, on: () => handle }),
          },
          recordAnchor: (anchor) => recorded.push(anchor),
        },
        'forms.forms',
      ),
    );

    kit.state.read('p.v').on(() => undefined);

    expect(recorded).toEqual([handle]);
  });
});

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

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/p1.*boom/));
    expect(
      findAll(holder, 'card-part').map((wrapper) => wrapper.dataset.part),
    ).toEqual(['p2']);
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
      picks.map((pick) => pick.children.map((part) => part.textContent)),
    ).toEqual([
      ['3', labels[1], ''],
      ['4', labels[2], ''],
    ]);
  });

  it('choiceGroups_ActionReason_DrawnInItsRowOnly', () => {
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
      rows.map((row) => row.children.slice(1).map((part) => part.innerHTML)),
    ).toEqual([[], ['Out of scope']]);
  });

  it('kitKeysFor_ReadsTheCardScope', () => {
    const { deps, keysFor } = fakeCardDeps(createFormsContributions());
    const { kit } = findingKit(deps);

    const bound = kit.keysFor('demo.run');
    const unbound = kit.keysFor('docs.openDoc');

    expect(bound).toBe('g d');
    expect(unbound).toBeNull();
    expect(keysFor).toHaveBeenCalledWith(
      'demo.run',
      'forms.forms',
      undefined,
      undefined,
    );
  });

  it('kitChoose_Arg_ReachesTheKeysAndTheAnchor', () => {
    const { deps, keysFor, anchor } = fakeCardDeps(createFormsContributions());
    const { kit } = findingKit(deps);

    kit.keys('choose', 2);
    const span = kit.keyHint(asHtml(new FakeElement('div')), 'choose', {
      arg: 2,
    });

    expect(keysFor).toHaveBeenCalledWith(
      'forms.choose',
      'forms.forms',
      undefined,
      2,
    );
    expect(anchor).toHaveBeenCalledWith(span, 'forms.choose', {
      scope: 'forms.forms',
      arg: 2,
    });
  });

  it('kitCommand_ChooseNeedsAnArg_ThrowsWhileThePartBuilds', () => {
    const { deps } = fakeCardDeps(createFormsContributions());
    deps.commands = {
      exists: () => true,
      argShape: () => 'number',
      run: deps.commands.run,
    };
    const { kit } = findingKit(deps);

    expect(() => kit.command('forms.choose')).toThrow('forms.choose');
  });

  it('kitKeyHint_NamedCommand_AnchorsInTheCardScope', () => {
    const { deps, anchor } = fakeCardDeps(createFormsContributions());
    const { kit } = findingKit(deps);

    const span = kit.keyHint(asHtml(new FakeElement('div')), 'toggleDontAsk');

    expect(anchor).toHaveBeenCalledWith(span, 'forms.toggleDontAsk', {
      scope: 'forms.forms',
    });
  });

  it.each([
    { case: 'a string', options: 'hint wide', className: 'hint wide' },
    { case: 'its options', options: { className: 'hint' }, className: 'hint' },
  ])('kitKeyHint takes the className from $case', ({ options, className }) => {
    const { deps } = fakeCardDeps(createFormsContributions());
    const { kit } = findingKit(deps);

    const span = kit.keyHint(
      asHtml(new FakeElement('div')),
      'toggleDontAsk',
      options,
    );

    expect(span.className).toBe(className);
  });

  it('answerControls_AnchorsNotApplicableAndDontAsk', () => {
    const { deps, anchor } = fakeCardDeps(createFormsContributions());
    const { kit } = findingKit(deps);

    kit.answerControls(asHtml(new FakeElement('div')));

    expect(anchor).toHaveBeenCalledWith(
      expect.anything(),
      'forms.toggleNotApplicable',
      { scope: 'forms.forms' },
    );
    expect(anchor).toHaveBeenCalledWith(
      expect.anything(),
      'forms.toggleDontAsk',
      { scope: 'forms.forms' },
    );
  });

  it('choiceList_AnchorsEachChoice', () => {
    const { deps, anchor } = fakeCardDeps(createFormsContributions());
    const { kit } = questionKit(deps);

    kit.choiceList(asHtml(new FakeElement('div')), 'none');

    const chooseArgs = anchor.mock.calls
      .filter(([, command]) => command === 'forms.choose')
      .map(([, , options]) => options?.arg);
    expect(chooseArgs).toEqual([1, 2]);
  });

  // The question kit sits at rail position 1, the later finding kit at 2.
  it.each<{
    control: string;
    click: (deps: CardDeps) => void;
    ran: [string, unknown];
  }>([
    {
      control: 'a choice',
      click: (deps) =>
        clickPick(questionKit(deps).kit.choiceList(div(), 'none'), 1),
      ran: ['forms.chooseAt', { item: 1, number: 2 }],
    },
    {
      control: "a finding group's choice",
      click: (deps) =>
        clickPick(laterFindingKit(deps).kit.choiceGroups(div(), 'none'), 1),
      ran: ['forms.chooseAt', { item: 2, number: 2 }],
    },
    {
      control: "a choiceless action's header",
      click: (deps) => {
        const answer = laterFindingKit(deps).kit.choiceGroups(div(), 'none');
        findAll(asFake(answer), 'choice-group-pick')[0].click();
      },
      ran: ['forms.chooseAt', { item: 2, number: 3 }],
    },
    {
      control: 'Clear',
      click: (deps) =>
        clickButton(questionKit(deps).kit.choiceList(div(), 'none'), 'Clear'),
      ran: ['forms.clearChoiceAt', 1],
    },
    {
      control: 'Accept',
      click: (deps) =>
        clickButton(laterFindingKit(deps).kit.verdict(div()), 'Accept'),
      ran: ['forms.acceptRecommendationAt', 2],
    },
    {
      control: 'Not applicable',
      click: (deps) =>
        clickButton(
          questionKit(deps).kit.answerControls(div()),
          'Not applicable',
        ),
      ran: ['forms.toggleNotApplicableAt', 1],
    },
    {
      control: "Don't ask me this",
      click: (deps) =>
        clickButton(
          laterFindingKit(deps).kit.answerControls(div()),
          "Don't ask me this",
        ),
      ran: ['forms.toggleDontAskAt', 2],
    },
  ])(
    'cardControls_Click_RunTheirAtCommandWithPosition: $control',
    ({ click, ran }) => {
      const { deps, run } = fakeCardDeps(createFormsContributions());

      click(deps);

      expect(run.mock.calls).toEqual([ran]);
    },
  );

  it.each([
    {
      kind: 'question',
      draw: (deps: CardDeps, parent: HTMLElement) =>
        questionKit(deps, 2).kit.choiceList(parent, 'recommended'),
      reasonsByEntry: [0, 1],
      labelsPerReason: 0,
    },
    {
      kind: 'finding',
      draw: (deps: CardDeps, parent: HTMLElement) =>
        findingKit(deps).kit.choiceGroups(parent, 'all'),
      reasonsByEntry: [1, 1, 1, 0, 0],
      labelsPerReason: 1,
    },
  ])(
    'choiceReason_LabelByCardKind_$kind',
    ({ draw, reasonsByEntry, labelsPerReason }) => {
      const { deps } = fakeCardDeps(createFormsContributions());

      const answer = asFake(draw(deps, asHtml(new FakeElement('div'))));

      const reasons = findAll(answer, 'choice-reason');
      expect(
        findAll(answer, 'choice').map(
          (entry) => findAll(entry, 'choice-reason').length,
        ),
      ).toEqual(reasonsByEntry);
      expect(findAll(answer, 'choice-reason-label')).toHaveLength(
        reasons.length * labelsPerReason,
      );
    },
  );

  it.each([
    {
      kind: 'question',
      draw: (deps: CardDeps, parent: HTMLElement) =>
        questionKit(deps).kit.choiceList(parent, 'none'),
      firstChild: 'answer-head',
      headers: 0,
    },
    {
      kind: 'finding',
      draw: (deps: CardDeps, parent: HTMLElement) =>
        findingKit(deps).kit.choiceGroups(parent, 'none'),
      firstChild: 'ui-section-header',
      headers: 1,
    },
  ])('answerArea_HeaderByCardKind_$kind', ({ draw, firstChild, headers }) => {
    const { deps } = fakeCardDeps(createFormsContributions());

    const answer = asFake(draw(deps, asHtml(new FakeElement('div'))));

    expect(answer.children[0].classList.contains(firstChild)).toBe(true);
    expect(
      answer.children.filter((child) =>
        child.classList.contains('ui-section-header'),
      ),
    ).toHaveLength(headers);
  });

  it('choiceList_CardBuilds_ObtainsEachRunnerBeforeAnyClick', () => {
    const { deps } = fakeCardDeps(createFormsContributions());
    const exists = vi.fn(deps.commands.exists);
    deps.commands = { ...deps.commands, exists };
    const answer = questionKit(deps).kit.choiceList(div(), 'none');
    const checks = () =>
      exists.mock.calls.filter(([id]) => id === 'forms.chooseAt').length;
    const atBuild = checks();

    clickPick(answer, 0);

    expect(atBuild).toBe(2);
    expect(checks()).toBe(2);
  });
});

// The poll kind with one box of its own, `why`, captioned `Why this poll`,
// shown while `shown` holds it; answerable when `answerable` is.
function oneBoxPollKind(answerable: boolean, shown: readonly string[]) {
  const kind = pollPageKind('poll', { answerable });
  const why: KindBox = {
    field: 'why',
    label: 'Why this poll',
    hint: 'Say why.',
    className: 'field-why',
    keys: null,
  };
  return {
    ...kind,
    reduce: { ...kind.reduce, text: () => '' },
    boxes: { fields: [why], shown: () => shown },
  };
}

// The kit of the round's one poll item, of `kind`, at rail position 0.
function pollKit(kind: PageKind, deps: CardDeps) {
  const forms = formsWith([kind]);
  const presented = presentedRound('r1', {
    questions: [],
    items: { poll: [poll('Lunch')] },
    bodyKeys: { poll: 'poll_answers' },
  });
  const round = forms.apply(forms.initialState([], presented.sessionId), {
    type: 'formShown',
    form: presented,
  }).forms[0];
  return { kit: createKindKit('poll', 1, round, 0, deps), round };
}

describe('plugin kind kit', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { shown: ['why'], hidden: false },
    { shown: [], hidden: true },
  ])(
    'kindBox_MountsWithItsCaption_HiddenOutsideShown ($shown)',
    ({ shown, hidden }) => {
      const { deps } = fakeCardDeps(createFormsContributions());
      const { kit, round } = pollKit(oneBoxPollKind(false, shown), deps);
      const card = new FakeElement('div');

      kit.appendUnmountedBoxes(asHtml(card));
      kit.update(round);

      const [field] = findAll(card, 'field-why');
      expect(field.textContent).toContain('Why this poll');
      expect(field.textContent).toContain('Say why.');
      expect(field.hidden).toBe(hidden);
      expect(deps.mountBox).toHaveBeenCalledWith(
        expect.anything(),
        { field: 'why', item: { kind: 'poll', index: 1 } },
        '',
      );
    },
  );

  it('answerControls_KindWithoutNotesOrReason_MountsOnlyTheToggles', () => {
    const { deps } = fakeCardDeps(createFormsContributions());
    const { kit } = pollKit(oneBoxPollKind(true, ['why']), deps);
    const parent = new FakeElement('div');

    kit.kit.answerControls?.(asHtml(parent));

    expect(findAll(parent, 'toggles')).toHaveLength(1);
    expect(findAll(parent, 'field')).toHaveLength(0);
    expect(deps.mountBox).not.toHaveBeenCalled();
  });
});

function div(): HTMLElement {
  return asHtml(new FakeElement('div'));
}

// Clicks the `index`th choice row under `answer`, a choiceless header's
// excluded.
function clickPick(answer: HTMLElement, index: number) {
  const picks = findAll(asFake(answer), 'choice-pick').filter(
    (pick) => !pick.classList.contains('choice-group-pick'),
  );
  picks[index].click();
}

// Clicks the button under `parent` whose text starts with `label`.
function clickButton(parent: HTMLElement, label: string) {
  const control = findAll(asFake(parent), 'ui-button').find((each) =>
    each.textContent.startsWith(label),
  );
  if (control === undefined) {
    throw new Error(`no ${label} button`);
  }
  control.click();
}
