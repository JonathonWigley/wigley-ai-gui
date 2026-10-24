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
// entry's 1-based position down the card, which its key (`choose<number>`) picks.
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
  // The recommended choice's 1-based position in `choices`; 0 when the recommendation is recommendAction's header.
  recommend: number;
  recommendAction: FindingAction;
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

export type LayoutAction =
  // `number` is 1-based: a question's choice, or a finding's entry (`FindingCardEntry.number`), which sets its choice
  // and action together. Picking the held number again clears the pick.
  | { type: 'choose'; number: number }
  | { type: 'toggleNotApplicable' }
  | { type: 'toggleDontAsk' }
  | { type: 'accept' }
  | { type: 'focus' };

// The tones a kit tag takes and the variants a kit button takes.
export type TagTone =
  | 'neutral'
  | 'accent'
  | 'running'
  | 'success'
  | 'warning'
  | 'attention'
  | 'error';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface KitButtonOptions {
  variant?: ButtonVariant;
  keys?: string | null;
}

// Every part appends itself to `parent` and returns what it appended, except where its comment says otherwise.
export interface HeadKit {
  el(
    parent: HTMLElement,
    tag: string,
    className?: string,
    text?: string,
  ): HTMLElement;
  markdown(parent: HTMLElement, text: string, className?: string): HTMLElement;
  inlineMarkdown(
    parent: HTMLElement,
    text: string,
    className?: string,
  ): HTMLElement;
  section(parent: HTMLElement, label: string, text: string): HTMLElement | null;
  // The keys bound to a forms command (its short name, as `choose1`) in the forms view; null when unbound or unknown.
  // It reads the keymap once, when called, so text a card draws from it keeps the keys of the card's build after a
  // rebind; draw a hint with `keyHint` for one that follows the keymap.
  keys(command: string): string | null;
  // `span` (with `className`) holding the hint of the keys `keys` reads for `command`, empty while unbound. The hint
  // follows keymap changes: a card's redraws on each card update, and the head is drawn again after each change.
  keyHint(
    parent: HTMLElement,
    command: string,
    className?: string,
  ): HTMLElement;
  // `div.ui-card` with `className` added: the card every built-in card draws on.
  card(parent: HTMLElement, className?: string): HTMLElement;
  // `span.ui-tag`; tone `neutral` when left out.
  tag(parent: HTMLElement, text: string, tone?: TagTone): HTMLElement;
  // A key hint for `keys` as `keys(command)` returns it, drawn for the platform.
  kbd(parent: HTMLElement, keys: string): HTMLElement;
  // `button.ui-button`, variant `secondary` when left out; never takes focus. `keys` draws its hint after the label.
  button(
    parent: HTMLElement,
    label: string,
    onClick: () => void,
    options?: KitButtonOptions,
  ): HTMLButtonElement;
  // `h3.ui-section-header`: a sentence-case label over a part of the card.
  sectionHeader(parent: HTMLElement, text: string): HTMLElement;
}
export interface Kit extends HeadKit {
  // `header.item-head` holding the kind tag and the status label, which updates itself; returns the header.
  // A card that leaves it out still gets `data-status` on its element.
  itemHead(parent: HTMLElement, kind: string): HTMLElement;
  // Mounts the item's text box for `field`. Each box mounts once per card. Any box the card leaves unmounted, the
  // app appends in its default field at the end of the card, so the box keys always reach it.
  textBox(
    parent: HTMLElement,
    field: 'notes' | 'dontAskReason' | 'comment',
  ): HTMLElement;
  // Focuses this card's item, then runs the action. Call it from event handlers, not while the card builds.
  run(action: LayoutAction): void;
}
export interface AnswerKit extends Kit {
  // `div.answer` with its 'Your answer' label and `ol.choices`; returns the `div.answer`, which `answerControls` may be
  // appended to. 'recommended': the recommended choice's reason under it (a question's rationale as 'Why
  // recommended'; a finding's choice reason as 'Why'). 'all': every choice's reason as 'Why'; on a question the same
  // as 'recommended'. A blank reason draws nothing. On a finding card each choice shows its entry's number
  // (`FindingCardEntry.number`), and an action header draws no control.
  choiceList(
    parent: HTMLElement,
    reasons: 'recommended' | 'all' | 'none',
  ): HTMLElement;
  // The Notes box, the Not applicable and Don't ask toggles, and the reason box, appended to `parent` in that order;
  // returns the toggles row (`div.toggles`).
  answerControls(parent: HTMLElement): HTMLElement;
}
export interface FindingKit extends AnswerKit {
  verdict(parent: HTMLElement): HTMLElement;
}

// `element` is the card's own node, appended to `parent` before the card mounts any text box; the app shows, hides and
// marks that node. On question and finding cards, `update` runs with the item's current answer while the card shows;
// a notice card's `update` never runs. The kit's parts update themselves.
export interface LayoutCard {
  element: HTMLElement;
  update?(answer: CardAnswer): void;
}

// A card builder per item kind. The app sets `data-layout="<name>"` on each card's element, `<name>` being the layout
// that drew it, so `[data-layout="<name>"] …` in a layout's CSS selects only its own cards.
export interface LayoutCards {
  question(
    parent: HTMLElement,
    input: QuestionCard,
    kit: AnswerKit,
  ): LayoutCard;
  finding(parent: HTMLElement, input: FindingCard, kit: FindingKit): LayoutCard;
  notice(parent: HTMLElement, input: NoticeCard, kit: Kit): LayoutCard;
}

// A layout defines only the cards and panes it changes. Each card comes from the first layout defining its kind among
// the item's `layout`, the round's `layout`, the `forms.layout` setting and `default`; each pane the same way without
// the item.
export interface Layout {
  cards?: Partial<LayoutCards>;
  // Drawn above the cards in the forms view, once per round and again after each keymap change, into a slot carrying
  // `data-layout="<name>"`.
  head?(parent: HTMLElement, round: RoundInfo, kit: HeadKit): void;
}

// The built-in `default` layout, which defines every card.
export interface CompleteLayout extends Layout {
  cards: LayoutCards;
}
