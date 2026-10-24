import type { CommandId } from '../../../../contracts/commands';
import { element, markdownElement } from '../../../../shared/page/dom';
import { textButton } from '../../../../shared/page/ui/button';
import { card as cardPart } from '../../../../shared/page/ui/card';
import { kbd } from '../../../../shared/page/ui/kbd';
import { sectionHeader } from '../../../../shared/page/ui/section-header';
import { tag as tagPart } from '../../../../shared/page/ui/tag';
import type { FindingAction, ItemKind } from '../../contract';
import { formsCommand, formsCommandNamed } from '../../ids';
import type {
  AnswerKit,
  FindingKit,
  HeadKit,
  Kit,
  LayoutAction,
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
  appendKeyHint,
  buildChoiceList,
  buildChoiceReason,
  buildField,
  buildItemHead,
  buildSection,
  keyHint,
  statusLabel,
} from '../kinds/card-parts';
import type { CardDeps, CardInputs, CardKits } from '../kinds/item-format';

type TextBoxField = Parameters<Kit['textBox']>[1];
type ReasonsMode = Parameters<AnswerKit['choiceList']>[1];

// One of the item's text boxes, with the text it opens on.
interface ItemTextBox {
  target: TextTarget;
  text: string;
}

// What every part of one card's kit shares: the item, its boxes, and the
// updaters the parts that show answer state or keys register.
interface CardContext {
  item: RailItem;
  position: number;
  deps: CardDeps;
  boxes: Map<TextBoxField, ItemTextBox>;
  mounted: Set<TextBoxField>;
  updaters: ((round: RoundState) => void)[];
}

// A labelled reason drawn under one choice.
interface ChoiceReason {
  label: string;
  text: string;
}

// An answerable card's choices, each with the number the card shows and its
// key picks; the number the Recommended tag sits on, null for none; and the
// reason each choice shows for a `choiceList` reasons mode, null where it
// shows none.
interface ChoiceSet {
  choices: { text: string; number: number }[];
  recommended: number | null;
  reasons(mode: ReasonsMode): (ChoiceReason | null)[];
}

// A card's kit, and what the card host does with it.
export interface CardKit<K extends ItemKind> {
  kit: CardKits[K];
  // Runs every part's updater with the round's current state.
  update(round: RoundState): void;
  // Mounts each of the item's boxes no part mounted, in its default field at
  // the end of `card`.
  appendUnmountedBoxes(card: HTMLElement): void;
}

const FIELD_CAPTIONS: Record<
  TextBoxField,
  { className: string; label: string; hint: string }
> = {
  notes: {
    className: 'field-notes',
    label: 'Notes',
    hint: 'Optional. Your own answer or your reasoning, sent to the agent.',
  },
  dontAskReason: {
    className: 'field-reason',
    label: 'Why not ask this',
    hint: 'Optional. Sent to the agent with your answer.',
  },
  comment: {
    className: 'field-comment',
    label: 'Comment',
    hint: 'Optional. Say if this needs a second look.',
  },
};

const KIT_BUILDERS: {
  [K in ItemKind]: (card: CardContext, input: CardInputs[K]) => CardKits[K];
} = {
  notice: (card) => buildBaseKit(card),
  question: (card, input) =>
    buildAnswerKit(
      card,
      { kind: 'question', index: card.item.index },
      buildBaseKit(card),
      {
        choices: input.choices.map((text, i) => ({ text, number: i + 1 })),
        recommended: input.recommend,
        reasons: (mode) =>
          input.choices.map((_text, i) =>
            mode !== 'none' && i + 1 === input.recommend
              ? { label: 'Why recommended', text: input.rationale }
              : null,
          ),
      },
    ),
  finding: (card, input) => {
    const answerKit = buildAnswerKit(
      card,
      { kind: 'finding', index: card.item.index },
      buildBaseKit(card),
      {
        choices: input.choices.map((choice, i) => ({
          text: choice.text,
          number: findingEntryNumberOf(input, i + 1, choice.action),
        })),
        recommended: recommendedEntryNumber(input),
        reasons: (mode) =>
          input.choices.map((choice, i) => {
            const isShown =
              mode === 'all' ||
              (mode === 'recommended' && i + 1 === input.recommend);
            return isShown ? { label: 'Why', text: choice.reason } : null;
          }),
      },
    );
    return buildFindingKit(card, answerKit, input);
  },
};

