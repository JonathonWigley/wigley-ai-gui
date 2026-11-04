import type { ChatEntry } from '../../../../contracts/agent';
import type { Clock } from '../../../../contracts/ambient';
import type { Log } from '../../../../contracts/log';
import type { MainChannel } from '../../../../contracts/plugin';
import type {
  OwnedSession,
  SessionsMainExports,
} from '../../../sessions/contract';
import {
  CHAT_PREVIEW_HOST_ID,
  type ChatAgentEvent,
  type ChatChannel,
  type ChatSessionState,
} from '../../contract';
import { previewAgentEvents } from './preview-agent-events';
import {
  PREVIEW_PROFILE,
  PREVIEW_PROJECT_DIR,
  previewControls,
  previewEntries,
} from './preview-session';

// Holds no alerts, window or mark, so the preview cannot raise a
// notification, a Dock bounce, a badge or an attention mark. `clock` stamps
// the `at` of each notice the preview adds and dates the sample's agent
// events. `emit` publishes chat's `agentEvent`.
export interface ChatPreviewDeps {
  sessions: Pick<SessionsMainExports, 'open' | 'activate'>;
  send: MainChannel<ChatChannel>['send'];
  emit: (event: 'agentEvent', data: ChatAgentEvent) => void;
  log: Log;
  clock: Clock;
}

export interface ChatPreview {
  open(): void;
  holds(sessionId: string): boolean;
  // The preview's state while it is open; [] while closed.
  states(): ChatSessionState[];
  // Adds a notice entry to the open preview's chat; throws while it is closed.
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
// first open starts the row selected, draws the sample and emits its sample
// agent events, under the preview's host session id with no profile folder,
// so the views of subagents and tasks draw them; an open while it shows
// selects its row only. It sends nothing, changes no control, and is
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
          sessionId: CHAT_PREVIEW_HOST_ID,
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
        background: 0,
        activeTime: { totalMs: 185_000, since: null },
        commands: [],
        running: true,
        queued: [],
        returned: [],
        repo: PREVIEW_PROJECT_DIR,
        branch: 'main',
      };
      preview = { owned, state, noticeCount: 0 };
      // `select` picks the row; only `activate` shows the sessions mode.
      sessions.activate(state.sessionId);
      send('sessionStarted', { ...state });
      for (const event of previewAgentEvents(deps.clock.now())) {
        deps.emit('agentEvent', {
          sessionId: state.sessionId,
          profileDir: null,
          hostSessionId: CHAT_PREVIEW_HOST_ID,
          event,
          replayed: false,
        });
      }
      log('chat', 'chat preview opened');
    },
    holds: (sessionId) => preview?.state.sessionId === sessionId,
    states: () => (preview === null ? [] : [{ ...preview.state }]),
    notice(text, tone) {
      const shown = preview!;
      shown.noticeCount += 1;
      const entry: ChatEntry = {
        kind: 'notice',
        id: `preview-app-notice-${shown.noticeCount}`,
        at: deps.clock.now(),
        text,
        tone,
        raw: [],
      };
      shown.state.entries = [...shown.state.entries, entry];
      send('entry', { sessionId: shown.state.sessionId, entry });
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
