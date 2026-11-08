import type {
  BaseKit,
  KeyHintOptions,
  TagTone,
} from '../../../shared/page/layout-host/kit';

// The tag tone, for a layout's JSDoc to import from here.
export type { TagTone };

export interface RoundInfo {
  heading: string;
  overview: string;
}

export interface QuestionCard {
  label: string;
  title: string;
  question: string;
  context: string;
  choices: string[];
  recommend: number;
  rationale: string;
  round: RoundInfo;
}
export interface NoticeCard {
  label: string;
  title: string;
  context: string;
  badge: string;
  round: RoundInfo;
}
export type FindingAction = 'fix_now' | 'follow_up' | 'leave_it';
// One numbered pick down a finding card: a choice with the action it sits under, or the header of an action with no
// choices, whose `choice` is 0. `choice` is otherwise the choice's 1-based position in `choices`; `number` is the
// entry's 1-based position down the card, which its key picks through `forms.choose` with that number: draw the key
// with `kit.keyHint(parent, 'choose', { arg: number })` or read it with `kit.keys('choose', number)`. A card's click
// picks it with `kit.command('forms.chooseAt', { item: kit.position, number })`, obtained while the card builds.
export interface FindingCardEntry {
  number: number;
  action: FindingAction;
  choice: number;
}
export interface FindingCard {
  label: string;
  title: string;
  card: 'defect' | 'decision' | 'nit';
  origin: 'caused' | 'pre_existing' | 'design' | 'nit';
  severity: 'critical' | 'important' | 'minor' | null;
  // The card's own words: its kind label and the titles of its two sections.
  words: { kind: string; finding: string; proof: string };
  originChip: string;
  severityChip: string | null;
  impact: string;
  finding: string;
  proof: string;
  // Each choice with the action it sits under, in wire order.
  choices: { text: string; reason: string; action: FindingAction }[];
  // Every entry in card order: the actions the origin offers in `actions` order, each with its choices, or its header
  // alone when it has none.
  entries: FindingCardEntry[];
  // The recommended choice's 1-based position in `choices`; null when the recommendation is recommendAction's header.
  recommend: number | null;
  recommendAction: FindingAction;
  // Why to take a deferral action, by action, for each one the round sent a reason for.
  actionReasons: { follow_up?: string; leave_it?: string };
  // The actions the origin offers, in the card's words.
  actions: { action: FindingAction; label: string }[];
  round: RoundInfo;
}

export interface CardAnswer {
  status: 'answered' | 'not_applicable' | 'untouched';
  choice: number | null;
  notApplicable: boolean;
  dontAsk: boolean;
  action: FindingAction | null;
}

// The base kit every forms card and pane, and the head, draws with.
export interface FormsBaseKit extends BaseKit {
  // As the base kit's `keyHint`; a string `options` is the span's `className`.
  keyHint(
    parent: HTMLElement,
    command: string,
    options?: KeyHintOptions | string,
  ): HTMLElement;
}

export interface Kit extends FormsBaseKit {
  // This card's item's rail position, the `arg` of `forms.focusItem` and the `forms.*At` commands, and the `item` of
  // `forms.chooseAt`. A click acts on this item through them, whatever box holds focus: `kit.command(id, arg)` checks
  // its command while the card builds, so obtain each runner then. `forms.chooseAt`'s `number` is 1-based, a
  // question's choice or a finding's entry (`FindingCardEntry.number`); picking the held number again clears the pick.
  readonly position: number;
  // `header.item-head` holding the kind tag and the status label, which updates itself; returns the header.
  // A card that leaves it out still gets `data-status` on its element.
  itemHead(parent: HTMLElement, kind: string): HTMLElement;
  // Mounts the item's text box for `field`. Each box mounts once per card. Any box the card leaves unmounted, the
  // app appends in its default field at the end of the card, so the box keys always reach it.
  textBox(
    parent: HTMLElement,
    field: 'notes' | 'dontAskReason' | 'comment',
  ): HTMLElement;
  // `div.card-parts`, holding one `div.card-part` (`data-part="<id>"`) per part other plugins added for this card's
  // kind, in the order they were added; returns the `div.card-parts`. Call it once, where the parts go: a card that
  // leaves it out gets the parts appended at the end of its element, after the boxes it left unmounted. A part that
  // throws is logged and draws nothing. On a question or finding card, each part updates after the card's own `update`;
  // a notice card's parts never update.
  contributedParts(parent: HTMLElement): HTMLElement;
}
export interface AnswerKit extends Kit {
  // The Notes box, the Not applicable and Don't ask toggles, and the reason box, appended to `parent` in that order;
  // returns the toggles row (`div.toggles`).
  answerControls(parent: HTMLElement): HTMLElement;
}
export interface QuestionKit extends AnswerKit {
  // `div.answer` with its 'Your answer' label and `ol.choices`; returns the `div.answer`, which `answerControls` may be
  // appended to. 'recommended' and 'all': the rationale as 'Why recommended' under the recommended choice; 'none': no
  // reason. A blank rationale draws nothing.
  choiceList(
    parent: HTMLElement,
    reasons: 'recommended' | 'all' | 'none',
  ): HTMLElement;
}
export interface FindingKit extends AnswerKit {
  // The origin and severity tags, the impact, and the Accept button, which picks the recommended entry.
  verdict(parent: HTMLElement): HTMLElement;
  // `div.answer` with its 'Your answer' label, then one `section.choice-group` (`data-action`) per run of entries of
  // one action, in `entries` order; returns the `div.answer`, which `answerControls` may be appended to. A group with
  // choices draws the action's word as a section header over `ol.choices`, each choice under its entry number; a
  // group with no choices draws one `div.choice` row of its own, its entry number in the choice number badge, then the
  // action's word. An action's `actionReasons` text sits under its header, inside the row for a group with no
  // choices. 'all': every choice's reason as 'Why'; 'recommended': the recommended choice's only; 'none': no choice
  // reason. A blank reason draws nothing. The recommended pick, a choice or a header, is tagged Recommended.
  choiceGroups(
    parent: HTMLElement,
    reasons: 'recommended' | 'all' | 'none',
  ): HTMLElement;
}

