import type { Disposable } from '../../../contracts/disposable';
import type { PageServices } from '../../../contracts/plugin';

export interface UnityPoolPageDemoDeps {
  // sessions.activate
  activate(sessionId: string): void;
}

// Step `unity-pool.pool`: main shows the demo pool at enter, and the beat
// shows the demo session, so the panel shows that pool. Main removes the pool
// at leave.
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
      return {
        beats: [{ name: 'Clone held', show: () => deps.activate(sessionId) }],
        dispose() {},
      };
    },
  });
}
