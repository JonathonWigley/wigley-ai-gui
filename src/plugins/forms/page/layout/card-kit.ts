import type { CommandId } from '../../../../contracts/commands';
import type { ViewScope } from '../../../../contracts/keymap';
import { button, element } from '../../../../shared/page/dom';
import { textButton } from '../../../../shared/page/ui/button';
import { errorText } from '../../../../shared/error-text';
import {
  type BaseKitDeps,
  createBaseKit,
} from '../../../../shared/page/layout-host/base-kit';
import {
  createMarkdownMount,
  type MarkdownMount,
} from '../../../../shared/page/markdown-mount';
import { sectionHeader } from '../../../../shared/page/ui/section-header';
import { tag as tagPart } from '../../../../shared/page/ui/tag';
import type { ItemKind } from '../../contract';
import {
  type FormsCommandName,
  formsCommand,
  formsCommandNamed,
  formsScope,
} from '../../ids';
import type {
  AnswerKit,
  FindingAction,
  FindingCard,
  FindingKit,
  FormsBaseKit,
  Kit,
  LayoutAction,
  QuestionKit,
} from '../../layouts/layout';
import {
  type AnswerableItem,
  answerStatus,
  type FormsAction,
  itemAnswer,
  pickNumber,
  type RailItem,
  type RoundState,
  type TextTarget,
} from '../form-state';
import {
  appendBoxKeys,
  appendPickKeys,
  buildChoiceList,
  buildChoiceReason,
  buildField,
  buildItemHead,
  statusLabel,
} from '../kinds/card-parts';
import type { CardDeps, CardInputs, CardKits } from '../kinds/item-format';
import type { KeysPageExports } from '../../../keys/contract';

type TextBoxField = Parameters<Kit['textBox']>[1];
type ReasonsMode = Parameters<FindingKit['choiceGroups']>[1];

// One of the item's text boxes, with the text it opens on.
interface ItemTextBox {
  target: TextTarget;
  text: string;
}

// What every part of one card's kit shares: the item and its round, its
// deps, the base kit's deps and the anchor over the forms view's keys, the
// markdown mount its own parts draw through, its boxes, the updaters the
// parts that show answer state register, and the contributed parts once
// placed, null before.
interface CardContext {
  roundId: string;
  item: RailItem;
  position: number;
  deps: CardDeps;
  kitDeps: BaseKitDeps;
  anchor: ScopedAnchor;
  mount: MarkdownMount;
  boxes: Map<TextBoxField, ItemTextBox>;
  mounted: Set<TextBoxField>;
  updaters: ((round: RoundState) => void)[];
  placedParts: PlacedPart[] | null;
}

// A contributed part drawn on the card, with the update it returned; only a
// part's first update failure is logged.
interface PlacedPart {
  id: string;
  update: (() => void) | undefined;
  isUpdateFailureLogged: boolean;
}

// One run of a finding card's entries under one action, as `choiceGroups`
// draws it: the action's card word, its `actionReasons` text (null when
// absent or blank), and the header's entry number when the action has no
// choices (null when it has). `isRecommended` marks the recommended action's
// group, and on a choice the recommended choice under it.
export interface ChoiceGroup {
  action: FindingAction;
  label: string;
  reason: string | null;
  number: number | null;
  isRecommended: boolean;
  choices: {
    number: number;
    choice: number;
    text: string;
    reason: string;
    isRecommended: boolean;
  }[];
}

// A drawn pick a finding card's updater marks when its entry `number` is the
// item's pick: a choice's row or a bare header's button.
interface DrawnPick {
  number: number;
  element: HTMLElement;
}

// A card's kit, and what the card host does with it.
export interface CardKit<K extends ItemKind> {
  kit: CardKits[K];
  // Runs every part's updater with the round's current state.
  update(round: RoundState): void;
  // Runs the update each contributed part returned.
  updateContributedParts(): void;
  // Mounts each of the item's boxes no part mounted, in its default field at
  // the end of `card`.
  appendUnmountedBoxes(card: HTMLElement): void;
  // Places the contributed parts at the end of `card` when the card never
  // called `contributedParts`; nothing when no part names the card's kind.
  appendUnplacedParts(card: HTMLElement): void;
}

