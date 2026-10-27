import type { ChatEntry } from '../../../../contracts/agent';
import type { Log } from '../../../../contracts/log';
import type { MainChannel } from '../../../../contracts/plugin';
import type {
  OwnedSession,
  SessionsMainExports,
} from '../../../sessions/contract';
import type { ChatChannel, ChatSessionState } from '../../contract';
import {
  PREVIEW_HOST_ID,
  PREVIEW_PROFILE,
  PREVIEW_PROJECT_DIR,
  previewControls,
  previewEntries,
} from './preview-session';

// Holds no alerts, window or mark, so the preview cannot raise a
// notification, a Dock bounce, a badge or an attention mark.
export interface ChatPreviewDeps {
  sessions: Pick<SessionsMainExports, 'open' | 'activate'>;
  send: MainChannel<ChatChannel>['send'];
  log: Log;
}

export interface ChatPreview {
  open(): void;
  holds(sessionId: string): boolean;
  // The preview's state while it is open; [] while closed.
  states(): ChatSessionState[];
  send(): Promise<void>; // always rejects
  setControl(): void; // always throws
  notice(text: string, tone: 'info' | 'error'): void;
  closed(sessionId: string): void;
}

// `state.entries` is replaced on each change, never changed in place, so a
// shallow copy of `state` is a snapshot.
interface OpenPreview {
  owned: OwnedSession;
  state: ChatSessionState;
  noticeCount: number;
}

// The sample chat session in a row of its own, held here with no process: the
// first open starts the row selected and draws the sample; an open while it
// shows selects its row only. It sends nothing, changes no control, and is
// never saved, so a relaunch has no preview row. Closing the row ends it, and
// the next open starts over.
export function createChatPreview(deps: ChatPreviewDeps): ChatPreview {
  const { sessions, send, log } = deps;
  let preview: OpenPreview | null = null;

  return {
    open() {
      if (preview !== null) {
        sessions.activate(preview.state.sessionId);
        log('chat', 'chat preview shown');
        return;
      }
      const owned = sessions.open(
        {
          sessionId: PREVIEW_HOST_ID,
          projectDir: PREVIEW_PROJECT_DIR,
          deadlineSeconds: null,
          harness: null,
        },
        { select: true },
      );
      const state: ChatSessionState = {
        sessionId: owned.session.id,
        projectDir: PREVIEW_PROJECT_DIR,
        profile: PREVIEW_PROFILE,
        entries: previewEntries(),
        controls: previewControls(),
        activity: 'idle',
        commands: [],
        running: true,
      };
      preview = { owned, state, noticeCount: 0 };
      sessions.activate(state.sessionId);
      send('sessionStarted', { ...state });
      log('chat', 'chat preview opened');
    },
    holds: (sessionId) => preview?.state.sessionId === sessionId,
    states: () => (preview === null ? [] : [{ ...preview.state }]),
    send: () => Promise.reject(new Error('the chat preview sends nothing')),
    setControl() {
      throw new Error('the chat preview changes no control');
    },
    notice(text, tone) {
      if (preview === null) {
        log('chat', 'notice for the closed chat preview ignored');
        return;
      }
      preview.noticeCount += 1;
      const entry: ChatEntry = {
        kind: 'notice',
        id: `preview-app-notice-${preview.noticeCount}`,
        text,
        tone,
        raw: [],
      };
      preview.state.entries = [...preview.state.entries, entry];
      send('entry', { sessionId: preview.state.sessionId, entry });
    },
    closed(sessionId) {
      if (preview === null || preview.state.sessionId !== sessionId) {
        return;
      }
      const { owned } = preview;
      preview = null;
      owned.end();
    },
  };
}
