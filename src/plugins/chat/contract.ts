import type {
  ChatEntry,
  ProcessActivity,
  SessionControl,
} from '../../contracts/agent';
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

// `sessionId` is the sessions plugin's id for the row; an ended session's
// state is dropped at once.
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
}

export interface PermissionAnswer {
  allowed: boolean;
  reason: string | null;
}

export interface ChatChannel extends ChannelShape {
  invoke: {
    sessions(): ChatSessionState[];
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
    send(sessionId: string, text: string): void;
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
    sessionEnded: { sessionId: string; error: string | null };
    layoutChanged: LayoutChoice;
  };
}