// The FormsActions a layout action dispatches: focusing the card's item at
// rail `position`, then the action itself. Don't ask has none of its own: the
// kit runs its command, which also focuses the reason box.
export function layoutActions(
  action: LayoutAction,
  position: number,
): FormsAction[] {
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
  }
}

// The item as an answerable one; null for a notice, which takes no answer.
export function answerableOf(item: RailItem): AnswerableItem | null {
  return item.kind === 'notice' ? null : { kind: item.kind, index: item.index };
}

// The parts a layout's head draws with, over the forms view's keys, each key
// hint drawn for the platform.
export function createHeadKit(
  deps: Pick<CardDeps, 'markdown' | 'keysFor' | 'platform'>,
): HeadKit {
  return {
    el(parent, tagName, className = '', text) {
      const node = element(
        tagName as keyof HTMLElementTagNameMap,
        className,
        text,
      );
      parent.append(node);
      return node;
    },
    markdown(parent, text, className = '') {
      const node = markdownElement('div', className, deps.markdown.block(text));
      parent.append(node);
      return node;
    },
    inlineMarkdown(parent, text, className = '') {
      const node = markdownElement(
        'span',
        className,
        deps.markdown.inline(text),
      );
      parent.append(node);
      return node;
    },
    section: (parent, label, text) =>
      buildSection(parent, label, text, deps.markdown),
    keys: (command) => keysOfNamed(deps, command),
    keyHint(parent, command, className = '') {
      const node = element('span', className);
      parent.append(node);
      appendKeyHint(node, () => keysOfNamed(deps, command), deps.platform);
      return node;
    },
    card(parent, className = '') {
      const node = cardPart();
      if (className !== '') {
        node.className = `${node.className} ${className}`;
      }
      parent.append(node);
      return node;
    },
    tag(parent, text, tone) {
      const node = tagPart(text, tone);
      parent.append(node);
      return node;
    },
    kbd(parent, keys) {
      const node = kbd(keys, deps.platform);
      parent.append(node);
      return node;
    },
    button(parent, label, onClick, options = {}) {
      const node = textButton(label, onClick, {
        variant: options.variant,
        hint: keyHint(options.keys ?? null, deps.platform),
      });
      parent.append(node);
      return node;
    },
    sectionHeader(parent, text) {
      const node = sectionHeader(text);
      parent.append(node);
      return node;
    },
  };
}

// The forms view's keys for the forms command short-named `command`; null
// when unbound or no forms command has that name.
function keysOfNamed(
  deps: Pick<CardDeps, 'keysFor'>,
  command: string,
): string | null {
  const id = formsCommandNamed(command);
  return id === null ? null : deps.keysFor(id);
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
  const card: CardContext = {
    item,
    position,
    deps,
    boxes: itemTextBoxes(round, item),
    mounted: new Set(),
    updaters: [],
  };
  const kit = KIT_BUILDERS[kind](card, input);
  return {
    kit,
    update(current) {
      for (const updater of card.updaters) {
        updater(current);
      }
    },
    appendUnmountedBoxes(element) {
      for (const field of card.boxes.keys()) {
        if (!card.mounted.has(field)) {
          mountTextBox(card, element, field);
        }
      }
    },
  };
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
  const built = buildField(
    parent,
    caption.className,
    caption.label,
    caption.hint,
  );
  card.deps.mountBox(built.box, box.target, box.text);
  card.mounted.add(field);
  const { target } = box;
  if (target.field === 'dontAskReason') {
    card.updaters.push((current) => {
      built.element.hidden = !itemAnswer(current, target.item).dontAsk;
    });
  }
  return built.element;
}

