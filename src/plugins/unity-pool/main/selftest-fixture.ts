// The self-test's pool `selftest-pool` as unity-pool's state file holds it (its README, § State file), every time
// in Unix seconds.

export const SELFTEST_POOL = 'selftest-pool';

// The state file's path below the self-test's home, `/`-separated.
export const SELFTEST_STATE_PATH = `.local/state/unity-pool/${SELFTEST_POOL}/state.json`;

// The launched session's row id, the two clone folders (clone 1 the session's project folder) and the fixture's
// start in Unix seconds, which every time in the file counts back from.
export interface PoolFixture {
  rowId: string;
  clonePaths: readonly [string, string];
  startedAt: number;
}

// What each step shows:
// - `opening`: clone 1 claimed by the session's row, clone 2 free but dirty, no queue;
// - `panel`: clone 2 clean;
// - `longWait`: clone 2 held by the user and one ticket waiting past the long-wait mark;
// - `unknownVersion`: `longWait` under version 2, which the app does not read.
export type PoolStage = 'opening' | 'panel' | 'longWait' | 'unknownVersion';

// The queued session's id: a session the app has no row for.
const QUEUED_SESSION = 'c0ffee00-5e1f-7e57-0000-000000000000';
// Past unity-pool's long-wait mark, 10 minutes.
const LONG_WAIT_SECONDS = 11 * 60;

export function poolStateText(fixture: PoolFixture, stage: PoolStage): string {
  const t = fixture.startedAt;
  const [firstPath, secondPath] = fixture.clonePaths;
  const isLongWait = stage === 'longWait' || stage === 'unknownVersion';
  const state = {
    version: stage === 'unknownVersion' ? 2 : 1,
    pool: SELFTEST_POOL,
    updatedAt: t,
    clones: {
      '1': clone(firstPath, 'feature/selftest', false, 'ready', t, {
        kind: 'agent',
        session: null,
        row: fixture.rowId,
        since: t - 120,
        renewedAt: t - 30,
      }),
      '2': clone(
        secondPath,
        'main',
        stage === 'opening',
        'closed',
        t,
        isLongWait
          ? {
              kind: 'hold',
              session: null,
              row: null,
              since: t - 60,
              renewedAt: t - 60,
            }
          : null,
      ),
    },
    queue: isLongWait
      ? [
          {
            session: QUEUED_SESSION,
            row: null,
            branch: 'feature/queued',
            enqueuedAt: t - LONG_WAIT_SECONDS,
            polledAt: t - 5,
            longWait: true,
          },
        ]
      : [],
  };
  return `${JSON.stringify(state, null, 2)}\n`;
}

function clone(
  path: string,
  branch: string,
  dirty: boolean,
  editor: string,
  probedAt: number,
  claim: object | null,
) {
  return {
    path,
    facts: { branch, dirty, editor, probedAt },
    claim,
    handoff: null,
    stranded: null,
    lastHolder: null,
    lastReleasedAt: null,
    warmup: null,
  };
}
