import type { Disposable } from '../../contracts/disposable';
import type { LayoutSet } from '../../contracts/layouts';
import type {
  AgentFormEnd,
  AgentFormInvoke,
  AgentFormMessages,
  AgentFormService,
  AgentFormSession,
} from '../../contracts/agent-forms';
import type { ChannelShape, EventShape } from '../../contracts/plugin';
import { NUMBER_KEY_COUNT } from './manifest';

export type NoticeBadge = 'Applied' | 'Dispatched' | 'Decided';

export type ItemKind = 'notice' | 'finding' | 'question';
// The kinds the user answers with a choice.
export type AnswerableKind = Exclude<ItemKind, 'notice'>;

export interface Question {
  title: string;
  context: string;
  question: string;
  choices: string[];
  // 1-based.
  recommend: number;
  rationale: string;
  // The layout that draws this item's card, over the round's; null for none.
  layout: string | null;
}

export interface Notice {
  title: string;
  context: string;
  badge: NoticeBadge;
  // The layout that draws this item's card, over the round's; null for none.
  layout: string | null;
}

// One of a finding's solutions, drawn under the action it sits under.
export interface FindingChoice {
  text: string;
  reason: string;
  action: FindingAction;
}

// What the user does with a finding. Picking a choice picks the action it
// sits under; an action with no choices is picked alone, as a header.
export type FindingAction = 'fix_now' | 'follow_up' | 'leave_it';

// In the order a finding card draws them.
export const FINDING_ACTIONS: readonly FindingAction[] = [
  'fix_now',
  'follow_up',
  'leave_it',
];

// The most numbered entries a card may show, one per number key: a
// question's choices, or a finding's choices and choiceless action headers.
export const MAX_ENTRIES = NUMBER_KEY_COUNT;

// Where a finding comes from; it sets the card the finding draws as and the
// fields it takes.
export type FindingOrigin = 'caused' | 'pre_existing' | 'design' | 'nit';

export const FINDING_ORIGINS: readonly FindingOrigin[] = [
  'caused',
  'pre_existing',
  'design',
  'nit',
];

export type Severity = 'critical' | 'important' | 'minor';

export const SEVERITIES: readonly Severity[] = [
  'critical',
  'important',
  'minor',
];

export type FindingCard = 'defect' | 'decision' | 'nit';

interface FindingFields {
  title: string;
  origin: FindingOrigin;
  // One plain sentence: what goes wrong, and for whom.
  impact: string;
  finding: string;
  proof: string;
  // A Defect's solutions, a Decision's options, a Nit's one fix.
  choices: FindingChoice[];
  // The 1-based number of the recommended choice, one of recommend_action;
  // null when recommend_action has no choices, so its header is recommended.
  recommend: number | null;
  recommend_action: FindingAction;
  // Why to take a deferral action, drawn under that action's header; the
  // ask_round key is action_reasons.
  actionReasons: Partial<Record<'follow_up' | 'leave_it', string>>;
  // The layout that draws this item's card, over the round's; null for none.
  layout: string | null;
}

export interface DefectFinding extends FindingFields {
  origin: 'caused' | 'pre_existing';
  severity: Severity;
}

export interface DecisionFinding extends FindingFields {
  origin: 'design';
}

export interface NitFinding extends FindingFields {
  origin: 'nit';
}

export type Finding = DefectFinding | DecisionFinding | NitFinding;

// A validated ask_round call.
export interface Round {
  heading: string;
  overview: string;
  // The layout that draws this round's panes and the cards no item's own
  // layout draws; null for none.
  layout: string | null;
  questions: Question[];
  notices: Notice[];
  findings: Finding[];
}

// One question's or finding's answer as last saved; field names are the
// saved-round file format.
export interface AnswerEntry {
  index: number;
  choice: number;
  not_applicable: boolean;
  notes: string;
  dont_ask: boolean;
  dont_ask_reason: string;
}

// `choice` is the picked choice's 1-based number in `choices`, 0 for an action
// header; `action` is the picked entry's action, '' for no pick.
export interface FindingAnswerEntry extends AnswerEntry {
  action: FindingAction | '';
}

export interface NoticeComment {
  index: number;
  comment: string;
}

export interface FormBody {
  note: string;
  answers: AnswerEntry[];
  finding_answers: FindingAnswerEntry[];
  notice_comments: NoticeComment[];
}

export type Outcome =
  | 'submitted'
  | 'draft'
  | 'cancelled'
  | 'needs_manual_open'
  | 'no_round';

export type AnswerStatus = 'answered' | 'not_applicable' | 'untouched';

export interface AnswerResult {
  index: number;
  title: string;
  status: AnswerStatus;
  choice: number;
  choice_text: string;
  took_recommendation: boolean;
  notes?: string;
  dont_ask?: true;
  dont_ask_reason?: string;
}

// `choice` and `choice_text` are the picked choice, 0 and '' for a header
// pick; `took_recommendation` is the recommended entry taken whole,
// `took_action_recommendation` the recommended action.
export interface FindingResult extends AnswerResult {
  action: FindingAction | '';
  took_action_recommendation: boolean;
}

