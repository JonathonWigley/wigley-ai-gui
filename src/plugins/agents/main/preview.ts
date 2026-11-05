import type { Clock } from '../../../contracts/ambient';
import type { PluginLog } from '../../../contracts/log';
import type { MainChannel } from '../../../contracts/plugin';
import type {
  OwnedSession,
  SessionsMainExports,
} from '../../sessions/contract';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type {
  AgentsChannel,
  Roster,
  RosterAgent,
  RosterTask,
} from '../contract';

// Holds no alerts or window, so the preview cannot raise a notification, a
// Dock bounce or a badge. `clock` dates the sample's starts at open.
export interface AgentsPreviewDeps {
  sessions: Pick<SessionsMainExports, 'open' | 'activate'>;
  clock: Clock;
  send: MainChannel<AgentsChannel>['send'];
  log: PluginLog;
}

// `toggle` opens the preview's row, or ends it while it is open. `rosters` is
// the preview's roster while it is open, `{}` while closed. `closed` ends the
// preview when `sessionId` is its row. `close` sends an open preview's roster
// empty and forgets the preview, leaving its row to whoever ends it; it does
// nothing while closed.
export interface AgentsPreview {
  toggle(): void;
  rosters(): Record<string, Roster>;
  closed(sessionId: string): void;
  close(): void;
}

const PREVIEW_HOST_ID = 'agents-layout-preview';
const PREVIEW_PROJECT_DIR = 'Agents preview';

interface OpenPreview {
  owned: OwnedSession;
  roster: Roster;
}

// The sample session's two running subagents, spawned 42 s and 185 s before
// `now`, the second in the background, and two running tasks, started 95 s and
// 60 s before `now`: one the main agent's, one the 185 s subagent's. The second
// subagent's and the second task's descriptions are long enough to end in an
// ellipsis.
function sampleRoster(now: number): Roster {
  const agents: RosterAgent[] = [
    {
      agentId: 'preview-agent-1',
      agentType: 'wigley:sonnet-medium',
      name: 'map-sessions',
      description: 'Map every caller of the session list',
      startedAt: now - 42_000,
      model: 'claude-sonnet-5-5',
      effort: 'medium',
      spendUsd: 0.0421,
      isBackground: false,
      contextTokens: 84_000,
      contextWindow: 200_000,
      tools: [
        {
          toolUseId: 'preview-agent-1-tool-1',
          tool: 'Read',
          summary: 'src/plugins/sessions/contract.ts',
          outcome: 'running',
        },
      ],
    },
    {
      agentId: 'preview-agent-2',
      agentType: 'Explore',
      name: 'Explore',
      description:
        'Find every adapter behind the Files contract and list what each one writes, so this line ends in an ellipsis',
      startedAt: now - 185_000,
      model: 'claude-haiku-5-5',
      effort: null,
      spendUsd: 0.0187,
      isBackground: true,
      contextTokens: 166_000,
      contextWindow: 200_000,
      tools: Array.from({ length: 12 }, (_, i) => {
        const n = i + 1;
        return {
          toolUseId: `preview-agent-2-tool-${n}`,
          ...(n % 2 === 1
            ? { tool: 'Grep', summary: 'append' }
            : { tool: 'Read', summary: 'src/main/files/node-files.ts' }),
          outcome: n === 12 ? 'running' : 'done',
        };
      }),
    },
  ];
  const tasks: RosterTask[] = [
    {
      taskId: 'preview-task-1',
      agentId: MAIN_AGENT_ID,
      ownerName: 'main',
      description: 'npm run selftest',
      command: 'npm run selftest',
      startedAt: now - 95_000,
    },
    {
      taskId: 'preview-task-2',
      agentId: 'preview-agent-2',
      ownerName: 'Explore',
      description:
        'Watch the stream decoder tests and report each failure as it lands',
      command:
        'npm run test -- --watch src/main/claude-code/stream-decoder.test.ts',
      startedAt: now - 60_000,
    },
  ];
  return { agents, tasks, skills: [] };
}

// A copy of `roster` whose lists the caller may change.
function copyRoster(roster: Roster): Roster {
  return {
    agents: [...roster.agents],
    tasks: [...roster.tasks],
    skills: [...roster.skills],
  };
}

// A sample session in a row of its own, held here with no process, running
// two subagents and two tasks: the first toggle starts the row selected and sends its
// roster; the next ends the row and sends it empty. Closing the row ends it
// too, and the next toggle starts over.
export function createAgentsPreview(deps: AgentsPreviewDeps): AgentsPreview {
  const { sessions, send, log } = deps;
  let preview: OpenPreview | null = null;

  const sendEmptyRoster = (open: OpenPreview) =>
    send('rosterChanged', {
      sessionId: open.owned.session.id,
      roster: { agents: [], tasks: [], skills: [] },
    });

  // Ends the open preview's row and empties its roster.
  const end = (open: OpenPreview) => {
    preview = null;
    open.owned.end();
    sendEmptyRoster(open);
  };

  return {
    toggle() {
      if (preview !== null) {
        end(preview);
        log('agents preview closed');
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
      preview = { owned, roster: sampleRoster(deps.clock.now()) };
      // `select` picks the row; only `activate` shows the sessions mode.
      sessions.activate(owned.session.id);
      send('rosterChanged', {
        sessionId: owned.session.id,
        roster: copyRoster(preview.roster),
      });
      log('agents preview opened');
    },
    rosters: () =>
      preview === null
        ? {}
        : { [preview.owned.session.id]: copyRoster(preview.roster) },
    closed(sessionId) {
      if (preview !== null && preview.owned.session.id === sessionId) {
        end(preview);
      }
    },
    close() {
      if (preview !== null) {
        const open = preview;
        preview = null;
        sendEmptyRoster(open);
      }
    },
  };
}
