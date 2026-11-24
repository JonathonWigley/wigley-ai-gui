import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import type { SessionLink } from '../builds-model';

// `addLinkUntilEnded` adds `link` to the store and resolves with it, as the store then holds it, once its `ended`
// event is handled; `now` reads the clock; `log` logs under `builds`.
export interface BuildsSelfTestDeps {
  addLinkUntilEnded(link: SessionLink): Promise<SessionLink>;
  now(): number;
  log(message: string): void;
}

const line = (text: string) => `[builds] ${text}`;
const SESSION = 'selftest-session';
const GAME_A = {
  id: 'game-a',
  label: 'Game A',
  defaultBranch: 'main',
  kinds: { dev: { label: 'Dev', target: 'dev', downloads: [] } },
};
// One fast poll is 10 s.
const ENDING_TIMEOUT_MS = 15_000;

// The main part's script over the fixture backend: `open` links build `game-a-2` to a session with no row, and the
// setting step adds the fixture backend, so its polls tell the link's failing job and its end.
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
  ];

  return {
    pageBinds: [],
    settings: {},
    scrollsItself: [],
    open() {
      const result = deps.addLinkUntilEnded({
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
