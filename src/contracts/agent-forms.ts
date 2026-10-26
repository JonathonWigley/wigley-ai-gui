import type { ChannelShape } from './plugin';

// The shapes every agent form type shares: forms' rounds, the feature primer.
// The owner and sessions types are structural, so the sessions plugin's
// `AgentSession` and main exports satisfy them.

// What a form source knows about the session it serves.
export interface AgentFormOwnerInfo {
  sessionId: string | null;
  projectDir: string | null;
  // The host's soft deadline; null means the default.
  deadlineSeconds: number | null;
}

// `id` is the app's own id for the session; `info.sessionId` is the host's.
export interface AgentFormOwner {
  id: string;
  info: AgentFormOwnerInfo;
}

export type AgentFormEndKind = 'submitted' | 'cancelled';

export interface AgentFormEnd<Body> {
  kind: AgentFormEndKind;
  body: Body;
}

// One form as the window shows it.
export interface PresentedAgentForm<Form, Body> {
  formId: string;
  // The app's id for the session the form belongs to.
  sessionId: string;
  // `project · heading`, or the heading alone without a project.
  label: string;
  form: Form;
  draft: Body | null;
}

export interface AgentFormListener<Body> {
  // Throws an Error with the reason when the draft could not be saved; a form
  // no longer open ignores the draft.
  draft(body: Body): void;
  // Throws an Error with the reason when the answers cannot be read; the form
  // then stays open.
  finish(end: AgentFormEnd<Body>): void;
}

// Where open forms are shown and answered: the window, or a script in tests.
export interface AgentFormPresenter<Form, Body> {
  show(
    form: PresentedAgentForm<Form, Body>,
    listener: AgentFormListener<Body>,
  ): void;
  close(formId: string): void;
}

// A form that left the window. `byFinish` is true when the page's `finish`
// for the form closed it, false when main closed it on its own.
export interface AgentFormClosed {
  formId: string;
  byFinish: boolean;
}

// Type aliases, not interfaces: ChannelShape needs index signatures an interface lacks.
export type AgentFormInvoke<Form, Body> = {
  openForms(): PresentedAgentForm<Form, Body>[];
  draft(formId: string, body: Body): void;
  finish(formId: string, end: AgentFormEnd<Body>): void;
};
export type AgentFormMessages<Form, Body> = {
  formShown: PresentedAgentForm<Form, Body>;
  formClosed: AgentFormClosed;
};

// The page part invokes `openForms` on load, `draft` as the user types and
// `finish` on submit or cancel; main sends each form as it opens and each form
// that closes, a form the page finished included. A `draft` whose save failed
// rejects with the reason; a `finish` whose answers main could not take
// rejects with the reason and leaves the form open.
export interface AgentFormChannel<Form, Body> extends ChannelShape {
  invoke: AgentFormInvoke<Form, Body>;
  messages: AgentFormMessages<Form, Body>;
}

// One connected session; the app keeps at most one open form of a type per
// session.
export interface AgentFormSession<Payload> {
  // `args` is the raw tool input; invalid input rejects with the type's args
  // error message. A call runs only after every earlier call has returned, and
  // a call for a form other than the one the user is answering opens its form
  // only once that form finishes. Its own deadline passing first returns,
  // without a second wait, the open form's draft when that form is its own, or
  // else a draft that opens nothing and names the open form. A new form never
  // closes or replaces an unfinished one. A call that waits on its form, in the
  // open tool or the collect tool, and that the host cancels when no other call
  // waits on that form, closes the unfinished form in the window as end does,
  // so the session's next form shows; a re-send of that form queued behind the
  // call counts as waiting on it.
  open(
    args: unknown,
    toolUseId: string | null,
    signal: AbortSignal,
  ): Promise<Payload>;
  collect(wait: boolean, signal: AbortSignal): Promise<Payload>;
  // The session disconnected: its open form closes and calls still waiting to
  // open one reject; answers stay saved.
  end(): void;
}

// Form sources (MCP now, the wigley harness next) reach form logic only here.
export interface AgentFormService<Payload> {
  startSession(owner: AgentFormOwner): AgentFormSession<Payload>;
}

// What one kind of agent form supplies to the shared service.
export interface AgentFormType<Form, Body, Payload> {
  // The tool names the service's texts name.
  openTool: string;
  collectTool: string;
  // The word for one form in texts and logs: 'round', 'primer'.
  noun: string;
  // The `name` of the Error `parse` throws for a malformed call; the tool session returns its message as the tool error.
  argsErrorName: string;
  parse(args: unknown): Form;
  fingerprint(form: Form): string;
  heading(form: Form): string;
  // The heading in a saved form's raw args, or null when they hold none.
  savedHeading(args: unknown): string | null;
  // Never throws: a missing or malformed field keeps the form's own value.
  readBody(form: Form, raw: unknown): Body;
  // A new form's draft from the newest saved body with its fingerprint; `finished` is true when that save finished.
  prefill(form: Form, saved: Body, finished: boolean): Body;
  payload(form: Form, outcome: AgentFormEndKind | 'draft', body: Body): Payload;
  handedBackPayload(form: Form, outcome: AgentFormEndKind, body: Body): Payload;
  noFormPayload(): Payload;
  notShownPayload(form: Form, blockingHeading: string | null): Payload;
}

// The parts of the sessions plugin's main exports a presenter uses.
export interface AgentFormSessions {
  mark(sessionId: string): void;
  activate(sessionId: string): void;
  addCloseGuard(mayClose: (sessionId: string) => boolean): void;
}

// The sessions contract's ToolResult and ToolSession, restated: the contracts layer imports no plugin.
export interface AgentFormToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

// `toolUseId` is the host's id for the calling tool use, when it sent one.
export interface AgentFormToolSession {
  call(
    name: string,
    args: unknown,
    context: { toolUseId: string | null; signal: AbortSignal },
  ): Promise<AgentFormToolResult>;
  end(): void;
}
