import type {
  BuildJob,
  BuildRecord,
  BuildsSnapshot,
  GameEntry,
  SessionBuilds,
} from '../contract';

const BACKEND = 'sample';
const MINUTE = 60_000;

const SKY_HOP: GameEntry = {
  id: 'sky-hop',
  label: 'Sky Hop',
  clone: null,
  defaultBranch: 'main',
  kinds: {
    dev: { label: 'Dev', target: null },
    release: { label: 'Release', target: null },
  },
  sets: [
    {
      id: 'rc',
      label: 'RC',
      kinds: ['dev', 'release'],
      branches: 'releases/*',
      agentPrompt: null,
    },
  ],
};

const WORD_GARDEN: GameEntry = {
  id: 'word-garden',
  label: 'Word Garden',
  clone: null,
  defaultBranch: 'main',
  kinds: { dev: { label: 'Dev', target: null } },
  sets: [],
};

const RC_REVISION = '7c41d09be2a35f18';
const MAIN_REVISION = '2993a9e4c1b07d55';

function sampleBuild(
  fields: Partial<BuildRecord> &
    Pick<BuildRecord, 'id' | 'gameId' | 'queuedAt'>,
): BuildRecord {
  return {
    kind: 'dev',
    number: null,
    version: null,
    branch: 'main',
    revision: null,
    state: 'finished',
    result: 'success',
    statusText: null,
    percent: null,
    leftSeconds: null,
    stepText: null,
    startedAt: null,
    finishedAt: null,
    startEstimate: null,
    webUrl: null,
    links: [],
    jobs: [],
    triggeredBy: 'ci-bot',
    ...fields,
  };
}

function sampleJob(
  fields: Partial<BuildJob> & Pick<BuildJob, 'id' | 'label'>,
): BuildJob {
  return {
    state: 'finished',
    result: 'success',
    percent: null,
    leftSeconds: null,
    stepText: null,
    ...fields,
  };
}

// The demo step's snapshot, its times relative to `now` (epoch ms): one backend `Sample CI` with two games, holding
// a running build at 60 % with 7 minutes left, a backend page and two links, a queued build with a start estimate, a
// failed build with a failed job, and an RC set run of two builds.
export function demoSample(now: number): BuildsSnapshot {
  return {
    polledAt: now,
    backends: [
      {
        id: BACKEND,
        kind: 'sample',
        label: 'Sample CI',
        problem: null,
        capabilities: { cancel: true, choosesBranch: true },
        games: [
          {
            backendId: BACKEND,
            game: SKY_HOP,
            subjects: {
              [MAIN_REVISION]: 'Tune the jump arc',
              [RC_REVISION]: 'Release 1.4',
            },
            setRuns: [
              {
                id: 'run-1',
                setId: 'rc',
                label: 'RC',
                revision: RC_REVISION,
                builds: [
                  { backendId: BACKEND, buildId: 'sky-104' },
                  { backendId: BACKEND, buildId: 'sky-103' },
                ],
              },
            ],
            builds: [
              sampleBuild({
                id: 'sky-106',
                gameId: SKY_HOP.id,
                number: '106',
                revision: MAIN_REVISION,
                state: 'queued',
                result: null,
                queuedAt: now - MINUTE,
                startEstimate: now + 3 * MINUTE,
              }),
              sampleBuild({
                id: 'sky-105',
                gameId: SKY_HOP.id,
                number: '105',
                revision: MAIN_REVISION,
                state: 'running',
                result: null,
                percent: 60,
                leftSeconds: 420,
                stepText: 'Building the iOS player',
                queuedAt: now - 12 * MINUTE,
                startedAt: now - 11 * MINUTE,
                webUrl: 'https://ci.example.com/sky-hop/105',
                links: [
                  {
                    label: 'Android build',
                    url: 'https://ci.example.com/sky-hop/105/android.apk',
                  },
                  {
                    label: 'Build log',
                    url: 'https://ci.example.com/sky-hop/105/log',
                  },
                ],
                jobs: [
                  sampleJob({ id: 'android', label: 'Android' }),
                  sampleJob({
                    id: 'ios',
                    label: 'iOS',
                    state: 'running',
                    result: null,
                    percent: 60,
                    leftSeconds: 420,
                    stepText: 'Building the iOS player',
                  }),
                ],
              }),
              sampleBuild({
                id: 'sky-104',
                gameId: SKY_HOP.id,
                kind: 'release',
                number: '104',
                version: '1.4.0',
                branch: 'releases/1.4',
                revision: RC_REVISION,
                queuedAt: now - 60 * MINUTE,
                finishedAt: now - 35 * MINUTE,
              }),
              sampleBuild({
                id: 'sky-103',
                gameId: SKY_HOP.id,
                number: '103',
                version: '1.4.0',
                branch: 'releases/1.4',
                revision: RC_REVISION,
                queuedAt: now - 61 * MINUTE,
                finishedAt: now - 40 * MINUTE,
              }),
            ],
          },
          {
            backendId: BACKEND,
            game: WORD_GARDEN,
            subjects: {},
            setRuns: [],
            builds: [
              sampleBuild({
                id: 'word-58',
                gameId: WORD_GARDEN.id,
                number: '58',
                state: 'finished',
                result: 'failure',
                statusText: 'Tests failed: 2 of 311',
                queuedAt: now - 25 * MINUTE,
                finishedAt: now - 9 * MINUTE,
                jobs: [
                  sampleJob({
                    id: 'tests',
                    label: 'Tests',
                    result: 'failure',
                    stepText: 'GridTests.FillsEveryCell failed',
                  }),
                ],
              }),
            ],
          },
        ],
      },
    ],
  };
}

// The side-bar key of the sample's first game.
export const DEMO_FIRST_GAME = `${BACKEND}/${SKY_HOP.id}` as const;

// What a demo step shows in place of the slots: a snapshot, and the session builds of the demo sessions it holds.
export interface BuildsDemoSample {
  snapshot: BuildsSnapshot;
  sessions: ReadonlyMap<string, SessionBuilds>;
}

// The Session builds step's sample: `demoSample(now)`, with session `sessionId` linking its running Dev build (60 %,
// 7 minutes left) and a finished, successful Dev build, and holding an offer of Sky Hop's Release on `protos/game`.
export function demoSessionSample(
  now: number,
  sessionId: string,
): BuildsDemoSample {
  const builds: SessionBuilds = {
    builds: [
      { backendId: BACKEND, buildId: 'sky-105' },
      { backendId: BACKEND, buildId: 'sky-103' },
    ],
    offer: {
      backendId: BACKEND,
      gameId: SKY_HOP.id,
      kind: 'release',
      branch: 'protos/game',
      revision: MAIN_REVISION,
      subject: 'Tune the jump arc',
      createdAt: now - MINUTE,
    },
  };
  return {
    snapshot: demoSample(now),
    sessions: new Map([[sessionId, builds]]),
  };
}
