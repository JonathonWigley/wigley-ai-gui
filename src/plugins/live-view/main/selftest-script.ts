import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { KeyedSlotReader } from '../../../contracts/state';
import { FAKE_PLAYTEST_TEXT } from '../../../shared/fake-agent-harness';
import {
  FAKE_EDITOR_PROCESS_ID,
  FAKE_GAME_RECT,
} from '../../../shared/fake-screen-capture';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports, ToolResult } from '../../sessions/contract';
import type { LivePick } from '../contract';
import type { LiveTools } from './live-tools';

// The self-test's Unity project folder, made under the self-test's home. Its
// name names the session in every page line and the stream's summary.
const SELFTEST_PROJECT_NAME = 'selftest-unity';

const STREAMING_LINE = `[live-view] streaming Game View · ${SELFTEST_PROJECT_NAME} in ${SELFTEST_PROJECT_NAME}`;

// The summary of the whole-editor pick the app opens on the playtest command.
const PLAYTEST_PICK_SUMMARY = `Editor · ${SELFTEST_PROJECT_NAME}`;

const PLAYTEST_PICK_WAIT_MS = 10_000;

export interface LiveViewSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath' | 'write'>;
  paths: Paths;
  chat: Pick<ChatMainExports, 'launch' | 'closeSessionsIn'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
  show: LiveTools['show'];
  picks: Pick<KeyedSlotReader<LivePick>, 'get' | 'on'>;
}

// The pick the playtest command opened, as the wait first saw it, or null when
// none came; then the agent's `show_live_view` result.
interface LiveViewSelfTestResult {
  playtestPick: LivePick | null;
  shown: ToolResult;
}

const HUB_KEYS = [' ', 'b', 'h'];

const GROUPS: SelfTestGroup[] = [
  {
    name: 'live section',
    why: "The session's playtest command opens Live on the whole editor by itself (the script's result checks it); the agent's show_live_view then streams the fake editor's Game View into the session hub's Live section, which streams only while it is on screen.",
    steps: [
      {
        width: 1200,
        keys: [],
        expect: STREAMING_LINE,
        checksFit: 'held',
        why: 'The hub shows only in a Chat tab at least 640px wide, so Live starts streaming once the window widens to show it.',
      },
      {
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
        why: "Showing the hub again streams again; the screenshot shows the editor window's sample cut to the portrait Game View rect, whole inside the hub.",
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

// The session's pick once one is written, or null after
// `PLAYTEST_PICK_WAIT_MS`; a delete does not end the wait.
function firstPickOf(
  picks: LiveViewSelfTestDeps['picks'],
  sessionId: string,
): Promise<LivePick | null> {
  const current = picks.get(sessionId);
  if (current !== undefined) {
    return Promise.resolve(current);
  }
  return new Promise((resolve) => {
    const finish = (pick: LivePick | null) => {
      clearTimeout(timeout);
      listener.dispose();
      resolve(pick);
    };
    const timeout = setTimeout(() => finish(null), PLAYTEST_PICK_WAIT_MS);
    const listener = picks.on((key, value) => {
      if (key === sessionId && value !== undefined) {
        finish(value);
      }
    });
  });
}

// Each run closes an earlier run's rows, launches a new chat session with the
// fake agent's playtest text in a project folder whose
// `Library/EditorInstance.json` names the fake editor's pid, waits for the
// pick the app opens on that playtest command, then shows Live there as the
// agent's `show_live_view` would, with the fake Game View's rect. The start
// width leaves the Chat tab too narrow for the hub, so the first stream waits
// for the first step's width.
export function liveViewSelfTestScript(
  deps: LiveViewSelfTestDeps,
): SelfTestScript {
  const { homeDir, files, paths, chat, sessions, show, picks } = deps;
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
      const result = made.then(
        async (projectDir): Promise<LiveViewSelfTestResult> => {
          await chat.closeSessionsIn(projectDir);
          const sessionId = await chat.launch({
            projectDir,
            profile: 'work',
            message: { text: FAKE_PLAYTEST_TEXT, images: [] },
          });
          sessions.activate(sessionId);
          const playtestPick = await firstPickOf(picks, sessionId);
          const shown = await show(sessionId, {
            projectPath: projectDir,
            gameRect: FAKE_GAME_RECT,
          });
          return { playtestPick, shown };
        },
      );
      return {
        shownLine: `[chat] Chat tab shown in ${SELFTEST_PROJECT_NAME}`,
        result,
      };
    },
    groups: GROUPS,
    problems: (result) => {
      const { playtestPick, shown } = result as LiveViewSelfTestResult;
      const found: string[] = [];
      if (playtestPick === null) {
        found.push('the playtest command opened no Live view');
      } else {
        const isEditorStream =
          playtestPick.kind === 'stream' &&
          playtestPick.summary === PLAYTEST_PICK_SUMMARY;
        if (!isEditorStream) {
          const shows =
            playtestPick.kind === 'stream'
              ? playtestPick.summary
              : 'Screen Recording off';
          found.push(`the playtest command's Live view shows ${shows}`);
        }
      }
      if (shown.isError === true) {
        found.push(`show_live_view failed: ${shown.content[0]?.text ?? ''}`);
      }
      return found;
    },
  };
}
