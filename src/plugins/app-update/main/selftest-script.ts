import type { PageBind } from '../../../contracts/keymap';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { AppUpdateStatus } from '../contract';
import { INSTALL_EXIT_CODE_FILE, INSTALL_LOG_FILE } from './installer';
import { FIXTURE_ORIGIN_COMMIT } from './update-fixture';

// `seed` swaps in the fixture build and clone and an install that starts no
// program, then checks.
export interface AppUpdateSelfTestDeps {
  seed(): Promise<AppUpdateStatus>;
}

const line = (text: string) => `[app-update] ${text}`;
const SHORT_ORIGIN = FIXTURE_ORIGIN_COMMIT.slice(0, 7);
// The plugin's data folder under the self-test's home, `/`-separated.
const DATA_FOLDER = 'plugin-data/app-update';
// The keys that press the button, for the self-test alone: the button has no
// key.
const PRESS_KEYS = [' ', 'z', 'a', 'u'];
const PAGE_BINDS: PageBind[] = [
  { keys: PRESS_KEYS, scope: 'any', command: 'app-update.pressButton' },
];
const FAILED_LOG =
  'Packaging the app…\nnpm run package exited 1:\nerror: the build broke\n';

// `open` seeds the fixture, whose origin's main is one commit past the
// installed one, so the title bar shows the button. The press keys click it.
// The fixture's install starts no program, so the steps write its log and end
// it by writing its exit code, as the install's command line does.
export function appUpdateSelfTestScript(
  deps: AppUpdateSelfTestDeps,
): SelfTestScript {
  const groups: SelfTestGroup[] = [
    {
      name: 'install',
      why: "A build one commit behind origin's main shows Update available at the title bar's end; pressing it starts the install and turns it to Updating…, which a second press leaves alone.",
      steps: [
        {
          keys: PRESS_KEYS,
          expect: line('button: installing'),
          alsoExpect: [
            /^\[app-update\] button pressed: available 2222222$/,
            /^\[app-update\] install started$/,
          ],
          screenshot: 'installing',
          checksFit: true,
        },
        {
          // Written after the install emptied the log, as its program would.
          writeFile: {
            path: `${DATA_FOLDER}/${INSTALL_LOG_FILE}`,
            text: FAILED_LOG,
          },
          keys: PRESS_KEYS,
          expect: line('button pressed: installing'),
        },
      ],
    },
    {
      name: 'failed',
      why: "An install that writes a non-zero exit code while the app still runs turns the button to Update failed, its log's last line in the tooltip; pressing it again retries.",
      steps: [
        {
          writeFile: {
            path: `${DATA_FOLDER}/${INSTALL_EXIT_CODE_FILE}`,
            text: '1\n',
          },
          keys: [],
          expect: line('button: failed: error: the build broke'),
          alsoExpect: [/^\[app-update\] install failed: exit 1$/],
          screenshot: 'failed',
        },
        {
          keys: PRESS_KEYS,
          expect: line('button: installing'),
          alsoExpect: [/^\[app-update\] install started$/],
        },
      ],
    },
    {
      name: 'finished',
      why: 'An install that exits 0 without quitting the app leaves this app on its old build, so the check that follows shows Update available again.',
      steps: [
        {
          writeFile: {
            path: `${DATA_FOLDER}/${INSTALL_EXIT_CODE_FILE}`,
            text: '0\n',
          },
          keys: [],
          expect: line(`button: available ${SHORT_ORIGIN}`),
          alsoExpect: [/^\[app-update\] install finished$/],
          screenshot: 'available',
        },
      ],
    },
  ];

  return {
    pageBinds: PAGE_BINDS,
    settings: {},
    scrollsItself: [],
    open() {
      return {
        shownLine: line(`button: available ${SHORT_ORIGIN}`),
        result: deps.seed(),
      };
    },
    groups,
    problems: () => [],
  };
}
