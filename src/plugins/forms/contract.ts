import type { ChannelShape } from '../../contracts/plugin';

export type NoticeBadge = 'Applied' | 'Dispatched' | 'Decided';

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

// A validated ask_round call.
export interface Round {
  heading: string;
  overview: string;
  questions: Question[];
  notices: Notice[];
}

// The user's answers as last saved; field names are the saved-round file format.
export interface AnswerEntry {
  index: number;
  choice: number;
  not_applicable: boolean;
  what: string;
  why: string;
  dont_ask: boolean;
  dont_ask_reason: string;
}

export interface NoticeComment {
  index: number;
  comment: string;
}

export interface FormBody {
  note: string;
  answers: AnswerEntry[];
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
  what?: string;
  why?: string;
  dont_ask?: true;
  dont_ask_reason?: string;
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
  notices: NoticeResult[];
  note?: string;
  earlier_heading?: string;
}

// What a round source knows about the session it serves.
export interface SessionInfo {
  sessionId: string | null;
  projectDir: string | null;
  // The host's soft deadline; null means the default.
  deadlineSeconds: number | null;
}

// One connected session; the app keeps at most one open round per session.
export interface FormsSession {
  // `args` is the raw tool input; invalid input rejects with a RoundError message.
  // A call runs only after every earlier call has returned, and a call for a
  // round other than the one the user is answering opens its round only once
  // that round finishes. Its own deadline passing first returns, without a
  // second wait, the open round's draft when that round is its own, or else a
  // draft that opens nothing and names the open round. A new round never
  // closes or replaces an unfinished one.
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
  startSession(info: SessionInfo): FormsSession;
}

// A tool a round source exposes, as MCP `tools/list` describes it.
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// One round as the window shows it.
export interface PresentedRound {
  roundId: string;
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

export const RELAY_PROTOCOL = 1;

// The first line the relay sends, before any MCP message.
export interface RelayHello {
  protocol: number;
  session_id: string | null;
  project_dir: string | null;
  deadline_seconds: number | null;
}

// The app's one-line answer to a hello; MCP follows only after `ok: true`.
export type RelayHelloReply = { ok: true } | { ok: false; error: string };

// `~/.agents/wigley-ai-gui/endpoint.json`.
export interface RelayEndpoint {
  protocol: number;
  // A Unix socket path (macOS) or a named pipe path (Windows).
  channel: string;
  launch: { command: string[]; cwd: string };
}

// The forms page part invokes `openRounds` on load, `draft` as the user types
// and `finish` on submit or cancel; main sends each round as it opens, the id
// of a round that closed without the page, and the id of a round a
// notification click brings forward. A `draft` whose save failed rejects with
// the reason.
export interface FormsChannel extends ChannelShape {
  invoke: {
    openRounds(): PresentedRound[];
    draft(roundId: string, body: FormBody): void;
    finish(roundId: string, end: RoundEnd): void;
  };
  messages: {
    roundShown: PresentedRound;
    roundClosed: string;
    focusRound: string;
  };
}
