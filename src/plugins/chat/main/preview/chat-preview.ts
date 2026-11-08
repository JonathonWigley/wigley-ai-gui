import type { Clock } from '../../../../contracts/ambient';
import type { PluginLog } from '../../../../contracts/log';
import type {
  OwnedSession,
  SessionsMainExports,
} from '../../../sessions/contract';
import { CHAT_PREVIEW_HOST_ID, type ChatAgentEvent } from '../../contract';
import type { ChatSlots, SessionSlots } from '../chat-slots';
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
  slots: ChatSlots;
  emit: (event: 'agentEvent', data: ChatAgentEvent) => void;
  log: PluginLog;
  clock: Clock;
}

export interface ChatPreview {
  open(): void;
  holds(sessionId: string): boolean;
  // Adds a notice entry to the open preview's chat; throws while it is closed.
  notice(text: string, tone: 'info' | 'error'): void;
  closed(sessionId: string): void;
}

interface OpenPreview {
  owned: OwnedSession;
  slots: SessionSlots;
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
  const { sessions, log } = deps;
  let preview: OpenPreview | null = null;

  return {
    open() {
      if (preview !== null) {
        sessions.activate(preview.slots.sessionId);
        log('chat preview shown');
        return;
      }
      const owned = sessions.open(
        {
          sessionId: CHAT_PREVIEW_HOST_ID,
          projectDir: PREVIEW_PROJECT_DIR,
          harness: null,
        },
        { select: true },
      );
      const sessionId = owned.session.id;
      // `select` picks the row; only `activate` shows the sessions mode.
      sessions.activate(sessionId);
      const slots = deps.slots.open({
        sessionId,
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
        compaction: null,
        returned: [],
        repo: PREVIEW_PROJECT_DIR,
        branch: 'main',
        worktrees: ['app-session-facts'],
      });
      preview = { owned, slots, noticeCount: 0 };
      for (const event of previewAgentEvents(deps.clock.now())) {
        deps.emit('agentEvent', {
          sessionId,
          profileDir: null,
          hostSessionId: CHAT_PREVIEW_HOST_ID,
          event,
          replayed: false,
        });
      }
      log('chat preview opened');
    },
    holds: (sessionId) => preview?.slots.sessionId === sessionId,
    notice(text, tone) {
      const shown = preview!;
      shown.noticeCount += 1;
      shown.slots.putEntry({
        kind: 'notice',
        id: `preview-app-notice-${shown.noticeCount}`,
        at: deps.clock.now(),
        text,
        tone,
        raw: [],
      });
    },
    closed(sessionId) {
      if (preview === null || preview.slots.sessionId !== sessionId) {
        return;
      }
      const { owned, slots } = preview;
      preview = null;
      slots.close();
      owned.end();
    },
  };
}
