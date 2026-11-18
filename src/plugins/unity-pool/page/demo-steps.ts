import type { DemoBeat } from '../../../contracts/demo';
import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';
import type { DemoPoolStage } from '../contract';

export interface UnityPoolPageDemoDeps {
  // sessions.activate
  activate(sessionId: string): void;
  // Asks main to show the demo pool at `stage`.
  showStage(stage: DemoPoolStage): Promise<void>;
}

const BEATS: readonly { name: string; stage: DemoPoolStage }[] = [
  { name: 'Clone held', stage: 'panel' },
  { name: 'Warm-up and stranded', stage: 'tiles' },
  { name: 'Long wait', stage: 'longWait' },
];

// Step `unity-pool.pool`: each beat asks main for its stage of the demo pool
// and shows the demo session, so the panel shows that pool. Main removes the
// pool at leave.
export function registerDemoSteps(
  services: PageServices,
  deps: UnityPoolPageDemoDeps,
): Disposable {
  return services.demoSteps.register({
    id: 'unity-pool.pool',
    section: 'bars',
    order: 1,
    title: 'Unity pool',
    caption:
      'Each session shows the Unity clone it holds, and the panel shows its whole pool.',
    files: [
      'src/plugins/unity-pool/page/start.ts',
      'src/plugins/unity-pool/page/pool-view-model.ts',
      'src/plugins/unity-pool/main/start.ts',
      'src/plugins/unity-pool/main/state-file.ts',
      'src/plugins/unity-pool/layouts/default/layout.js',
    ],
    async enter(context) {
      const sessionId = context.sessions.pool;
      if (sessionId === undefined) {
        throw new Error('unity-pool.pool: no demo session');
      }
      const beats = BEATS.map(
        ({ name, stage }): DemoBeat => ({
          name,
          async show() {
            await deps.showStage(stage);
            deps.activate(sessionId);
          },
        }),
      );
      return { beats, dispose() {} };
    },
  });
}