// Each box field's caption; `command` is the one its label shows the keys of,
// null for none.
const FIELD_CAPTIONS: Record<
  TextBoxField,
  {
    className: string;
    label: string;
    hint: string;
    command: FormsCommandName | null;
  }
> = {
  notes: {
    className: 'field-notes',
    label: 'Notes',
    hint: 'Optional. Your own answer or your reasoning, sent to the agent.',
    command: 'editNotes',
  },
  dontAskReason: {
    className: 'field-reason',
    label: 'Why not ask this',
    hint: 'Optional. Sent to the agent with your answer.',
    command: null,
  },
  comment: {
    className: 'field-comment',
    label: 'Comment',
    hint: 'Optional. Say if this needs a second look.',
    command: 'editNotes',
  },
};

const KIT_BUILDERS: {
  [K in ItemKind]: (card: CardContext, input: CardInputs[K]) => CardKits[K];
} = {
  notice: (card) => buildBaseKit(card),
  question: (card, input) => {
    const item: AnswerableItem = { kind: 'question', index: card.item.index };
    const answerKit = buildAnswerKit(card, item, buildBaseKit(card));
    return buildQuestionKit(card, item, answerKit, input);
  },
  finding: (card, input) => {
    const item: AnswerableItem = { kind: 'finding', index: card.item.index };
    const answerKit = buildAnswerKit(card, item, buildBaseKit(card));
    return buildFindingKit(card, item, answerKit, input);
  },
};

// The finding card's entries as `choiceGroups` draws them: one group per run
// of entries under one action, in `entries` order, each choice and each bare
// header keeping its entry number.
export function choiceGroupsOf(input: FindingCard): ChoiceGroup[] {
  const groups: ChoiceGroup[] = [];
  for (const entry of input.entries) {
    let group = groups.at(-1);
    if (group === undefined || group.action !== entry.action) {
      group = {
        action: entry.action,
        label: actionLabelOf(input, entry.action),
        reason: actionReasonOf(input, entry.action),
        number: null,
        isRecommended: entry.action === input.recommendAction,
        choices: [],
      };
      groups.push(group);
    }
    if (entry.choice === 0) {
      group.number = entry.number;
    } else {
      const choice = input.choices[entry.choice - 1];
      group.choices.push({
        number: entry.number,
        choice: entry.choice,
        text: choice.text,
        reason: choice.reason,
        isRecommended: group.isRecommended && entry.choice === input.recommend,
      });
    }
  }
  return groups;
}

// The card's word for `action`; entries name only actions the card offers.
function actionLabelOf(input: FindingCard, action: FindingAction): string {
  const offered = input.actions.find((each) => each.action === action);
  if (offered === undefined) {
    throw new Error(`finding card offers no ${action} action`);
  }
  return offered.label;
}

// The round's reason for deferral `action`; null for none or blank text, and
// for fix_now, which takes none.
function actionReasonOf(
  input: FindingCard,
  action: FindingAction,
): string | null {
  const text = action === 'fix_now' ? undefined : input.actionReasons[action];
  return text === undefined || text.trim() === '' ? null : text;
}

// The FormsActions a layout action dispatches: focusing the card's item at
// rail `position`, then the action itself. Don't ask has none of its own: the
// kit runs its command, which also focuses the reason box. Null for an action
// type the contract does not name, as an older layout may still send.
function layoutActions(
  action: LayoutAction,
  position: number,
): FormsAction[] | null {
  const focus: FormsAction = { type: 'focusItem', item: position };
  switch (action.type) {
    case 'choose':
      return [focus, { type: 'choose', number: action.number }];
    case 'toggleNotApplicable':
      return [focus, { type: 'toggleNotApplicable' }];
    case 'accept':
      return [focus, { type: 'acceptRecommendation' }];
    case 'toggleDontAsk':
    case 'focus':
      return [focus];
    default:
      return null;
  }
}

// The item as an answerable one; null for a notice, which takes no answer.
export function answerableOf(item: RailItem): AnswerableItem | null {
  return item.kind === 'notice' ? null : { kind: item.kind, index: item.index };
}

