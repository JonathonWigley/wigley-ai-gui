import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { escapeRegExp } from '../../../shared/escape-reg-exp';
import type { SessionsMainExports } from '../../sessions/contract';
import {
  type ChatroomFixtureDeps,
  FIXTURE_THREAD,
  seedChatroomFixture,
} from './selftest-fixture';

// The self-test's project folder, made under the self-test's home. Both
// sessions sit in it, so its name is their room.
const SELFTEST_PROJECT_NAME = 'chatroom-selftest';
const SELFTEST_ROOM = SELFTEST_PROJECT_NAME;

// The peer's side-bar label: launched second in the lead's folder, it takes the
// folder's name with a counter. The badge and activity lines name it.
const PEER_LABEL = `${SELFTEST_PROJECT_NAME} 2`;

export interface ChatroomSelfTestDeps extends ChatroomFixtureDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath'>;
  paths: Paths;
  sessions: Pick<SessionsMainExports, 'activate'>;
}

const line = (text: string) => `[chatroom] ${text}`;
const exactLine = (text: string) => new RegExp(`^${escapeRegExp(line(text))}$`);

// `open` seeds the fixture in the project folder and shows the peer's row.
// The fixture posts as the agents through the room service, so the room holds
// no `joined` entry: the side bar lists `session:<lead>` (the lead's progress,
// the newest post) above `plan-demo` until the user's answer in `plan-demo`.
export function chatroomSelfTestScript(
  deps: ChatroomSelfTestDeps,
): SelfTestScript {
  const { homeDir, files, paths, sessions } = deps;

  const groups: SelfTestGroup[] = [
    {
      name: 'mode',
      why: 'Space k c shows Chatroom mode, which fits the window at its narrowest.',
      steps: [
        {
          keys: [' ', 'k', 'c'],
          expect: line('shown'),
          checksFit: true,
          screenshot: 'mode',
        },
      ],
    },
    {
      name: 'thread',
      why: "j walks the side bar to plan-demo, and Enter opens it on its three posts, which marks them read and clears the peer's @1 badge.",
      steps: [
        {
          keys: ['j'],
          expect: '[page] j ran chatroom.listDown',
          repeat: {
            until: line(`list cursor on ${SELFTEST_ROOM}/${FIXTURE_THREAD}`),
            max: 4,
          },
        },
        {
          keys: ['Enter'],
          expect: line(
            `thread shown: ${SELFTEST_ROOM}/${FIXTURE_THREAD} (3 messages)`,
          ),
          alsoExpect: [exactLine(`badge in ${PEER_LABEL}: none`)],
          screenshot: 'thread',
        },
      ],
    },
    {
      name: 'reply',
      why: "In the log, k moves from the newest post to the peer's question, r opens the composer on an answer to it, and the typed answer posted with Enter ends the peer's `asks you`.",
      steps: [
        { keys: ['<A-l>'], expect: '[page] <A-l> ran panes.focusRight' },
        {
          keys: ['k'],
          expect: '[page] k ran chatroom.logUp',
          alsoExpect: [
            /^\[chatroom\] log cursor on #\d+ question from chatroom peer$/,
          ],
        },
        {
          keys: ['r'],
          expect: '[page] r ran chatroom.reply',
          alsoExpect: [/^\[chatroom\] composer open: answer to #\d+$/],
        },
        {
          keys: [...'yes, take it', 'Enter'],
          expect: line(`activity in ${PEER_LABEL}: none`),
          alsoExpect: [/^\[chatroom\] posted #\d+ to .+\/plan-demo$/],
          screenshot: 'reply',
        },
      ],
    },
    {
      name: 'session thread',
      why: "Back in the side bar, the answer put plan-demo first, so one j reaches the lead's session thread, and Enter opens it on the lead's progress post.",
      steps: [
        { keys: ['<A-h>'], expect: '[page] <A-h> ran panes.focusLeft' },
        {
          keys: ['j'],
          expect: '[page] j ran chatroom.listDown',
          alsoExpect: [/^\[chatroom\] list cursor on .+\/session:.+$/],
        },
        {
          keys: ['Enter'],
          expect: '[page] Enter ran chatroom.openThread',
          alsoExpect: [
            /^\[chatroom\] thread shown: .+\/session:.+ \(\d+ messages\)$/,
            /^\[chatroom\] log cursor on #\d+ progress from chatroom lead$/,
          ],
        },
      ],
    },
    {
      name: 'leave',
      why: 'Space k s leaves for Sessions mode, where the next script starts.',
      steps: [
        { keys: ['<A-h>'], expect: '[page] <A-h> ran panes.focusLeft' },
        { keys: [' ', 'k', 's'], expect: '[page] showed Sessions mode' },
      ],
    },
  ];

  return {
    pageBinds: [],
    settings: {},
    scrollsItself: [],
    open() {
      const result = (async () => {
        const home = await files.realPath(homeDir);
        const projectDir = paths.join(home, SELFTEST_PROJECT_NAME);
        const fixture = await seedChatroomFixture(deps, projectDir);
        sessions.activate(fixture.rowIds[1]);
        return fixture;
      })();
      return {
        shownLine: line(`badge in ${PEER_LABEL}: @1`),
        alsoShown: [exactLine(`activity in ${PEER_LABEL}: asks you`)],
        result,
      };
    },
    groups,
    problems: () => [],
  };
}