export interface NoticeResult {
  index: number;
  title: string;
  badge: NoticeBadge;
  comment?: string;
}

// The tool result both forms tools return.
export interface AnswersPayload {
  outcome: Outcome;
  summary: string;
  next: string;
  answers: AnswerResult[];
  findings: FindingResult[];
  notices: NoticeResult[];
  note?: string;
  earlier_heading?: string;
}

// One connected session's round calls: `open` is ask_round, `collect`
// collect_last_round.
export type FormsSession = AgentFormSession<AnswersPayload>;

// The `name` of the error `open` rejects with for a malformed call; its
// message is the whole tool error text.
export const ROUND_ERROR_NAME = 'RoundError';

// Round sources (MCP now, the wigley harness next) reach round logic only here.
export type FormsService = AgentFormService<AnswersPayload>;

// One round as the forms page holds it: main's presented form, mapped at the
// channel boundary.
export interface PresentedRound {
  roundId: string;
  // The app's id for the session the round belongs to.
  sessionId: string;
  // `project · heading`, or the heading alone without a project.
  label: string;
  round: Round;
  draft: FormBody | null;
}

export type RoundEnd = AgentFormEnd<FormBody>;

// The layouts the Form tab builds cards with.
export type { LayoutEntry, LayoutSet } from '../../contracts/layouts';

// The agent form channel's rounds, plus: the forms page part invokes `layout`
// on load and `openPreview` from the preview key; main sends the set of
// layouts after each change in a layout's folder. `layout` rejects when the
// layouts failed to start.
export interface FormsChannel extends ChannelShape {
  invoke: AgentFormInvoke<Round, FormBody> & {
    layout(): Promise<LayoutSet>;
    openPreview(): void;
  };
  messages: AgentFormMessages<Round, FormBody> & { layoutChanged: LayoutSet };
}

// The page part's exports and events.

// What the forms page shows: a round's cards, its review, the cancel prompt
// over the review, or no round.
export type FormsView = 'forms' | 'review' | 'confirm' | 'idle';

// A round the forms page holds, as main presented it.
export interface OpenRound {
  roundId: string;
  sessionId: string;
  label: string;
  round: Round;
}

// A question or finding in a round; `index` is 1-based in its kind's array.
export interface FormsItemRef {
  kind: AnswerableKind;
  index: number;
}

// How a round left the page: sent or cancelled by the page's finish, or
// `closed` when main closed it on its own (a disconnect, a host cancel).
export type RoundFinishOutcome = 'submitted' | 'cancelled' | 'closed';

// `roundShown` fires once when a round joins the page, the rounds open at
// page load included; a restored draft emits no `answerChanged`.
// `answerChanged` fires on each change to a question's or finding's answer,
// its notes and reason text included, never for a notice comment or the round
// note; its `status` is the page's, `answered` once the item is responded
// (`isResponded`), notes alone included. `roundFinished` fires once when a
// round leaves the page, for every reason, with the answers it left with.
// `viewChanged` fires when the view or the active round changes. In one store
// change they fire in that order, and a change a listener makes fires its
// events after the change it interrupted.
export interface FormsPageEvents extends EventShape {
  roundShown: OpenRound;
  answerChanged: { roundId: string; item: FormsItemRef; status: AnswerStatus };
  roundFinished: {
    roundId: string;
    sessionId: string;
    outcome: RoundFinishOutcome;
    body: FormBody;
  };
  viewChanged: { view: FormsView; roundId: string | null };
}

// The card a part draws on; `index` is 1-based in its kind's array.
export interface FormsCardPartItem {
  roundId: string;
  kind: ItemKind;
  index: number;
}

// A part another plugin adds to every card of `kinds`. `build` draws into
// `parent`, its own wrapper on the card; `update`, when returned, runs on each
// update of a question or finding card, after the card's own. A part that
// throws is logged and draws nothing; the card still draws.
export interface FormsCardPart {
  id: string;
  kinds: readonly ItemKind[];
  build(parent: HTMLElement, item: FormsCardPartItem): { update?(): void };
}

// A column another plugin adds to every review row: `cell` is the text drawn
// after the row's own cells, read each time the row draws, and `title` shows
// as that cell's tooltip. A column that throws is logged and draws nothing;
// the row still draws.
export interface FormsReviewColumn {
  id: string;
  title: string;
  cell(roundId: string, item: FormsItemRef): string;
}

// `activeRound` is the round the page shows, null with none; `answers` a held
// round's answers as its saved body, null for a round the page does not hold.
// `addCardPart` and `addReviewColumn` throw on an id already added; each
// `Disposable` removes its part or column, and adding or removing one redraws
// every open round, keeping its answers.
export interface FormsPageExports {
  activeRound(): OpenRound | null;
  answers(roundId: string): FormBody | null;
  addCardPart(part: FormsCardPart): Disposable;
  addReviewColumn(column: FormsReviewColumn): Disposable;
}
