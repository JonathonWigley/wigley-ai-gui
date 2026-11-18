import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import type { PoolState } from '../contract';
import { type PoolFixture, poolStateText } from './selftest-fixture';
import { readStateFile } from './state-file';

// The demo's sample pool; main runs no CLI for a clone of it.
export const DEMO_POOL = 'demo-pool';

export interface UnityPoolDemoDeps {
  setDemoPool(pool: PoolState | null): void;
}

// The self-test fixture's pool at its `tiles` stage, named `DEMO_POOL`.
function demoPoolOf(fixture: PoolFixture): PoolState {
  const read = readStateFile(poolStateText(fixture, 'tiles'));
  if (read.kind !== 'pool') {
    throw new Error(`demo pool read as ${read.kind}`);
  }
  return { ...read.pool, pool: DEMO_POOL };
}

// The main half of step `unity-pool.pool`: launches the demo session clone 1
// is held by, in the scratch folder, and shows the self-test fixture's pool
// with a failed warm-up, a stranded clone and a warming clone as `DEMO_POOL`
// through `setDemoPool` until the stage is disposed.
export function registerDemoSteps(
  services: MainServices,
  deps: UnityPoolDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'unity-pool.pool',
    async enter(context) {
      const rowId = await context.launchSession('Fix the level loader');
      const fixture: PoolFixture = {
        rowId,
        clonePaths: [
          context.scratchDir,
          services.paths.join(context.scratchDir, 'unity-2'),
        ],
        startedAt: Math.floor(services.clock.now() / 1000),
      };
      deps.setDemoPool(demoPoolOf(fixture));
      return {
        sessions: { pool: rowId },
        dispose: () => deps.setDemoPool(null),
      };
    },
  });
}
