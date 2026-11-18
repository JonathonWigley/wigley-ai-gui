import type { CommandArg, CommandId } from '../../../../contracts/commands';
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
import type { ItemKind, KindBox, PageKind } from '../../contract';
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
  KindKit,
  Kit,
  QuestionKit,
} from '../../layouts/layout';
import {
  answerStatus,
  itemAnswer,
  kindAnswer,
  pickNumber,
} from '../round-answers';
import {
  type AnswerableItem,
  requireKind,
  type RoundItem,
  type RoundState,
  type TextTarget,
} from '../round-model';
import {
  appendBoxKeys,
  appendPickKeys,
  buildChoiceList,
  buildChoiceReason,
  buildField,
  buildItemHead,
  statusLabel,
} from '../kinds/card-parts';
import type {
  BuiltInCard,
  CardDeps,
  CardInputs,
  CardKits,
} from '../kinds/item-format';
import type { KeyHints } from '../../../../contracts/plugin';

type ReasonsMode = Parameters<FindingKit['choiceGroups']>[1];

// One of the item's text boxes: its caption, the target it edits, and the
// text it opens on.
interface ItemTextBox {
  caption: KindBox;
  target: TextTarget;
  text: string;
}

// What every part of one card's kit shares: the item, its kind and its round,
// its deps, the base kit's deps and the anchor over the forms view's keys, the
// markdown mount its own parts draw through, its boxes by field, the updaters
// the parts that show answer state register, and the contributed parts once
// placed, null before.
interface CardContext {
  roundId: string;
  item: RoundItem;
  kind: PageKind;
  position: number;
  deps: CardDeps;
  kitDeps: BaseKitDeps;
  anchor: ScopedAnchor;
  mount: MarkdownMount;
  boxes: Map<string, ItemTextBox>;
  placed: Set<string>;
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
export interface CardKit<T extends Kit = Kit> {
  kit: T;
  // Runs every part's updater with the round's current state.
  update(round: RoundState): void;
  // Runs the update each contributed part returned.
  updateContributedParts(): void;
  // Places each of the item's boxes no part placed, in its default field at
  // the end of `card`.
  appendUnplacedBoxes(card: HTMLElement): void;
  // Places the contributed parts at the end of `card` when the card never
  // called `contributedParts`; nothing when no part names the card's kind.
  appendUnplacedParts(card: HTMLElement): void;
}

// The built-in cards' kits: the notice's is the base kit; the question's and
// the finding's add their own parts to the answer kit.
const BUILT_IN_KITS: {
  [K in BuiltInCard]: (card: CardContext, input: CardInputs[K]) => CardKits[K];
} = {
  notice: (card) => buildBaseKit(card),
  question: (card, input) =>
    buildQuestionKit(card, card.item, buildAnswerKit(card), input),
  finding: (card, input) =>
    buildFindingKit(card, card.item, buildAnswerKit(card), input),
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

// The card's word for `action`, or the action value itself when `actions`
// lacks it, as when the page's spec for the origin differs from main's.
function actionLabelOf(input: FindingCard, action: FindingAction): string {
  const offered = input.actions.find((each) => each.action === action);
  return offered === undefined ? action : offered.label;
}

// The round's reason for deferral `action`; null for none or blank text, and
// for any other action, which takes none.
function actionReasonOf(
  input: FindingCard,
  action: FindingAction,
): string | null {
  const isDeferral = action === 'follow_up' || action === 'leave_it';
  const text = isDeferral ? input.actionReasons[action] : undefined;
  return text === undefined || text.trim() === '' ? null : text;
}

// The base kit's deps for a card or pane whose keys fire in `scope`, its short
// command names being forms commands, its markdown mount recorded through
// `deps.recordMount`.
export function baseKitDepsFor(
  deps: Pick<
    CardDeps,
    | 'markdown'
    | 'platform'
    | 'commands'
    | 'keys'
    | 'state'
    | 'recordAnchor'
    | 'recordMount'
    | 'log'
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
    state: deps.state,
    recordAnchor: (anchor) => deps.recordAnchor(anchor),
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

// Names the anchor for a qualified command on `element`, firing with `arg`,
// and drawing the command's label after the keys as `label` says.
export type ScopedAnchor = (
  element: HTMLElement,
  command: CommandId,
  options?: { arg?: CommandArg; label?: boolean | string },
) => void;

// The anchor `keys` names in `scope`, the scope of the part drawing.
export function scopedAnchor(
  keys: Pick<KeyHints, 'anchor'>,
  scope: ViewScope,
): ScopedAnchor {
  return (element, command, options) => {
    keys.anchor(element, command, { scope, ...options });
  };
}

// The kit for the card of built-in `kind` item `index` at rail `position`,
// built from its card input. Throws for a kind the round has no registration
// for.
export function createCardKit<K extends BuiltInCard>(
  kind: K,
  index: number,
  input: CardInputs[K],
  round: RoundState,
  position: number,
  deps: CardDeps,
): CardKit<CardKits[K]> {
  const card = cardContext({ kind, index }, round, position, deps);
  return cardKitOver(card, BUILT_IN_KITS[kind](card, input));
}

// The kit for the card of plugin kind `kind` item `index` at rail `position`:
// the base kit, with `answerControls` when the kind takes an answer. Throws for
// a kind the round has no registration for.
export function createKindKit(
  kind: ItemKind,
  index: number,
  round: RoundState,
  position: number,
  deps: CardDeps,
): CardKit<KindKit> {
  const card = cardContext({ kind, index }, round, position, deps);
  const kit = card.kind.spec.answerable
    ? buildAnswerKit(card)
    : buildBaseKit(card);
  return cardKitOver(card, kit);
}

// What every part of `item`'s card kit shares, its markdown mount recorded
// through `deps`. Throws for a kind the round has no registration for.
function cardContext(
  item: RoundItem,
  round: RoundState,
  position: number,
  deps: CardDeps,
): CardContext {
  const pageKind = requireKind(round.kinds, item);
  const mount = createMarkdownMount(deps.markdown, deps.log);
  deps.recordMount(mount);
  return {
    roundId: round.formId,
    item,
    kind: pageKind,
    position,
    deps,
    kitDeps: baseKitDepsFor(deps, formsScope('forms')),
    anchor: scopedAnchor(deps.keys, formsScope('forms')),
    mount,
    boxes: itemTextBoxes(round, item, pageKind),
    placed: new Set(),
    updaters: [],
    placedParts: null,
  };
}

// The card host's handle on `kit`, built over `card`.
function cardKitOver<T extends Kit>(card: CardContext, kit: T): CardKit<T> {
  const { deps } = card;
  const { kind } = card.item;
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
    appendUnplacedBoxes(element) {
      for (const field of card.boxes.keys()) {
        if (!card.placed.has(field)) {
          placeTextBox(card, element, field);
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

// The item's text boxes, its kind's `boxes.fields` in their default order,
// each with its current text from `reduce.text`.
function itemTextBoxes(
  round: RoundState,
  item: RoundItem,
  kind: PageKind,
): Map<string, ItemTextBox> {
  const answer = kindAnswer(round, item);
  return new Map(
    kind.boxes.fields.map((caption) => [
      caption.field,
      {
        caption,
        target: { field: caption.field, item },
        text: kind.reduce.text(answer, caption.field),
      },
    ]),
  );
}

// Places the item's box for `field` in its default field; the field hides
// while it is not in the kind's `boxes.shown` for the item's answer.
function placeTextBox(
  card: CardContext,
  parent: HTMLElement,
  field: string,
): HTMLElement {
  const box = card.boxes.get(field);
  if (box === undefined) {
    throw new Error(`${card.item.kind} card has no ${field} box`);
  }
  if (card.placed.has(field)) {
    throw new Error(`${card.item.kind} card placed ${field} twice`);
  }
  const { caption } = box;
  const { anchor } = card;
  const built = buildField(
    parent,
    caption.className,
    caption.label,
    caption.hint,
    caption.keys === null ? null : { command: caption.keys, anchor },
    (fieldElement) => card.deps.placeBox(fieldElement, box.target, box.text),
  );
  appendBoxKeys(built, anchor);
  card.placed.add(field);
  const { item, kind } = card;
  card.updaters.push((current) => {
    const shown = kind.boxes.shown(kindAnswer(current, item));
    built.element.hidden = !shown.includes(field);
  });
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

// The runner of the forms command `short` on the card's item, its arg the
// item's rail position; obtained while the card builds, so a click checks
// nothing.
function itemRunner(
  card: CardContext,
  kit: Kit,
  short: FormsCommandName,
): () => void {
  return kit.command(formsCommand(short), card.position);
}

// A pick that runs `forms.chooseAt` on the card's item with the clicked
// number, from one runner per drawn number obtained now.
function choosePick(
  card: CardContext,
  kit: Kit,
  numbers: number[],
): (number: number) => void {
  const runners = new Map(
    numbers.map((number) => [number, chooseRunner(card, kit, number)]),
  );
  return (number) => runners.get(number)?.();
}

// The runner of `forms.chooseAt` picking `number` on the card's item.
function chooseRunner(card: CardContext, kit: Kit, number: number) {
  return kit.command(formsCommand('chooseAt'), {
    item: card.position,
    number,
  });
}

function buildBaseKit(card: CardContext): Kit {
  return {
    ...createFormsBaseKit(card.kitDeps),
    itemHead(parent, kind) {
      const { header, status } = buildItemHead(parent, kind);
      if (card.kind.spec.answerable) {
        card.updaters.push((current) => {
          const itemStatus = answerStatus(current, card.item);
          status.textContent =
            itemStatus === 'untouched' ? '' : statusLabel(itemStatus);
        });
      }
      return header;
    },
    position: card.position,
    textBox: (parent, field) => placeTextBox(card, parent, field),
    contributedParts: (parent) => placeContributedParts(card, parent),
  };
}

// The base kit with `answerControls` for the card's answerable item. The
// toggles always mount; the Notes and reason boxes only when the item's kind
// has those fields.
function buildAnswerKit(card: CardContext): AnswerKit {
  const { item } = card;
  const kit = buildBaseKit(card);
  const placeIfField = (parent: HTMLElement, field: string) => {
    if (card.boxes.has(field)) {
      kit.textBox(parent, field);
    }
  };
  return {
    ...kit,
    answerControls(parent) {
      placeIfField(parent, 'notes');
      const toggles = element('div', 'toggles');
      const notApplicable = textButton(
        'Not applicable',
        itemRunner(card, kit, 'toggleNotApplicableAt'),
        { variant: 'secondary' },
      );
      const dontAsk = textButton(
        "Don't ask me this",
        itemRunner(card, kit, 'toggleDontAskAt'),
        { variant: 'secondary' },
      );
      appendCardKeys(card, notApplicable, formsCommand('toggleNotApplicable'));
      appendCardKeys(card, dontAsk, formsCommand('toggleDontAsk'));
      toggles.append(notApplicable, dontAsk);
      parent.append(toggles);
      placeIfField(parent, 'dontAskReason');
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
      const answerArea = appendAnswerArea(parent, card, kit, null);
      const list = element('ol', 'choices');
      answerArea.append(list);
      const choices = input.choices.map((text, i) => ({ text, number: i + 1 }));
      const { entries } = buildChoiceList(
        list,
        choices,
        input.recommend,
        choosePick(
          card,
          kit,
          choices.map((choice) => choice.number),
        ),
        {
          markdown: card.deps.markdown,
          mount: card.mount,
          anchor: card.anchor,
        },
      );
      const recommended = entries[input.recommend - 1];
      if (reasons !== 'none' && recommended !== undefined) {
        appendChoiceReason(recommended, null, input.rationale, card);
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

// Appends `div.answer` to `parent`, opening on the row that holds the Clear
// button: a click clears the choice on the card's item. The row is a section
// header holding `label` when one is given; with null it is
// `div.answer-head`, holding the Clear button alone.
function appendAnswerArea(
  parent: HTMLElement,
  card: CardContext,
  kit: Kit,
  label: string | null,
): HTMLElement {
  const clear = textButton('Clear', itemRunner(card, kit, 'clearChoiceAt'), {
    variant: 'secondary',
  });
  appendCardKeys(card, clear, formsCommand('clearChoice'));
  const answerArea = element('div', 'answer');
  if (label === null) {
    const head = element('div', 'answer-head');
    head.append(clear);
    answerArea.append(head);
  } else {
    answerArea.append(sectionHeader(label, clear));
  }
  parent.append(answerArea);
  return answerArea;
}

// Appends the reason to a choice's row, under `label` when one is given; blank
// text draws nothing.
function appendChoiceReason(
  entry: HTMLElement,
  label: string | null,
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
  const answerArea = appendAnswerArea(parent, card, kit, 'Your answer');
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
    choosePick(
      card,
      kit,
      group.choices.map((choice) => choice.number),
    ),
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
  const pick = button(
    'choice-pick choice-group-pick',
    '',
    chooseRunner(card, kit, number),
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

// A finding's verdict, wherever the layout places it: its origin and severity tags, the
// impact, and the Accept button, which picks the recommended entry on the
// finding, the one the choice groups tag.
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
  if (input.originToken !== '') {
    origin.style.setProperty(
      '--forms-origin-color',
      `var(${input.originToken})`,
    );
  }
  chips.append(origin);
  if (input.severityChip !== null && input.severity !== null) {
    const severity = tagPart(input.severityChip);
    severity.classList.add('badge-severity');
    severity.dataset.severity = input.severity;
    chips.append(severity);
  }
  const accept = textButton(
    'Accept',
    itemRunner(card, kit, 'acceptRecommendationAt'),
    { variant: 'primary' },
  );
  appendCardKeys(card, accept, formsCommand('acceptRecommendation'));
  const buttons = element('div', 'verdict-buttons');
  buttons.append(accept);
  const impact = element('div', 'verdict-impact md');
  block.append(chips, impact, buttons);
  parent.append(block);
  card.mount.draw(impact, deps.markdown.block(input.impact));
  return block;
}
