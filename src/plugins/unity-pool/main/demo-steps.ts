import type { Disposable } from '../../../contracts/disposable';
import type { MainServices } from '../../../contracts/plugin';
import type { DemoPoolStage, PoolState } from '../contract';
import { type PoolFixture, poolStateText } from './selftest-fixture';
import { readStateFile } from './state-file';

// The demo's sample pool; main runs no CLI for a clone of it.
export const DEMO_POOL = 'demo-pool';

export interface UnityPoolDemoDeps {
  setDemoPool(pool: PoolState | null): void;
}

// `showStage` throws while no stage is entered.
export interface UnityPoolDemo extends Disposable {
  showStage(stage: DemoPoolStage): void;
}

// The self-test fixture's pool at `stage`, named `DEMO_POOL`.
function demoPoolOf(fixture: PoolFixture, stage: DemoPoolStage): PoolState {
  const read = readStateFile(poolStateText(fixture, stage));
  if (read.kind !== 'pool') {
    throw new Error(`demo pool ${stage} read as ${read.kind}`);
  }
  return { ...read.pool, pool: DEMO_POOL };
}

// The main half of step `unity-pool.pool`: launches the demo session clone 1
// is held by, in the scratch folder, and shows the self-test fixture's pool as
// `DEMO_POOL` through `setDemoPool` until the stage is disposed.
export function registerDemoSteps(
  services: MainServices,
  deps: UnityPoolDemoDeps,
): UnityPoolDemo {
  let entered: PoolFixture | null = null;
  const registration = services.demoSteps.register({
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
      deps.setDemoPool(demoPoolOf(fixture, 'panel'));
      entered = fixture;
      return {
        sessions: { pool: rowId },
        dispose() {
          if (entered === fixture) {
            entered = null;
          }
          deps.setDemoPool(null);
        },
      };
    },
  });
  return {
    showStage(stage) {
      if (entered === null) {
        throw new Error('no demo step entered');
      }
      deps.setDemoPool(demoPoolOf(entered, stage));
    },
    dispose: () => registration.dispose(),
  };
}