// The base kit's deps for a card or pane whose keys fire in `scope`, its short
// command names being forms commands, its markdown mount recorded through
// `deps.recordMount`.
export function baseKitDepsFor(
  deps: Pick<
    CardDeps,
    'markdown' | 'platform' | 'commands' | 'keys' | 'recordMount' | 'log'
  >,
  scope: ViewScope,
): BaseKitDeps {
  return {
    markdown: deps.markdown,
    keys: deps.keys,
    commands: deps.commands,
    scope,
    commandNamed: formsCommandNamed,
    platform: deps.platform,
    recordMount: (mount) => deps.recordMount(mount),
    log: deps.log,
  };
}

// The base kit over `deps`, its `keyHint` also taking a string as the hint's
// className.
export function createFormsBaseKit(deps: BaseKitDeps): FormsBaseKit {
  const base = createBaseKit(deps);
  return {
    ...base,
    keyHint: (parent, command, options = {}) =>
      base.keyHint(
        parent,
        command,
        typeof options === 'string' ? { className: options } : options,
      ),
  };
}

// Names the anchor for a qualified command on `element`, drawing the
// command's label after the keys as `label` says.
export type ScopedAnchor = (
  element: HTMLElement,
  command: CommandId,
  label?: boolean | string,
) => void;

// The anchor `keys` names in `scope`, the scope of the part drawing.
export function scopedAnchor(
  keys: Pick<KeysPageExports, 'anchor'>,
  scope: ViewScope,
): ScopedAnchor {
  return (element, command, label) => {
    keys.anchor(element, command, { scope, label });
  };
}

// The kit for the card of `kind` item `index` at rail `position`, built
// from its card input.
export function createCardKit<K extends ItemKind>(
  kind: K,
  index: number,
  input: CardInputs[K],
  round: RoundState,
  position: number,
  deps: CardDeps,
): CardKit<K> {
  const item = { kind, index };
  const mount = createMarkdownMount(deps.markdown, deps.log);
  deps.recordMount(mount);
  const card: CardContext = {
    roundId: round.formId,
    item,
    position,
    deps,
    kitDeps: baseKitDepsFor(deps, formsScope('forms')),
    anchor: scopedAnchor(deps.keys, formsScope('forms')),
    mount,
    boxes: itemTextBoxes(round, item),
    mounted: new Set(),
    updaters: [],
    placedParts: null,
  };
  const kit = KIT_BUILDERS[kind](card, input);
  return {
    kit,
    update(current) {
      for (const updater of card.updaters) {
        updater(current);
      }
    },
    updateContributedParts() {
      for (const part of card.placedParts ?? []) {
        updateContributedPart(part, deps);
      }
    },
    appendUnmountedBoxes(element) {
      for (const field of card.boxes.keys()) {
        if (!card.mounted.has(field)) {
          mountTextBox(card, element, field);
        }
      }
    },
    appendUnplacedParts(element) {
      const isUnplaced = card.placedParts === null;
      if (isUnplaced && deps.contributions.cardParts(kind).length > 0) {
        placeContributedParts(card, element);
      }
    },
  };
}

// `div.card-parts` at the end of `parent`, holding one `div.card-part`
// (`data-part="<id>"`) per contributed part of the card's kind, in add order,
// each built into its wrapper. A part that throws is logged and its wrapper
// removed; the rest still draw. Throws when the card places them twice.
function placeContributedParts(
  card: CardContext,
  parent: HTMLElement,
): HTMLElement {
  if (card.placedParts !== null) {
    throw new Error(`${card.item.kind} card placed contributed parts twice`);
  }
  const placed: PlacedPart[] = [];
  card.placedParts = placed;
  const holder = element('div', 'card-parts');
  parent.append(holder);
  const { kind, index } = card.item;
  for (const part of card.deps.contributions.cardParts(kind)) {
    const wrapper = element('div', 'card-part');
    wrapper.dataset.part = part.id;
    holder.append(wrapper);
    try {
      const built = part.build(wrapper, { roundId: card.roundId, kind, index });
      placed.push({
        id: part.id,
        update: built.update?.bind(built),
        isUpdateFailureLogged: false,
      });
    } catch (error) {
      wrapper.remove();
      card.deps.log(`card part ${part.id} failed: ${errorText(error)}`);
    }
  }
  return holder;
}

// Runs the part's update; only its first throw is logged.
function updateContributedPart(part: PlacedPart, deps: CardDeps) {
  try {
    part.update?.();
  } catch (error) {
    if (!part.isUpdateFailureLogged) {
      part.isUpdateFailureLogged = true;
      deps.log(`card part ${part.id} update failed: ${errorText(error)}`);
    }
  }
}

