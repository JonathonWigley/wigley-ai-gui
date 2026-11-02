import type { Clock } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import type { MainChannel } from '../../../contracts/plugin';
import type {
  OwnedSession,
  SessionsMainExports,
} from '../../sessions/contract';
import type { AgentsChannel, RunningAgent } from '../contract';

// Holds no alerts or window, so the preview cannot raise a notification, a
// Dock bounce or a badge. `clock` dates the sample's spawns at open.
export interface AgentsPreviewDeps {
  sessions: Pick<SessionsMainExports, 'open' | 'activate'>;
  clock: Clock;
  send: MainChannel<AgentsChannel>['send'];
  log: Log;
}

// `toggle` opens the preview's row, or ends it while it is open. `rosters` is
// the preview's roster while it is open, `{}` while closed. `closed` ends the
// preview when `sessionId` is its row.
export interface AgentsPreview {
  toggle(): void;
  rosters(): Record<string, RunningAgent[]>;
  closed(sessionId: string): void;
}

const PREVIEW_HOST_ID = 'agents-layout-preview';
const PREVIEW_PROJECT_DIR = 'Agents preview';

interface OpenPreview {
  owned: OwnedSession;
  running: RunningAgent[];
}

// The sample session's two running subagents, spawned 42 s and 185 s before
// `now`; the second's description is long enough to end in an ellipsis. The
// second is the widest line the agents self-test fits at the side bar's least
// width, so its elapsed time stays past a minute and its tool count past 9.
function sampleRoster(now: number): RunningAgent[] {
  return [
    {
      agentId: 'preview-agent-1',
      agentType: 'wigley:sonnet-medium',
      description: 'Map every caller of the session list',
      startedAt: now - 42_000,
      toolCalls: 1,
    },
    {
      agentId: 'preview-agent-2',
      agentType: 'Explore',
      description:
        'Find every adapter behind the Files contract and list what each one writes, so this line ends in an ellipsis',
      startedAt: now - 185_000,
      toolCalls: 12,
    },
  ];
}

// A sample session in a row of its own, held here with no process, running
// two subagents: the first toggle starts the row selected and sends its
// roster; the next ends the row and sends it empty. Closing the row ends it
// too, and the next toggle starts over.
export function createAgentsPreview(deps: AgentsPreviewDeps): AgentsPreview {
  const { sessions, send, log } = deps;
  let preview: OpenPreview | null = null;

  // Ends the open preview's row and empties its roster.
  const end = (open: OpenPreview) => {
    preview = null;
    open.owned.end();
    send('rosterChanged', { sessionId: open.owned.session.id, running: [] });
  };

  return {
    toggle() {
      if (preview !== null) {
        end(preview);
        log('agents', 'agents preview closed');
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
      preview = { owned, running: sampleRoster(deps.clock.now()) };
      // `select` picks the row; only `activate` shows the sessions mode.
      sessions.activate(owned.session.id);
      send('rosterChanged', {
        sessionId: owned.session.id,
        running: [...preview.running],
      });
      log('agents', 'agents preview opened');
    },
    rosters: () =>
      preview === null
        ? {}
        : { [preview.owned.session.id]: [...preview.running] },
    closed(sessionId) {
      if (preview !== null && preview.owned.session.id === sessionId) {
        end(preview);
      }
    },
  };
}
