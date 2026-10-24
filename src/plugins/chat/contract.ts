import type {
  AccountStatus,
  ChatEntry,
  ProcessActivity,
  SessionControl,
  UserMessage,
} from '../../contracts/agent';
import type { Disposable } from '../../contracts/disposable';
import type { LayoutChoice } from '../../contracts/layouts';
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

// `sessionId` is the sessions plugin's id for the row. A session whose process
// ended on its own stays, `ended` true, until the user closes its row; a
// closed session's state is dropped at once.
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
  ended: boolean;
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
    // Newest first; a session open in the app is left out.
    pastSessions(
      projectDir: string,
      profile: string,
    ): Promise<PastSessionRow[]>;
    setArchived(hostSessionId: string, archived: boolean): Promise<void>;
    // Resolves to the new row's sessionId.
    resume(request: ResumeRequest): Promise<string>;
    send(sessionId: string, message: UserMessage): void;
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
    layout(): Promise<LayoutChoice>;
    cycleLayout(step: 1 | -1): Promise<LayoutChoice>;
    copyLayout(): Promise<LayoutChoice>;
  };
  messages: {
    sessionStarted: ChatSessionState;
    entry: { sessionId: string; entry: ChatEntry };
    controls: { sessionId: string; controls: SessionControl[] };
    activity: { sessionId: string; activity: ProcessActivity };
    commands: { sessionId: string; names: string[] };
    // The session's process ended or failed to start; one that ended on its
    // own keeps its row until the user closes it.
    sessionEnded: { sessionId: string; error: string | null };
    layoutChanged: LayoutChoice;
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

// The session an app slash command was sent in: `args` is the trimmed text
// after the name, '' when none; `ended` is true when the session's agent
// process has ended, where main takes no new entries and a notice shows
// nowhere.
export interface SlashCommandContext {
  sessionId: string;
  profile: string;
  args: string;
  ended: boolean;
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