// The item's text boxes in their default order, each with its current text.
function itemTextBoxes(
  round: RoundState,
  item: RailItem,
): Map<TextBoxField, ItemTextBox> {
  const answerable = answerableOf(item);
  if (answerable === null) {
    return new Map([
      [
        'comment',
        {
          target: { field: 'comment', notice: item.index },
          text: round.noticeComments[item.index - 1],
        },
      ],
    ]);
  }
  const answer = itemAnswer(round, answerable);
  return new Map([
    [
      'notes',
      { target: { field: 'notes', item: answerable }, text: answer.notes },
    ],
    [
      'dontAskReason',
      {
        target: { field: 'dontAskReason', item: answerable },
        text: answer.dontAskReason,
      },
    ],
  ]);
}

// Mounts the item's box for `field` in its default field; the reason field
// hides while Don't ask is off.
function mountTextBox(
  card: CardContext,
  parent: HTMLElement,
  field: TextBoxField,
): HTMLElement {
  const box = card.boxes.get(field);
  if (box === undefined) {
    throw new Error(`${card.item.kind} card has no ${field} box`);
  }
  if (card.mounted.has(field)) {
    throw new Error(`${card.item.kind} card mounted ${field} twice`);
  }
  const caption = FIELD_CAPTIONS[field];
  const { anchor } = card;
  const built = buildField(
    parent,
    caption.className,
    caption.label,
    caption.hint,
    caption.command === null
      ? null
      : { command: formsCommand(caption.command), anchor },
  );
  card.deps.mountBox(built.box, box.target, box.text);
  appendBoxKeys(built, anchor);
  card.mounted.add(field);
  const { target } = box;
  if (target.field === 'dontAskReason') {
    card.updaters.push((current) => {
      built.element.hidden = !itemAnswer(current, target.item).dontAsk;
    });
  }
  return built.element;
}

// Appends the anchor for `command` at the end of `control`.
function appendCardKeys(
  card: CardContext,
  control: HTMLElement,
  command: CommandId,
) {
  const keys = element('span');
  control.append(keys);
  card.anchor(keys, command);
}

// Dispatches the action's FormsActions, then Don't ask's command for it; an
// action type the contract does not name is logged and runs nothing.
function runLayoutAction(card: CardContext, action: LayoutAction) {
  const formsActions = layoutActions(action, card.position);
  if (formsActions === null) {
    card.deps.log(`layout action ${action.type} is not known`);
    return;
  }
  for (const formsAction of formsActions) {
    card.deps.dispatch(formsAction);
  }
  if (action.type === 'toggleDontAsk') {
    card.deps.toggleDontAsk();
  }
}

function buildBaseKit(card: CardContext): Kit {
  return {
    ...createFormsBaseKit(card.kitDeps),
    itemHead(parent, kind) {
      const { header, status } = buildItemHead(parent, kind);
      const answerable = answerableOf(card.item);
      if (answerable !== null) {
        card.updaters.push((current) => {
          const itemStatus = answerStatus(current, answerable);
          status.textContent =
            itemStatus === 'untouched' ? '' : statusLabel(itemStatus);
        });
      }
      return header;
    },
    textBox: (parent, field) => mountTextBox(card, parent, field),
    run: (action) => runLayoutAction(card, action),
    contributedParts: (parent) => placeContributedParts(card, parent),
  };
}

// `answerControls` for answerable `item` over `kit`.
function buildAnswerKit(
  card: CardContext,
  item: AnswerableItem,
  kit: Kit,
): AnswerKit {
  return {
    ...kit,
    answerControls(parent) {
      kit.textBox(parent, 'notes');
      const toggles = element('div', 'toggles');
      const notApplicable = textButton(
        'Not applicable',
        () => kit.run({ type: 'toggleNotApplicable' }),
        { variant: 'ghost' },
      );
      const dontAsk = textButton(
        "Don't ask me this",
        () => kit.run({ type: 'toggleDontAsk' }),
        { variant: 'ghost' },
      );
      appendCardKeys(card, notApplicable, formsCommand('toggleNotApplicable'));
      appendCardKeys(card, dontAsk, formsCommand('toggleDontAsk'));
      toggles.append(notApplicable, dontAsk);
      parent.append(toggles);
      kit.textBox(parent, 'dontAskReason');
      card.updaters.push((current) => {
        const answer = itemAnswer(current, item);
        showPressed(notApplicable, answer.notApplicable);
        showPressed(dontAsk, answer.dontAsk);
      });
      return toggles;
    },
  };
}