// `element` is the card's own node, appended to `parent` before the card mounts any text box; the app shows, hides and
// marks that node. On question and finding cards, `update` runs with the item's current answer while the card shows;
// a notice card's `update` never runs. The kit's parts update themselves.
export interface LayoutCard {
  element: HTMLElement;
  update?(answer: CardAnswer): void;
}

// A card builder per item kind. The app sets `data-layout-owner="forms"` and `data-layout="<name>"` on each card's
// element, `<name>` being the layout that drew it, so `[data-layout-owner="forms"][data-layout="<name>"] …` in a
// layout's CSS selects only its own cards.
export interface LayoutCards {
  question(
    parent: HTMLElement,
    input: QuestionCard,
    kit: QuestionKit,
  ): LayoutCard;
  finding(parent: HTMLElement, input: FindingCard, kit: FindingKit): LayoutCard;
  notice(parent: HTMLElement, input: NoticeCard, kit: Kit): LayoutCard;
}

// One item as the rail lists it. `position` is its 0-based place in the rail, which `RailKit.entry` takes; `label` is
// its rail number, as `F1` or `2`.
export interface RailEntryInput {
  position: number;
  kind: 'question' | 'finding' | 'notice';
  label: string;
  title: string;
}
export interface RailInput {
  round: RoundInfo;
  items: RailEntryInput[];
}
// One question or finding as the review lists it. `row` is its 0-based place in the review, which `ReviewKit.row`
// takes.
export interface ReviewRowInput {
  row: number;
  kind: 'question' | 'finding';
  label: string;
  title: string;
}
export interface ReviewInput {
  round: RoundInfo;
  rows: ReviewRowInput[];
}

// `element` is the pane's own node, appended to `parent` before the pane mounts any text box. The app shows and hides
// that node and sets `data-layout-owner="forms"` and `data-layout="<name>"` on it, `<name>` being the layout that drew
// it.
export interface LayoutPane {
  element: HTMLElement;
}

// The rail's parts, each keeping itself up to date while the round shows.
export interface RailKit extends FormsBaseKit {
  // `li.rail-entry` for the item at rail `position`: a list row leading with the item's status dot and rail number,
  // its title as label and tooltip. It carries `data-status`, marks the focused item `is-selected` and an untouched
  // item `is-flagged` while the review or the cancel prompt shows, and a click jumps to its item. The app scrolls the
  // focused item's entry into view; a rail drawn without entries scrolls nothing.
  entry(parent: HTMLElement, position: number): HTMLElement;
}

// The review's parts, each keeping itself up to date while the review shows. Its `row` draws a review row in place of
// the base kit's list row.
export interface ReviewKit extends Omit<FormsBaseKit, 'row'> {
  // `li.review-row` for review row `row`: the item's label and title, then its pick (action word, entry number and
  // choice text, the Recommended tag) or its status, the jump keys on the cursor row, the Notes and Don't ask lines,
  // and last one `span.review-cell` (`data-column="<id>"`) per column other plugins added, holding its text, with the
  // column's title as its tooltip. A click jumps to its item. The app scrolls the cursor row into view.
  row(parent: HTMLElement, row: number): HTMLElement;
  // `p.round-progress`: how many items are answered and how many not applicable.
  progress(parent: HTMLElement): HTMLElement;
  // `p.review-summary`: the progress, and how many items are sent untouched.
  summary(parent: HTMLElement): HTMLElement;
  // The round note's field with its text box; returns the field. It mounts once per pane: a pane that leaves it out
  // gets it appended at the end of its element, so the note keys always reach a box.
  roundNote(parent: HTMLElement): HTMLElement;
  // `Send answers`, the primary button, with its keys; a click sends the round.
  sendButton(parent: HTMLElement): HTMLButtonElement;
  // `Cancel round`, with its keys; a click asks to cancel the round.
  cancelButton(parent: HTMLElement): HTMLButtonElement;
}

// A layout defines only the cards and panes it changes. Each card comes from the first layout defining its kind among
// the item's `layout`, the round's `layout`, the `forms.layout` setting and `default`; each pane the same way without
// the item. A card or pane that throws, or returns no element appended to `parent`, is drawn by `default` instead.
export interface Layout {
  cards?: Partial<LayoutCards>;
  // Drawn above the cards in the forms view, once per round and again after each keymap change, into a slot carrying
  // `data-layout-owner="forms"` and `data-layout="<name>"`.
  head?(parent: HTMLElement, round: RoundInfo, kit: FormsBaseKit): void;
  // The rail beside the cards, under the app's rail header and over its Review button, built once per round.
  rail?(parent: HTMLElement, input: RailInput, kit: RailKit): LayoutPane;
  // Shown in place of the cards while the user reviews the round or confirms a cancel, built once per round.
  review?(parent: HTMLElement, input: ReviewInput, kit: ReviewKit): LayoutPane;
}

// The built-in `default` layout, which defines every card and pane but the head.
export interface CompleteLayout extends Layout {
  cards: LayoutCards;
  rail(parent: HTMLElement, input: RailInput, kit: RailKit): LayoutPane;
  review(parent: HTMLElement, input: ReviewInput, kit: ReviewKit): LayoutPane;
}