// Shows the keys that run `command` at the end of `control`, read again on
// each card update, so a changed keymap reaches the hint on the card's next
// update.
function appendCardKeys(
  card: CardContext,
  control: HTMLElement,
  command: CommandId,
) {
  card.updaters.push(
    appendKeyHint(
      control,
      () => card.deps.keysFor(command),
      card.deps.platform,
    ),
  );
}

// Dispatches the action's FormsActions, then Don't ask's command for it.
function runLayoutAction(card: CardContext, action: LayoutAction) {
  for (const formsAction of layoutActions(action, card.position)) {
    card.deps.dispatch(formsAction);
  }
  if (action.type === 'toggleDontAsk') {
    card.deps.toggleDontAsk();
  }
}

function buildBaseKit(card: CardContext): Kit {
  return {
    ...createHeadKit(card.deps),
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
    // A card is never rebuilt on a keymap change, so its hint reads the keys
    // again on each card update.
    keyHint(parent, command, className = '') {
      const node = element('span', className);
      parent.append(node);
      card.updaters.push(
        appendKeyHint(
          node,
          () => keysOfNamed(card.deps, command),
          card.deps.platform,
        ),
      );
      return node;
    },
    textBox: (parent, field) => mountTextBox(card, parent, field),
    run: (action) => runLayoutAction(card, action),
  };
}

// `choiceList` and `answerControls` for answerable `item` over `kit`.
function buildAnswerKit(
  card: CardContext,
  item: AnswerableItem,
  kit: Kit,
  choices: ChoiceSet,
): AnswerKit {
  return {
    ...kit,
    choiceList(parent, reasons) {
      const answerArea = element('div', 'answer');
      const list = element('ol', 'choices');
      answerArea.append(sectionHeader('Your answer'), list);
      parent.append(answerArea);
      const { entries, updateKeys } = buildChoiceList(
        list,
        choices.choices,
        choices.recommended,
        (number) => kit.run({ type: 'choose', number }),
        card.deps,
      );
      choices.reasons(reasons).forEach((reason, i) => {
        if (reason !== null && reason.text.trim() !== '') {
          entries[i].append(
            buildChoiceReason(reason.label, reason.text, card.deps.markdown),
          );
        }
      });
      card.updaters.push(updateKeys);
      card.updaters.push((current) => {
        const picked = pickNumber(current, item);
        entries.forEach((entry, i) =>
          entry.classList.toggle(
            'is-selected',
            picked === choices.choices[i].number,
          ),
        );
        list.classList.toggle(
          'is-locked',
          itemAnswer(current, item).notApplicable,
        );
      });
      return answerArea;
    },
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

// `verdict` for the finding card `input` describes.
function buildFindingKit(
  card: CardContext,
  kit: AnswerKit,
  input: CardInputs['finding'],
): FindingKit {
  return {
    ...kit,
    verdict: (parent) => buildVerdict(parent, input, kit, card),
  };
}

// Shows a toggle or pick as on or off.
function showPressed(control: HTMLElement, isPressed: boolean) {
  control.classList.toggle('is-selected', isPressed);
  control.setAttribute('aria-pressed', String(isPressed));
}

// The verdict under the finding and proof: its origin and severity tags, the
// impact, and the Accept button, which focuses the finding and picks the
// recommended entry, which the choice list tags when it is a choice.
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
  block.append(
    chips,
    markdownElement(
      'div',
      'verdict-impact md',
      deps.markdown.block(input.impact),
    ),
    buttons,
  );
  parent.append(block);
  return block;
}

// The number of the finding card's entry `{ choice, action }`, 0 when the card
// has no such entry.
function findingEntryNumberOf(
  input: CardInputs['finding'],
  choice: number,
  action: FindingAction,
): number {
  const entry = input.entries.find(
    (each) => each.choice === choice && each.action === action,
  );
  return entry?.number ?? 0;
}

// The number of the finding card's recommended entry, recommendAction with
// recommend; null when the card has no such entry.
function recommendedEntryNumber(input: CardInputs['finding']): number | null {
  const number = findingEntryNumberOf(
    input,
    input.recommend,
    input.recommendAction,
  );
  return number === 0 ? null : number;
}
