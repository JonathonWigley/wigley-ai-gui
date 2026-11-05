import type { Clock } from '../../../contracts/ambient';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { ChatMainExports } from '../../chat/contract';
import type { SessionsMainExports } from '../../sessions/contract';
import {
  type PoolFixture,
  type PoolStage,
  poolStateText,
  SELFTEST_POOL,
  SELFTEST_STATE_PATH,
} from './selftest-fixture';

// The self-test's project folder, made under the self-test's home, and clone 1's folder. Its name names the session
// in every page line.
const SELFTEST_PROJECT_NAME = 'unity-pool-selftest';

// `rescan` reads every pool again: the watch started on a home with no pool folder.
export interface UnityPoolSelfTestDeps {
  homeDir: string;
  files: Pick<Files, 'makeFolder' | 'realPath' | 'write'>;
  paths: Paths;
  clock: Clock;
  chat: Pick<ChatMainExports, 'launch'>;
  sessions: Pick<SessionsMainExports, 'activate'>;
  rescan: () => void;
}

const line = (text: string) => `[unity-pool] ${text}`;

// `open` launches a session in the project folder, writes the pool with clone 1 claimed by its row, reads the pools
// again and shows the session. Each step writes the whole state file for its stage, the text built when the step
// runs, since it carries the row id `open` learns. The writes are outside changes on disk, which main's watch reads.
// Hold and Release are clicks, which the self-test cannot drive.
export function unityPoolSelfTestScript(
  deps: UnityPoolSelfTestDeps,
): SelfTestScript {
  const { homeDir, files, paths, clock, chat, sessions, rescan } = deps;
  let fixture: PoolFixture | null = null;

  const stateAt = (stage: PoolStage) => ({
    path: SELFTEST_STATE_PATH,
    get text() {
      if (fixture === null) {
        throw new Error('the unity-pool self-test fixture is not open');
      }
      return poolStateText(fixture, stage);
    },
  });

  const groups: SelfTestGroup[] = [
    {
      name: 'badge and panel',
      why: "A session whose row holds clone 1 of a pool shows `Unity 1` under its row, and while it is the shown session the right bar shows its pool's panel; a write on disk that cleans clone 2 redraws the panel with clone 2 free.",
      steps: [
        {
          writeFile: stateAt('panel'),
          keys: [],
          expect: line(`panel ${SELFTEST_POOL}: 1 held, 1 free, 0 queued`),
          screenshot: 'panel',
        },
      ],
    },
    {
      name: 'tiles',
      why: 'Every clone state draws in its tile: held, free with a failed warm-up, stranded with its reason, and free while warming up.',
      steps: [
        {
          writeFile: stateAt('tiles'),
          keys: [],
          expect: line(`panel ${SELFTEST_POOL}: 1 held, 2 free, 0 queued`),
          screenshot: 'tiles',
        },
      ],
    },
    {
      name: 'long wait',
      why: 'A queue ticket past the long-wait mark marks every clone that keeps the queue waiting as blocking: the agent-claimed clone and the user-held one.',
      steps: [
        {
          writeFile: stateAt('longWait'),
          keys: [],
          expect: line(
            `panel ${SELFTEST_POOL}: 2 held, 0 free, 1 queued, 2 blocking`,
          ),
          screenshot: 'long-wait',
        },
      ],
    },
    {
      name: 'unknown version',
      why: "A state file of a version the app does not read drops its pool: main holds none, the row's badge goes and the panel leaves the right bar.",
      steps: [
        {
          writeFile: stateAt('unknownVersion'),
          keys: [],
          expect: line('pools: none'),
          alsoExpect: [
            /^\[unity-pool\] badge in unity-pool-selftest: none$/,
            /^\[unity-pool\] panel hidden$/,
          ],
        },
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
        await files.makeFolder(projectDir);
        const rowId = await chat.launch({
          projectDir,
          profile: 'work',
          message: { text: 'unity-pool self-test', images: [] },
        });
        fixture = {
          rowId,
          clonePaths: [
            projectDir,
            paths.join(home, `${SELFTEST_PROJECT_NAME}-2`),
          ],
          startedAt: Math.floor(clock.now() / 1000),
        };
        await files.write(
          paths.join(home, SELFTEST_STATE_PATH),
          poolStateText(fixture, 'opening'),
        );
        rescan();
        sessions.activate(rowId);
      })();
      return {
        shownLine: line(`badge in ${SELFTEST_PROJECT_NAME}: Unity 1`),
        alsoShown: [/^\[unity-pool\] panel shown: selftest-pool$/],
        result,
      };
    },
    groups,
    problems: () => [],
  };
}