// `choiceList` for question `item`, whose card `input` describes.
function buildQuestionKit(
  card: CardContext,
  item: AnswerableItem,
  kit: AnswerKit,
  input: CardInputs['question'],
): QuestionKit {
  return {
    ...kit,
    choiceList(parent, reasons) {
      const answerArea = appendAnswerArea(parent, card);
      const list = element('ol', 'choices');
      answerArea.append(list);
      const choices = input.choices.map((text, i) => ({ text, number: i + 1 }));
      const { entries } = buildChoiceList(
        list,
        choices,
        input.recommend,
        (number) => kit.run({ type: 'choose', number }),
        {
          markdown: card.deps.markdown,
          mount: card.mount,
          anchor: card.anchor,
        },
      );
      const recommended = entries[input.recommend - 1];
      if (reasons !== 'none' && recommended !== undefined) {
        appendChoiceReason(
          recommended,
          'Why recommended',
          input.rationale,
          card,
        );
      }
      card.updaters.push((current) => {
        const picked = pickNumber(current, item);
        entries.forEach((entry, i) =>
          entry.classList.toggle('is-selected', picked === choices[i].number),
        );
        list.classList.toggle(
          'is-locked',
          itemAnswer(current, item).notApplicable,
        );
      });
      return answerArea;
    },
  };
}

// `verdict` and `choiceGroups` for finding `item`, whose card `input`
// describes.
function buildFindingKit(
  card: CardContext,
  item: AnswerableItem,
  kit: AnswerKit,
  input: CardInputs['finding'],
): FindingKit {
  return {
    ...kit,
    verdict: (parent) => buildVerdict(parent, input, kit, card),
    choiceGroups: (parent, reasons) =>
      buildChoiceGroups(parent, reasons, input, item, kit, card),
  };
}

// Appends `div.answer` to `parent`, under its 'Your answer' header, which
// ends with the Clear button: a click focuses the card's item, then clears its
// choice.
function appendAnswerArea(parent: HTMLElement, card: CardContext): HTMLElement {
  const clear = textButton(
    'Clear',
    () => {
      runLayoutAction(card, { type: 'focus' });
      card.deps.dispatch({ type: 'clearChoice' });
    },
    { variant: 'ghost' },
  );
  appendCardKeys(card, clear, formsCommand('clearChoice'));
  const answerArea = element('div', 'answer');
  answerArea.append(sectionHeader('Your answer', clear));
  parent.append(answerArea);
  return answerArea;
}

// Appends the labelled reason to a choice's row; blank text draws nothing.
function appendChoiceReason(
  entry: HTMLElement,
  label: string,
  text: string,
  card: CardContext,
) {
  if (text.trim() !== '') {
    entry.append(
      buildChoiceReason(label, text, {
        markdown: card.deps.markdown,
        mount: card.mount,
      }),
    );
  }
}

// The finding's answer area: one `section.choice-group` per group of
// choiceGroupsOf, each choice and bare header picking its entry number. Its
// updater marks the picked entry and locks every group while the finding is
// not applicable.
function buildChoiceGroups(
  parent: HTMLElement,
  reasons: ReasonsMode,
  input: CardInputs['finding'],
  item: AnswerableItem,
  kit: Kit,
  card: CardContext,
): HTMLElement {
  const answerArea = appendAnswerArea(parent, card);
  const sections: HTMLElement[] = [];
  const picks: DrawnPick[] = [];
  for (const group of choiceGroupsOf(input)) {
    const section = element('section', 'choice-group');
    section.dataset.action = group.action;
    answerArea.append(section);
    sections.push(section);
    if (group.number === null) {
      picks.push(...appendGroupChoices(section, group, reasons, kit, card));
    } else {
      picks.push(appendGroupPick(section, group, group.number, kit, card));
    }
  }
  card.updaters.push((current) => {
    const picked = pickNumber(current, item);
    for (const pick of picks) {
      pick.element.classList.toggle('is-selected', pick.number === picked);
    }
    const isLocked = itemAnswer(current, item).notApplicable;
    for (const section of sections) {
      section.classList.toggle('is-locked', isLocked);
    }
  });
  return answerArea;
}

