import type {
  AccountStatus,
  ChatEntry,
  ProcessActivity,
  SessionControl,
  UserMessage,
} from '../../contracts/agent';
import type { Disposable } from '../../contracts/disposable';
import type { ChannelShape } from '../../contracts/plugin';

export interface ChatProfile {
  name: string;
  configDir: string;
}

export interface RecentFolder {
  projectDir: string;
  profile: string;
  lastUsed: number;
}

export interface StartRequest {
  projectDir: string;
  profile: string;
}

export interface LaunchRequest {
  projectDir: string;
  profile: string;
  message: UserMessage;
}

// `hostSessionId` is the harness's id for the saved session.
export interface PastSessionRow {
  hostSessionId: string;
  title: string;
  modified: number;
  archived: boolean;
}

export interface ResumeRequest {
  projectDir: string;
  profile: string;
  hostSessionId: string;
}

// `sessionId` is the sessions plugin's id for the row. A session's row lasts
// until the user closes it, across a relaunch, where it comes back resting
// with its earlier conversation read again; a closed session's state is
// dropped at once.
export interface ChatSessionState {
  sessionId: string;
  projectDir: string;
  profile: string;
  entries: ChatEntry[];
  controls: SessionControl[];
  activity: ProcessActivity;
  // The session's slash commands and skills, as typed after `/`; [] until the
  // harness reports them.
  commands: string[];
  // True while the session's process runs; false while it rests, with no
  // process yet or its process exited.
  running: boolean;
}

export interface PermissionAnswer {
  allowed: boolean;
  reason: string | null;
}

export interface ChatChannel extends ChannelShape {
  invoke: {
    // Sent once on each page load; cancels any running sign-in, since the page
    // that started it is gone.
    loaded(): void;
    // Every session chat holds.
    sessions(): ChatSessionState[];
    // Newest first: the folders chat started sessions in merged with every
    // folder each profile's harness saved sessions in, one per folder, missing
    // folders and those in the OS's temp folders left out.
    recentFolders(): Promise<RecentFolder[]>;
    chooseFolder(): Promise<string | null>;
    // The new row's sessionId.
    start(request: StartRequest): string;
    // Newest first; a session open in the app on a row chat does not hold is
    // left out, and one with a chat row is listed.
    pastSessions(
      projectDir: string,
      profile: string,
    ): Promise<PastSessionRow[]>;
    setArchived(hostSessionId: string, archived: boolean): Promise<void>;
    // Resolves to the new row's sessionId; a session with a chat row selects
    // that row and resolves to its sessionId, and one open in the app on any
    // other row rejects.
    resume(request: ResumeRequest): Promise<string>;
    // Starts a resting session's process first; rejects, leaving it resting,
    // when its profile is missing or the start fails. A restored session's
    // earlier conversation still pending is read first, arriving as
    // `entries`.
    send(sessionId: string, message: UserMessage): Promise<void>;
    // Reads a restored session's earlier conversation, arriving as `entries`.
    // While its profile is missing a call reads nothing and a later call
    // tries again; once read, or for a session with none pending, a call does
    // nothing.
    loadHistory(sessionId: string): Promise<void>;
    // Adds a notice entry to the session's chat, kept across a page reload.
    notice(sessionId: string, text: string, tone: 'info' | 'error'): void;
    accountStatus(profile: string): Promise<AccountStatus>;
    // Starts sign-in `id` to the profile; throws while any sign-in runs. The
    // page picks `id`, unique within its load, since the sign-in's messages
    // can arrive before this call answers. Its link arrives as `logInLink`
    // and its end as `logInEnded`, each carrying `id`; a cancelled sign-in
    // sends neither.
    logIn(id: number, profile: string): void;
    // The code the sign-in page showed, for sign-in `id`; ignored when `id`
    // is not the running sign-in.
    logInCode(id: number, code: string): void;
    // Cancels sign-in `id`, so another may start at once; ignored when `id`
    // is not the running sign-in.
    cancelLogIn(id: number): void;
    logOut(profile: string): Promise<void>;
    interrupt(sessionId: string): void;
    setControl(sessionId: string, controlId: string, value: string): void;
    answerPermission(
      sessionId: string,
      entryId: string,
      answer: PermissionAnswer,
    ): void;
    // Opens the layout preview's sample session and selects its row, or
    // selects the row of the one already open.
    openPreview(): void;
  };
  messages: {
    sessionStarted: ChatSessionState;
    entry: { sessionId: string; entry: ChatEntry };
    controls: { sessionId: string; controls: SessionControl[] };
    activity: { sessionId: string; activity: ProcessActivity };
    commands: { sessionId: string; names: string[] };
    // Replaces the session's whole entry list, as when restored history
    // arrives.
    entries: { sessionId: string; entries: ChatEntry[] };
    // The session's process started, for every start.
    sessionRunning: { sessionId: string };
    // A started process exited, and its row rests until the user closes it.
    sessionRested: { sessionId: string; error: string | null };
    // The page the user opens to finish sign-in `id`.
    logInLink: { id: number; profile: string; url: string };
    // `status` is null when the status could not be read; `error` is null
    // only for a finished sign-in, and a failed one may still read signed in
    // (a wrong code on a signed-in profile).
    logInEnded: {
      id: number;
      profile: string;
      status: AccountStatus | null;
      error: string | null;
    };
  };
}

// The main part's exports.
export interface ChatMainExports {
  // Starts a session and sends `message` as its first message; leaves the
  // selected row as it was. Resolves to the new row's sessionId; rejects,
  // opening nothing, on an image chat refuses (with the refusal text), an
  // unknown profile, or no chat harness.
  launch(request: LaunchRequest): Promise<string>;
  // Chat's profile names, in settings order.
  profileNames(): string[];
  // The profile of a session chat owns; null for any other session id.
  profileOf(sessionId: string): string | null;
}

// The session an app slash command was sent in: `args` is the trimmed text
// after the name, '' when none. A resting session takes notices.
export interface SlashCommandContext {
  sessionId: string;
  profile: string;
  args: string;
}

// A `/name` the app runs itself in place of sending it to the agent. `name`
// has no leading `/` and no whitespace; a registered name wins over the
// agent's command of the same name.
export interface AppSlashCommand {
  name: string;
  description: string;
  run(context: SlashCommandContext): Promise<void> | void;
}

// The page part's exports. `addSlashCommand` registers an app slash command
// until its `dispose`, and throws when the name is already registered.
export interface ChatPageExports {
  addSlashCommand(command: AppSlashCommand): Disposable;
}
