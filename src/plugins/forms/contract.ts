import type { ChannelShape } from '../../contracts/plugin';
import type { AgentSession } from '../sessions/contract';

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
}

export interface Notice {
  title: string;
  context: string;
  badge: NoticeBadge;
}

export interface FindingChoice {
  text: string;
  reason: string;
}

// What the user does with a finding, picked apart from its solution.
export type FindingAction = 'fix_now' | 'follow_up' | 'leave_it';

// In the order the action control draws them.
export const FINDING_ACTIONS: readonly FindingAction[] = [
  'fix_now',
  'follow_up',
  'leave_it',
];

// The most choices a question or finding may offer.
export const MAX_CHOICES = 10;

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
  // 1-based.
  recommend: number;
  recommend_action: FindingAction;
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

// `choice` is the solution, kept while the action is 'leave_it'; '' is no
// action.
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

// `choice`, `choice_text` and `took_recommendation` describe the solution
// alone; `action` is '' unless the finding is answered.
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

// One connected session; the app keeps at most one open round per session.
export interface FormsSession {
  // `args` is the raw tool input; invalid input rejects with a RoundError message.
  // A call runs only after every earlier call has returned, and a call for a
  // round other than the one the user is answering opens its round only once
  // that round finishes. Its own deadline passing first returns, without a
  // second wait, the open round's draft when that round is its own, or else a
  // draft that opens nothing and names the open round. A new round never
  // closes or replaces an unfinished one. A call that waits on its round, in
  // ask_round or collect_last_round, and that the host cancels when no other
  // call waits on that round, closes the unfinished round in the window as end
  // does, so the session's next round shows; a re-send of that round queued
  // behind the call counts as waiting on it.
  askRound(
    args: unknown,
    toolUseId: string | null,
    signal: AbortSignal,
  ): Promise<AnswersPayload>;
  collectLastRound(wait: boolean, signal: AbortSignal): Promise<AnswersPayload>;
  // The session disconnected: its open round closes and calls still waiting to
  // open one reject; answers stay saved.
  end(): void;
}

// The `name` of the error askRound rejects with for a malformed call; its
// message is the whole tool error text.
export const ROUND_ERROR_NAME = 'RoundError';

// Round sources (MCP now, the wigley harness next) reach round logic only here.
export interface FormsService {
  startSession(session: AgentSession): FormsSession;
}

// One round as the window shows it.
export interface PresentedRound {
  roundId: string;
  // The app's id for the session the round belongs to.
  sessionId: string;
  // `project · heading`, or the heading alone without a project.
  label: string;
  round: Round;
  draft: FormBody | null;
}

export type RoundEnd = { kind: 'submitted' | 'cancelled'; body: FormBody };

export interface RoundListener {
  // Throws an Error with the reason when the draft could not be saved; a round
  // no longer open ignores the draft.
  draft(body: FormBody): void;
  finish(end: RoundEnd): void;
}

// Where open rounds are shown and answered: the window, or a script in tests.
export interface RoundPresenter {
  show(round: PresentedRound, listener: RoundListener): void;
  close(roundId: string): void;
}

// The layout the Form tab builds cards with. `revision` grows on every change
// to a layout's files and every switch, so a URL holding it loads fresh
// modules; `builtIn` marks the `default` layout, which has no files in forms'
// data folder.
export interface LayoutChoice {
  name: string;
  revision: number;
  hasCss: boolean;
  builtIn: boolean;
  reason: 'start' | 'cycled' | 'reloaded' | 'copied';
}

// The forms page part invokes `openRounds` and `layout` on load, `draft` as
// the user types, `finish` on submit or cancel, and `cycleLayout`,
// `copyLayout` and `openPreview` from the layout keys; main sends each round
// as it opens, the id of a round that closed without the page, and each layout
// change, the page's own cycles and copies included. A `draft` whose save
// failed rejects with the reason; `layout` rejects when the layouts failed to
// start.
export interface FormsChannel extends ChannelShape {
  invoke: {
    openRounds(): PresentedRound[];
    draft(roundId: string, body: FormBody): void;
    finish(roundId: string, end: RoundEnd): void;
    layout(): Promise<LayoutChoice>;
    cycleLayout(step: 1 | -1): Promise<LayoutChoice>;
    copyLayout(): Promise<LayoutChoice>;
    openPreview(): void;
  };
  messages: {
    roundShown: PresentedRound;
    roundClosed: string;
    layoutChanged: LayoutChoice;
  };
}
