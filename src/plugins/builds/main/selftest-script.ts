import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { SessionLink } from '../builds-model';

// `addLinkUntilEnded` adds `link` to the store and resolves with it, as the store then holds it, once its `ended`
// event is handled; `writeHomeFile` writes `text` at `path` under the home folder; `now` reads the clock; `log` logs
// under `builds`.
export interface BuildsSelfTestDeps {
  addLinkUntilEnded(link: SessionLink): Promise<SessionLink>;
  writeHomeFile(path: string, text: string): Promise<void>;
  now(): number;
  log(message: string): void;
}

const line = (text: string) => `[builds] ${text}`;
const SESSION = 'selftest-session';
const GAME_A = {
  id: 'game-a',
  label: 'Game A',
  defaultBranch: 'main',
  kinds: {
    dev: {
      label: 'Dev',
      target: 'dev',
      downloads: [
        { label: 'Android zip', path: '~/fixture-drive/game-a-{number}.zip' },
      ],
    },
  },
};
// One fast poll is 10 s.
const ENDING_TIMEOUT_MS = 15_000;

// The main part's script over the fixture backend: `open` writes build `game-a-1`'s zip and links build `game-a-2` to
// a session with no row, and the setting step adds the fixture backend, so its polls tell the link's failing job and
// its end. Then the page walks `game-a-2`'s job graph, saves the `ios` job's log and `game-a-1`'s zip into Downloads,
// and moves between the list and the graph in a narrow window.
export function buildsSelfTestScript(deps: BuildsSelfTestDeps): SelfTestScript {
  const groups: SelfTestGroup[] = [
    {
      name: 'setting',
      why: 'A backends setting applies live; a duplicate game shows as the backend’s problem and leaves the other game.',
      steps: [
        {
          writeFile: {
            path: '.config/wigley-ai-gui/settings.json',
            text: JSON.stringify({
              builds: {
                backends: [
                  {
                    id: 'fixture',
                    kind: 'fixture',
                    label: 'Fixture',
                    config: {},
                    games: [GAME_A, GAME_A],
                  },
                ],
              },
            }),
          },
          keys: [],
          expect: line(
            'backends applied: fixture 1 games (problem: duplicate game id "game-a")',
          ),
          alsoExpect: [/^\[builds\] first poll fixture: 2 builds$/],
        },
      ],
    },
    {
      name: 'endings',
      why: 'A linked build’s first failed job and its end each reach the session once, flags first; a session with no row gets no message.',
      steps: [
        {
          keys: [],
          expect: line(
            `failing fixture/game-a-2 for ${SESSION}: no session row, not sent`,
          ),
          timeoutMs: ENDING_TIMEOUT_MS,
        },
        {
          keys: [],
          expect: line(
            `ended fixture/game-a-2 for ${SESSION}: no session row, not sent`,
          ),
          timeoutMs: ENDING_TIMEOUT_MS,
        },
      ],
    },
    {
      name: 'graph',
      why: 'Space k m shows Builds mode; Alt+l walks the game list, the build list and the job graph, and h/j/k/l step between the jobs along the arrows.',
      steps: [
        { keys: [' ', 'k', 'm'], expect: line('shown') },
        { keys: ['j'], expect: line('game cursor on fixture/game-a') },
        { keys: ['Enter'], expect: line('shown fixture/game-a') },
        { keys: ['<A-l>'], expect: line('focus list') },
        {
          keys: ['<A-l>'],
          expect: line('graph on fixture/game-a-2 job ios'),
          alsoExpect: [/^\[builds\] focus graph$/],
          screenshot: 'graph',
        },
        { keys: ['k'], expect: line('job cursor on build-android') },
        { keys: ['l'], expect: line('job cursor on deploy') },
        { keys: ['h'], expect: line('job cursor on build-android') },
        { keys: ['j'], expect: line('job cursor on ios') },
      ],
    },
    {
      name: 'saves',
      why: 's in the graph saves the job’s log under its pinned name, and s on a build downloads its one file, each into the Downloads folder.',
      steps: [
        {
          keys: ['s'],
          expect: line('saving fixture/game-a-2/log/ios'),
          alsoExpect: [
            /^\[builds\] download fixture\/game-a-2\/log\/ios saved Game-A-Dev-2-iOS-build( \(\d+\))?\.log$/,
          ],
          screenshot: 'log-saved',
        },
        { keys: ['Escape'], expect: line('focus list') },
        { keys: ['j'], expect: line('list cursor on fixture/game-a-1') },
        {
          keys: ['s'],
          expect: line('saving fixture/game-a-1/file/0'),
          alsoExpect: [
            /^\[builds\] download fixture\/game-a-1\/file\/0 saved game-a-1( \(\d+\))?\.zip$/,
          ],
          screenshot: 'file-saved',
        },
      ],
    },
    {
      name: 'narrow',
      why: 'In a narrow window the list and the detail stack, and Alt+j and Alt+k move between them.',
      steps: [
        {
          width: 600,
          keys: ['<A-j>'],
          expect: line('graph on fixture/game-a-1 job build'),
          alsoExpect: [/^\[builds\] focus graph$/],
          screenshot: 'stacked',
        },
        { keys: ['<A-k>'], expect: line('focus list') },
        {
          width: 'start',
          keys: ['<A-l>'],
          expect: line('graph on fixture/game-a-1 job build'),
          alsoExpect: [/^\[builds\] focus graph$/],
        },
      ],
    },
  ];

  return {
    pageBinds: [],
    settings: {},
    scrollsItself: [],
    open() {
      // The zip exists before the setting step adds the backend, so the first file check finds it.
      const result = deps
        .writeHomeFile('fixture-drive/game-a-1.zip', 'fixture zip\n')
        .then(() => {
          const linked = deps.addLinkUntilEnded({
            sessionId: SESSION,
            backendId: 'fixture',
            buildId: 'game-a-2',
            setRunId: null,
            linkedAt: deps.now(),
            failingNotified: false,
            notified: false,
            endedAt: null,
          });
          deps.log('self-test link added');
          return linked;
        });
      return { shownLine: line('self-test link added'), result };
    },
    groups,
    problems(result) {
      const link = result as SessionLink;
      return link.failingNotified && link.notified
        ? []
        : ['the fixture link was not marked told'];
    },
  };
}
