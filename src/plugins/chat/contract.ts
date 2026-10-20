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

// `sessionId` is the sessions plugin's id for the row; an ended session's
// state is dropped at once.
export interface ChatSessionState {
  sessionId: string;
  projectDir: string;
  profile: string;
  entries: ChatEntry[];
  controls: SessionControl[];
  activity: ProcessActivity;
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
    // The home folder, which the start prompt shows as `~`.
    homeDir(): string;
    // The new row's sessionId.
    start(request: StartRequest): string;
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
    sessionEnded: { sessionId: string; error: string | null };
    layoutChanged: LayoutChoice;
  };
}
