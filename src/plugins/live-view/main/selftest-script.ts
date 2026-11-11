import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { escapeRegExp } from '../../../shared/escape-reg-exp';
import {
  FAKE_EDITOR_PROCESS_ID,
  FAKE_GAME_RECT,
} from '../../../shared/fake-screen-capture';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports, ToolResult } from '../../sessions/contract';
import type { LiveTools } from './live-tools';

// The self-test's Unity project folder, made under the self-test's home. Its
// name names the session in every page line and the stream's summary.
const SELFTEST_PROJECT_NAME = 'selftest-unity';

const STREAMING_LINE = `[live-view] streaming Game View · ${SELFTEST_PROJECT_NAME} in ${SELFTEST_PROJECT_NAME}`;

export interface LiveViewSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath' | 'write'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
  show: LiveTools['show'];
}

const HUB_KEYS = [' ', 'b', 'h'];

const GROUPS: SelfTestGroup[] = [
  {
    name: 'live section',
    why: "The agent's show_live_view streams the fake editor's Game View into the session hub's Live section, which streams only while it is on screen.",
    steps: [
      {
        width: 1200,
        keys: HUB_KEYS,
        expect: `[live-view] stream stopped in ${SELFTEST_PROJECT_NAME}`,
        checksFit: 'held',
        why: 'A hidden hub stops the capture.',
      },
      {
        keys: HUB_KEYS,
        expect: STREAMING_LINE,
        checksFit: 'held',
        screenshot: 'live-section',
        why: 'The hub shows only in a Chat tab at least 640px wide; the screenshot shows the cropped portrait sample fitting the hub.',
      },
      {
        keys: [' ', 'z', 'l', 'c'],
        expect: '[chat] Chat tab shown in Chat preview',
        checksFit: 'held',
        screenshot: 'crowded-hub',
        why: 'Live keeps its frame while the other sections give up height.',
      },
    ],
  },
];

// Each run closes an earlier run's rows, launches a new chat session in a
// project folder whose `Library/EditorInstance.json` names the fake editor's
// pid, and shows Live there as the agent's `show_live_view` would, with the
// fake Game View's rect. The first stream starts before any step begins, so
// `open` waits for its line.
export function liveViewSelfTestScript(
  deps: LiveViewSelfTestDeps,
): SelfTestScript {
  const { homeDir, files, paths, chat, sessions, show } = deps;
  let made: Promise<string> | null = null;

  async function makeProject(): Promise<string> {
    const projectDir = paths.join(
      await files.realPath(homeDir),
      SELFTEST_PROJECT_NAME,
    );
    const libraryDir = paths.join(projectDir, 'Library');
    await files.makeFolder(libraryDir);
    await files.write(
      paths.join(libraryDir, 'EditorInstance.json'),
      JSON.stringify({ process_id: FAKE_EDITOR_PROCESS_ID }),
    );
    return projectDir;
  }

  return {
    pageBinds: [],
    settings: {},
    // A skill's name, a context source's and a project group's end in an
    // ellipsis in their row, as their CSS says: the preview's hub shows Skills
    // and Context beside Live. So do the activity dock's tool calls and its
    // done line; the tab bar's parts and the dock's one line clip in their own
    // box. Live's own notice wraps.
    scrollsItself: [
      '.agent-skills-name',
      '.context-sources-name',
      '.session-group-name',
      '.session-bar-parts',
      '.chat-working-action',
      '.chat-working-line',
      '.chat-working-done',
    ],
    open() {
      made ??= makeProject().catch((error: unknown) => {
        made = null;
        throw error;
      });
      const result = made.then(async (projectDir) => {
        await chat.closeSessionsIn(projectDir);
        const sessionId = await chat.launch({
          projectDir,
          profile: 'work',
          message: { text: 'live-view self-test', images: [] },
        });
        sessions.activate(sessionId);
        return show(sessionId, {
          projectPath: projectDir,
          gameRect: FAKE_GAME_RECT,
        });
      });
      return {
        shownLine: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        alsoShown: [new RegExp(`^${escapeRegExp(STREAMING_LINE)}$`)],
        result,
      };
    },
    groups: GROUPS,
    problems: (result) => {
      const shown = result as ToolResult;
      return shown.isError === true
        ? [`show_live_view failed: ${shown.content[0]?.text ?? ''}`]
        : [];
    },
  };
}
