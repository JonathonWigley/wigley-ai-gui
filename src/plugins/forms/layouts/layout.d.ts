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
  choices: { text: string; reason: string }[];
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
  | { type: 'choose'; choice: number }
  | { type: 'chooseAction'; action: FindingAction }
  | { type: 'toggleNotApplicable' }
  | { type: 'toggleDontAsk' }
  | { type: 'accept' }
  | { type: 'focus' };

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
  keys(command: string): string | null;
}
export interface Kit extends HeadKit {
  // `header.item-head` holding the kind label and the status chip, which updates itself; returns the header.
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
  // `div.answer` with its 'Your answer' label and `ol.choices`; returns the `div.answer`, which `actionRow` and
  // `answerControls` may be appended to. 'recommended': the recommended choice's reason under it (a question's
  // rationale as 'Why recommended'; a finding's choice reason as 'Why'). 'all': every choice's reason as 'Why'; on a
  // question the same as 'recommended'. A blank reason draws nothing. On a finding card the list dims while the
  // action is leave_it.
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
  actionRow(parent: HTMLElement): HTMLElement;
}

// `element` is the card's own node, appended to `parent` before the card mounts any text box; the app shows, hides and
// marks that node. On question and finding cards, `update` runs with the item's current answer while the card shows;
// a notice card's `update` never runs. The kit's parts update themselves.
export interface LayoutCard {
  element: HTMLElement;
  update?(answer: CardAnswer): void;
}

export interface Layout {
  cards: {
    question(
      parent: HTMLElement,
      input: QuestionCard,
      kit: AnswerKit,
    ): LayoutCard;
    finding(
      parent: HTMLElement,
      input: FindingCard,
      kit: FindingKit,
    ): LayoutCard;
    notice(parent: HTMLElement, input: NoticeCard, kit: Kit): LayoutCard;
  };
  // Drawn above the cards in the forms view, once per round and again after
  // each keymap change.
  head?(parent: HTMLElement, round: RoundInfo, kit: HeadKit): void;
}