// A group with choices: the action's word as a section header, its reason,
// then its choices under their entry numbers, each with its reason as
// `reasons` shows it.
function appendGroupChoices(
  section: HTMLElement,
  group: ChoiceGroup,
  reasons: ReasonsMode,
  kit: Kit,
  card: CardContext,
): DrawnPick[] {
  section.append(sectionHeader(group.label));
  appendGroupReason(section, group.reason, card);
  const list = element('ol', 'choices');
  section.append(list);
  const recommended = group.choices.find((choice) => choice.isRecommended);
  const { entries } = buildChoiceList(
    list,
    group.choices,
    recommended?.number ?? null,
    (number) => kit.run({ type: 'choose', number }),
    { markdown: card.deps.markdown, mount: card.mount, anchor: card.anchor },
  );
  return group.choices.map((choice, i) => {
    const isReasonShown =
      reasons === 'all' || (reasons === 'recommended' && choice.isRecommended);
    if (isReasonShown) {
      appendChoiceReason(entries[i], 'Why', choice.reason, card);
    }
    return { number: choice.number, element: entries[i] };
  });
}

// A group with no choices: one `div.choice` row as buildChoiceList draws a
// choice, its entry number in the choice number badge and the action's word
// as its text, tagged when recommended, with the anchor of its number; then the
// group's reason inside the row.
function appendGroupPick(
  section: HTMLElement,
  group: ChoiceGroup,
  number: number,
  kit: Kit,
  card: CardContext,
): DrawnPick {
  const head = element('div', 'choice choice-group-head');
  const pick = button('choice-pick choice-group-pick', '', () =>
    kit.run({ type: 'choose', number }),
  );
  pick.append(
    element('span', 'choice-number', String(number)),
    element('span', 'choice-text', group.label),
  );
  if (group.isRecommended) {
    head.classList.add('is-recommended');
    pick.append(tagPart('Recommended', 'accent'));
  }
  appendPickKeys(pick, number, card.anchor);
  head.append(pick);
  section.append(head);
  appendGroupReason(head, group.reason, card);
  return { number, element: head };
}

// The action's reason as block markdown appended to `parent`, under its
// header; nothing for null.
function appendGroupReason(
  parent: HTMLElement,
  reason: string | null,
  card: CardContext,
) {
  if (reason !== null) {
    const node = element('div', 'choice-group-reason md');
    parent.append(node);
    card.mount.draw(node, card.deps.markdown.block(reason));
  }
}

// Shows a toggle or pick as on or off.
function showPressed(control: HTMLElement, isPressed: boolean) {
  control.classList.toggle('is-selected', isPressed);
  control.setAttribute('aria-pressed', String(isPressed));
}

// The verdict under the finding and proof: its origin and severity tags, the
// impact, and the Accept button, which focuses the finding and picks the
// recommended entry, the one the choice groups tag.
function buildVerdict(
  parent: HTMLElement,
  input: CardInputs['finding'],
  kit: Kit,
  card: CardContext,
): HTMLElement {
  const { deps } = card;
  const block = element('section', 'verdict');
  const chips = element('div', 'verdict-chips');
  const origin = tagPart(input.originChip);
  origin.classList.add('badge-origin');
  origin.dataset.origin = input.origin;
  chips.append(origin);
  if (input.severityChip !== null && input.severity !== null) {
    const severity = tagPart(input.severityChip);
    severity.classList.add('badge-severity');
    severity.dataset.severity = input.severity;
    chips.append(severity);
  }
  const accept = textButton('Accept', () => kit.run({ type: 'accept' }), {
    variant: 'primary',
  });
  appendCardKeys(card, accept, formsCommand('acceptRecommendation'));
  const buttons = element('div', 'verdict-buttons');
  buttons.append(accept);
  const impact = element('div', 'verdict-impact md');
  block.append(chips, impact, buttons);
  parent.append(block);
  card.mount.draw(impact, deps.markdown.block(input.impact));
  return block;
}
